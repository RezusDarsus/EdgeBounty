import { sql } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { CollaborationService, rows } from './collaboration.js';

/** Persistent inbox is the pending submission joined to completed trusted verification evidence.
 * Crash before commit retries everything; after commit status prevents repeated contribution counting.
 */
export async function drainCollaboration(ctx: Pick<AppContext,'db'|'cfg'>) {
  if(ctx.cfg.COLLABORATIVE_BOUNTIES_ENABLED!=='1') return;
  const service=new CollaborationService(ctx.db);
  const submissions=await rows(ctx.db,sql`select s.*,j.status as job_status,e.evidence,e.complete,j.policy_version
    from collaboration_submissions s join verification_jobs j on j.id=s.verification_job_id
    left join lateral (
      select e.* from collaboration_verifier_evidence e join verification_jobs original on original.id=e.job_id
      where e.asset_version_id=s.asset_version_id and original.spec_hash=j.spec_hash and original.policy_version=j.policy_version
      and original.status='completed' order by e.created_at desc limit 1
    ) e on true where s.status='pending' order by s.created_at,s.id limit 20`);
  for(const s of submissions) {
    if(s.job_status==='completed'&&s.evidence&&s.complete) {
      // Existing AI relevance is sampled and licensing is unverified. Buyer file review remains required.
      await service.applyEvidence(s.bounty_id,s.id,s.evidence,s.policy_version||'dataset-validator/1',false);
    } else if(['failed','cancelled'].includes(s.job_status)) {
      await service.locked(s.bounty_id,async(tx)=>{
        await tx.execute(sql`update collaboration_submissions set status='verification_failed' where id=${s.id} and status='pending'`);
        await service.event(tx,s.bounty_id,'VERIFICATION_COMPLETED',{submissionId:s.id,status:'failed',retryRequired:true},`failed:${s.id}`,s.contributor_id);
      });
    }
  }
  await ctx.db.execute(sql`update contribution_claims set status='expired' where status='active' and expires_at<=now()`);
}
