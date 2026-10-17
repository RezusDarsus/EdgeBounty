import { paymentMint } from './lib/payments.js';
import { notificationRoutes } from './routes/notifications.js';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { AppContext } from './context.js';
import { HttpError, apiKeyAllows, resolveSession } from './lib/http.js';
import { authRoutes } from './routes/auth.js';
import { assetRoutes } from './routes/assets.js';
import { marketplaceRoutes } from './routes/marketplace.js';
import { deliveryRoutes } from './routes/delivery.js';
import { verificationRoutes } from './routes/verification.js';
import { failureRoutes } from './routes/failure.js';
import { storageRoutes } from './routes/storage.js';
import { billingRoutes } from './routes/billing.js';
import { adminRoutes } from './routes/admin.js';
import { orgRoutes } from './routes/orgs.js';
import { devRoutes } from './routes/dev.js';
import { encryptedDeliveryRoutes } from './routes/encrypted.js';

const bigintSafe = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

export async function buildApp(ctx: AppContext, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger
      ? {
          level: 'info',
          // privacy: never log IPs, auth headers or bodies
          serializers: { req: (r) => ({ method: r.method, url: r.url.replace(/\/download\/[^/?]+/, '/download/<token>') }) },
        }
      : false,
    bodyLimit: 2 * 1024 * 1024,
    routerOptions: { maxParamLength: 2048 },
    trustProxy: ['127.0.0.1', '::1'],
  });
  app.setReplySerializer((payload) => JSON.stringify(payload, bigintSafe));
  await app.register(cors, {
    origin: ctx.cfg.CORS_ORIGINS.split(',').map((s) => s.trim()),
    credentials: false,
    // the default only allows GET/HEAD/POST, which silently blocks part uploads (PUT) and PATCH/DELETE
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'x-part-sha256', 'x-api-key'],
    exposedHeaders: ['x-content-sha256', 'content-disposition'],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    max: ctx.cfg.NODE_ENV === 'test' ? 100_000 : 300,
    timeWindow: '1 minute',
    // runs after the onRequest session hook: per wallet when authenticated, per IP otherwise (in-memory only)
    hook: 'preHandler',
    keyGenerator: (req) => req.session?.wallet ?? req.ip,
  });
  app.addHook('onRequest', async (req) => {
    req.session = await resolveSession(ctx, req);
    if (req.session?.scopes && !apiKeyAllows(req.session.scopes, req.method, req.url)) {
      throw new HttpError(403, 'scope', 'API key scope does not allow this request');
    }
  });
  app.addHook('preHandler', async (req) => {
    const path = req.url.split('?')[0];
    if (/^\/(listings|bounties|orders|groups|failure-bounties|verification|invoices|storage|credits|entitlements|me\/(orders|listings|invoices|entitlements))([/]|$)/.test(path)) {
      const config = await ctx.chain.client.config().catch(() => null);
      if (!config) throw new HttpError(503, 'payment_unavailable', 'The payment configuration is unavailable. Try again when the blockchain connection is restored.');
      if (config && !config.paymentMint.equals(paymentMint(ctx.cfg))) throw new HttpError(409, 'legacy_currency', 'The configured currency does not match the on-chain mint. Use a separate ledger and database; never relabel balances.');
    }
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message, details: err.details });
    const e = err as { statusCode?: number; message: string; code?: string };
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.code ?? 'bad_request', message: e.message });
    app.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'internal error' });
  });

  app.get('/health', async () => ({ ok: true, chain: await ctx.chain.healthy(), programId: ctx.chain.client.programId.toBase58() }));
  app.get('/health/ready', async (_req, reply) => {
    try {
      await ctx.db.execute(sql`select 1`);
      const chain = await ctx.chain.healthy();
      const result = await ctx.db.execute(sql`select updated_at from operation_counters where key='verification:heartbeat'`);
      const rows = (result as any).rows ?? result;
      const worker = ctx.cfg.VERIFICATION_EXECUTOR === 'api' || (!!rows[0] && Date.now() - new Date(rows[0].updated_at).getTime() < 90_000);
      return reply.code(chain && worker ? 200 : 503).send({ ok: chain && worker, database: true, chain, worker });
    } catch { return reply.code(503).send({ ok: false }); }
  });
  app.get('/config', async () => {
    const c = await ctx.chain.client.config();
    return {
      programId: ctx.chain.client.programId.toBase58(),
      rpcUrl: ctx.cfg.SOLANA_RPC_URL,
      paymentMint: c?.paymentMint.toBase58() ?? null,
      currency: ctx.cfg.PAYMENT_CURRENCY,
      decimals: ctx.cfg.PAYMENT_CURRENCY === 'USDC' ? 6 : 9,
      paymentReady: !!c?.paymentMint.equals(paymentMint(ctx.cfg)),
      treasury: c?.treasury.toBase58() ?? null,
      feeBps: c?.feeBps ?? null,
      reviewWindowSecs: c?.reviewWindowSecs ?? null,
      paused: c?.paused ?? null,
      platformVerifier: ctx.chain.platformVerifier?.publicKey.toBase58() ?? null,
      disputeAuthority: c?.disputeAuthority.toBase58() ?? null,
      admin: c?.admin.toBase58() ?? null,
    };
  });

  authRoutes(app, ctx);
  assetRoutes(app, ctx);
  marketplaceRoutes(app, ctx);
  deliveryRoutes(app, ctx);
  verificationRoutes(app, ctx);
  failureRoutes(app, ctx);
  storageRoutes(app, ctx);
  billingRoutes(app, ctx);
  adminRoutes(app, ctx);
  orgRoutes(app, ctx);
  encryptedDeliveryRoutes(app, ctx);
  devRoutes(app, ctx);
  notificationRoutes(app, ctx);
  return app;
}
