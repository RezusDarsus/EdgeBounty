import { describe, expect, it } from 'vitest';
import { acceptedStorageReimbursement, contributionSettlement, evaluateContributionBatch } from './contributions';

describe('contribution bounty policy', () => {
  it('uses inclusive 92% validity threshold and keeps revision units unpaid', () => {
    expect(evaluateContributionBatch(92n, 100n)).toEqual({ decision: 'partial_acceptance', validityBps: 9200n, acceptedUnits: 92n, rejectedUnits: 8n });
    expect(evaluateContributionBatch(91n, 100n).decision).toBe('revision_required');
    expect(evaluateContributionBatch(91n, 100n).acceptedUnits).toBe(0n);
    expect(evaluateContributionBatch(100n, 100n).decision).toBe('full_acceptance');
  });

  it('pays only accepted units and applies 6% to reward, not reimbursements', () => {
    expect(contributionSettlement({ acceptedUnits: 95n, unitReward: 1_000_000n, commissionBps: 600n, storageReimbursement: 1_000_000n, verificationReimbursement: 0n, rewardReserve: 100_000_000n, reimbursementReserve: 5_000_000n, escrowReserve: 110_000_000n })).toEqual({ grossReward: 95_000_000n, platformFee: 5_700_000n, workerReward: 95_000_000n, storageReimbursement: 1_000_000n, verificationReimbursement: 0n, buyerCost: 101_700_000n });
  });

  it('bounds reward and reimbursement liabilities by prefunded reserves', () => {
    const base = { acceptedUnits: 1n, unitReward: 100n, commissionBps: 600n, storageReimbursement: 50n, verificationReimbursement: 25n, rewardReserve: 100n, reimbursementReserve: 75n, escrowReserve: 200n };
    expect(() => contributionSettlement({ ...base, rewardReserve: 99n })).toThrow(/reward reserve/);
    expect(() => contributionSettlement({ ...base, reimbursementReserve: 74n })).toThrow(/reimbursement reserve/);
    expect(() => contributionSettlement({ ...base, escrowReserve: 174n })).toThrow(/funded escrow/);
  });

  it('prorates accepted storage bytes and caps reimbursement', () => {
    expect(acceptedStorageReimbursement({ prepaidAmount: 1_000n, acceptedBytes: 95n, totalBytes: 100n, cap: 1_000n })).toBe(950n);
    expect(acceptedStorageReimbursement({ prepaidAmount: 1_000n, acceptedBytes: 100n, totalBytes: 100n, cap: 400n })).toBe(400n);
  });
});
