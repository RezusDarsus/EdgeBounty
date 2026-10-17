import { applyPaidInvoice } from '../lib/billing.js';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import { PublicKey } from '@solana/web3.js';
import { TERMINAL_ORDER_STATES } from '@edgebounty/shared-types';
import { AcceptanceCriteria, hexToBytes } from '@edgebounty/verification-schemas';
import type { OrderView } from '@edgebounty/blockchain-client';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { jsonSafe } from '../lib/http.js';
import { createJob, platformProviderTick } from './jobs.js';
import { failureVerifierTick } from './failure.js';
import { versionByCommitment } from '../routes/marketplace.js';
import { requireListingVerification } from '../lib/verification-policy.js';

type OrderRow = typeof schema.orders.$inferSelect;

async function accountIdForWallet(ctx: AppContext, wallet: string | null) {
  if (!wallet) return null;
  const [a] = await ctx.db.select().from(schema.accounts).where(eq(schema.accounts.wallet, wallet));
  return a?.id ?? null;
}

/** Reads the order from chain (authoritative) and reconciles the DB row + side effects. */
export async function syncOrder(ctx: AppContext, row: OrderRow): Promise<OrderView | null> {
  const view = await ctx.chain.client.order(new PublicKey(row.onchainAddress));
  if (!view) return null;
  return applyOrderView(ctx, row, view);
}

export async function applyOrderView(ctx: AppContext, row: OrderRow, view: OrderView): Promise<OrderView> {
  // integrity: the on-chain contract must match what the API prepared
  if (
    view.buyer !== row.buyerWallet ||
    view.termsHash !== row.termsHash ||
    view.amount !== row.amountMicro ||
    (row.kind === 'bounty' && (view.designatedSeller ?? null) !== (row.designatedSeller ?? null)) ||
    (row.kind === 'bounty' && (view.arbitrator ?? null) !== (row.arbitratorWallet ?? null))
  ) {
    await ctx.db.update(schema.orders).set({ chainState: 'mismatch', chain: jsonSafe(view), syncedAt: new Date() }).where(eq(schema.orders.id, row.id));
    return view;
  }
  const prev = row.chainState;
  const sellerId = view.seller ? (row.sellerId ?? (await accountIdForWallet(ctx, view.seller))) : null;
  await ctx.db
    .update(schema.orders)
    .set({ chainState: view.state, chain: jsonSafe(view) as object, sellerWallet: view.seller, sellerId, syncedAt: new Date() })
    .where(eq(schema.orders.id, row.id));
  const fresh = { ...row, chainState: view.state, sellerWallet: view.seller, sellerId };
  if (prev !== view.state || view.state === 'submitted') await onOrderState(ctx, fresh, view);
  if (prev !== view.state) await ctx.events.onOrderState?.(row.id, view.state);
  return view;
}

async function currentSubmissionVersion(ctx: AppContext, row: OrderRow, view: OrderView): Promise<string | null> {
  if (row.kind === 'purchase') {
    // the buyer is entitled to the exact version they paid for, even if the listing moved on since
    const [l] = await ctx.db.select().from(schema.listings).where(eq(schema.listings.id, row.listingId!));
    if (!l) return null;
    return (await versionByCommitment(ctx, l.assetId, view.currentCommitment))?.id ?? null;
  }
  const subs = await ctx.db.select().from(schema.submissions).where(eq(schema.submissions.orderId, row.id));
  const s = subs.find((x) => x.commitment === view.currentCommitment && x.index === view.submissionCount - 1);
  if (s && s.status !== 'onchain') {
    await ctx.db
      .update(schema.submissions)
      .set({ status: 'onchain', onchainAddress: ctx.chain.client.pda.submission(new PublicKey(row.onchainAddress), s.index).toBase58() })
      .where(eq(schema.submissions.id, s.id));
  }
  return s?.assetVersionId ?? null;
}

async function onOrderState(ctx: AppContext, row: OrderRow, view: OrderView) {
  if (view.state === 'submitted' && view.verifier) {
    const versionId = await currentSubmissionVersion(ctx, row, view);
    if (!versionId) return;
    const existing = await ctx.db
      .select()
      .from(schema.verificationJobs)
      .where(and(eq(schema.verificationJobs.orderId, row.id), eq(schema.verificationJobs.submissionIndex, view.submissionCount)));
    if (existing.length) return;
    const isPlatform = ctx.chain.platformVerifier?.publicKey.toBase58() === view.verifier;
    const criteria = row.criteria ? AcceptanceCriteria.parse(row.criteria) : null;
    const level = criteria?.kind === 'image_dataset' && criteria.minRelevanceBps !== undefined ? 'L3' : criteria?.kind === 'model' ? 'L2' : 'L2';
    await createJob(ctx, {
      kind: 'order',
      assetVersionId: versionId,
      requesterId: row.buyerId,
      level,
      criteria,
      benchmarkId: criteria?.kind === 'model' ? criteria.benchmarkId : null,
      orderId: row.id,
      submissionIndex: view.submissionCount,
      providerWallet: view.verifier,
      publishOnchain: isPlatform,
      // third-party verifiers run their own evaluation; the job record tracks it for their dashboard
      status: isPlatform ? 'queued' : 'awaiting_provider',
    });
  }
  if (view.state === 'disputed') {
    await ctx.db.update(schema.disputes).set({ status: 'open' }).where(and(eq(schema.disputes.orderId, row.id), eq(schema.disputes.index, view.disputeCount - 1)));
  }
  if (view.state === 'settled' && view.sellerBps > 0) {
    const receipt = await ctx.chain.client.licenseReceipt(new PublicKey(row.onchainAddress));
    const versionId = await currentSubmissionVersion(ctx, row, view);
    if (receipt?.granted && versionId) {
      // metered access window + download allowance from the locked checkout; orders without one (bounties,
      // pre-metering purchases) keep the legacy open-ended entitlement
      const [cq] = await ctx.db.select().from(schema.checkoutQuotes).where(eq(schema.checkoutQuotes.orderId, row.id));
      await ctx.db
        .insert(schema.deliveryEntitlements)
        .values({
          orderId: row.id, buyerId: row.buyerId, buyerWallet: row.buyerWallet, assetVersionId: versionId, licenseReceipt: ctx.chain.client.pda.license(new PublicKey(row.onchainAddress)).toBase58(),
          ...(cq && cq.assetVersionId === versionId ? { accessStartsAt: cq.accessStartsAt, accessEndsAt: cq.accessEndsAt, allowanceBytes: cq.allowanceBytes, checkoutQuoteId: cq.id } : {}),
        })
        .onConflictDoNothing();
      if (row.listingId) {
        const [l] = await ctx.db.select().from(schema.listings).where(eq(schema.listings.id, row.listingId));
        if (l) await ctx.db.update(schema.listings).set({ sales: l.sales + 1 }).where(eq(schema.listings.id, l.id));
      }
    }
  }
}

// ------------------------------------------------------------------ full sync loop

export async function syncAll(ctx: AppContext) {
  const client = ctx.chain.client;
  // orders: one getProgramAccounts call, then reconcile rows we know about
  const views = new Map((await client.allOrders()).map((v) => [v.address, v]));
  const rows = await ctx.db.select().from(schema.orders);
  for (const row of rows) {
    const v = views.get(row.onchainAddress);
    if (!v) continue;
    const prevState = (row.chain as any)?.state;
    const changed = prevState !== v.state || (row.chain as any)?.submissionCount !== v.submissionCount || (row.chain as any)?.disputeCount !== v.disputeCount || (row.chain as any)?.verificationsDone !== v.verificationsDone;
    if (changed || row.chainState === 'draft') await applyOrderView(ctx, row, v);
  }
  // listings
  for (const l of await client.allListings()) {
    const [row] = await ctx.db.select().from(schema.listings).where(eq(schema.listings.onchainAddress, l.address));
    if (!row) continue;
    // never publish or switch versions unless the on-chain terms match what the API prepared
    const v = await versionByCommitment(ctx, row.assetId, l.assetCommitment);
    if (!v || l.termsHash !== row.termsHash || l.licenseHash !== row.licenseHash || l.seller !== row.sellerWallet) continue;
    try { await requireListingVerification(ctx, v.id); } catch { continue; }
    const status = l.moderated ? 'moderated' : !l.active ? 'delisted' : row.status === 'moderated' ? 'moderated' : 'published';
    await ctx.db.update(schema.listings).set({ assetVersionId: v.id, onchainVersion: l.version, priceMicro: l.price, status, updatedAt: new Date() }).where(eq(schema.listings.id, row.id));
  }
  // providers
  for (const p of await client.allProviders()) {
    await ctx.db
      .insert(schema.providers)
      .values({ wallet: p.authority, approved: p.approved, capabilities: p.capabilities, requestedCapabilities: p.requestedCapabilities, metadataHash: p.metadataHash, jobsCompleted: p.jobsCompleted, jobsDisputed: p.jobsDisputed, onchainAddress: p.address })
      .onConflictDoUpdate({
        target: schema.providers.wallet,
        set: { approved: p.approved, capabilities: p.capabilities, requestedCapabilities: p.requestedCapabilities, metadataHash: p.metadataHash, jobsCompleted: p.jobsCompleted, jobsDisputed: p.jobsDisputed, onchainAddress: p.address, updatedAt: new Date() },
      });
  }
  // third-party verification jobs
  for (const j of await client.allJobs()) {
    await ctx.db
      .update(schema.providerJobs)
      .set({ chainState: j.state, chain: jsonSafe(j) as object, providerWallet: j.provider === PublicKey.default.toBase58() ? null : j.provider })
      .where(eq(schema.providerJobs.onchainAddress, j.address));
  }
  // failure bounties + examples
  for (const b of await client.allFailureBounties()) {
    await ctx.db.update(schema.failureBounties).set({ chain: jsonSafe(b) as object, chainState: b.open ? 'open' : 'closed' }).where(eq(schema.failureBounties.onchainAddress, b.address));
  }
  for (const e of await client.allFailureExamples()) {
    await ctx.db.update(schema.failureExamples).set({ status: e.state }).where(eq(schema.failureExamples.onchainAddress, e.address));
  }
  // attestation mirror (public certificate lookups)
  for (const a of await client.allAttestations()) {
    await ctx.db
      .insert(schema.attestationsMirror)
      .values({ address: a.address, subject: a.subject, verifier: a.verifier, assetCommitment: a.assetCommitment, specHash: a.specHash, resultHash: a.resultHash, passed: a.passed, revoked: a.revoked, issuedAt: new Date(a.issuedAt * 1000) })
      .onConflictDoUpdate({ target: schema.attestationsMirror.address, set: { revoked: a.revoked } });
  }
  await confirmPaidInvoices(ctx);
}

/** Marks invoices paid when a matching on-chain ServiceReceipt exists (never trusts the client). */
export async function confirmPaidInvoices(ctx: AppContext) {
  const open = await ctx.db.select().from(schema.invoices).where(eq(schema.invoices.status, 'open'));
  for (const inv of open) await confirmInvoice(ctx, inv);
  await ctx.db.update(schema.invoices).set({ status: 'expired' }).where(and(eq(schema.invoices.status, 'open'), lt(schema.invoices.expiresAt, new Date())));
  // Bounded rotating reconciliation also discovers delayed receipts after expiry, without requiring a browser callback.
  const key = 'billing:expired-reconciliation';
  const [cursor] = await ctx.db.select().from(schema.operationCounters).where(eq(schema.operationCounters.key, key));
  if (!cursor || Date.now() - cursor.updatedAt.getTime() >= 60_000) {
    const offset = Number(cursor?.count ?? 0n);
    const rows = await ctx.db.select().from(schema.invoices).where(eq(schema.invoices.status, 'expired')).orderBy(asc(schema.invoices.createdAt), asc(schema.invoices.id)).limit(25).offset(offset);
    for (const inv of rows) {
      try { await confirmInvoice(ctx, inv); }
      catch { console.error('Expired invoice reconciliation failed; invoice retained for a later retry.'); }
    }
    const count = rows.length === 25 ? BigInt(offset + 25) : 0n;
    await ctx.db.insert(schema.operationCounters).values({ key, count, updatedAt: new Date() }).onConflictDoUpdate({ target: schema.operationCounters.key, set: { count, updatedAt: new Date() } });
  }
}

export async function confirmInvoice(ctx: AppContext, inv: typeof schema.invoices.$inferSelect): Promise<boolean> {
  if (inv.status === 'paid') return true;
  const receipt = await ctx.chain.client.receipt(hexToBytes(inv.reference));
  if (!receipt) return false;
  const [acct] = await ctx.db.select().from(schema.accounts).where(eq(schema.accounts.id, inv.accountId));
  if (receipt.amount < inv.amountMicro || receipt.payer !== acct?.wallet) return false;
  return ctx.db.transaction(async tx => {
  const txCtx = { ...ctx, db: tx as unknown as AppContext['db'] };
  const [paid] = await tx
    .update(schema.invoices)
    .set({ status: 'paid', paidAt: new Date(receipt.paidAt * 1000), receiptAddress: receipt.address })
    // A receipt may arrive after the quote was marked expired; honor its immutable paid terms.
    .where(and(eq(schema.invoices.id, inv.id), inArray(schema.invoices.status, ['open', 'expired'])))
    .returning();
  if (!paid) {
    const [current] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, inv.id));
    return current?.status === 'paid';
  }
  await applyPaidInvoice(txCtx, paid);
  if (inv.kind === 'storage') {
    const [alloc] = await tx.select().from(schema.storageAllocations).where(eq(schema.storageAllocations.invoiceId, inv.id));
    if (alloc) {
      const now = new Date();
      // extend from the later of now / current active expiry
      const expiresAt = new Date(now.getTime() + alloc.termDays * 86_400_000);
      await tx.update(schema.storageAllocations).set({ status: 'active', startsAt: now, expiresAt, graceUntil: null }).where(eq(schema.storageAllocations.id, alloc.id));
    }
  }
  if (inv.kind === 'other' && (inv.metadata as any)?.credits) {
    await tx.insert(schema.credits).values({ accountId: inv.accountId, amountMicro: inv.amountMicro, reason: `credit purchase ${inv.id}` });
  }
  if (inv.kind === 'verification') {
    await tx.update(schema.verificationJobs).set({ status: 'queued' }).where(and(eq(schema.verificationJobs.invoiceId, inv.id), eq(schema.verificationJobs.status, 'awaiting_payment')));
  }
  return true;
  });
}

/** Permissionless settlement crank: settles orders whose review window passed in silence. */
export async function crank(ctx: AppContext) {
  const key = ctx.chain.crank;
  if (!key) return 0;
  const now = Math.floor(Date.now() / 1000);
  let n = 0;
  const rows = await ctx.db.select().from(schema.orders).where(inArray(schema.orders.chainState, ['under_review', 'approved']));
  for (const row of rows) {
    const v = await ctx.chain.client.order(new PublicKey(row.onchainAddress));
    if (!v || TERMINAL_ORDER_STATES.includes(v.state)) continue;
    if (v.state === 'approved' || (v.state === 'under_review' && now > v.reviewDeadline)) {
      try {
        const sig = await ctx.chain.send(await ctx.chain.client.settleOrder(key.publicKey, new PublicKey(row.onchainAddress)), key, 'crank');
        await ctx.db.insert(schema.onchainTransactions).values({ signature: sig, kind: 'settle_order', subject: row.onchainAddress, wallet: key.publicKey.toBase58(), status: 'confirmed' });
        await syncOrder(ctx, row);
        n++;
      } catch (e) {
        console.warn('[crank] settle failed', row.onchainAddress, (e as Error).message);
      }
    }
  }
  const jobs = await ctx.db.select().from(schema.providerJobs).where(inArray(schema.providerJobs.chainState, ['result_submitted', 'resolved']));
  for (const j of jobs) {
    const v = await ctx.chain.client.job(new PublicKey(j.onchainAddress));
    if (v && (v.state === 'resolved' || (v.state === 'result_submitted' && now > v.reviewDeadline))) {
      try {
        await ctx.chain.send(await ctx.chain.client.settleVerificationJob(key.publicKey, new PublicKey(j.onchainAddress)), key, 'crank');
        n++;
      } catch (e) {
        console.warn('[crank] job settle failed', (e as Error).message);
      }
    }
  }
  return n;
}

/** Escrow reconciliation: every live vault must hold exactly amount + verifier fee. */
export async function reconcileEscrow(ctx: AppContext) {
  const rows = await ctx.db.select().from(schema.orders);
  const out = [];
  for (const r of rows) {
    const v = r.chain as any;
    if (!v || ['draft', 'created', 'settled', 'refunded', 'cancelled', 'mismatch'].includes(r.chainState)) continue;
    const vault = ctx.chain.client.pda.vault(new PublicKey(r.onchainAddress));
    const bal = await ctx.chain.client.tokenBalance(vault);
    const expected = BigInt(v.amount) + BigInt(v.verifierFee);
    out.push({ order: r.id, address: r.onchainAddress, state: r.chainState, expected: expected.toString(), actual: bal.toString(), ok: bal === expected });
  }
  return out;
}

export function startIndexer(ctx: AppContext, intervalMs: number) {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await syncAll(ctx);
      await platformProviderTick(ctx);
      await failureVerifierTick(ctx);
      await crank(ctx);
    } catch (e) {
      console.error('[indexer]', (e as Error).message);
    } finally {
      busy = false;
    }
  }, intervalMs);
  return () => clearInterval(t);
}
