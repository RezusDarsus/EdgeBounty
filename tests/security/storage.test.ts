/** Storage quotas, upload reservations, tenant isolation and the S3 driver (no validator, no AWS account required). */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NATIVE_MINT } from '@solana/spl-token';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { eq } from 'drizzle-orm';
import { Keypair } from '@solana/web3.js';
import { loadConfig } from '../../apps/api/src/config.js';
import { createDb, schema } from '../../apps/api/src/db/index.js';
import { createStorage, keyBelongsTo, s3Region, S3Storage, storageCategory } from '../../apps/api/src/storage/index.js';
import { ChainService } from '../../apps/api/src/chain.js';
import { buildApp } from '../../apps/api/src/app.js';
import { seed } from '../../apps/api/src/seed.js';
import { purgeExpiredUploads } from '../../apps/api/src/routes/assets.js';
import type { AppContext } from '../../apps/api/src/context.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let ctx: AppContext;
let close: () => Promise<void>;

it('keeps transfers on the authenticated API when bucket CORS is unavailable', async () => {
  const cfg = loadConfig({ STORAGE_DRIVER: 's3', S3_BUCKET: 'private-test-bucket', S3_REGION: 'eu-north-1', S3_DIRECT_TRANSFERS: '0' });
  const storage = new S3Storage(cfg);
  expect(await storage.presignPart('accounts/test/object', 'upload', 1, 900)).toBeNull();
  expect(await storage.presignGet('accounts/test/object', 300)).toBeNull();
});

beforeAll(async () => {
  const cfg = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: mkdtempSync(join(tmpdir(), 'eb-storage-')),
    WORKERS: 'off',
    UPLOAD_PART_BYTES: '1024',
    FREE_STORAGE_BYTES: '20000',
    SUBMISSION_MAX_BYTES: '30000',
    STORAGE_PLANS_GB: '10, 50',
    SOLANA_RPC_URL: 'http://127.0.0.1:1',
  });
  const d = await createDb({ memory: true });
  await seed(d.db);
  ctx = { cfg, db: d.db, storage: createStorage(cfg), chain: new ChainService(cfg), events: {} };
  vi.spyOn(ctx.chain.client, 'config').mockResolvedValue({ paymentMint: NATIVE_MINT } as any);
  app = await buildApp(ctx);
  close = d.close;
});
afterAll(async () => {
  await app.close();
  await close();
});

const req = (method: string, url: string, token?: string, payload?: unknown) =>
  app.inject({ method: method as any, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload: payload as any } : {}) });

async function signIn() {
  const kp = Keypair.generate();
  const ch = (await req('POST', '/auth/challenge', undefined, { wallet: kp.publicKey.toBase58() })).json();
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey));
  return (await req('POST', '/auth/verify', undefined, { wallet: kp.publicKey.toBase58(), nonce: ch.nonce, signature })).json().token as string;
}
const newVersion = async (token: string, purpose: string) => (await req('POST', '/assets', token, { kind: 'dataset', name: 'x', purpose })).json().version.id as string;
const startUpload = (token: string, versionId: string, path: string, size: number) =>
  req('POST', `/versions/${versionId}/uploads`, token, { path, size, sha256: '0'.repeat(64), mediaType: 'application/octet-stream' });

describe('storage quota & reservations', () => {
  it('open uploads reserve quota atomically: concurrent uploads cannot jointly exceed it', async () => {
    const token = await signIn();
    const v = await newVersion(token, 'listing');
    // free tier is 20 000 bytes; two parallel 12 000-byte reservations -> exactly one wins
    const results = await Promise.all([startUpload(token, v, 'a.bin', 12_000), startUpload(token, v, 'b.bin', 12_000)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 402]);
    expect(results.find((r) => r.statusCode === 402)!.json().error).toBe('quota_exceeded');
    expect((await req('GET', '/storage', token)).json().usedBytes).toBe(12_000);
  });

  it('aborting or expiring an upload releases its reservation', async () => {
    const token = await signIn();
    const v = await newVersion(token, 'listing');
    const up = (await startUpload(token, v, 'a.bin', 15_000)).json();
    expect((await startUpload(token, v, 'b.bin', 15_000)).statusCode).toBe(402);
    expect((await req('DELETE', `/uploads/${up.uploadId}`, token)).statusCode).toBe(200);
    const up2 = (await startUpload(token, v, 'b.bin', 15_000)).json();
    expect(up2.uploadId).toBeTruthy();
    // expiry: backdate, purge, and the space is free again
    await ctx.db.update(schema.uploads).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.uploads.id, up2.uploadId));
    expect((await req('GET', '/storage', token)).json().usedBytes).toBe(0);
    expect(await purgeExpiredUploads(ctx)).toBeGreaterThanOrEqual(1);
    const [row] = await ctx.db.select().from(schema.uploads).where(eq(schema.uploads.id, up2.uploadId));
    expect(row.status).toBe('aborted');
  });

  it('bounty submissions do not use the paid quota but are capped per submission', async () => {
    const token = await signIn();
    const sub = await newVersion(token, 'submission');
    // 25 000 > free quota (20 000) but within the 30 000 submission cap
    expect((await startUpload(token, sub, 'a.bin', 25_000)).statusCode).toBe(200);
    expect((await req('GET', '/storage', token)).json().usedBytes).toBe(0);
    expect((await startUpload(token, await newVersion(token, 'submission'), 'big.bin', 31_000)).statusCode).toBe(400);
    // customer storage still has its full quota
    expect((await startUpload(token, await newVersion(token, 'listing'), 'c.bin', 19_000)).statusCode).toBe(200);
  });

  it('lists the configured monthly plans with the MVP free tier', async () => {
    const r = (await req('GET', '/storage/plans')).json();
    expect(r.freeBytes).toBe(20_000);
    expect(r.plans.map((p: any) => [p.gb, p.termDays])).toEqual([[10, 30], [50, 30]]);
    expect(BigInt(r.plans[1].priceMicro)).toBeGreaterThan(BigInt(r.plans[0].priceMicro));
  });
});

describe('tenant isolation', () => {
  it('objects live under the owner tenant prefix, split by category', async () => {
    const token = await signIn();
    const cust = (await startUpload(token, await newVersion(token, 'listing'), 'a.bin', 100)).json();
    const sub = (await startUpload(token, await newVersion(token, 'submission'), 'b.bin', 100)).json();
    const [c] = await ctx.db.select().from(schema.uploads).where(eq(schema.uploads.id, cust.uploadId));
    const [s] = await ctx.db.select().from(schema.uploads).where(eq(schema.uploads.id, sub.uploadId));
    expect(c.objectKey).toMatch(new RegExp(`^tenants/${c.accountId}/customer/`));
    expect(s.objectKey).toMatch(new RegExp(`^tenants/${s.accountId}/workflow/`));
    expect([c.category, s.category]).toEqual(['customer', 'workflow']);
  });

  it('another account cannot read, write, complete or abort an upload', async () => {
    const owner = await signIn();
    const intruder = await signIn();
    const up = (await startUpload(owner, await newVersion(owner, 'listing'), 'a.bin', 100)).json();
    const part = await app.inject({ method: 'PUT', url: `/uploads/${up.uploadId}/parts/1`, headers: { authorization: `Bearer ${intruder}`, 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(100) });
    expect(part.statusCode).toBe(403);
    expect((await req('GET', `/uploads/${up.uploadId}`, intruder)).statusCode).toBe(403);
    expect((await req('POST', `/uploads/${up.uploadId}/complete`, intruder, {})).statusCode).toBe(403);
    expect((await req('DELETE', `/uploads/${up.uploadId}`, intruder)).statusCode).toBe(403);
    // nor upload into someone else's version
    const v = await newVersion(owner, 'listing');
    expect((await startUpload(intruder, v, 'x.bin', 10)).statusCode).toBe(403);
  });

  it('rejects an upload row whose key points outside the caller tenant', async () => {
    const token = await signIn();
    const up = (await startUpload(token, await newVersion(token, 'listing'), 'a.bin', 100)).json();
    await ctx.db.update(schema.uploads).set({ objectKey: 'tenants/00000000-0000-0000-0000-000000000000/customer/x' }).where(eq(schema.uploads.id, up.uploadId));
    expect((await req('GET', `/uploads/${up.uploadId}`, token)).statusCode).toBe(403);
    expect(keyBelongsTo('tenants/a/customer/x', 'a')).toBe(true);
    expect(keyBelongsTo('tenants/ab/customer/x', 'a')).toBe(false);
  });
});

describe('S3 driver', () => {
  const base = { NODE_ENV: 'test', STORAGE_DRIVER: 's3', S3_BUCKET: 'edgebounty-uploads-test' } as const;

  it('uses the default AWS credential chain (EC2 instance role) when no static keys are set', () => {
    expect(createStorage(loadConfig({ ...base })).kind).toBe('s3');
    // R2-style custom endpoints still need explicit keys
    expect(() => createStorage(loadConfig({ ...base, S3_ENDPOINT: 'https://x.r2.cloudflarestorage.com' }))).toThrow(/S3_ACCESS_KEY_ID/);
    expect(() => createStorage(loadConfig({ NODE_ENV: 'test', STORAGE_DRIVER: 's3' }))).toThrow(/S3_BUCKET/);
  });

  it('resolves the region from S3_REGION, then AWS_REGION', () => {
    const prev = process.env.AWS_REGION;
    process.env.AWS_REGION = 'eu-north-1';
    try {
      expect(s3Region(loadConfig({ ...base }))).toBe('eu-north-1');
      expect(s3Region(loadConfig({ ...base, S3_REGION: 'eu-west-1' }))).toBe('eu-west-1');
    } finally {
      if (prev === undefined) delete process.env.AWS_REGION;
      else process.env.AWS_REGION = prev;
    }
  });

  it('presigns short-lived, key-scoped part and download URLs', async () => {
    const s = new S3Storage(loadConfig({ ...base, S3_REGION: 'eu-north-1', S3_ACCESS_KEY_ID: 'AKIATEST', S3_SECRET_ACCESS_KEY: 'test-secret' }));
    const key = 'tenants/acc/customer/a/v/obj';
    const get = new URL((await s.presignGet(key, 300, 'data "1".csv'))!);
    expect(get.hostname).toContain('edgebounty-uploads-test');
    expect(get.hostname).toContain('eu-north-1');
    expect(get.pathname).toBe(`/${key}`);
    expect(get.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(get.searchParams.get('response-content-disposition')).toBe('attachment; filename="data _1_.csv"');
    const part = new URL((await s.presignPart(key, 'upload-1', 3, 900))!);
    expect(part.searchParams.get('partNumber')).toBe('3');
    expect(part.searchParams.get('uploadId')).toBe('upload-1');
    expect(part.searchParams.get('X-Amz-Expires')).toBe('900');
  });

  it('classifies purposes into the two storage categories', () => {
    expect(['submission', 'evidence', 'failure_example', 'verification'].map(storageCategory)).toEqual(['workflow', 'workflow', 'workflow', 'workflow']);
    expect(['listing', 'storage', 'benchmark'].map(storageCategory)).toEqual(['customer', 'customer', 'customer']);
  });
});
