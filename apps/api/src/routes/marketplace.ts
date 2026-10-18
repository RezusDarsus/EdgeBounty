import { createCheckout, ensureListingCoverage } from '../lib/billing.js';
import { checkoutView, platformResultReusable } from '../lib/checkout-view.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { DATASET_CATEGORIES, SERVICE_KINDS } from '@edgebounty/shared-types';
import { AcceptanceCriteria, DOMAIN, OrderTerms, bytesToHex, hashDocument } from '@edgebounty/verification-schemas';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { getOwnedVersion } from '../lib/assets.js';
import { badRequest, conflict, forbidden, HttpError, isAdmin, notFound, parse, requireSession, zMicro, zUuid, zWallet } from '../lib/http.js';
import { runSandboxed } from '../services/sandbox.js';
import { audit } from '../lib/audit.js';
import { requireListingVerification, requestVerificationQuote } from '../lib/verification-policy.js';
import { syncOrder } from '../services/indexer.js';
import {assertCollaborationSettlementVersion} from '../services/collaboration-settlement.js';
import {collaborationReservation,CollaborationService} from '../services/collaboration.js';

export const randomU63 = () => randomBytes(8).readBigUInt64LE() & 0x7fff_ffff_ffff_ffffn;
const pk = (s: string) => new PublicKey(s);

async function license(ctx: AppContext, id: string) {
  const [l] = await ctx.db.select().from(schema.licenses).where(eq(schema.licenses.id, id));
  if (!l) throw badRequest(`unknown license ${id}`);
  return l;
}

/** Party check for order-scoped resources. */
export async function orderAccess(ctx: AppContext, orderId: string, s: { accountId: string; wallet: string; roles: string[] } | undefined) {
  const [o] = await ctx.db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o) throw notFound('order');
  const role = !s ? null : s.wallet === o.buyerWallet ? 'buyer' : s.wallet === o.sellerWallet || s.wallet === o.designatedSeller ? 'seller' : s.wallet === o.verifierWallet ? 'verifier' : isAdmin(ctx, s as any) ? 'admin' : null;
  return { order: o, role };
}

export function marketplaceRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get('/licenses', async () => db.select({ id: schema.licenses.id, name: schema.licenses.name, hash: schema.licenses.hash, commercial: schema.licenses.commercial, redistribution: schema.licenses.redistribution }).from(schema.licenses));
  app.get('/licenses/:id', async (req) => {
    const [l] = await db.select().from(schema.licenses).where(eq(schema.licenses.id, (req.params as any).id));
    if (!l) throw notFound('license');
    return l;
  });

  // ================================================================ listings

  app.post('/listings', async (req) => {
    const s = requireSession(req);
    const b = parse(
      z.object({
        assetVersionId: zUuid,
        title: z.string().min(3).max(200),
        description: z.string().min(10).max(10_000),
        category: z.string().max(60),
        formats: z.array(z.string().max(20)).max(20).default([]),
        recordCount: z.number().int().nonnegative().optional(),
        language: z.string().max(40).optional(),
        labeling: z.string().max(500).optional(),
        licenseId: z.string(),
        priceMicro: zMicro,
        commercialUse: z.boolean().default(true),
        exclusive: z.boolean().default(false),
        details: z.record(z.string(), z.unknown()).default({}),
      }),
      req.body,
    );
    if (b.priceMicro <= 0n) throw badRequest('price must be positive');
    const { version, asset } = await getOwnedVersion(ctx, b.assetVersionId, s.accountId);
    if (version.status !== 'finalized') throw conflict('finalize the asset version first');
    if (asset.purpose !== 'listing') throw badRequest('asset was not uploaded for listing');
    await requireListingVerification(ctx, version.id);
    await ensureListingCoverage(ctx, s.accountId, version.id);
    const lic = await license(ctx, b.licenseId);
    const terms = {
      schema: 'edgebounty.listing-terms/1',
      title: b.title,
      licenseId: lic.id,
      licenseHash: lic.hash,
      commercialUse: b.commercialUse && lic.commercial,
      exclusive: b.licenseId === 'eb-exclusive-transfer-v1' || b.exclusive,
      assetKind: asset.kind,
      formats: b.formats,
      recordCount: b.recordCount ?? null,
    };
    const termsHash = bytesToHex(hashDocument(DOMAIN.terms, terms));
    const listingIdOnchain = randomU63();
    const address = ctx.chain.client.pda.listing(pk(s.wallet), listingIdOnchain).toBase58();
    const [l] = await db
      .insert(schema.listings)
      .values({
        sellerId: s.accountId, sellerWallet: s.wallet, assetId: asset.id, assetVersionId: version.id, kind: asset.kind,
        title: b.title, description: b.description, category: b.category, formats: b.formats, recordCount: b.recordCount, language: b.language, labeling: b.labeling,
        details: b.details, licenseId: lic.id, licenseHash: lic.hash, terms, termsHash, priceMicro: b.priceMicro, listingIdOnchain, onchainAddress: address,
      })
      .returning();
    return { listing: l, onchain: { listingId: listingIdOnchain.toString(), kind: asset.kind, assetCommitment: version.commitment, termsHash, licenseHash: lic.hash, price: b.priceMicro.toString(), address } };
  });

  /** Called after the seller signed create_listing / update_listing_version; verifies chain state. */
  app.post('/listings/:id/confirm', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [l] = await db.select().from(schema.listings).where(eq(schema.listings.id, id));
    if (!l) throw notFound('listing');
    if (l.sellerId !== s.accountId) throw forbidden();
    const chain = await ctx.chain.client.listing(pk(l.onchainAddress));
    if (!chain) throw conflict('listing not found on-chain yet');
    const v = await versionByCommitment(ctx, l.assetId, chain.assetCommitment);
    if (chain.seller !== l.sellerWallet || !v || chain.termsHash !== l.termsHash || chain.licenseHash !== l.licenseHash) {
      throw conflict('on-chain listing does not match the prepared terms');
    }
    await requireListingVerification(ctx, v.id);
    const status = chain.moderated ? 'moderated' : chain.active ? 'published' : 'delisted';
    // switch to the new files only once the new version is live on-chain
    await db.update(schema.listings).set({ status, assetVersionId: v.id, onchainVersion: chain.version, priceMicro: chain.price, updatedAt: new Date() }).where(eq(schema.listings.id, id));
    return { status, version: chain.version };
  });

  /** Prepare a new immutable version of a listing (new asset version and/or price). */
  app.post('/listings/:id/versions', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const b = parse(z.object({ assetVersionId: zUuid, priceMicro: zMicro.optional() }), req.body);
    const [l] = await db.select().from(schema.listings).where(eq(schema.listings.id, id));
    if (!l) throw notFound('listing');
    if (l.sellerId !== s.accountId) throw forbidden();
    const { version } = await getOwnedVersion(ctx, b.assetVersionId, s.accountId);
    if (version.status !== 'finalized' || version.assetId !== l.assetId) throw badRequest('version must be a finalized version of the same asset');
    await requireListingVerification(ctx, version.id);
    await ensureListingCoverage(ctx, s.accountId, version.id);
    const price = b.priceMicro ?? l.priceMicro;
    // nothing changes in the DB until the seller signs update_listing_version and calls /confirm
    return { onchain: { assetCommitment: version.commitment, termsHash: l.termsHash, licenseHash: l.licenseHash, price: price.toString(), address: l.onchainAddress } };
  });

  app.get('/listings', async (req) => {
    const q = parse(
      z.object({
        kind: z.enum(['dataset', 'model', 'code', 'other']).optional(), category: z.string().optional(), q: z.string().trim().max(100).optional(), seller: z.string().optional(),
        sort: z.enum(['relevance', 'newest', 'price-asc', 'price-desc', 'sales']).optional(),
        verified: z.enum(['1', 'true']).optional(),
        minPrice: z.coerce.bigint().min(0n).optional(), maxPrice: z.coerce.bigint().min(0n).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30), offset: z.coerce.number().int().min(0).default(0),
      }),
      req.query,
    );
    const where = [eq(schema.listings.status, 'published')];
    if (q.kind) where.push(eq(schema.listings.kind, q.kind));
    if (q.category) where.push(eq(schema.listings.category, q.category));
    if (q.seller) where.push(eq(schema.listings.sellerWallet, q.seller));
    if (q.minPrice !== undefined) where.push(gte(schema.listings.priceMicro, q.minPrice));
    if (q.maxPrice !== undefined) where.push(lte(schema.listings.priceMicro, q.maxPrice));
    if (q.verified) where.push(sql`exists (${PASSED_CHECK} and j.asset_version_id = ${schema.listings.assetVersionId})`);
    // Ranked full-text search (stemmed, uses the listings_search GIN index) plus substring fallback for partial words.
    const tsQuery = q.q ? sql`websearch_to_tsquery('english', ${q.q})` : null;
    if (q.q) where.push(or(sql`${LISTING_TSV} @@ ${tsQuery}`, ilike(schema.listings.title, `%${likeEscape(q.q)}%`))!);
    const sort = q.sort ?? (q.q ? 'relevance' : 'newest');
    const order = {
      relevance: tsQuery ? [sql`ts_rank(${LISTING_TSV}, ${tsQuery}) desc`, desc(schema.listings.sales)] : [desc(schema.listings.createdAt)],
      newest: [desc(schema.listings.createdAt)],
      'price-asc': [asc(schema.listings.priceMicro)],
      'price-desc': [desc(schema.listings.priceMicro)],
      sales: [desc(schema.listings.sales), desc(schema.listings.createdAt)],
    }[sort];
    const rows = await db.select().from(schema.listings).where(and(...where)).orderBy(...order, desc(schema.listings.id)).limit(q.limit).offset(q.offset);
    return { items: await Promise.all(rows.map((l) => publicListing(ctx, l))), categories: DATASET_CATEGORIES, sort };
  });

  app.get('/listings/:id', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [l] = await db.select().from(schema.listings).where(eq(schema.listings.id, id));
    if (!l || (l.status !== 'published' && l.sellerWallet !== req.session?.wallet && !isAdmin(ctx, req.session))) throw notFound('listing');
    if (l.status === 'published' && req.session?.accountId !== l.sellerId) await countView(ctx, l.id, req.session?.accountId);
    return publicListing(ctx, l, true);
  });

  app.get('/me/listings', async (req) => {
    const s = requireSession(req);
    const rows = await db.select().from(schema.listings).where(eq(schema.listings.sellerId, s.accountId)).orderBy(desc(schema.listings.createdAt));
    return Promise.all(rows.map((l) => publicListing(ctx, l)));
  });

  /** Prepare a purchase order (client signs create_order, then POST /orders/:id/confirm). */
  app.post('/listings/:id/purchase', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const b = parse(
      z.object({ verifierWallet: zWallet.optional(), verifierFeeMicro: zMicro.default(0n), criteria: AcceptanceCriteria.optional(), accessMonths: z.union([z.literal(1), z.literal(3), z.literal(6)]).default(1) }).default({ verifierFeeMicro: 0n, accessMonths: 1 }),
      req.body ?? {},
    );
    if (b.criteria && !b.verifierWallet) throw badRequest('acceptance criteria for a purchase require an independent verifier');
    const [l] = await db.select().from(schema.listings).where(eq(schema.listings.id, id));
    if (!l || l.status !== 'published') throw notFound('listing');
    if (l.sellerWallet === s.wallet) throw badRequest('cannot buy your own listing');
    const chain = await ctx.chain.client.listing(pk(l.onchainAddress));
    if (!chain?.active) throw conflict('listing not active on-chain');
    // verification is paid once per version: a buyer re-requesting an already-verified check from the
    // platform verifier pays no verification fee (the persisted result is reused, see services/jobs.ts)
    const verifierFee = b.verifierWallet && b.criteria && (await platformResultReusable(ctx, l.assetVersionId, b.verifierWallet, b.criteria)) ? 0n : b.verifierFeeMicro;
    const orderIdOnchain = randomU63();
    const address = ctx.chain.client.pda.order(pk(s.wallet), orderIdOnchain).toBase58();
    const [o] = await db
      .insert(schema.orders)
      .values({
        kind: 'purchase', buyerId: s.accountId, buyerWallet: s.wallet, sellerId: l.sellerId, sellerWallet: l.sellerWallet, listingId: l.id, orderIdOnchain, onchainAddress: address,
        title: l.title, terms: l.terms as object, termsHash: chain.termsHash, criteria: b.criteria ?? null, criteriaHash: b.criteria ? bytesToHex(hashDocument(DOMAIN.criteria, b.criteria)) : '0'.repeat(64), licenseId: l.licenseId, licenseHash: chain.licenseHash,
        amountMicro: chain.price, verifierWallet: b.verifierWallet ?? null, verifierFeeMicro: b.verifierWallet ? verifierFee : 0n, public: false,
      })
      .returning();
    const checkout = await createCheckout(ctx, { orderId: o.id, listingId: l.id, buyerId: s.accountId, assetVersionId: l.assetVersionId, priceLamports: chain.price, months: b.accessMonths });
    return { order: o, checkout: checkoutView(checkout), onchain: { orderId: orderIdOnchain.toString(), listing: l.onchainAddress, expectedPrice: chain.price.toString(), expectedVersion: chain.version, verifier: b.verifierWallet ?? null, verifierFee: o.verifierFeeMicro.toString(), address } };
  });

  /**
   * Controlled model preview: run the listed ONNX model on ONE buyer-supplied image in the
   * sandbox and return only top-k scores. Weights never leave the platform. 5 trials/day/listing/wallet.
   */
  app.post('/listings/:id/inference-trial', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [l] = await db.select().from(schema.listings).where(eq(schema.listings.id, id));
    if (!l || l.status !== 'published' || l.kind !== 'model') throw notFound('model listing');
    const spec = (l.details as any)?.inference;
    if (!spec) throw conflict('seller has not enabled inference trials for this model');
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0 || body.length > 5 * 1024 * 1024) throw badRequest('send one image (<= 5 MB) as application/octet-stream');
    const since = new Date(Date.now() - 86_400_000);
    const [{ n }] = await db
      .select({ n: sql<string>`count(*)` })
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.action, 'inference.trial'), eq(schema.auditEvents.actorWallet, s.wallet), eq(schema.auditEvents.target, id), gte(schema.auditEvents.createdAt, since)));
    if (Number(n) >= 5) throw new HttpError(429, 'trial_limit', 'inference trial limit reached (5 per day)');
    const work = join(ctx.cfg.DATA_DIR, 'work', `trial-${randomBytes(8).toString('hex')}`);
    const inDir = join(work, 'in');
    const outDir = join(work, 'out');
    try {
      await mkdir(inDir, { recursive: true });
      await mkdir(outDir, { recursive: true });
      for (const f of await db.select().from(schema.assetFiles).where(eq(schema.assetFiles.versionId, l.assetVersionId))) await ctx.storage.materialize(f.objectKey, join(inDir, ...f.path.split('/')));
      await writeFile(join(outDir, 'input.img'), body);
      await writeFile(join(outDir, 'spec.json'), JSON.stringify(spec));
      const r = await runSandboxed(ctx.cfg, { script: 'model-validator/infer.py', args: ['--model-dir', '{in}', '--input', '{out}/input.img', '--spec', '{out}/spec.json', '--output', '{out}/out.json'], inputDir: inDir, outputDir: outDir, timeoutMs: 60_000 });
      if (r.code !== 0) {
        req.log.warn({ stderr: r.stderr.slice(-500) }, 'inference trial failed');
        throw badRequest('inference failed: input could not be processed');
      }
      await audit(db, s, 'inference.trial', id);
      return { ...JSON.parse(await readFile(join(outDir, 'out.json'), 'utf8')), remainingToday: 4 - Number(n), note: 'Scores from the listed model version in a sandbox; weights are not released before purchase.' };
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => {});
    }
  });

  // ================================================================ custom bounties

  app.post('/bounties/verification-quote', async (req) => {
    requireSession(req);
    const b = parse(z.object({ criteria: AcceptanceCriteria, maxCorrections: z.number().int().min(0).max(5) }), req.body);
    const q = requestVerificationQuote(b.criteria, b.maxCorrections, ctx.cfg);
    return { feeMicro: q.fee.toString(), rounds: q.rounds, currency: ctx.cfg.PAYMENT_CURRENCY };
  });

  app.post('/bounties', async (req) => {
    const s = requireSession(req);
    const b = parse(
      z.object({
        title: z.string().min(3).max(200),
        description: z.string().min(10).max(10_000),
        deliverables: z.array(z.string().max(500)).min(1).max(50),
        frameworks: z.array(z.string()).max(20).default([]),
        category: z.string().max(60).optional(),
        criteria: AcceptanceCriteria,
        licenseId: z.string(),
        ipTerms: z.enum(['non_exclusive_license', 'exclusive_license', 'assignment']).default('non_exclusive_license'),
        budgetMicro: zMicro,
        deadline: z.coerce.date(),
        maxCorrections: z.number().int().min(0).max(5).default(1),
        verifierWallet: zWallet.optional(),
        verifierFeeMicro: zMicro.default(0n),
        public: z.boolean().default(true),
        collaborationTarget: z.number().int().positive().max(1000000).optional(),
        /** Phase 5: independent arbitrator agreed by the buyer (the seller agrees by accepting). */
        arbitratorWallet: zWallet.optional(),
        /** Phase 5: split into sequential milestones (same developer) or parallel seller slots. */
        structure: z.enum(['single', 'milestones', 'slots']).default('single'),
        milestones: z.array(z.object({ title: z.string().min(2).max(200), amountMicro: zMicro, deadline: z.coerce.date() })).max(12).optional(),
        slots: z.number().int().min(2).max(20).optional(),
      }),
      req.body,
    );
    const platformVerifier = ctx.chain.platformVerifier?.publicKey.toBase58();
    if (!platformVerifier) throw conflict('Platform verification is not available.');
    if (b.verifierWallet && b.verifierWallet !== platformVerifier) throw badRequest('Funded requests use the platform verifier and fixed platform rates.');
    b.verifierWallet = platformVerifier;
    b.verifierFeeMicro = requestVerificationQuote(b.criteria, b.maxCorrections, ctx.cfg).fee;
    if (b.budgetMicro <= 0n) throw badRequest('budget must be positive');
    if(b.collaborationTarget&&(ctx.cfg.COLLABORATIVE_BOUNTIES_ENABLED!=='1'||b.structure!=='single'||b.criteria.kind!=='image_dataset'))throw badRequest('Collaborative image bounties must be enabled and use a single shared target');
    if (b.deadline.getTime() < Date.now() + 3600_000) throw badRequest('deadline must be at least 1h in the future');
    if (b.arbitratorWallet && [s.wallet, b.verifierWallet].includes(b.arbitratorWallet)) throw badRequest('arbitrator must be independent of buyer and verifier');
    const lic = await license(ctx, b.licenseId);
    if (b.licenseId === 'eb-exclusive-transfer-v1') b.ipTerms = 'assignment';
    else if (b.ipTerms !== 'non_exclusive_license') throw badRequest('The selected license does not grant exclusive transfer rights.');
    const terms: OrderTerms = OrderTerms.parse({ schema: 'edgebounty.terms/1', title: b.title, description: b.description, deliverables: b.deliverables, frameworks: b.frameworks, licenseId: lic.id, ipTerms: b.ipTerms, commercialUse: lic.commercial });
    const termsHash = bytesToHex(hashDocument(DOMAIN.terms, terms));
    const criteriaHash = bytesToHex(hashDocument(DOMAIN.criteria, b.criteria));

    // one normal escrowed order per milestone / slot: no new money paths in the program
    let parts: { title: string; amount: bigint; deadline: Date }[];
    if (b.structure === 'milestones') {
      if (!b.milestones || b.milestones.length < 2) throw badRequest('milestone contracts need at least two milestones');
      if (b.milestones.reduce((n, m) => n + m.amountMicro, 0n) !== b.budgetMicro) throw badRequest('milestone amounts must add up to the budget');
      parts = b.milestones.map((m) => ({ title: `${b.title} - ${m.title}`, amount: m.amountMicro, deadline: m.deadline }));
    } else if (b.structure === 'slots') {
      if (!b.slots) throw badRequest('slots required');
      if (b.budgetMicro % BigInt(b.slots) !== 0n) throw badRequest('budget must divide evenly into slots');
      parts = Array.from({ length: b.slots }, (_, i) => ({ title: `${b.title} - slot ${i + 1}/${b.slots}`, amount: b.budgetMicro / BigInt(b.slots!), deadline: b.deadline }));
    } else parts = [{ title: b.title, amount: b.budgetMicro, deadline: b.deadline }];

    const groupId = parts.length > 1 ? randomUUID() : null;
    const rows = [];
    for (const [i, part] of parts.entries()) {
      const orderIdOnchain = randomU63();
      const [o] = await db
        .insert(schema.orders)
        .values({
          kind: 'bounty', buyerId: s.accountId, buyerWallet: s.wallet, orderIdOnchain, onchainAddress: ctx.chain.client.pda.order(pk(s.wallet), orderIdOnchain).toBase58(),
          title: part.title, description: b.description, category: b.category, terms, termsHash, criteria: b.criteria, criteriaHash, licenseId: lic.id, licenseHash: lic.hash,
          amountMicro: part.amount, verifierWallet: b.verifierWallet ?? null, verifierFeeMicro: b.verifierWallet ? b.verifierFeeMicro : 0n, deadline: part.deadline,
          maxCorrections: b.maxCorrections, public: b.public, arbitratorWallet: b.arbitratorWallet ?? null,
          groupId, groupKind: groupId ? (b.structure === 'milestones' ? 'milestone' : 'slot') : null, groupIndex: groupId ? i : null,
          designatedSeller:b.collaborationTarget?collaborationReservation(ctx.chain.client.programId,s.wallet,orderIdOnchain):null,
        })
        .returning();
      rows.push(o);
      if(b.collaborationTarget)await new CollaborationService(db).enable(o.id,s.accountId,b.collaborationTarget,86400,6);
    }
    // milestones are funded one at a time (later ones bind the same developer); slots are all funded now
    const fundNow = b.structure === 'milestones' ? rows.slice(0, 1) : rows;
    return { order: rows[0], orders: rows, groupId, onchain: bountyArgs(rows[0]), fundNow: fundNow.map((o) => ({ orderId: o.id, onchain: bountyArgs(o) })) };
  });

  /** Prepare the next milestone of a contract, bound to the developer who delivered the previous one. */
  app.post('/orders/:id/milestones/next', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [cur] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    if (!cur || cur.buyerWallet !== s.wallet || cur.groupKind !== 'milestone') throw notFound('milestone order');
    const group = (await db.select().from(schema.orders).where(eq(schema.orders.groupId, cur.groupId!))).sort((a, b) => a.groupIndex! - b.groupIndex!);
    const next = group.find((o) => o.chainState === 'draft');
    if (!next) throw conflict('all milestones are funded');
    const prev = group[next.groupIndex! - 1];
    if (prev.chainState !== 'settled' || !prev.sellerWallet) throw conflict('the previous milestone must be settled first');
    await db.update(schema.orders).set({ designatedSeller: prev.sellerWallet }).where(eq(schema.orders.id, next.id));
    return { orderId: next.id, onchain: bountyArgs({ ...next, designatedSeller: prev.sellerWallet }) };
  });

  app.get('/groups/:id', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const rows = (await db.select().from(schema.orders).where(eq(schema.orders.groupId, id))).sort((a, b) => a.groupIndex! - b.groupIndex!);
    if (!rows.length) throw notFound('group');
    return { groupId: id, kind: rows[0].groupKind, orders: rows.map(publicOrder) };
  });

  app.get('/bounties', async (req) => {
    const q = parse(z.object({ state: z.string().default('funded'), q: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }), req.query);
    const where = [eq(schema.orders.kind, 'bounty'), eq(schema.orders.public, true), inArray(schema.orders.chainState, q.state.split(','))];
    if (q.q) where.push(ilike(schema.orders.title, `%${q.q}%`));
    const rows = await db.select().from(schema.orders).where(and(...where)).orderBy(desc(schema.orders.createdAt)).limit(q.limit);
    return rows.map(publicOrder);
  });

  // ================================================================ orders

  app.post('/orders/:id/confirm', async (req) => {
    const s = requireSession(req);
    const { order, role } = await orderAccess(ctx, parse(z.object({ id: zUuid }), req.params).id, req.session);
    if (!role) throw forbidden();
    const view = await syncOrder(ctx, order);
    if (!view) throw conflict('order not found on-chain yet');
    const [fresh] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id));
    if (fresh.chainState === 'mismatch') throw conflict('on-chain order does not match the prepared terms');
    if (order.kind === 'bounty' && view.criteriaHash !== order.criteriaHash) throw conflict('criteria hash mismatch');
    await audit(db, s, 'order.confirm', order.id, { state: view.state });
    return { state: view.state, chain: view };
  });

  /** Anyone involved can force a re-sync after signing a transaction. */
  app.post('/orders/:id/sync', async (req) => {
    requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    if (!o) throw notFound('order');
    const view = await syncOrder(ctx, o);
    // a seller who just accepted is not yet linked: link by on-chain seller
    return { state: view?.state ?? o.chainState, chain: view };
  });

  app.get('/orders/:id', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { order, role } = await orderAccess(ctx, id, req.session);
    if (!role) {
      if (order.kind === 'bounty' && order.public) return { ...publicOrder(order), role: null };
      throw notFound('order');
    }
    const subs = await db.select().from(schema.submissions).where(eq(schema.submissions.orderId, id));
    const jobs = await db.select().from(schema.verificationJobs).where(eq(schema.verificationJobs.orderId, id));
    const results = jobs.length ? await db.select().from(schema.verificationResults).where(inArray(schema.verificationResults.jobId, jobs.map((j) => j.id))) : [];
    const disputes = await db.select().from(schema.disputes).where(eq(schema.disputes.orderId, id));
    const [ent] = await db.select().from(schema.deliveryEntitlements).where(eq(schema.deliveryEntitlements.orderId, id));
    const [checkout] = role === 'buyer' && order.kind === 'purchase'
      ? await db.select().from(schema.checkoutQuotes).where(eq(schema.checkoutQuotes.orderId, id))
      : [];
    const [checkoutInvoice] = checkout?.invoiceId
      ? await db.select().from(schema.invoices).where(eq(schema.invoices.id, checkout.invoiceId))
      : [];
    return {
      ...order,
      role,
      collaborationSettlement: (await db.execute(sql`select bounty_id as "bountyId",expected_count as "expectedCount",manifest_hash as "manifestHash" from collaboration_settlements where order_id=${id}`) as any).rows?.[0] ?? null,
      submissions: subs.map((x) => ({ index: x.index, commitment: x.commitment, status: x.status, createdAt: x.createdAt, ...(role !== 'buyer' ? { assetVersionId: x.assetVersionId } : {}) })),
      verifications: jobs.map((j) => {
        const r = results.find((x) => x.jobId === j.id);
        return { jobId: j.id, submissionIndex: j.submissionIndex, level: j.level, status: j.status, error: j.error, report: r?.report ?? null, reportHash: r?.reportHash ?? null, attestation: r?.attestationAddress ?? null, tx: r?.txSignature ?? null };
      }),
      disputes,
      deliveryAvailable: !!ent && !ent.revokedAt,
      checkout: checkout ? {
        status: checkout.status,
        months: checkout.months,
        amountMicro: checkout.extrasMicro.toString(),
        invoice: checkoutInvoice?.status === 'open' ? {
          id: checkoutInvoice.id,
          reference: checkoutInvoice.reference,
          amountMicro: checkoutInvoice.amountMicro.toString(),
          serviceKind: SERVICE_KINDS.other,
          expiresAt: checkoutInvoice.expiresAt,
        } : null,
        invoiceStatus: checkoutInvoice?.status ?? null,
      } : null,
    };
  });

  /** Controlled preview of the current deliverable for the buyer/verifier (never the full files). */
  app.get('/orders/:id/review', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { order, role } = await orderAccess(ctx, id, req.session);
    if (!role) throw notFound('order');
    const versionId = await orderVersionId(ctx, order);
    if (!versionId) return { previews: [] };
    const [v] = await db.select().from(schema.assetVersions).where(eq(schema.assetVersions.id, versionId));
    const items = (v?.preview as { kind: string; label: string | null }[] | null) ?? [];
    return { commitment: v?.commitment, fileCount: v?.fileCount, totalSize: v?.totalSize, previewStatus: v?.previewStatus, previews: items.map((p, i) => ({ url: `/previews/${versionId}/${i}`, kind: p.kind, label: p.label })) };
  });

  app.get('/me/orders', async (req) => {
    const s = requireSession(req);
    const rows = await db
      .select()
      .from(schema.orders)
      .where(or(eq(schema.orders.buyerWallet, s.wallet), eq(schema.orders.sellerWallet, s.wallet), eq(schema.orders.verifierWallet, s.wallet)))
      .orderBy(desc(schema.orders.createdAt));
    return rows.map((o) => ({ ...publicOrder(o), role: o.buyerWallet === s.wallet ? 'buyer' : o.sellerWallet === s.wallet ? 'seller' : 'verifier' }));
  });

  // ---------------------------------------------------------------- submissions

  app.post('/orders/:id/submissions', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { assetVersionId } = parse(z.object({ assetVersionId: zUuid }), req.body);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    if (!o || o.kind !== 'bounty') throw notFound('bounty order');
    const view = await syncOrder(ctx, o);
    if (!view || view.seller !== s.wallet) throw forbidden('only the assigned seller can submit');
    if (!['assigned', 'correction_required'].includes(view.state)) throw conflict(`cannot submit in state ${view.state}`);
    const { version, asset } = await getOwnedVersion(ctx, assetVersionId, s.accountId);
    if (version.status !== 'finalized') throw conflict('finalize the asset version first');
    if (asset.purpose !== 'submission') throw badRequest('asset was not uploaded as a submission');
    await assertCollaborationSettlementVersion(ctx,id,s.accountId,assetVersionId);
    if ((version.metadata as any)?.encrypted && o.verifierWallet === ctx.chain.platformVerifier?.publicKey.toBase58()) {
      throw badRequest('client-side encrypted submissions cannot be verified automatically; this order uses the automated verifier');
    }
    await db.delete(schema.submissions).where(and(eq(schema.submissions.orderId, id), eq(schema.submissions.index, view.submissionCount), eq(schema.submissions.status, 'prepared')));
    const [sub] = await db.insert(schema.submissions).values({ orderId: id, index: view.submissionCount, assetVersionId, commitment: version.commitment! }).returning();
    return { submission: sub, onchain: { commitment: version.commitment, version: version.version, submissionIndex: view.submissionCount } };
  });

  // ---------------------------------------------------------------- disputes

  app.post('/orders/:id/disputes', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const b = parse(z.object({ reason: z.string().min(10).max(5000), evidenceAssetVersionId: zUuid.optional() }), req.body);
    const { order, role } = await orderAccess(ctx, id, req.session);
    if (role !== 'buyer' && role !== 'seller') throw forbidden();
    const view = await syncOrder(ctx, order);
    if (!view) throw conflict('order not on-chain');
    let evidence = null;
    if (b.evidenceAssetVersionId) {
      const { version } = await getOwnedVersion(ctx, b.evidenceAssetVersionId, s.accountId);
      if (version.status !== 'finalized') throw conflict('finalize evidence first');
      evidence = { by: s.wallet, note: 'initial evidence', assetVersionId: version.id, hash: version.commitment!, at: new Date().toISOString() };
    }
    const reasonHash = bytesToHex(hashDocument(DOMAIN.evidence, { reason: b.reason, evidence: evidence?.hash ?? null }));
    await db.delete(schema.disputes).where(and(eq(schema.disputes.orderId, id), eq(schema.disputes.index, view.disputeCount), eq(schema.disputes.status, 'prepared')));
    const [d] = await db.insert(schema.disputes).values({ orderId: id, index: view.disputeCount, openedByWallet: s.wallet, reason: b.reason, reasonHash, evidence: evidence ? [evidence] : [] }).returning();
    return { dispute: d, onchain: { reasonHash } };
  });

  app.post('/orders/:id/disputes/evidence', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const b = parse(z.object({ note: z.string().min(3).max(5000), assetVersionId: zUuid.optional() }), req.body);
    const { order, role } = await orderAccess(ctx, id, req.session);
    if (role !== 'buyer' && role !== 'seller') throw forbidden();
    const [d] = await db.select().from(schema.disputes).where(and(eq(schema.disputes.orderId, order.id), eq(schema.disputes.status, 'open'))).orderBy(desc(schema.disputes.index));
    if (!d) throw conflict('no open dispute');
    let hash = bytesToHex(hashDocument(DOMAIN.evidence, { note: b.note }));
    if (b.assetVersionId) {
      const { version } = await getOwnedVersion(ctx, b.assetVersionId, s.accountId);
      if (version.status !== 'finalized') throw conflict('finalize evidence first');
      hash = bytesToHex(hashDocument(DOMAIN.evidence, { note: b.note, commitment: version.commitment }));
    }
    await db.update(schema.disputes).set({ evidence: [...d.evidence, { by: s.wallet, note: b.note, assetVersionId: b.assetVersionId, hash, at: new Date().toISOString() }] }).where(eq(schema.disputes.id, d.id));
    return { onchain: { evidenceHash: hash } };
  });

  // ---------------------------------------------------------------- reviews (only after a completed order)

  app.post('/orders/:id/reviews', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const b = parse(z.object({ rating: z.number().int().min(1).max(5), comment: z.string().max(2000).default('') }), req.body);
    const { order, role } = await orderAccess(ctx, id, req.session);
    if (role !== 'buyer' && role !== 'seller') throw forbidden();
    if (!['settled', 'refunded'].includes(order.chainState)) throw conflict('reviews open after the order completes');
    const subjectId = role === 'buyer' ? order.sellerId : order.buyerId;
    if (!subjectId) throw conflict('counterparty unknown');
    const [r] = await db.insert(schema.reviews).values({ orderId: id, reviewerId: s.accountId, subjectId, rating: b.rating, comment: b.comment }).onConflictDoNothing().returning();
    if (!r) throw conflict('already reviewed');
    return r;
  });
}

/** The finalized version of an asset with a given commitment (commitments are unique per salted manifest). */
export async function versionByCommitment(ctx: AppContext, assetId: string, commitment: string) {
  const [v] = await ctx.db
    .select()
    .from(schema.assetVersions)
    .where(and(eq(schema.assetVersions.assetId, assetId), eq(schema.assetVersions.commitment, commitment), eq(schema.assetVersions.status, 'finalized')));
  return v ?? null;
}

/** Asset version an order currently refers to, resolved through its on-chain commitment. */
export async function orderVersionId(ctx: AppContext, order: typeof schema.orders.$inferSelect): Promise<string | null> {
  const commitment = (order.chain as any)?.currentCommitment as string | undefined;
  if (!commitment) return null;
  if (order.kind === 'purchase') {
    const [l] = await ctx.db.select().from(schema.listings).where(eq(schema.listings.id, order.listingId!));
    return l ? ((await versionByCommitment(ctx, l.assetId, commitment))?.id ?? null) : null;
  }
  const subs = await ctx.db.select().from(schema.submissions).where(eq(schema.submissions.orderId, order.id));
  return subs.find((s) => s.commitment === commitment)?.assetVersionId ?? null;
}

export function bountyArgs(o: typeof schema.orders.$inferSelect) {
  return {
    orderId: o.orderIdOnchain.toString(), amount: o.amountMicro.toString(), verifier: o.verifierWallet, verifierFee: o.verifierFeeMicro.toString(),
    termsHash: o.termsHash, criteriaHash: o.criteriaHash, licenseHash: o.licenseHash, deadline: Math.floor(o.deadline!.getTime() / 1000), maxCorrections: o.maxCorrections,
    designatedSeller: o.designatedSeller, arbitrator: o.arbitratorWallet, address: o.onchainAddress,
  };
}

export function publicOrder(o: typeof schema.orders.$inferSelect) {
  const c = o.chain as any;
  return {
    id: o.id, kind: o.kind, title: o.title, description: o.description, category: o.category, criteria: o.criteria, terms: o.terms,
    amountMicro: o.amountMicro.toString(), verifierWallet: o.verifierWallet, verifierFeeMicro: o.verifierFeeMicro.toString(), deadline: o.deadline,
    maxCorrections: o.maxCorrections, licenseId: o.licenseId, chainState: o.chainState, onchainAddress: o.onchainAddress, orderIdOnchain: o.orderIdOnchain.toString(),
    buyerWallet: o.buyerWallet, sellerWallet: o.sellerWallet, reviewDeadline: c?.reviewDeadline ?? null, createdAt: o.createdAt,
    groupId: o.groupId, groupKind: o.groupKind, groupIndex: o.groupIndex, designatedSeller: o.designatedSeller, arbitratorWallet: o.arbitratorWallet,
  };
}

/** Title outranks description, description outranks category; must match the listings_search index expression. */
const LISTING_TSV = sql`(setweight(to_tsvector('english', ${schema.listings.title}), 'A') || setweight(to_tsvector('english', ${schema.listings.description}), 'B') || setweight(to_tsvector('english', ${schema.listings.category}), 'C'))`;
/** Completed verification at L2 or above whose report passed. */
const PASSED_CHECK = sql`select 1 from verification_jobs j join verification_results r on r.job_id = j.id where j.status = 'completed' and r.passed and j.level in ('L2', 'L3', 'L4')`;
const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Signed-in viewers count once per listing per day (in-memory); anonymous views are approximate. */
const seenToday = { day: '', keys: new Set<string>() };
async function countView(ctx: AppContext, listingId: string, accountId?: string) {
  const day = new Date().toISOString().slice(0, 10);
  if (seenToday.day !== day) Object.assign(seenToday, { day, keys: new Set<string>() });
  if (accountId) {
    const key = `${accountId}:${listingId}`;
    if (seenToday.keys.has(key)) return;
    if (seenToday.keys.size < 200_000) seenToday.keys.add(key);
  }
  await ctx.db.execute(sql`insert into listing_views (listing_id, day, views) values (${listingId}::uuid, ${day}::date, 1) on conflict (listing_id, day) do update set views = listing_views.views + 1`).catch(() => {});
}

export async function publicListing(ctx: AppContext, l: typeof schema.listings.$inferSelect, detail = false) {
  const [v] = await ctx.db.select().from(schema.assetVersions).where(eq(schema.assetVersions.id, l.assetVersionId));
  const best = await ctx.db.execute(sql`select max(j.level) as level from verification_jobs j join verification_results r on r.job_id = j.id where j.status = 'completed' and r.passed and j.level in ('L2', 'L3', 'L4') and j.asset_version_id = ${l.assetVersionId}::uuid`);
  const verifiedLevel = ((((best as any).rows ?? best)[0]?.level) ?? null) as string | null;
  const [seller] = await ctx.db.select({ alias: schema.accounts.alias, mode: schema.accounts.mode }).from(schema.accounts).where(eq(schema.accounts.id, l.sellerId));
  let verification = null;
  if (detail) {
    const jobs = await ctx.db
      .select()
      .from(schema.verificationJobs)
      .where(and(eq(schema.verificationJobs.assetVersionId, l.assetVersionId), eq(schema.verificationJobs.status, 'completed')))
      .orderBy(desc(schema.verificationJobs.completedAt));
    const results = jobs.length ? await ctx.db.select().from(schema.verificationResults).where(inArray(schema.verificationResults.jobId, jobs.map((j) => j.id))) : [];
    verification = jobs.map((j) => {
      const r = results.find((x) => x.jobId === j.id);
      const rep = r?.report as any;
      return { level: j.level, passed: r?.passed ?? null, reportHash: r?.reportHash, attestation: r?.attestationAddress ?? null, metrics: rep?.datasetMetrics ?? rep?.modelMetrics ?? null, findings: (rep?.findings ?? []).map((f: any) => ({ severity: f.severity, code: f.code, message: f.message })), limitations: rep?.limitations ?? [], completedAt: j.completedAt };
    });
  }
  const preview = (v?.preview as { kind: string; label: string | null }[] | null) ?? [];
  return {
    id: l.id, kind: l.kind, title: l.title, description: l.description, category: l.category, formats: l.formats, recordCount: l.recordCount, language: l.language, labeling: l.labeling,
    details: l.details, licenseId: l.licenseId, priceMicro: l.priceMicro.toString(), status: l.status, version: l.onchainVersion, onchainAddress: l.onchainAddress, sales: l.sales,
    seller: { wallet: l.sellerWallet, alias: seller?.alias, mode: seller?.mode },
    asset: { versionId: v?.id, fileCount: v?.fileCount, totalSize: v?.totalSize, commitment: v?.commitment },
    previews: preview.map((p, i) => ({ url: `/previews/${l.assetVersionId}/${i}`, kind: p.kind, label: p.label })),
    previewStatus: v?.previewStatus,
    verifiedLevel,
    verification,
    createdAt: l.createdAt,
  };
}

