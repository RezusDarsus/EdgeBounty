import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { randomBytes, randomInt } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { RATES, verificationQuote } from '@edgebounty/pricing-engine';
import { capabilityList, SERVICE_KINDS } from '@edgebounty/shared-types';
import { AcceptanceCriteria, DOMAIN, ProviderProfile, VerificationReport, bytesToHex, hashDocument } from '@edgebounty/verification-schemas';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { getOwnedVersion, getVersionWithAsset } from '../lib/assets.js';
import { badRequest, conflict, forbidden, isAdmin, notFound, parse, requireSession, zMicro, zUuid, zWallet } from '../lib/http.js';
import { DOWNLOAD_TTL_SECS, signDownloadToken } from '../lib/tokens.js';
import { createJob, quoteVersion, specFor } from '../services/jobs.js';
import { randomU63 } from './marketplace.js';

const AUDIT_SAMPLE_RATE = 0.2;
const zLevel = z.enum(['L1', 'L2', 'L3']);

export async function creditBalance(ctx: AppContext, accountId: string): Promise<bigint> {
  const [r] = await ctx.db.select({ s: sql<string>`coalesce(sum(${schema.credits.amountMicro}), 0)` }).from(schema.credits).where(eq(schema.credits.accountId, accountId));
  return BigInt(r.s);
}

export async function createInvoice(ctx: AppContext, accountId: string, kind: 'storage' | 'verification' | 'other', amountMicro: bigint, metadata: Record<string, unknown>) {
  const reference = randomBytes(32).toString('hex');
  const [inv] = await ctx.db
    .insert(schema.invoices)
    .values({ accountId, kind, reference, amountMicro, metadata, expiresAt: new Date(Date.now() + 24 * 3600_000) })
    .returning();
  return { id: inv.id, reference, amountMicro: amountMicro.toString(), serviceKind: SERVICE_KINDS[kind], expiresAt: inv.expiresAt };
}

export function verificationRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, cfg } = ctx;
  async function executionFor(bytes: number, benchmarkId: string | undefined | null, accountId: string) {
    if (benchmarkId) {
      const [benchmark] = await db.select().from(schema.benchmarks).where(eq(schema.benchmarks.id, benchmarkId));
      if (!benchmark || (benchmark.private && benchmark.ownerId !== accountId)) throw badRequest('unknown benchmark');
      if (benchmark.assetVersionId) {
        const [version] = await db.select().from(schema.assetVersions).where(eq(schema.assetVersions.id, benchmark.assetVersionId));
        if (!version || version.status !== 'finalized') throw badRequest('benchmark is not ready');
        bytes += version.totalSize;
      }
    }
    return { supported: bytes <= cfg.VERIFICATION_MAX_MATERIALIZE_BYTES, totalMaterializeBytes: bytes, maxFullScanBytes: cfg.VERIFICATION_MAX_MATERIALIZE_BYTES, reason: bytes > cfg.VERIFICATION_MAX_MATERIALIZE_BYTES ? 'The asset and benchmark exceed this deployment’s full-scan capacity. Separate worker capacity is required before billing.' : null };
  }

  // ================================================================ platform-run verification (Module E)

  app.post('/verification/quote', async (req) => {
    const s = requireSession(req);
    const b = parse(z.object({ assetVersionId: zUuid, level: zLevel, sampleSize: z.number().int().min(10).max(5000).optional(), benchmarkId: z.string().optional() }), req.body);
    const { version, asset } = await getOwnedVersion(ctx, b.assetVersionId, s.accountId);
    if (version.status !== 'finalized') throw conflict('finalize the asset version first');
    const execution = await executionFor(version.totalSize, b.benchmarkId, s.accountId);
    const q = await quoteVersion(ctx, version.id, b.level, b.benchmarkId);
    return { priceMicro: q.price.toString(), lines: q.lines.map((l) => ({ ...l, amount: l.amount.toString() })), budget: { ...q.budget, maxSpend: q.budget.maxSpend.toString() }, credits: (await creditBalance(ctx, s.accountId)).toString(), execution };
  });

  app.post('/verification/jobs', async (req) => {
    const s = requireSession(req);
    const b = parse(z.object({ assetVersionId: zUuid, level: zLevel, criteria: AcceptanceCriteria.optional(), benchmarkId: z.string().optional() }), req.body);
    const { version, asset } = await getOwnedVersion(ctx, b.assetVersionId, s.accountId);
    if (version.status !== 'finalized') throw conflict('finalize the asset version first');
    if (!(await executionFor(version.totalSize, b.benchmarkId, s.accountId)).supported) throw conflict('The asset and benchmark exceed full-scan capacity. No invoice was created; separate worker capacity is required.');
    if (asset.kind === 'model' && b.benchmarkId) {
      const [bm] = await db.select().from(schema.benchmarks).where(eq(schema.benchmarks.id, b.benchmarkId));
      if (!bm || (bm.private && bm.ownerId !== s.accountId)) throw badRequest('unknown benchmark');
    }
    return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'verification-billing:' + s.accountId}, 0))`);
    const scoped = { ...ctx, db: tx as unknown as AppContext['db'] };
    const { specHash } = specFor(b.level, b.criteria, b.benchmarkId, ctx.cfg);
    const [existing] = await tx.select().from(schema.verificationJobs).where(and(eq(schema.verificationJobs.requesterId, s.accountId), eq(schema.verificationJobs.kind, 'standalone'), eq(schema.verificationJobs.assetVersionId, version.id), eq(schema.verificationJobs.specHash, specHash), inArray(schema.verificationJobs.status, ['awaiting_payment', 'queued', 'running', 'completed'])));
    if (existing) {
      const [inv] = existing.invoiceId ? await tx.select().from(schema.invoices).where(eq(schema.invoices.id, existing.invoiceId)) : [];
      return { job: existing, invoice: inv?.status === 'open' ? { id: inv.id, reference: inv.reference, amountMicro: inv.amountMicro.toString(), serviceKind: SERVICE_KINDS.verification, expiresAt: inv.expiresAt } : null, reused: true };
    }
    const job = await createJob(scoped, { kind: 'standalone', assetVersionId: version.id, requesterId: s.accountId, level: b.level, criteria: b.criteria, benchmarkId: b.benchmarkId, status: 'awaiting_payment' });
    const price = job.quoteMicro;
    if (price === 0n) {
      await tx.update(schema.verificationJobs).set({ status: 'queued' }).where(eq(schema.verificationJobs.id, job.id));
      return { job: { ...job, status: 'queued' }, invoice: null };
    }
    const credits = await creditBalance(scoped, s.accountId);
    if (credits >= price) {
      await tx.insert(schema.credits).values({ accountId: s.accountId, amountMicro: -price, reason: `verification job ${job.id}` });
      await tx.update(schema.verificationJobs).set({ status: 'queued' }).where(eq(schema.verificationJobs.id, job.id));
      return { job: { ...job, status: 'queued' }, invoice: null, paidWithCredits: price.toString() };
    }
    const invoice = await createInvoice(scoped, s.accountId, 'verification', price, { jobId: job.id });
    await tx.update(schema.verificationJobs).set({ invoiceId: invoice.id }).where(eq(schema.verificationJobs.id, job.id));
    return { job, invoice };
    });
  });

  /** After a job stopped at `needs_authorization`, accept a new quote for the measured workload. */
  app.post('/verification/jobs/:id/reauthorize', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [job] = await db.select().from(schema.verificationJobs).where(eq(schema.verificationJobs.id, id));
    if (!job || job.requesterId !== s.accountId) throw notFound('job');
    if (job.status !== 'needs_authorization') throw conflict('job does not need authorization');
    const { version } = await getVersionWithAsset(ctx, job.assetVersionId);
    if (!(await executionFor(version.totalSize, job.benchmarkId, s.accountId)).supported) throw conflict('The workload still exceeds full-scan capacity. Reauthorization cannot increase server capacity; no additional invoice was created.');
    const q = await quoteVersion(ctx, version.id, job.level, job.benchmarkId);
    const extra = q.price > job.quoteMicro ? q.price - job.quoteMicro : 0n;
    await db.update(schema.verificationJobs).set({ quoteMicro: q.price, budget: { ...q.budget, maxSpend: q.budget.maxSpend.toString() }, status: extra === 0n ? 'queued' : 'awaiting_payment', error: null }).where(eq(schema.verificationJobs.id, id));
    if (extra === 0n) return { status: 'queued' };
    const invoice = await createInvoice(ctx, s.accountId, 'verification', extra, { jobId: id, reauthorization: true });
    await db.update(schema.verificationJobs).set({ invoiceId: invoice.id }).where(eq(schema.verificationJobs.id, id));
    return { status: 'awaiting_payment', invoice };
  });

  app.get('/verification/jobs', async (req) => {
    const s = requireSession(req);
    const rows = await db.select().from(schema.verificationJobs).where(eq(schema.verificationJobs.requesterId, s.accountId)).orderBy(desc(schema.verificationJobs.createdAt)).limit(200);
    return rows.map(publicJob);
  });

  app.get('/verification/jobs/:id', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [job] = await db.select().from(schema.verificationJobs).where(eq(schema.verificationJobs.id, id));
    if (!job) throw notFound('job');
    let allowed = job.requesterId === s.accountId || job.providerWallet === s.wallet || isAdmin(ctx, s);
    if (!allowed && job.orderId) {
      const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, job.orderId));
      allowed = !!o && (o.buyerWallet === s.wallet || o.sellerWallet === s.wallet);
    }
    if (!allowed) throw notFound('job');
    const [r] = await db.select().from(schema.verificationResults).where(eq(schema.verificationResults.jobId, id));
    return { ...publicJob(job), result: r ? { report: r.report, reportHash: r.reportHash, passed: r.passed, attestation: r.attestationAddress, tx: r.txSignature } : null };
  });

  // ================================================================ attestations (public)

  app.get('/attestations/:address', async (req) => {
    const { address } = req.params as { address: string };
    const a = await ctx.chain.client.attestation(new PublicKey(address));
    if (!a) throw notFound('attestation');
    const [prov] = await db.select().from(schema.providers).where(eq(schema.providers.wallet, a.verifier));
    return { ...a, verifierProfile: prov?.profile ?? null, disclaimer: 'An attestation proves which authorized verifier issued which result for which asset commitment. It does not prove the result is true.' };
  });

  /** Anyone holding a disclosed report can check it against the on-chain attestation. */
  app.post('/attestations/:address/verify-report', async (req) => {
    const { address } = req.params as { address: string };
    const report = parse(VerificationReport, (req.body as any)?.report);
    const a = await ctx.chain.client.attestation(new PublicKey(address));
    if (!a) throw notFound('attestation');
    const hash = bytesToHex(hashDocument(DOMAIN.report, report));
    return { matches: hash === a.resultHash && report.assetCommitment === a.assetCommitment, reportHash: hash, onchainResultHash: a.resultHash, revoked: a.revoked, passed: a.passed };
  });

  // ================================================================ provider registry (§8)

  app.post('/providers/profile', async (req) => {
    const s = requireSession(req);
    const b = parse(z.object({ profile: ProviderProfile, requestedCapabilities: z.number().int().min(1).max(0x7f) }), req.body);
    const metadataHash = bytesToHex(hashDocument(DOMAIN.provider, b.profile));
    await db
      .insert(schema.providers)
      .values({ wallet: s.wallet, accountId: s.accountId, profile: b.profile, metadataHash, requestedCapabilities: b.requestedCapabilities })
      .onConflictDoUpdate({ target: schema.providers.wallet, set: { profile: b.profile, accountId: s.accountId, updatedAt: new Date() } });
    return { onchain: { metadataHash, requestedCapabilities: b.requestedCapabilities, provider: ctx.chain.client.pda.provider(new PublicKey(s.wallet)).toBase58() } };
  });

  app.get('/providers', async (req) => {
    const q = parse(z.object({ all: z.coerce.boolean().default(false) }), req.query);
    const rows = await db.select().from(schema.providers).where(q.all && isAdmin(ctx, req.session) ? sql`true` : eq(schema.providers.approved, true));
    return rows.map(publicProvider);
  });

  app.get('/providers/:wallet', async (req) => {
    const [p] = await db.select().from(schema.providers).where(eq(schema.providers.wallet, (req.params as any).wallet));
    if (!p) throw notFound('provider');
    const onchain = await ctx.chain.client.provider(new PublicKey(p.wallet));
    const audits = await providerAuditRecord(ctx, p.wallet);
    return { ...publicProvider(p), onchain, audits };
  });

  // ---------------------------------------------------------------- third-party verification jobs (on-chain VerificationJob)

  app.post('/provider-jobs', async (req) => {
    const s = requireSession(req);
    const b = parse(
      z.object({
        assetVersionId: zUuid,
        level: zLevel,
        criteria: AcceptanceCriteria.optional(),
        priceMicro: zMicro,
        providerWallet: zWallet.optional(),
        requiredCapability: z.number().int().min(0),
        deadline: z.coerce.date(),
        instructions: z.string().max(5000).default(''),
      }),
      req.body,
    );
    const { version } = await getOwnedVersion(ctx, b.assetVersionId, s.accountId);
    if (version.status !== 'finalized') throw conflict('finalize the asset version first');
    if (b.providerWallet === s.wallet) throw badRequest('you cannot verify your own asset');
    const { spec, specHash } = specFor(b.level, b.criteria ?? null, null, ctx.cfg);
    const fullSpec = { ...spec, instructions: b.instructions };
    const jobIdOnchain = randomU63();
    const address = ctx.chain.client.pda.job(new PublicKey(s.wallet), jobIdOnchain).toBase58();
    const [row] = await db
      .insert(schema.providerJobs)
      .values({ requesterId: s.accountId, requesterWallet: s.wallet, jobIdOnchain, onchainAddress: address, assetVersionId: version.id, spec: fullSpec, specHash, priceMicro: b.priceMicro, providerWallet: b.providerWallet ?? null, requiredCapability: b.requiredCapability, deadline: b.deadline })
      .returning();
    return { job: row, onchain: { jobId: jobIdOnchain.toString(), provider: b.providerWallet ?? null, requiredCapability: b.requiredCapability, assetCommitment: version.commitment, specHash, price: b.priceMicro.toString(), deadline: Math.floor(b.deadline.getTime() / 1000), address } };
  });

  app.post('/provider-jobs/:id/sync', async (req) => {
    requireSession(req);
    const [row] = await db.select().from(schema.providerJobs).where(eq(schema.providerJobs.id, (req.params as any).id));
    if (!row) throw notFound('job');
    const view = await ctx.chain.client.job(new PublicKey(row.onchainAddress));
    if (!view) throw conflict('job not on-chain yet');
    const { version } = await getVersionWithAsset(ctx, row.assetVersionId);
    if (view.assetCommitment !== version.commitment || view.specHash !== row.specHash || view.price !== row.priceMicro) throw conflict('on-chain job does not match prepared spec');
    await db.update(schema.providerJobs).set({ chainState: view.state, chain: JSON.parse(JSON.stringify(view, (_, v) => (typeof v === 'bigint' ? v.toString() : v))), providerWallet: view.provider === PublicKey.default.toBase58() ? null : view.provider }).where(eq(schema.providerJobs.id, row.id));
    return view;
  });

  app.get('/provider-jobs', async (req) => {
    const s = requireSession(req);
    return db.select().from(schema.providerJobs).where(eq(schema.providerJobs.requesterId, s.accountId)).orderBy(desc(schema.providerJobs.createdAt));
  });

  // ---------------------------------------------------------------- provider dashboard

  app.get('/provider/jobs', async (req) => {
    const s = requireSession(req);
    const [me] = await db.select().from(schema.providers).where(eq(schema.providers.wallet, s.wallet));
    const orderJobs = await db.select().from(schema.verificationJobs).where(and(eq(schema.verificationJobs.providerWallet, s.wallet), inArray(schema.verificationJobs.kind, ['order']))).orderBy(desc(schema.verificationJobs.createdAt));
    const market = await db
      .select()
      .from(schema.providerJobs)
      .where(or(eq(schema.providerJobs.providerWallet, s.wallet), and(eq(schema.providerJobs.chainState, 'open'), sql`${schema.providerJobs.providerWallet} is null`)))
      .orderBy(desc(schema.providerJobs.createdAt));
    const caps = me?.capabilities ?? 0;
    return {
      provider: me ? publicProvider(me) : null,
      orderJobs: orderJobs.map(publicJob),
      marketJobs: market.filter((j) => j.providerWallet === s.wallet || (caps & j.requiredCapability) === j.requiredCapability).map((j) => ({ ...j, priceMicro: j.priceMicro.toString(), jobIdOnchain: j.jobIdOnchain.toString() })),
    };
  });

  /** Job-scoped, short-lived input access for the assigned verifier only. */
  app.get('/provider/jobs/:id/inputs', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const versionId = await assignedVersion(ctx, id, s.wallet);
    const files = await db.select().from(schema.assetFiles).where(eq(schema.assetFiles.versionId, versionId));
    const x = Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECS;
    const [v] = await db.select().from(schema.assetVersions).where(eq(schema.assetVersions.id, versionId));
    return { commitment: v.commitment, proof: { salt: v.salt, manifest: v.manifest }, files: files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256, url: `/download/${signDownloadToken(cfg.DOWNLOAD_TOKEN_SECRET, { s: 'eval', g: id, f: f.id, w: s.wallet, x })}` })) };
  });

  /** Verifier uploads the report; API returns the hash to sign on-chain and may schedule a secondary audit. */
  app.post('/provider/jobs/:id/report', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const report = parse(VerificationReport, (req.body as any)?.report);
    const versionId = await assignedVersion(ctx, id, s.wallet);
    const { version, asset } = await getVersionWithAsset(ctx, versionId);
    if (report.assetCommitment !== version.commitment) throw badRequest('report is for a different asset commitment');
    if (report.verifier !== s.wallet) throw badRequest('report.verifier must be your wallet');
    const reportHash = bytesToHex(hashDocument(DOMAIN.report, report));
    const [orderJob] = await db.select().from(schema.verificationJobs).where(eq(schema.verificationJobs.id, id));
    let specHash: string;
    if (orderJob) {
      specHash = orderJob.specHash;
      await db.insert(schema.verificationResults).values({ jobId: id, report, reportHash, passed: report.passed }).onConflictDoUpdate({ target: schema.verificationResults.jobId, set: { report, reportHash, passed: report.passed } });
      await db.update(schema.verificationJobs).set({ status: 'completed', completedAt: new Date() }).where(eq(schema.verificationJobs.id, id));
    } else {
      const [pj] = await db.select().from(schema.providerJobs).where(eq(schema.providerJobs.id, id));
      specHash = pj.specHash;
      await db.update(schema.providerJobs).set({ report, reportHash }).where(eq(schema.providerJobs.id, id));
    }
    // random secondary audit: the platform independently re-runs the same spec
    let auditJobId: string | null = null;
    if (randomInt(1_000_000) < AUDIT_SAMPLE_RATE * 1_000_000 && report.level !== 'L4') {
      const audit = await createJob(ctx, { kind: 'provider_job', assetVersionId: versionId, requesterId: asset.ownerId, level: report.level === 'L3' ? 'L2' : report.level, criteria: (orderJob?.criteria as unknown) ?? null, auditOf: id });
      auditJobId = audit.id;
    }
    return { reportHash, specHash, auditScheduled: !!auditJobId };
  });
}

async function assignedVersion(ctx: AppContext, id: string, wallet: string): Promise<string> {
  const [job] = await ctx.db.select().from(schema.verificationJobs).where(eq(schema.verificationJobs.id, id));
  if (job) {
    if (job.providerWallet !== wallet) throw forbidden('not assigned to you');
    const [o] = job.orderId ? await ctx.db.select().from(schema.orders).where(eq(schema.orders.id, job.orderId)) : [];
    if (o) {
      const v = await ctx.chain.client.order(new PublicKey(o.onchainAddress));
      if (!v || v.state !== 'submitted') throw conflict('order is not awaiting verification');
    }
    return job.assetVersionId;
  }
  const [pj] = await ctx.db.select().from(schema.providerJobs).where(eq(schema.providerJobs.id, id));
  if (!pj) throw notFound('job');
  const v = await ctx.chain.client.job(new PublicKey(pj.onchainAddress));
  if (!v || v.provider !== wallet || v.state !== 'accepted') throw forbidden('accept the job on-chain first');
  return pj.assetVersionId;
}

export async function providerAuditRecord(ctx: AppContext, wallet: string) {
  const audits = await ctx.db.select().from(schema.verificationJobs).where(sql`${schema.verificationJobs.auditOf} is not null and ${schema.verificationJobs.status} = 'completed'`);
  let agreed = 0;
  let disagreed = 0;
  for (const a of audits) {
    const [orig] = await ctx.db.select().from(schema.verificationResults).where(eq(schema.verificationResults.jobId, a.auditOf!));
    const [origJob] = await ctx.db.select().from(schema.verificationJobs).where(eq(schema.verificationJobs.id, a.auditOf!));
    const [pj] = origJob ? [] : await ctx.db.select().from(schema.providerJobs).where(eq(schema.providerJobs.id, a.auditOf!));
    const providerOf = origJob?.providerWallet ?? pj?.providerWallet;
    if (providerOf !== wallet) continue;
    const [mine] = await ctx.db.select().from(schema.verificationResults).where(eq(schema.verificationResults.jobId, a.id));
    const origPassed = orig?.passed ?? (pj?.report as any)?.passed;
    if (mine && origPassed !== undefined) mine.passed === origPassed ? agreed++ : disagreed++;
  }
  return { agreed, disagreed };
}

function publicProvider(p: typeof schema.providers.$inferSelect) {
  return { wallet: p.wallet, profile: p.profile, approved: p.approved, capabilities: capabilityList(p.capabilities), requestedCapabilities: capabilityList(p.requestedCapabilities), jobsCompleted: p.jobsCompleted, jobsDisputed: p.jobsDisputed, metadataHash: p.metadataHash };
}

export function publicJob(j: typeof schema.verificationJobs.$inferSelect) {
  return { id: j.id, kind: j.kind, orderId: j.orderId, submissionIndex: j.submissionIndex, assetVersionId: j.assetVersionId, level: j.level, criteria: j.criteria, benchmarkId: j.benchmarkId, specHash: j.specHash, status: j.status, quoteMicro: j.quoteMicro.toString(), actualCostMicro: j.actualCostMicro.toString(), budget: j.budget, error: j.error, providerWallet: j.providerWallet, createdAt: j.createdAt, completedAt: j.completedAt };
}
