import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { AppContext } from '../context.js';

export async function notify(db: Db, accountId: string, dedupeKey: string, title: string, message: string, href = '/storage') {
  await db.insert(schema.notifications).values({ accountId, dedupeKey, title, message, href }).onConflictDoNothing();
}

export function operationRecorder(db: Db, provider: string) {
  return async (operation: string, ok: boolean) => {
    const key = `${provider}:${operation}:${ok ? 'ok' : 'error'}`;
    await db.insert(schema.operationCounters).values({ key, count: 1n }).onConflictDoUpdate({ target: schema.operationCounters.key, set: { count: sql`${schema.operationCounters.count} + 1`, updatedAt: new Date() } });
  };
}

export async function retentionNoticeTick(ctx: AppContext, now = new Date()) {
  const until = new Date(now.getTime() + 7 * 86_400_000);
  const allocations = await ctx.db.select().from(schema.storageAllocations).where(and(eq(schema.storageAllocations.status, 'active'), gt(schema.storageAllocations.expiresAt, now), lt(schema.storageAllocations.expiresAt, until)));
  for (const a of allocations) await notify(ctx.db, a.accountId, `storage-renewal:${a.id}`, 'Storage expires soon', `Your ${a.gb} GiB plan expires on ${a.expiresAt!.toISOString().slice(0, 10)}. Renew to keep your quota.`);
  const hosting = await ctx.db.select().from(schema.hostingCoverage).where(and(gt(schema.hostingCoverage.endsAt, now), lt(schema.hostingCoverage.endsAt, until)));
  for (const h of hosting) {
    const [later] = await ctx.db.select().from(schema.hostingCoverage).where(and(eq(schema.hostingCoverage.assetVersionId, h.assetVersionId), gt(schema.hostingCoverage.endsAt, h.endsAt))).limit(1);
    if (!later) await notify(ctx.db, h.payerId, `hosting-renewal:${h.id}`, 'Dataset hosting expires soon', `Hosting coverage ends on ${h.endsAt.toISOString().slice(0, 10)}. Renew before expiry to keep the listing available.`, '/dashboard');
  }
  // Read notifications are retained for 90 days; unread retention warnings remain visible.
  await ctx.db.delete(schema.notifications).where(lt(schema.notifications.readAt, new Date(now.getTime() - 90 * 86_400_000)));
}

export async function heartbeat(db: Db) {
  await db.insert(schema.operationCounters).values({ key: 'verification:heartbeat', count: 1n }).onConflictDoUpdate({ target: schema.operationCounters.key, set: { count: sql`${schema.operationCounters.count} + 1`, updatedAt: new Date() } });
}
