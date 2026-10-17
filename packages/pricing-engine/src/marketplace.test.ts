import { describe, expect, it } from 'vitest';
import {
  GIB,
  MONTH_SECS,
  billableGb,
  checkoutQuote,
  commission,
  downloadAllowanceBytes,
  extraDownloadFee,
  hostingFee,
  includedDownloadFee,
  minimumFeeShortfall,
  proratedHosting,
  uncoveredGaps,
  usdToLamports,
} from './marketplace.js';

const SOL_150 = 150_000_000n; // 1 SOL = 150 USD (micro-USD)
const T0 = 1_800_000_000n;

describe('hosting formula H = max(0.30 x M, ceil(GB) x M x S3_RATE x 3)', () => {
  it('uses the floor for small datasets and the storage term for large ones', () => {
    expect(billableGb(1n)).toBe(1n);
    expect(billableGb(GIB)).toBe(1n);
    expect(billableGb(GIB + 1n)).toBe(2n);
    expect(billableGb((98n * GIB) / 10n)).toBe(10n); // 9.8 GB bills as 10 GB
    // 1 GB, 1 month: storage term 0.045 < floor 0.30
    expect(hostingFee(GIB, 1n)).toBe(300_000n);
    // 10 GB, 1 month: 10 x 0.015 x 3 = 0.45
    expect(hostingFee(10n * GIB, 1n)).toBe(450_000n);
    // 10 GB, 6 months: 2.70 vs floor 1.80
    expect(hostingFee(10n * GIB, 6n)).toBe(2_700_000n);
    expect(hostingFee(1n, 3n)).toBe(900_000n);
  });

  it('prorates per second from the monthly rate, rounding up', () => {
    expect(proratedHosting(10n * GIB, MONTH_SECS)).toBe(450_000n);
    expect(proratedHosting(10n * GIB, MONTH_SECS / 2n)).toBe(225_000n);
    expect(proratedHosting(10n * GIB, 1n)).toBe(1n); // a single second is never free
    expect(proratedHosting(10n * GIB, 0n)).toBe(0n);
  });
});

describe('coverage gaps', () => {
  it('finds exactly the parts of the access period nobody has funded', () => {
    const want = { start: 100n, end: 1_000n };
    expect(uncoveredGaps(want, [])).toEqual([want]);
    expect(uncoveredGaps(want, [{ start: 0n, end: 2_000n }])).toEqual([]);
    expect(uncoveredGaps(want, [{ start: 0n, end: 400n }])).toEqual([{ start: 400n, end: 1_000n }]);
    expect(uncoveredGaps(want, [{ start: 300n, end: 500n }, { start: 450n, end: 700n }])).toEqual([
      { start: 100n, end: 300n },
      { start: 700n, end: 1_000n },
    ]);
  });
});

describe('downloads', () => {
  it('includes 1 / 2 / 3 complete downloads for 1 / 3 / 6 months at 0.15 USD per GB', () => {
    const size = 10n * GIB;
    expect([1, 3, 6].map((m) => downloadAllowanceBytes(size, m as 1 | 3 | 6))).toEqual([size, 2n * size, 3n * size]);
    expect(includedDownloadFee(size, 1)).toBe(1_500_000n);
    expect(includedDownloadFee(size, 3)).toBe(3_000_000n);
    expect(includedDownloadFee(size, 6)).toBe(4_500_000n);
    expect(extraDownloadFee(GIB + 1n)).toBe(300_000n); // started GB
  });
});

describe('marketplace commission', () => {
  it('deducts 6% from the seller with no buyer-paid minimum fee', () => {
    expect(commission(100_000_000n)).toBe(6_000_000n);
    expect(commission(1n)).toBe(0n);
    expect(minimumFeeShortfall(1n, SOL_150)).toBe(0n);
    expect(minimumFeeShortfall(10_000_000n, SOL_150)).toBe(0n);
    expect(100_000_000n - commission(100_000_000n)).toBe(94_000_000n);
  });
});

describe('checkout', () => {
  const base = { priceLamports: 10_000_000n, objectBytes: 10n * GIB, now: T0, solUsdMicro: SOL_150 };

  it('charges no hosting when seller-funded coverage spans the whole access period', () => {
    const q = checkoutQuote({ ...base, months: 3, coverage: [{ start: T0 - 10n, end: T0 + 6n * MONTH_SECS }] });
    expect(q.hostingGaps).toEqual([]);
    expect(q.lamports.hosting).toBe(0n);
    expect(q.usd.hosting).toBe(0n);
  });

  it('charges only the uncovered remainder of the access period', () => {
    const q = checkoutQuote({ ...base, months: 3, coverage: [{ start: T0 - 10n, end: T0 + MONTH_SECS }] });
    expect(q.hostingGaps).toEqual([{ start: T0 + MONTH_SECS, end: T0 + 3n * MONTH_SECS }]);
    expect(q.usd.hosting).toBe(2n * 450_000n);
  });

  it('uses integer arithmetic throughout and the totals add up exactly', () => {
    for (let i = 1; i < 60; i++) {
      const q = checkoutQuote({
        priceLamports: BigInt(i) * 7_919_191n,
        objectBytes: BigInt(i) * 123_456_789n,
        months: ([1, 3, 6] as const)[i % 3],
        now: T0,
        coverage: [{ start: T0, end: T0 + BigInt(i) * 86_399n }],
        solUsdMicro: 97_000_000n + BigInt(i) * 1_337n,
      });
      for (const v of [...Object.values(q.usd), ...Object.values(q.lamports), q.allowanceBytes]) expect(typeof v).toBe('bigint');
      expect(q.lamports.extrasTotal).toBe(q.lamports.hosting + q.lamports.downloads + q.lamports.minimumFee);
      expect(q.lamports.total).toBe(q.lamports.price + q.lamports.extrasTotal);
      expect(q.lamports.sellerNet + q.lamports.commission).toBe(q.lamports.price);
      expect(q.lamports.platformRevenue).toBe(q.lamports.commission + q.lamports.minimumFee);
      // conversions round up: lamports never under-cover the USD cost they pay for
      expect(q.lamports.hosting * (97_000_000n + BigInt(i) * 1_337n)).toBeGreaterThanOrEqual(q.usd.hosting * 1_000_000_000n);
    }
  });

  it('rejects unsupported access periods and non-positive prices', () => {
    expect(() => checkoutQuote({ ...base, months: 2 as any, coverage: [] })).toThrow();
    expect(() => checkoutQuote({ ...base, priceLamports: 0n, months: 1, coverage: [] })).toThrow();
  });
});
