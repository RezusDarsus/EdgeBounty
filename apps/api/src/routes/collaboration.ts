import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { CollaborationService, ProposalOutput, rows,collaborationReservation } from '../services/collaboration.js';
import { cachedAgent,nvidiaAssistant,type AssistantProvider } from '../services/assistant.js';
import { createHash } from 'node:crypto';
import { forbidden, notFound, parse, requireSession, zUuid } from '../lib/http.js';
import { signDownloadToken,DOWNLOAD_TTL_SECS } from '../lib/tokens.js';
import {collaborationSettlementPlan,prepareCollaborationSettlement} from '../services/collaboration-settlement.js';

const Params=z.object({id:zUuid});
const Count=z.number().int().positive().max(1000000);
export function collaborationRoutes(app: FastifyInstance,ctx: AppContext,provider:AssistantProvider=nvidiaAssistant()) {
  const service=new CollaborationService(ctx.db);
  const actor=(req: FastifyRequest,human=false)=>{
    if(ctx.cfg.COLLABORATIVE_BOUNTIES_ENABLED!=='1') throw notFound('feature');
    const s=requireSession(req);
    if(human&&s.scopes) throw forbidden('Wallet session required for human approval');
    return s.accountId;
  };
  const id=(req: FastifyRequest)=>parse(Params,req.params).id;
  const root='/bounties/:id';
  app.get(`${root}/collaboration-status`,async req=>{
    const user=requireSession(req).accountId;
    if(ctx.cfg.COLLABORATIVE_BOUNTIES_ENABLED!=='1') return {available:false,enabled:false};
    const [o]=await rows(ctx.db,sql`select buyer_id,public from orders where id=${id(req)} and kind='bounty'`);
    if(!o||(!o.public&&o.buyer_id!==user)) throw notFound('bounty');
    const [c]=await rows(ctx.db,sql`select 1 from collaborative_bounties where bounty_id=${id(req)}`);
    return {available:true,enabled:!!c};
  });
  app.post(`${root}/collaboration/enable`,async req=>{
    const user=actor(req,true);
    const b=parse(z.object({target:Count,claimTtlSeconds:z.number().int().min(60).max(604800).default(86400),nearThreshold:z.number().int().min(0).max(16).default(6)}).strict(),req.body);
    const [order]=await rows(ctx.db,sql`select buyer_wallet,order_id_onchain from orders where id=${id(req)}`);
    const reserve=order?collaborationReservation(ctx.chain.client.programId,order.buyer_wallet,BigInt(order.order_id_onchain)):undefined;
    return service.enable(id(req),user,b.target,b.claimTtlSeconds,b.nearThreshold,reserve);
  });
  app.post(`${root}/collaborators/join`,async req=>service.join(id(req),actor(req,true)));
  app.post(`${root}/collaborators/leave`,async req=>service.leave(id(req),actor(req,true)));
  app.post(`${root}/collaborators/invite`,async req=>{
    const user=actor(req,true),body=parse(z.object({userId:zUuid}).strict(),req.body);
    return service.invite(id(req),user,body.userId);
  });
  app.get(`${root}/contributions`,async req=>{
    const user=actor(req),bounty=id(req),q=parse(z.object({offset:z.coerce.number().int().nonnegative().default(0),limit:z.coerce.number().int().min(1).max(100).default(50)}),req.query);
    return service.locked(bounty,async(tx,b)=>{
      await service.member(tx,bounty,user,b.buyer_id);
      return rows(tx,sql`select id,contributor_id as "userId",status,review_access_granted as "reviewAccessGranted",license_declaration as "licenseDeclaration" from collaboration_submissions where bounty_id=${bounty} and (contributor_id=${user} or ${user}=${b.buyer_id}) order by created_at,id limit ${q.limit} offset ${q.offset}`);
    });
  });
  app.post(`${root}/contributions/:submissionId/review-access`,async req=>{
    const user=actor(req,true),p=parse(Params.extend({submissionId:zUuid}),req.params),body=parse(z.object({granted:z.boolean()}).strict(),req.body);
    return service.reviewAccess(p.id,user,p.submissionId,body.granted);
  });
  app.post(`${root}/contributions/:submissionId/withdraw`,async req=>{
    const user=actor(req,true),p=parse(Params.extend({submissionId:zUuid}),req.params);
    return service.withdraw(p.id,user,p.submissionId);
  });
  for(const resource of ['collaboration','collaborators','agents','work-plan','proposals','progress','agent-events']) {
    app.get(`${root}/${resource}`,async req=>{
      const user=actor(req);
      const q=parse(z.object({after:z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),limit:z.coerce.number().int().min(1).max(200).default(100)}),req.query);
      const view=await service.snapshot(id(req),user,q.after,q.limit,resource==='collaboration'&&q.after===0);
      if(resource==='collaborators'||resource==='agents') return view.contributors;
      if(resource==='work-plan') return {tasks:view.workPlan,claims:view.claims};
      if(resource==='progress') return view.progress;
      if(resource==='proposals') return view.proposals;
      if(resource==='agent-events') return view.events;
      return view;
    });
  }
  app.post(`${root}/work-claims`,async req=>{
    const user=actor(req,true),b=parse(z.object({count:Count,idempotencyKey:z.string().min(8).max(120)}).strict(),req.body);
    return service.claim(id(req),user,b.count,b.idempotencyKey);
  });
  app.post(`${root}/work-claims/:claimId/release`,async req=>{
    const user=actor(req,true),p=parse(Params.extend({claimId:zUuid}),req.params);
    return service.release(p.id,user,p.claimId);
  });
  app.post(`${root}/proposals/:proposalId/respond`,async req=>{
    const user=actor(req,true),p=parse(Params.extend({proposalId:zUuid}),req.params);
    const b=parse(z.object({accept:z.boolean(),count:Count.optional()}).strict(),req.body);
    return service.respond(p.id,user,p.proposalId,b.accept,b.count);
  });
  app.post(`${root}/agents/:agentId/propose`,{config:{rateLimit:{max:6,timeWindow:'1 minute'}}},async req=>{
    const user=actor(req,true),p=parse(Params.extend({agentId:zUuid}),req.params);
    parse(z.object({consent:z.literal(true)}).strict(),req.body);
    const view=await service.snapshot(p.id,user);
    const own=view.contributors.find(c=>c.userId===user&&c.agentId===p.agentId&&c.status==='active');
    if(!own)throw forbidden('This agent belongs to another seller');
    if(!view.progress.remaining)return {proposal:null,targetReached:true};
    const input={mode:'bounty',message:'Explain the remaining dataset work and propose a corrective contribution. Suggestions require human approval.',
      context:{bountyId:p.id,agentId:p.agentId,remaining:view.progress.remaining,ownAccepted:own.accepted??0,ownDuplicates:own.duplicates??0},catalog:[]};
    const answer=await cachedAgent(ctx,user,'collaboration',input,async()=>{
      const r=await provider.complete(ctx.cfg,input);
      if(r.value.listingIds.length)throw new Error('Unexpected catalog citation');
      return {...ProposalOutput.parse({count:Math.min(view.progress.remaining,own.duplicates||view.progress.remaining),explanation:r.value.answer.slice(0,1000)}),inputTokens:r.inputTokens,outputTokens:r.outputTokens};
    });
    const source=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return service.locked(p.id,async(tx,b)=>{
      await service.member(tx,p.id,user);
      if(b.manifest)throw forbidden('Accounting is frozen');
      const progress=await service.progress(tx,p.id,b.target);
      const count=Math.min(answer.result.count,progress.remaining);
      if(!count)return {proposal:null,targetReached:true};
      const [proposal]=await rows(tx,sql`insert into agent_proposals(bounty_id,agent_id,user_id,proposal_type,proposed_count,source_key) values(${p.id},${p.agentId},${user},'WORK_OFFERED',${count},${source}) on conflict(bounty_id,agent_id,source_key) do update set source_key=excluded.source_key returning id`);
      await service.event(tx,p.id,'WORK_OFFERED',{proposalId:proposal.id,count,explanation:answer.result.explanation,provider:'nvidia',requiresHumanApproval:true},`provider:${source}`,user,p.agentId);
      return {proposalId:proposal.id,count,cached:answer.cached};
    });
  });
  app.post(`${root}/contributions`,async req=>{
    const user=actor(req,true),b=parse(z.object({assetVersionId:zUuid,verificationJobId:zUuid,licenseDeclaration:z.string().trim().min(20).max(2000),reviewAccessGranted:z.boolean().default(false)}).strict(),req.body);
    return service.submit(id(req),user,b.assetVersionId,b.verificationJobId,b.licenseDeclaration,b.reviewAccessGranted);
  });
  app.get(`${root}/review-items`,async req=>{
    const user=actor(req),bounty=id(req),q=parse(z.object({offset:z.coerce.number().int().nonnegative().default(0),limit:z.coerce.number().int().min(1).max(100).default(50)}),req.query);
    return service.locked(bounty,async(tx,b)=>{
      await service.member(tx,bounty,user,b.buyer_id);
      // Metadata only. No hashes, object keys, foreign duplicate references or private asset URLs.
      return rows(tx,sql`select i.id,i.submission_id as "submissionId",i.contributor_id as "userId",i.verification_status as status,s.review_access_granted as "reviewAccessGranted",s.license_declaration as "licenseDeclaration" from submission_items i join collaboration_submissions s on s.id=i.submission_id where i.bounty_id=${bounty} and i.verification_status in ('review','accepted') and (${user}= ${b.buyer_id} or i.contributor_id=${user}) order by i.id limit ${q.limit} offset ${q.offset}`);
    });
  });
  app.get(`${root}/review-items/:itemId/content`,async(req,reply)=>{
    const user=actor(req),p=parse(Params.extend({itemId:zUuid}),req.params),session=requireSession(req);
    const file=await service.locked(p.id,async(tx,b)=>{
      await service.member(tx,p.id,user,b.buyer_id);
      const [item]=await rows(tx,sql`select i.*,s.review_access_granted,s.status as submission_status,s.asset_version_id from submission_items i join collaboration_submissions s on s.id=i.submission_id where i.id=${p.itemId} and i.bounty_id=${p.id}`);
      if(!item||!['review','accepted'].includes(item.verification_status)||item.submission_status!=='verified')throw notFound('reviewable image');
      if(user!==item.contributor_id&&(user!==b.buyer_id||!item.review_access_granted))throw forbidden('Contributor permission is required for buyer review');
      const [f]=await rows(tx,sql`select f.id from asset_files f join asset_versions v on v.id=f.version_id join assets a on a.id=v.asset_id where f.version_id=${item.asset_version_id} and f.path=${item.file_path} and f.sha256=${item.exact_hash} and a.deleted_at is null`);
      if(!f)throw notFound('image file; archive members require individual image uploads');
      return {id:f.id,submission:item.submission_id};
    });
    const token=signDownloadToken(ctx.cfg.DOWNLOAD_TOKEN_SECRET,{s:'collaboration_review',g:file.submission,f:file.id,w:session.wallet,x:Math.floor(Date.now()/1000)+DOWNLOAD_TTL_SECS});
    return reply.header('Cache-Control','private, no-store').redirect(`/download/${token}`,307);
  });
  app.post(`${root}/review-items/:itemId/respond`,async req=>{
    const user=actor(req,true),p=parse(Params.extend({itemId:zUuid}),req.params);
    const b=parse(z.object({accept:z.boolean(),reason:z.string().trim().min(10).max(1000)}).strict(),req.body);
    return service.review(p.id,user,p.itemId,b.accept,b.reason);
  });
  app.post(`${root}/payout-manifest`,async req=>service.manifest(id(req),actor(req,true),ctx.cfg.PAYMENT_CURRENCY));
  app.get(`${root}/settlement-plan`,async req=>collaborationSettlementPlan(ctx,id(req),actor(req)));
  app.post(`${root}/settlement-plan`,async req=>{
    const user=actor(req,true),body=parse(z.object({manifestHash:z.string().regex(/^[0-9a-f]{64}$/),deadline:z.coerce.date().refine(d=>d.getTime()>Date.now()+3600000&&d.getTime()<Date.now()+366*86400000,'Choose a delivery deadline between one hour and one year from now'),acknowledgeSplitEscrow:z.literal(true)}).strict(),req.body);
    return prepareCollaborationSettlement(ctx,id(req),user,body.manifestHash,body.deadline);
  });
  // Authenticated fetch-stream SSE, no bearer tokens in URLs. Reconnect from the durable sequence.
  app.get(`${root}/events/stream`,async(req,reply)=>{
    const user=actor(req),bounty=id(req),q=parse(z.object({after:z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0)}),req.query);
    let cursor=q.after;
    await service.snapshot(bounty,user,cursor,1);
    reply.hijack();
    reply.raw.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive',
      ...(reply.getHeader('access-control-allow-origin')?{'Access-Control-Allow-Origin':String(reply.getHeader('access-control-allow-origin'))}:{})});
    let busy=false,closed=false;
    const tick=async()=>{
      if(busy||closed) return;busy=true;
      try {
        const view=await service.snapshot(bounty,user,cursor,100);
        for(const event of view.events) {cursor=Number(event.sequence);if(!reply.raw.write(`id: ${cursor}\ndata: ${JSON.stringify(event)}\n\n`)){reply.raw.end();return;}}
        reply.raw.write(': heartbeat\n\n');
      } catch {reply.raw.end();} finally {busy=false;}
    };
    const timer=setInterval(()=>void tick(),2000);
    const close=()=>{closed=true;clearInterval(timer);clearTimeout(expiry);};
    // Reauthenticate periodically; do not let a revoked login own an indefinite stream.
    const expiry=setTimeout(()=>reply.raw.end(),60000);
    reply.raw.on('close',close);
    void tick();
  });
}
