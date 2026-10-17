import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../../apps/api/src/config.js';
import { createDb, schema } from '../../apps/api/src/db/index.js';
import { LocalStorage, type ObjectStorage } from '../../apps/api/src/storage/index.js';
import { ChainService } from '../../apps/api/src/chain.js';
import { buildApp } from '../../apps/api/src/app.js';
import type { AppContext } from '../../apps/api/src/context.js';
import { signDownloadToken } from '../../apps/api/src/lib/tokens.js';
import { multipartLayout } from '../../apps/api/src/lib/multipart.js';
import { processingAmount, paymentQuoteRate } from '../../apps/api/src/lib/payments.js';
import { usdc, formatUsdc, hostingFee, GIB } from '@edgebounty/pricing-engine';
import { specFor } from '../../apps/api/src/services/jobs.js';
import { geminiJudge } from '../../apps/api/src/services/l3.js';
import { bindDeployment } from '../../apps/api/src/lib/deployment-identity.js';
import { notify, retentionNoticeTick, operationRecorder } from '../../apps/api/src/services/operations.js';
import { zMicro } from '../../apps/api/src/lib/http.js';

let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildApp>>;
let close: () => Promise<void>;
const mint = Keypair.generate().publicKey;
beforeAll(async () => {
  const cfg = loadConfig({ NODE_ENV: 'test', PAYMENT_CURRENCY: 'USDC', PAYMENT_MINT: mint.toBase58(), WORKERS: 'off', STORAGE_DRIVER: 'r2', FREE_STORAGE_BYTES: String(1024 ** 4), MAX_UPLOAD_BYTES: String(1024 ** 4), MAX_FILE_BYTES: String(1024 ** 4), GATEWAY_SHARED_SECRET: 'g'.repeat(40), DOWNLOAD_GATEWAY_URL: 'https://downloads.example.com', SOLANA_RPC_URL: 'http://127.0.0.1:1' });
  const d = await createDb({ memory: true }); close = d.close;
  const storage: ObjectStorage = new LocalStorage('.data/test-no-transfer');
  Object.defineProperty(storage, 'kind', { value: 's3' });
  vi.spyOn(storage, 'initMultipart').mockResolvedValue('multipart');
  vi.spyOn(storage, 'completeMultipart').mockResolvedValue();
  vi.spyOn(storage, 'get').mockRejectedValue(new Error('Dataset bytes must not cross the API'));
  vi.spyOn(storage, 'presignPart').mockResolvedValue('https://storage.example.com/signed-part');
  ctx = { cfg, db: d.db, storage, chain: new ChainService(cfg), events: {} };
  vi.spyOn(ctx.chain.client, 'config').mockResolvedValue({ paymentMint: mint, feeBps: 600 } as any);
  app = await buildApp(ctx);
});
afterAll(async () => { await app.close(); await close(); });

async function signIn() {
  const kp = Keypair.generate();
  const ch = (await app.inject({ method: 'POST', url: '/auth/challenge', payload: { wallet: kp.publicKey.toBase58() } })).json();
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey));
  return (await app.inject({ method: 'POST', url: '/auth/verify', payload: { wallet: kp.publicKey.toBase58(), nonce: ch.nonce, signature } })).json().token;
}

it('deduplicates retention notices and restricts reading/acknowledging them to the owner', async () => {
  const owner = await signIn(), other = await signIn();
  const account = (await ctx.db.select().from(schema.accounts)).at(-2)!;
  const [allocation] = await ctx.db.insert(schema.storageAllocations).values({ accountId: account.id, gb: 10, termDays: 30, status: 'active', expiresAt: new Date(Date.now() + 86_400_000) }).returning();
  await retentionNoticeTick(ctx); await retentionNoticeTick(ctx);
  const notices = await ctx.db.select().from(schema.notifications).where(eq(schema.notifications.accountId, account.id));
  expect(notices.filter(n => n.dedupeKey === `storage-renewal:${allocation.id}`)).toHaveLength(1);
  const notice = notices[0];
  const otherList = (await app.inject({ url: '/me/notifications', headers: { authorization: `Bearer ${other}` } })).json();
  expect(otherList.some((n: any) => n.id === notice.id)).toBe(false);
  expect((await app.inject({ method: 'POST', url: `/me/notifications/${notice.id}/read`, headers: { authorization: `Bearer ${other}` } })).statusCode).toBe(404);
  expect((await app.inject({ method: 'POST', url: `/me/notifications/${notice.id}/read`, headers: { authorization: `Bearer ${owner}` } })).statusCode).toBe(200);
});

it('counts concurrent object operations without lost increments and rejects imprecise financial numbers', async () => {
  const record = operationRecorder(ctx.db, 'fixture');
  await Promise.all(Array.from({ length: 12 }, () => record('HeadObjectCommand', true)));
  const [counter] = await ctx.db.select().from(schema.operationCounters).where(eq(schema.operationCounters.key, 'fixture:HeadObjectCommand:ok'));
  expect(counter.count).toBe(12n);
  expect(zMicro.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
  expect(zMicro.safeParse('18446744073709551616').success).toBe(false);
  expect(zMicro.parse('18446744073709551615')).toBe(18446744073709551615n);
});

it('simulates a 500 GiB multipart upload and validates completion without reading dataset bytes', async () => {
  const token = await signIn();
  const headers = { authorization: `Bearer ${token}` };
  const version = (await app.inject({ method: 'POST', url: '/assets', headers, payload: { kind: 'dataset', name: '500 GiB fixture', purpose: 'listing' } })).json().version;
  const size = 500 * 1024 ** 3;
  const layout = multipartLayout(size, ctx.cfg.UPLOAD_PART_BYTES);
  expect(layout.partsTotal).toBeLessThanOrEqual(10_000);
  const up = (await app.inject({ method: 'POST', url: `/versions/${version.id}/uploads`, headers, payload: { path: 'large.bin', size, sha256: 'a'.repeat(64), mediaType: 'application/octet-stream' } })).json();
  expect(up.directParts).toBe(true);
  expect(up.partUrls).toBeNull();
  expect(up.partsTotal).toBe(layout.partsTotal);
  vi.spyOn(ctx.storage, 'listParts').mockResolvedValue(Array.from({ length: layout.partsTotal }, (_, i) => ({ partNo: i + 1, etag: 'etag', size: i < layout.partsTotal - 1 ? layout.partSize : size - i * layout.partSize })));
  vi.spyOn(ctx.storage, 'stat').mockResolvedValue({ size });
  const done = await app.inject({ method: 'POST', url: `/uploads/${up.uploadId}/complete`, headers, payload: {} });
  expect(done.statusCode).toBe(200);
  expect(done.json().size).toBe(size);
  expect(ctx.storage.get).not.toHaveBeenCalled();
  const [v] = await ctx.db.select().from(schema.assetVersions).where(eq(schema.assetVersions.id, version.id));
  expect(v.metadata).toMatchObject({ hashVerification: 'uploader-declared' });
  expect((await app.inject({ method: 'POST', url: `/versions/${version.id}/finalize`, headers, payload: {} })).statusCode).toBe(200);
  const quote = (await app.inject({ method: 'POST', url: '/verification/quote', headers, payload: { assetVersionId: version.id, level: 'L2' } })).json();
  expect(quote.execution.supported).toBe(false);
  const beforeInvoices = (await ctx.db.select().from(schema.invoices)).length;
  expect((await app.inject({ method: 'POST', url: '/verification/jobs', headers, payload: { assetVersionId: version.id, level: 'L2' } })).statusCode).toBe(409);
  expect((await ctx.db.select().from(schema.invoices)).length).toBe(beforeInvoices);
  const [asset] = await ctx.db.select().from(schema.assets).where(eq(schema.assets.id, v.assetId));
  const benchmarkId = randomUUID();
  await ctx.db.insert(schema.benchmarks).values({ id: benchmarkId, version: 1, task: 'fixture', description: 'private capacity fixture', license: 'fixture', methodology: 'fixture', inputSpec: {}, ownerId: asset.ownerId, private: true, assetVersionId: version.id });
  await ctx.db.update(schema.assetVersions).set({ totalSize: 128 * 1024 ** 2 + 1 }).where(eq(schema.assetVersions.id, version.id));
  const combined = (await app.inject({ method: 'POST', url: '/verification/quote', headers, payload: { assetVersionId: version.id, level: 'L2', benchmarkId } })).json();
  expect(combined.execution.supported).toBe(false);
  expect(combined.execution.totalMaterializeBytes).toBe(256 * 1024 ** 2 + 2);
  expect((await app.inject({ method: 'POST', url: '/verification/jobs', headers, payload: { assetVersionId: version.id, level: 'L2', benchmarkId } })).statusCode).toBe(409);
  expect((await ctx.db.select().from(schema.invoices)).length).toBe(beforeInvoices);
});

async function deliveryFixture(allowance = 100n) {
  const wallet = Keypair.generate().publicKey.toBase58();
  const [a] = await ctx.db.insert(schema.accounts).values({ wallet, alias: 'buyer' }).returning();
  const versionId = randomUUID();
  const [f] = await ctx.db.insert(schema.assetFiles).values({ versionId, path: 'data.bin', size: 100, sha256: 'b'.repeat(64), mediaType: 'application/octet-stream', objectKey: 'r2/tenants/buyer/data' }).returning();
  const [ent] = await ctx.db.insert(schema.deliveryEntitlements).values({ orderId: randomUUID(), buyerId: a.id, buyerWallet: wallet, assetVersionId: versionId, licenseReceipt: 'fixture', allowanceBytes: allowance, accessEndsAt: new Date(Date.now() + 60_000) }).returning();
  const token = signDownloadToken(ctx.cfg.DOWNLOAD_TOKEN_SECRET, { s: 'delivery', g: ent.id, f: f.id, w: wallet, x: Math.floor(Date.now()/1000) + 60 });
  return { ent, url: `/download/${token}` };
}

it('redirects R2 bytes to the Worker; parallel range requests cannot overspend quota', async () => {
  const fixture = await deliveryFixture();
  expect((await app.inject({ url: fixture.url })).statusCode).toBe(307);
  const headers = { 'x-gateway-auth': ctx.cfg.GATEWAY_SHARED_SECRET!, range: 'bytes=0-59' };
  const requests = await Promise.all([1,2].map(() => app.inject({ url: fixture.url, headers: { ...headers, 'x-transfer-id': randomUUID() } })));
  expect(requests.map((r) => r.statusCode).sort()).toEqual([200,402]);
  const [ent] = await ctx.db.select().from(schema.deliveryEntitlements).where(eq(schema.deliveryEntitlements.id, fixture.ent.id));
  expect(ent.bytesServed).toBe(60n);
  expect(ctx.storage.get).not.toHaveBeenCalled();
});

it('rejects unauthorized gateway calls and request replay, and refunds failed reads once', async () => {
  const fixture = await deliveryFixture(); const id = randomUUID();
  const headers = { 'x-gateway-auth': ctx.cfg.GATEWAY_SHARED_SECRET!, 'x-transfer-id': id };
  expect((await app.inject({ url: fixture.url, headers: { ...headers, 'x-gateway-auth': 'wrong' } })).statusCode).toBe(401);
  expect((await app.inject({ url: fixture.url, headers })).statusCode).toBe(200);
  expect((await app.inject({ url: fixture.url, headers })).statusCode).toBe(409);
  for (let i=0;i<2;i++) expect((await app.inject({ method: 'POST', url: `/gateway/transfers/${id}/failed`, headers })).statusCode).toBe(200);
  const [ent] = await ctx.db.select().from(schema.deliveryEntitlements).where(eq(schema.deliveryEntitlements.id, fixture.ent.id));
  expect(ent.bytesServed).toBe(0n);
});

it('keeps USDC base units exact and invalidates AI cache when the model changes', () => {
  expect(usdc('100.000001')).toBe(100_000_001n);
  expect(formatUsdc(100_000_001n)).toBe('100.000001');
  expect(() => usdc('0.0000001')).toThrow();
  expect(paymentQuoteRate(ctx.cfg)).toBe(1_000_000_000n);
  expect(processingAmount(ctx.cfg, 5_000_000n)).toBe(750_000n);
  expect(hostingFee(500n * GIB, 1n)).toBe(22_500_000n);
  const a = { ...ctx.cfg, AI_PROVIDER: 'gemini' as const, GEMINI_API_KEY: 'test' };
  expect(specFor('L3', null, null, a).specHash).not.toBe(specFor('L3', null, null, { ...a, GEMINI_MODEL: 'changed-model' }).specHash);
});

it('parses Gemini structured review and records actual token counts', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"relevant":true,"label_matches":null}' }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 } }), { status: 200 }));
  const r = await geminiJudge({ ...ctx.cfg, GEMINI_API_KEY: 'test' }, fetcher).judge('AA==', 'image/png', 'cats');
  expect(r.out?.relevant).toBe(true); expect(r.inputTokens).toBe(20); expect(r.outputTokens).toBe(10);
});

it('binds a fresh USDC database to its chain and refuses currency or genesis changes', async () => {
  const d = await createDb({ memory: true });
  try {
    await bindDeployment(d.db, ctx.cfg, 'genesis-one', 'program');
    await bindDeployment(d.db, ctx.cfg, 'genesis-one', 'program');
    await expect(bindDeployment(d.db, ctx.cfg, 'genesis-two', 'program')).rejects.toThrow(/identity mismatch/);
    await expect(bindDeployment(d.db, { ...ctx.cfg, PAYMENT_CURRENCY: 'SOL' }, 'genesis-one', 'program')).rejects.toThrow(/identity mismatch/);
  } finally { await d.close(); }
});

it('creates one prepaid verification invoice for concurrent requests for unchanged content', async () => {
  const token = await signIn(); const headers = { authorization: `Bearer ${token}` };
  const version = (await app.inject({ method: 'POST', url: '/assets', headers, payload: { kind: 'dataset', name: 'verification fixture', purpose: 'listing' } })).json().version;
  await ctx.db.update(schema.assetVersions).set({ status: 'finalized', totalSize: 100, fileCount: 1, commitment: 'c'.repeat(64) }).where(eq(schema.assetVersions.id, version.id));
  const responses = await Promise.all([1,2].map(() => app.inject({ method: 'POST', url: '/verification/jobs', headers, payload: { assetVersionId: version.id, level: 'L2' } })));
  expect(responses.map((r) => r.statusCode)).toEqual([200,200]);
  expect(responses[0].json().job.id).toBe(responses[1].json().job.id);
  expect(responses[0].json().invoice.id).toBe(responses[1].json().invoice.id);
  const jobs = await ctx.db.select().from(schema.verificationJobs).where(eq(schema.verificationJobs.assetVersionId, version.id));
  expect(jobs).toHaveLength(1);
});
