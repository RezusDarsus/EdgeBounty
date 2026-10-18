import {it,expect} from 'vitest';
import {sql} from 'drizzle-orm';
import {createDb} from '../../apps/api/src/db/index.js';
import {CollaborationService,rows} from '../../apps/api/src/services/collaboration.js';
import {collaborationFixture,evidence} from '../fixtures/collaboration.js';
import Fastify from 'fastify';
import {collaborationRoutes} from '../../apps/api/src/routes/collaboration.js';
import {issueSession,verifySession} from '../../apps/api/src/auth/siws.js';
import {loadConfig} from '../../apps/api/src/config.js';
import type {AppContext} from '../../apps/api/src/context.js';

const url=process.env.TEST_COLLABORATION_DATABASE_URL;
it.skipIf(!url)('serializes independent PostgreSQL connections and rolls back unacknowledged collaboration events',async()=>{
  if(!/^edgebounty_collaboration_verify_[a-z0-9_]+$/.test(new URL(url!).pathname.slice(1)))throw Error('Use an isolated collaboration verification database');
  const first=await createDb({databaseUrl:url}),second=await createDb({databaseUrl:url}),third=await createDb({databaseUrl:url});
  try{
    const f=await collaborationFixture(first.db,30),b=new CollaborationService(second.db),c=new CollaborationService(third.db);
    const reservations=await Promise.allSettled([f.service.claim(f.id,f.giorgi.id,30,'independent-pool-a'),b.claim(f.id,f.nika.id,30,'independent-pool-b'),c.claim(f.id,f.mariam.id,30,'independent-pool-c')]);
    expect(reservations.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const claims=await rows(first.db,sql`select * from contribution_claims where bounty_id=${f.id}`);expect(claims).toHaveLength(1);
    await f.service.release(f.id,claims[0].user_id,claims[0].id);
    const sa=await f.submission(f.giorgi),sb=await f.submission(f.nika);
    await Promise.all([f.service.applyEvidence(f.id,sa.id,evidence('concurrent-postgres-photo',1),'pg-test',true),b.applyEvidence(f.id,sb.id,evidence('concurrent-postgres-photo',1),'pg-test',true)]);
    const snapshot=await c.snapshot(f.id,f.buyer.id);expect(snapshot.progress.accepted).toBe(1);expect(snapshot.progress.duplicates).toBe(1);
    const revision=snapshot.revision;
    await expect(b.locked(f.id,async tx=>{await b.event(tx,f.id,'SHARED_PLAN_UPDATED',{action:'must_rollback'},'crash-before-ack');throw Error('simulated worker crash');})).rejects.toThrow('simulated worker crash');
    expect((await f.service.snapshot(f.id,f.buyer.id)).revision).toBe(revision);
    expect(await rows(first.db,sql`select id from collaboration_events where bounty_id=${f.id} and idempotency_key='crash-before-ack'`)).toHaveLength(0);
    await c.applyEvidence(f.id,sa.id,evidence('concurrent-postgres-photo',1),'pg-test',true);
    expect((await b.snapshot(f.id,f.buyer.id)).progress.accepted).toBe(1);
    const cfg=loadConfig({NODE_ENV:'test',COLLABORATIVE_BOUNTIES_ENABLED:'1',JWT_SECRET:'isolated-collaboration-stream-secret-0000'});
    const app=Fastify({forceCloseConnections:true});
    app.addHook('onRequest',async req=>{const token=req.headers.authorization?.slice(7);if(token)req.session=await verifySession(cfg.JWT_SECRET,token)??undefined;});
    collaborationRoutes(app,{db:first.db,cfg} as AppContext);
    const address=await app.listen({host:'127.0.0.1',port:0});
    const token=await issueSession(cfg.JWT_SECRET,{accountId:f.buyer.id,wallet:f.buyer.wallet,roles:[]});
    const beforeStream=await f.service.snapshot(f.id,f.buyer.id),cursor=Number(beforeStream.events.at(-1)!.sequence);
    const controller=new AbortController();
    try{
      const response=await fetch(`${address}/bounties/${f.id}/events/stream?after=${cursor}`,{headers:{authorization:`Bearer ${token}`},signal:controller.signal});
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      await b.claim(f.id,f.mariam.id,1,'streamed-claim');
      const reader=response.body!.getReader(),decoder=new TextDecoder();let text='';
      const timer=setTimeout(()=>controller.abort(),8000);
      try{while(!text.includes('WORK_CLAIM_ACCEPTED')){const next=await reader.read();if(next.done)break;text+=decoder.decode(next.value);}}finally{clearTimeout(timer);controller.abort();await reader.cancel().catch(()=>{});}
      expect(text).toContain('WORK_CLAIM_ACCEPTED');
      const sequence=Number(text.match(/id: (\d+)/)?.[1]);expect(sequence).toBeGreaterThan(cursor);
      const replay=await c.snapshot(f.id,f.buyer.id,cursor);expect(replay.events.some(e=>Number(e.sequence)===sequence)).toBe(true);
    }finally{controller.abort();await app.close();}
  }finally{await Promise.all([first.close(),second.close(),third.close()]);}
});
