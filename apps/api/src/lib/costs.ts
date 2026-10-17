import { paymentQuoteRate } from './payments.js';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { GIB, ceilDiv, commission, lamportsToUsdMicro } from '@edgebounty/pricing-engine';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { WORKFLOW_PURPOSES } from '../storage/index.js';
import { marketplacePricing } from './billing.js';

const s = (v: bigint | null) => (v === null ? null : v.toString());

/**
 * Monthly cost & revenue report. Every figure derived from configured rates is labelled `estimate`;
 * verified AWS billing would need Cost Explorer read access, which this deployment does not have.
 */
export async function costReport(ctx: AppContext, now = new Date()) {
  const cfg = ctx.cfg;
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const rate = paymentQuoteRate(cfg);
  const toUsd = (lamports: bigint) => lamportsToUsdMicro(lamports, rate);

  // ---- storage (what is physically stored, by category) ----
  const byPurpose = await ctx.db
    .select({ purpose: schema.assets.purpose, bytes: sql<string>`coalesce(sum(${schema.assetFiles.size}), 0)`, files: sql<string>`count(*)` })
    .from(schema.assetFiles)
    .innerJoin(schema.assetVersions, eq(schema.assetVersions.id, schema.assetFiles.versionId))
    .innerJoin(schema.assets, eq(schema.assets.id, schema.assetVersions.assetId))
    .where(isNull(schema.assets.deletedAt))
    .groupBy(schema.assets.purpose);
  let workflowBytes = 0n;
  let customerBytes = 0n;
  for (const r of byPurpose) {
    if ((WORKFLOW_PURPOSES as readonly string[]).includes(r.purpose)) workflowBytes += BigInt(r.bytes);
    else customerBytes += BigInt(r.bytes);
  }
  const [open] = await ctx.db.select({ n: sql<string>`coalesce(sum(${schema.uploads.size}), 0)` }).from(schema.uploads).where(eq(schema.uploads.status, 'open'));
  const storedBytes = workflowBytes + customerBytes;
  const storageUsd = ceilDiv(storedBytes * cfg.S3_RATE_MICRO_PER_GB_MONTH, GIB);

  // ---- bandwidth (bytes actually streamed or handed off via presigned URL this month) ----
  const [bw] = await ctx.db
    .select({ n: sql<string>`coalesce(sum(${schema.deliveryEvents.bytes}), 0)` })
    .from(schema.deliveryEvents)
    .where(and(gte(schema.deliveryEvents.createdAt, monthStart), inArray(schema.deliveryEvents.kind, ['download_completed', 'download_failed', 'token_issued'])));
  const egressBytes = BigInt(bw.n);
  const egressRate = cfg.STORAGE_DRIVER === 'r2' ? 0n : cfg.AWS_EGRESS_MICRO_PER_GB;
  const egressUsd = ceilDiv(egressBytes * egressRate, GIB);

  // ---- verification (recorded upstream usage; free tier at $0 with call counts) ----
  const ver = await ctx.db
    .select({ provider: schema.costEvents.provider, unit: schema.costEvents.unit, qty: sql<string>`coalesce(sum(${schema.costEvents.quantity}), 0)`, usd: sql<string>`coalesce(sum(${schema.costEvents.usdMicro}), 0)` })
    .from(schema.costEvents)
    .where(and(gte(schema.costEvents.createdAt, monthStart), inArray(schema.costEvents.category, ['verification', 'compute'])))
    .groupBy(schema.costEvents.provider, schema.costEvents.unit);
  const verificationUsd = ver.reduce((n, r) => n + BigInt(r.usd), 0n);
  const [runs] = await ctx.db.select({ canonical: sql<string>`count(*)` }).from(schema.verificationRuns).where(gte(schema.verificationRuns.createdAt, monthStart));
  const [reused] = await ctx.db.select({ n: sql<string>`count(*)` }).from(schema.verificationResults).where(and(gte(schema.verificationResults.createdAt, monthStart), sql`${schema.verificationResults.reusedFromJobId} is not null`));

  // ---- fixed infrastructure (configured; null = not configured, never guessed) ----
  const ec2 = cfg.EC2_MONTHLY_USD_MICRO ?? null;
  const ebs = cfg.EBS_MONTHLY_USD_MICRO ?? null;
  const fixedUsd = (ec2 ?? 0n) + (ebs ?? 0n) + cfg.OTHER_FIXED_MONTHLY_USD_MICRO;
  const variableUsd = storageUsd + egressUsd + verificationUsd;

  // ---- revenue (platform share only; seller proceeds are not revenue) ----
  const settled = await ctx.db.select({ amount: schema.orders.amountMicro, chain: schema.orders.chain }).from(schema.orders).where(and(eq(schema.orders.chainState, 'settled'), sql`coalesce((${schema.orders.chain}->>'closedAt')::bigint, 0) >= ${BigInt(Math.floor(monthStart.getTime() / 1000))}`));
  const commissionLamports = settled.reduce((n, o) => {
    const chain = o.chain as { feeBps?: number; sellerBps?: number } | null;
    const gross = o.amount * BigInt(chain?.sellerBps ?? 10_000) / 10_000n;
    return n + commission(gross, { ...marketplacePricing(ctx), commissionBps: BigInt(chain?.feeBps ?? 600) });
  }, 0n);
  const paidQuotes = await ctx.db.select().from(schema.checkoutQuotes).where(and(eq(schema.checkoutQuotes.status, 'paid'), gte(schema.checkoutQuotes.createdAt, monthStart)));
  const minFeeLamports = paidQuotes.reduce((n, q) => n + q.minimumFeeMicro, 0n);
  const buyerHostingLamports = paidQuotes.reduce((n, q) => n + q.hostingMicro, 0n);
  const buyerDownloadLamports = paidQuotes.reduce((n, q) => n + q.downloadsMicro, 0n);
  const paidInvoices = await ctx.db.select().from(schema.invoices).where(and(eq(schema.invoices.status, 'paid'), gte(schema.invoices.createdAt, monthStart)));
  const sum = (pred: (m: Record<string, any>, k: string) => boolean) => paidInvoices.filter((i) => pred((i.metadata ?? {}) as any, i.kind)).reduce((n, i) => n + i.amountMicro, 0n);
  const sellerHostingLamports = sum((m) => m.purpose === 'listing_hosting');
  const downloadCreditLamports = sum((m) => m.purpose === 'download_credits');
  const verificationLamports = sum((_m, k) => k === 'verification');
  const platformRevenueUsd = toUsd(commissionLamports + minFeeLamports);
  const passThroughUsd = toUsd(buyerHostingLamports + buyerDownloadLamports + sellerHostingLamports + downloadCreditLamports);
  const revenueUsd = platformRevenueUsd + passThroughUsd + toUsd(verificationLamports);

  // ---- break-even: purchases needed to cover fixed costs at the realised (or minimum) platform take ----
  const perPurchaseUsd = settled.length ? platformRevenueUsd / BigInt(settled.length) : marketplacePricing(ctx).minPlatformRevenueMicro;
  const breakEvenPurchases = perPurchaseUsd > 0n ? ceilDiv(fixedUsd, perPurchaseUsd) : null;
  const projectedUsd = fixedUsd + variableUsd;
  const budget = cfg.BUDGET_MONTHLY_USD_MICRO ?? null;

  return {
    period: { from: monthStart.toISOString(), to: now.toISOString() },
    currency: `micro-USD (1 USD = 1,000,000); payment currency ${cfg.PAYMENT_CURRENCY}`,
    solUsdMicro: s(rate),
    billingData: { source: 'none', verified: false, note: 'All costs are estimates from configured rates. Verified AWS billing needs Cost Explorer read access (ce:GetCostAndUsage), which is not granted.' },
    storage: {
      storedBytes: s(storedBytes), customerBytes: s(customerBytes), workflowBytes: s(workflowBytes), openReservationBytes: s(BigInt(open.n)),
      byPurpose: byPurpose.map((r) => ({ purpose: r.purpose, bytes: r.bytes, files: Number(r.files) })),
      estimatedMonthlyUsd: s(storageUsd), rateMicroPerGbMonth: s(cfg.S3_RATE_MICRO_PER_GB_MONTH), estimate: true,
    },
    bandwidth: { egressBytes: s(egressBytes), estimatedUsd: s(egressUsd), rateMicroPerGb: s(egressRate), estimate: true, accounting: 'authorized bytes for gateway transfers; streamed bytes for local transfers', note: cfg.STORAGE_DRIVER === 'r2' ? 'R2 bandwidth estimate excludes Worker and object-operation charges; legacy S3 usage requires separate accounting.' : 'AWS monthly free egress allowance not deducted (conservative).' },
    verification: { canonicalRuns: Number(runs.canonical), reusedResults: Number(reused.n), usage: ver.map((r) => ({ provider: r.provider, unit: r.unit, quantity: r.qty, usd: r.usd })), recordedUsd: s(verificationUsd), estimate: true },
    fixed: { ec2MonthlyUsd: s(ec2), ebsMonthlyUsd: s(ebs), otherMonthlyUsd: s(cfg.OTHER_FIXED_MONTHLY_USD_MICRO), configured: ec2 !== null && ebs !== null, estimate: true },
    revenue: {
      settledPurchases: settled.length,
      platformRevenueUsd: s(platformRevenueUsd), commissionUsd: s(toUsd(commissionLamports)), minimumFeesUsd: s(toUsd(minFeeLamports)),
      hostingAndDownloadsUsd: s(passThroughUsd), verificationFeesUsd: s(toUsd(verificationLamports)), totalUsd: s(revenueUsd),
    },
    breakEven: { fixedMonthlyUsd: s(fixedUsd), platformRevenuePerPurchaseUsd: s(perPurchaseUsd), purchasesNeeded: s(breakEvenPurchases), basis: settled.length ? 'realised average this month' : 'minimum platform revenue per purchase' },
    budget: budget === null ? { configured: false } : { configured: true, monthlyUsd: s(budget), projectedUsd: s(projectedUsd), alert: projectedUsd > budget, usedBps: Number((projectedUsd * 10_000n) / (budget || 1n)) },
  };
}
