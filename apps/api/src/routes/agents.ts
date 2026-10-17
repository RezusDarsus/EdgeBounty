import type { FastifyInstance } from 'fastify';
import { and, eq, ilike, or, desc } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { HttpError, forbidden, parse, requireSession } from '../lib/http.js';
import { draftBounty } from '../services/agents.js';

export function agentRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/agents/capabilities', async () => ({
    discovery: 'catalog-keyword', bountyDraft: ctx.cfg.AI_DRAFTS_ENABLED === '1' && !!ctx.cfg.NVIDIA_API_KEY,
    metadataDraft: false, financialAuthority: false,
  }));

  // Deterministic discovery uses only public listing fields. No private files or AI credits.
  app.get('/agents/discovery', async (req) => {
    const { q } = parse(z.object({ q: z.string().trim().min(2).max(100) }), req.query);
    const tokens = [...new Set(q.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 8);
    if (!tokens.length) return { method: 'catalog-keyword', items: [], limitations: ['Enter at least one word containing two letters or digits.'] };
    const matches = tokens.flatMap(t => [ilike(schema.listings.title, `%${t}%`), ilike(schema.listings.description, `%${t}%`), ilike(schema.listings.category, `%${t}%`)]);
    const rows = await ctx.db.select({ id: schema.listings.id, title: schema.listings.title, description: schema.listings.description, category: schema.listings.category, kind: schema.listings.kind }).from(schema.listings)
      .where(and(eq(schema.listings.status, 'published'), or(...matches))).orderBy(desc(schema.listings.createdAt)).limit(50);
    const items = rows.map(({ description, ...l }) => {
      const matchedTerms = tokens.filter(t => `${l.title} ${description} ${l.category}`.toLowerCase().includes(t));
      return { ...l, matchedTerms, explanation: `Public catalog metadata contains: ${matchedTerms.join(', ')}.` };
    }).sort((a, b) => b.matchedTerms.length - a.matchedTerms.length).slice(0, 8);
    return { method: 'catalog-keyword', items, limitations: ['Keyword matches among up to 50 recent matching listings; no file inspection or quality recommendation.'] };
  });

  app.post('/agents/bounty-draft', { config: { rateLimit: { max: 3, timeWindow: '1 hour' } } }, async (req) => {
    const s = requireSession(req);
    if (s.scopes) throw forbidden('Drafting requires a wallet session');
    const { requirements, consent } = parse(z.object({ requirements: z.string().trim().min(20).max(4000), consent: z.literal(true) }).strict(), req.body);
    if (ctx.cfg.AI_DRAFTS_ENABLED !== '1' || !ctx.cfg.NVIDIA_API_KEY) throw new HttpError(503, 'drafts_disabled', 'AI drafting is disabled until a provider budget is approved. Create your bounty manually.');
    if (!consent) throw forbidden();
    try { return await draftBounty(ctx.cfg, requirements); }
    catch { throw new HttpError(502, 'draft_failed', 'No draft was produced. Your bounty was not changed. You can continue manually.'); }
  });
}
