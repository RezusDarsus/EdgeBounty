/** Integer-only contribution bounty policy helpers. Amounts are USDC base units. */

export const CONTRIBUTION_BPS = 10_000n;
export const DEFAULT_BATCH_ACCEPTANCE_BPS = 9_200n;

export type BatchDecision = 'full_acceptance' | 'partial_acceptance' | 'revision_required';

export interface BatchResult {
  decision: BatchDecision;
  validityBps: bigint;
  acceptedUnits: bigint;
  rejectedUnits: bigint;
}

/** The threshold is a file-count ratio, never an AI confidence score. */
export function evaluateContributionBatch(
  validUnits: bigint,
  evaluatedUnits: bigint,
  thresholdBps = DEFAULT_BATCH_ACCEPTANCE_BPS,
): BatchResult {
  if (evaluatedUnits <= 0n) throw new Error('evaluatedUnits must be positive');
  if (validUnits < 0n || validUnits > evaluatedUnits) throw new Error('validUnits must be within evaluatedUnits');
  if (thresholdBps < 0n || thresholdBps > CONTRIBUTION_BPS) throw new Error('thresholdBps must be between 0 and 10000');

  const validityBps = (validUnits * CONTRIBUTION_BPS) / evaluatedUnits;
  const qualifies = validUnits * CONTRIBUTION_BPS >= thresholdBps * evaluatedUnits;
  const decision: BatchDecision = validUnits === evaluatedUnits
    ? 'full_acceptance'
    : qualifies
      ? 'partial_acceptance'
      : 'revision_required';
  return { decision, validityBps, acceptedUnits: decision === 'revision_required' ? 0n : validUnits, rejectedUnits: evaluatedUnits - validUnits };
}

export interface ContributionSettlementInput {
  acceptedUnits: bigint;
  unitReward: bigint;
  commissionBps: bigint;
  storageReimbursement: bigint;
  verificationReimbursement: bigint;
  rewardReserve: bigint;
  reimbursementReserve: bigint;
  escrowReserve: bigint;
}

export interface ContributionSettlement {
  grossReward: bigint;
  platformFee: bigint;
  workerReward: bigint;
  storageReimbursement: bigint;
  verificationReimbursement: bigint;
  buyerCost: bigint;
}

/** Computes bounded settlement. Infrastructure reimbursements are not commissionable revenue. */
export function contributionSettlement(input: ContributionSettlementInput): ContributionSettlement {
  const { acceptedUnits, unitReward, commissionBps, storageReimbursement, verificationReimbursement, rewardReserve, reimbursementReserve, escrowReserve } = input;
  if (acceptedUnits < 0n || unitReward < 0n || storageReimbursement < 0n || verificationReimbursement < 0n) throw new Error('settlement inputs cannot be negative');
  if (commissionBps < 0n || commissionBps > CONTRIBUTION_BPS) throw new Error('commissionBps must be between 0 and 10000');
  const grossReward = acceptedUnits * unitReward;
  if (grossReward > rewardReserve) throw new Error('accepted reward exceeds funded reward reserve');
  if (storageReimbursement + verificationReimbursement > reimbursementReserve) throw new Error('reimbursements exceed funded reimbursement reserve');
  const platformFee = (grossReward * commissionBps) / CONTRIBUTION_BPS;
  const workerReward = grossReward;
  const buyerCost = grossReward + platformFee + storageReimbursement + verificationReimbursement;
  if (buyerCost > escrowReserve) throw new Error('settlement exceeds funded escrow reserve');
  return {
    grossReward,
    platformFee,
    workerReward,
    storageReimbursement,
    verificationReimbursement,
    buyerCost,
  };
}

/** Pro-rates a prepaid storage amount by accepted bytes, preserving integer accounting. */
export function acceptedStorageReimbursement(input: { prepaidAmount: bigint; acceptedBytes: bigint; totalBytes: bigint; cap: bigint }): bigint {
  const { prepaidAmount, acceptedBytes, totalBytes, cap } = input;
  if (prepaidAmount < 0n || acceptedBytes < 0n || totalBytes <= 0n || acceptedBytes > totalBytes || cap < 0n) throw new Error('invalid storage reimbursement inputs');
  const prorated = (prepaidAmount * acceptedBytes) / totalBytes;
  return prorated < cap ? prorated : cap;
}
