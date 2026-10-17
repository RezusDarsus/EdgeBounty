import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { aliasFor, buildSignInMessage, hashApiKey, issueSession, newNonce, NONCE_TTL_MS, verifyWalletSignature } from '../auth/siws.js';
import { badRequest, forbidden, notFound, parse, requireSession, unauthorized, zWallet } from '../lib/http.js';
import { audit } from '../lib/audit.js';

export function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, cfg } = ctx;

  app.post('/auth/challenge', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { wallet } = parse(z.object({ wallet: zWallet }), req.body);
    if (!PublicKey.isOnCurve(new PublicKey(wallet).toBytes())) throw badRequest('wallet must be a signing key');
    const nonce = newNonce();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_MS);
    const message = buildSignInMessage({ domain: cfg.APP_DOMAIN, wallet, nonce, issuedAt, expiresAt, chainId: cfg.SOLANA_RPC_URL.includes('devnet') ? 'solana:devnet' : cfg.SOLANA_RPC_URL.includes('mainnet') ? 'solana:mainnet' : 'solana:localnet' });
    await db.delete(schema.authNonces).where(lt(schema.authNonces.expiresAt, new Date()));
    await db.insert(schema.authNonces).values({ nonce, wallet, message, expiresAt });
    return { nonce, message, expiresAt };
  });

  app.post('/auth/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(z.object({ wallet: zWallet, nonce: z.string(), signature: z.string() }), req.body);
    const [n] = await db.select().from(schema.authNonces).where(eq(schema.authNonces.nonce, b.nonce));
    if (!n || n.wallet !== b.wallet) throw unauthorized('unknown challenge');
    if (n.usedAt) throw unauthorized('challenge already used');
    if (n.expiresAt < new Date()) throw unauthorized('challenge expired');
    if (!verifyWalletSignature(n.message, b.signature, b.wallet)) throw unauthorized('bad signature');
    // single use: mark used atomically
    const used = await db
      .update(schema.authNonces)
      .set({ usedAt: new Date() })
      .where(and(eq(schema.authNonces.nonce, b.nonce), isNull(schema.authNonces.usedAt)))
      .returning();
    if (used.length !== 1) throw unauthorized('challenge already used');

    let [acct] = await db.select().from(schema.accounts).where(eq(schema.accounts.wallet, b.wallet));
    if (!acct) {
      [acct] = await db.insert(schema.accounts).values({ wallet: b.wallet, alias: aliasFor(b.wallet) }).returning();
      await db.insert(schema.profiles).values({ accountId: acct.id });
    }
    if (acct.deletedAt) throw forbidden('account deleted');
    await db.update(schema.accounts).set({ lastLoginAt: new Date() }).where(eq(schema.accounts.id, acct.id));
    const roles = [...acct.roles];
    if (cfg.ADMIN_WALLETS.split(',').map((s) => s.trim()).includes(acct.wallet) && !roles.includes('admin')) roles.push('admin');
    const token = await issueSession(cfg.JWT_SECRET, { accountId: acct.id, wallet: acct.wallet, roles });
    return { token, account: { id: acct.id, wallet: acct.wallet, alias: acct.alias, mode: acct.mode, roles } };
  });

  app.get('/me', async (req) => {
    const s = requireSession(req);
    const [a] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, s.accountId));
    const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.accountId, s.accountId));
    return { account: a, profile: p ?? null, roles: s.roles };
  });

  app.patch('/me', async (req) => {
    const s = requireSession(req);
    const b = parse(
      z.object({
        mode: z.enum(['pseudonymous', 'public']).optional(),
        alias: z.string().min(3).max(40).regex(/^[a-z0-9-_]+$/i).optional(),
        displayName: z.string().max(80).nullable().optional(),
        organization: z.string().max(120).nullable().optional(),
        bio: z.string().max(2000).nullable().optional(),
        links: z.array(z.string().url().max(300)).max(10).optional(),
      }),
      req.body,
    );
    if (b.mode || b.alias) await db.update(schema.accounts).set({ ...(b.mode ? { mode: b.mode } : {}), ...(b.alias ? { alias: b.alias } : {}) }).where(eq(schema.accounts.id, s.accountId));
    const { mode, alias, ...profile } = b;
    if (Object.keys(profile).length) await db.update(schema.profiles).set({ ...profile, updatedAt: new Date() }).where(eq(schema.profiles.accountId, s.accountId));
    return { ok: true };
  });

  /** Account deletion: erases profile data; on-chain records are public and immutable. */
  app.delete('/me', async (req) => {
    const s = requireSession(req);
    await db.update(schema.apiKeys).set({ revokedAt: new Date() }).where(eq(schema.apiKeys.accountId, s.accountId));
    // Erase cached private AI output; retain prompt-free quota reservation records until retention cleanup.
    await db.update(schema.agentRequests).set({ response: null, status: 'erased' }).where(eq(schema.agentRequests.accountId, s.accountId));
    await db.update(schema.profiles).set({ displayName: null, organization: null, bio: null, links: [] }).where(eq(schema.profiles.accountId, s.accountId));
    await db.update(schema.accounts).set({ deletedAt: new Date(), mode: 'pseudonymous' }).where(eq(schema.accounts.id, s.accountId));
    await audit(db, s, 'account.delete', s.accountId);
    return { ok: true, note: 'Profile erased. Public blockchain records cannot be deleted.' };
  });

  // public profile: only public-mode accounts reveal profile fields
  app.get('/profiles/:wallet', async (req) => {
    const { wallet } = req.params as { wallet: string };
    const [a] = await db.select().from(schema.accounts).where(eq(schema.accounts.wallet, wallet));
    if (!a || a.deletedAt) throw notFound('profile');
    const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.accountId, a.id));
    const rep = await ctx.chain.client.program.account.reputation.fetchNullable(ctx.chain.client.pda.reputation(new PublicKey(wallet))).catch(() => null);
    const reviews = await db.select().from(schema.reviews).where(eq(schema.reviews.subjectId, a.id));
    return {
      wallet: a.wallet,
      alias: a.alias,
      mode: a.mode,
      profile: a.mode === 'public' && p ? { displayName: p.displayName, organization: p.organization, bio: p.bio, links: p.links, verifiedBusiness: p.verifiedBusiness } : null,
      reputation: rep
        ? {
            salesCompleted: (rep as any).salesCompleted,
            purchasesCompleted: (rep as any).purchasesCompleted,
            volumeSold: (rep as any).volumeSold.toString(),
            disputedOrders: (rep as any).disputedOrders,
            refundedOrders: (rep as any).refundedOrders,
            verifiedContributions: (rep as any).verifiedContributions,
          }
        : null,
      rating: reviews.length ? { count: reviews.length, average: Math.round((reviews.reduce((n, r) => n + r.rating, 0) / reviews.length) * 10) / 10 } : null,
    };
  });

  // ---------------------------------------------------------------- API keys (enterprise integration)
  app.post('/me/api-keys', async (req) => {
    const s = requireSession(req);
    const b = parse(z.object({ name: z.string().min(1).max(60), scopes: z.array(z.enum(['read', 'verify', 'upload'])).min(1) }), req.body);
    const secret = `eb_${randomBytes(24).toString('base64url')}`;
    const [k] = await db.insert(schema.apiKeys).values({ accountId: s.accountId, name: b.name, prefix: secret.slice(0, 10), keyHash: hashApiKey(secret), scopes: b.scopes }).returning();
    await audit(db, s, 'api_key.create', k.id);
    return { id: k.id, key: secret, note: 'Shown once. Store it securely.' };
  });
  app.get('/me/api-keys', async (req) => {
    const s = requireSession(req);
    const ks = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.accountId, s.accountId));
    return ks.map(({ keyHash, ...k }) => k);
  });
  app.delete('/me/api-keys/:id', async (req) => {
    const s = requireSession(req);
    await db.update(schema.apiKeys).set({ revokedAt: new Date() }).where(and(eq(schema.apiKeys.id, (req.params as any).id), eq(schema.apiKeys.accountId, s.accountId)));
    await audit(db, s, 'api_key.revoke', (req.params as any).id);
    return { ok: true };
  });
}
