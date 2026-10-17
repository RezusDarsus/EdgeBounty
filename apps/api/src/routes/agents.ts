import type { FastifyInstance } from 'fastify';
import { and, eq, ilike, or, desc, gte, sql, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { HttpError, forbidden, notFound, isAdmin, parse, requireSession, requireAdmin } from '../lib/http.js';
import { draftBounty } from '../services/agents.js';
import { cachedAgent, nvidiaAssistant, type AssistantProvider } from '../services/assistant.js';
import { getOwnedVersion } from '../lib/assets.js';
import { humanizeReport } from '../services/l3.js';
import { metadataSample } from '../services/metadata-sample.js';

export function agentRoutes(app: FastifyInstance, ctx: AppContext, provider: AssistantProvider = nvidiaAssistant()) {
  app.get('/agents/capabilities', async () => ({
    discovery: 'catalog-keyword', bountyDraft: ctx.cfg.AI_DRAFTS_ENABLED === '1' && !!ctx.cfg.NVIDIA_API_KEY,
    chat: ctx.cfg.AI_DRAFTS_ENABLED === '1' && !!ctx.cfg.NVIDIA_API_KEY,
    metadataDraft: ctx.cfg.AI_DRAFTS_ENABLED === '1' && !!ctx.cfg.NVIDIA_API_KEY, financialAuthority: false,
    provider: 'nvidia', model: ctx.cfg.AI_ASSISTANT_MODEL,
    dailyAccountLimit: ctx.cfg.AI_AGENT_DAILY_ACCOUNT, dailyGlobalLimit: ctx.cfg.AI_AGENT_DAILY_GLOBAL,
  }));

  app.get('/agents/context', async req => {
    const s = requireSession(req);
    const versions = await ctx.db.select({ id: schema.assetVersions.id, name: schema.assets.name, version: schema.assetVersions.version })
      .from(schema.assetVersions).innerJoin(schema.assets, eq(schema.assets.id, schema.assetVersions.assetId))
      .where(and(eq(schema.assets.ownerId, s.accountId), isNull(schema.assets.deletedAt), eq(schema.assetVersions.status, 'finalized'))).orderBy(desc(schema.assetVersions.createdAt)).limit(100);
    const reports = await ctx.db.select({ id: schema.verificationJobs.id, level: schema.verificationJobs.level, createdAt: schema.verificationJobs.createdAt })
      .from(schema.verificationJobs).where(and(eq(schema.verificationJobs.requesterId, s.accountId), eq(schema.verificationJobs.status, 'completed'))).orderBy(desc(schema.verificationJobs.createdAt)).limit(100);
    return { versions, reports };
  });

  app.get('/agents/metadata-sample', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const s = requireSession(req);
    const { versionId } = parse(z.object({ versionId: z.string().uuid() }), req.query);
    return metadataSample(ctx, versionId, s.accountId);
  });

  app.get('/agents/usage', async req => {
    const s = requireSession(req); const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const [{ n, input, output }] = await ctx.db.select({ n: sql<string>`count(*)`, input: sql<string>`coalesce(sum(input_tokens),0)`, output: sql<string>`coalesce(sum(output_tokens),0)` })
      .from(schema.agentRequests).where(and(eq(schema.agentRequests.accountId, s.accountId), gte(schema.agentRequests.createdAt, since)));
    return { callsToday: Number(n), limit: ctx.cfg.AI_AGENT_DAILY_ACCOUNT, inputTokens: Number(input), outputTokens: Number(output), resets: '00:00 UTC', cacheRetentionDays: 30, billedUsd: null };
  });

  app.get('/admin/agent-usage', async req => {
    requireAdmin(ctx, req); const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const rows = await ctx.db.select({ status: schema.agentRequests.status, count: sql<string>`count(*)`, inputTokens: sql<string>`coalesce(sum(input_tokens),0)`, outputTokens: sql<string>`coalesce(sum(output_tokens),0)` })
      .from(schema.agentRequests).where(gte(schema.agentRequests.createdAt, since)).groupBy(schema.agentRequests.status);
    return { provider: 'nvidia', model: ctx.cfg.AI_ASSISTANT_MODEL, day: since.toISOString(), dailyLimit: ctx.cfg.AI_AGENT_DAILY_GLOBAL, rows, billedUsd: null, note: 'Reservations include failed or interrupted requests. Actual provider billing is not inferred from free-tier configuration.' };
  });

  app.post('/agents/chat', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async req => {
    const s = requireSession(req);
    if (s.scopes) throw forbidden('AI assistance requires a wallet session');
    const b = parse(z.object({
      mode: z.enum(['discovery', 'bounty', 'metadata', 'verification']), message: z.string().trim().min(2).max(4000), consent: z.literal(true),
      history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }).strict()).max(6).default([]),
      versionId: z.string().uuid().optional(), jobId: z.string().uuid().optional(), includeSample: z.boolean().default(false),
    }).strict(), req.body);
    let context: unknown = null;
    if (b.mode === 'metadata') {
      if (!b.versionId) throw new HttpError(400, 'context_required', 'Choose one of your finalized asset versions.');
      const { asset, version } = await getOwnedVersion(ctx, b.versionId, s.accountId);
      if (version.status !== 'finalized') throw new HttpError(409, 'not_finalized', 'Finalize the upload first.');
      const files = await ctx.db.select({ path: schema.assetFiles.path, size: schema.assetFiles.size, mediaType: schema.assetFiles.mediaType }).from(schema.assetFiles).where(eq(schema.assetFiles.versionId, b.versionId)).limit(40);
      context = { name: asset.name, kind: asset.kind, versionId: version.id, commitment: version.commitment, totalSize: String(version.totalSize), fileCount: version.fileCount, files,
        ...(b.includeSample ? { textSample: await metadataSample(ctx, b.versionId, s.accountId) } : {}),
        limitation: b.includeSample ? 'Manifest plus one explicitly consented bounded text prefix only. No full content or licensing verification.' : 'Manifest only; file contents and licensing evidence were not inspected.' };
    }
    if (b.mode === 'verification') {
      if (!b.jobId) throw new HttpError(400, 'context_required', 'Choose a completed verification report.');
      const [job] = await ctx.db.select().from(schema.verificationJobs).where(eq(schema.verificationJobs.id, b.jobId));
      if (!job) throw notFound('report');
      let allowed = job.requesterId === s.accountId || job.providerWallet === s.wallet || isAdmin(ctx, s);
      if (!allowed && job.orderId) {
        const [order] = await ctx.db.select().from(schema.orders).where(eq(schema.orders.id, job.orderId));
        allowed = !!order && [order.buyerWallet, order.sellerWallet].includes(s.wallet);
      }
      if (!allowed) throw notFound('report');
      const [result] = await ctx.db.select().from(schema.verificationResults).where(eq(schema.verificationResults.jobId, job.id));
      if (!result) throw new HttpError(409, 'report_pending', 'The report is not complete. Existing verification still runs through the quoted, authorized workflow.');
      context = { reportHash: result.reportHash, report: humanizeReport(result.report) };
    }
    const catalog = b.mode === 'discovery' ? await ctx.db.select({ id: schema.listings.id, title: schema.listings.title, description: schema.listings.description, category: schema.listings.category, kind: schema.listings.kind, priceMicro: schema.listings.priceMicro }).from(schema.listings).where(eq(schema.listings.status, 'published')).orderBy(desc(schema.listings.createdAt)).limit(50) : [];
    const input = JSON.parse(JSON.stringify({ mode: b.mode, message: b.message, history: b.history, context, catalog: catalog.map(l => ({ ...l, description: l.description.slice(0, 500) })) }, (_k, v) => typeof v === 'bigint' ? v.toString() : v));
    if (JSON.stringify(input).length > 60_000) throw new HttpError(413, 'context_too_large', 'Choose a smaller report or shorten the conversation.');
    const answer = await cachedAgent(ctx, s.accountId, b.mode, input, async () => {
      const r = await provider.complete(ctx.cfg, input);
      const ids = new Set(catalog.map(l => l.id));
      if (r.value.listingIds.some(id => !ids.has(id))) throw new Error('Unsupported listing citation');
      return { ...r.value, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
    });
    const result = answer.result;
    return { ...result, cached: answer.cached, model: ctx.cfg.AI_ASSISTANT_MODEL, provider: 'nvidia', verifierVersion: 'assistant/1', status: 'completed',
      sources: catalog.filter(l => result.listingIds.includes(l.id)).map(l => ({ id: l.id, title: l.title, href: `/listings/${l.id}` })),
      cost: { calls: answer.cached ? 0 : 1, inputTokens: result.inputTokens, outputTokens: result.outputTokens, billedUsd: null },
      limitations: ['AI suggestions require human review. No financial action was taken.', b.mode === 'discovery' ? 'Catalog scope: up to 50 recently published listings; no private content checked.' : b.mode === 'metadata' ? (b.includeSample ? 'The selected manifest and at most one 4,096-byte text prefix were shared. Full content and license rights were not verified.' : 'Only the selected manifest was shared; file contents and license rights were not verified.') : 'AI explanations do not change verification outcomes or establish legal ownership, accuracy or real-world performance.'],
    };
  });

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
    const r = await cachedAgent(ctx, s.accountId, 'bounty-draft', { requirements }, () => draftBounty(ctx.cfg, requirements));
    return { ...r.result, cached: r.cached };
  });
}
