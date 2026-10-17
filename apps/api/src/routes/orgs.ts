import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { conflict, forbidden, notFound, parse, requireSession, zWallet } from '../lib/http.js';
import { audit } from '../lib/audit.js';

/** Organization accounts (Phase 5): shared visibility of members' orders and spend. */
export function orgRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  const myOrg = async (accountId: string) => {
    const [a] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId));
    if (!a?.organizationId) return null;
    const [o] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, a.organizationId));
    return o ?? null;
  };

  app.post('/orgs', async (req) => {
    const s = requireSession(req);
    const { name } = parse(z.object({ name: z.string().min(2).max(120) }), req.body);
    if (await myOrg(s.accountId)) throw conflict('already in an organization');
    const [o] = await db.insert(schema.organizations).values({ name, ownerId: s.accountId }).returning();
    await db.update(schema.accounts).set({ organizationId: o.id }).where(eq(schema.accounts.id, s.accountId));
    await audit(db, s, 'org.create', o.id);
    return o;
  });

  app.get('/orgs/me', async (req) => {
    const s = requireSession(req);
    const o = await myOrg(s.accountId);
    if (!o) throw notFound('organization');
    const members = await db.select({ id: schema.accounts.id, wallet: schema.accounts.wallet, alias: schema.accounts.alias }).from(schema.accounts).where(eq(schema.accounts.organizationId, o.id));
    const wallets = members.map((m) => m.wallet);
    const orders = await db
      .select()
      .from(schema.orders)
      .where(or(inArray(schema.orders.buyerWallet, wallets), inArray(schema.orders.sellerWallet, wallets)))
      .orderBy(desc(schema.orders.createdAt))
      .limit(200);
    const spend = orders.filter((x) => x.chainState === 'settled' && wallets.includes(x.buyerWallet)).reduce((n, x) => n + x.amountMicro, 0n);
    return { organization: o, members, orders: orders.map((x) => ({ id: x.id, title: x.title, state: x.chainState, amountMicro: x.amountMicro.toString(), buyer: x.buyerWallet, seller: x.sellerWallet })), settledSpendMicro: spend.toString() };
  });

  app.post('/orgs/me/members', async (req) => {
    const s = requireSession(req);
    const { wallet } = parse(z.object({ wallet: zWallet }), req.body);
    const o = await myOrg(s.accountId);
    if (!o || o.ownerId !== s.accountId) throw forbidden('organization owner only');
    const [a] = await db.select().from(schema.accounts).where(eq(schema.accounts.wallet, wallet));
    if (!a) throw notFound('account (the member must sign in once first)');
    if (a.organizationId) throw conflict('account already belongs to an organization');
    await db.update(schema.accounts).set({ organizationId: o.id }).where(eq(schema.accounts.id, a.id));
    await audit(db, s, 'org.add_member', o.id, { wallet });
    return { ok: true };
  });

  app.delete('/orgs/me/members/:wallet', async (req) => {
    const s = requireSession(req);
    const { wallet } = req.params as { wallet: string };
    const o = await myOrg(s.accountId);
    if (!o) throw notFound('organization');
    if (o.ownerId !== s.accountId && wallet !== s.wallet) throw forbidden();
    const [a] = await db.select().from(schema.accounts).where(and(eq(schema.accounts.wallet, wallet), eq(schema.accounts.organizationId, o.id)));
    if (!a) throw notFound('member');
    if (a.id === o.ownerId) throw conflict('owner cannot leave; transfer ownership first');
    await db.update(schema.accounts).set({ organizationId: null }).where(eq(schema.accounts.id, a.id));
    await audit(db, s, 'org.remove_member', o.id, { wallet });
    return { ok: true };
  });
}
