import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { PublicKey } from '@solana/web3.js';
import { DOMAIN, bytesToHex, hashDocument } from '@edgebounty/verification-schemas';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { getOwnedVersion } from '../lib/assets.js';
import { badRequest, conflict, forbidden, notFound, parse, requireSession, zMicro, zUuid, zWallet } from '../lib/http.js';
import { DOWNLOAD_TTL_SECS, signDownloadToken } from '../lib/tokens.js';
import { randomU63 } from './marketplace.js';

const FailureSpecSchema = z.object({
  kind: z.enum(['image_classification_failure', 'manual']),
  classes: z.array(z.string()).optional(),
  preprocessing: z
    .object({ size: z.tuple([z.number().int(), z.number().int()]), scale: z.number(), mean: z.array(z.number()).length(3), std: z.array(z.number()).length(3), layout: z.enum(['NCHW', 'NHWC']) })
    .optional(),
  failureDefinition: z.string().min(10).max(2000),
  inputType: z.string().max(200),
  environment: z.string().max(1000),
  duplicationRules: z.string().max(1000).default('Exact duplicates are rejected on-chain; near duplicates are rejected by the verifier.'),
  licenseRequired: z.string().default('cc-by-4.0'),
});

/** Module D — AI failure bounties. */
export function failureRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, cfg } = ctx;

  app.post('/failure-bounties', async (req) => {
    const s = requireSession(req);
    const b = parse(
      z.object({
        title: z.string().min(3).max(200),
        description: z.string().min(10).max(10_000),
        spec: FailureSpecSchema,
        modelAssetVersionId: zUuid.optional(),
        modelCommitment: z.string().regex(/^[0-9a-f]{64}$/).optional(),
        rewardMicro: zMicro,
        maxExamples: z.number().int().min(1).max(10_000),
        maxEvaluations: z.number().int().min(1).max(50_000),
        verifierWallet: zWallet,
        verifierFeeMicro: zMicro,
        expiresAt: z.coerce.date(),
      }),
      req.body,
    );
    if (b.maxEvaluations < b.maxExamples) throw badRequest('maxEvaluations must be >= maxExamples');
    let modelCommitment = b.modelCommitment;
    if (b.modelAssetVersionId) {
      const { version, asset } = await getOwnedVersion(ctx, b.modelAssetVersionId, s.accountId);
      if (asset.kind !== 'model' || version.status !== 'finalized') throw badRequest('target model must be a finalized model asset you own');
      modelCommitment = version.commitment!;
    }
    if (!modelCommitment) throw badRequest('provide modelAssetVersionId or modelCommitment');
    if (b.spec.kind === 'image_classification_failure' && (!b.spec.classes || !b.spec.preprocessing || !b.modelAssetVersionId)) {
      throw badRequest('automated failure checks need classes, preprocessing and the model asset');
    }
    const specHash = bytesToHex(hashDocument(DOMAIN.spec, b.spec));
    const termsHash = bytesToHex(hashDocument(DOMAIN.terms, { title: b.title, description: b.description, licenseRequired: b.spec.licenseRequired }));
    const bountyIdOnchain = randomU63();
    const address = ctx.chain.client.pda.failureBounty(new PublicKey(s.wallet), bountyIdOnchain).toBase58();
    const [row] = await db
      .insert(schema.failureBounties)
      .values({
        creatorId: s.accountId, creatorWallet: s.wallet, bountyIdOnchain, onchainAddress: address, title: b.title, description: b.description, spec: b.spec, specHash, termsHash,
        modelAssetVersionId: b.modelAssetVersionId ?? null, modelCommitment, rewardMicro: b.rewardMicro, verifierFeeMicro: b.verifierFeeMicro, maxExamples: b.maxExamples,
        maxEvaluations: b.maxEvaluations, verifierWallet: b.verifierWallet, expiresAt: b.expiresAt,
      })
      .returning();
    return {
      bounty: row,
      onchain: {
        bountyId: bountyIdOnchain.toString(), verifier: b.verifierWallet, modelCommitment, specHash, termsHash, rewardPerExample: b.rewardMicro.toString(), verifierFee: b.verifierFeeMicro.toString(),
        maxExamples: b.maxExamples, maxEvaluations: b.maxEvaluations, expiresAt: Math.floor(b.expiresAt.getTime() / 1000), address,
      },
    };
  });

  app.post('/failure-bounties/:id/sync', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [row] = await db.select().from(schema.failureBounties).where(eq(schema.failureBounties.id, id));
    if (!row) throw notFound('bounty');
    const v = await ctx.chain.client.failureBounty(new PublicKey(row.onchainAddress));
    if (!v) throw conflict('not on-chain yet');
    if (v.specHash !== row.specHash || v.modelCommitment !== row.modelCommitment || v.rewardPerExample !== row.rewardMicro) throw conflict('on-chain bounty does not match');
    await db.update(schema.failureBounties).set({ chainState: v.open ? 'open' : 'closed', chain: JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x))) }).where(eq(schema.failureBounties.id, id));
    const examples = await db.select().from(schema.failureExamples).where(eq(schema.failureExamples.bountyId, id));
    for (const e of examples) {
      const acct: any = await ctx.chain.client.program.account.failureExample.fetchNullable(new PublicKey(e.onchainAddress));
      if (acct) await db.update(schema.failureExamples).set({ status: Object.keys(acct.state)[0] as any }).where(eq(schema.failureExamples.id, e.id));
    }
    return { state: v.open ? 'open' : 'closed', chain: v };
  });

  app.get('/failure-bounties', async () => {
    const rows = await db.select().from(schema.failureBounties).where(eq(schema.failureBounties.chainState, 'open')).orderBy(desc(schema.failureBounties.createdAt));
    return rows.map(pub);
  });

  app.get('/failure-bounties/:id', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [row] = await db.select().from(schema.failureBounties).where(eq(schema.failureBounties.id, id));
    if (!row) throw notFound('bounty');
    const examples = await db.select().from(schema.failureExamples).where(eq(schema.failureExamples.bountyId, id));
    const s = req.session;
    return {
      ...pub(row),
      examples: examples.map((e) => ({ id: e.id, contributor: e.contributorWallet, status: e.status, commitment: e.commitment, mine: s?.wallet === e.contributorWallet, report: s && (s.wallet === row.creatorWallet || s.wallet === e.contributorWallet) ? e.report : null })),
    };
  });

  app.post('/failure-bounties/:id/examples', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { assetVersionId } = parse(z.object({ assetVersionId: zUuid }), req.body);
    const [b] = await db.select().from(schema.failureBounties).where(eq(schema.failureBounties.id, id));
    if (!b || b.chainState !== 'open') throw notFound('open bounty');
    if (s.wallet === b.creatorWallet || s.wallet === b.verifierWallet) throw forbidden('conflict of interest');
    const { version, asset } = await getOwnedVersion(ctx, assetVersionId, s.accountId);
    if (version.status !== 'finalized' || asset.purpose !== 'failure_example') throw badRequest('submit a finalized failure_example asset');
    const commitment = version.commitment!;
    const address = ctx.chain.client.pda.failureExample(new PublicKey(b.onchainAddress), Buffer.from(commitment, 'hex')).toBase58();
    const [dup] = await db.select().from(schema.failureExamples).where(eq(schema.failureExamples.onchainAddress, address));
    if (dup) throw conflict('identical example already submitted');
    const [row] = await db.insert(schema.failureExamples).values({ bountyId: id, contributorId: s.accountId, contributorWallet: s.wallet, assetVersionId, commitment, onchainAddress: address }).returning();
    return { example: row, onchain: { bounty: b.onchainAddress, commitment, address } };
  });

  /** Third-party verifier of a bounty: time-limited access to pending examples. */
  app.get('/failure-bounties/:id/pending', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [b] = await db.select().from(schema.failureBounties).where(eq(schema.failureBounties.id, id));
    if (!b) throw notFound('bounty');
    if (b.verifierWallet !== s.wallet) throw forbidden('verifier only');
    const pending = await db.select().from(schema.failureExamples).where(and(eq(schema.failureExamples.bountyId, id), eq(schema.failureExamples.status, 'pending')));
    const x = Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECS;
    const out = [];
    for (const e of pending) {
      const files = await db.select().from(schema.assetFiles).where(eq(schema.assetFiles.versionId, e.assetVersionId));
      // eval grants for failure examples are keyed by the example's provider job equivalence: use the bounty verifier
      out.push({ id: e.id, onchainAddress: e.onchainAddress, commitment: e.commitment, files: files.map((f) => ({ path: f.path, sha256: f.sha256, url: `/download/${signDownloadToken(cfg.DOWNLOAD_TOKEN_SECRET, { s: 'review', g: e.id, f: f.id, w: s.wallet, x })}` })) });
    }
    return out;
  });
}

function pub(b: typeof schema.failureBounties.$inferSelect) {
  const c = b.chain as any;
  return {
    id: b.id, title: b.title, description: b.description, spec: b.spec, specHash: b.specHash, modelCommitment: b.modelCommitment, rewardMicro: b.rewardMicro.toString(),
    verifierFeeMicro: b.verifierFeeMicro.toString(), maxExamples: b.maxExamples, accepted: c?.accepted ?? 0, pending: c?.pending ?? 0, verifierWallet: b.verifierWallet,
    creatorWallet: b.creatorWallet, expiresAt: b.expiresAt, chainState: b.chainState, onchainAddress: b.onchainAddress, bountyIdOnchain: b.bountyIdOnchain.toString(),
  };
}
