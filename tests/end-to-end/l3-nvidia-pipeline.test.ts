/** Full Level 3 pipeline with the live NVIDIA provider. Needs localnet + NVIDIA_API_KEY. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { drainJobs } from '../../apps/api/src/services/jobs.js';
import { UNIT, localnetAvailable } from './helpers.js';
import { actor, hex, ok, png, send, startHarness, uploadAsset, type Harness } from './api-harness.js';

const envFile = join(import.meta.dirname, '..', '..', 'apps', 'api', '.env');
if (!process.env.NVIDIA_API_KEY && existsSync(envFile)) process.loadEnvFile(envFile);
const ready = (await localnetAvailable()) && !!process.env.NVIDIA_API_KEY;

describe.skipIf(!ready)('Level 3 with NVIDIA (live)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ AI_PROVIDER: 'nvidia', NVIDIA_API_KEY: process.env.NVIDIA_API_KEY! });
  });
  afterAll(async () => h?.close());

  it('pays for an L3 job and gets a relevance estimate plus an AI explanation', async () => {
    const user = await actor(h, 20n * UNIT);
    const asset = await uploadAsset(h, user, 'dataset', 'verification', Array.from({ length: 4 }, (_, i) => ({ path: `p/${i}.png`, data: png(96, 96, 70 + i * 30), mediaType: 'image/png' })));
    const created = await ok(h, user, 'POST', '/verification/jobs', {
      assetVersionId: asset.versionId,
      level: 'L3',
      criteria: { kind: 'image_dataset', minImages: 1, minRelevanceBps: 0, relevancePrompt: 'real photographs of cats' },
    });
    await send(h, user, await h.p.client.payService(user.kp.publicKey, hex(created.invoice.reference), created.invoice.serviceKind, BigInt(created.invoice.amountMicro)));
    await ok(h, user, 'POST', `/invoices/${created.invoice.id}/confirm`);
    await drainJobs(h.ctx);
    const job = await ok(h, user, 'GET', `/verification/jobs/${created.job.id}`);
    expect(job.status).toBe('completed');
    const rep = job.result.report;
    expect(rep.level).toBe('L3');
    expect(rep.tools.map((t: any) => t.name)).toContain('meta/llama-3.2-11b-vision-instruct');
    expect(rep.datasetMetrics.relevance?.method ?? rep.limitations.join(' ')).toMatch(/llama-3.2-11b-vision|undetermined|untested/);
    expect(rep.summary).toMatch(/^AI-generated explanation/);
    console.log('relevance:', JSON.stringify(rep.datasetMetrics.relevance), '\nsummary:', rep.summary);
  }, 300_000);
});
