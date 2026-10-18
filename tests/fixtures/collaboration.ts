import { randomUUID,createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {PublicKey} from '@solana/web3.js';
import { schema,type Db } from '../../apps/api/src/db/index.js';
import { CollaborationService, type Evidence } from '../../apps/api/src/services/collaboration.js';

/** Isolated synthetic fixtures only. No signing keys, RPC, R2, billing or actual escrow funding. */
export async function collaborationFixture(db:Db,target=10000) {
  const address=()=>new PublicKey(createHash('sha256').update(randomUUID()).digest()).toBase58();
  const users=await db.insert(schema.accounts).values(['Buyer','Giorgi','Nika','Mariam','Outsider'].map(alias=>({alias,wallet:address()}))).returning();
  const [buyer,giorgi,nika,mariam,outsider]=users;
  const [order]=await db.insert(schema.orders).values({kind:'bounty',buyerId:buyer!.id,buyerWallet:buyer!.wallet,orderIdOnchain:1n,onchainAddress:address(),title:'Cat Image Collection',terms:{},termsHash:'0'.repeat(64),criteria:null,criteriaHash:'0'.repeat(64),licenseId:'demo',licenseHash:'0'.repeat(64),amountMicro:500000000n,chainState:'draft'}).returning();
  const service=new CollaborationService(db);
  await service.enable(order!.id,buyer!.id,target,86400,6);
  for(const user of [giorgi!,nika!,mariam!])await service.join(order!.id,user.id);
  async function submission(user:typeof users[number],attach=true) {
    const [a]=await db.insert(schema.assets).values({ownerId:user.id,kind:'dataset',name:'Demo photos',purpose:'submission'}).returning();
    const [v]=await db.insert(schema.assetVersions).values({assetId:a!.id,version:1,status:'finalized'}).returning();
    const [job]=await db.insert(schema.verificationJobs).values({kind:'standalone',assetVersionId:v!.id,requesterId:user.id,level:'L2',specHash:'demo',status:'completed',budget:{maxSpend:'0',maxSeconds:60,maxItems:20000,maxApiCalls:0}}).returning();
    const result=attach?await service.submit(order!.id,user.id,v!.id,job!.id,'Fixture declaration: synthetic metadata for isolated tests only.'):{submissionId:randomUUID()};
    return {id:result.submissionId,version:v!,job:job!};
  }
  return {db,service,id:order!.id,buyer:buyer!,giorgi:giorgi!,nika:nika!,mariam:mariam!,outsider:outsider!,submission};
}
export const evidence=(prefix:string,count:number):Evidence[]=>Array.from({length:count},(_,i)=>({path:`${prefix}/${i}.jpg`,sha256:createHash('sha256').update(`${prefix}:${i}`).digest('hex'),dhash:null,valid:true}));

export async function seedCatShortfall(db:Db) {
  const f=await collaborationFixture(db);
  const g=await f.submission(f.giorgi),n=await f.submission(f.nika),m=await f.submission(f.mariam);
  const first=evidence('giorgi',4000);
  await f.service.applyEvidence(f.id,g.id,first,'demo/1',true);
  await f.service.applyEvidence(f.id,n.id,[...evidence('nika',2700),...first.slice(0,300).map((e,i)=>({...e,path:`nika/duplicate-${i}.jpg`}))],'demo/1',true);
  await f.service.applyEvidence(f.id,m.id,evidence('mariam',3000),'demo/1',true);
  const before=await f.service.snapshot(f.id,f.buyer.id);
  // Reject stale suggestions from earlier partial batches. Request fresh proposals at the shortfall.
  for(const user of [f.giorgi,f.nika,f.mariam]) {
    for(const proposal of before.proposals.filter(p=>p.userId===user.id))await f.service.respond(f.id,user.id,proposal.id,false);
  }
  await f.service.locked(f.id,async(tx,b)=>f.service.coordinate(tx,b,'demo-9700'));
  return {f,before};
}
export async function runCatDemo(db:Db) {
  const {f,before}=await seedCatShortfall(db);
  const plan=await f.service.snapshot(f.id,f.mariam.id);
  const offer=plan.proposals.find(p=>p.userId===f.mariam.id)!;
  await f.service.respond(f.id,f.mariam.id,offer.id,true,300);
  const replacement=await f.submission(f.mariam);
  await f.service.applyEvidence(f.id,replacement.id,evidence('mariam-replacement',300),'demo/1',true);
  const after=await f.service.snapshot(f.id,f.buyer.id);
  const manifest=await f.service.manifest(f.id,f.buyer.id,'USDC');
  return {fixture:f,before,after,manifest};
}
