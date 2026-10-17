import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { PublicKey } from '@solana/web3.js';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { getOwnedVersion } from '../lib/assets.js';
import { badRequest, conflict, notFound, parse, requireAdmin, requireSession, zUuid } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { DOWNLOAD_TTL_SECS, signDownloadToken } from '../lib/tokens.js';
import { reconcileEscrow, syncOrder } from '../services/indexer.js';
import { providerAuditRecord } from './verification.js';
import { orderVersionId } from './marketplace.js';

export function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, cfg } = ctx;

  app.get('/admin/overview', async (req) => {
    requireAdmin(ctx, req);
    const count = async (t: any, where?: any) => Number((await db.select({ n: sql<string>`count(*)` }).from(t).where(where))[0].n);
    const cfgOnchain = await ctx.chain.client.config();
    const treasury = cfgOnchain ? await ctx.chain.client.tokenBalance(cfgOnchain.treasury) : 0n;
    const [gmv] = await db.select({ v: sql<string>`coalesce(sum(${schema.orders.amountMicro}), 0)` }).from(schema.orders).where(eq(schema.orders.chainState, 'settled'));
    const [svc] = await db.select({ v: sql<string>`coalesce(sum(${schema.invoices.amountMicro}), 0)` }).from(schema.invoices).where(eq(schema.invoices.status, 'paid'));
    const states = await db.select({ s: schema.orders.chainState, n: sql<string>`count(*)` }).from(schema.orders).groupBy(schema.orders.chainState);
    return {
      accounts: await count(schema.accounts),
      listings: await count(schema.listings, eq(schema.listings.status, 'published')),
      orders: Object.fromEntries(states.map((x) => [x.s, Number(x.n)])),
      openDisputes: await count(schema.disputes, eq(schema.disputes.status, 'open')),
      pendingProviders: await count(schema.providers, eq(schema.providers.approved, false)),
      jobs: Object.fromEntries((await db.select({ s: schema.verificationJobs.status, n: sql<string>`count(*)` }).from(schema.verificationJobs).groupBy(schema.verificationJobs.status)).map((x) => [x.s, Number(x.n)])),
      gmvMicro: gmv.v,
      serviceRevenueMicro: svc.v,
      treasuryBalanceMicro: treasury.toString(),
      paused: cfgOnchain?.paused ?? null,
      feeBps: cfgOnchain?.feeBps ?? null,
    };
  });

  app.get('/admin/disputes', async (req) => {
    requireAdmin(ctx, req);
    const rows = await db.select().from(schema.disputes).where(inArray(schema.disputes.status, ['open', 'resolved'])).orderBy(desc(schema.disputes.createdAt));
    const orders = rows.length ? await db.select().from(schema.orders).where(inArray(schema.orders.id, rows.map((r) => r.orderId))) : [];
    return rows.map((d) => ({ ...d, order: orders.find((o) => o.id === d.orderId) }));
  });

  /** Audited reviewer access to the disputed submission (never released to the buyer). */
  app.get('/admin/disputes/:id/files', async (req) => {
    const s = requireAdmin(ctx, req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [d] = await db.select().from(schema.disputes).where(eq(schema.disputes.id, id));
    if (!d) throw notFound('dispute');
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, d.orderId));
    const versionId = await orderVersionId(ctx, o);
    const versionIds = [versionId, ...d.evidence.map((e) => e.assetVersionId)].filter(Boolean) as string[];
    const files = versionIds.length ? await db.select().from(schema.assetFiles).where(inArray(schema.assetFiles.versionId, versionIds)) : [];
    await audit(db, s, 'dispute.reviewer_access', id, { files: files.length });
    const x = Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECS;
    return files.map((f) => ({ versionId: f.versionId, path: f.path, size: f.size, url: `/download/${signDownloadToken(cfg.DOWNLOAD_TOKEN_SECRET, { s: 'review', g: id, f: f.id, w: s.wallet, x })}` }));
  });

  /** Resolution is signed by the configured dispute authority (multisig-proposed in production). */
  app.post('/admin/disputes/:id/resolve', async (req) => {
    const s = requireAdmin(ctx, req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const b = parse(z.object({ resolution: z.enum(['correction', 'split']), sellerBps: z.number().int().min(0).max(10_000).default(0), notes: z.string().min(5).max(5000) }), req.body);
    const [d] = await db.select().from(schema.disputes).where(eq(schema.disputes.id, id));
    if (!d || d.status !== 'open') throw conflict('dispute not open');
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, d.orderId));
    const key = ctx.chain.disputeAuthority;
    if (!key) throw conflict('dispute authority key not configured; resolve via multisig');
    const sig = await ctx.chain.send(await ctx.chain.client.resolveDispute(key.publicKey, new PublicKey(o.onchainAddress), b.resolution, b.sellerBps), key, 'dispute authority');
    await db.update(schema.disputes).set({ status: 'resolved', resolution: b.resolution, sellerBps: b.sellerBps, resolverId: s.accountId, notes: b.notes, resolvedAt: new Date() }).where(eq(schema.disputes.id, id));
    await db.insert(schema.onchainTransactions).values({ signature: sig, kind: 'resolve_dispute', subject: o.onchainAddress, wallet: key.publicKey.toBase58(), status: 'confirmed' });
    await audit(db, s, 'dispute.resolve', id, { ...b, signature: sig });
    await syncOrder(ctx, o);
    return { signature: sig };
  });

  app.get('/admin/providers', async (req) => {
    requireAdmin(ctx, req);
    const rows = await db.select().from(schema.providers).orderBy(desc(schema.providers.updatedAt));
    return Promise.all(rows.map(async (p) => ({ ...p, audits: await providerAuditRecord(ctx, p.wallet) })));
  });

  /** Moderation: DB takedown is immediate; on-chain moderation is signed by the admin wallet in the UI. */
  app.post('/admin/listings/:id/moderate', async (req) => {
    const s = requireAdmin(ctx, req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const b = parse(z.object({ moderated: z.boolean(), reason: z.string().min(3).max(2000) }), req.body);
    const [l] = await db.select().from(schema.listings).where(eq(schema.listings.id, id));
    if (!l) throw notFound('listing');
    await db.update(schema.listings).set({ status: b.moderated ? 'moderated' : 'published' }).where(eq(schema.listings.id, id));
    await audit(db, s, b.moderated ? 'listing.moderate' : 'listing.unmoderate', id, { reason: b.reason });
    return { ok: true, onchainAddress: l.onchainAddress };
  });

  app.get('/admin/reconciliation', async (req) => {
    requireAdmin(ctx, req);
    const rows = await reconcileEscrow(ctx);
    return { ok: rows.every((r) => r.ok), mismatches: rows.filter((r) => !r.ok), checked: rows.length };
  });

  app.get('/admin/economics', async (req) => {
    requireAdmin(ctx, req);
    const rows = await db
      .select({ level: schema.verificationJobs.level, kind: schema.verificationJobs.kind, n: sql<string>`count(*)`, revenue: sql<string>`coalesce(sum(${schema.verificationJobs.quoteMicro}),0)`, cost: sql<string>`coalesce(sum(${schema.verificationJobs.actualCostMicro}),0)` })
      .from(schema.verificationJobs)
      .where(eq(schema.verificationJobs.status, 'completed'))
      .groupBy(schema.verificationJobs.level, schema.verificationJobs.kind);
    const files = await db.select({ n: sql<string>`coalesce(sum(${schema.assetFiles.size}),0)` }).from(schema.assetFiles);
    const failed = await db.select({ n: sql<string>`count(*)` }).from(schema.verificationJobs).where(eq(schema.verificationJobs.status, 'failed'));
    return {
      byService: rows.map((r) => ({ ...r, marginMicro: (BigInt(r.revenue) - BigInt(r.cost)).toString() })),
      storedBytes: files[0].n,
      storageCostMicroPerMonth: ((BigInt(files[0].n) * 15_000n) / 1024n ** 3n).toString(), // ~$0.015/GB-month
      failedJobs: Number(failed[0].n),
    };
  });

  /** Fraud signals: self-dealing pairs, verifier audit disagreements, mismatched orders. */
  app.get('/admin/fraud', async (req) => {
    requireAdmin(ctx, req);
    const pairs = await db
      .select({ buyer: schema.orders.buyerWallet, seller: schema.orders.sellerWallet, n: sql<string>`count(*)` })
      .from(schema.orders)
      .where(and(eq(schema.orders.chainState, 'settled'), isNotNull(schema.orders.sellerWallet)))
      .groupBy(schema.orders.buyerWallet, schema.orders.sellerWallet)
      .having(sql`count(*) >= 3`);
    const mismatched = await db.select().from(schema.orders).where(eq(schema.orders.chainState, 'mismatch'));
    const providers = await db.select().from(schema.providers);
    const audits = [];
    for (const p of providers) {
      const a = await providerAuditRecord(ctx, p.wallet);
      if (a.disagreed > 0) audits.push({ wallet: p.wallet, ...a });
    }
    return { repeatedPairs: pairs, mismatchedOrders: mismatched.map((o) => o.id), verifierDisagreements: audits };
  });

  app.get('/admin/audit', async (req) => {
    requireAdmin(ctx, req);
    return db.select().from(schema.auditEvents).orderBy(desc(schema.auditEvents.createdAt)).limit(500);
  });

  // ---------------------------------------------------------------- benchmark library (§7)

  app.post('/benchmarks', async (req) => {
    const s = requireSession(req);
    const b = parse(
      z.object({
        id: z.string().regex(/^[a-z0-9-]{3,60}$/),
        version: z.number().int().positive(),
        task: z.enum(['image_classification', 'object_detection', 'tabular_classification', 'tabular_regression', 'text_classification', 'speech_recognition']),
        description: z.string().min(10).max(5000),
        license: z.string(),
        methodology: z.string().min(10).max(5000),
        assetVersionId: zUuid,
        private: z.boolean().default(false),
        inputSpec: z.record(z.string(), z.unknown()),
      }),
      req.body,
    );
    const { version, asset } = await getOwnedVersion(ctx, b.assetVersionId, s.accountId);
    if (version.status !== 'finalized' || asset.purpose !== 'benchmark') throw badRequest('benchmark data must be a finalized benchmark asset');
    // curated (public) benchmarks are admin-only; anyone may register a private benchmark
    if (!b.private) requireAdmin(ctx, req);
    const [row] = await db.insert(schema.benchmarks).values({ ...b, id: `${b.id}@${b.version}`, ownerId: s.accountId }).onConflictDoNothing().returning();
    if (!row) throw conflict('benchmark id/version exists (versions are immutable)');
    await audit(db, s, 'benchmark.create', row.id);
    return row;
  });

  app.get('/benchmarks', async (req) => {
    const s = req.session;
    const rows = await db.select().from(schema.benchmarks);
    return rows.filter((b) => !b.private || b.ownerId === s?.accountId).map(({ assetVersionId, ...b }) => b);
  });
}
