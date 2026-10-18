import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {sql} from 'drizzle-orm';
import {createDb,schema} from '../../apps/api/src/db/index.js';
import {loadConfig} from '../../apps/api/src/config.js';
import {ChainService} from '../../apps/api/src/chain.js';
import type {AppContext} from '../../apps/api/src/context.js';
import {CollaborationService,rows} from '../../apps/api/src/services/collaboration.js';
import {prepareCollaborationSettlement,assertCollaborationSettlementVersion,collaborationSettlementPlan} from '../../apps/api/src/services/collaboration-settlement.js';
import {collaborationFixture,evidence} from '../fixtures/collaboration.js';

let store:Awaited<ReturnType<typeof createDb>>,ctx:AppContext,f:Awaited<ReturnType<typeof collaborationFixture>>,manifest:any;
const cfg=loadConfig({NODE_ENV:'test',COLLABORATIVE_BOUNTIES_ENABLED:'1',PAYMENT_CURRENCY:'SOL'});
beforeAll(async()=>{
  store=await createDb({memory:true});f=await collaborationFixture(store.db,3);
  for(const [user,label] of [[f.giorgi,'g'],[f.nika,'n'],[f.mariam,'m']] as const){const s=await f.submission(user);await f.service.applyEvidence(f.id,s.id,evidence(label,1),'test',true);}
  manifest=await f.service.manifest(f.id,f.buyer.id,'SOL');
  const chain=new ChainService(cfg);vi.spyOn(chain.client,'order').mockResolvedValue(null);
  ctx={db:store.db,cfg,chain} as AppContext;
});
afterAll(async()=>store.close());
it('requires buyer approval and release of the original escrow, then creates one replay-safe designated contract per seller',async()=>{
  const deadline=new Date(Date.now()+86400000);
  await expect(prepareCollaborationSettlement(ctx,f.id,f.nika.id,manifest.hash,deadline)).rejects.toThrow('Buyer');
  vi.mocked(ctx.chain.client.order).mockResolvedValue({state:'funded'} as any);
  await expect(prepareCollaborationSettlement(ctx,f.id,f.buyer.id,manifest.hash,deadline)).rejects.toThrow('Cancel or refund');
  vi.mocked(ctx.chain.client.order).mockResolvedValue(null);
  const attempts=await Promise.all([prepareCollaborationSettlement(ctx,f.id,f.buyer.id,manifest.hash,deadline),prepareCollaborationSettlement(ctx,f.id,f.buyer.id,manifest.hash,deadline)]);
  expect(attempts.filter(r=>r.replayed)).toHaveLength(1);
  const plan=await collaborationSettlementPlan(ctx,f.id,f.buyer.id);expect(plan.orders).toHaveLength(3);
  expect(plan.orders.reduce((n,o)=>n+BigInt(o.onchain!.amount),0n)).toBe(500000000n);
  expect(new Set(plan.orders.map(o=>o.onchain!.designatedSeller))).toHaveLength(3);
  const sellerView=await collaborationSettlementPlan(ctx,f.id,f.nika.id);expect(sellerView.orders.every(o=>o.onchain===null)).toBe(true);
});
it('requires trusted final byte evidence and rejects substituted or duplicate bundle contents',async()=>{
  const [s]=await rows(store.db,sql`select * from collaboration_settlements where bounty_id=${f.id} and contributor_id=${f.giorgi.id}`);
  const bundle=await f.submission(f.giorgi,false);
  await store.db.insert(schema.assetFiles).values({versionId:bundle.version.id,path:'g/0.jpg',size:1,sha256:evidence('g',1)[0]!.sha256,mediaType:'image/jpeg',objectKey:'fixture-only'});
  await expect(assertCollaborationSettlementVersion(ctx,s.order_id,f.giorgi.id,bundle.version.id)).rejects.toThrow('Complete L2');
  await store.db.execute(sql`insert into collaboration_verifier_evidence(job_id,asset_version_id,evidence,complete) values(${bundle.job.id},${bundle.version.id},${JSON.stringify(evidence('g',1))}::jsonb,true)`);
  await expect(assertCollaborationSettlementVersion(ctx,s.order_id,f.giorgi.id,bundle.version.id)).resolves.toBeUndefined();
  await expect(assertCollaborationSettlementVersion(ctx,s.order_id,f.nika.id,bundle.version.id)).rejects.toThrow('allocated contributor');
  await store.db.execute(sql`update collaboration_verifier_evidence set evidence=${JSON.stringify(evidence('foreign',1))}::jsonb where job_id=${bundle.job.id}`);
  await expect(assertCollaborationSettlementVersion(ctx,s.order_id,f.giorgi.id,bundle.version.id)).rejects.toThrow('exactly');
});
