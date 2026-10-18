import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../db/index.js';
import { allocateReward,CollaborationService,nearDuplicate,PerceptualIndex,ProposalOutput,payoutDigest,rows } from './collaboration.js';
import { collaborationFixture,evidence,runCatDemo } from '../../../../tests/fixtures/collaboration.js';
import { drainCollaboration } from './collaboration-worker.js';
import { loadConfig } from '../config.js';

describe('collaborative bounty coordinator',()=>{
  let store:Awaited<ReturnType<typeof createDb>>;
  beforeAll(async()=>{store=await createDb({memory:true});});
  afterAll(async()=>store?.close());
  it('validates provider output and handles near-duplicate boundaries conservatively',()=>{
    expect(ProposalOutput.safeParse({count:300,explanation:'Offer work',transferFunds:true}).success).toBe(false);
    expect(ProposalOutput.safeParse({count:-1,explanation:'bad'}).success).toBe(false);
    expect(nearDuplicate('0000000000000000','000000000000003f',6)).toBe(true);
    expect(nearDuplicate('0000000000000000','000000000000007f',6)).toBe(false);
    expect(()=>nearDuplicate('invalid','0',6)).toThrow();
    for(const threshold of [0,1,6,16]){
      const index=new PerceptualIndex(threshold);index.add('0000000000000000');
      const value=((1n<<BigInt(threshold))-1n).toString(16).padStart(16,'0');
      expect(index.hasNear(value)).toBe(true);
    }
  });
  it('allocates exact base units with stable rounding and does not deduct fees',()=>{
    const cs=[{userId:'g',wallet:'g',count:4000},{userId:'n',wallet:'n',count:2700},{userId:'m',wallet:'m',count:3300}];
    expect(allocateReward(500000000n,cs).map(c=>c.grossMicro)).toEqual(['200000000','135000000','165000000']);
    expect(allocateReward(2n,[{userId:'b',wallet:'b',count:1},{userId:'a',wallet:'a',count:1},{userId:'c',wallet:'c',count:1}]).map(c=>c.grossMicro)).toEqual(['1','1','0']);
  });
  it('runs the 10,300 item multiplayer example with 9,700 and 10,000 checkpoints',async()=>{
    const {before,after,manifest,fixture:f}=await runCatDemo(store.db);
    expect(before.progress.accepted).toBe(9700);expect(before.progress.remaining).toBe(300);expect(before.progress.percent).toBe(97);
    expect(before.progress.duplicates).toBe(300);
    expect(after.progress.accepted).toBe(10000);
    const allocations=Object.fromEntries(manifest.allocations.map((a:any)=>[a.userId,a.grossMicro]));
    expect(allocations).toEqual({[f.giorgi.id]:'200000000',[f.nika.id]:'135000000',[f.mariam.id]:'165000000'});
    expect(before.events.some(e=>e.type==='DUPLICATES_DETECTED')).toBe(true);
    expect(after.events.some(e=>e.type==='BOUNTY_TARGET_REACHED')).toBe(true);
    expect(manifest.settlementStatus).toContain('blocked');
    const repeated=await Promise.all([f.service.manifest(f.id,f.buyer.id,'USDC'),f.service.manifest(f.id,f.buyer.id,'USDC')]);
    expect(repeated[0].hash).toBe(repeated[1].hash);
    const {hash,...persisted}=repeated[0];expect(payoutDigest(persisted)).toBe(hash);
    await expect(f.service.claim(f.id,f.giorgi.id,1,'after-freeze')).rejects.toThrow('frozen');
  });
  it('serializes competing claims, approval races, replay and expiration',async()=>{
    const f=await collaborationFixture(store.db,300);
    const attempts=await Promise.allSettled([f.service.claim(f.id,f.giorgi.id,300,'claim-first'),f.service.claim(f.id,f.nika.id,300,'claim-second')]);
    expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const view=await f.service.snapshot(f.id,f.buyer.id);expect(view.claims).toHaveLength(1);
    const owner=view.claims[0].userId;
    const key=owner===f.giorgi.id?'claim-first':'claim-second';
    await f.service.claim(f.id,owner,300,key);
    await expect(f.service.claim(f.id,owner,2,key)).rejects.toThrow('different');
    await store.db.execute(sql`update contribution_claims set expires_at=now()-interval '1 second' where bounty_id=${f.id}`);
    expect((await f.service.snapshot(f.id,f.buyer.id)).claims).toHaveLength(0);
    const s=await f.submission(f.giorgi);
    await f.service.applyEvidence(f.id,s.id,evidence('shortfall',1),'test',true);
    const plan=await f.service.snapshot(f.id,f.nika.id),proposal=plan.proposals.find(p=>p.userId===f.nika.id)!;
    const approvals=await Promise.allSettled([f.service.respond(f.id,f.nika.id,proposal.id,true),f.service.respond(f.id,f.nika.id,proposal.id,true)]);
    expect(approvals.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  });
  it('deduplicates simultaneous submissions and repeated event delivery across restarts',async()=>{
    const f=await collaborationFixture(store.db,10),a=await f.submission(f.giorgi),b=await f.submission(f.nika);
    const item=evidence('same-photo',1);
    await Promise.all([f.service.applyEvidence(f.id,a.id,item,'test',true),f.service.applyEvidence(f.id,b.id,item,'test',true)]);
    const restored=new CollaborationService(store.db);
    await restored.applyEvidence(f.id,a.id,item,'test',true);
    const p=(await restored.snapshot(f.id,f.buyer.id)).progress;
    expect(p.accepted).toBe(1);expect(p.duplicates).toBe(1);
    const events=await rows(store.db,sql`select * from collaboration_events where bounty_id=${f.id} and event_type='VERIFICATION_COMPLETED'`);
    expect(events).toHaveLength(2);
  });
  it('keeps near matches in review, supports invalidation, and enforces isolation',async()=>{
    const f=await collaborationFixture(store.db,10),a=await f.submission(f.giorgi),b=await f.submission(f.nika);
    await f.service.applyEvidence(f.id,a.id,evidence('original',1).map(e=>({...e,dhash:'0000000000000000'})),'test',true);
    await f.service.applyEvidence(f.id,b.id,evidence('compressed',1).map(e=>({...e,dhash:'000000000000003f'})),'test',true);
    let view=await f.service.snapshot(f.id,f.buyer.id);expect(view.progress.accepted).toBe(1);expect(view.progress.pending).toBe(1);
    await expect(f.service.snapshot(f.id,f.outsider.id)).rejects.toThrow('Join');
    await expect(f.service.manifest(f.id,f.nika.id,'USDC')).rejects.toThrow('Buyer');
    const [item]=await rows(store.db,sql`select id from submission_items where bounty_id=${f.id} and verification_status='review'`);
    await expect(f.service.review(f.id,f.nika.id,item.id,true,'Self approval is forbidden')).rejects.toThrow('Buyer');
    await f.service.review(f.id,f.buyer.id,item.id,true,'Reviewed as a distinct legitimate photograph');
    await f.service.review(f.id,f.buyer.id,item.id,false,'Later invalidated for incorrect licensing');
    view=await f.service.snapshot(f.id,f.buyer.id);expect(view.progress.accepted).toBe(1);expect(view.progress.rejected).toBe(1);
    const encoded=JSON.stringify(view);expect(encoded).not.toContain('exact_hash');expect(encoded).not.toContain('objectKey');
  });
  it('releases unused reservations on leave and recovers trusted evidence after worker restart',async()=>{
    const f=await collaborationFixture(store.db,10),s=await f.submission(f.giorgi);
    await f.service.claim(f.id,f.giorgi.id,5,'partial-fulfill');
    await store.db.execute(sql`insert into collaboration_verifier_evidence(job_id,asset_version_id,evidence,complete) values(${s.job.id},${s.version.id},${JSON.stringify(evidence('trusted',2))}::jsonb,true)`);
    const ctx={db:store.db,cfg:loadConfig({COLLABORATIVE_BOUNTIES_ENABLED:'1'})};
    await drainCollaboration(ctx);await drainCollaboration(ctx);
    const view=await f.service.snapshot(f.id,f.buyer.id);
    expect(view.progress.accepted).toBe(0);expect(view.progress.pending).toBe(2); // relevance/license review required
    const [claim]=await rows(store.db,sql`select * from contribution_claims where bounty_id=${f.id}`);
    await expect(f.service.release(f.id,f.nika.id,claim.id)).rejects.toThrow('not found');
    await f.service.leave(f.id,f.giorgi.id);
    expect((await f.service.snapshot(f.id,f.buyer.id)).claims).toHaveLength(0);
    await expect(f.service.snapshot(f.id,f.giorgi.id)).rejects.toThrow('Join');
  });
  it('reconciles partial fulfillment and invalidation without attributing older accepted work to a new claim',async()=>{
    const f=await collaborationFixture(store.db,10),a=await f.submission(f.giorgi);
    await f.service.applyEvidence(f.id,a.id,evidence('already-accepted',2),'test',true);
    const claim=await f.service.claim(f.id,f.giorgi.id,5,'new-five-claim');
    // Ensure the fixture's first acceptance predates the claim even on a coarse clock.
    await store.db.execute(sql`update submission_items set accepted_at=now()-interval '1 minute' where bounty_id=${f.id}`);
    const b=await f.submission(f.giorgi);
    await f.service.applyEvidence(f.id,b.id,evidence('new-contribution',2),'test',true);
    let [row]=await rows(store.db,sql`select * from contribution_claims where id=${claim.id}`);
    expect(row.accepted_count).toBe(2);expect(row.status).toBe('active');
    const [item]=await rows(store.db,sql`select id from submission_items where submission_id=${b.id} limit 1`);
    await f.service.review(f.id,f.buyer.id,item.id,false,'Invalidated after provenance review');
    [row]=await rows(store.db,sql`select * from contribution_claims where id=${claim.id}`);expect(row.accepted_count).toBe(1);
    await f.service.release(f.id,f.giorgi.id,claim.id);
    expect((await f.service.snapshot(f.id,f.buyer.id)).claims).toHaveLength(0);
  });
});
