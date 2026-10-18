import {it,expect} from 'vitest';
import {UNIT,localnetAvailable} from './helpers.js';
import {actor,api,ok,pk,png,send,hex,uploadAsset,paidVerification,startHarness} from './api-harness.js';
import {drainJobs} from '../../apps/api/src/services/jobs.js';

const up=await localnetAvailable();
it.skipIf(!up)('real upload → cross-seller duplicate → buyer review → split escrows → exactly-once licensed delivery',async()=>{
  const h=await startHarness({COLLABORATIVE_BOUNTIES_ENABLED:'1',MALWARE_SCAN_REQUIRED:'0',AI_DRAFTS_ENABLED:'0',PAYMENT_CURRENCY:'SOL'});
  try {
    const buyer=await actor(h,500n*UNIT),g=await actor(h,50n*UNIT),n=await actor(h,50n*UNIT),m=await actor(h,50n*UNIT);
    const buyerMe=await ok(h,buyer,'GET','/me');
    const created=await ok(h,buyer,'POST','/bounties',{title:'Collaborative real-image test',description:'Three independently owned unique photographs for a collaboration test.',deliverables:['Three accepted unique photographs'],criteria:{kind:'image_dataset',minImages:1,minWidth:64,minHeight:64},licenseId:'eb-nonexclusive-commercial-v1',budgetMicro:String(30n*UNIT),deadline:new Date(Date.now()+3*3600000).toISOString(),maxCorrections:0,collaborationTarget:3});
    const a=created.onchain,root=`/bounties/${created.order.id}`;
    const funded=await h.p.client.createAndFundBounty(buyer.kp.publicKey,BigInt(a.orderId),{amount:BigInt(a.amount),verifier:pk(a.verifier),verifierFee:BigInt(a.verifierFee),verifierCapability:1,termsHash:hex(a.termsHash),criteriaHash:hex(a.criteriaHash),licenseHash:hex(a.licenseHash),deadline:a.deadline,maxCorrections:0,designatedSeller:pk(a.designatedSeller)});
    await send(h,buyer,funded.ixs);await ok(h,buyer,'POST',`/orders/${created.order.id}/sync`);
    await ok(h,buyer,'POST',`${root}/collaboration/enable`,{target:3});
    await expect(send(h,g,await h.p.client.acceptBounty(g.kp.publicKey,funded.order))).rejects.toThrow();
    for(const u of [g,n,m])await ok(h,u,'POST',`${root}/collaborators/join`);
    const owners=new Map<string,typeof g>(),versions=new Map<string,string>();
    async function contribute(u:typeof g,seed:number,name:string){
      const uploaded=await uploadAsset(h,u,'dataset','submission',[{path:`${name}.png`,data:png(96,96,seed),mediaType:'image/png'}]);
      // Match the bounty criteria rather than borrowing a standalone unrelated pass.
      const requested=await ok(h,u,'POST','/verification/jobs',{assetVersionId:uploaded.versionId,level:'L2',criteria:{kind:'image_dataset',minImages:1,minWidth:64,minHeight:64}});
      if(requested.invoice){const {payInvoice}=await import('./api-harness.js');await payInvoice(h,u,requested.invoice);}
      await drainJobs(h.ctx);
      const submitted=await ok(h,u,'POST',`${root}/contributions`,{assetVersionId:uploaded.versionId,verificationJobId:requested.job.id,licenseDeclaration:'I own these fixture photographs and authorize the requested license and buyer inspection.',reviewAccessGranted:true});
      await drainJobs(h.ctx);
      const me=await ok(h,u,'GET','/me');owners.set(me.account.id,u);versions.set(me.account.id,uploaded.versionId);
      return {uploaded,submitted,userId:me.account.id};
    }
    await contribute(g,101,'giorgi');
    const duplicate=await contribute(n,101,'duplicate');
    await contribute(m,202,'mariam');
    const queue=await ok(h,buyer,'GET',`${root}/review-items`);
    for(const item of queue) {
      const content=await api(h,buyer,'GET',`${root}/review-items/${item.id}/content`);expect(content.status).toBe(307);
      const downloaded=await api(h,buyer,'GET',String(content.headers.location));expect(downloaded.status).toBe(200);expect(downloaded.raw.length).toBeGreaterThan(50);
      await ok(h,buyer,'POST',`${root}/review-items/${item.id}/respond`,{accept:true,reason:'Reviewed fixture quality, distinct content, and declared license.'});
    }
    let progress=await ok(h,buyer,'GET',`${root}/progress`);expect(progress.accepted).toBe(2);expect(progress.duplicates).toBe(1);
    const replacement=await contribute(n,303,'replacement');
    const remaining=await ok(h,buyer,'GET',`${root}/review-items`);
    for(const item of remaining.filter((i:any)=>i.status==='review'))await ok(h,buyer,'POST',`${root}/review-items/${item.id}/respond`,{accept:true,reason:'Replacement is distinct and matches the stated license and quality.'});
    progress=await ok(h,buyer,'GET',`${root}/progress`);expect(progress.accepted).toBe(3);
    const manifest=await ok(h,buyer,'POST',`${root}/payout-manifest`);
    const blocked=await api(h,buyer,'POST',`${root}/settlement-plan`,{manifestHash:manifest.hash,deadline:new Date(Date.now()+2*3600000).toISOString(),acknowledgeSplitEscrow:true});expect(blocked.status).toBe(409);
    await send(h,buyer,await h.p.client.cancelOrder(buyer.kp.publicKey,funded.order));await ok(h,buyer,'POST',`/orders/${created.order.id}/sync`);
    await ok(h,buyer,'POST',`${root}/settlement-plan`,{manifestHash:manifest.hash,deadline:new Date(Date.now()+2*3600000).toISOString(),acknowledgeSplitEscrow:true});
    const plan=await ok(h,buyer,'GET',`${root}/settlement-plan`);expect(plan.orders).toHaveLength(3);
    const fee=(await h.p.client.config())!.feeBps;
    for(const child of plan.orders){
      const p=child.onchain,u=owners.get(child.contributorId)!;
      const fundedChild=await h.p.client.createAndFundBounty(buyer.kp.publicKey,BigInt(p.orderId),{amount:BigInt(p.amount),termsHash:hex(p.termsHash),criteriaHash:hex(p.criteriaHash),licenseHash:hex(p.licenseHash),deadline:p.deadline,maxCorrections:0,designatedSeller:pk(p.designatedSeller)});
      await send(h,buyer,fundedChild.ixs);await ok(h,buyer,'POST',`/orders/${child.id}/sync`);
      const foreign=u===g?m:g;await expect(send(h,foreign,await h.p.client.acceptBounty(foreign.kp.publicKey,fundedChild.order))).rejects.toThrow();
      await send(h,u,await h.p.client.acceptBounty(u.kp.publicKey,fundedChild.order));await ok(h,u,'POST',`/orders/${child.id}/sync`);
      // The original paid pass used bounty criteria; final delivery can reuse the exact trusted bytes.
      if(child.contributorId===duplicate.userId)expect(versions.get(child.contributorId)).toBe(replacement.uploaded.versionId);
      const prepared=await ok(h,u,'POST',`/orders/${child.id}/submissions`,{assetVersionId:versions.get(child.contributorId)});
      await send(h,u,await h.p.client.submitDeliverable(u.kp.publicKey,fundedChild.order,hex(prepared.onchain.commitment),prepared.onchain.version));await ok(h,u,'POST',`/orders/${child.id}/sync`);
      expect((await api(h,buyer,'GET',`/orders/${child.id}/delivery`)).status).toBe(409);
      await send(h,buyer,await h.p.client.acceptDeliverable(buyer.kp.publicKey,fundedChild.order));
      const before=await h.p.client.tokenBalance(h.p.client.ata(u.kp.publicKey,h.p.mint));
      await send(h,u,await h.p.client.settleOrder(u.kp.publicKey,fundedChild.order));await ok(h,u,'POST',`/orders/${child.id}/sync`);
      const gross=BigInt(p.amount),expected=gross-gross*BigInt(fee)/10000n;
      expect(await h.p.client.tokenBalance(h.p.client.ata(u.kp.publicKey,h.p.mint))-before).toBe(expected);
      const delivery=await ok(h,buyer,'GET',`/orders/${child.id}/delivery`);expect(delivery.files).toHaveLength(1);
      const data=await api(h,buyer,'GET',delivery.files[0].url);expect(data.status).toBe(200);
      await expect(send(h,u,await h.p.client.settleOrder(u.kp.publicKey,fundedChild.order).catch(()=>[]))).rejects.toThrow();
    }
    const confirmed=await ok(h,buyer,'GET',`${root}/settlement-plan`);
    expect(confirmed.orders.every((o:any)=>o.status==='settled'&&BigInt(o.confirmedSellerMicro)>0n)).toBe(true);
    expect(buyerMe.account.id).toBe(manifest.approvedBy);
  }finally{await h.close();}
});
