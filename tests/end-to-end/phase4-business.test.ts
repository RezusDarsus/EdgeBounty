/**
 * Phase 4 completion criterion: a user who never buys or sells a marketplace item can
 * independently purchase verification services (and storage). Covers quotes, on-chain invoice
 * payment (single-use receipts), job budgets with re-authorization, credits, metering,
 * storage rental and the expiry → grace → deletion lifecycle with active-order protection.
 */
import { GIB, RATES, hostingFee, usdToLamports } from '@edgebounty/pricing-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drainJobs } from '../../apps/api/src/services/jobs.js';
import { storageExpiryTick } from '../../apps/api/src/routes/storage.js';
import { schema } from '../../apps/api/src/db/index.js';
import { UNIT, localnetAvailable } from './helpers.js';
import { actor, api, hex, ok, paidVerification, payInvoice, png, send, startHarness, uploadAsset, type Harness } from './api-harness.js';

const up = await localnetAvailable();

describe.skipIf(!up)('Phase 4 — storage & verification business (localnet)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ FREE_STORAGE_BYTES: String(120_000) });
  });
  afterAll(async () => h?.close());

  async function pay(who: Awaited<ReturnType<typeof actor>>, invoice: any) {
    await send(h, who, await h.p.client.payService(who.kp.publicKey, hex(invoice.reference), invoice.serviceKind, BigInt(invoice.amountMicro)));
    return ok(h, who, 'POST', `/invoices/${invoice.id}/confirm`);
  }

  it('a non-trading user buys a paid verification, pays on-chain once, and receives a report', async () => {
    const user = await actor(h, 50n * UNIT);
    const asset = await uploadAsset(h, user, 'dataset', 'verification', Array.from({ length: 30 }, (_, i) => ({ path: `d/${i}.png`, data: png(24, 24, 400 + i), mediaType: 'image/png' })));
    const quote = await ok(h, user, 'POST', '/verification/quote', { assetVersionId: asset.versionId, level: 'L2' });
    expect(BigInt(quote.priceMicro)).toBe(RATES.l2Base); // L2 base, under 5k items, < 1 GB
    expect(quote.budget.maxItems).toBeGreaterThanOrEqual(30);

    const created = await ok(h, user, 'POST', '/verification/jobs', { assetVersionId: asset.versionId, level: 'L2' });
    expect(created.job.status).toBe('awaiting_payment');
    // unpaid → nothing runs
    expect(await drainJobs(h.ctx)).toBe(0);
    // confirming without an on-chain receipt is refused
    expect((await api(h, user, 'POST', `/invoices/${created.invoice.id}/confirm`)).status).toBe(409);
    const treasury0 = await h.p.client.tokenBalance(h.p.treasury);
    await pay(user, created.invoice);
    expect((await h.p.client.tokenBalance(h.p.treasury)) - treasury0).toBe(RATES.l2Base);
    // the same invoice reference can never be paid twice
    await expect(send(h, user, await h.p.client.payService(user.kp.publicKey, hex(created.invoice.reference), 2, RATES.l2Base))).rejects.toThrow();

    await drainJobs(h.ctx);
    const job = await ok(h, user, 'GET', `/verification/jobs/${created.job.id}`);
    expect(job.status).toBe('completed');
    expect(job.result.report.datasetMetrics.readableFiles).toBe(30);
    expect(job.result.report.datasetMetrics.nearDuplicates).not.toBeNull(); // L2 ran
    expect(BigInt(job.actualCostMicro)).toBeGreaterThan(0n);

    const usage = await ok(h, user, 'GET', '/usage');
    expect(BigInt(usage.paidMicro)).toBe(RATES.l2Base);
    expect(usage.invoices[0].status).toBe('paid');
    // and this user never created a listing or an order
    expect(await ok(h, user, 'GET', '/me/orders')).toHaveLength(0);
  });

  it('stops at the budget when the workload differs, then resumes after re-authorization; credits pay for jobs', async () => {
    const user = await actor(h, 50n * UNIT);
    const asset = await uploadAsset(h, user, 'dataset', 'verification', Array.from({ length: 5 }, (_, i) => ({ path: `e/${i}.png`, data: png(16, 16, 600 + i), mediaType: 'image/png' })));
    const created = await ok(h, user, 'POST', '/verification/jobs', { assetVersionId: asset.versionId, level: 'L1' });
    expect(created.job.status).toBe('queued'); // L1 free tier
    // simulate a preflight manifest that understated the workload
    await h.ctx.db.update(schema.verificationJobs).set({ budget: { ...created.job.budget, maxItems: 2 } }).where(eq(schema.verificationJobs.id, created.job.id));
    await drainJobs(h.ctx);
    let job = await ok(h, user, 'GET', `/verification/jobs/${created.job.id}`);
    expect(job.status).toBe('needs_authorization');
    expect(job.result).toBeNull();
    const re = await ok(h, user, 'POST', `/verification/jobs/${created.job.id}/reauthorize`);
    expect(re.status).toBe('queued');
    await drainJobs(h.ctx);
    job = await ok(h, user, 'GET', `/verification/jobs/${created.job.id}`);
    expect(job.status).toBe('completed');

    // prepaid credits: buy 10 UNIT, then an L2 job is paid from credits without an invoice
    const cr = await ok(h, user, 'POST', '/credits/purchase', { amountMicro: String(10n * UNIT) });
    await pay(user, cr.invoice);
    const paid = await ok(h, user, 'POST', '/verification/jobs', { assetVersionId: asset.versionId, level: 'L2' });
    expect(paid.invoice).toBeNull();
    expect(BigInt(paid.paidWithCredits)).toBe(RATES.l2Base);
    expect((await ok(h, user, 'GET', '/usage')).credits).toBe(String(10n * UNIT - RATES.l2Base));
  });

  it('rents storage on-chain, and expiry deletes only unprotected assets after the grace period', async () => {
    const user = await actor(h, 50n * UNIT);
    const before = await ok(h, user, 'GET', '/storage');
    expect(before.quotaBytes).toBe(120_000);
    const q = await ok(h, user, 'POST', '/storage/quote', { gb: 10, termDays: 30 });
    // H = max(0.30 x 1, 10 GB x 1 x S3_RATE x 3) = 0.69 USD, converted at SOL_USD_MICRO
    expect(q.priceMicro).toBe(usdToLamports(hostingFee(10n * GIB, 1n), h.ctx.cfg.SOL_USD_MICRO).toString());
    const alloc = await ok(h, user, 'POST', '/storage/allocations', { gb: 10, termDays: 30 });
    await pay(user, alloc.invoice);
    const after = await ok(h, user, 'GET', '/storage');
    expect(after.quotaBytes).toBe(120_000 + 10 * 1024 ** 3);
    expect(after.allocations[0].status).toBe('active');

    // fill beyond the free tier: one protected (published listing) + one scratch asset
    const big = () => Array.from({ length: 3 }, (_, i) => ({ path: `b/${i}.png`, data: png(140, 140, 900 + i + Math.floor(Math.random() * 1e6)), mediaType: 'image/png' }));
    const keep = await uploadAsset(h, user, 'dataset', 'listing', big(), 'keep');
    await paidVerification(h, user, keep.versionId);
    // beyond the free tier the seller prepays listing hosting (ensureListingCoverage)
    expect((await api(h, user, 'POST', '/listings', { assetVersionId: keep.versionId, title: 'Protected dataset', description: 'Backs a published listing.', category: 'image_classification', licenseId: 'cc-by-4.0', priceMicro: String(UNIT) })).status).toBe(402);
    await payInvoice(h, user, (await ok(h, user, 'POST', `/versions/${keep.versionId}/hosting`, { months: 1 })).invoice);
    const prep = await ok(h, user, 'POST', '/listings', { assetVersionId: keep.versionId, title: 'Protected dataset', description: 'Backs a published listing.', category: 'image_classification', licenseId: 'cc-by-4.0', priceMicro: String(UNIT) });
    const a = prep.onchain;
    await send(h, user, (await h.p.client.createListing(user.kp.publicKey, BigInt(a.listingId), 'dataset', { assetCommitment: hex(a.assetCommitment), termsHash: hex(a.termsHash), licenseHash: hex(a.licenseHash), price: BigInt(a.price) })).ixs);
    await ok(h, user, 'POST', `/listings/${prep.listing.id}/confirm`);
    const scratch = await uploadAsset(h, user, 'dataset', 'storage', big(), 'scratch');
    expect((await ok(h, user, 'GET', '/storage')).usedBytes).toBeGreaterThan(120_000);

    // time travel: term ends → grace (nothing deleted) → grace ends → unprotected deleted
    const t1 = new Date(Date.now() + 31 * 86_400_000);
    expect((await storageExpiryTick(h.ctx, t1)).toGrace).toBeGreaterThanOrEqual(1);
    expect((await ok(h, user, 'GET', '/storage')).allocations[0].status).toBe('grace');
    const t2 = new Date(Date.now() + 46 * 86_400_000);
    const r = await storageExpiryTick(h.ctx, t2);
    expect(r.deleted).toBeGreaterThanOrEqual(1);
    const assets = await ok(h, user, 'GET', '/assets');
    expect(assets.map((x: any) => x.id)).toContain(keep.assetId);
    expect(assets.map((x: any) => x.id)).not.toContain(scratch.assetId);
    // user-initiated deletion of a protected asset is refused
    expect((await api(h, user, 'DELETE', `/assets/${keep.assetId}`)).status).toBe(409);
  });
});
