import { paymentQuoteRate } from '../lib/payments.js';
import { notify } from '../services/operations.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import { GIB, STORAGE, hostingFee, usdToLamports } from '@edgebounty/pricing-engine';
import { marketplacePricing, versionHostingActive } from '../lib/billing.js';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { storageQuotaBytes, storageUsedBytes } from '../lib/assets.js';
import { conflict, notFound, parse, requireSession, zUuid } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { confirmInvoice } from '../services/indexer.js';
import { createInvoice, creditBalance } from './verification.js';

// monthly plans: 1, 3, 6 or 12 billing months (30-day months)
const zTerm = z.union([z.literal(30), z.literal(90)]);
const termMonths = (days: number) => (days === 365 ? 12 : days / 30);

/** Prepaid account capacity, priced with the same hosting formula as listings: H = max(0.30 x M, GB x M x S3_RATE x 3). */
function planQuote(ctx: AppContext, gb: number, termDays: number) {
  const months = termMonths(termDays);
  const usdMicro = hostingFee(BigInt(gb) * GIB, BigInt(months), marketplacePricing(ctx));
  return { price: usdToLamports(usdMicro, paymentQuoteRate(ctx.cfg)), usdMicro, breakdown: `${gb} GB x ${months} month(s): max(0.30 USD x ${months}, ${gb} GB x ${months} x S3 rate x 3)` };
}

export function storageRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get('/storage', async (req) => {
    const s = requireSession(req);
    const [used, quota] = await Promise.all([storageUsedBytes(ctx, s.accountId), storageQuotaBytes(ctx, s.accountId)]);
    const allocations = await db.select().from(schema.storageAllocations).where(eq(schema.storageAllocations.accountId, s.accountId)).orderBy(desc(schema.storageAllocations.createdAt));
    return { usedBytes: used, quotaBytes: quota, freeBytes: ctx.cfg.FREE_STORAGE_BYTES, graceDays: STORAGE.graceDays, allocations, credits: (await creditBalance(ctx, s.accountId)).toString() };
  });

  /** Monthly plans (30-day allocations; renew by buying another). Sizes come from STORAGE_PLANS_GB. */
  app.get('/storage/plans', async () => {
    const sizes = ctx.cfg.STORAGE_PLANS_GB.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);
    return {
      freeBytes: ctx.cfg.FREE_STORAGE_BYTES,
      termDays: 30,
      plans: sizes.map((gb) => {
        const q = planQuote(ctx, gb, 30);
        return { gb, termDays: 30, priceMicro: q.price.toString(), usdMicro: q.usdMicro.toString() };
      }),
    };
  });

  app.post('/storage/quote', async (req) => {
    const b = parse(z.object({ gb: z.number().int().min(1).max(100_000), termDays: zTerm }), req.body);
    const q = planQuote(ctx, b.gb, b.termDays);
    return { priceMicro: q.price.toString(), usdMicro: q.usdMicro.toString(), breakdown: q.breakdown };
  });

  app.post('/storage/allocations', async (req) => {
    const s = requireSession(req);
    const b = parse(z.object({ gb: z.number().int().min(1).max(100_000), termDays: zTerm }), req.body);
    const q = planQuote(ctx, b.gb, b.termDays);
    const invoice = await createInvoice(ctx, s.accountId, 'storage', q.price, { gb: b.gb, termDays: b.termDays, usdMicro: q.usdMicro.toString() });
    const [alloc] = await db.insert(schema.storageAllocations).values({ accountId: s.accountId, gb: b.gb, termDays: b.termDays, invoiceId: invoice.id }).returning();
    return { allocation: alloc, invoice };
  });

  app.get('/invoices', async (req) => {
    const s = requireSession(req);
    return db.select().from(schema.invoices).where(eq(schema.invoices.accountId, s.accountId)).orderBy(desc(schema.invoices.createdAt));
  });

  /** Client calls after signing pay_service; the receipt is verified on-chain. */
  app.post('/invoices/:id/confirm', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id));
    if (!inv || inv.accountId !== s.accountId) throw notFound('invoice');
    const ok = await confirmInvoice(ctx, inv);
    if (!ok) throw conflict('no matching on-chain payment receipt yet');
    await audit(db, s, 'invoice.paid', id, { kind: inv.kind, amount: inv.amountMicro });
    return { status: 'paid' };
  });

  /** Prepaid processing credits (metered verification draws them down before invoicing). */
  app.post('/credits/purchase', async (req) => {
    const s = requireSession(req);
    const { amountMicro } = parse(z.object({ amountMicro: z.union([z.string().regex(/^\d+$/), z.number().int()]).transform((v) => BigInt(v)) }), req.body);
    if (amountMicro < 1_000_000n || amountMicro > 100_000_000_000n) throw conflict('credit purchase is outside the supported base-unit range');
    return { invoice: await createInvoice(ctx, s.accountId, 'other', amountMicro, { credits: true }) };
  });

  /** Usage metering: storage, verification spend and billing history for the account. */
  app.get('/usage', async (req) => {
    const s = requireSession(req);
    const [used, quota] = await Promise.all([storageUsedBytes(ctx, s.accountId), storageQuotaBytes(ctx, s.accountId)]);
    const jobs = await db
      .select({ month: sql<string>`to_char(${schema.verificationJobs.createdAt}, 'YYYY-MM')`, level: schema.verificationJobs.level, n: sql<string>`count(*)`, billed: sql<string>`coalesce(sum(${schema.verificationJobs.quoteMicro}),0)` })
      .from(schema.verificationJobs)
      .where(and(eq(schema.verificationJobs.requesterId, s.accountId), inArray(schema.verificationJobs.status, ['completed', 'running', 'queued'])))
      .groupBy(sql`1`, schema.verificationJobs.level);
    const invoices = await db.select().from(schema.invoices).where(eq(schema.invoices.accountId, s.accountId)).orderBy(desc(schema.invoices.createdAt));
    return {
      storage: { usedBytes: used, quotaBytes: quota },
      verification: jobs,
      credits: (await creditBalance(ctx, s.accountId)).toString(),
      paidMicro: invoices.filter((i) => i.status === 'paid').reduce((n, i) => n + i.amountMicro, 0n).toString(),
      invoices: invoices.map((i) => ({ id: i.id, kind: i.kind, amountMicro: i.amountMicro.toString(), status: i.status, createdAt: i.createdAt, paidAt: i.paidAt, receipt: i.receiptAddress })),
    };
  });

  /** User-requested deletion of an asset (never while it backs an active order or listing). */
  app.delete('/assets/:id', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [a] = await db.select().from(schema.assets).where(eq(schema.assets.id, id));
    if (!a || a.ownerId !== s.accountId || a.deletedAt) throw notFound('asset');
    if (await assetProtected(ctx, id)) throw conflict('asset backs an active order, published listing or open dispute');
    await deleteAsset(ctx, id);
    await audit(db, s, 'asset.delete', id);
    return { ok: true };
  });
}

/** Assets referenced by live commitments must survive storage expiry. */
export async function assetProtected(ctx: AppContext, assetId: string): Promise<boolean> {
  // Collaboration records remain protected even when new collaborative actions are disabled.
  const collaborative = await ctx.db.execute(sql`select 1 from collaboration_submissions s join asset_versions v on v.id=s.asset_version_id join orders o on o.id=s.bounty_id where v.asset_id=${assetId} and s.status<>'verification_failed' and o.chain_state not in ('refunded','cancelled') limit 1`);
  if (((collaborative as any).rows ?? collaborative).length) return true;
  const versions = await ctx.db.select().from(schema.assetVersions).where(eq(schema.assetVersions.assetId, assetId));
  const ids = versions.map((v) => v.id);
  if (!ids.length) return false;
  // a published listing alone no longer protects files: listing storage must be funded (see delistUnfundedListings)
  const listed = await ctx.db.select().from(schema.listings).where(and(inArray(schema.listings.assetVersionId, ids), eq(schema.listings.status, 'published')));
  if (listed.length && (await versionHostingActive(ctx, ids, STORAGE.graceDays))) return true;
  const subs = await ctx.db.select().from(schema.submissions).where(inArray(schema.submissions.assetVersionId, ids));
  if (subs.length) {
    const live = await ctx.db
      .select()
      .from(schema.orders)
      .where(and(inArray(schema.orders.id, subs.map((x) => x.orderId)), notInArray(schema.orders.chainState, ['refunded', 'cancelled'])));
    if (live.length) return true; // settled orders keep the delivered version for buyer re-download
  }
  // funded hosting (seller, free tier, buyers) or an active buyer access window keeps the shared copy;
  // a buyer's access survives the seller's hosting ending because buyer-funded coverage is its own row
  if (await versionHostingActive(ctx, ids)) return true;
  const disputes = await ctx.db.select().from(schema.disputes).where(eq(schema.disputes.status, 'open'));
  if (disputes.some((d) => d.evidence.some((e) => e.assetVersionId && ids.includes(e.assetVersionId)))) return true;
  return false;
}

export async function deleteAsset(ctx: AppContext, assetId: string) {
  const versions = await ctx.db.select().from(schema.assetVersions).where(eq(schema.assetVersions.assetId, assetId));
  for (const v of versions) {
    const files = await ctx.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.versionId, v.id));
    for (const f of files) await ctx.storage.delete(f.objectKey);
    for (const p of (v.preview as { key: string }[] | null) ?? []) await ctx.storage.delete(p.key);
    await ctx.db.delete(schema.assetFiles).where(eq(schema.assetFiles.versionId, v.id));
  }
  await ctx.db.update(schema.assets).set({ deletedAt: new Date() }).where(eq(schema.assets.id, assetId));
}

/**
 * Storage lifecycle: active → grace (read-only, 14 days) → expired. When an account is over
 * quota after expiry, unprotected assets are deleted oldest-first until it fits.
 */
export async function storageExpiryTick(ctx: AppContext, now = new Date()) {
  const { db } = ctx;
  const toGrace = await db.select().from(schema.storageAllocations).where(and(eq(schema.storageAllocations.status, 'active'), lt(schema.storageAllocations.expiresAt, now)));
  for (const a of toGrace) {
    await notify(db, a.accountId, `storage-grace:${a.id}`, 'Storage plan entered grace period', `Your plan expired. Renew within ${STORAGE.graceDays} days; unprotected files above your remaining quota may then be removed.`);
    await db.update(schema.storageAllocations).set({ status: 'grace', graceUntil: new Date(now.getTime() + STORAGE.graceDays * 86_400_000) }).where(eq(schema.storageAllocations.id, a.id));
  }
  const expired = await db.select().from(schema.storageAllocations).where(and(eq(schema.storageAllocations.status, 'grace'), lt(schema.storageAllocations.graceUntil, now)));
  let deleted = 0;
  for (const a of expired) {
    await notify(db, a.accountId, `storage-expired:${a.id}`, 'Storage grace period ended', 'Your paid quota expired. Unprotected files above your remaining quota are eligible for deletion.');
    await db.update(schema.storageAllocations).set({ status: 'expired' }).where(eq(schema.storageAllocations.id, a.id));
    let used = await storageUsedBytes(ctx, a.accountId);
    const quota = await storageQuotaBytes(ctx, a.accountId);
    if (used <= quota) continue;
    const assets = await db.select().from(schema.assets).where(and(eq(schema.assets.ownerId, a.accountId), isNull(schema.assets.deletedAt))).orderBy(schema.assets.createdAt);
    for (const asset of assets) {
      if (used <= quota) break;
      if (await assetProtected(ctx, asset.id)) continue;
      const before = used;
      await deleteAsset(ctx, asset.id);
      used = await storageUsedBytes(ctx, a.accountId);
      deleted++;
      await audit(db, null, 'storage.expired_delete', asset.id, { freedBytes: before - used, allocation: a.id });
    }
  }
  return { toGrace: toGrace.length, expired: expired.length, deleted };
}
