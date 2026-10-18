/**
 * Marketplace hosting, entitlement, download-metering, verification-reuse and migration guarantees.
 * Off-chain only (no validator): invoices are marked paid through the same hook confirmInvoice uses.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { get as httpGet } from 'node:http';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { and, eq, sql } from 'drizzle-orm';
import { Keypair } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { GIB, MONTH_SECS, hostingFee, usdToLamports } from '@edgebounty/pricing-engine';
import { loadConfig } from '../../apps/api/src/config.js';
import { createDb, schema } from '../../apps/api/src/db/index.js';
import { createStorage } from '../../apps/api/src/storage/index.js';
import { ChainService } from '../../apps/api/src/chain.js';
import { buildApp } from '../../apps/api/src/app.js';
import { seed } from '../../apps/api/src/seed.js';
import { signDownloadToken } from '../../apps/api/src/lib/tokens.js';
import { issueSession } from '../../apps/api/src/auth/siws.js';
import {
  applyPaidInvoice,
  createCheckout,
  createSellerHostingInvoice,
  delistUnfundedListings,
  deliveryAccess,
  ensureListingCoverage,
  grantFreeCoverage,
  versionCoverage,
  versionHostingActive,
} from '../../apps/api/src/lib/billing.js';
import { storageUsedBytes } from '../../apps/api/src/lib/assets.js';
import { claimNextJob, createJob, drainJobs, runJob } from '../../apps/api/src/services/jobs.js';
import type { AppContext } from '../../apps/api/src/context.js';
import { png, sha256 } from '../end-to-end/api-harness.js';

const SOL_USD = 150_000_000n;
let app: Awaited<ReturnType<typeof buildApp>>;
let ctx: AppContext;
let close: () => Promise<void>;

beforeAll(async () => {
  const cfg = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: mkdtempSync(join(tmpdir(), 'eb-billing-')),
    WORKERS: 'off',
    UPLOAD_PART_BYTES: '4096',
    FREE_STORAGE_BYTES: '50000',
    FREE_RETENTION_DAYS: '90',
    LISTING_MIN_COVERAGE_DAYS: '30',
    SOL_USD_MICRO: String(SOL_USD),
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

// ------------------------------------------------------------------ fixtures

async function account() {
  const [a] = await ctx.db.insert(schema.accounts).values({ wallet: Keypair.generate().publicKey.toBase58(), alias: `u-${randomUUID().slice(0, 8)}` }).returning();
  return a;
}

/** A finalized dataset version with one stored file of `bytes` random bytes. */
async function dataset(ownerId: string, bytes: number, purpose: 'listing' | 'storage' = 'listing') {
  const [a] = await ctx.db.insert(schema.assets).values({ ownerId, kind: 'dataset', name: 'd', purpose }).returning();
  const [v] = await ctx.db.insert(schema.assetVersions).values({ assetId: a.id, version: 1, status: 'finalized', totalSize: bytes, fileCount: 1, commitment: randomBytes(32).toString('hex') }).returning();
  const body = randomBytes(bytes);
  const key = `tenants/${ownerId}/customer/${a.id}/${v.id}/${randomUUID()}`;
  await ctx.storage.put(key, body);
  const [f] = await ctx.db.insert(schema.assetFiles).values({ versionId: v.id, path: 'data.bin', size: bytes, sha256: sha256(body), mediaType: 'application/octet-stream', objectKey: key }).returning();
  return { asset: a, version: v, file: f, body };
}

async function listing(seller: { id: string; wallet: string }, versionId: string, assetId: string, priceLamports = 10_000_000n) {
  const [l] = await ctx.db
    .insert(schema.listings)
    .values({
      sellerId: seller.id, sellerWallet: seller.wallet, assetId, assetVersionId: versionId, kind: 'dataset', title: 'Cats', description: 'cat photos dataset', category: 'image_classification',
      licenseId: 'eb-nonexclusive-commercial-v1', licenseHash: '0'.repeat(64), terms: {}, termsHash: '0'.repeat(64), priceMicro: priceLamports,
      listingIdOnchain: BigInt(Math.floor(Math.random() * 1e12)), onchainAddress: Keypair.generate().publicKey.toBase58(), status: 'published',
    })
    .returning();
  return l;
}

async function order(buyer: { id: string; wallet: string }, l: typeof schema.listings.$inferSelect) {
  const [o] = await ctx.db
    .insert(schema.orders)
    .values({
      kind: 'purchase', buyerId: buyer.id, buyerWallet: buyer.wallet, sellerId: l.sellerId, sellerWallet: l.sellerWallet, listingId: l.id, orderIdOnchain: BigInt(Math.floor(Math.random() * 1e12)),
      onchainAddress: Keypair.generate().publicKey.toBase58(), title: l.title, terms: {}, termsHash: '0'.repeat(64), criteriaHash: '0'.repeat(64), licenseId: l.licenseId, licenseHash: l.licenseHash, amountMicro: l.priceMicro,
    })
    .returning();
  return o;
}

/** Mark an invoice paid exactly like confirmInvoice does after the on-chain receipt check. */
async function pay(invoiceId: string) {
  const [inv] = await ctx.db.update(schema.invoices).set({ status: 'paid', paidAt: new Date() }).where(eq(schema.invoices.id, invoiceId)).returning();
  await applyPaidInvoice(ctx, inv);
}

async function entitlement(buyer: { id: string; wallet: string }, versionId: string, opts: { allowance?: bigint | null; endsAt?: Date | null; quoteId?: string } = {}) {
  const [e] = await ctx.db
    .insert(schema.deliveryEntitlements)
    .values({
      orderId: randomUUID(), buyerId: buyer.id, buyerWallet: buyer.wallet, assetVersionId: versionId, licenseReceipt: 'r',
      accessStartsAt: new Date(), accessEndsAt: opts.endsAt === undefined ? new Date(Date.now() + 30 * 86_400_000) : opts.endsAt, allowanceBytes: opts.allowance === undefined ? null : opts.allowance, checkoutQuoteId: opts.quoteId ?? null,
    })
    .returning();
  return e;
}

const token = (ent: { id: string; buyerWallet: string }, fileId: string) => signDownloadToken(ctx.cfg.DOWNLOAD_TOKEN_SECRET, { s: 'delivery', g: ent.id, f: fileId, w: ent.buyerWallet, x: Math.floor(Date.now() / 1000) + 600 });
const served = async (id: string) => (await ctx.db.select().from(schema.deliveryEntitlements).where(eq(schema.deliveryEntitlements.id, id)))[0].bytesServed;

it('only sells download credits while the buyer has usable delivery access', async () => {
  const buyer = await account();
  const d = await dataset(buyer.id, 100);
  const active = await entitlement(buyer, d.version.id, { allowance: 100n });
  const expired = await entitlement(buyer, d.version.id, { allowance: 100n, endsAt: new Date(Date.now() - 1000) });
  const revoked = await entitlement(buyer, d.version.id, { allowance: 100n });
  await ctx.db.update(schema.deliveryEntitlements).set({ revokedAt: new Date() }).where(eq(schema.deliveryEntitlements.id, revoked.id));
  const bearer = await issueSession(ctx.cfg.JWT_SECRET, { accountId: buyer.id, wallet: buyer.wallet, roles: [] });
  for (const [ent, code] of [[expired, 'access_expired'], [revoked, 'revoked']] as const) {
    const response = await app.inject({ method: 'POST', url: `/entitlements/${ent.id}/download-credits`, headers: { authorization: `Bearer ${bearer}` }, payload: { gb: 1 } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe(code);
  }
  expect(await ctx.db.select().from(schema.invoices).where(eq(schema.invoices.accountId, buyer.id))).toHaveLength(0);
  const response = await app.inject({ method: 'POST', url: `/entitlements/${active.id}/download-credits`, headers: { authorization: `Bearer ${bearer}` }, payload: { gb: 1 } });
  expect(response.statusCode).toBe(200);
  await pay(response.json().invoice.id);
  const [updated] = await ctx.db.select().from(schema.deliveryEntitlements).where(eq(schema.deliveryEntitlements.id, active.id));
  expect(updated.extraBytes).toBe(GIB);
  await expect(deliveryAccess(ctx, updated)).resolves.toMatchObject({ remaining: GIB + 100n });
});

async function signIn() {
  const kp = Keypair.generate();
  const inject = (method: string, url: string, payload?: unknown) => app.inject({ method: method as any, url, ...(payload ? { payload: payload as any } : {}) });
  const ch = (await inject('POST', '/auth/challenge', { wallet: kp.publicKey.toBase58() })).json();
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey));
  return (await inject('POST', '/auth/verify', { wallet: kp.publicKey.toBase58(), nonce: ch.nonce, signature })).json().token as string;
}

// ------------------------------------------------------------------ seller-paid listing storage

describe('seller listing hosting', () => {
  it('seller prepays hosting for a dataset that never sells', async () => {
    const seller = await account();
    const d = await dataset(seller.id, 200_000); // beyond the 50 KB free tier
    await expect(ensureListingCoverage(ctx, seller.id, d.version.id)).rejects.toMatchObject({ code: 'hosting_required' });
    const { quote, invoice } = await createSellerHostingInvoice(ctx, seller.id, d.version.id, 3);
    expect(quote.usdMicro).toBe(hostingFee(200_000n, 3n)); // = max(0.30 x 3, 1 GB x 3 x 0.023 x 3) = 0.90 USD
    expect(quote.usdMicro).toBe(900_000n);
    expect(BigInt(invoice.amountMicro)).toBe(usdToLamports(900_000n, SOL_USD));
    await pay(invoice.id);
    await expect(ensureListingCoverage(ctx, seller.id, d.version.id)).resolves.toMatchObject({ source: 'existing' });
    const [cov] = await ctx.db.select().from(schema.hostingCoverage).where(eq(schema.hostingCoverage.assetVersionId, d.version.id));
    expect(cov.source).toBe('seller_prepaid');
    expect(cov.payerId).toBe(seller.id);
    expect(BigInt(cov.endsAt.getTime() - cov.startsAt.getTime())).toBe(3n * MONTH_SECS * 1000n);
    // zero purchases: no order exists, the storage is still paid for
    expect(await ctx.db.select().from(schema.orders).where(eq(schema.orders.sellerId, seller.id))).toHaveLength(0);
    // paying again extends from the end of the funded run instead of overlapping it
    const again = await createSellerHostingInvoice(ctx, seller.id, d.version.id, 1);
    await pay(again.invoice.id);
    const rows = await ctx.db.select().from(schema.hostingCoverage).where(eq(schema.hostingCoverage.assetVersionId, d.version.id));
    const second = rows.find((r) => r.invoiceId === again.invoice.id)!;
    expect(second.startsAt.getTime()).toBe(cov.endsAt.getTime());
  });

  it('the free 1 GB tier is bounded in size, time and per version, so it cannot be cycled into unlimited storage', async () => {
    const seller = await account();
    const a = await dataset(seller.id, 30_000);
    const b = await dataset(seller.id, 30_000);
    expect(await grantFreeCoverage(ctx, seller.id, a.version.id)).toBe(true);
    expect(await grantFreeCoverage(ctx, seller.id, a.version.id)).toBe(false); // once per version
    expect(await grantFreeCoverage(ctx, seller.id, b.version.id)).toBe(false); // 30 KB + 30 KB > 50 KB free
    const [free] = await ctx.db.select().from(schema.hostingCoverage).where(eq(schema.hostingCoverage.assetVersionId, a.version.id));
    expect(free.endsAt.getTime() - free.startsAt.getTime()).toBe(90 * 86_400_000); // time-bounded
    expect(free.amountMicro).toBe(0n);
    // concurrent grants for different versions cannot jointly exceed the free bytes
    const c = await dataset((await account()).id, 30_000);
    const seller2 = c.asset.ownerId;
    const c2 = await dataset(seller2, 30_000);
    const res = await Promise.all([grantFreeCoverage(ctx, seller2, c.version.id), grantFreeCoverage(ctx, seller2, c2.version.id)]);
    expect(res.filter(Boolean)).toHaveLength(1);
    // the new plan includes bounded personal storage in the same free quota
    const tok = await signIn();
    const { version } = (await app.inject({ method: 'POST', url: '/assets', headers: { authorization: `Bearer ${tok}` }, payload: { kind: 'dataset', name: 'x', purpose: 'storage' } })).json();
    const r = await app.inject({ method: 'POST', url: `/versions/${version.id}/uploads`, headers: { authorization: `Bearer ${tok}` }, payload: { path: 'a.bin', size: 1000, sha256: '0'.repeat(64), mediaType: 'application/octet-stream' } });
    expect(r.statusCode).toBe(200);
    const over = await app.inject({ method: 'POST', url: `/versions/${version.id}/uploads`, headers: { authorization: `Bearer ${tok}` }, payload: { path: 'b.bin', size: 50_000, sha256: '0'.repeat(64), mediaType: 'application/octet-stream' } });
    expect(over.statusCode).toBe(402);
  });

  it('completed uploads count toward the committed quota', async () => {
    const tok = await signIn();
    const auth = { authorization: `Bearer ${tok}` };
    const { version } = (await app.inject({ method: 'POST', url: '/assets', headers: auth, payload: { kind: 'dataset', name: 'x', purpose: 'listing' } })).json();
    const data = png(64, 64, 7);
    const up = (await app.inject({ method: 'POST', url: `/versions/${version.id}/uploads`, headers: auth, payload: { path: 'a.png', size: data.length, sha256: sha256(data), mediaType: 'image/png' } })).json();
    for (let i = 0; i < up.partsTotal; i++) {
      await app.inject({ method: 'PUT', url: `/uploads/${up.uploadId}/parts/${i + 1}`, headers: { ...auth, 'content-type': 'application/octet-stream' }, payload: data.subarray(i * up.partSize, (i + 1) * up.partSize) });
    }
    expect((await app.inject({ method: 'POST', url: `/uploads/${up.uploadId}/complete`, headers: auth, payload: {} })).statusCode).toBe(200);
    const accountId = (await ctx.db.select().from(schema.uploads).where(eq(schema.uploads.id, up.uploadId)))[0].accountId;
    expect(await storageUsedBytes(ctx, accountId)).toBe(data.length); // committed, reservation released (not double counted)
    // completing twice is refused and does not add the file again
    expect((await app.inject({ method: 'POST', url: `/uploads/${up.uploadId}/complete`, headers: auth, payload: {} })).statusCode).toBe(409);
    const remaining = 50_000 - data.length;
    const over = await app.inject({ method: 'POST', url: `/versions/${version.id}/uploads`, headers: auth, payload: { path: 'b.bin', size: remaining + 1, sha256: '0'.repeat(64), mediaType: 'application/octet-stream' } });
    expect(over.statusCode).toBe(402);
  });
});

// ------------------------------------------------------------------ buyer checkout & entitlements

describe('buyer checkout', () => {
  it('a buyer is not charged again for hosting the seller already funded; only the uncovered tail', async () => {
    const seller = await account();
    const d = await dataset(seller.id, 200_000);
    const { invoice } = await createSellerHostingInvoice(ctx, seller.id, d.version.id, 3);
    await pay(invoice.id);
    await pay((await createSellerHostingInvoice(ctx, seller.id, d.version.id, 3)).invoice.id);
    const l = await listing(seller, d.version.id, d.asset.id);
    const buyer = await account();
    const inside = await createCheckout(ctx, { orderId: (await order(buyer, l)).id, listingId: l.id, buyerId: buyer.id, assetVersionId: d.version.id, priceLamports: l.priceMicro, months: 3 });
    expect(inside.quote.hostingGaps).toEqual([]);
    expect(inside.quote.lamports.hosting).toBe(0n);

    // a 1-month seller run and a 3-month access period: the buyer funds exactly the 2 uncovered months
    const d2 = await dataset(seller.id, 200_000);
    await pay((await createSellerHostingInvoice(ctx, seller.id, d2.version.id, 1)).invoice.id);
    const l2 = await listing(seller, d2.version.id, d2.asset.id);
    const first = await createCheckout(ctx, { orderId: (await order(buyer, l2)).id, listingId: l2.id, buyerId: buyer.id, assetVersionId: d2.version.id, priceLamports: l2.priceMicro, months: 3 });
    const gapSecs = first.quote.hostingGaps.reduce((n, g) => n + (g.end - g.start), 0n);
    expect(gapSecs).toBeGreaterThanOrEqual(2n * MONTH_SECS - 5n);
    expect(gapSecs).toBeLessThanOrEqual(2n * MONTH_SECS);
    expect(first.invoice).toBeTruthy();
    await pay(first.invoice!.id);
    // a second buyer right after is covered by the first buyer's funded period: no hosting charge again
    const buyer2 = await account();
    const second = await createCheckout(ctx, { orderId: (await order(buyer2, l2)).id, listingId: l2.id, buyerId: buyer2.id, assetVersionId: d2.version.id, priceLamports: l2.priceMicro, months: 3 });
    expect(second.quote.lamports.hosting).toBeLessThanOrEqual(usdToLamports(1n, SOL_USD) * 10n); // at most a few seconds of drift
    // every promised second of both access periods is funded
    const cov = await versionCoverage(ctx, d2.version.id);
    for (const q of [first.quote, second.quote]) {
      const gaps = (await import('@edgebounty/pricing-engine')).uncoveredGaps(q.access, cov);
      expect(gaps.reduce((n, g) => n + (g.end - g.start), 0n)).toBeLessThanOrEqual(second.quote.hostingGaps.reduce((n, g) => n + (g.end - g.start), 0n));
    }
  });

  it('expired seller hosting does not invalidate an active buyer entitlement', async () => {
    const seller = await account();
    const d = await dataset(seller.id, 4096);
    const l = await listing(seller, d.version.id, d.asset.id);
    const past = (days: number) => new Date(Date.now() - days * 86_400_000);
    await ctx.db.insert(schema.hostingCoverage).values({ assetVersionId: d.version.id, source: 'seller_prepaid', payerId: seller.id, bytes: 4096n, startsAt: past(60), endsAt: past(30) });
    const buyer = await account();
    // the buyer's own funded tail + an active access window
    await ctx.db.insert(schema.hostingCoverage).values({ assetVersionId: d.version.id, source: 'buyer', payerId: buyer.id, bytes: 4096n, startsAt: past(30), endsAt: new Date(Date.now() + 20 * 86_400_000) });
    const ent = await entitlement(buyer, d.version.id, { allowance: 4096n, endsAt: new Date(Date.now() + 20 * 86_400_000) });
    // the listing is delisted (seller stopped paying) ...
    await ctx.db.delete(schema.hostingCoverage).where(and(eq(schema.hostingCoverage.assetVersionId, d.version.id), eq(schema.hostingCoverage.source, 'buyer')));
    expect(await delistUnfundedListings(ctx, 14)).toContain(l.id);
    // ... yet the buyer keeps access and the shared copy is retained for them
    await expect(deliveryAccess(ctx, ent)).resolves.toMatchObject({ metered: true });
    expect(await versionHostingActive(ctx, [d.version.id])).toBe(true);
    const r = await app.inject({ method: 'GET', url: `/download/${token(ent, d.file.id)}` });
    expect(r.statusCode).toBe(200);
    expect(Buffer.from(r.rawPayload).equals(d.body)).toBe(true);
    // once the buyer's own access ends, downloads stop (the license itself stays on-chain)
    await ctx.db.update(schema.deliveryEntitlements).set({ accessEndsAt: past(1) }).where(eq(schema.deliveryEntitlements.id, ent.id));
    expect((await app.inject({ method: 'GET', url: `/download/${token(ent, d.file.id)}` })).json().error).toBe('access_expired');
  });

  it('downloads wait for the checkout extras to be paid', async () => {
    const seller = await account();
    const d = await dataset(seller.id, 4096);
    const l = await listing(seller, d.version.id, d.asset.id);
    const buyer = await account();
    const c = await createCheckout(ctx, { orderId: (await order(buyer, l)).id, listingId: l.id, buyerId: buyer.id, assetVersionId: d.version.id, priceLamports: l.priceMicro, months: 1 });
    const ent = await entitlement(buyer, d.version.id, { allowance: c.quote.allowanceBytes, quoteId: c.row.id });
    expect((await app.inject({ method: 'GET', url: `/download/${token(ent, d.file.id)}` })).json().error).toBe('checkout_unpaid');
    await pay(c.invoice!.id);
    expect((await app.inject({ method: 'GET', url: `/download/${token(ent, d.file.id)}` })).statusCode).toBe(200);
  });
});

// ------------------------------------------------------------------ download metering

describe('download metering', () => {
  it('resumes an interrupted download with Range and charges only the bytes sent', async () => {
    const seller = await account();
    const size = 8 * 1024 * 1024;
    const d = await dataset(seller.id, size);
    const buyer = await account();
    const ent = await entitlement(buyer, d.version.id, { allowance: BigInt(size) });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    // 1) interrupted: the client drops the connection after the first chunk
    const received = await new Promise<number>((resolve) => {
      const rq = httpGet(`${address}/download/${token(ent, d.file.id)}`, (res) => {
        res.once('data', (chunk: Buffer) => {
          rq.destroy();
          resolve(chunk.length);
        });
      });
    });
    await new Promise((r) => setTimeout(r, 300));
    const afterCut = await served(ent.id);
    expect(afterCut).toBeGreaterThanOrEqual(BigInt(received));
    expect(afterCut).toBeLessThan(BigInt(size)); // unsent bytes were refunded, not charged
    // 2) resume from where the server stopped charging
    const from = Number(afterCut);
    const r = await app.inject({ method: 'GET', url: `/download/${token(ent, d.file.id)}`, headers: { range: `bytes=${from}-` } });
    expect(r.statusCode).toBe(206);
    expect(r.headers['content-range']).toBe(`bytes ${from}-${size - 1}/${size}`);
    expect(Buffer.from(r.rawPayload).equals(d.body.subarray(from))).toBe(true);
    expect(await served(ent.id)).toBe(BigInt(size)); // one full download in total
    // 3) the single included download is used up
    expect((await app.inject({ method: 'GET', url: `/download/${token(ent, d.file.id)}` })).json().error).toBe('download_quota_exhausted');
    // invalid ranges are rejected without charging
    expect((await app.inject({ method: 'GET', url: `/download/${token(ent, d.file.id)}`, headers: { range: `bytes=${size}-` } })).statusCode).toBe(416);
  });

  it('cannot be bypassed with parallel ranges, re-issued tokens or presigned URLs', async () => {
    const seller = await account();
    const size = 64 * 1024;
    const d = await dataset(seller.id, size);
    const buyer = await account();
    const ent = await entitlement(buyer, d.version.id, { allowance: BigInt(size) });
    // 8 parallel half-file ranges = 4x the allowance: at most the allowance is ever served
    const half = size / 2;
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => app.inject({ method: 'GET', url: `/download/${token(ent, d.file.id)}`, headers: { range: i % 2 ? `bytes=${half}-` : `bytes=0-${half - 1}` } })));
    expect(rs.filter((r) => r.statusCode === 206)).toHaveLength(2);
    expect(rs.filter((r) => r.statusCode === 402)).toHaveLength(6);
    expect(await served(ent.id)).toBe(BigInt(size));
    // a fresh token does not reset the meter (state lives on the entitlement, not in the token)
    expect((await app.inject({ method: 'GET', url: `/download/${token(ent, d.file.id)}`, headers: { range: 'bytes=0-0' } })).statusCode).toBe(402);

    // presigned hand-off: S3 cannot cap bytes on a presigned URL (it can be replayed until expiry),
    // so the full object is charged when the URL is issued, and issuance stops at the allowance
    const ent2 = await entitlement(buyer, d.version.id, { allowance: BigInt(size) });
    const spy = vi.spyOn(ctx.storage, 'presignGet').mockResolvedValue('https://bucket.s3.eu-north-1.amazonaws.com/x?X-Amz-Expires=300');
    try {
      const first = await app.inject({ method: 'GET', url: `/download/${token(ent2, d.file.id)}?direct=1` });
      expect(first.statusCode).toBe(302);
      expect(await served(ent2.id)).toBe(BigInt(size));
      expect((await app.inject({ method: 'GET', url: `/download/${token(ent2, d.file.id)}?direct=1` })).statusCode).toBe(402);
    } finally {
      spy.mockRestore();
    }
    // extra downloads require prepaid credits
    const tok = (await ctx.db.select().from(schema.accounts).where(eq(schema.accounts.id, buyer.id)))[0];
    const credits = await (await import('../../apps/api/src/lib/billing.js')).createDownloadCreditInvoice(ctx, tok.id, ent.id, 1);
    expect(credits.usdMicro).toBe(150_000n);
    await pay(credits.invoice.id);
    expect((await app.inject({ method: 'GET', url: `/download/${token(ent, d.file.id)}`, headers: { range: 'bytes=0-0' } })).statusCode).toBe(206);
  });
});

// ------------------------------------------------------------------ verification reuse

describe('verification is paid once per version', () => {
  async function finalizedPng() {
    const tok = await signIn();
    const auth = { authorization: `Bearer ${tok}` };
    const { version } = (await app.inject({ method: 'POST', url: '/assets', headers: auth, payload: { kind: 'dataset', name: 'cats', purpose: 'listing' } })).json();
    const data = png(32, 32, 11);
    const up = (await app.inject({ method: 'POST', url: `/versions/${version.id}/uploads`, headers: auth, payload: { path: 'a.png', size: data.length, sha256: sha256(data), mediaType: 'image/png' } })).json();
    for (let i = 0; i < up.partsTotal; i++) {
      await app.inject({ method: 'PUT', url: `/uploads/${up.uploadId}/parts/${i + 1}`, headers: { ...auth, 'content-type': 'application/octet-stream' }, payload: data.subarray(i * up.partSize, (i + 1) * up.partSize) });
    }
    await app.inject({ method: 'POST', url: `/uploads/${up.uploadId}/complete`, headers: auth, payload: {} });
    expect((await app.inject({ method: 'POST', url: `/versions/${version.id}/finalize`, headers: auth, payload: {} })).statusCode).toBe(200);
    const [u] = await ctx.db.select().from(schema.uploads).where(eq(schema.uploads.id, up.uploadId));
    return { versionId: version.id as string, requesterId: u.accountId };
  }
  const resultsFor = async (jobIds: string[]) => (await ctx.db.select().from(schema.verificationResults)).filter((r) => jobIds.includes(r.jobId));

  it('repeated purchases reuse the stored result instead of running AI verification again', async () => {
    const { versionId, requesterId } = await finalizedPng();
    const a = await createJob(ctx, { kind: 'standalone', assetVersionId: versionId, requesterId, level: 'L2' });
    await drainJobs(ctx);
    const b = await createJob(ctx, { kind: 'standalone', assetVersionId: versionId, requesterId, level: 'L2' });
    const c = await createJob(ctx, { kind: 'standalone', assetVersionId: versionId, requesterId, level: 'L2' });
    await drainJobs(ctx);
    const runs = await ctx.db.select().from(schema.verificationRuns).where(eq(schema.verificationRuns.assetVersionId, versionId));
    expect(runs).toHaveLength(1);
    expect(runs[0].jobId).toBe(a.id);
    const results = await resultsFor([a.id, b.id, c.id]);
    expect(results).toHaveLength(3);
    expect(results.filter((r) => r.reusedFromJobId === null).map((r) => r.jobId)).toEqual([a.id]);
    expect(new Set(results.map((r) => r.reportHash)).size).toBe(1);
    const jobs = await ctx.db.select().from(schema.verificationJobs).where(sql`${schema.verificationJobs.id} in (${sql.join([b.id, c.id].map((x) => sql`${x}`), sql`, `)})`);
    expect(jobs.every((j) => j.status === 'completed' && j.actualCostMicro === 0n)).toBe(true);
    // upstream usage is recorded once, for the canonical run only
    const costs = await ctx.db.select().from(schema.costEvents).where(sql`${schema.costEvents.subjectId} in (${sql.join([a.id, b.id, c.id].map((x) => sql`${x}`), sql`, `)})`);
    expect(costs.every((e) => e.subjectId === a.id)).toBe(true);
    expect(costs.length).toBeGreaterThan(0);
  });

  it('concurrent jobs for the same version cannot start duplicate paid inference', async () => {
    const { versionId, requesterId } = await finalizedPng();
    await drainJobs(ctx); // the free L1 preview job
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push((await createJob(ctx, { kind: 'standalone', assetVersionId: versionId, requesterId, level: 'L2' })).id);
    const claimed = [];
    for (let i = 0; i < 4; i++) claimed.push((await claimNextJob(ctx, `w${i}`))!);
    await Promise.all(claimed.map((j) => runJob(ctx, j)));
    await drainJobs(ctx);
    const runs = await ctx.db.select().from(schema.verificationRuns).where(eq(schema.verificationRuns.assetVersionId, versionId));
    expect(runs).toHaveLength(1);
    const results = await resultsFor(ids);
    expect(results).toHaveLength(4);
    expect(results.filter((r) => r.reusedFromJobId === null)).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ migrations

describe('migrations', () => {
  it('upgrading an existing database preserves accounts and listings', async () => {
    const src = join(import.meta.dirname, '..', '..', 'apps', 'api', 'drizzle');
    const old = mkdtempSync(join(tmpdir(), 'eb-mig-'));
    cpSync(src, old, { recursive: true });
    const journal = JSON.parse(readFileSync(join(old, 'meta', '_journal.json'), 'utf8'));
    const before = journal.entries.filter((e: any) => e.idx < 3);
    expect(before.length).toBeLessThan(journal.entries.length); // 0003 is the migration under test
    writeFileSync(join(old, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: before }));

    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: old });
    const wallet = Keypair.generate().publicKey.toBase58();
    await client.exec(`insert into accounts (wallet, alias) values ('${wallet}', 'legacy-seller')`);
    const [{ id: sellerId }] = (await client.query<{ id: string }>(`select id from accounts where wallet = '${wallet}'`)).rows;
    await client.exec(`insert into listings (seller_id, seller_wallet, asset_id, asset_version_id, kind, title, description, category, license_id, license_hash, terms, terms_hash, price_micro, listing_id_onchain, onchain_address, status)
      values ('${sellerId}', '${wallet}', gen_random_uuid(), gen_random_uuid(), 'dataset', 'Legacy', 'legacy listing', 'tabular', 'mit', 'h', '{}', 'h', 123456789, 42, 'addr-legacy', 'published')`);
    await client.exec(`insert into delivery_entitlements (order_id, buyer_id, buyer_wallet, asset_version_id, license_receipt) values (gen_random_uuid(), '${sellerId}', '${wallet}', gen_random_uuid(), 'rcpt')`);

    await migrate(db, { migrationsFolder: src }); // apply 0003 on top of live data
    const accounts = (await client.query<any>(`select wallet, alias from accounts where wallet = '${wallet}'`)).rows;
    expect(accounts).toEqual([{ wallet, alias: 'legacy-seller' }]);
    const listings = (await client.query<any>(`select title, price_micro::text as price, status from listings where onchain_address = 'addr-legacy'`)).rows;
    expect(listings).toEqual([{ title: 'Legacy', price: '123456789', status: 'published' }]);
    // legacy entitlements stay unmetered and open-ended
    const ents = (await client.query<any>(`select access_ends_at, allowance_bytes, bytes_served::text as served from delivery_entitlements where license_receipt = 'rcpt'`)).rows;
    expect(ents).toEqual([{ access_ends_at: null, allowance_bytes: null, served: '0' }]);
    await client.close();
  });
});
