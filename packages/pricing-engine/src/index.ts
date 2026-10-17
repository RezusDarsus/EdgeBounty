/**
 * Integer-only pricing. All amounts are bigint lamports (1 SOL = 1_000_000_000n).
 * Never use floating point for anything that is charged or settled.
 */
export const MICRO = 1_000_000_000n; // Legacy constant name: amounts are lamports.
export const BPS = 10_000n;
export const MAX_FEE_BPS = 1_000n;
export const DEFAULT_FEE_BPS = 600n;

export const sol = (whole: number | string): bigint => {
  const input = String(whole);
  if (!/^\d+(?:\.\d{0,9})?$/.test(input)) throw new Error('Enter a nonnegative SOL amount with at most 9 decimals.');
  const [i, f = ''] = input.split('.');
  return BigInt(i) * MICRO + BigInt(f.padEnd(9, '0'));
};

export const formatSol = (micro: bigint): string => {
  const neg = micro < 0n;
  const v = neg ? -micro : micro;
  const frac = (v % MICRO).toString().padStart(9, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${v / MICRO}${frac ? '.' + frac : ''}`;
};

const mulBps = (amount: bigint, bps: bigint) => (amount * bps) / BPS;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

// ------------------------------------------------------------------ settlement (mirror of on-chain util.rs)

export interface Payout {
  sellerNet: bigint;
  platformFee: bigint;
  verifierPaid: bigint;
  buyerRefund: bigint;
}

export function computePayout(amount: bigint, verifierFee: bigint, feeBps: bigint, sellerBps: bigint, verifierEarned: boolean): Payout {
  if (sellerBps < 0n || sellerBps > BPS) throw new Error('invalid seller bps');
  if (feeBps > MAX_FEE_BPS) throw new Error('fee too high');
  const sellerGross = mulBps(amount, sellerBps);
  const platformFee = mulBps(sellerGross, feeBps);
  const verifierPaid = verifierEarned ? verifierFee : 0n;
  return { sellerNet: sellerGross - platformFee, platformFee, verifierPaid, buyerRefund: amount - sellerGross + (verifierFee - verifierPaid) };
}

// ------------------------------------------------------------------ storage rental

export const STORAGE = {
  basePlanGb: 10n,
  basePlanPrice30d: sol('0.0199'),
  extraPerGbMonth: sol('0.001'),
  terms: [7, 30, 90, 365] as const,
  graceDays: 14,
  freeTierGb: 1n,
};
export type StorageTerm = (typeof STORAGE.terms)[number];

/** Quote for `gb` of storage over `days` (one of the allowed terms). */
export function storageQuote(gb: bigint, days: StorageTerm): { price: bigint; breakdown: string } {
  if (gb <= 0n) throw new Error('gb must be positive');
  if (!STORAGE.terms.includes(days)) throw new Error('unsupported term');
  const extraGb = gb > STORAGE.basePlanGb ? gb - STORAGE.basePlanGb : 0n;
  const monthly = STORAGE.basePlanPrice30d + extraGb * STORAGE.extraPerGbMonth;
  // 365 days = 10 months (2 free); other terms pro-rated per day, rounded up to the lamport
  const price = days === 365 ? monthly * 10n : ceilDiv(monthly * BigInt(days), 30n);
  return { price, breakdown: `${gb} GB × ${days}d: base ${formatSol(STORAGE.basePlanPrice30d)}/30d + ${extraGb} GB × ${formatSol(STORAGE.extraPerGbMonth)}/GB-month` };
}

// ------------------------------------------------------------------ verification

export type AnalysisLevel = 'L1' | 'L2' | 'L3' | 'L4';

export interface Workload {
  items: number;
  bytes: number;
  level: AnalysisLevel;
  /** fraction of items sent to an advanced model (L3), as a sample size */
  sampleSize?: number;
  modelBenchmark?: { computeSeconds: number; gpu: boolean };
}

export const RATES = {
  freeL1Items: 5_000,
  freeL1Bytes: 2 * 1024 ** 3,
  sampledAiPrice: sol('0.002'),
  sampledAiItems: 200,
  l2Base: sol('0.005'),
  l2IncludedItems: 5_000,
  l2Per1000Items: sol('0.0005'),
  l3PerItemCost: sol('0.000004'), // measured provider cost per image call (update from unit economics)
  l3Margin: 15_000n, // 1.5x in bps
  l3Min: sol('0.01'),
  modelSetup: sol('0.003'),
  cpuSecond: sol('0.0000004'),
  gpuSecond: sol('0.0000012'),
  storageTransferPerGb: sol('0.00001'),
};

export interface Quote {
  price: bigint;
  lines: { label: string; amount: bigint }[];
  budget: { maxSpend: bigint; maxSeconds: number; maxItems: number; maxApiCalls: number };
}

/** Customer price = fixed + processing + third-party API + storage/transfer + margin. */
export function verificationQuote(w: Workload): Quote {
  const lines: { label: string; amount: bigint }[] = [];
  const gb = BigInt(Math.ceil(w.bytes / 1024 ** 3));
  let apiCalls = 0;
  if (w.level === 'L1') {
    const free = w.items <= RATES.freeL1Items && w.bytes <= RATES.freeL1Bytes;
    lines.push({ label: free ? 'Level 1 technical checks (free tier)' : 'Level 1 technical checks', amount: free ? 0n : sol('0.001') });
  } else if (w.level === 'L2') {
    lines.push({ label: 'Lightweight full-dataset checks (L1+L2)', amount: RATES.l2Base });
    if (w.items > RATES.l2IncludedItems) {
      const extra = BigInt(Math.ceil((w.items - RATES.l2IncludedItems) / 1000));
      lines.push({ label: `${extra}k items over ${RATES.l2IncludedItems}`, amount: extra * RATES.l2Per1000Items });
    }
  } else if (w.level === 'L3') {
    const sample = Math.min(w.sampleSize ?? RATES.sampledAiItems, w.items);
    apiCalls = sample;
    if (sample <= RATES.sampledAiItems) {
      lines.push({ label: `Sampled AI verification (${sample} items)`, amount: RATES.sampledAiPrice });
    } else {
      const cost = BigInt(sample) * RATES.l3PerItemCost;
      const priced = mulBps(cost, RATES.l3Margin);
      lines.push({ label: `Advanced multimodal review (${sample} items)`, amount: priced > RATES.l3Min ? priced : RATES.l3Min });
    }
    lines.push({ label: 'Lightweight full-dataset checks (L1+L2)', amount: RATES.l2Base });
  } else {
    throw new Error('L4 human review is quoted manually');
  }
  if (w.modelBenchmark) {
    lines.push({ label: 'Model inspection / benchmark setup', amount: RATES.modelSetup });
    const rate = w.modelBenchmark.gpu ? RATES.gpuSecond : RATES.cpuSecond;
    lines.push({ label: `Compute (${w.modelBenchmark.computeSeconds}s ${w.modelBenchmark.gpu ? 'GPU' : 'CPU'})`, amount: BigInt(Math.ceil(w.modelBenchmark.computeSeconds)) * rate });
  }
  // the first GB of transfer/scratch storage is included in the base price
  const billableGb = gb > 1n ? gb - 1n : 0n;
  if (billableGb > 0n && w.level !== 'L1') lines.push({ label: `Transfer/storage (${billableGb} GB beyond the first)`, amount: billableGb * RATES.storageTransferPerGb });
  const price = lines.reduce((n, l) => n + l.amount, 0n);
  return {
    price,
    lines,
    budget: {
      maxSpend: price,
      maxSeconds: Math.max(120, Math.ceil(w.items / 50) + (w.modelBenchmark?.computeSeconds ?? 0) * 2),
      maxItems: Math.ceil(w.items * 1.05),
      maxApiCalls: apiCalls,
    },
  };
}

/** True if measured input differs materially (>5% items or bytes) from the preflight manifest. */
export function needsRequote(preflight: { items: number; bytes: number }, actual: { items: number; bytes: number }): boolean {
  const off = (a: number, b: number) => Math.abs(a - b) > Math.max(1, b * 0.05);
  return off(actual.items, preflight.items) || off(actual.bytes, preflight.bytes);
}

/** Provider job: provider receives price minus platform fee. */
export function providerJobSplit(price: bigint, feeBps: bigint = DEFAULT_FEE_BPS) {
  const p = computePayout(price, 0n, feeBps, BPS, false);
  return { provider: p.sellerNet, platform: p.platformFee };
}

/** Compatibility names for existing callers; all values now use lamports. */
export const usdc = (whole: string | number): bigint => {
  const input = String(whole);
  if (!/^\d+(?:\.\d{0,6})?$/.test(input)) throw new Error('Enter a nonnegative USDC amount with at most 6 decimals.');
  const [i, f = ''] = input.split('.');
  return BigInt(i) * 1_000_000n + BigInt(f.padEnd(6, '0'));
};
export const formatUsdc = (amount: bigint): string => {
  const value = amount < 0n ? -amount : amount;
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${amount < 0n ? '-' : ''}${value / 1_000_000n}${fraction ? '.' + fraction : ''}`;
};
export * from './marketplace';
