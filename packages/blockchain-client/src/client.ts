import { AnchorProvider, BN, Program, type Idl } from '@anchor-lang/core';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  getAccount,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
} from '@solana/spl-token';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Commitment,
  type Signer,
} from '@solana/web3.js';
import idlJson from './idl/edgebounty_marketplace.json' with { type: 'json' };
import type { EdgebountyMarketplace } from './idl/edgebounty_marketplace';
import { pdas, PROGRAM_ID } from './pdas';
import { decodeAttestation, decodeFailureBounty, decodeJob, decodeListing, decodeOrder, decodeProvider, decodeConfig, type OrderView } from './decode';

export type Bytes32 = Uint8Array | number[];
const arr = (b: Bytes32): number[] => {
  const a = Array.from(b);
  if (a.length !== 32) throw new Error('expected 32 bytes');
  return a;
};
const bn = (v: bigint | number) => new BN(v.toString());
const NONE = PublicKey.default;

export interface PlatformParams {
  feeBps: number;
  reviewWindowSecs: number;
  correctionWindowSecs: number;
  failureBountyGraceSecs: number;
  disputeAuthority: PublicKey;
}
export interface ListingTerms {
  assetCommitment: Bytes32;
  termsHash: Bytes32;
  licenseHash: Bytes32;
  price: bigint;
}
export type AssetKindArg = 'dataset' | 'model' | 'code' | 'other';
export interface BountyParams {
  amount: bigint;
  verifier?: PublicKey;
  verifierFee?: bigint;
  verifierCapability?: number;
  termsHash: Bytes32;
  criteriaHash: Bytes32;
  licenseHash: Bytes32;
  deadline: number;
  maxCorrections: number;
  /** Only this wallet may accept (milestone continuations / direct hire). */
  designatedSeller?: PublicKey;
  /** Agreed independent arbitrator who may resolve disputes on this order. */
  arbitrator?: PublicKey;
}
export interface VerdictParams {
  resultHash: Bytes32;
  specHash: Bytes32;
  benchmarkVersion: number;
  passed: boolean;
  expiresAt?: number;
}

/** Read-only wallet used when the client only builds instructions or reads accounts. */
class ReadonlyWallet {
  publicKey = NONE;
  payer = Keypair.generate();
  async signTransaction<T>(t: T): Promise<T> {
    throw new Error('read-only wallet');
  }
  async signAllTransactions<T>(t: T[]): Promise<T[]> {
    throw new Error('read-only wallet');
  }
}

export class EdgeBountyClient {
  readonly program: Program<EdgebountyMarketplace>;
  readonly pda: ReturnType<typeof pdas>;
  readonly programId: PublicKey;

  constructor(readonly connection: Connection, programId: PublicKey = PROGRAM_ID) {
    const provider = new AnchorProvider(connection, new ReadonlyWallet() as never, { commitment: 'confirmed' });
    const idl = { ...(idlJson as Idl), address: programId.toBase58() };
    this.program = new Program(idl as never, provider) as unknown as Program<EdgebountyMarketplace>;
    this.programId = programId;
    this.pda = pdas(programId);
  }

  private get m() {
    return this.program.methods as any;
  }

  ata(owner: PublicKey, mint: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(mint, owner, true);
  }

  ensureAta(payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
    return createAssociatedTokenAccountIdempotentInstruction(payer, this.ata(owner, mint), owner, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  }

  /** Wrap only the shortfall, in the same transaction as funding the escrow. */
  async preparePayment(payer: PublicKey, mint: PublicKey, amount: bigint): Promise<TransactionInstruction[]> {
    if (!mint.equals(NATIVE_MINT)) return []; // Compatibility for existing token deployments.
    const token = this.ata(payer, mint);
    const info = await this.connection.getAccountInfo(token);
    const balance = info ? (await getAccount(this.connection, token)).amount : 0n;
    const shortfall = amount > balance ? amount - balance : 0n;
    return [this.ensureAta(payer, payer, mint), ...(shortfall ? [SystemProgram.transfer({ fromPubkey: payer, toPubkey: token, lamports: shortfall }), createSyncNativeInstruction(token)] : [])];
  }

  /** Return received wrapped SOL and account rent to the owner's native SOL wallet. */
  unwrapSol(owner: PublicKey) {
    return [createCloseAccountInstruction(this.ata(owner, NATIVE_MINT), owner, owner)];
  }

  // ================================================================ reads

  async config() {
    const a = await this.program.account.platformConfig.fetchNullable(this.pda.config());
    return a ? decodeConfig(a) : null;
  }
  async order(order: PublicKey): Promise<OrderView | null> {
    const a = await this.program.account.order.fetchNullable(order);
    return a ? decodeOrder(order, a) : null;
  }
  async listing(listing: PublicKey) {
    const a = await this.program.account.listing.fetchNullable(listing);
    return a ? decodeListing(listing, a) : null;
  }
  async provider(authority: PublicKey) {
    const k = this.pda.provider(authority);
    const a = await this.program.account.provider.fetchNullable(k);
    return a ? decodeProvider(k, a) : null;
  }
  async attestation(k: PublicKey) {
    const a = await this.program.account.attestation.fetchNullable(k);
    return a ? decodeAttestation(k, a) : null;
  }
  async job(k: PublicKey) {
    const a = await this.program.account.verificationJob.fetchNullable(k);
    return a ? decodeJob(k, a) : null;
  }
  async failureBounty(k: PublicKey) {
    const a = await this.program.account.failureBounty.fetchNullable(k);
    return a ? decodeFailureBounty(k, a) : null;
  }
  /**
   * Scans all accounts of a type, skipping any that fail to decode (e.g. accounts written by an
   * older program layout) instead of failing the whole scan. Skipped addresses are reported.
   */
  async scan<T>(name: string, decode: (k: PublicKey, a: any) => T): Promise<T[]> {
    const coder = this.program.coder.accounts as any;
    const filter = coder.memcmp(name);
    const raw = await this.connection.getProgramAccounts(this.programId, { filters: [{ memcmp: { offset: filter.offset ?? 0, bytes: filter.bytes } }] });
    const out: T[] = [];
    for (const { pubkey, account } of raw) {
      try {
        out.push(decode(pubkey, coder.decode(name, account.data)));
      } catch {
        this.skipped.add(`${name}:${pubkey.toBase58()}`);
      }
    }
    return out;
  }
  readonly skipped = new Set<string>();
  async allOrders() {
    return this.scan('order', decodeOrder);
  }
  async allListings() {
    return this.scan('listing', decodeListing);
  }
  async allProviders() {
    return this.scan('provider', decodeProvider);
  }
  async allJobs() {
    return this.scan('verificationJob', decodeJob);
  }
  async allFailureBounties() {
    return this.scan('failureBounty', decodeFailureBounty);
  }
  async allAttestations() {
    return this.scan('attestation', decodeAttestation);
  }
  async allFailureExamples() {
    return this.scan('failureExample', (k, a) => ({ address: k.toBase58(), state: Object.keys(a.state)[0] as 'pending' | 'accepted' | 'rejected' }));
  }
  async receipt(reference: Uint8Array) {
    const k = this.pda.receipt(reference);
    const a: any = await this.program.account.serviceReceipt.fetchNullable(k);
    return a ? { address: k.toBase58(), payer: a.payer.toBase58(), amount: BigInt(a.amount.toString()), kind: a.kind as number, paidAt: Number(a.paidAt) } : null;
  }
  async licenseReceipt(order: PublicKey) {
    const a: any = await this.program.account.licenseReceipt.fetchNullable(this.pda.license(order));
    return a
      ? { buyer: a.buyer.toBase58(), seller: a.seller.toBase58(), granted: a.granted as boolean, assetCommitment: Buffer.from(a.assetCommitment).toString('hex'), assetVersion: a.assetVersion as number, licenseHash: Buffer.from(a.licenseHash).toString('hex') }
      : null;
  }
  async tokenBalance(tokenAccount: PublicKey): Promise<bigint> {
    try {
      const b = await this.connection.getTokenAccountBalance(tokenAccount);
      return BigInt(b.value.amount);
    } catch {
      return 0n;
    }
  }

  // ================================================================ platform

  async initializePlatform(admin: PublicKey, mint: PublicKey, treasury: PublicKey, p: PlatformParams) {
    return [
      await this.m
        .initializePlatform(this.platformArgs(p))
        .accountsStrict({ admin, config: this.pda.config(), paymentMint: mint, treasury, systemProgram: SystemProgram.programId })
        .instruction(),
    ];
  }
  private platformArgs(p: PlatformParams) {
    return { feeBps: p.feeBps, reviewWindowSecs: bn(p.reviewWindowSecs), correctionWindowSecs: bn(p.correctionWindowSecs), failureBountyGraceSecs: bn(p.failureBountyGraceSecs), disputeAuthority: p.disputeAuthority };
  }
  async updateConfig(admin: PublicKey, p: PlatformParams) {
    return [await this.m.updateConfig(this.platformArgs(p)).accountsStrict({ admin, config: this.pda.config() }).instruction()];
  }
  async setPaused(admin: PublicKey, paused: boolean) {
    return [await this.m.setPaused(paused).accountsStrict({ admin, config: this.pda.config() }).instruction()];
  }
  async proposeAdmin(admin: PublicKey, newAdmin: PublicKey) {
    return [await this.m.proposeAdmin(newAdmin).accountsStrict({ admin, config: this.pda.config() }).instruction()];
  }
  async acceptAdmin(newAdmin: PublicKey) {
    return [await this.m.acceptAdmin().accountsStrict({ newAdmin, config: this.pda.config() }).instruction()];
  }

  // ================================================================ providers

  async registerProvider(authority: PublicKey, metadataHash: Bytes32, requestedCapabilities: number) {
    return [
      await this.m
        .registerProvider(arr(metadataHash), requestedCapabilities)
        .accountsStrict({ authority, provider: this.pda.provider(authority), systemProgram: SystemProgram.programId })
        .instruction(),
    ];
  }
  async updateProvider(authority: PublicKey, metadataHash: Bytes32, requestedCapabilities: number) {
    return [await this.m.updateProvider(arr(metadataHash), requestedCapabilities).accountsStrict({ authority, provider: this.pda.provider(authority) }).instruction()];
  }
  async reviewProvider(admin: PublicKey, providerAuthority: PublicKey, approved: boolean, capabilities: number) {
    return [
      await this.m
        .reviewProvider(approved, capabilities)
        .accountsStrict({ admin, config: this.pda.config(), provider: this.pda.provider(providerAuthority) })
        .instruction(),
    ];
  }

  // ================================================================ listings

  private terms(t: ListingTerms) {
    return { assetCommitment: arr(t.assetCommitment), termsHash: arr(t.termsHash), licenseHash: arr(t.licenseHash), price: bn(t.price) };
  }
  async createListing(seller: PublicKey, listingId: bigint, kind: AssetKindArg, t: ListingTerms) {
    const listing = this.pda.listing(seller, listingId);
    const ix = await this.m
      .createListing(bn(listingId), { [kind]: {} }, this.terms(t))
      .accountsStrict({ seller, config: this.pda.config(), listing, systemProgram: SystemProgram.programId })
      .instruction();
    return { listing, ixs: [ix] };
  }
  async updateListingVersion(seller: PublicKey, listing: PublicKey, t: ListingTerms) {
    return [await this.m.updateListingVersion(this.terms(t)).accountsStrict({ seller, listing }).instruction()];
  }
  async setListingActive(seller: PublicKey, listing: PublicKey, active: boolean) {
    return [await this.m.setListingActive(active).accountsStrict({ seller, listing }).instruction()];
  }
  async moderateListing(admin: PublicKey, listing: PublicKey, moderated: boolean) {
    return [await this.m.moderateListing(moderated).accountsStrict({ admin, config: this.pda.config(), listing }).instruction()];
  }

  // ================================================================ orders

  async createOrder(
    buyer: PublicKey,
    listing: PublicKey,
    orderId: bigint,
    p: { expectedPrice: bigint; expectedVersion: number; verifier?: PublicKey; verifierFee?: bigint; verifierCapability?: number },
  ) {
    const cfg = await this.requireConfig();
    const order = this.pda.order(buyer, orderId);
    const ix = await this.m
      .createOrder(bn(orderId), {
        expectedPrice: bn(p.expectedPrice),
        expectedVersion: p.expectedVersion,
        verifier: p.verifier ?? NONE,
        verifierFee: bn(p.verifierFee ?? 0n),
        verifierCapability: p.verifierCapability ?? 0,
      })
      .accountsStrict({
        buyer,
        config: this.pda.config(),
        listing,
        order,
        vault: this.pda.vault(order),
        mint: cfg.paymentMint,
        buyerToken: this.ata(buyer, cfg.paymentMint),
        verifierProvider: p.verifier ? this.pda.provider(p.verifier) : null,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return { order, ixs: [...await this.preparePayment(buyer, cfg.paymentMint, p.expectedPrice + (p.verifierFee ?? 0n)), ix] };
  }

  /** create_bounty + fund_bounty in one transaction. */
  async createAndFundBounty(buyer: PublicKey, orderId: bigint, p: BountyParams) {
    const cfg = await this.requireConfig();
    const order = this.pda.order(buyer, orderId);
    const create = await this.m
      .createBounty(bn(orderId), {
        amount: bn(p.amount),
        verifier: p.verifier ?? NONE,
        verifierFee: bn(p.verifierFee ?? 0n),
        verifierCapability: p.verifierCapability ?? 0,
        termsHash: arr(p.termsHash),
        criteriaHash: arr(p.criteriaHash),
        licenseHash: arr(p.licenseHash),
        deadline: bn(p.deadline),
        maxCorrections: p.maxCorrections,
        designatedSeller: p.designatedSeller ?? NONE,
        arbitrator: p.arbitrator ?? NONE,
      })
      .accountsStrict({
        buyer,
        config: this.pda.config(),
        order,
        verifierProvider: p.verifier ? this.pda.provider(p.verifier) : null,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const fund = await this.fundBountyIx(buyer, order, cfg.paymentMint);
    return { order, ixs: [...await this.preparePayment(buyer, cfg.paymentMint, p.amount + (p.verifierFee ?? 0n)), create, fund] };
  }
  private async fundBountyIx(buyer: PublicKey, order: PublicKey, mint: PublicKey) {
    return this.m
      .fundBounty()
      .accountsStrict({
        buyer,
        config: this.pda.config(),
        order,
        vault: this.pda.vault(order),
        mint,
        buyerToken: this.ata(buyer, mint),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }
  async cancelOrder(buyer: PublicKey, order: PublicKey) {
    const o = await this.requireOrder(order);
    const cfg = await this.requireConfig();
    const funded = o.state === 'funded';
    return [
      await this.m
        .cancelOrder()
        .accountsStrict({
          buyer,
          order,
          vault: funded ? this.pda.vault(order) : null,
          mint: funded ? cfg.paymentMint : null,
          buyerToken: funded ? this.ata(buyer, cfg.paymentMint) : null,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    ];
  }
  async acceptBounty(seller: PublicKey, order: PublicKey) {
    return [await this.m.acceptBounty().accountsStrict({ seller, order }).instruction()];
  }
  async submitDeliverable(seller: PublicKey, order: PublicKey, commitment: Bytes32, version: number) {
    const o = await this.requireOrder(order);
    return [
      await this.m
        .submitDeliverable(arr(commitment), version)
        .accountsStrict({ seller, order, submission: this.pda.submission(order, o.submissionCount), systemProgram: SystemProgram.programId })
        .instruction(),
    ];
  }
  async submitOrderVerification(verifier: PublicKey, order: PublicKey, v: VerdictParams) {
    const o = await this.requireOrder(order);
    const attestation = this.pda.attestation(order, o.submissionCount);
    const ix = await this.m
      .submitOrderVerification({ resultHash: arr(v.resultHash), specHash: arr(v.specHash), benchmarkVersion: v.benchmarkVersion, passed: v.passed, expiresAt: bn(v.expiresAt ?? 0) })
      .accountsStrict({ verifier, order, provider: this.pda.provider(verifier), attestation, systemProgram: SystemProgram.programId })
      .instruction();
    return { attestation, ixs: [ix] };
  }
  async acceptDeliverable(buyer: PublicKey, order: PublicKey) {
    return [await this.m.acceptDeliverable().accountsStrict({ buyer, order }).instruction()];
  }
  async rejectDeliverable(buyer: PublicKey, order: PublicKey) {
    return [await this.m.rejectDeliverable().accountsStrict({ buyer, order }).instruction()];
  }

  // ================================================================ disputes

  async openDispute(opener: PublicKey, order: PublicKey, reasonHash: Bytes32) {
    const o = await this.requireOrder(order);
    return [
      await this.m
        .openDispute(arr(reasonHash))
        .accountsStrict({ opener, order, dispute: this.pda.dispute(order, o.disputeCount), systemProgram: SystemProgram.programId })
        .instruction(),
    ];
  }
  async addDisputeEvidence(party: PublicKey, order: PublicKey, evidenceHash: Bytes32) {
    const o = await this.requireOrder(order);
    return [await this.m.addDisputeEvidence(arr(evidenceHash)).accountsStrict({ party, order, dispute: this.pda.dispute(order, Math.max(o.disputeCount - 1, 0)) }).instruction()];
  }
  async resolveDispute(disputeAuthority: PublicKey, order: PublicKey, resolution: 'correction' | 'split', sellerBps: number) {
    const o = await this.requireOrder(order);
    return [
      await this.m
        .resolveDispute({ [resolution]: {} }, sellerBps)
        .accountsStrict({ disputeAuthority, config: this.pda.config(), order, dispute: this.pda.dispute(order, Math.max(o.disputeCount - 1, 0)) })
        .instruction(),
    ];
  }

  // ================================================================ settlement

  /** Permissionless crank; creates any missing ATAs first (paid by `payer`). */
  async settleOrder(payer: PublicKey, order: PublicKey) {
    const o = await this.requireOrder(order);
    const cfg = await this.requireConfig();
    const mint = cfg.paymentMint;
    const seller = new PublicKey(o.seller);
    const buyer = new PublicKey(o.buyer);
    const verifierEarned = o.verifier && o.verificationsDone > 0 && o.verifierFee > 0n;
    const verifier = verifierEarned ? new PublicKey(o.verifier!) : null;
    const pre = [this.ensureAta(payer, seller, mint), this.ensureAta(payer, buyer, mint)];
    if (verifier) pre.push(this.ensureAta(payer, verifier, mint));
    const ix = await this.m
      .settleOrder()
      .accountsStrict({
        payer,
        config: this.pda.config(),
        order,
        vault: this.pda.vault(order),
        mint,
        sellerToken: this.ata(seller, mint),
        buyerToken: this.ata(buyer, mint),
        treasury: cfg.treasury,
        verifierToken: verifier ? this.ata(verifier, mint) : null,
        buyer,
        licenseReceipt: this.pda.license(order),
        sellerReputation: this.pda.reputation(seller),
        buyerReputation: this.pda.reputation(buyer),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...pre, ix];
  }
  async refundOrder(buyer: PublicKey, order: PublicKey) {
    const o = await this.requireOrder(order);
    const cfg = await this.requireConfig();
    const mint = cfg.paymentMint;
    const verifier = o.verifier && o.verificationsDone > 0 && o.verifierFee > 0n ? new PublicKey(o.verifier) : null;
    const pre = verifier ? [this.ensureAta(buyer, verifier, mint)] : [];
    const ix = await this.m
      .refundOrder()
      .accountsStrict({
        buyer,
        order,
        vault: this.pda.vault(order),
        mint,
        buyerToken: this.ata(buyer, mint),
        verifierToken: verifier ? this.ata(verifier, mint) : null,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
    return [...pre, ix];
  }

  // ================================================================ failure bounties

  async createFailureBounty(
    creator: PublicKey,
    bountyId: bigint,
    p: { verifier: PublicKey; modelCommitment: Bytes32; specHash: Bytes32; termsHash: Bytes32; rewardPerExample: bigint; verifierFee: bigint; maxExamples: number; maxEvaluations: number; expiresAt: number },
  ) {
    const cfg = await this.requireConfig();
    const bounty = this.pda.failureBounty(creator, bountyId);
    const ix = await this.m
      .createFailureBounty(bn(bountyId), {
        verifier: p.verifier,
        modelCommitment: arr(p.modelCommitment),
        specHash: arr(p.specHash),
        termsHash: arr(p.termsHash),
        rewardPerExample: bn(p.rewardPerExample),
        verifierFee: bn(p.verifierFee),
        maxExamples: p.maxExamples,
        maxEvaluations: p.maxEvaluations,
        expiresAt: bn(p.expiresAt),
      })
      .accountsStrict({
        creator,
        config: this.pda.config(),
        bounty,
        vault: this.pda.failureVault(bounty),
        mint: cfg.paymentMint,
        creatorToken: this.ata(creator, cfg.paymentMint),
        verifierProvider: this.pda.provider(p.verifier),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return { bounty, ixs: [...await this.preparePayment(creator, cfg.paymentMint, p.rewardPerExample * BigInt(p.maxExamples) + p.verifierFee * BigInt(p.maxEvaluations)), ix] };
  }
  async submitFailureExample(contributor: PublicKey, bounty: PublicKey, commitment: Uint8Array) {
    const example = this.pda.failureExample(bounty, commitment);
    const ix = await this.m
      .submitFailureExample(arr(commitment))
      .accountsStrict({ contributor, bounty, example, systemProgram: SystemProgram.programId })
      .instruction();
    return { example, ixs: [ix] };
  }
  async verifyFailureExample(verifier: PublicKey, bounty: PublicKey, example: PublicKey, passed: boolean, resultHash: Bytes32) {
    const cfg = await this.requireConfig();
    const mint = cfg.paymentMint;
    const e: any = await this.program.account.failureExample.fetch(example);
    const contributor: PublicKey = e.contributor;
    return [
      this.ensureAta(verifier, contributor, mint),
      this.ensureAta(verifier, verifier, mint),
      await this.m
        .verifyFailureExample(passed, arr(resultHash))
        .accountsStrict({
          verifier,
          config: this.pda.config(),
          bounty,
          example,
          vault: this.pda.failureVault(bounty),
          mint,
          contributorToken: this.ata(contributor, mint),
          verifierToken: this.ata(verifier, mint),
          treasury: cfg.treasury,
          provider: this.pda.provider(verifier),
          attestation: this.pda.attestation(example, 0),
          contributorReputation: this.pda.reputation(contributor),
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    ];
  }
  async closeFailureBounty(creator: PublicKey, bounty: PublicKey) {
    const cfg = await this.requireConfig();
    return [
      await this.m
        .closeFailureBounty()
        .accountsStrict({
          creator,
          config: this.pda.config(),
          bounty,
          vault: this.pda.failureVault(bounty),
          mint: cfg.paymentMint,
          creatorToken: this.ata(creator, cfg.paymentMint),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    ];
  }

  // ================================================================ verification jobs

  async createVerificationJob(
    requester: PublicKey,
    jobId: bigint,
    p: { provider?: PublicKey; requiredCapability: number; assetCommitment: Bytes32; specHash: Bytes32; price: bigint; deadline: number },
  ) {
    const cfg = await this.requireConfig();
    const job = this.pda.job(requester, jobId);
    const ix = await this.m
      .createVerificationJob(bn(jobId), {
        provider: p.provider ?? NONE,
        requiredCapability: p.requiredCapability,
        assetCommitment: arr(p.assetCommitment),
        specHash: arr(p.specHash),
        price: bn(p.price),
        deadline: bn(p.deadline),
      })
      .accountsStrict({
        requester,
        config: this.pda.config(),
        job,
        vault: this.pda.jobVault(job),
        mint: cfg.paymentMint,
        requesterToken: this.ata(requester, cfg.paymentMint),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return { job, ixs: [...await this.preparePayment(requester, cfg.paymentMint, p.price), ix] };
  }
  async acceptVerificationJob(authority: PublicKey, job: PublicKey) {
    return [await this.m.acceptVerificationJob().accountsStrict({ authority, provider: this.pda.provider(authority), job }).instruction()];
  }
  async submitVerificationJobResult(authority: PublicKey, job: PublicKey, r: { resultHash: Bytes32; passed: boolean; assetVersion: number; benchmarkVersion: number; expiresAt?: number }) {
    const attestation = this.pda.attestation(job, 0);
    const ix = await this.m
      .submitVerificationJobResult({ resultHash: arr(r.resultHash), passed: r.passed, assetVersion: r.assetVersion, benchmarkVersion: r.benchmarkVersion, expiresAt: bn(r.expiresAt ?? 0) })
      .accountsStrict({ authority, provider: this.pda.provider(authority), job, attestation, systemProgram: SystemProgram.programId })
      .instruction();
    return { attestation, ixs: [ix] };
  }
  async disputeVerificationJob(requester: PublicKey, job: PublicKey, reasonHash: Bytes32) {
    return [
      await this.m
        .disputeVerificationJob(arr(reasonHash))
        .accountsStrict({ requester, job, dispute: this.pda.dispute(job, 0), systemProgram: SystemProgram.programId })
        .instruction(),
    ];
  }
  async resolveVerificationDispute(disputeAuthority: PublicKey, job: PublicKey, providerBps: number) {
    const j = await this.job(job);
    if (!j) throw new Error('job not found');
    return [
      await this.m
        .resolveVerificationDispute(providerBps)
        .accountsStrict({ disputeAuthority, config: this.pda.config(), job, dispute: this.pda.dispute(job, 0), provider: this.pda.provider(new PublicKey(j.provider)) })
        .instruction(),
    ];
  }
  async settleVerificationJob(caller: PublicKey, job: PublicKey) {
    const j = await this.job(job);
    if (!j) throw new Error('job not found');
    const cfg = await this.requireConfig();
    const mint = cfg.paymentMint;
    const provider = new PublicKey(j.provider);
    const requester = new PublicKey(j.requester);
    return [
      this.ensureAta(caller, provider, mint),
      this.ensureAta(caller, requester, mint),
      await this.m
        .settleVerificationJob()
        .accountsStrict({
          caller,
          config: this.pda.config(),
          job,
          vault: this.pda.jobVault(job),
          mint,
          providerToken: this.ata(provider, mint),
          requesterToken: this.ata(requester, mint),
          treasury: cfg.treasury,
          requester,
          provider: this.pda.provider(provider),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    ];
  }
  async refundVerificationJob(requester: PublicKey, job: PublicKey) {
    const cfg = await this.requireConfig();
    return [
      await this.m
        .refundVerificationJob()
        .accountsStrict({ requester, job, vault: this.pda.jobVault(job), mint: cfg.paymentMint, requesterToken: this.ata(requester, cfg.paymentMint), tokenProgram: TOKEN_PROGRAM_ID })
        .instruction(),
    ];
  }

  // ================================================================ attestations & services

  async revokeAttestation(authority: PublicKey, attestation: PublicKey) {
    return [await this.m.revokeAttestation().accountsStrict({ authority, config: this.pda.config(), attestation }).instruction()];
  }
  async payService(payer: PublicKey, reference: Uint8Array, kind: number, amount: bigint) {
    const cfg = await this.requireConfig();
    return [
      ...await this.preparePayment(payer, cfg.paymentMint, amount),
      await this.m
        .payService(arr(reference), kind, bn(amount))
        .accountsStrict({
          payer,
          config: this.pda.config(),
          receipt: this.pda.receipt(reference),
          mint: cfg.paymentMint,
          payerToken: this.ata(payer, cfg.paymentMint),
          treasury: cfg.treasury,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    ];
  }

  // ================================================================ tx helpers

  async buildTransaction(ixs: TransactionInstruction[], feePayer: PublicKey): Promise<Transaction> {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight });
    tx.add(...ixs);
    return tx;
  }

  /** Node-side helper: sign with keypairs and confirm. */
  async send(ixs: TransactionInstruction[], signers: Signer[], commitment: Commitment = 'confirmed'): Promise<string> {
    const tx = await this.buildTransaction(ixs, signers[0].publicKey);
    tx.sign(...signers);
    const sig = await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    const res = await this.connection.confirmTransaction({ signature: sig, blockhash: tx.recentBlockhash!, lastValidBlockHeight: tx.lastValidBlockHeight! }, commitment);
    if (res.value.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(res.value.err)}`);
    return sig;
  }

  private async requireConfig() {
    const c = await this.config();
    if (!c) throw new Error('platform not initialized');
    return c;
  }
  private async requireOrder(order: PublicKey) {
    const o = await this.order(order);
    if (!o) throw new Error(`order ${order.toBase58()} not found`);
    return o;
  }
}
