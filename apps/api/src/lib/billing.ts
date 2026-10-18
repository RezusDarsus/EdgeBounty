import { paymentQuoteRate } from './payments.js';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  DEFAULT_MARKETPLACE_PRICING,
  MONTH_SECS,
  checkoutQuote,
  extraDownloadFee,
  hostingFee,
  usdToLamports,
  type AccessMonths,
  type Interval,
  type MarketplacePricing,
} from '@edgebounty/pricing-engine';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { HttpError, badRequest, notFound } from './http.js';
import { createInvoice } from '../routes/verification.js';

type Q = Pick<AppContext['db'], 'select' | 'insert' | 'update' | 'execute'>;
const secs = (d: Date) => BigInt(Math.floor(d.getTime() / 1000));
const date = (s: bigint) => new Date(Number(s) * 1000);
const nowSecs = () => secs(new Date());

export function marketplacePricing(ctx: AppContext): MarketplacePricing {
  return { ...DEFAULT_MARKETPLACE_PRICING, s3RateMicroPerGbMonth: ctx.cfg.S3_RATE_MICRO_PER_GB_MONTH };
}

export async function versionBytes(ctx: AppContext, versionId: string, q: Q = ctx.db): Promise<bigint> {
  const [v] = await q.select({ totalSize: schema.assetVersions.totalSize }).from(schema.assetVersions).where(eq(schema.assetVersions.id, versionId));
  if (!v) throw notFound('asset version');
  return BigInt(v.totalSize);
}

/** Funded hosting intervals of a version (seller prepaid and buyers; legacy allowance records may exist). */
export async function versionCoverage(ctx: AppContext, versionId: string, q: Q = ctx.db): Promise<Interval[]> {
  const rows = await q.select().from(schema.hostingCoverage).where(eq(schema.hostingCoverage.assetVersionId, versionId));
  return rows.map((r) => ({ start: secs(r.startsAt), end: secs(r.endsAt) }));
}

/** End of the coverage run that contains `at` (or `at` itself when uncovered). */
export function coveredUntil(coverage: Interval[], at: bigint): bigint {
  let end = at;
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of coverage) if (c.start <= end && c.end > end) {
      end = c.end;
      grew = true;
    }
  }
  return end;
}

const lockVersion = (q: Q, versionId: string) => q.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'hosting:' + versionId}, 0))`);
const lockAccount = (q: Q, accountId: string) => q.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'free-tier:' + accountId}, 0))`);

/**
 * Legacy free hosting is disabled by default and remains configurable only for an explicit operator policy.
 */
export async function grantFreeCoverage(ctx: AppContext, accountId: string, versionId: string): Promise<boolean> {
  if (ctx.cfg.FREE_RETENTION_DAYS <= 0 || ctx.cfg.FREE_STORAGE_BYTES <= 0) return false;
  return ctx.db.transaction(async (tx) => {
    await lockAccount(tx, accountId);
    const [already] = await tx.select({ id: schema.hostingCoverage.id }).from(schema.hostingCoverage).where(and(eq(schema.hostingCoverage.assetVersionId, versionId), eq(schema.hostingCoverage.source, 'free_tier')));
    if (already) return false;
    const bytes = await versionBytes(ctx, versionId, tx);
    const [r] = await tx
      .select({ n: sql<string>`coalesce(sum(${schema.hostingCoverage.bytes}), 0)` })
      .from(schema.hostingCoverage)
      .where(and(eq(schema.hostingCoverage.payerId, accountId), eq(schema.hostingCoverage.source, 'free_tier'), gt(schema.hostingCoverage.endsAt, new Date())));
    if (BigInt(r.n) + bytes > BigInt(ctx.cfg.FREE_STORAGE_BYTES)) return false;
    const start = nowSecs();
    await tx.insert(schema.hostingCoverage).values({ assetVersionId: versionId, source: 'free_tier', payerId: accountId, bytes, startsAt: date(start), endsAt: date(start + BigInt(ctx.cfg.FREE_RETENTION_DAYS) * 86_400n) });
    return true;
  });
}

/** Sellers pay for listing storage up front: a listing needs LISTING_MIN_COVERAGE_DAYS of funded hosting. */
export async function ensureListingCoverage(ctx: AppContext, accountId: string, versionId: string) {
  // A freshly purchased 30-day interval must remain publishable after wallet confirmation.
  // This tolerance only affects admission; it never extends the paid storage/access interval.
  const need = nowSecs() + BigInt(ctx.cfg.LISTING_MIN_COVERAGE_DAYS) * 86_400n - 300n;
  if (coveredUntil(await versionCoverage(ctx, versionId), nowSecs()) >= need) return { source: 'existing' as const };
  if (await grantFreeCoverage(ctx, accountId, versionId)) {
    if (coveredUntil(await versionCoverage(ctx, versionId), nowSecs()) >= need) return { source: 'free_tier' as const };
  }
  const bytes = await versionBytes(ctx, versionId);
  const usd = hostingFee(bytes, 1n, marketplacePricing(ctx));
  throw new HttpError(402, 'hosting_required', `Prepay listing hosting first (from ${usd} micro-USD/month for ${bytes} bytes): POST /versions/${versionId}/hosting`);
}

export function sellerHostingQuote(ctx: AppContext, bytes: bigint, months: number) {
  const usdMicro = hostingFee(bytes, BigInt(months), marketplacePricing(ctx));
  return { months, bytes, usdMicro, lamports: usdToLamports(usdMicro, paymentQuoteRate(ctx.cfg)), solUsdMicro: paymentQuoteRate(ctx.cfg) };
}

export async function createSellerHostingInvoice(ctx: AppContext, accountId: string, versionId: string, months: number) {
  if (![1, 3].includes(months)) throw badRequest('months must be 1 or 3');
  const q = sellerHostingQuote(ctx, await versionBytes(ctx, versionId), months);
  const invoice = await createInvoice(ctx, accountId, 'storage', q.lamports, { purpose: 'listing_hosting', versionId, months, bytes: q.bytes.toString(), usdMicro: q.usdMicro.toString(), solUsdMicro: q.solUsdMicro.toString(), pricingVersion: DEFAULT_MARKETPLACE_PRICING.version });
  return { quote: q, invoice };
}

/** Locks a buyer checkout for an order and opens the extras invoice (hosting gaps + downloads + min-fee shortfall). */
export async function createCheckout(
  ctx: AppContext,
  p: { orderId: string; listingId: string; buyerId: string; assetVersionId: string; priceLamports: bigint; months: AccessMonths },
) {
  const locked = await ctx.db.transaction(async (tx) => {
    // serialize against concurrent checkouts of the same version so gaps are computed on current coverage
    await lockVersion(tx, p.assetVersionId);
    const objectBytes = await versionBytes(ctx, p.assetVersionId, tx);
    const quote = checkoutQuote({ priceLamports: p.priceLamports, objectBytes, months: p.months, now: nowSecs(), coverage: await versionCoverage(ctx, p.assetVersionId, tx), solUsdMicro: paymentQuoteRate(ctx.cfg), pricing: marketplacePricing(ctx) });
    const [row] = await tx
      .insert(schema.checkoutQuotes)
      .values({
        orderId: p.orderId, listingId: p.listingId, buyerId: p.buyerId, assetVersionId: p.assetVersionId, months: p.months,
        pricingVersion: quote.pricingVersion, solUsdMicro: paymentQuoteRate(ctx.cfg), objectBytes,
        accessStartsAt: date(quote.access.start), accessEndsAt: date(quote.access.end),
        hostingGaps: quote.hostingGaps.map((g) => ({ start: g.start.toString(), end: g.end.toString() })),
        allowanceBytes: quote.allowanceBytes, priceMicro: quote.lamports.price, hostingMicro: quote.lamports.hosting, downloadsMicro: quote.lamports.downloads,
        minimumFeeMicro: quote.lamports.minimumFee, extrasMicro: quote.lamports.extrasTotal, hostingUsdMicro: quote.usd.hosting,
        status: quote.lamports.extrasTotal === 0n ? 'paid' : 'awaiting_payment', paidAt: quote.lamports.extrasTotal === 0n ? new Date() : null,
      })
      .returning();
    return { quote, row };
  });
  // invoice outside the locked transaction (embedded PGlite has a single connection)
  let invoice = null;
  if (locked.quote.lamports.extrasTotal > 0n) {
    invoice = await createInvoice(ctx, p.buyerId, 'other', locked.quote.lamports.extrasTotal, { purpose: 'checkout', checkoutQuoteId: locked.row.id, orderId: p.orderId });
    await ctx.db.update(schema.checkoutQuotes).set({ invoiceId: invoice.id }).where(eq(schema.checkoutQuotes.id, locked.row.id));
  }
  return { ...locked, invoice };
}

/** Funded buyer hosting: the gaps locked at quote time become coverage rows (idempotent per quote). */
async function fundCheckout(ctx: AppContext, quoteId: string) {
  await ctx.db.transaction(async (tx) => {
    const [cq] = await tx.select().from(schema.checkoutQuotes).where(eq(schema.checkoutQuotes.id, quoteId));
    if (!cq || cq.status === 'paid') return;
    await tx.update(schema.checkoutQuotes).set({ status: 'paid', paidAt: new Date() }).where(eq(schema.checkoutQuotes.id, quoteId));
    const total = cq.hostingGaps.reduce((n, g) => n + (BigInt(g.end) - BigInt(g.start)), 0n);
    for (const g of cq.hostingGaps) {
      const s = BigInt(g.start);
      const e = BigInt(g.end);
      // split the paid amount across gaps proportionally (integers; remainder goes to the last gap)
      await tx.insert(schema.hostingCoverage).values({
        assetVersionId: cq.assetVersionId, source: 'buyer', payerId: cq.buyerId, bytes: cq.objectBytes, startsAt: date(s), endsAt: date(e),
        amountMicro: total > 0n ? (cq.hostingMicro * (e - s)) / total : 0n, usdMicro: total > 0n ? (cq.hostingUsdMicro * (e - s)) / total : 0n,
        checkoutQuoteId: cq.id, invoiceId: cq.invoiceId,
      });
    }
  });
}

/** Called by confirmInvoice once an invoice is paid on-chain. */
export async function applyPaidInvoice(ctx: AppContext, inv: typeof schema.invoices.$inferSelect) {
  const m = (inv.metadata ?? {}) as Record<string, any>;
  if (m.purpose === 'listing_hosting') {
    await ctx.db.transaction(async (tx) => {
      await lockVersion(tx, m.versionId);
      const [dup] = await tx.select({ id: schema.hostingCoverage.id }).from(schema.hostingCoverage).where(eq(schema.hostingCoverage.invoiceId, inv.id));
      if (dup) return;
      // prepaid time starts where the current funded run ends, so nothing paid is ever wasted
      const start = coveredUntil(await versionCoverage(ctx, m.versionId, tx), nowSecs());
      await tx.insert(schema.hostingCoverage).values({
        assetVersionId: m.versionId, source: 'seller_prepaid', payerId: inv.accountId, bytes: BigInt(m.bytes),
        startsAt: date(start), endsAt: date(start + BigInt(m.months) * MONTH_SECS), amountMicro: inv.amountMicro, usdMicro: BigInt(m.usdMicro), invoiceId: inv.id,
      });
    });
  }
  if (m.purpose === 'checkout' && m.checkoutQuoteId) await fundCheckout(ctx, m.checkoutQuoteId);
  // confirmInvoice calls this exactly once per invoice (open -> paid transition is guarded)
  if (m.purpose === 'download_credits' && m.entitlementId) {
    await ctx.db.execute(sql`update delivery_entitlements set extra_bytes = extra_bytes + ${BigInt(m.bytes)} where id = ${m.entitlementId}`);
  }
}

export async function createDownloadCreditInvoice(ctx: AppContext, accountId: string, entitlementId: string, gb: number) {
  if (!Number.isInteger(gb) || gb < 1 || gb > 10_000) throw badRequest('gb must be a whole number between 1 and 10000');
  const bytes = BigInt(gb) * 1024n ** 3n;
  const usdMicro = extraDownloadFee(bytes, marketplacePricing(ctx));
  const lamports = usdToLamports(usdMicro, paymentQuoteRate(ctx.cfg));
  const invoice = await createInvoice(ctx, accountId, 'other', lamports, { purpose: 'download_credits', entitlementId, bytes: bytes.toString(), usdMicro: usdMicro.toString() });
  return { bytes, usdMicro, lamports, invoice };
}

/** Entitlement state for delivery: legacy (pre-metering) entitlements stay unmetered and open-ended. */
export async function deliveryAccess(ctx: AppContext, ent: typeof schema.deliveryEntitlements.$inferSelect) {
  if (ent.revokedAt) throw new HttpError(403, 'revoked', 'access revoked');
  if (ent.checkoutQuoteId) {
    const [cq] = await ctx.db.select().from(schema.checkoutQuotes).where(eq(schema.checkoutQuotes.id, ent.checkoutQuoteId));
    if (cq && cq.status !== 'paid') throw new HttpError(402, 'checkout_unpaid', 'Pay the checkout invoice (hosting and downloads) to download');
  }
  if (ent.accessEndsAt && ent.accessEndsAt <= new Date()) throw new HttpError(403, 'access_expired', 'The download period for this purchase ended; the license itself is permanent. Renew access to download again.');
  const metered = ent.allowanceBytes !== null;
  return { metered, remaining: metered ? ent.allowanceBytes! + ent.extraBytes - ent.bytesServed : null };
}

/** Atomic byte reservation against the allowance; returns false when it would exceed it. */
export async function reserveDownloadBytes(ctx: AppContext, entitlementId: string, n: bigint): Promise<boolean> {
  const r = await ctx.db.execute(sql`update delivery_entitlements set bytes_served = bytes_served + ${n}
    where id = ${entitlementId} and (allowance_bytes is null or bytes_served + ${n} <= allowance_bytes + extra_bytes) returning id`);
  return ((r as any).rows ?? r).length > 0;
}
export async function refundDownloadBytes(ctx: AppContext, entitlementId: string, n: bigint) {
  if (n > 0n) await ctx.db.execute(sql`update delivery_entitlements set bytes_served = greatest(0, bytes_served - ${n}) where id = ${entitlementId}`);
}

/** Version objects stay while any funded hosting or active buyer access exists. */
export async function versionHostingActive(ctx: AppContext, versionIds: string[], graceDays = 0): Promise<boolean> {
  if (!versionIds.length) return false;
  for (const id of versionIds) {
    const now = new Date(Date.now() - graceDays * 86_400_000);
    const [c] = await ctx.db.select({ id: schema.hostingCoverage.id }).from(schema.hostingCoverage).where(and(eq(schema.hostingCoverage.assetVersionId, id), gt(schema.hostingCoverage.endsAt, now))).limit(1);
    if (c) return true;
    const ents = await ctx.db.select().from(schema.deliveryEntitlements).where(eq(schema.deliveryEntitlements.assetVersionId, id));
    if (ents.some((e) => !e.revokedAt && (e.accessEndsAt === null || e.accessEndsAt > now))) return true;
  }
  return false;
}


/**
 * Listings whose funded hosting lapsed more than `graceDays` ago are delisted (off-chain; purchases require
 * status 'published'). Files are not deleted here: active buyer access keeps them, and quota expiry
 * handles the rest. Returns the delisted listing ids.
 */
export async function delistUnfundedListings(ctx: AppContext, graceDays: number): Promise<string[]> {
  const published = await ctx.db.select().from(schema.listings).where(eq(schema.listings.status, 'published'));
  const cutoff = new Date(Date.now() - graceDays * 86_400_000);
  const out: string[] = [];
  for (const l of published) {
    // seller-side prepayment keeps a listing for sale; buyer-funded coverage keeps
    // the file for those buyers but does not pay for the seller's listing
    const seller = await ctx.db
      .select()
      .from(schema.hostingCoverage)
      .where(and(eq(schema.hostingCoverage.assetVersionId, l.assetVersionId), inArray(schema.hostingCoverage.source, ['seller_prepaid', 'free_tier'])));
    if (!seller.length) continue; // listed before metered hosting existed: left as-is (see migration notes)
    if (seller.some((c) => c.endsAt > cutoff)) continue;
    await ctx.db.update(schema.listings).set({ status: 'delisted', updatedAt: new Date() }).where(eq(schema.listings.id, l.id));
    out.push(l.id);
  }
  return out;
}
