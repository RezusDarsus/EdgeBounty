import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';

const DIMENSIONS = 2048;
export function vectorLiteral(values: unknown): string {
  if (!Array.isArray(values) || values.length !== DIMENSIONS || values.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw new Error('Invalid embedding vector');
  const norm = Math.sqrt(values.reduce((s, n) => s + n * n, 0));
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Invalid zero or overflowing embedding');
  return `[${values.map(n => n / norm).join(',')}]`;
}

export async function initializeSemanticIndex(db: Db, cfg: Config) {
  if (cfg.SEMANTIC_DUPLICATES !== 'on') return;
  if (!cfg.DATABASE_URL || !cfg.NVIDIA_API_KEY) throw new Error('Semantic checks require PostgreSQL/pgvector and NVIDIA');
  await db.execute(sql`CREATE TABLE IF NOT EXISTS semantic_samples (version_id uuid NOT NULL, owner_id uuid NOT NULL, model text NOT NULL, input_hash text NOT NULL, embedding vector NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(version_id, model, input_hash))`);
  // Widen the first deployment's fixed dimension without changing stored vector values.
  await db.execute(sql`ALTER TABLE semantic_samples ALTER COLUMN embedding TYPE vector`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS semantic_samples_owner ON semantic_samples(owner_id, model)`);
}

export async function embedText(cfg: Config, text: string, fetcher: typeof fetch = fetch) {
  if (!cfg.NVIDIA_API_KEY) throw new Error('NVIDIA embedding credential is missing');
  const response = await fetcher(`${cfg.NVIDIA_BASE_URL}/embeddings`, {
    method: 'POST', headers: { authorization: `Bearer ${cfg.NVIDIA_API_KEY}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ model: cfg.NVIDIA_EMBEDDING_MODEL, input: [text.slice(0, 8192)], input_type: 'passage', truncate: 'END', encoding_format: 'float' }),
  });
  if (!response.ok) throw new Error(`NVIDIA embedding request failed (${response.status})`);
  const json = await response.json() as any;
  return { vector: vectorLiteral(json.data?.[0]?.embedding), inputTokens: Number(json.usage?.prompt_tokens ?? 0) };
}

/** Bounded text-prefix heuristic; private samples are compared only within their owner's account. */
export async function checkTextDuplicates(ctx: AppContext, versionId: string, ownerId: string, inDir: string, paths: string[]) {
  let sample = '';
  for (const path of paths.filter(p => /\.(txt|csv|json|jsonl|md|tsv)$/i.test(p)).slice(0, 8)) {
    const handle = await open(join(inDir, ...path.split('/')), 'r');
    try {
      const b = Buffer.alloc(Math.min(2048, 8192 - Buffer.byteLength(sample)));
      if (!b.length) break;
      const { bytesRead } = await handle.read(b, 0, b.length, 0);
      sample += b.subarray(0, bytesRead).toString('utf8') + '\n';
    } finally { await handle.close(); }
    if (Buffer.byteLength(sample) >= 8192) break;
  }
  if (!sample.trim()) return { matches: [], calls: 0, inputTokens: 0, sampledBytes: 0 };
  const model = ctx.cfg.NVIDIA_EMBEDDING_MODEL;
  const hash = createHash('sha256').update(sample).digest('hex');
  const raw = await ctx.db.execute(sql`SELECT embedding::text AS vector FROM semantic_samples WHERE version_id=${versionId}::uuid AND owner_id=${ownerId}::uuid AND model=${model} AND input_hash=${hash}`);
  const rows = (raw as any).rows ?? raw;
  let vector = rows[0]?.vector as string | undefined;
  let calls = 0, inputTokens = 0;
  if (!vector) {
    const embedded = await embedText(ctx.cfg, sample);
    vector = embedded.vector; inputTokens = embedded.inputTokens; calls = 1;
    await ctx.db.execute(sql`INSERT INTO semantic_samples(version_id, owner_id, model, input_hash, embedding) VALUES (${versionId}::uuid, ${ownerId}::uuid, ${model}, ${hash}, ${vector}::vector) ON CONFLICT DO NOTHING`);
  }
  const found = await ctx.db.execute(sql`SELECT s.version_id, 1 - (s.embedding <=> ${vector}::vector) AS similarity FROM semantic_samples s JOIN asset_versions v ON v.id=s.version_id JOIN assets a ON a.id=v.asset_id WHERE s.owner_id=${ownerId}::uuid AND a.owner_id=${ownerId}::uuid AND a.deleted_at IS NULL AND s.model=${model} AND s.version_id<>${versionId}::uuid AND 1 - (s.embedding <=> ${vector}::vector) >= 0.95 ORDER BY s.embedding <=> ${vector}::vector LIMIT 5`);
  return { matches: ((found as any).rows ?? found) as { version_id: string; similarity: number }[], calls, inputTokens, sampledBytes: Buffer.byteLength(sample) };
}

export async function embedImage(cfg: Config, jpegB64: string, fetcher: typeof fetch = fetch) {
  if (!cfg.NVIDIA_API_KEY) throw new Error('NVIDIA embedding credential is missing');
  const response = await fetcher(`${cfg.NVIDIA_BASE_URL}/embeddings`, {
    method: 'POST', headers: { authorization: `Bearer ${cfg.NVIDIA_API_KEY}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(60_000),
    // this model takes a plain data-URL string; the {modality, content} object form returns HTTP 500 (checked 2026-10-18)
    body: JSON.stringify({ model: cfg.NVIDIA_IMAGE_EMBEDDING_MODEL, input: [`data:image/jpeg;base64,${jpegB64}`], input_type: 'passage', encoding_format: 'float' }),
  });
  if (!response.ok) throw new Error(`NVIDIA image embedding request failed (${response.status})`);
  const json = await response.json() as any;
  return { vector: vectorLiteral(json.data?.[0]?.embedding), inputTokens: Number(json.usage?.prompt_tokens ?? 0) };
}

export const IMAGE_DUPLICATE_SAMPLES = 4;
const IMAGE_SIMILARITY = 0.97;

/**
 * Cross-version near-duplicate heuristic for images: embeds up to four of the job's downscaled AI
 * samples and compares them with earlier versions in the same owner's account only.
 */
export async function checkImageDuplicates(ctx: AppContext, versionId: string, ownerId: string, samplePaths: string[], maxCalls: number, fetcher: typeof fetch = fetch) {
  const model = ctx.cfg.NVIDIA_IMAGE_EMBEDDING_MODEL;
  const matches = new Map<string, { similarity: number; samples: number }>();
  let calls = 0, inputTokens = 0, compared = 0;
  for (const path of samplePaths.slice(0, Math.min(IMAGE_DUPLICATE_SAMPLES, Math.max(0, maxCalls)))) {
    const bytes = await readFile(path).catch(() => null);
    if (!bytes) continue;
    const hash = createHash('sha256').update(bytes).digest('hex');
    const raw = await ctx.db.execute(sql`SELECT embedding::text AS vector FROM semantic_samples WHERE version_id=${versionId}::uuid AND owner_id=${ownerId}::uuid AND model=${model} AND input_hash=${hash}`);
    let vector = (((raw as any).rows ?? raw)[0]?.vector) as string | undefined;
    if (!vector) {
      calls++;
      const embedded = await embedImage(ctx.cfg, bytes.toString('base64'), fetcher);
      vector = embedded.vector; inputTokens += embedded.inputTokens;
      await ctx.db.execute(sql`INSERT INTO semantic_samples(version_id, owner_id, model, input_hash, embedding) VALUES (${versionId}::uuid, ${ownerId}::uuid, ${model}, ${hash}, ${vector}::vector) ON CONFLICT DO NOTHING`);
    }
    compared++;
    const found = await ctx.db.execute(sql`SELECT s.version_id, max(1 - (s.embedding <=> ${vector}::vector)) AS similarity FROM semantic_samples s JOIN asset_versions v ON v.id=s.version_id JOIN assets a ON a.id=v.asset_id WHERE s.owner_id=${ownerId}::uuid AND a.owner_id=${ownerId}::uuid AND a.deleted_at IS NULL AND s.model=${model} AND s.version_id<>${versionId}::uuid AND 1 - (s.embedding <=> ${vector}::vector) >= ${IMAGE_SIMILARITY} GROUP BY s.version_id ORDER BY 2 DESC LIMIT 5`);
    for (const m of ((found as any).rows ?? found) as { version_id: string; similarity: number }[]) {
      const prev = matches.get(m.version_id);
      matches.set(m.version_id, { similarity: Math.max(prev?.similarity ?? 0, Number(m.similarity)), samples: (prev?.samples ?? 0) + 1 });
    }
  }
  return { matches: [...matches].map(([version_id, m]) => ({ version_id, ...m })), calls, inputTokens, compared };
}
