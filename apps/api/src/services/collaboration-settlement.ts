import {randomBytes} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {sql} from 'drizzle-orm';
import {bytesToHex,DOMAIN,hashDocument} from '@edgebounty/verification-schemas';
import type {AppContext} from '../context.js';
import {schema,type Db} from '../db/index.js';
import {conflict,forbidden,notFound} from '../lib/http.js';
import {CollaborationService,ItemEvidence,rows,payoutDigest} from './collaboration.js';
import {bountyArgs} from '../routes/marketplace.js';

/** Reuses unchanged single-seller escrows. No backend signing, transfer, or escrow redistribution.
 * The buyer must first cancel/refund the unassigned parent and explicitly fund each child with their wallet.
 */
export async function prepareCollaborationSettlement(ctx:AppContext,bountyId:string,user:string,manifestHash:string,deadline:Date) {
  const [parent]=await rows(ctx.db,sql`select * from orders where id=${bountyId}`);
  if(!parent)throw notFound('bounty');
  if(parent.buyer_id!==user)throw forbidden('Buyer authorization required');
  // No funds can be committed twice: verify release of the original escrow from fresh chain state.
  const chain=await ctx.chain.client.order(new PublicKey(parent.onchain_address));
  if(chain&&!['cancelled','refunded'].includes(chain.state))throw conflict('Cancel or refund the original escrow before preparing contributor escrows');
  if(chain&&(chain.buyer!==parent.buyer_wallet||chain.amount!==BigInt(parent.amount_micro)||chain.termsHash!==parent.terms_hash))throw conflict('Parent escrow does not match approved terms');
  if(!chain&&parent.chain_state!=='draft')throw conflict('Original escrow state could not be verified');
  const service=new CollaborationService(ctx.db);
  return service.locked(bountyId,async(tx,b)=>{
    if(b.buyer_id!==user)throw forbidden();
    if(!b.manifest||b.manifest.hash!==manifestHash)throw conflict('Approve the exact final payout manifest first');
    const {hash,...payload}=b.manifest;
    if(payoutDigest(payload)!==hash||payload.currency!==ctx.cfg.PAYMENT_CURRENCY)throw conflict('Manifest integrity/currency mismatch');
    const existing=await rows(tx,sql`select order_id from collaboration_settlements where bounty_id=${bountyId}`);
    if(existing.length)return {prepared:true,replayed:true};
    if(payload.allocations.reduce((n:bigint,a:any)=>n+BigInt(a.grossMicro),0n)!==BigInt(parent.amount_micro))throw conflict('Allocation exceeds the original approved budget');
    for(const allocation of payload.allocations) {
      if(BigInt(allocation.grossMicro)===0n)continue;
      const [account]=await rows(tx,sql`select * from accounts where id=${allocation.userId} and deleted_at is null`);
      if(!account||account.wallet!==allocation.wallet)throw conflict('Contributor payout identity changed');
      const orderId=randomBytes(8).readBigUInt64LE()&0x7fff_ffff_ffff_ffffn;
      const terms={...parent.terms,title:`${parent.title} — ${account.alias}'s accepted contribution`,
        description:`Settlement of ${allocation.count} accepted unique images under collaboration manifest ${hash}. Original image quality and license requirements remain applicable.`,
        deliverables:[`${allocation.count} unique accepted images owned by this contributor.`,`Deliver only files included in the frozen collaboration manifest ${hash}.`]};
      const criteria=null;
      const [order]=await (tx as Db).insert(schema.orders).values({
        kind:'bounty',buyerId:user,buyerWallet:parent.buyer_wallet,title:terms.title,description:terms.description,
        orderIdOnchain:orderId,onchainAddress:ctx.chain.client.pda.order(new PublicKey(parent.buyer_wallet),orderId).toBase58(),
        sellerId:allocation.userId,sellerWallet:account.wallet,designatedSeller:account.wallet,
        terms,termsHash:bytesToHex(hashDocument(DOMAIN.terms,terms)),criteria,criteriaHash:bytesToHex(hashDocument(DOMAIN.criteria,criteria)),
        licenseId:parent.license_id,licenseHash:parent.license_hash,amountMicro:BigInt(allocation.grossMicro),
        deadline,maxCorrections:0,public:false,groupId:bountyId,groupKind:'slot',groupIndex:payload.allocations.indexOf(allocation),
      }).returning();
      await tx.execute(sql`insert into collaboration_settlements(bounty_id,contributor_id,order_id,manifest_hash,gross_micro,expected_count) values(${bountyId},${allocation.userId},${order!.id},${hash},${BigInt(allocation.grossMicro)},${allocation.count})`);
    }
    await service.event(tx,bountyId,'SHARED_PLAN_UPDATED',{action:'individual_escrows_prepared',manifestHash:hash,requiresWalletSignatures:true},'settlement-plan',user);
    return {prepared:true,replayed:false};
  });
}

export async function collaborationSettlementPlan(ctx:AppContext,bountyId:string,user:string) {
  return new CollaborationService(ctx.db).locked(bountyId,async(tx,b)=>{
    await new CollaborationService(ctx.db).member(tx,bountyId,user,b.buyer_id);
    const records=await rows(tx,sql`select o.*,s.contributor_id,s.expected_count,s.manifest_hash from collaboration_settlements s join orders o on o.id=s.order_id where s.bounty_id=${bountyId} order by s.contributor_id`);
    return {parentBountyId:bountyId,mode:'individual_existing_escrows',orders:await Promise.all(records.map(async o=>{
      const current=await ctx.chain.client.order(new PublicKey(o.onchain_address));
      const matches=current&&current.buyer===o.buyer_wallet&&current.seller===o.seller_wallet&&current.amount===BigInt(o.amount_micro)&&current.termsHash===o.terms_hash;
      const gross=matches&&current.state==='settled'?current.amount*BigInt(current.sellerBps)/10000n:null;
      return {
      id:o.id,contributorId:o.contributor_id,count:o.expected_count,manifestHash:o.manifest_hash,status:current?.state??o.chain_state,
      confirmedSellerMicro:gross===null?null:(gross-gross*BigInt(current!.feeBps)/10000n).toString(),
      onchain:user===b.buyer_id?bountyArgs({orderIdOnchain:BigInt(o.order_id_onchain),amountMicro:BigInt(o.amount_micro),verifierWallet:o.verifier_wallet,verifierFeeMicro:BigInt(o.verifier_fee_micro),termsHash:o.terms_hash,criteriaHash:o.criteria_hash,licenseHash:o.license_hash,deadline:new Date(o.deadline),maxCorrections:o.max_corrections,designatedSeller:o.designated_seller,arbitratorWallet:o.arbitrator_wallet,onchainAddress:o.onchain_address} as any):null,
    };}))};
  });
}

/** Refuse a child submission containing rejected/duplicate/foreign images, even when the uploader
 * declares the expected hashes. A completed trusted byte-level verifier run is mandatory.
 */
export async function assertCollaborationSettlementVersion(ctx:Pick<AppContext,'db'>,orderId:string,user:string,versionId:string) {
  const [settlement]=await rows(ctx.db,sql`select * from collaboration_settlements where order_id=${orderId}`);
  if(!settlement)return;
  if(settlement.contributor_id!==user)throw forbidden('Only the allocated contributor can deliver');
  const expected=await rows(ctx.db,sql`select exact_hash from submission_items where bounty_id=${settlement.bounty_id} and contributor_id=${user} and verification_status='accepted'`);
  if(expected.length!==settlement.expected_count)throw conflict('Frozen accepted ownership changed');
  const expectedHashes=new Set(expected.map(i=>i.exact_hash));
  const [proof]=await rows(ctx.db,sql`select e.evidence from collaboration_verifier_evidence e join verification_jobs j on j.id=e.job_id join asset_versions v on v.id=e.asset_version_id join assets a on a.id=v.asset_id where e.asset_version_id=${versionId} and e.complete and j.status='completed' and j.level in ('L2','L3') and a.owner_id=${user} and a.deleted_at is null order by e.created_at desc limit 1`);
  if(!proof)throw conflict('Complete L2 verification of the final accepted-image bundle before submitting');
  const items=(proof.evidence as unknown[]).map(i=>ItemEvidence.parse(i));
  if(items.length!==expected.length||new Set(items.map(i=>i.sha256)).size!==expected.length||items.some(i=>!i.valid||!expectedHashes.has(i.sha256)))throw conflict('Final bundle must contain exactly this contributor’s accepted unique images');
  const files=await rows(ctx.db,sql`select sha256,path from asset_files where version_id=${versionId}`);
  if(files.length!==expected.length||new Set(files.map(f=>f.sha256)).size!==expected.length||files.some(f=>!expectedHashes.has(f.sha256)||!items.some(i=>i.path===f.path&&i.sha256===f.sha256)))throw conflict('Final bundle contains additional or unverified files');
}
