import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../apps/api/src/config.js';
import { createDb } from '../apps/api/src/db/index.js';
import { embedText, initializeSemanticIndex } from '../apps/api/src/services/semantic.js';
process.loadEnvFile('apps/api/.env');
const cfg = loadConfig({ SEMANTIC_DUPLICATES: 'on' });
const { db, close } = await createDb({ databaseUrl: cfg.DATABASE_URL });
try {
  await initializeSemanticIndex(db, cfg);
  const embedded = await embedText(cfg, 'A synthetic dataset of blue squares and red circles for a smoke test.');
  const id = randomUUID(), owner = randomUUID();
  await db.transaction(async tx => {
    await tx.execute(sql`INSERT INTO semantic_samples(version_id,owner_id,model,input_hash,embedding) VALUES (${id}::uuid,${owner}::uuid,${cfg.NVIDIA_EMBEDDING_MODEL},'smoke-test',${embedded.vector}::vector)`);
    const result = await tx.execute(sql`SELECT 1-(embedding <=> ${embedded.vector}::vector) AS similarity FROM semantic_samples WHERE version_id=${id}::uuid`);
    const rows = (result as any).rows ?? result;
    assert(Number(rows[0].similarity) > 0.9999);
    await tx.execute(sql`DELETE FROM semantic_samples WHERE version_id=${id}::uuid`);
  });
  console.log(JSON.stringify({ nvidiaEmbedding: true, dimensions: 2048, pgvectorSimilarity: true, syntheticFixtureRemoved: true, inputTokens: embedded.inputTokens }));
} finally { await close(); }
