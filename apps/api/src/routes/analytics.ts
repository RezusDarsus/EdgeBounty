import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { z } from 'zod';
import { parse } from '../lib/http.js';

const pages=['home','datasets','models','listings','bounties','orders','assistant','sell','storage','provider','providers','failure-bounties','pricing','dashboard','other'] as const;
/** Best effort. Telemetry must never block or fail a marketplace operation. */
export function analyticsRoutes(app: FastifyInstance,ctx: AppContext) {
  let pending=0;
  const emit=(event:unknown)=>{
    if(!ctx.cfg.ANALYTICS_INGEST_SECRET || pending>=25)return;
    pending++;
    void fetch(`${ctx.cfg.ANALYTICS_INTERNAL_URL}/internal/ingest`,{method:'POST',headers:{'content-type':'application/json','x-analytics-secret':ctx.cfg.ANALYTICS_INGEST_SECRET},body:JSON.stringify(event),signal:AbortSignal.timeout(750)})
      .then(response=>response.body?.cancel()).catch(()=>{}).finally(()=>{pending--;});
  };
  app.post('/analytics/heartbeat',{config:{rateLimit:{max:12,timeWindow:'1 minute'}}},async(req,reply)=>{
    const input=parse(z.object({visitorId:z.string().uuid(),page:z.enum(pages),pageView:z.boolean().default(false)}).strict(),req.body);
    emit({kind:'heartbeat',...input,accountId:req.session?.accountId??null});
    return reply.header('cache-control','no-store').code(202).send({accepted:!!ctx.cfg.ANALYTICS_INGEST_SECRET});
  });
  app.addHook('onResponse',async(req,reply)=>{
    const route=req.routeOptions.url;
    if(!route || req.method==='OPTIONS' || /^\/(analytics|health|config)(\/|$)/.test(route))return;
    emit({kind:'request',route,method:req.method,status:reply.statusCode});
  });
}
