import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import OpenAI from 'openai';
import { z } from 'zod';
import type { Config } from '../config.js';

const Judgement = z.object({
  relevant: z.boolean(),
  label_matches: z.boolean().nullable().optional(),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
  reason: z.string().optional(),
});
type Judgement = z.infer<typeof Judgement>;

export interface RelevanceResult {
  estimateBps: number;
  lowBps: number;
  highBps: number;
  sampleSize: number;
  method: string;
  undetermined: number;
  labelMismatches: string[];
  irrelevant: string[];
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
}

/** One image judgement. `out === null` means undetermined (refusal, unparseable, rate limited). */
export interface ImageJudge {
  model: string;
  /** parallel requests; free endpoints need this low */
  concurrency: number;
  judge(imageB64: string, mediaType: 'image/jpeg' | 'image/png', prompt: string): Promise<{ out: Judgement | null; inputTokens: number; outputTokens: number }>;
}

const SYSTEM =
  'You audit images in a machine-learning dataset. Judge only what is visible. ' +
  'Be calibrated: if the image is ambiguous, say so with low confidence.';

/** 95% Wilson score interval, in basis points. */
export function wilson(successes: number, n: number): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 0 };
  const z2 = 1.96 ** 2;
  const p = successes / n;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = 1.96 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { low: Math.max(0, Math.floor(((centre - margin) / denom) * 10_000)), high: Math.min(10_000, Math.ceil(((centre + margin) / denom) * 10_000)) };
}

/** Extracts the first JSON object from free text (models without strict JSON mode). */
export function parseJudgement(text: string): Judgement | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const r = Judgement.safeParse(JSON.parse(m[0]));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ providers

export function anthropicJudge(cfg: Config, client?: Pick<Anthropic, 'messages'>): ImageJudge {
  const c = client ?? new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY, maxRetries: 3 });
  return {
    model: cfg.L3_MODEL,
    concurrency: 4,
    async judge(data, mediaType, prompt) {
      try {
        const response = await c.messages.parse({
          model: cfg.L3_MODEL,
          max_tokens: 1024,
          output_config: { effort: 'low', format: zodOutputFormat(Judgement) },
          system: SYSTEM,
          messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data } }, { type: 'text', text: prompt }] }],
        });
        const out = response.stop_reason === 'refusal' ? null : (response.parsed_output as Judgement | null);
        return { out, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
      } catch (e) {
        if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.InternalServerError) return { out: null, inputTokens: 0, outputTokens: 0 };
        throw e;
      }
    },
  };
}

function nvidiaClient(cfg: Config) {
  // NVIDIA API catalog is OpenAI-compatible; the SDK retries 429/5xx with backoff
  return new OpenAI({ apiKey: cfg.NVIDIA_API_KEY, baseURL: cfg.NVIDIA_BASE_URL, maxRetries: 4, timeout: 120_000 });
}

export function nvidiaJudge(cfg: Config, client?: Pick<OpenAI, 'chat'>): ImageJudge {
  const c = client ?? nvidiaClient(cfg);
  return {
    model: cfg.L3_VISION_MODEL,
    concurrency: 2,
    async judge(data, mediaType, prompt) {
      try {
        const r = await c.chat.completions.create({
          model: cfg.L3_VISION_MODEL,
          temperature: 0,
          max_tokens: 300,
          // Nemotron models: answer directly instead of emitting a reasoning trace
          ...(/nemotron/i.test(cfg.L3_VISION_MODEL) ? ({ chat_template_kwargs: { enable_thinking: false } } as object) : {}),
          messages: [
            {
              role: 'user',
              // llama-3.2-vision on the NVIDIA catalog takes one image and no system role alongside it
              content: [
                { type: 'text', text: `${SYSTEM}\n\n${prompt}\nReply ONLY with JSON: {"relevant": true|false, "label_matches": true|false|null, "confidence": "low"|"medium"|"high", "reason": "<short>"}` },
                { type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } },
              ],
            },
          ],
        });
        return { out: parseJudgement(r.choices[0]?.message?.content ?? ''), inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: r.usage?.completion_tokens ?? 0 };
      } catch (e) {
        if (e instanceof OpenAI.RateLimitError || e instanceof OpenAI.APIConnectionError || e instanceof OpenAI.InternalServerError) return { out: null, inputTokens: 0, outputTokens: 0 };
        throw e;
      }
    },
  };
}

export function geminiJudge(cfg: Config, fetcher: typeof fetch = fetch): ImageJudge {
  return {
    model: cfg.GEMINI_MODEL,
    concurrency: 2,
    async judge(data, mediaType, prompt) {
      const r = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.GEMINI_MODEL)}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.GEMINI_API_KEY! },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `${SYSTEM}\n${prompt}\nReturn JSON with relevant (boolean), label_matches (boolean or null), confidence, reason.` }, { inline_data: { mime_type: mediaType, data } }] }], generationConfig: { temperature: 0, maxOutputTokens: 300, responseMimeType: 'application/json' } }),
      });
      if ([429, 500, 502, 503, 504].includes(r.status)) return { out: null, inputTokens: 0, outputTokens: 0 };
      if (!r.ok) throw new Error(`Gemini request failed (${r.status})`);
      const doc = await r.json() as any;
      const text = doc.candidates?.[0]?.content?.parts?.filter((p: any) => !p.thought).map((p: any) => p.text ?? '').join('') ?? '';
      return { out: parseJudgement(text), inputTokens: doc.usageMetadata?.promptTokenCount ?? 0, outputTokens: (doc.usageMetadata?.candidatesTokenCount ?? 0) + (doc.usageMetadata?.thoughtsTokenCount ?? 0) };
    },
  };
}

export function aiProvider(cfg: Config): 'nvidia' | 'anthropic' | 'gemini' | null {
  if (cfg.AI_PROVIDER === 'gemini') return cfg.GEMINI_API_KEY ? 'gemini' : null;
  if (cfg.AI_PROVIDER === 'nvidia' || (!cfg.AI_PROVIDER && cfg.NVIDIA_API_KEY)) return cfg.NVIDIA_API_KEY ? 'nvidia' : null;
  if (cfg.AI_PROVIDER === 'anthropic' || (!cfg.AI_PROVIDER && cfg.ANTHROPIC_API_KEY)) return cfg.ANTHROPIC_API_KEY ? 'anthropic' : null;
  return null;
}

export function defaultJudge(cfg: Config): ImageJudge {
  const p = aiProvider(cfg);
  if (p === 'nvidia') return nvidiaJudge(cfg);
  if (p === 'anthropic') return anthropicJudge(cfg);
  if (p === 'gemini') return geminiJudge(cfg);
  throw new Error('Level 3 analysis needs a configured AI provider');
}

// ------------------------------------------------------------------ relevance review

/**
 * Level-3 relevance review of a random sample. The result is a statistical *estimate* with an
 * interval, never presented as proof of quality. Refused / unparseable / rate-limited items are
 * counted as undetermined and excluded (and reported) rather than guessed.
 */
export async function assessRelevance(
  cfg: Config,
  samples: { path: string; source: string; label: string | null }[],
  task: string,
  maxCalls: number,
  injected?: Pick<Anthropic, 'messages'> | ImageJudge,
): Promise<RelevanceResult> {
  const judge: ImageJudge = !injected ? defaultJudge(cfg) : 'judge' in injected ? injected : anthropicJudge(cfg, injected);
  const items = samples.slice(0, Math.max(0, Math.floor(maxCalls)));
  let relevant = 0;
  let judged = 0;
  let undetermined = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const labelMismatches: string[] = [];
  const irrelevant: string[] = [];
  const queue = [...items];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const data = (await readFile(s.path)).toString('base64');
      const prompt = `Dataset task: ${task}\n${s.label ? `Assigned label: ${s.label}\n` : ''}Is this image relevant to the task?${s.label ? ' Does the assigned label match the image?' : ' Set label_matches to null.'}`;
      const r = await judge.judge(data, s.path.endsWith('.png') ? 'image/png' : 'image/jpeg', prompt);
      inputTokens += r.inputTokens;
      outputTokens += r.outputTokens;
      if (!r.out) {
        undetermined++;
        continue;
      }
      judged++;
      if (r.out.relevant) relevant++;
      else irrelevant.push(s.source);
      if (r.out.label_matches === false) labelMismatches.push(s.source);
    }
  };
  await Promise.all(Array.from({ length: Math.min(judge.concurrency, items.length) }, worker));
  const ci = wilson(relevant, judged);
  return {
    estimateBps: judged ? Math.round((relevant / judged) * 10_000) : 0,
    lowBps: ci.low,
    highBps: ci.high,
    sampleSize: judged,
    method: `${judge.model} sampled review, 95% Wilson interval`,
    undetermined,
    labelMismatches,
    irrelevant,
    apiCalls: items.length,
    inputTokens,
    outputTokens,
  };
}

// ------------------------------------------------------------------ natural-language explanation

/**
 * Plain-English summary of a finished report for buyers (text model). It only restates the
 * report's facts; it is labelled as AI-generated and is never used for pass/fail decisions.
 */
/** Makes report fields self-explanatory for a language model: basis points → percent, drop hashes/noise. */
export function humanizeReport(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(humanizeReport);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (['specHash', 'assetCommitment', 'assetId', 'assetVersion', 'files', 'createdAt', 'verifier', 'tools'].includes(k)) continue;
      if (/Bps$/.test(k) && typeof x === 'number') out[`${k.slice(0, -3)}Percent`] = Math.round(x) / 100;
      else if (k === 'required' || k === 'actual') out[k] = x;
      else out[k] = humanizeReport(x);
    }
    // criteria rows: rename bps criteria so the model does not misread units
    if (typeof out.criterion === 'string' && /_bps$/.test(out.criterion)) {
      out.criterion = out.criterion.replace(/_bps$/, '_percent');
      for (const f of ['required', 'actual'] as const) if (typeof out[f] === 'number') out[f] = (out[f] as number) / 100;
    }
    return out;
  }
  return v;
}

export async function explainReport(cfg: Config, report: unknown, client?: Pick<OpenAI, 'chat'>): Promise<string | null> {
  if (aiProvider(cfg) !== 'nvidia' && !client) return null;
  const c = client ?? nvidiaClient(cfg);
  try {
    const r = await c.chat.completions.create({
      model: cfg.L3_TEXT_MODEL,
      temperature: 0.2,
      max_tokens: 600,
      messages: [
        {
          role: 'system',
          content:
            'You explain dataset/model verification reports to a non-expert buyer in at most 6 short sentences. ' +
            'Only restate facts present in the JSON. Distinguish confirmed errors, suspected issues, estimates and untested requirements. ' +
            'Fields ending in Percent are percentages (0-100). An interval like lowPercent-highPercent is a 95% confidence range from a small sample. ' +
            'Never claim quality beyond what was measured. Plain text, no markdown.',
        },
        { role: 'user', content: JSON.stringify(humanizeReport(report)).slice(0, 24_000) },
      ],
      // Nemotron: answer directly, skip the reasoning trace
      ...({ chat_template_kwargs: { enable_thinking: false } } as object),
    });
    const text = r.choices[0]?.message?.content?.trim();
    return text ? text.slice(0, 1500) : null;
  } catch {
    return null; // explanations are optional; never fail a verification because of them
  }
}
