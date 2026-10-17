import { describe, expect, it } from 'vitest';
import { computePayout, formatSol, needsRequote, storageQuote, sol, verificationQuote } from './index';

describe('pricing engine', () => {
  it('parses and formats exact SOL', () => {
    expect(sol('1.99')).toBe(1_990_000_000n);
    expect(formatSol(1_990_000_000n)).toBe('1.99');
    expect(formatSol(100_000_000_000n)).toBe('100');
    expect(sol('0.000000001')).toBe(1n);
    expect(formatSol(1n)).toBe('0.000000001');
    expect(formatSol(sol('0.005'))).toBe('0.005');
    expect(() => sol('0.0000000001')).toThrow();
    expect(() => sol('1.2.3')).toThrow();
    expect(() => sol('-1')).toThrow();
  });
  it('matches the on-chain payout math (blueprint example)', () => {
    expect(computePayout(sol(100), 0n, 500n, 10_000n, false)).toEqual({ sellerNet: sol(95), platformFee: sol(5), verifierPaid: 0n, buyerRefund: 0n });
    const p = computePayout(100_000_001n, 3_333_333n, 500n, 3_333n, true);
    expect(p.sellerNet + p.platformFee + p.verifierPaid + p.buyerRefund).toBe(100_000_001n + 3_333_333n);
  });
  it('quotes storage terms', () => {
    expect(storageQuote(10n, 30).price).toBe(sol('0.0199'));
    expect(storageQuote(20n, 30).price).toBe(sol('0.0299'));
    expect(storageQuote(10n, 365).price).toBe(sol('0.199'));
    expect(storageQuote(10n, 7).price).toBe(4_643_334n);
  });
  it('quotes verification with budgets and never promises huge datasets for a flat fee', () => {
    expect(verificationQuote({ items: 1000, bytes: 1e8, level: 'L1' }).price).toBe(0n);
    const q = verificationQuote({ items: 205_000, bytes: 10 * 1024 ** 3, level: 'L2' });
    expect(q.price).toBe(sol('0.005') + 200n * sol('0.0005') + 9n * sol('0.00001'));
    expect(q.budget.maxItems).toBeGreaterThan(205_000);
    expect(verificationQuote({ items: 1000, bytes: 1e8, level: 'L3', sampleSize: 200 }).budget.maxApiCalls).toBe(200);
    expect(() => verificationQuote({ items: 1, bytes: 1, level: 'L4' })).toThrow();
  });
  it('detects material workload changes', () => {
    expect(needsRequote({ items: 1000, bytes: 1000 }, { items: 1040, bytes: 1000 })).toBe(false);
    expect(needsRequote({ items: 1000, bytes: 1000 }, { items: 1100, bytes: 1000 })).toBe(true);
  });
});
