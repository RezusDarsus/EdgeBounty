import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { conflict, notFound, parse, requireAdmin, requireSession, zUuid } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { notify } from '../services/operations.js';

export function infringementRoutes(app: FastifyInstance, ctx: AppContext) {
 app.post('/listings/:id/report', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async req => {
  const s = requireSession(req);
  const { id } = parse(z.object({ id: zUuid }), req.params);
  const b = parse(z.object({ reason: z.string().trim().min(20).max(2000), evidenceUrl: z.string().url().max(2000).refine(v => new URL(v).protocol === 'https:', 'use an HTTPS evidence URL'), goodFaith: z.literal(true) }), req.body);
  const [listing] = await ctx.db.select().from(schema.listings).where(eq(schema.listings.id,id));
  if (!listing) throw notFound('listing');
  return ctx.db.transaction(async tx => {
   await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'infringement:'+s.accountId+':'+id},0))`);
   const existing = await tx.select().from(schema.infringementReports).where(and(eq(schema.infringementReports.reporterId,s.accountId),eq(schema.infringementReports.listingId,id),eq(schema.infringementReports.status,'open')));
   if (existing.length) throw conflict('You already have an open report for this listing');
   const [report] = await tx.insert(schema.infringementReports).values({ reporterId:s.accountId, listingId:id, reason:b.reason,evidenceUrl:b.evidenceUrl }).returning();
   await audit(tx as any,s,'infringement.report',report.id,{listingId:id});
   return { id:report.id,status:report.status };
  });
 });
 app.get('/me/infringement-reports', async req => {
  const s=requireSession(req);
  return ctx.db.select().from(schema.infringementReports).where(eq(schema.infringementReports.reporterId,s.accountId)).orderBy(desc(schema.infringementReports.createdAt)).limit(100);
 });
 app.get('/admin/infringement-reports', async req => {
  requireAdmin(ctx,req);
  return ctx.db.select().from(schema.infringementReports).orderBy(desc(schema.infringementReports.createdAt)).limit(200);
 });
 app.post('/admin/infringement-reports/:id/review',async req => {
  const s=requireAdmin(ctx,req);
  const {id}=parse(z.object({id:zUuid}),req.params);
  const b=parse(z.object({status:z.enum(['upheld','rejected']),resolution:z.string().trim().min(10).max(2000)}),req.body);
  await ctx.db.transaction(async tx => {
   const [report]=await tx.update(schema.infringementReports).set({...b,reviewedAt:new Date()}).where(and(eq(schema.infringementReports.id,id),eq(schema.infringementReports.status,'open'))).returning();
   if(!report) throw conflict('Report is missing or already reviewed');
   await audit(tx as any,s,'infringement.review',id,{status:b.status});
   await notify(tx as any,report.reporterId,`infringement:${id}:reviewed`,'Infringement report reviewed',b.resolution,'/dashboard');
  });
  return {ok:true,notice:'Use the existing moderation action to take down an upheld listing and sign any required on-chain moderation.'};
 });
}
