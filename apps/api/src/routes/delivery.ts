import { Transform } from 'node:stream';
import { timingSafeEqual } from 'node:crypto';
import { deliveryAccess, refundDownloadBytes, reserveDownloadBytes } from '../lib/billing.js';
import { HttpError } from '../lib/http.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { PublicKey } from '@solana/web3.js';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { conflict, forbidden, isAdmin, notFound, parse, requireSession, unauthorized, zUuid } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { DOWNLOAD_TTL_SECS, signDownloadToken, verifyDownloadToken } from '../lib/tokens.js';
import { orderAccess } from './marketplace.js';

/**
 * Delivery service. The full asset is released only after a fresh on-chain read shows the
 * order SETTLED with a granted LicenseReceipt for the requesting wallet. Tokens are short-lived,
 * HMAC-signed, bound to (grant, file, wallet), and every issue/download is logged.
 */
export function deliveryRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, cfg } = ctx;
  const exp = () => Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECS;
  const gatewayAuthenticated = (header: unknown) => {
    if (!cfg.GATEWAY_SHARED_SECRET || typeof header !== 'string') return false;
    const a = Buffer.from(header), b = Buffer.from(cfg.GATEWAY_SHARED_SECRET);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  app.post('/gateway/transfers/:id/failed', async (req) => {
    if (!gatewayAuthenticated(req.headers['x-gateway-auth'])) throw unauthorized();
    const { id } = parse(z.object({ id: zUuid }), req.params);
    await db.transaction(async (tx) => {
      const [r] = await tx.update(schema.gatewayTransfers).set({ status: 'failed' }).where(and(eq(schema.gatewayTransfers.id, id), eq(schema.gatewayTransfers.status, 'reserved'))).returning();
      if (r?.entitlementId) await tx.execute(sql`update delivery_entitlements set bytes_served = greatest(0, bytes_served - ${r.bytes}) where id = ${r.entitlementId}`);
    });
    return { ok: true };
  });

  app.get('/orders/:id/delivery', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { order } = await orderAccess(ctx, id, s);
    if (order.buyerWallet !== s.wallet) throw forbidden('only the buyer can download');
    // re-check entitlement against the chain (not the browser, not just our DB)
    const onchain = await ctx.chain.client.order(new PublicKey(order.onchainAddress));
    const receipt = await ctx.chain.client.licenseReceipt(new PublicKey(order.onchainAddress));
    if (!onchain || onchain.state !== 'settled' || !receipt?.granted || receipt.buyer !== s.wallet) throw conflict('order is not settled with a granted license');
    let [ent] = await db.select().from(schema.deliveryEntitlements).where(eq(schema.deliveryEntitlements.orderId, id));
    if (!ent) {
      // recovery path: settlement happened but the indexer has not created the entitlement yet
      const { syncOrder } = await import('../services/indexer.js');
      await syncOrder(ctx, order);
      [ent] = await db.select().from(schema.deliveryEntitlements).where(eq(schema.deliveryEntitlements.orderId, id));
    }
    if (!ent || ent.revokedAt) throw conflict('delivery entitlement unavailable; contact support (settlement is recorded on-chain)');
    const [v] = await db.select().from(schema.assetVersions).where(eq(schema.assetVersions.id, ent.assetVersionId));
    if (v.commitment !== receipt.assetCommitment) throw conflict('entitled version does not match the licensed commitment');
    const access = await deliveryAccess(ctx, ent);
    const files = await db.select().from(schema.assetFiles).where(eq(schema.assetFiles.versionId, ent.assetVersionId));
    for (const f of files) await db.insert(schema.deliveryEvents).values({ entitlementId: ent.id, fileId: f.id, accountId: s.accountId, kind: 'token_issued' });
    return {
      commitment: v.commitment,
      licenseReceipt: ent.licenseReceipt,
      expiresInSecs: DOWNLOAD_TTL_SECS,
      access: { endsAt: ent.accessEndsAt, metered: access.metered, remainingBytes: access.remaining?.toString() ?? null, rangeRequests: true },
      proof: { salt: v.salt, manifest: v.manifest },
      files: files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256, url: `/download/${signDownloadToken(cfg.DOWNLOAD_TOKEN_SECRET, { s: 'delivery', g: ent.id, f: f.id, w: s.wallet, x: exp() })}` })),
    };
  });

  /** Token-authenticated streaming download (works with plain links; wallet binding checked when a session is present). */
  app.get('/download/:token', async (req, reply) => {
    const c = verifyDownloadToken(cfg.DOWNLOAD_TOKEN_SECRET, (req.params as any).token);
    if (!c) throw unauthorized('invalid or expired download token');
    if (req.session && req.session.wallet !== c.w) throw forbidden('token issued to another wallet');
    const [f] = await db.select().from(schema.assetFiles).where(eq(schema.assetFiles.id, c.f));
    if (!f) throw notFound('file');
    let entitlementId = c.g;
    let metered: { entitlementId: string; accountId: string } | null = null;
    let deliveryEnt: typeof schema.deliveryEntitlements.$inferSelect | null = null;
    if (c.s === 'delivery') {
      const [ent] = await db.select().from(schema.deliveryEntitlements).where(eq(schema.deliveryEntitlements.id, c.g));
      if (!ent || ent.revokedAt || ent.assetVersionId !== f.versionId || ent.buyerWallet !== c.w) throw forbidden();
      const access = await deliveryAccess(ctx, ent);
      if (access.metered) metered = { entitlementId: ent.id, accountId: ent.buyerId };
      deliveryEnt = ent;
    } else if (c.s === 'eval') {
      const [job] = await db.select().from(schema.verificationJobs).where(eq(schema.verificationJobs.id, c.g));
      const [pj] = job ? [] : await db.select().from(schema.providerJobs).where(eq(schema.providerJobs.id, c.g));
      const versionId = job?.assetVersionId ?? pj?.assetVersionId;
      const wallet = job?.providerWallet ?? pj?.providerWallet;
      if (versionId !== f.versionId || wallet !== c.w) throw forbidden();
      entitlementId = c.g;
    } else if (c.s === 'collaboration_review') {
      // Explicit contributor-granted, revocable inspection permission. This is not a purchase/license receipt.
      const result=await db.execute(sql`select s.*,o.buyer_wallet,a.wallet as owner_wallet from collaboration_submissions s join orders o on o.id=s.bounty_id join accounts a on a.id=s.contributor_id join asset_versions v on v.id=s.asset_version_id join assets asset on asset.id=v.asset_id where s.id=${c.g} and s.asset_version_id=${f.versionId} and s.status='verified' and asset.deleted_at is null and a.deleted_at is null and exists(select 1 from accounts recipient where recipient.wallet=${c.w} and recipient.deleted_at is null) and (a.wallet=${c.w} or (s.review_access_granted and o.buyer_wallet=${c.w})) and exists(select 1 from submission_items i where i.submission_id=s.id and i.file_path=${f.path} and i.exact_hash=${f.sha256} and i.verification_status in ('review','accepted'))`);
      if(!((result as any).rows??result).length)throw forbidden('Image review permission is unavailable or revoked');
      if(cfg.COLLABORATIVE_BOUNTIES_ENABLED!=='1')throw forbidden('Collaboration is disabled');
    } else if (c.s === 'review') {
      // dispute reviewer access (admin-issued) or a failure-bounty verifier reading a pending example
      const [d] = await db.select().from(schema.disputes).where(eq(schema.disputes.id, c.g));
      if (!d) {
        const [e] = await db.select().from(schema.failureExamples).where(eq(schema.failureExamples.id, c.g));
        const [b] = e ? await db.select().from(schema.failureBounties).where(eq(schema.failureBounties.id, e.bountyId)) : [];
        if (!e || !b || b.verifierWallet !== c.w || e.assetVersionId !== f.versionId) throw forbidden();
      } else {
        const order = (await db.select().from(schema.orders).where(eq(schema.orders.id, d.orderId)))[0];
        const { orderVersionId } = await import('./marketplace.js');
        const versionId = order ? await orderVersionId(ctx, order) : null;
        const versions = [versionId, ...d.evidence.map((e) => e.assetVersionId)];
        if (!versions.includes(f.versionId)) throw forbidden('file outside dispute scope');
      }
    }
    await audit(db, null, `download.${c.s}`, f.id, { grant: entitlementId, wallet: c.w });

    // HTTP Range (resume after interruption): only the requested bytes are sent and metered
    const range = parseRange(req.headers.range, f.size);
    if (range === 'unsatisfiable') return reply.code(416).header('content-range', `bytes */${f.size}`).send();
    const start = range?.start ?? 0;
    const end = range?.end ?? f.size - 1;
    const length = BigInt(end - start + 1);

    if (f.objectKey.startsWith('r2/')) {
      if (req.headers['x-gateway-auth'] !== undefined) {
        if (!gatewayAuthenticated(req.headers['x-gateway-auth'])) throw unauthorized();
        const id = parse(zUuid, req.headers['x-transfer-id']);
        await db.transaction(async (tx) => {
          const [created] = await tx.insert(schema.gatewayTransfers).values({ id, entitlementId: metered?.entitlementId ?? null, bytes: length }).onConflictDoNothing().returning();
          if (!created) throw conflict('transfer already authorized');
          if (metered) {
            const rows = await tx.execute(sql`update delivery_entitlements set bytes_served = bytes_served + ${length} where id = ${metered.entitlementId} and revoked_at is null and (access_ends_at is null or access_ends_at > now()) and bytes_served + ${length} <= allowance_bytes + extra_bytes returning id`);
            if (!((rows as any).rows ?? rows).length) throw downloadQuotaExhausted();
          }
          if (deliveryEnt) await tx.insert(schema.deliveryEvents).values({ entitlementId: deliveryEnt.id, fileId: f.id, accountId: deliveryEnt.buyerId, kind: 'token_issued', bytes: length });
        });
        return reply.header('cache-control', 'no-store').send({ key: f.objectKey.slice(3), start, end, size: f.size, length: length.toString(), partial: !!range, name: f.path.split('/').pop(), sha256: f.sha256, accounting: 'authorized_bytes' });
      }
      if (cfg.DOWNLOAD_GATEWAY_URL) return reply.header('cache-control', 'private, no-store').redirect(`${cfg.DOWNLOAD_GATEWAY_URL.replace(/\/$/, '')}/download/${encodeURIComponent((req.params as any).token)}`, 307);
      if (metered) throw new HttpError(503, 'gateway_unavailable', 'Metered R2 downloads require the download gateway.');
      const url = await ctx.storage.presignGet(f.objectKey, Math.min(cfg.PRESIGN_TTL_SECS, 300), f.path.split('/').pop());
      if (!url) throw new HttpError(503, 'download_unavailable', 'Direct download is unavailable.');
      return reply.header('cache-control', 'private, no-store').redirect(url, 307);
    }

    // ?direct=1 hands off to a presigned S3 URL. S3 cannot cap bytes on a presigned URL: it can be replayed
    // until it expires. So for metered access the FULL object size is charged up front with no refund, and
    // the URL lives at most 300 s; byte-exact metering (and resume refunds) needs the proxied path.
    if ((req.query as any)?.direct === '1' && !range) {
      if (metered && !(await reserveDownloadBytes(ctx, metered.entitlementId, BigInt(f.size)))) throw downloadQuotaExhausted();
      const url = await ctx.storage.presignGet(f.objectKey, Math.min(cfg.PRESIGN_TTL_SECS, 300), f.path.split('/').pop());
      if (url) {
        if (deliveryEnt) await db.insert(schema.deliveryEvents).values({ entitlementId: deliveryEnt.id, fileId: f.id, accountId: deliveryEnt.buyerId, kind: 'token_issued', bytes: BigInt(f.size) });
        return reply.header('cache-control', 'private, no-store').redirect(url, 302);
      }
      if (metered) await refundDownloadBytes(ctx, metered.entitlementId, BigInt(f.size)); // no presign support: fall through to proxy
    }

    // reserve before sending (atomic: parallel range requests cannot jointly exceed the allowance)
    if (metered && !(await reserveDownloadBytes(ctx, metered.entitlementId, length))) throw downloadQuotaExhausted();
    if (deliveryEnt) await db.insert(schema.deliveryEvents).values({ entitlementId: deliveryEnt.id, fileId: f.id, accountId: deliveryEnt.buyerId, kind: 'download_started' });
    let sent = 0n;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        sent += BigInt(chunk.length);
        cb(null, chunk);
      },
    });
    reply.raw.once('close', () => {
      const complete = sent === length;
      // interrupted transfers are charged only for bytes actually sent; the client resumes with Range
      if (metered && !complete) refundDownloadBytes(ctx, metered.entitlementId, length - sent).catch(() => {});
      if (deliveryEnt) db.insert(schema.deliveryEvents).values({ entitlementId: deliveryEnt.id, fileId: f.id, accountId: deliveryEnt.buyerId, kind: complete ? 'download_completed' : 'download_failed', bytes: sent }).catch(() => {});
    });
    const body = range ? await ctx.storage.getRange(f.objectKey, start, end) : await ctx.storage.get(f.objectKey);
    reply.header('content-type', 'application/octet-stream');
    reply.header('accept-ranges', 'bytes');
    reply.header('content-length', String(length));
    if (range) reply.code(206).header('content-range', `bytes ${start}-${end}/${f.size}`);
    reply.header('content-disposition', `attachment; filename="${f.path.split('/').pop()!.replace(/"/g, '')}"`);
    reply.header('x-content-sha256', f.sha256);
    reply.header('cache-control', 'private, no-store');
    return reply.send(body.pipe(counter));
  });

  /**
   * Controlled previews. Visible publicly for published listings; otherwise only to the owner,
   * order parties (buyer reviewing a submission), the verifier and admins.
   */
  app.get('/previews/:versionId/:index', async (req, reply) => {
    const { versionId, index } = parse(z.object({ versionId: zUuid, index: z.coerce.number().int().min(0).max(100) }), req.params);
    const [v] = await db.select().from(schema.assetVersions).where(eq(schema.assetVersions.id, versionId));
    if (!v || v.previewStatus !== 'ready') throw notFound('preview');
    const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, v.assetId));
    let allowed = false;
    const [published] = await db.select().from(schema.listings).where(and(eq(schema.listings.assetVersionId, versionId), eq(schema.listings.status, 'published')));
    if (published) allowed = true;
    const s = req.session;
    if (!allowed && s) {
      if (asset.ownerId === s.accountId || isAdmin(ctx, s)) allowed = true;
      else {
        const subs = await db.select().from(schema.submissions).where(eq(schema.submissions.assetVersionId, versionId));
        if (subs.length) {
          const orders = await db.select().from(schema.orders).where(inArray(schema.orders.id, subs.map((x) => x.orderId)));
          allowed = orders.some((o) => o.buyerWallet === s.wallet || o.verifierWallet === s.wallet);
        }
      }
    }
    if (!allowed) throw notFound('preview');
    const items = (v.preview as { key: string; kind: string }[]) ?? [];
    const item = items[index];
    if (!item) throw notFound('preview');
    reply.header('content-type', item.kind === 'image' ? 'image/jpeg' : 'application/json');
    reply.header('cache-control', 'private, max-age=300');
    reply.header('x-robots-tag', 'noindex');
    return reply.send(await ctx.storage.get(item.key));
  });
}

const downloadQuotaExhausted = () => new HttpError(402, 'download_quota_exhausted', 'Included downloads are used up. Buy download credits: POST /entitlements/:id/download-credits');

/** Single byte range per RFC 9110 (`bytes=a-b`, `bytes=a-`, `bytes=-n`). Multi-range is not supported. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'unsatisfiable' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null; // malformed or multi-range: ignore, send the whole file
  let start: number;
  let end: number;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}
