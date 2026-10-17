import type { FastifyInstance } from 'fastify';
import { and, gte, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { notFound, parse, requireSession, requireAdmin, zUuid } from '../lib/http.js';
import { compareWithObserved, fetchCloudflareUsage } from '../services/cloudflare-usage.js';

export function notificationRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/me/notifications', async req => {
    const s = requireSession(req);
    return ctx.db.select().from(schema.notifications).where(eq(schema.notifications.accountId, s.accountId)).orderBy(desc(schema.notifications.createdAt)).limit(100);
  });
  app.post('/me/notifications/:id/read', async req => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const rows = await ctx.db.update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.id, id), eq(schema.notifications.accountId, s.accountId))).returning({ id: schema.notifications.id });
    if (!rows.length) throw notFound('notification');
    return { ok: true };
  });
  app.get('/admin/operations', async req => {
    requireAdmin(ctx, req);
    const counters = await ctx.db.select().from(schema.operationCounters);
    const [transfers] = await ctx.db.select({ requests: sql<string>`count(*)`, requestedBytes: sql<string>`coalesce(sum(${schema.gatewayTransfers.bytes}),0)` }).from(schema.gatewayTransfers).where(eq(schema.gatewayTransfers.status, 'reserved'));
    return { counters, gateway: transfers, measurement: 'Observed SDK calls and authorized Worker transfers; direct browser multipart attempts and aborted Worker requests require provider billing reconciliation. Prices remain unknown until configured.' };
  });
  /** Provider-measured usage vs our own counters. Cached briefly: the analytics API is rate limited. */
  let cached: { at: number; body: unknown } | null = null;
  app.get('/admin/reconciliation/cloudflare', async req => {
    requireAdmin(ctx, req);
    if (cached && Date.now() - cached.at < 10 * 60_000) return cached.body;
    if (ctx.cfg.STORAGE_DRIVER !== 'r2') return { configured: false, reason: 'Storage is not on Cloudflare R2.' };
    if (!ctx.cfg.CLOUDFLARE_ANALYTICS_TOKEN) return { configured: false, reason: 'Set CLOUDFLARE_ANALYTICS_TOKEN to a read-only token with Account Analytics: Read.' };
    const usage = await fetchCloudflareUsage(ctx.cfg);
    const counters = await ctx.db.select().from(schema.operationCounters);
    const [transfers] = await ctx.db.select({ n: sql<string>`count(*)` }).from(schema.gatewayTransfers).where(and(eq(schema.gatewayTransfers.status, 'reserved'), gte(schema.gatewayTransfers.createdAt, new Date(usage.period.from))));
    const body = {
      configured: true, usage,
      comparison: compareWithObserved(usage, counters, 'r2'),
      worker: { cloudflareRequests: usage.worker.requests, authorizedTransfersMonthToDate: Number(transfers.n), note: 'Worker requests include rejected and retried downloads; authorized transfers count only granted byte ranges.' },
    };
    cached = { at: Date.now(), body };
    return body;
  });
}
