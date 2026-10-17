import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { loadConfig } from '../../apps/api/src/config.js';
import { createDb, schema } from '../../apps/api/src/db/index.js';
import { LocalStorage } from '../../apps/api/src/storage/index.js';
import { ChainService } from '../../apps/api/src/chain.js';
import { buildApp } from '../../apps/api/src/app.js';
import type { AppContext } from '../../apps/api/src/context.js';

let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildApp>>;
let close: () => Promise<void>;
const admin = Keypair.generate();
beforeAll(async () => {
  const cfg = loadConfig({ NODE_ENV: 'test', WORKERS: 'off', SOLANA_RPC_URL: 'http://127.0.0.1:1', ADMIN_WALLETS: admin.publicKey.toBase58() });
  const d = await createDb({ memory: true });
  close = d.close;
  ctx = { cfg, db: d.db, storage: new LocalStorage('.data/test-growth'), chain: new ChainService(cfg), events: {} };
  vi.spyOn(ctx.chain.client, 'config').mockResolvedValue({ paymentMint: NATIVE_MINT, feeBps: 600 } as any);
  app = await buildApp(ctx);
});
afterAll(async () => { await app.close(); await close(); });

async function signIn(kp = Keypair.generate()) {
  const ch = (await app.inject({ method: 'POST', url: '/auth/challenge', payload: { wallet: kp.publicKey.toBase58() } })).json();
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey));
  const token = (await app.inject({ method: 'POST', url: '/auth/verify', payload: { wallet: kp.publicKey.toBase58(), nonce: ch.nonce, signature } })).json().token as string;
  const me = (await app.inject({ url: '/me', headers: { authorization: `Bearer ${token}` } })).json();
  return { token, accountId: me.account.id as string, wallet: kp.publicKey.toBase58(), headers: { authorization: `Bearer ${token}` } };
}

async function listing(seller: { accountId: string; wallet: string }, p: { title: string; description: string; price: bigint; status?: 'published' | 'draft'; sales?: number; passed?: boolean }) {
  const [asset] = await ctx.db.insert(schema.assets).values({ ownerId: seller.accountId, kind: 'dataset', name: p.title, purpose: 'listing' } as any).returning();
  const [version] = await ctx.db.insert(schema.assetVersions).values({ assetId: asset.id, version: 1, status: 'finalized', totalSize: 10, fileCount: 1 } as any).returning();
  const [l] = await ctx.db.insert(schema.listings).values({ sellerId: seller.accountId, sellerWallet: seller.wallet, assetId: asset.id, assetVersionId: version.id, kind: 'dataset', title: p.title, description: p.description, category: 'image', licenseId: 'fixture', licenseHash: 'a'.repeat(64), terms: {}, termsHash: 'b'.repeat(64), priceMicro: p.price, listingIdOnchain: BigInt(Math.floor(Math.random() * 1e9)), onchainAddress: Keypair.generate().publicKey.toBase58(), status: p.status ?? 'published', sales: p.sales ?? 0 }).returning();
  if (p.passed !== undefined) {
    const [job] = await ctx.db.insert(schema.verificationJobs).values({ kind: 'listing', assetVersionId: version.id, requesterId: seller.accountId, level: 'L2', specHash: '0'.repeat(64), status: 'completed', budget: { maxSpend: '0', maxSeconds: 1, maxItems: 1, maxApiCalls: 0 } }).returning();
    await ctx.db.insert(schema.verificationResults).values({ jobId: job.id, report: {}, reportHash: '1'.repeat(64), passed: p.passed });
  }
  return l;
}

it('ranks full-text matches, stems words, escapes LIKE wildcards, sorts on the server and filters verified listings', async () => {
  const seller = await signIn();
  const roads = await listing(seller, { title: 'Georgian road signs', description: 'Labelled photographs of traffic signs in rain and snow', price: 50n, sales: 1, passed: true });
  const cats = await listing(seller, { title: 'Cat photos', description: 'Indoor cats; includes a few road scenes', price: 10n, sales: 5, passed: false });
  await listing(seller, { title: 'Draft signs', description: 'road signs draft', price: 1n, status: 'draft' });
  const get = async (qs: string) => (await app.inject({ url: `/listings?${qs}` })).json();

  const ranked = await get('q=road%20signs');
  expect(ranked.sort).toBe('relevance');
  expect(ranked.items.map((l: any) => l.id)).toEqual([roads.id]);
  expect((await get('q=photograph')).items.map((l: any) => l.id)).toContain(roads.id); // stemmed: photographs
  expect((await get('q=road')).items[0].id).toBe(roads.id);
  expect((await get('q=Geor')).items.map((l: any) => l.id)).toEqual([roads.id]); // prefix fallback
  expect((await get('q=%25')).items).toHaveLength(0); // '%' is literal, not a wildcard
  expect((await get('sort=price-asc')).items.map((l: any) => l.id)).toEqual([cats.id, roads.id]);
  expect((await get('sort=sales')).items[0].id).toBe(cats.id);
  expect((await get('maxPrice=20')).items.map((l: any) => l.id)).toEqual([cats.id]);
  const verified = await get('verified=1');
  expect(verified.items.map((l: any) => l.id)).toEqual([roads.id]);
  expect(verified.items[0].verifiedLevel).toBe('L2');
});

it('discovers only public listing metadata and keeps paid drafting disabled', async () => {
  const seller = await signIn();
  const visible = await listing(seller, { title: 'Kartvelian recordings', description: 'Consented Georgian speech clips', price: 10n });
  await listing(seller, { title: 'Private Kartvelian recordings', description: 'secret draft speech', price: 10n, status: 'draft' });
  const r = (await app.inject({ url: '/agents/discovery?q=Kartvelian' })).json();
  expect(r.method).toBe('catalog-keyword');
  expect(r.items.map((l: any) => l.id)).toEqual([visible.id]);
  expect(r.items[0].matchedTerms).toEqual(['kartvelian']);
  expect(r.items[0].sellerId).toBeUndefined();
  expect((await app.inject({ url: '/agents/discovery?q=%25%25' })).json().items).toEqual([]);
  expect((await app.inject({ url: '/agents/discovery?q=x' })).statusCode).toBe(400);
  const payload = { requirements: 'Collect consented speech samples for research', consent: true };
  expect((await app.inject({ method: 'POST', url: '/agents/bounty-draft', payload })).statusCode).toBe(401);
  expect((await app.inject({ method: 'POST', url: '/agents/bounty-draft', headers: seller.headers, payload })).statusCode).toBe(503);
  expect((await app.inject({ method: 'POST', url: '/agents/bounty-draft', headers: seller.headers, payload: { ...payload, consent: false } })).statusCode).toBe(400);
  expect((await app.inject({ url: '/agents/capabilities' })).json()).toMatchObject({ bountyDraft: false, financialAuthority: false });
});

it('keeps collections private unless shared and only lets owners change them', async () => {
  const owner = await signIn(), other = await signIn();
  const l = await listing(owner, { title: 'Collected audio', description: 'speech clips', price: 5n });
  const draft = await listing(owner, { title: 'Hidden', description: 'draft', price: 5n, status: 'draft' });
  const c = (await app.inject({ method: 'POST', url: '/collections', headers: owner.headers, payload: { title: 'Speech sets' } })).json();
  expect((await app.inject({ method: 'POST', url: `/collections/${c.id}/items`, headers: owner.headers, payload: { listingId: l.id, note: 'for ASR' } })).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: `/collections/${c.id}/items`, headers: owner.headers, payload: { listingId: draft.id } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'POST', url: `/collections/${c.id}/items`, headers: other.headers, payload: { listingId: l.id } })).statusCode).toBe(403);
  expect((await app.inject({ url: `/collections/${c.id}` })).statusCode).toBe(404);
  expect((await app.inject({ url: `/collections/${c.id}`, headers: other.headers })).statusCode).toBe(404);
  const mine = (await app.inject({ url: `/me/collections?listing=${l.id}`, headers: owner.headers })).json();
  expect(mine[0]).toMatchObject({ items: 1, containsListing: true });
  await app.inject({ method: 'PATCH', url: `/collections/${c.id}`, headers: owner.headers, payload: { public: true } });
  const shared = (await app.inject({ url: `/collections/${c.id}` })).json();
  expect(shared.items.map((i: any) => [i.listing.id, i.note])).toEqual([[l.id, 'for ASR']]);
  expect(shared.mine).toBe(false);
  expect((await app.inject({ method: 'DELETE', url: `/collections/${c.id}`, headers: other.headers })).statusCode).toBe(403);
  expect((await app.inject({ method: 'DELETE', url: `/collections/${c.id}`, headers: owner.headers })).statusCode).toBe(200);
  expect((await app.inject({ url: `/collections/${c.id}` })).statusCode).toBe(404);
});

it('counts views (not the seller own, signed-in viewers once a day) and reports sales, fees and receipts from locked splits', async () => {
  const seller = await signIn(), buyer = await signIn(), stranger = await signIn();
  const l = await listing(seller, { title: 'Analytics fixture', description: 'x', price: 100_000_000n });
  await app.inject({ url: `/listings/${l.id}`, headers: seller.headers });
  await app.inject({ url: `/listings/${l.id}`, headers: buyer.headers });
  await app.inject({ url: `/listings/${l.id}`, headers: buyer.headers });
  await app.inject({ url: `/listings/${l.id}` });
  const now = Math.floor(Date.now() / 1000);
  const order = (state: string, chain: Record<string, unknown>) => ctx.db.insert(schema.orders).values({ kind: 'purchase', buyerId: buyer.accountId, buyerWallet: buyer.wallet, sellerId: seller.accountId, sellerWallet: seller.wallet, listingId: l.id, orderIdOnchain: BigInt(Math.floor(Math.random() * 1e9)), onchainAddress: Keypair.generate().publicKey.toBase58(), title: l.title, terms: {}, termsHash: 'c'.repeat(64), criteriaHash: 'd'.repeat(64), licenseId: 'fixture', licenseHash: 'a'.repeat(64), amountMicro: 100_000_000n, chainState: state, chain }).returning();
  const [sold] = await order('settled', { feeBps: 600, sellerBps: 10_000, closedAt: now });
  await order('refunded', { feeBps: 600, sellerBps: 0, closedAt: now });
  const [split] = await order('settled', { feeBps: 600, sellerBps: 5_000, closedAt: now }); // dispute split 50/50

  const a = (await app.inject({ url: '/me/analytics', headers: seller.headers })).json();
  const row = a.listings.find((r: any) => r.listingId === l.id);
  expect(row).toMatchObject({ views: 2, sales: 2, refunds: 1, grossMicro: '150000000', feeMicro: '9000000', netMicro: '141000000' });
  expect(row.conversionBps).toBe(10_000);

  const receipt = (await app.inject({ url: `/orders/${sold.id}/receipt`, headers: buyer.headers })).json();
  expect(receipt.receiptNumber).toMatch(/^EB-\d{8}-[0-9A-F]{8}$/);
  expect(receipt.amounts).toMatchObject({ priceMicro: '100000000', platformFeeBps: 600, platformFeeMicro: '6000000', sellerNetMicro: '94000000', refundedToBuyerMicro: '0' });
  expect((await app.inject({ url: `/orders/${split.id}/receipt`, headers: seller.headers })).json().amounts).toMatchObject({ refundedToBuyerMicro: '50000000', sellerNetMicro: '47000000' });
  expect((await app.inject({ url: `/orders/${sold.id}/receipt`, headers: stranger.headers })).statusCode).toBe(404);
  expect((await app.inject({ url: '/me/receipts', headers: buyer.headers })).json()).toHaveLength(3);

  expect((await app.inject({ url: '/admin/metrics', headers: buyer.headers })).statusCode).toBe(403);
  const adminSession = await signIn(admin);
  const m = (await app.inject({ url: '/admin/metrics', headers: adminSession.headers })).json();
  expect(m.marketplace).toMatchObject({ completedSales: 2, gmvMicro: '150000000', refundedOrders: 1 });
  expect(m.customers).toMatchObject({ activeBuyers: 1, repeatBuyers: 1, activeSellers: 1 });
  expect(randomUUID()).toBeTruthy();
});
