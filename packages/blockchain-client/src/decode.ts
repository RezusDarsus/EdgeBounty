import { PublicKey } from '@solana/web3.js';
import { ORDER_STATES, JOB_STATES, type OrderState, type JobState } from '@edgebounty/shared-types';

const hex = (a: number[] | Uint8Array) => Buffer.from(a).toString('hex');
const big = (v: { toString(): string }) => BigInt(v.toString());
const num = (v: { toString(): string }) => Number(v.toString());
const opt = (k: PublicKey) => (k.equals(PublicKey.default) ? null : k.toBase58());
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const variant = (e: Record<string, unknown>) => snake(Object.keys(e)[0]);

export function decodeConfig(a: any) {
  return {
    admin: a.admin as PublicKey,
    pendingAdmin: a.pendingAdmin as PublicKey,
    disputeAuthority: a.disputeAuthority as PublicKey,
    paymentMint: a.paymentMint as PublicKey,
    treasury: a.treasury as PublicKey,
    feeBps: a.feeBps as number,
    reviewWindowSecs: num(a.reviewWindowSecs),
    correctionWindowSecs: num(a.correctionWindowSecs),
    failureBountyGraceSecs: num(a.failureBountyGraceSecs),
    paused: a.paused as boolean,
  };
}
export type ConfigView = ReturnType<typeof decodeConfig>;

export function decodeOrder(address: PublicKey, a: any) {
  const state = variant(a.state) as OrderState;
  if (!ORDER_STATES.includes(state)) throw new Error(`unknown order state ${state}`);
  return {
    address: address.toBase58(),
    buyer: a.buyer.toBase58() as string,
    seller: opt(a.seller) as string,
    verifier: opt(a.verifier),
    listing: opt(a.listing),
    orderId: big(a.orderId),
    kind: variant(a.kind) as 'purchase' | 'bounty',
    state,
    amount: big(a.amount),
    verifierFee: big(a.verifierFee),
    feeBps: a.feeBps as number,
    termsHash: hex(a.termsHash),
    criteriaHash: hex(a.criteriaHash),
    licenseHash: hex(a.licenseHash),
    deadline: num(a.deadline),
    reviewDeadline: num(a.reviewDeadline),
    correctionDeadline: num(a.correctionDeadline),
    submittedAt: num(a.submittedAt),
    maxCorrections: a.maxCorrections as number,
    submissionCount: a.submissionCount as number,
    currentCommitment: hex(a.currentCommitment),
    currentVersion: a.currentVersion as number,
    verificationsDone: a.verificationsDone as number,
    verdictCurrent: a.verdictCurrent as boolean,
    verdictPassed: a.verdictPassed as boolean,
    disputed: a.disputed as boolean,
    disputeCount: a.disputeCount as number,
    designatedSeller: opt(a.designatedSeller),
    arbitrator: opt(a.arbitrator),
    sellerBps: a.sellerBps as number,
    createdAt: num(a.createdAt),
    fundedAt: num(a.fundedAt),
    closedAt: num(a.closedAt),
  };
}
export type OrderView = ReturnType<typeof decodeOrder>;

export function decodeListing(address: PublicKey, a: any) {
  return {
    address: address.toBase58(),
    seller: a.seller.toBase58() as string,
    listingId: big(a.listingId),
    kind: variant(a.kind),
    version: a.version as number,
    assetCommitment: hex(a.assetCommitment),
    termsHash: hex(a.termsHash),
    licenseHash: hex(a.licenseHash),
    price: big(a.price),
    active: a.active as boolean,
    moderated: a.moderated as boolean,
  };
}
export type ListingView = ReturnType<typeof decodeListing>;

export function decodeProvider(address: PublicKey, a: any) {
  return {
    address: address.toBase58(),
    authority: a.authority.toBase58() as string,
    approved: a.approved as boolean,
    capabilities: a.capabilities as number,
    requestedCapabilities: a.requestedCapabilities as number,
    metadataHash: hex(a.metadataHash),
    jobsCompleted: num(a.jobsCompleted),
    jobsDisputed: num(a.jobsDisputed),
    registeredAt: num(a.registeredAt),
  };
}
export type ProviderView = ReturnType<typeof decodeProvider>;

export function decodeAttestation(address: PublicKey, a: any) {
  return {
    address: address.toBase58(),
    subject: a.subject.toBase58() as string,
    verifier: a.verifier.toBase58() as string,
    assetCommitment: hex(a.assetCommitment),
    assetVersion: a.assetVersion as number,
    specHash: hex(a.specHash),
    benchmarkVersion: a.benchmarkVersion as number,
    resultHash: hex(a.resultHash),
    passed: a.passed as boolean,
    issuedAt: num(a.issuedAt),
    expiresAt: num(a.expiresAt),
    revoked: a.revoked as boolean,
  };
}
export type AttestationView = ReturnType<typeof decodeAttestation>;

export function decodeJob(address: PublicKey, a: any) {
  const state = variant(a.state) as JobState;
  if (!JOB_STATES.includes(state)) throw new Error(`unknown job state ${state}`);
  return {
    address: address.toBase58(),
    requester: a.requester.toBase58() as string,
    jobId: big(a.jobId),
    provider: a.provider.toBase58() as string,
    requiredCapability: a.requiredCapability as number,
    assetCommitment: hex(a.assetCommitment),
    specHash: hex(a.specHash),
    price: big(a.price),
    feeBps: a.feeBps as number,
    deadline: num(a.deadline),
    reviewDeadline: num(a.reviewDeadline),
    state,
    resultHash: hex(a.resultHash),
    passed: a.passed as boolean,
    providerBps: a.providerBps as number,
  };
}
export type JobView = ReturnType<typeof decodeJob>;

export function decodeFailureBounty(address: PublicKey, a: any) {
  return {
    address: address.toBase58(),
    creator: a.creator.toBase58() as string,
    bountyId: big(a.bountyId),
    verifier: a.verifier.toBase58() as string,
    modelCommitment: hex(a.modelCommitment),
    specHash: hex(a.specHash),
    termsHash: hex(a.termsHash),
    rewardPerExample: big(a.rewardPerExample),
    verifierFee: big(a.verifierFee),
    maxExamples: a.maxExamples as number,
    maxEvaluations: a.maxEvaluations as number,
    accepted: a.accepted as number,
    evaluations: a.evaluations as number,
    pending: a.pending as number,
    expiresAt: num(a.expiresAt),
    open: a.open as boolean,
  };
}
export type FailureBountyView = ReturnType<typeof decodeFailureBounty>;
