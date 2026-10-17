import { paymentQuoteRate } from '../lib/payments.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { ACCESS_MONTHS, checkoutQuote, intervalSecs, type AccessMonths } from '@edgebounty/pricing-engine';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { forbidden, notFound, parse, requireAdmin, requireSession, zUuid } from '../lib/http.js';
import { getOwnedVersion } from '../lib/assets.js';
import { coveredUntil, createDownloadCreditInvoice, createSellerHostingInvoice, marketplacePricing, sellerHostingQuote, versionBytes, versionCoverage } from '../lib/billing.js';
import { costReport } from '../lib/costs.js';

const str = (o: Record<string, bigint>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.toString()]));
const nowSecs = () => BigInt(Math.floor(Date.now() / 1000));

export function billingRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  /** Non-binding preview of a buyer checkout (the binding quote is locked by POST /listings/:id/purchase). */
  app.get('/listings/:id/checkout-quote', async (req) => {
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { months } = parse(z.object({ months: z.coerce.number().int().refine((m) => ACCESS_MONTHS.includes(m as AccessMonths), 'months must be 1, 3 or 6').default(1) }), req.query);
    const [l] = await db.select().from(schema.listings).where(eq(schema.listings.id, id));
    if (!l || l.status !== 'published') throw notFound('listing');
    const q = checkoutQuote({ priceLamports: l.priceMicro, objectBytes: await versionBytes(ctx, l.assetVersionId), months: months as AccessMonths, now: nowSecs(), coverage: await versionCoverage(ctx, l.assetVersionId), solUsdMicro: paymentQuoteRate(ctx.cfg), pricing: marketplacePricing(ctx) });
    return { months, pricingVersion: q.pricingVersion, allowanceBytes: q.allowanceBytes.toString(), sellerFundedSecs: (BigInt(months) * 2_592_000n - intervalSecs(q.hostingGaps)).toString(), usdMicro: str(q.usd), lamports: str(q.lamports) };
  });

  /** Seller listing hosting: coverage, and prepaid extension quotes. */
  app.get('/versions/:id/hosting', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    await getOwnedVersion(ctx, id, s.accountId);
    const rows = await db.select().from(schema.hostingCoverage).where(eq(schema.hostingCoverage.assetVersionId, id));
    const bytes = await versionBytes(ctx, id);
    const until = coveredUntil(await versionCoverage(ctx, id), nowSecs());
    return {
      bytes: bytes.toString(),
      coveredUntil: new Date(Number(until) * 1000),
      coverage: rows.map((r) => ({ source: r.source, startsAt: r.startsAt, endsAt: r.endsAt, amountMicro: r.amountMicro.toString() })),
      quotes: [1, 3].map((m) => {
        const q = sellerHostingQuote(ctx, bytes, m);
        return { months: m, usdMicro: q.usdMicro.toString(), lamports: q.lamports.toString() };
      }),
    };
  });

  app.post('/versions/:id/hosting', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { months } = parse(z.object({ months: z.number().int() }), req.body);
    const { version } = await getOwnedVersion(ctx, id, s.accountId);
    if (version.status !== 'finalized') throw forbidden('finalize the version before buying hosting');
    const r = await createSellerHostingInvoice(ctx, s.accountId, id, months);
    return { quote: { ...r.quote, bytes: r.quote.bytes.toString(), usdMicro: r.quote.usdMicro.toString(), lamports: r.quote.lamports.toString(), solUsdMicro: r.quote.solUsdMicro.toString() }, invoice: r.invoice };
  });

  /** Extra downloads beyond the included ones are prepaid credits ($0.15 per GB). */
  app.post('/entitlements/:id/download-credits', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { gb } = parse(z.object({ gb: z.number().int() }), req.body);
    const [ent] = await db.select().from(schema.deliveryEntitlements).where(eq(schema.deliveryEntitlements.id, id));
    if (!ent) throw notFound('entitlement');
    if (ent.buyerId !== s.accountId) throw forbidden();
    const r = await createDownloadCreditInvoice(ctx, s.accountId, id, gb);
    return { bytes: r.bytes.toString(), usdMicro: r.usdMicro.toString(), lamports: r.lamports.toString(), invoice: r.invoice };
  });

  app.get('/me/entitlements', async (req) => {
    const s = requireSession(req);
    const rows = await db.select().from(schema.deliveryEntitlements).where(eq(schema.deliveryEntitlements.buyerId, s.accountId));
    return rows.map((e) => ({
      id: e.id, orderId: e.orderId, assetVersionId: e.assetVersionId, accessStartsAt: e.accessStartsAt, accessEndsAt: e.accessEndsAt,
      metered: e.allowanceBytes !== null, allowanceBytes: e.allowanceBytes?.toString() ?? null, extraBytes: e.extraBytes.toString(), bytesServed: e.bytesServed.toString(),
    }));
  });

  /** Cost, revenue, break-even and budget report (estimates unless stated otherwise). */
  app.get('/admin/costs', async (req) => {
    requireAdmin(ctx, req);
    return costReport(ctx);
  });
}
