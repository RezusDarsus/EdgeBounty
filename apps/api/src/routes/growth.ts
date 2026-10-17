import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { commission } from '@edgebounty/pricing-engine';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { badRequest, conflict, forbidden, isAdmin, notFound, parse, requireAdmin, requireSession, zUuid } from '../lib/http.js';
import { marketplacePricing } from '../lib/billing.js';
import { publicListing } from './marketplace.js';

const MAX_COLLECTIONS = 50;
const MAX_ITEMS = 500;
type Order = typeof schema.orders.$inferSelect;

/** Platform fee and seller share of a settled order, from the fee and split locked on-chain. */
export function orderSplit(ctx: AppContext, o: Pick<Order, 'amountMicro' | 'chain'>) {
  const chain = (o.chain ?? {}) as { feeBps?: number; sellerBps?: number };
  const gross = (o.amountMicro * BigInt(chain.sellerBps ?? 10_000)) / 10_000n;
  const fee = commission(gross, { ...marketplacePricing(ctx), commissionBps: BigInt(chain.feeBps ?? 600) });
  return { gross, fee, net: gross - fee, refunded: o.amountMicro - gross, feeBps: chain.feeBps ?? 600 };
}

const closedAt = (o: Order) => {
  const t = Number((o.chain as { closedAt?: number | string } | null)?.closedAt ?? 0);
  return t ? new Date(t * 1000) : (o.syncedAt ?? o.createdAt);
};

export const receiptNumber = (o: Pick<Order, 'id' | 'createdAt'>) => `EB-${o.createdAt.toISOString().slice(0, 10).replace(/-/g, '')}-${o.id.slice(0, 8).toUpperCase()}`;

export function growthRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  // ---------------------------------------------------------------- collections

  const ownCollection = async (id: string, accountId: string) => {
    const [c] = await db.select().from(schema.collections).where(eq(schema.collections.id, id));
    if (!c) throw notFound('collection');
    if (c.ownerId !== accountId) throw forbidden();
    return c;
  };
  const CollectionBody = z.object({ title: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).default(''), public: z.boolean().default(false) });

  app.get('/me/collections', async (req) => {
    const s = requireSession(req);
    const rows = await db.select().from(schema.collections).where(eq(schema.collections.ownerId, s.accountId)).orderBy(desc(schema.collections.updatedAt));
    const counts = rows.length ? await db.select({ id: schema.collectionItems.collectionId, n: sql<string>`count(*)` }).from(schema.collectionItems).where(inArray(schema.collectionItems.collectionId, rows.map((r) => r.id))).groupBy(schema.collectionItems.collectionId) : [];
    const { listing } = parse(z.object({ listing: zUuid.optional() }), req.query);
    const containing = listing && rows.length ? (await db.select({ id: schema.collectionItems.collectionId }).from(schema.collectionItems).where(and(eq(schema.collectionItems.listingId, listing), inArray(schema.collectionItems.collectionId, rows.map((r) => r.id))))).map((r) => r.id) : [];
    return rows.map((c) => ({ ...c, items: Number(counts.find((x) => x.id === c.id)?.n ?? 0), containsListing: containing.includes(c.id) }));
  });

  app.post('/collections', async (req) => {
    const s = requireSession(req);
    const b = parse(CollectionBody, req.body);
    const [{ n }] = await db.select({ n: sql<string>`count(*)` }).from(schema.collections).where(eq(schema.collections.ownerId, s.accountId));
    if (Number(n) >= MAX_COLLECTIONS) throw conflict(`At most ${MAX_COLLECTIONS} collections per account`);
    const [c] = await db.insert(schema.collections).values({ ownerId: s.accountId, ...b }).returning();
    return c;
  });

  app.patch('/collections/:id', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    await ownCollection(id, s.accountId);
    const b = parse(CollectionBody.partial(), req.body);
    const [c] = await db.update(schema.collections).set({ ...b, updatedAt: new Date() }).where(eq(schema.collections.id, id)).returning();
    return c;
  });

  app.delete('/collections/:id', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    await ownCollection(id, s.accountId);
    await db.transaction(async (tx) => {
      await tx.delete(schema.collectionItems).where(eq(schema.collectionItems.collectionId, id));
      await tx.delete(schema.collections).where(eq(schema.collections.id, id));
    });
    return { ok: true };
  });

  app.post('/collections/:id/items', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const b = parse(z.object({ listingId: zUuid, note: z.string().trim().max(500).default('') }), req.body);
    await ownCollection(id, s.accountId);
    const [l] = await db.select({ status: schema.listings.status }).from(schema.listings).where(eq(schema.listings.id, b.listingId));
    if (l?.status !== 'published') throw badRequest('Only published listings can be saved');
    const [{ n }] = await db.select({ n: sql<string>`count(*)` }).from(schema.collectionItems).where(eq(schema.collectionItems.collectionId, id));
    if (Number(n) >= MAX_ITEMS) throw conflict(`At most ${MAX_ITEMS} listings per collection`);
    await db.insert(schema.collectionItems).values({ collectionId: id, listingId: b.listingId, note: b.note }).onConflictDoUpdate({ target: [schema.collectionItems.collectionId, schema.collectionItems.listingId], set: { note: b.note } });
    await db.update(schema.collections).set({ updatedAt: new Date() }).where(eq(schema.collections.id, id));
    return { ok: true };
  });

  app.delete('/collections/:id/items/:listingId', async (req) => {
    const s = requireSession(req);
    const { id, listingId } = parse(z.object({ id: zUuid, listingId: zUuid }), req.params);
    await ownCollection(id, s.accountId);
    await db.delete(schema.collectionItems).where(and(eq(schema.collectionItems.collectionId, id), eq(schema.collectionItems.listingId, listingId)));
    return { ok: true };
  });

  /** Public collections are visible to anyone; private ones only to their owner. Unpublished listings are hidden. */
  app.get('/collections/:id', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [c] = await db.select().from(schema.collections).where(eq(schema.collections.id, id));
    if (!c || (!c.public && c.ownerId !== req.session?.accountId)) throw notFound('collection');
    const items = await db.select().from(schema.collectionItems).where(eq(schema.collectionItems.collectionId, id)).orderBy(desc(schema.collectionItems.addedAt));
    const listings = items.length ? await db.select().from(schema.listings).where(and(inArray(schema.listings.id, items.map((i) => i.listingId)), eq(schema.listings.status, 'published'))) : [];
    const [owner] = await db.select({ alias: schema.accounts.alias }).from(schema.accounts).where(eq(schema.accounts.id, c.ownerId));
    return {
      id: c.id, title: c.title, description: c.description, public: c.public, owner: { alias: owner?.alias ?? null }, mine: c.ownerId === req.session?.accountId, updatedAt: c.updatedAt,
      items: await Promise.all(items.filter((i) => listings.some((l) => l.id === i.listingId)).map(async (i) => ({ note: i.note, addedAt: i.addedAt, listing: await publicListing(ctx, listings.find((l) => l.id === i.listingId)!) }))),
    };
  });

  // ---------------------------------------------------------------- seller analytics

  app.get('/me/analytics', async (req) => {
    const s = requireSession(req);
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
    const since = new Date(Date.now() - days * 86_400_000);
    const listings = await db.select().from(schema.listings).where(eq(schema.listings.sellerId, s.accountId)).orderBy(desc(schema.listings.createdAt));
    const ids = listings.map((l) => l.id);
    const views = ids.length ? await db.select({ id: schema.listingViews.listingId, n: sql<string>`sum(${schema.listingViews.views})` }).from(schema.listingViews).where(and(inArray(schema.listingViews.listingId, ids), gte(schema.listingViews.day, since.toISOString().slice(0, 10)))).groupBy(schema.listingViews.listingId) : [];
    const daily = ids.length ? await db.select({ day: schema.listingViews.day, n: sql<string>`sum(${schema.listingViews.views})` }).from(schema.listingViews).where(and(inArray(schema.listingViews.listingId, ids), gte(schema.listingViews.day, since.toISOString().slice(0, 10)))).groupBy(schema.listingViews.day).orderBy(schema.listingViews.day) : [];
    const orders = (await db.select().from(schema.orders).where(and(eq(schema.orders.sellerId, s.accountId), eq(schema.orders.kind, 'purchase'), inArray(schema.orders.chainState, ['settled', 'refunded'])))).filter((o) => closedAt(o) >= since);
    const per = listings.map((l) => {
      const mine = orders.filter((o) => o.listingId === l.id && o.chainState === 'settled');
      const sums = mine.reduce((a, o) => { const x = orderSplit(ctx, o); return { gross: a.gross + x.gross, fee: a.fee + x.fee, net: a.net + x.net }; }, { gross: 0n, fee: 0n, net: 0n });
      const v = Number(views.find((x) => x.id === l.id)?.n ?? 0);
      return { listingId: l.id, title: l.title, status: l.status, views: v, sales: mine.length, refunds: orders.filter((o) => o.listingId === l.id && o.chainState === 'refunded').length, conversionBps: v ? Math.round((mine.length / v) * 10_000) : null, grossMicro: sums.gross.toString(), feeMicro: sums.fee.toString(), netMicro: sums.net.toString() };
    });
    const total = (k: 'grossMicro' | 'feeMicro' | 'netMicro') => per.reduce((n, r) => n + BigInt(r[k]), 0n).toString();
    return {
      days, currency: ctx.cfg.PAYMENT_CURRENCY,
      totals: { views: per.reduce((n, r) => n + r.views, 0), sales: per.reduce((n, r) => n + r.sales, 0), refunds: per.reduce((n, r) => n + r.refunds, 0), grossMicro: total('grossMicro'), feeMicro: total('feeMicro'), netMicro: total('netMicro') },
      daily: daily.map((d) => ({ day: d.day, views: Number(d.n) })),
      listings: per,
      notes: ['Views are approximate page views of published listings (your own visits are excluded). Sales and revenue use the fee and split locked on each settled order.'],
    };
  });

  // ---------------------------------------------------------------- marketplace metrics (master plan section 17)

  app.get('/admin/metrics', async (req) => {
    requireAdmin(ctx, req);
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
    const since = new Date(Date.now() - days * 86_400_000);
    const all = await db.select().from(schema.orders);
    const closed = all.filter((o) => ['settled', 'refunded'].includes(o.chainState) && closedAt(o) >= since);
    const sales = closed.filter((o) => o.kind === 'purchase' && o.chainState === 'settled');
    const gmv = sales.reduce((n, o) => n + orderSplit(ctx, o).gross, 0n);
    const commissionMicro = closed.filter((o) => o.chainState === 'settled').reduce((n, o) => n + orderSplit(ctx, o).fee, 0n);
    const buyers = new Map<string, number>();
    for (const o of sales) buyers.set(o.buyerId, (buyers.get(o.buyerId) ?? 0) + 1);
    const bounties = all.filter((o) => o.kind === 'bounty' && o.createdAt >= since);
    const byState = (rows: Order[]) => rows.reduce<Record<string, number>>((m, o) => ({ ...m, [o.chainState]: (m[o.chainState] ?? 0) + 1 }), {});
    const [results] = await db.select({ total: sql<string>`count(*)`, reused: sql<string>`count(${schema.verificationResults.reusedFromJobId})` }).from(schema.verificationResults).where(gte(schema.verificationResults.createdAt, since));
    const [views] = await db.select({ n: sql<string>`coalesce(sum(${schema.listingViews.views}), 0)` }).from(schema.listingViews).where(gte(schema.listingViews.day, since.toISOString().slice(0, 10)));
    const [delivered] = await db.select({ n: sql<string>`count(*)`, bytes: sql<string>`coalesce(sum(${schema.gatewayTransfers.bytes}), 0)` }).from(schema.gatewayTransfers).where(and(gte(schema.gatewayTransfers.createdAt, since), eq(schema.gatewayTransfers.status, 'reserved')));
    return {
      days,
      marketplace: { gmvMicro: gmv.toString(), completedSales: sales.length, averageSaleMicro: sales.length ? (gmv / BigInt(sales.length)).toString() : null, commissionMicro: commissionMicro.toString(), refundedOrders: closed.filter((o) => o.chainState === 'refunded').length, listingViews: Number(views.n), viewToSaleBps: Number(views.n) ? Math.round((sales.length / Number(views.n)) * 10_000) : null },
      customers: { activeBuyers: buyers.size, repeatBuyers: [...buyers.values()].filter((n) => n > 1).length, activeSellers: new Set(sales.map((o) => o.sellerId)).size },
      bounties: { created: bounties.length, byState: byState(bounties) },
      verification: { results: Number(results.total), reused: Number(results.reused), cacheHitBps: Number(results.total) ? Math.round((Number(results.reused) / Number(results.total)) * 10_000) : null },
      downloads: { authorizedTransfers: Number(delivered.n), authorizedBytes: delivered.bytes },
      notes: ['Revenue, costs and break-even live in /admin/economics. Download bytes are authorized ranges, not confirmed completions.'],
    };
  });

  // ---------------------------------------------------------------- receipts

  const receiptFor = async (o: Order) => {
    const [cq] = await db.select().from(schema.checkoutQuotes).where(eq(schema.checkoutQuotes.orderId, o.id));
    const [buyer] = await db.select({ alias: schema.accounts.alias }).from(schema.accounts).where(eq(schema.accounts.id, o.buyerId));
    const [seller] = o.sellerId ? await db.select({ alias: schema.accounts.alias }).from(schema.accounts).where(eq(schema.accounts.id, o.sellerId)) : [];
    const txs = await db.select({ signature: schema.onchainTransactions.signature, kind: schema.onchainTransactions.kind, createdAt: schema.onchainTransactions.createdAt }).from(schema.onchainTransactions).where(and(eq(schema.onchainTransactions.subject, o.onchainAddress), eq(schema.onchainTransactions.status, 'confirmed'))).orderBy(schema.onchainTransactions.createdAt);
    const split = orderSplit(ctx, o);
    const extras = cq ? { hostingMicro: cq.hostingMicro.toString(), includedDownloadsMicro: cq.downloadsMicro.toString(), minimumFeeMicro: cq.minimumFeeMicro.toString(), accessStartsAt: cq.accessStartsAt, accessEndsAt: cq.accessEndsAt, pricingVersion: cq.pricingVersion } : null;
    const extrasTotal = cq ? cq.extrasMicro : 0n;
    return {
      receiptNumber: receiptNumber(o), status: o.chainState, kind: o.kind, issuedAt: closedAt(o),
      currency: ctx.cfg.PAYMENT_CURRENCY, testNetwork: ctx.cfg.NODE_ENV !== 'production',
      item: { title: o.title, listingId: o.listingId, licenseId: o.licenseId, orderAddress: o.onchainAddress },
      buyer: { wallet: o.buyerWallet, alias: buyer?.alias ?? null }, seller: { wallet: o.sellerWallet, alias: seller?.alias ?? null },
      amounts: { priceMicro: o.amountMicro.toString(), releasedToSellerSideMicro: split.gross.toString(), refundedToBuyerMicro: split.refunded.toString(), platformFeeBps: split.feeBps, platformFeeMicro: split.fee.toString(), sellerNetMicro: split.net.toString(), extras, buyerTotalMicro: (o.amountMicro + extrasTotal).toString() },
      transactions: txs,
      notice: 'Record of an on-chain escrow settlement generated from the order and its locked checkout quote. It is not a tax invoice.',
    };
  };

  app.get('/orders/:id/receipt', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    if (!o || (o.buyerId !== s.accountId && o.sellerId !== s.accountId && !isAdmin(ctx, s))) throw notFound('order');
    if (!['settled', 'refunded'].includes(o.chainState)) throw conflict('A receipt is issued once the order is settled or refunded');
    return receiptFor(o);
  });

  app.get('/me/receipts', async (req) => {
    const s = requireSession(req);
    const rows = await db.select().from(schema.orders).where(and(inArray(schema.orders.chainState, ['settled', 'refunded']), sql`(${schema.orders.buyerId} = ${s.accountId}::uuid or ${schema.orders.sellerId} = ${s.accountId}::uuid)`)).orderBy(desc(schema.orders.createdAt)).limit(200);
    return rows.map((o) => {
      const split = orderSplit(ctx, o);
      return { orderId: o.id, receiptNumber: receiptNumber(o), title: o.title, role: o.buyerId === s.accountId ? 'buyer' : 'seller', status: o.chainState, issuedAt: closedAt(o), priceMicro: o.amountMicro.toString(), sellerNetMicro: split.net.toString(), platformFeeMicro: split.fee.toString() };
    });
  });
}
