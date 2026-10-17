import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import OpenAI from 'openai';
import type { Config } from '../config.js';
import { parseJudgement, wilson } from './l3.js';

/**
 * Level-3 sampled review of audio and video clips with an omni model. Clips are sent as-is (no local
 * decoding); oversized PCM WAV is cut to a prefix, other oversized clips are skipped and reported.
 * Like image relevance, the result is an estimate with an interval, never proof of quality.
 */

export const MEDIA_PROMPT_VERSION = 'media-review-2026-10-18';
const AUDIO = new Map([['.wav', 'audio/wav'], ['.mp3', 'audio/mpeg'], ['.flac', 'audio/flac'], ['.ogg', 'audio/ogg'], ['.m4a', 'audio/mp4']]);
const VIDEO = new Map([['.mp4', 'video/mp4'], ['.mov', 'video/quicktime'], ['.webm', 'video/webm']]);
const ext = (p: string) => p.slice(p.lastIndexOf('.')).toLowerCase();

export type MediaKind = 'audio' | 'video';
export const mediaKind = (path: string): MediaKind | null => (AUDIO.has(ext(path)) ? 'audio' : VIDEO.has(ext(path)) ? 'video' : null);

/** Deterministic sample (mulberry32 shuffle) so a re-run of the same job reviews the same clips. */
export function sampleMedia(paths: string[], seed: number, max: number): string[] {
  const media = paths.filter((p) => mediaKind(p)).sort();
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = media.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [media[i], media[j]] = [media[j], media[i]];
  }
  return media.slice(0, Math.max(0, max));
}

/** Label = parent folder, but only when the clips are spread over 2+ folders (a class layout). */
export function folderLabels(paths: string[]): (p: string) => string | null {
  const parent = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')).split('/').pop()! : null);
  const folders = new Set(paths.map(parent).filter(Boolean));
  return folders.size >= 2 ? parent : () => null;
}

/**
 * Cuts a RIFF/WAVE PCM file to at most `maxBytes`, keeping every chunk before `data` and a
 * frame-aligned prefix of the samples. Returns null when the file is not a parseable WAV.
 */
export function truncateWav(buf: Buffer, maxBytes: number): Buffer | null {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let off = 12;
  let blockAlign = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ' && off + 22 <= buf.length) blockAlign = buf.readUInt16LE(off + 20);
    if (id === 'data') {
      if (!blockAlign) return null;
      const header = off + 8;
      const available = Math.min(size, buf.length - header);
      const room = maxBytes - header;
      if (room <= 0) return null;
      const keep = Math.min(available, room - (room % blockAlign));
      const out = Buffer.from(buf.subarray(0, header + keep));
      out.writeUInt32LE(keep, off + 4);
      out.writeUInt32LE(out.length - 8, 4);
      return out;
    }
    off += 8 + size + (size % 2);
  }
  return null;
}

/** Bytes to upload for one clip, or a reason it was skipped. */
export async function prepareClip(path: string, maxBytes: number): Promise<{ data: Buffer; truncated: boolean } | { skipped: string }> {
  const size = (await stat(path)).size;
  if (size <= maxBytes) return { data: await readFile(path), truncated: false };
  if (ext(path) === '.wav') {
    const cut = truncateWav(await readFile(path), maxBytes);
    return cut ? { data: cut, truncated: true } : { skipped: 'unparseable WAV over the clip size cap' };
  }
  return { skipped: `clip over ${Math.round(maxBytes / 1024 ** 2)} MiB cap (no local decoding)` };
}

export interface MediaJudge {
  model: string;
  concurrency: number;
  judge(kind: MediaKind, dataUrl: string, prompt: string): Promise<{ out: ReturnType<typeof parseJudgement>; inputTokens: number; outputTokens: number }>;
}

export function nvidiaMediaJudge(cfg: Config, client?: Pick<OpenAI, 'chat'>): MediaJudge {
  const c = client ?? new OpenAI({ apiKey: cfg.NVIDIA_API_KEY, baseURL: cfg.NVIDIA_BASE_URL, maxRetries: 4, timeout: 180_000 });
  return {
    model: cfg.L3_MEDIA_MODEL,
    concurrency: 2,
    async judge(kind, dataUrl, prompt) {
      // audio_url / video_url are NVIDIA catalog extensions (verified 2026-10-18); input_audio is ignored by this model.
      const part = kind === 'audio' ? { type: 'audio_url', audio_url: { url: dataUrl } } : { type: 'video_url', video_url: { url: dataUrl } };
      try {
        const r = await c.chat.completions.create({
          model: cfg.L3_MEDIA_MODEL,
          temperature: 0,
          max_tokens: 300,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, part] as any }],
          ...({ chat_template_kwargs: { enable_thinking: false } } as object),
        });
        return { out: parseJudgement(r.choices[0]?.message?.content ?? ''), inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: r.usage?.completion_tokens ?? 0 };
      } catch (e) {
        if (e instanceof OpenAI.RateLimitError || e instanceof OpenAI.APIConnectionError || e instanceof OpenAI.InternalServerError) return { out: null, inputTokens: 0, outputTokens: 0 };
        throw e;
      }
    },
  };
}

export interface MediaResult {
  estimateBps: number;
  lowBps: number;
  highBps: number;
  sampleSize: number;
  method: string;
  undetermined: number;
  skipped: { path: string; reason: string }[];
  truncated: number;
  irrelevant: string[];
  labelMismatches: string[];
  kinds: Record<MediaKind, number>;
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export async function assessMedia(cfg: Config, inDir: string, paths: string[], task: string, seed: number, maxCalls: number, judge: MediaJudge = nvidiaMediaJudge(cfg)): Promise<MediaResult> {
  const label = folderLabels(paths.filter((p) => mediaKind(p)));
  const chosen = sampleMedia(paths, seed, Math.min(maxCalls, cfg.L3_MEDIA_MAX_CLIPS));
  const res: MediaResult = { estimateBps: 0, lowBps: 0, highBps: 0, sampleSize: 0, method: '', undetermined: 0, skipped: [], truncated: 0, irrelevant: [], labelMismatches: [], kinds: { audio: 0, video: 0 }, apiCalls: 0, inputTokens: 0, outputTokens: 0 };
  let relevant = 0;
  const queue = [...chosen];
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const kind = mediaKind(p)!;
      const clip = await prepareClip(join(inDir, ...p.split('/')), cfg.L3_MEDIA_MAX_BYTES);
      if ('skipped' in clip) {
        res.skipped.push({ path: p, reason: clip.skipped });
        continue;
      }
      if (clip.truncated) res.truncated++;
      const l = label(p);
      const prompt =
        `You audit ${kind} clips in a machine-learning dataset. Judge only what you can hear${kind === 'video' ? ' and see' : ''}; if unsure, use low confidence.\n` +
        `Dataset task: ${task}\n${l ? `Assigned label: ${l}\n` : ''}Is this ${kind} clip relevant to the task?${l ? ' Does the assigned label match the clip?' : ' Set label_matches to null.'}\n` +
        'Reply ONLY with JSON: {"relevant": true|false, "label_matches": true|false|null, "confidence": "low"|"medium"|"high", "reason": "<short>"}';
      const mime = (kind === 'audio' ? AUDIO : VIDEO).get(ext(p))!;
      const r = await judge.judge(kind, `data:${mime};base64,${clip.data.toString('base64')}`, prompt);
      res.apiCalls++;
      res.inputTokens += r.inputTokens;
      res.outputTokens += r.outputTokens;
      if (!r.out) {
        res.undetermined++;
        continue;
      }
      res.sampleSize++;
      res.kinds[kind]++;
      if (r.out.relevant) relevant++;
      else res.irrelevant.push(p);
      if (r.out.label_matches === false) res.labelMismatches.push(p);
    }
  };
  await Promise.all(Array.from({ length: Math.min(judge.concurrency, chosen.length) }, worker));
  const ci = wilson(relevant, res.sampleSize);
  res.estimateBps = res.sampleSize ? Math.round((relevant / res.sampleSize) * 10_000) : 0;
  res.lowBps = ci.low;
  res.highBps = ci.high;
  res.method = `${judge.model} sampled ${[res.kinds.audio && 'audio', res.kinds.video && 'video'].filter(Boolean).join('/') || 'media'} review, 95% Wilson interval`;
  return res;
}
