import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, schema } from '../db/index.js';
import type { AppContext } from '../context.js';
import { requireListingVerification, requestVerificationQuote } from './verification-policy.js';
import { loadConfig } from '../config.js';

let ctx: AppContext;
let close: () => Promise<void>;
beforeAll(async () => {
  const database = await createDb({ memory: true });
  ctx = { db: database.db, cfg: loadConfig({ NODE_ENV: 'test', MALWARE_SCAN_REQUIRED: '0' }) } as AppContext;
  close = database.close;
});
afterAll(async () => close());

async function result(versionId: string, level: 'L1' | 'L2' | 'L3', status: 'completed' | 'awaiting_payment', passed: boolean) {
  const [job] = await ctx.db.insert(schema.verificationJobs).values({ assetVersionId: versionId, requesterId: randomUUID(), kind: 'standalone', level, status, specHash: '0'.repeat(64), budget: { maxSpend: '1', maxItems: 1, maxSeconds: 60, maxApiCalls: 0 } }).returning();
  await ctx.db.insert(schema.verificationResults).values({ jobId: job.id, report: {}, reportHash: '0'.repeat(64), passed });
}

describe('listing verification gate', () => {
  it('rejects missing, free, unpaid, failed, and different-version reports', async () => {
    const version = randomUUID();
    await expect(requireListingVerification(ctx, version)).rejects.toThrow('Complete paid verification');
    await result(version, 'L1', 'completed', true);
    await result(version, 'L2', 'awaiting_payment', true);
    await result(version, 'L3', 'completed', false);
    await result(randomUUID(), 'L2', 'completed', true);
    await expect(requireListingVerification(ctx, version)).rejects.toThrow('Complete paid verification');
  });
  it('accepts a completed passing report for the exact version', async () => {
    const version = randomUUID();
    await result(version, 'L2', 'completed', true);
    await expect(requireListingVerification(ctx, version)).resolves.toBeUndefined();
  });
  it('quarantines publication until the exact commitment has a clean malware scan', async () => {
    const versionId = randomUUID();
    await result(versionId, 'L2', 'completed', true);
    ctx.cfg.MALWARE_SCAN_REQUIRED = '1';
    await expect(requireListingVerification(ctx, versionId)).rejects.toThrow('malware scanning');
    const [asset] = await ctx.db.insert(schema.assets).values({ ownerId: randomUUID(), name: 'private fixture', kind: 'dataset', purpose: 'listing' }).returning();
    await ctx.db.insert(schema.assetVersions).values({ id: versionId, assetId: asset.id, version: 1, commitment: 'a'.repeat(64), metadata: { malware: { status: 'clean', policy: 'clamav-bounded/1', commitment: 'b'.repeat(64) } } });
    await expect(requireListingVerification(ctx, versionId)).rejects.toThrow('malware scanning');
    ctx.cfg.MALWARE_SCAN_REQUIRED = '0';
  });
});

it('locks request rates by workload, including each agreed correction round', () => {
  const scope = { kind: 'image_dataset', minImages: 1000 };
  const initial = requestVerificationQuote(scope, 0);
  expect(initial.fee).toBe(5_000_000n);
  expect(requestVerificationQuote(scope, 2)).toEqual({ fee: initial.fee * 3n, rounds: 3 });
  expect(requestVerificationQuote({ kind: 'image_dataset', minImages: 10_000 }, 0).fee).toBeGreaterThan(initial.fee);
});
