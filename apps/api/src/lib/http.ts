import type { FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodType } from 'zod';
import { PublicKey } from '@solana/web3.js';
import { verifySession, hashApiKey, type Session } from '../auth/siws.js';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { and, eq, isNull } from 'drizzle-orm';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'authentication required') => new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = 'forbidden') => new HttpError(403, 'forbidden', msg);
export const notFound = (what = 'resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (msg: string) => new HttpError(409, 'conflict', msg);

export function parse<T>(s: ZodType<T>, v: unknown): T {
  const r = s.safeParse(v);
  if (!r.success) {
    const labels: Record<string, string> = { title: 'Title', description: 'Description', recordCount: 'Records', formats: 'Formats', licenseId: 'License', priceMicro: 'Price', size: 'File size', mediaType: 'File type', path: 'File path', budgetMicro: 'Reward' };
    const messages = r.error.issues.slice(0, 6).map((issue) => {
      const field = String(issue.path[0] ?? 'Form');
      return `${labels[field] ?? field}: ${issue.message}`;
    });
    throw badRequest(`Validation failed. ${messages.join('; ')}`, z.flattenError(r.error as never));
  }
  return r.data;
}

export const zWallet = z.string().refine((s) => {
  try {
    return new PublicKey(s).toBase58() === s;
  } catch {
    return false;
  }
}, 'invalid wallet address');
export const zHex32 = z.string().regex(/^[0-9a-f]{64}$/);
export const zMicro = z.union([z.string().regex(/^\d{1,20}$/), z.number().int().safe().nonnegative()]).transform((v) => BigInt(v)).refine(v => v <= 18_446_744_073_709_551_615n, 'amount exceeds unsigned 64-bit range');
export const zUuid = z.string().uuid();

declare module 'fastify' {
  interface FastifyRequest {
    session?: Session;
  }
}

/** Resolves bearer JWT or `x-api-key` into `req.session`. */
export async function resolveSession(ctx: AppContext, req: FastifyRequest): Promise<Session | undefined> {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) {
    const s = await verifySession(ctx.cfg.JWT_SECRET, h.slice(7));
    if (s) {
      const [account] = await ctx.db.select().from(schema.accounts).where(eq(schema.accounts.id, s.accountId));
      if (account && !account.deletedAt && account.wallet === s.wallet) {
        const configuredAdmin = ctx.cfg.ADMIN_WALLETS.split(',').map(v => v.trim()).includes(account.wallet);
        return { ...s, roles: configuredAdmin ? [...new Set([...account.roles, 'admin'])] : account.roles };
      }
    }
  }
  const key = req.headers['x-api-key'];
  if (typeof key === 'string' && key.startsWith('eb_')) {
    const [k] = await ctx.db
      .select()
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.keyHash, hashApiKey(key)), isNull(schema.apiKeys.revokedAt)));
    if (k) {
      const [a] = await ctx.db.select().from(schema.accounts).where(eq(schema.accounts.id, k.accountId));
      if (a && !a.deletedAt) {
        await ctx.db.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, k.id));
        // API keys never carry admin power and are limited to their scopes
        return { accountId: a.id, wallet: a.wallet, roles: [], scopes: k.scopes };
      }
    }
  }
  return undefined;
}

/** API-key scopes: read = GET only; upload = assets/versions/uploads; verify = verification jobs/quotes. */
export function apiKeyAllows(scopes: string[], method: string, url: string): boolean {
  const path = url.split('?')[0];
  if (method === 'GET' || method === 'HEAD') return scopes.includes('read') || (scopes.includes('verify') && path.startsWith('/verification'));
  if (scopes.includes('upload') && /^\/(assets|versions|uploads)(\/|$)/.test(path)) return true;
  if (scopes.includes('verify') && /^\/(verification|invoices)(\/|$)/.test(path)) return true;
  return false;
}

export function requireSession(req: FastifyRequest): Session {
  if (!req.session) throw unauthorized();
  return req.session;
}

export function isAdmin(ctx: AppContext, s: Session | undefined): boolean {
  if (!s || s.scopes) return false; // API-key sessions never act as admin
  return s.roles.includes('admin') || ctx.cfg.ADMIN_WALLETS.split(',').map((x) => x.trim()).filter(Boolean).includes(s.wallet);
}

export function requireAdmin(ctx: AppContext, req: FastifyRequest): Session {
  const s = requireSession(req);
  if (!isAdmin(ctx, s)) throw forbidden('admin only');
  return s;
}

export function sendError(reply: FastifyReply, e: unknown) {
  if (e instanceof HttpError) return reply.status(e.status).send({ error: e.code, message: e.message, details: e.details });
  throw e;
}

export const jsonSafe = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));
