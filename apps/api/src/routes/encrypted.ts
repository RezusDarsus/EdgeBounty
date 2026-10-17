import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { PublicKey } from '@solana/web3.js';
import { ENC_SCHEME } from '@edgebounty/verification-schemas';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { getOwnedVersion } from '../lib/assets.js';
import { badRequest, conflict, forbidden, parse, requireSession, zUuid } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { orderAccess, orderVersionId } from './marketplace.js';

const b64 = z.string().regex(/^[A-Za-z0-9+/=]+$/).max(200);

/**
 * Advanced private mode (Phase 5). The seller encrypts files client-side; the platform stores
 * ciphertext plus non-secret parameters. After settlement the seller seals the content key to
 * a box key the buyer generated in their browser. The platform never sees the content key.
 * Trade-off (disclosed): automatic analysis of encrypted assets is unavailable.
 */
export function encryptedDeliveryRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.post('/versions/:id/encryption', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const b = parse(z.object({ scheme: z.literal(ENC_SCHEME), chunkSize: z.number().int().min(4096).max(64 * 1024 * 1024), files: z.record(z.string(), z.string().regex(/^[0-9a-f]{8}$/)), keyFingerprint: z.string().regex(/^[0-9a-f]{64}$/) }), req.body);
    const { version } = await getOwnedVersion(ctx, id, s.accountId);
    if (version.status !== 'draft') throw conflict('declare encryption before finalizing the version');
    await db
      .insert(schema.deliveryKeys)
      .values({ assetVersionId: id, sellerId: s.accountId, scheme: b.scheme, params: { chunkSize: b.chunkSize, files: b.files, keyFingerprint: b.keyFingerprint } })
      .onConflictDoUpdate({ target: schema.deliveryKeys.assetVersionId, set: { params: { chunkSize: b.chunkSize, files: b.files, keyFingerprint: b.keyFingerprint } } });
    await db.update(schema.assetVersions).set({ metadata: { ...(version.metadata ?? {}), encrypted: true, scheme: b.scheme } }).where(eq(schema.assetVersions.id, id));
    return { ok: true, note: 'Encrypted assets cannot be analysed automatically; previews and verification are unavailable unless you disclose a sample separately.' };
  });

  /** Buyer registers a one-time X25519 box key generated in their browser. */
  app.post('/orders/:id/delivery-key', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { boxPublicKey } = parse(z.object({ boxPublicKey: b64 }), req.body);
    if (Buffer.from(boxPublicKey, 'base64').length !== 32) throw badRequest('box public key must be 32 bytes');
    const { order, role } = await orderAccess(ctx, id, s);
    if (role !== 'buyer') throw forbidden('buyer only');
    const [existing] = await db.select().from(schema.deliveryEnvelopes).where(eq(schema.deliveryEnvelopes.orderId, order.id));
    if (existing?.envelope) throw conflict('key already delivered to the registered box key');
    await db
      .insert(schema.deliveryEnvelopes)
      .values({ orderId: order.id, buyerBoxPublicKey: boxPublicKey })
      .onConflictDoUpdate({ target: schema.deliveryEnvelopes.orderId, set: { buyerBoxPublicKey: boxPublicKey } });
    return { ok: true };
  });

  app.get('/orders/:id/delivery-key', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { order, role } = await orderAccess(ctx, id, s);
    if (role !== 'buyer' && role !== 'seller') throw forbidden();
    const [env] = await db.select().from(schema.deliveryEnvelopes).where(eq(schema.deliveryEnvelopes.orderId, order.id));
    const versionId = await deliveredVersion(ctx, order);
    const [k] = versionId ? await db.select().from(schema.deliveryKeys).where(eq(schema.deliveryKeys.assetVersionId, versionId)) : [];
    return { encrypted: !!k, scheme: k?.scheme ?? null, params: k?.params ?? null, buyerBoxPublicKey: env?.buyerBoxPublicKey ?? null, envelope: role === 'buyer' || env?.envelope ? env?.envelope ?? null : null, nonce: env?.nonce ?? null, sellerBoxPublicKey: env?.sellerBoxPublicKey ?? null };
  });

  /** Seller seals the content key to the buyer's box key — only after on-chain settlement. */
  app.post('/orders/:id/delivery-key/envelope', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const b = parse(z.object({ envelope: z.string().regex(/^[A-Za-z0-9+/=]+$/).max(400), nonce: b64, sellerBoxPublicKey: b64 }), req.body);
    const { order, role } = await orderAccess(ctx, id, s);
    if (role !== 'seller') throw forbidden('seller only');
    const onchain = await ctx.chain.client.order(new PublicKey(order.onchainAddress));
    const receipt = await ctx.chain.client.licenseReceipt(new PublicKey(order.onchainAddress));
    if (onchain?.state !== 'settled' || !receipt?.granted) throw conflict('the key may only be released after settlement with a granted license');
    const [env] = await db.select().from(schema.deliveryEnvelopes).where(eq(schema.deliveryEnvelopes.orderId, order.id));
    if (!env) throw conflict('the buyer has not registered a delivery key yet');
    await db.update(schema.deliveryEnvelopes).set({ envelope: b.envelope, nonce: b.nonce, sellerBoxPublicKey: b.sellerBoxPublicKey, deliveredAt: new Date() }).where(eq(schema.deliveryEnvelopes.id, env.id));
    await audit(db, s, 'delivery.key_envelope', order.id);
    return { ok: true };
  });
}

async function deliveredVersion(ctx: AppContext, order: typeof schema.orders.$inferSelect): Promise<string | null> {
  return orderVersionId(ctx, order);
}
