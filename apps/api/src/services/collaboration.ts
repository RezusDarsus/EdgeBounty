import { randomUUID, createHash } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { canonicalJson } from '@edgebounty/verification-schemas';
import {PublicKey} from '@solana/web3.js';
import type { Db } from '../db/index.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/http.js';

type Executor = Pick<Db, 'execute'>;
/** A PDA of this existing program cannot sign accept_bounty externally; no instruction in the
 * program signs for this namespace. The parent therefore remains cancellable until split funding.
 */
export function collaborationReservation(program:PublicKey,buyer:string,orderId:bigint){const id=Buffer.alloc(8);id.writeBigUInt64LE(orderId);return PublicKey.findProgramAddressSync([Buffer.from('collaboration-reserve'),new PublicKey(buyer).toBuffer(),id],program)[0].toBase58();}
export async function rows<T = any>(db: Executor, query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return ((result as any).rows ?? result) as T[];
}
export const ProposalOutput = z.object({ count: z.number().int().positive().max(1000000), explanation: z.string().max(1000) }).strict();
/** Providers receive only aggregate counts. They have no database, storage, signing or approval tools. */
export interface CollaborationProvider {
  propose(summary: { remaining: number; ownAccepted: number; ownDuplicates: number }): Promise<unknown>;
}
export const deterministicProvider: CollaborationProvider = {
  async propose(s) { return { count: Math.min(s.remaining, s.ownDuplicates || s.remaining), explanation: s.ownDuplicates ? 'Replace duplicate contributions; approval required.' : 'Offer additional unique photographs; approval required.' }; },
};
export const ItemEvidence = z.object({
  path: z.string().min(1).max(1000), sha256: z.string().regex(/^[0-9a-f]{64}$/),
  dhash: z.string().regex(/^[0-9a-f]{16}$/).nullable(), valid: z.boolean(),
}).strict();
export type Evidence = z.infer<typeof ItemEvidence>;
export const payoutDigest=(payload:unknown)=>createHash('sha256').update('edgebounty.collaboration-payout/1\0').update(canonicalJson(payload)).digest('hex');
export function nearDuplicate(a: string, b: string, threshold: number): boolean {
  if (!/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b) || !Number.isInteger(threshold) || threshold < 0 || threshold > 16) throw badRequest('Invalid perceptual hash or threshold');
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), bits = 0;
  while (x) { x &= x - 1n; bits++; }
  return bits <= threshold;
}
/** Pigeonhole bands: <=t differing bits guarantee at least one equal band among t+1.
 * This is an exact candidate filter, not a probabilistic similarity decision.
 */
export class PerceptualIndex {
  private bands=new Map<string,Set<string>>();
  constructor(readonly threshold:number){if(!Number.isInteger(threshold)||threshold<0||threshold>16)throw badRequest('Invalid threshold');}
  private keys(hash:string){
    if(!/^[0-9a-f]{16}$/.test(hash))throw badRequest('Invalid perceptual hash');
    const bits=BigInt(`0x${hash}`).toString(2).padStart(64,'0');
    return Array.from({length:this.threshold+1},(_,i)=>`${i}:${bits.slice(Math.floor(i*64/(this.threshold+1)),Math.floor((i+1)*64/(this.threshold+1)))}`);
  }
  add(hash:string){for(const key of this.keys(hash)){const values=this.bands.get(key)??new Set<string>();values.add(hash);this.bands.set(key,values);}}
  hasNear(hash:string){const candidates=new Set(this.keys(hash).flatMap(k=>[...(this.bands.get(k)??[])]));return [...candidates].some(value=>nearDuplicate(hash,value,this.threshold));}
}
/** Largest remainder allocation, exact base units, stable tie-breaking. No commission or expense assumptions. */
export function allocateReward(budget: bigint, contributors: { userId: string; count: number; wallet: string }[]) {
  if (budget < 0n || contributors.some(c => !Number.isSafeInteger(c.count) || c.count < 0) || new Set(contributors.map(c => c.userId)).size !== contributors.length) throw badRequest('Invalid allocation');
  const total = contributors.reduce((n,c) => n + BigInt(c.count), 0n);
  if (!total) throw conflict('No accepted contributions');
  const result = contributors.map(c => ({ ...c, gross: budget * BigInt(c.count) / total, remainder: budget * BigInt(c.count) % total }));
  let left = budget - result.reduce((n,c) => n+c.gross, 0n);
  for (const c of [...result].sort((a,b) => a.remainder === b.remainder ? a.userId.localeCompare(b.userId) : a.remainder > b.remainder ? -1 : 1)) { if (left-- > 0n) c.gross++; }
  return result.map(({remainder, gross, ...c}) => ({ ...c, grossMicro: gross.toString() }));
}

export class CollaborationService {
  constructor(readonly db: Db) {}
  /** All mutations lock the same parent row, including duplicate ownership, claims and manifest freeze. */
  async locked<T>(id: string, fn: (tx: Executor, bounty: any) => Promise<T>): Promise<T> {
    return this.db.transaction(async tx => {
      const [b] = await rows(tx, sql`select c.*,o.buyer_id,o.amount_micro,o.title,o.chain_state,o.terms_hash,o.criteria_hash,o.license_hash,o.onchain_address from collaborative_bounties c join orders o on o.id=c.bounty_id where c.bounty_id=${id} for update of c`);
      if (!b) throw notFound('collaborative bounty');
      await tx.execute(sql`update contribution_claims set status='expired' where bounty_id=${id} and status='active' and expires_at<=now()`);
      return fn(tx,b);
    });
  }
  async member(db: Executor, id: string, user: string, buyer?: string) {
    if (user === buyer) return;
    const [m] = await rows(db, sql`select 1 from bounty_collaborators where bounty_id=${id} and user_id=${user} and status='active'`);
    if (!m) throw forbidden('Join this workspace first');
  }
  async event(tx: Executor, id: string, type: string, payload: unknown, key: string, actor: string | null = null, agent: string | null = null, correlation = randomUUID()) {
    const inserted=await rows(tx,sql`insert into collaboration_events(bounty_id,event_type,payload,idempotency_key,actor_user_id,agent_id,correlation_id)
      values(${id},${type},${JSON.stringify(payload)}::jsonb,${key},${actor},${agent},${correlation}) on conflict(bounty_id,idempotency_key) do nothing returning id`);
    if(inserted.length)await tx.execute(sql`update collaborative_bounties set revision=revision+1 where bounty_id=${id}`);
  }
  async enable(id: string, user: string, target: number, ttl: number, threshold: number,expectedReservation?:string) {
    return this.db.transaction(async tx => {
      const [o] = await rows(tx, sql`select * from orders where id=${id} for update`);
      if (!o) throw notFound('bounty');
      if (o.buyer_id!==user) throw forbidden();
      if (o.kind!=='bounty' || o.seller_id || !['draft','funded'].includes(o.chain_state)) throw conflict('Only unassigned bounties may opt in');
      if(o.chain_state==='funded'&&(!expectedReservation||o.designated_seller!==expectedReservation))throw conflict('Create a collaborative request before funding so the original escrow remains reserved and cancellable');
      const [prior]=await rows(tx,sql`select target,claim_ttl_seconds,near_threshold from collaborative_bounties where bounty_id=${id}`);
      if(prior&&(prior.target!==target||prior.claim_ttl_seconds!==ttl||prior.near_threshold!==threshold))throw conflict('Collaboration requirements are already fixed for this bounty');
      await tx.execute(sql`insert into collaborative_bounties(bounty_id,target,claim_ttl_seconds,near_threshold) values(${id},${target},${ttl},${threshold}) on conflict do nothing`);
      return { enabled:true };
    });
  }
  async join(id: string, user: string) {
    return this.locked(id, async (tx,b) => {
      if (b.manifest) throw conflict('Accounting is frozen');
      if (user===b.buyer_id) throw conflict('Buyer cannot contribute to their own bounty');
      // Private orders remain invitation-only until an invitation workflow exists.
      const [o] = await rows(tx,sql`select public from orders where id=${id}`);
      if (!o.public) {
        const [invitation]=await rows(tx,sql`select 1 from collaboration_invitations where bounty_id=${id} and user_id=${user}`);
        if(!invitation)throw forbidden('Private collaborations require invitations');
      }
      await tx.execute(sql`insert into bounty_collaborators(bounty_id,user_id) values(${id},${user}) on conflict(bounty_id,user_id) do update set status='active'`);
      const [agent] = await rows(tx,sql`insert into seller_agents(bounty_id,owner_user_id) values(${id},${user}) on conflict(bounty_id,owner_user_id) do update set status='observing' returning id`);
      await this.event(tx,id,'SHARED_PLAN_UPDATED',{ action:'joined',userId:user },`join:${agent.id}`,user,agent.id);
      return { agentId:agent.id };
    });
  }
  async invite(id:string,buyer:string,user:string) {
    return this.locked(id,async(tx,b)=>{
      if(b.buyer_id!==buyer)throw forbidden('Only the buyer can invite collaborators');
      if(b.manifest)throw conflict('Accounting is frozen');
      const [account]=await rows(tx,sql`select id from accounts where id=${user} and deleted_at is null`);
      if(!account)throw notFound('account');
      await tx.execute(sql`insert into collaboration_invitations(bounty_id,user_id,invited_by) values(${id},${user},${buyer}) on conflict do nothing`);
      return {invited:true};
    });
  }
  async reviewAccess(id:string,user:string,submission:string,granted:boolean) {
    return this.locked(id,async(tx)=>{
      const [s]=await rows(tx,sql`select * from collaboration_submissions where id=${submission} and bounty_id=${id} and contributor_id=${user}`);
      if(!s)throw notFound('own submission');
      if(s.status==='withdrawn')throw conflict('Submission was withdrawn');
      await tx.execute(sql`update collaboration_submissions set review_access_granted=${granted},review_access_updated_at=now() where id=${submission}`);
      await this.event(tx,id,'SHARED_PLAN_UPDATED',{action:granted?'review_access_granted':'review_access_revoked',submissionId:submission},`review-access:${randomUUID()}`,user);
      return {granted};
    });
  }
  async withdraw(id:string,user:string,submission:string) {
    return this.locked(id,async(tx,b)=>{
      if(b.manifest)throw conflict('Accounting is frozen; use the dispute pathway');
      const [s]=await rows(tx,sql`select * from collaboration_submissions where id=${submission} and bounty_id=${id} and contributor_id=${user}`);
      if(!s)throw notFound('own submission');
      if(s.status==='withdrawn')return {withdrawn:true};
      await tx.execute(sql`update collaboration_submissions set status='withdrawn',review_access_granted=false where id=${submission}`);
      await tx.execute(sql`update submission_items set verification_status='invalidated',accepted_at=null where submission_id=${submission}`);
      await this.reconcileClaims(tx,id,user);
      await this.event(tx,id,'SHARED_PLAN_UPDATED',{action:'submission_withdrawn',submissionId:submission},`withdrawn:${submission}`,user);
      await this.coordinate(tx,b,`withdrawn:${submission}`);
      return {withdrawn:true};
    });
  }
  async progress(db: Executor, id: string, target: number) {
    const stats = await rows(db,sql`select contributor_id as "userId",count(*)::int as submitted,
      count(*) filter(where verification_status='accepted')::int as accepted,
      count(*) filter(where verification_status='duplicate')::int as duplicates,
      count(*) filter(where verification_status in ('rejected','invalidated'))::int as rejected,
      count(*) filter(where verification_status in ('pending','review'))::int as pending
      from submission_items where bounty_id=${id} group by contributor_id`);
    const totals = stats.reduce((s,c) => { for (const k of ['submitted','accepted','duplicates','rejected','pending']) s[k]+=c[k]; return s; },{submitted:0,accepted:0,duplicates:0,rejected:0,pending:0});
    const queued = await rows(db,sql`select s.contributor_id as "userId",coalesce(sum(v.file_count),0)::int as count from collaboration_submissions s join asset_versions v on v.id=s.asset_version_id where s.bounty_id=${id} and s.status='pending' group by s.contributor_id`);
    for(const q of queued){const seller=stats.find(c=>c.userId===q.userId);if(seller){seller.pending+=q.count;seller.submitted+=q.count;}else stats.push({userId:q.userId,submitted:q.count,accepted:0,duplicates:0,rejected:0,pending:q.count});totals.pending+=q.count;totals.submitted+=q.count;}
    return { target,...totals,remaining:Math.max(0,target-totals.accepted),percent:Math.min(100,totals.accepted/target*100),contributors:stats };
  }
  async snapshot(id: string, user: string, after = 0, limit = 100, recent = false) {
    return this.locked(id,async (tx,b) => {
      await this.member(tx,id,user,b.buyer_id);
      const progress=await this.progress(tx,id,b.target);
      const contributors=await rows(tx,sql`select m.user_id as "userId",a.alias as name,g.id as "agentId",g.status as "agentStatus",m.status from bounty_collaborators m join accounts a on a.id=m.user_id join seller_agents g on g.bounty_id=m.bounty_id and g.owner_user_id=m.user_id where m.bounty_id=${id} order by m.joined_at,m.id`);
      const claims=await rows(tx,sql`select id,user_id as "userId",reserved_count as "reservedCount",accepted_count as "acceptedCount",status,expires_at as "expiresAt" from contribution_claims where bounty_id=${id} and status='active' order by expires_at,id limit 200`);
      const proposals=await rows(tx,sql`select id,user_id as "userId",agent_id as "agentId",proposal_type as type,proposed_count as count,status from agent_proposals where bounty_id=${id} and status='pending' order by created_at,id limit 200`);
      const events=await rows(tx,sql`select sequence::text,id,agent_id as "agentId",actor_user_id as "actorUserId",event_type as type,payload,created_at as "createdAt",correlation_id as "correlationId",processing_status as status,visibility from collaboration_events where bounty_id=${id} and sequence>${after} and (visibility='workspace' or actor_user_id=${user}) order by collaboration_events.sequence ${recent?sql`desc`:sql`asc`} limit ${limit}`);
      if(recent)events.reverse();
      return { bountyId:id,title:b.title,buyerId:b.buyer_id,revision:b.revision,progress,contributors:contributors.map(c=>({...c,...progress.contributors.find((p: any)=>p.userId===c.userId)})),claims,proposals,events,
        escrowStatus:b.chain_state,escrowAddress:b.onchain_address,rewardMicro:String(b.amount_micro),manifest:b.manifest,settlementSupported:true,
        workPlan:[`${progress.remaining} accepted unique images needed`,...claims.map(c=>`${c.reservedCount-c.acceptedCount} items reserved until ${new Date(c.expiresAt).toISOString()}`),'Review flagged images and obtain buyer final approval'] };
    });
  }
  async reserve(tx: Executor, b: any, user: string, count: number, key: string) {
    if (b.manifest) throw conflict('Accounting is frozen');
    const [prior] = await rows(tx,sql`select * from contribution_claims where bounty_id=${b.bounty_id} and user_id=${user} and idempotency_key=${key}`);
    if (prior) { if (prior.proposed_count!==count) throw conflict('Idempotency key already used with different count'); return prior; }
    const p=await this.progress(tx,b.bounty_id,b.target);
    const [reserved]=await rows(tx,sql`select coalesce(sum(reserved_count-accepted_count),0)::int as count from contribution_claims where bounty_id=${b.bounty_id} and status='active'`);
    if(count>p.remaining-reserved.count) throw conflict('Remaining work is already reserved; reduce the claim');
    const [claim]=await rows(tx,sql`insert into contribution_claims(bounty_id,user_id,proposed_count,reserved_count,status,expires_at,idempotency_key)
      values(${b.bounty_id},${user},${count},${count},'active',now()+${b.claim_ttl_seconds}*interval '1 second',${key}) returning *`);
    await this.event(tx,b.bounty_id,'WORK_CLAIM_ACCEPTED',{ claimId:claim.id,userId:user,count },`claim:${claim.id}`,user);
    return claim;
  }
  async claim(id: string,user: string,count: number,key: string) {
    return this.locked(id,async(tx,b)=>{await this.member(tx,id,user); return this.reserve(tx,b,user,count,key);});
  }
  async reconcileClaims(tx: Executor,id: string,user: string) {
    const claims=await rows(tx,sql`select * from contribution_claims where bounty_id=${id} and user_id=${user} and status in ('active','fulfilled') order by created_at,id`);
    const items=await rows(tx,sql`select accepted_at from submission_items where bounty_id=${id} and contributor_id=${user} and verification_status='accepted' order by accepted_at,id`);
    for(const c of claims)c.fulfilled=0;
    for(const item of items){
      const when=new Date(item.accepted_at).getTime();
      const claim=claims.find(c=>c.fulfilled<c.reserved_count&&new Date(c.created_at).getTime()<=when&&new Date(c.expires_at).getTime()>=when);
      if(claim)claim.fulfilled++;
    }
    for(const c of claims)await tx.execute(sql`update contribution_claims set accepted_count=${c.fulfilled},status=${c.fulfilled===c.reserved_count?'fulfilled':new Date(c.expires_at).getTime()<=Date.now()?'expired':'active'} where id=${c.id}`);
  }
  async release(id: string,user: string,claim: string) {
    return this.locked(id,async(tx,b)=>{
      await this.member(tx,id,user);
      const [c]=await rows(tx,sql`select * from contribution_claims where id=${claim} and bounty_id=${id} and user_id=${user}`);
      if(!c) throw notFound('own claim');
      await tx.execute(sql`update contribution_claims set status='released' where id=${claim} and status='active'`);
      await this.event(tx,id,'SHARED_PLAN_UPDATED',{action:'claim_released',claimId:claim},`release:${claim}`,user);
      return {released:true};
    });
  }
  async leave(id: string,user: string) {
    return this.locked(id,async tx=>{
      await this.member(tx,id,user);
      await tx.execute(sql`update bounty_collaborators set status='left' where bounty_id=${id} and user_id=${user}`);
      await tx.execute(sql`update contribution_claims set status='released' where bounty_id=${id} and user_id=${user} and status='active'`);
      await tx.execute(sql`update seller_agents set status='paused' where bounty_id=${id} and owner_user_id=${user}`);
      await tx.execute(sql`update agent_proposals set status='rejected',resolved_at=now() where bounty_id=${id} and user_id=${user} and status='pending'`);
      await this.event(tx,id,'SHARED_PLAN_UPDATED',{action:'left',userId:user},`leave:${user}:${randomUUID()}`,user);
      return {left:true};
    });
  }
  /** Event-driven fan-out: every scoped seller agent observes the same committed verification summary. */
  async coordinate(tx: Executor,b: any,source: string) {
    const p=await this.progress(tx,b.bounty_id,b.target);
    await this.event(tx,b.bounty_id,p.remaining?'WORK_SHORTFALL_DETECTED':'BOUNTY_TARGET_REACHED',{accepted:p.accepted,remaining:p.remaining},`shortfall:${source}`);
    if(!p.remaining) {
      await tx.execute(sql`update agent_proposals set status='rejected',resolved_at=now() where bounty_id=${b.bounty_id} and status='pending'`);
      await tx.execute(sql`update contribution_claims set status='released' where bounty_id=${b.bounty_id} and status='active'`);
      await this.event(tx,b.bounty_id,'SHARED_PLAN_UPDATED',{remaining:0,finalApprovalRequired:true},`plan:${source}`);
      return;
    }
    const agents=await rows(tx,sql`select g.* from seller_agents g join bounty_collaborators m on m.bounty_id=g.bounty_id and m.user_id=g.owner_user_id where g.bounty_id=${b.bounty_id} and m.status='active' order by g.id`);
    for(const agent of agents) {
      const own=p.contributors.find((c: any)=>c.userId===agent.owner_user_id);
      const output=ProposalOutput.parse(await deterministicProvider.propose({remaining:p.remaining,ownAccepted:own?.accepted??0,ownDuplicates:own?.duplicates??0}));
      // One unresolved proposal per agent; no inference loops or implicit user commitments.
      const [pending]=await rows(tx,sql`select id from agent_proposals where agent_id=${agent.id} and status='pending'`);
      if(pending) {
        await tx.execute(sql`update agent_proposals set proposed_count=${output.count},proposal_type=${own?.duplicates?'REPLACEMENT_REQUESTED':'WORK_OFFERED'} where id=${pending.id}`);
        continue;
      }
      const [proposal]=await rows(tx,sql`insert into agent_proposals(bounty_id,agent_id,user_id,proposal_type,proposed_count,source_key)
        values(${b.bounty_id},${agent.id},${agent.owner_user_id},${own?.duplicates?'REPLACEMENT_REQUESTED':'WORK_OFFERED'},${output.count},${source}) on conflict do nothing returning id`);
      if(proposal) await this.event(tx,b.bounty_id,own?.duplicates?'REPLACEMENT_REQUESTED':'WORK_OFFERED',{proposalId:proposal.id,count:output.count,explanation:output.explanation},`proposal:${proposal.id}`,agent.owner_user_id,agent.id);
    }
    await this.event(tx,b.bounty_id,'SHARED_PLAN_UPDATED',{remaining:p.remaining,approvalRequired:true},`plan:${source}`);
  }
  async respond(id: string,user: string,proposalId: string,accept: boolean,count?: number) {
    return this.locked(id,async(tx,b)=>{
      await this.member(tx,id,user);
      const [p]=await rows(tx,sql`select * from agent_proposals where id=${proposalId} and bounty_id=${id} and user_id=${user}`);
      if(!p) throw notFound('own proposal');
      if(p.status!=='pending') throw conflict('Proposal already resolved');
      if(accept)await this.event(tx,id,'WORK_CLAIM_PROPOSED',{proposalId,count:count??p.proposed_count},`claim-proposed:${proposalId}`,user,p.agent_id);
      const claim=accept?await this.reserve(tx,b,user,count??p.proposed_count,`proposal:${proposalId}`):null;
      await tx.execute(sql`update agent_proposals set status=${accept?'accepted':'rejected'},approved_by=${user},resolved_at=now() where id=${proposalId}`);
      await this.event(tx,id,accept?'SHARED_PLAN_UPDATED':'WORK_CLAIM_REJECTED',{proposalId,claimId:claim?.id??null},`response:${proposalId}`,user,p.agent_id);
      return {claim};
    });
  }
  async submit(id: string,user: string,versionId: string,jobId: string,license: string,reviewAccess=false) {
    return this.locked(id,async(tx,b)=>{
      await this.member(tx,id,user);
      if(b.manifest) throw conflict('Accounting is frozen');
      const [v]=await rows(tx,sql`select v.* from asset_versions v join assets a on a.id=v.asset_id where v.id=${versionId} and a.owner_id=${user} and a.deleted_at is null and a.kind='dataset' and a.purpose='submission' and v.status='finalized'`);
      if(!v) throw forbidden('A finalized, owned submission dataset is required');
      // Criteria binding prevents borrowing a cheaper unrelated verification pass.
      const [j]=await rows(tx,sql`select j.* from verification_jobs j join orders o on o.id=${id} where j.id=${jobId} and j.asset_version_id=${versionId} and j.requester_id=${user} and j.criteria is not distinct from o.criteria and j.level in ('L2','L3') and j.status not in ('failed','cancelled')`);
      if(!j) throw badRequest('Use an authorized L2/L3 verification job with this bounty\'s exact criteria');
      const [prior]=await rows(tx,sql`select * from collaboration_submissions where bounty_id=${id} and asset_version_id=${versionId}`);
      if(prior) {
        if(prior.status==='verification_failed'&&prior.verification_job_id!==jobId) await tx.execute(sql`update collaboration_submissions set verification_job_id=${jobId},status='pending' where id=${prior.id}`);
        return {submissionId:prior.id};
      }
      const [s]=await rows(tx,sql`insert into collaboration_submissions(bounty_id,contributor_id,asset_version_id,verification_job_id,license_declaration,review_access_granted,review_access_updated_at) values(${id},${user},${versionId},${jobId},${license},${reviewAccess},${reviewAccess?new Date():null}) returning id`);
      await this.event(tx,id,'SHARED_PLAN_UPDATED',{action:'submission_pending',submissionId:s.id},`submitted:${s.id}:${jobId}`,user);
      return {submissionId:s.id};
    });
  }
  /** Only trusted stored verifier evidence enters this method; never exposed as a public write endpoint. */
  async applyEvidence(id: string,submissionId: string,evidence: Evidence[],version: string,eligible: boolean) {
    const parsed=z.array(ItemEvidence).max(1000000).parse(evidence);
    if(new Set(parsed.map(e=>e.path)).size!==parsed.length) throw badRequest('Duplicate evidence paths');
    return this.locked(id,async(tx,b)=>{
      if(b.manifest) throw conflict('Accounting is frozen');
      const [s]=await rows(tx,sql`select * from collaboration_submissions where id=${submissionId} and bounty_id=${id}`);
      if(!s) throw notFound('submission');
      if(s.status!=='pending') return {replayed:true};
      // Exact duplicates are resolved by serialized verification commit order, then sorted path.
      const previous=await rows(tx,sql`select id,exact_hash,perceptual_hash from submission_items where bounty_id=${id} and verification_status in ('accepted','review') order by id`);
      const exact=new Map(previous.map(p=>[p.exact_hash,p]));
      const perceptual=new PerceptualIndex(b.near_threshold);
      for(const item of previous)if(item.perceptual_hash)perceptual.add(item.perceptual_hash);
      const p=await this.progress(tx,id,b.target);
      let capacity=Math.max(0,b.target-p.accepted),accepted=0,duplicates=0;
      const inserts: SQL[]=[];
      for(const item of [...parsed].sort((a,c)=>a.path.localeCompare(c.path))) {
        const match=exact.get(item.sha256);
        const near=item.dhash && perceptual.hasNear(item.dhash);
        const status=!item.valid?'rejected':match?'duplicate':!eligible||near||!capacity?'review':'accepted';
        const itemId=randomUUID();
        if(status==='accepted') { accepted++;capacity--; }
        if(status==='duplicate') duplicates++;
        if(status==='accepted'||status==='review') { const value={id:itemId,exact_hash:item.sha256,perceptual_hash:item.dhash};exact.set(item.sha256,value);if(item.dhash)perceptual.add(item.dhash); }
        inserts.push(sql`(${itemId},${id},${s.id},${s.contributor_id},${item.path},${item.sha256},${item.dhash},${status},${match?.id??null},${version},${status==='accepted'?new Date():null})`);
      }
      for(let i=0;i<inserts.length;i+=500) await tx.execute(sql`insert into submission_items(id,bounty_id,submission_id,contributor_id,file_path,exact_hash,perceptual_hash,verification_status,duplicate_reference,verification_version,accepted_at) values ${sql.join(inserts.slice(i,i+500),sql`,`)}`);
      await tx.execute(sql`update collaboration_submissions set status='verified' where id=${s.id}`);
      await this.reconcileClaims(tx,id,s.contributor_id);
      const [agent]=await rows(tx,sql`select id from seller_agents where bounty_id=${id} and owner_user_id=${s.contributor_id}`);
      await this.event(tx,id,'VERIFICATION_COMPLETED',{submissionId:s.id,accepted,duplicates,review:parsed.length-accepted-duplicates},`verified:${s.id}`,s.contributor_id);
      await this.event(tx,id,'CONTRIBUTION_COMPLETED',{accepted,submissionId:s.id},`completed:${s.id}`,s.contributor_id,agent?.id);
      if(duplicates) await this.event(tx,id,'DUPLICATES_DETECTED',{count:duplicates},`duplicates:${s.id}`,s.contributor_id,agent?.id);
      await this.coordinate(tx,b,s.id);
      return {accepted,duplicates};
    });
  }
  async review(id: string,buyer: string,item: string,accept: boolean,reason: string) {
    return this.locked(id,async(tx,b)=>{
      if(b.buyer_id!==buyer) throw forbidden('Buyer review required');
      if(b.manifest) throw conflict('Accounting frozen; reopen requires a separate audited process');
      const [i]=await rows(tx,sql`select * from submission_items where id=${item} and bounty_id=${id}`);
      if(!i) throw notFound('item');
      if(!['review','accepted'].includes(i.verification_status)) throw conflict('Item cannot be reviewed');
      if(accept) {
        if(i.verification_status==='accepted') return {accepted:true};
        const p=await this.progress(tx,id,b.target);
        if(!p.remaining) throw conflict('Target already reached');
        const [dup]=await rows(tx,sql`select 1 from submission_items where bounty_id=${id} and exact_hash=${i.exact_hash} and verification_status='accepted'`);
        if(dup) throw conflict('Exact duplicate cannot be accepted');
      }
      await tx.execute(sql`update submission_items set verification_status=${accept?'accepted':'invalidated'},accepted_at=${accept?new Date():null} where id=${item}`);
      await this.event(tx,id,'VERIFICATION_COMPLETED',{itemId:item,decision:accept?'accepted':'invalidated',reason},`review:${randomUUID()}`,buyer);
      // Reservations describe accepted work, not review decisions or promises. Reconcile after invalidation too.
      await this.reconcileClaims(tx,id,i.contributor_id);
      await this.coordinate(tx,b,randomUUID());
      return {accepted:accept};
    });
  }
  async manifest(id: string,user: string,currency: string) {
    return this.locked(id,async(tx,b)=>{
      if(user!==b.buyer_id) throw forbidden('Buyer approval required');
      if(b.manifest) return b.manifest;
      const p=await this.progress(tx,id,b.target);
      if(p.accepted!==b.target || p.pending) throw conflict('Reach target and resolve all pending/review items first');
      const [deleted]=await rows(tx,sql`select 1 from submission_items i join collaboration_submissions s on s.id=i.submission_id join asset_versions v on v.id=s.asset_version_id join assets a on a.id=v.asset_id where i.bounty_id=${id} and i.verification_status='accepted' and (a.deleted_at is not null or v.status<>'finalized') limit 1`);
      if(deleted) throw conflict('An accepted contribution is no longer available; invalidate it before freezing');
      const cs=await rows(tx,sql`select i.contributor_id as "userId",a.wallet,count(*)::int as count from submission_items i join accounts a on a.id=i.contributor_id where i.bounty_id=${id} and i.verification_status='accepted' group by i.contributor_id,a.wallet order by i.contributor_id`);
      const items=await rows(tx,sql`select id,exact_hash,contributor_id,verification_version from submission_items where bounty_id=${id} and verification_status='accepted' order by id`);
      const payload={schema:'edgebounty.collaboration-payout/1',bountyId:id,currency,grossBudgetMicro:String(b.amount_micro),approvedBy:user,createdAt:new Date().toISOString(),
        orderTermsHash:b.terms_hash,criteriaHash:b.criteria_hash,licenseHash:b.license_hash,escrowAddress:b.onchain_address,
        allocations:allocateReward(BigInt(b.amount_micro),cs),itemsHash:createHash('sha256').update('edgebounty.collaboration-items/1\0').update(canonicalJson(items)).digest('hex'),
        marketplaceFee:'Use existing on-chain configured fee; no fee deducted by this manifest',expensesReimbursed:false,settlementStatus:'blocked_contract_requires_single_seller'};
      const manifest={...payload,hash:payoutDigest(payload)};
      await tx.execute(sql`update collaborative_bounties set manifest=${JSON.stringify(manifest)}::jsonb where bounty_id=${id}`);
      await this.event(tx,id,'SHARED_PLAN_UPDATED',{action:'manifest_frozen',hash:manifest.hash},'manifest',user);
      return manifest;
    });
  }
}
