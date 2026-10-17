/**
 * Marketplace hosting, download and fee pricing. Integer-only: bigint micro-USD (1 USD = 1_000_000n)
 * for USD-denominated rates, bigint lamports for anything settled in SOL. Conversion happens once per
 * quote at a locked rate and always rounds in the platform's favour (ceil), so a quote never underfunds
 * the cost it promises to cover.
 */

export const USD = 1_000_000n;
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const GIB = 1024n ** 3n;
/** Billing month: 30 days. All proration is per second against this length. */
export const MONTH_SECS = 30n * 86_400n;
export const BPS = 10_000n;

export type AccessMonths = 1 | 3 | 6;
export const ACCESS_MONTHS: readonly AccessMonths[] = [1, 3, 6];

export interface MarketplacePricing {
  /** bump when any rate changes; persisted on every quote */
  version: string;
  /** S3 Standard storage, micro-USD per GB-month (ESTIMATE until confirmed in the AWS Pricing Calculator) */
  s3RateMicroPerGbMonth: bigint;
  /** storage cost multiplier (requests, metadata, monitoring, risk, margin) */
  storageMultiplier: bigint;
  /** hosting floor: micro-USD per month (H >= 0.30 x M) */
  hostingMinMicroPerMonth: bigint;
  /** download price, micro-USD per started GB */
  downloadMicroPerGb: bigint;
  /** complete downloads included per access period */
  includedDownloads: Record<AccessMonths, bigint>;
  /** marketplace commission, deducted from the seller payout (mirrors on-chain fee_bps) */
  commissionBps: bigint;
  /** minimum platform revenue per purchase; buyer pays only the shortfall below commission */
  minPlatformRevenueMicro: bigint;
}

export const DEFAULT_MARKETPLACE_PRICING: MarketplacePricing = {
  version: 'mp-2026-10-17',
  s3RateMicroPerGbMonth: 15_000n, // R2 Standard base rate; provider cost is configured separately
  storageMultiplier: 3n,
  hostingMinMicroPerMonth: 300_000n, // 0.30 USD
  downloadMicroPerGb: 150_000n, // 0.15 USD
  includedDownloads: { 1: 1n, 3: 2n, 6: 3n },
  commissionBps: 600n,
  minPlatformRevenueMicro: 0n, // no flat commission or minimum transaction fee
};

export const ceilDiv = (a: bigint, b: bigint) => {
  if (b <= 0n) throw new Error('division by non-positive');
  if (a <= 0n) return 0n;
  return (a + b - 1n) / b;
};
const max = (a: bigint, b: bigint) => (a > b ? a : b);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

/** ceil(GB) with a 1 GB minimum: a 9.8 GB dataset bills as 10 GB, a 2 KB file as 1 GB. */
export function billableGb(bytes: bigint): bigint {
  if (bytes < 0n) throw new Error('negative size');
  return max(1n, ceilDiv(bytes, GIB));
}

/** H = max(0.30 x M, ceil(GB) x M x S3_RATE x 3), micro-USD. */
export function hostingFee(bytes: bigint, months: bigint, p: MarketplacePricing = DEFAULT_MARKETPLACE_PRICING): bigint {
  if (months <= 0n) throw new Error('months must be positive');
  const g = billableGb(bytes);
  return max(p.hostingMinMicroPerMonth * months, g * months * p.s3RateMicroPerGbMonth * p.storageMultiplier);
}

/** Hosting for an arbitrary duration, prorated per second from the 1-month rate, rounded up. */
export function proratedHosting(bytes: bigint, seconds: bigint, p: MarketplacePricing = DEFAULT_MARKETPLACE_PRICING): bigint {
  if (seconds <= 0n) return 0n;
  return ceilDiv(hostingFee(bytes, 1n, p) * seconds, MONTH_SECS);
}

export interface Interval {
  start: bigint; // unix seconds, inclusive
  end: bigint; // unix seconds, exclusive
}

/** Sorted, merged, non-empty intervals. */
export function mergeIntervals(xs: Interval[]): Interval[] {
  const s = xs.filter((x) => x.end > x.start).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const out: Interval[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end) last.end = max(last.end, x.end);
    else out.push({ ...x });
  }
  return out;
}

/** Parts of `want` not covered by `coverage` (the exact gaps a buyer must fund). */
export function uncoveredGaps(want: Interval, coverage: Interval[]): Interval[] {
  const gaps: Interval[] = [];
  let cursor = want.start;
  for (const c of mergeIntervals(coverage)) {
    if (c.end <= cursor) continue;
    if (c.start >= want.end) break;
    if (c.start > cursor) gaps.push({ start: cursor, end: min(c.start, want.end) });
    cursor = max(cursor, c.end);
    if (cursor >= want.end) break;
  }
  if (cursor < want.end) gaps.push({ start: cursor, end: want.end });
  return gaps;
}

export const intervalSecs = (xs: Interval[]) => xs.reduce((n, x) => n + (x.end - x.start), 0n);

/** Bytes a buyer may download in the access period: included complete downloads x object size. */
export function downloadAllowanceBytes(bytes: bigint, months: AccessMonths, p: MarketplacePricing = DEFAULT_MARKETPLACE_PRICING): bigint {
  return p.includedDownloads[months] * bytes;
}

/** Included downloads: N(M) x ceil(GB) x 0.15 USD. */
export function includedDownloadFee(bytes: bigint, months: AccessMonths, p: MarketplacePricing = DEFAULT_MARKETPLACE_PRICING): bigint {
  return p.includedDownloads[months] * billableGb(bytes) * p.downloadMicroPerGb;
}

/** Prepaid extra download credit for `bytes` (rounded up to whole GB). */
export function extraDownloadFee(bytes: bigint, p: MarketplacePricing = DEFAULT_MARKETPLACE_PRICING): bigint {
  if (bytes <= 0n) throw new Error('bytes must be positive');
  return ceilDiv(bytes, GIB) * p.downloadMicroPerGb;
}

/** micro-USD -> lamports at `solUsdMicro` (price of 1 SOL in micro-USD), rounded up. */
export function usdToLamports(microUsd: bigint, solUsdMicro: bigint): bigint {
  if (solUsdMicro <= 0n) throw new Error('SOL/USD rate must be positive');
  return ceilDiv(microUsd * LAMPORTS_PER_SOL, solUsdMicro);
}
export function lamportsToUsdMicro(lamports: bigint, solUsdMicro: bigint): bigint {
  return (lamports * solUsdMicro) / LAMPORTS_PER_SOL;
}

/** Commission is deducted from the seller payout, floor-rounded exactly like the on-chain program. */
export function commission(priceLamports: bigint, p: MarketplacePricing = DEFAULT_MARKETPLACE_PRICING): bigint {
  return (priceLamports * p.commissionBps) / BPS;
}

/** Buyer-paid top-up so platform revenue per purchase reaches the minimum (0 when commission suffices). */
export function minimumFeeShortfall(priceLamports: bigint, solUsdMicro: bigint, p: MarketplacePricing = DEFAULT_MARKETPLACE_PRICING): bigint {
  return max(0n, usdToLamports(p.minPlatformRevenueMicro, solUsdMicro) - commission(priceLamports, p));
}

export interface CheckoutInput {
  priceLamports: bigint;
  objectBytes: bigint;
  months: AccessMonths;
  /** unix seconds */
  now: bigint;
  /** existing funded hosting of this dataset version (seller prepaid, free tier, earlier buyers) */
  coverage: Interval[];
  solUsdMicro: bigint;
  pricing?: MarketplacePricing;
}

export interface CheckoutQuote {
  pricingVersion: string;
  access: Interval;
  /** gaps the buyer funds; persisted as buyer hosting coverage once paid */
  hostingGaps: Interval[];
  allowanceBytes: bigint;
  usd: { hosting: bigint; downloads: bigint; minimumFee: bigint; extrasTotal: bigint };
  lamports: { price: bigint; hosting: bigint; downloads: bigint; minimumFee: bigint; extrasTotal: bigint; total: bigint; commission: bigint; sellerNet: bigint; platformRevenue: bigint };
}

/**
 * Buyer checkout. The listing price settles through escrow (commission out of the seller's share);
 * extras = hosting for the uncovered part of the access period + included downloads + minimum-fee shortfall.
 */
export function checkoutQuote(i: CheckoutInput): CheckoutQuote {
  const p = i.pricing ?? DEFAULT_MARKETPLACE_PRICING;
  if (!ACCESS_MONTHS.includes(i.months)) throw new Error('access period must be 1, 3 or 6 months');
  if (i.priceLamports <= 0n) throw new Error('price must be positive');
  const access = { start: i.now, end: i.now + BigInt(i.months) * MONTH_SECS };
  const hostingGaps = uncoveredGaps(access, i.coverage);
  const hostingUsd = proratedHosting(i.objectBytes, intervalSecs(hostingGaps), p);
  const downloadsUsd = includedDownloadFee(i.objectBytes, i.months, p);
  const minimumFee = minimumFeeShortfall(i.priceLamports, i.solUsdMicro, p);
  const hosting = usdToLamports(hostingUsd, i.solUsdMicro);
  const downloads = usdToLamports(downloadsUsd, i.solUsdMicro);
  const extrasTotal = hosting + downloads + minimumFee;
  const comm = commission(i.priceLamports, p);
  return {
    pricingVersion: p.version,
    access,
    hostingGaps,
    allowanceBytes: downloadAllowanceBytes(i.objectBytes, i.months, p),
    usd: { hosting: hostingUsd, downloads: downloadsUsd, minimumFee: lamportsToUsdMicro(minimumFee, i.solUsdMicro), extrasTotal: hostingUsd + downloadsUsd + lamportsToUsdMicro(minimumFee, i.solUsdMicro) },
    lamports: { price: i.priceLamports, hosting, downloads, minimumFee, extrasTotal, total: i.priceLamports + extrasTotal, commission: comm, sellerNet: i.priceLamports - comm, platformRevenue: comm + minimumFee },
  };
}
