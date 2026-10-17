/**
 * Measures L3 reviewer accuracy, calls, tokens and latency on a labeled set with known answers
 * (see scripts/benchmark/make-fixtures.py). Uses the configured NVIDIA models from apps/api/.env.
 * Usage: npx tsx scripts/l3-benchmark.ts .data/benchmark [--only image|audio|video|duplicates] [--image-model ID] [--out FILE.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig } from '../apps/api/src/config.js';
import { nvidiaJudge } from '../apps/api/src/services/l3.js';
import { nvidiaMediaJudge } from '../apps/api/src/services/media-review.js';
import { embedImage } from '../apps/api/src/services/semantic.js';

const dir = process.argv[2] ?? '.data/benchmark';
process.loadEnvFile(join(import.meta.dirname, '../apps/api/.env'));
const flag = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
if (flag('--image-model')) process.env.L3_VISION_MODEL = flag('--image-model');
const only = flag('--only');
const cfg = loadConfig(process.env);
if (!cfg.NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY is required');

type Item = { path: string; kind: 'image' | 'audio' | 'video'; task: string; label: string | null; relevant: boolean; labelCorrect: boolean | null; group: string };
type Pair = { pair: [string, string]; duplicate: boolean; group: string };
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as (Item | Pair)[];
const items = manifest.filter((m): m is Item => 'path' in m && (!only || m.kind === only));
const pairs = manifest.filter((m): m is Pair => 'pair' in m && (!only || only === 'duplicates'));

const image = nvidiaJudge(cfg);
const media = nvidiaMediaJudge(cfg);
const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', wav: 'audio/wav', mp4: 'video/mp4' };

type Row = { path: string; kind: string; expectRelevant: boolean; gotRelevant: boolean | null; expectLabel: boolean | null; gotLabel: boolean | null; ms: number; inTok: number; outTok: number; reason?: string };
const rows: Row[] = [];
for (const it of items) {
  const data = readFileSync(join(dir, it.path)).toString('base64');
  const prompt = `Dataset task: ${it.task}\n${it.label ? `Assigned label: ${it.label}\n` : ''}Is this ${it.kind} relevant to the task?${it.label ? ' Does the assigned label match it?' : ' Set label_matches to null.'}`;
  const t0 = performance.now();
  const r = it.kind === 'image'
    ? await image.judge(data, it.path.endsWith('.png') ? 'image/png' : 'image/jpeg', prompt)
    : await media.judge(it.kind, `data:${mime[it.path.split('.').pop()!]};base64,${data}`,
      `You audit ${it.kind} clips in a machine-learning dataset. Judge only what you can perceive; if unsure, use low confidence.\n${prompt}\nReply ONLY with JSON: {"relevant": true|false, "label_matches": true|false|null, "confidence": "low"|"medium"|"high", "reason": "<short>"}`);
  rows.push({ path: it.path, kind: it.kind, expectRelevant: it.relevant, gotRelevant: r.out?.relevant ?? null, expectLabel: it.labelCorrect, gotLabel: r.out?.label_matches ?? null, ms: Math.round(performance.now() - t0), inTok: r.inputTokens, outTok: r.outputTokens, reason: r.out?.reason });
  process.stdout.write('.');
}

const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const dupRows: { pair: string; duplicate: boolean; similarity: number; ms: number }[] = [];
for (const p of pairs) {
  const t0 = performance.now();
  const [a, b] = await Promise.all(p.pair.map(async (f) => JSON.parse((await embedImage(cfg, readFileSync(join(dir, f)).toString('base64'))).vector) as number[]));
  dupRows.push({ pair: p.pair.join(' ~ '), duplicate: p.duplicate, similarity: Math.round(cos(a, b) * 10_000) / 10_000, ms: Math.round(performance.now() - t0) });
  process.stdout.write('+');
}
console.log();

const summarize = (kind: string) => {
  const rs = rows.filter((r) => r.kind === kind);
  const judged = rs.filter((r) => r.gotRelevant !== null);
  const correct = judged.filter((r) => r.gotRelevant === r.expectRelevant).length;
  const mis = rs.filter((r) => r.expectLabel === false);
  const flagged = rs.filter((r) => r.gotLabel === false);
  const truePos = flagged.filter((r) => r.expectLabel === false).length;
  return {
    kind, items: rs.length, undetermined: rs.length - judged.length,
    relevanceAccuracy: judged.length ? Math.round((correct / judged.length) * 1000) / 10 : null,
    mislabelRecall: mis.length ? Math.round((truePos / mis.length) * 1000) / 10 : null,
    mislabelPrecision: flagged.length ? Math.round((truePos / flagged.length) * 1000) / 10 : null,
    meanLatencyMs: rs.length ? Math.round(rs.reduce((s, r) => s + r.ms, 0) / rs.length) : null,
    meanInputTokens: rs.length ? Math.round(rs.reduce((s, r) => s + r.inTok, 0) / rs.length) : null,
    meanOutputTokens: rs.length ? Math.round(rs.reduce((s, r) => s + r.outTok, 0) / rs.length) : null,
  };
};
const threshold = 0.97;
const summary = {
  ranAt: new Date().toISOString(),
  models: { image: cfg.L3_VISION_MODEL, media: cfg.L3_MEDIA_MODEL, imageEmbedding: cfg.NVIDIA_IMAGE_EMBEDDING_MODEL },
  apiCalls: rows.length + dupRows.length * 2,
  costNote: cfg.NVIDIA_USD_MICRO_PER_CALL === 0n ? 'NVIDIA free tier: $0 per call; token counts recorded for future pricing' : `configured ${cfg.NVIDIA_USD_MICRO_PER_CALL} micro-USD per call`,
  relevance: (['image', 'audio', 'video'] as const).map(summarize),
  duplicates: {
    threshold,
    duplicateSimilarity: dupRows.filter((d) => d.duplicate).map((d) => d.similarity),
    distinctSimilarity: dupRows.filter((d) => !d.duplicate).map((d) => d.similarity),
    correctAtThreshold: dupRows.filter((d) => (d.similarity >= threshold) === d.duplicate).length,
    pairs: dupRows.length,
  },
  errors: rows.filter((r) => r.gotRelevant !== null && r.gotRelevant !== r.expectRelevant).map((r) => ({ path: r.path, expected: r.expectRelevant, reason: r.reason })),
};
console.log(JSON.stringify(summary, null, 2));
if (flag('--out')) {
  const out = flag('--out')!;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ summary, rows, dupRows }, null, 2));
}
