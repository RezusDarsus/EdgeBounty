'use client';
import {useState,useEffect,useCallback} from 'react';
import Link from 'next/link';
import {useWallet} from '@solana/wallet-adapter-react';
import {api} from '@/lib/api';
import {chainClient,hexBytes,pk,sendWithWallet} from '@/lib/chain';
import {sol} from '@/lib/format';
import {Button,Card,ErrorNote,Field,inputCls} from './ui';

export function CollaborationSettlement({bountyId,escrowAddress,manifestHash,buyer,names}:{bountyId:string;escrowAddress:string;manifestHash:string;buyer:boolean;names:Record<string,string>}) {
  const wallet=useWallet();
  const [plan,setPlan]=useState<any>(null),[error,setError]=useState<unknown>(null),[consent,setConsent]=useState(false);
  const [deadline,setDeadline]=useState(()=>new Date(Date.now()+7*86400000).toISOString().slice(0,16));
  const load=useCallback(async()=>{try{setPlan(await api(`/bounties/${bountyId}/settlement-plan`));setError(null);}catch(e){setError(e);}},[bountyId]);
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),10000);return()=>clearInterval(timer);},[load]);
  async function act(run:()=>Promise<unknown>){try{setError(null);await run();await load();}catch(e){setError(e);}}
  return <Card title="Settle accepted contributions">
    <ErrorNote error={error}/>
    <p className="mb-4 text-sm text-ink-2">Each contributor is paid through an existing designated-seller escrow. The original escrow must be cancelled or refunded first. The same gross reward is allocated once across the new escrows; the existing commission and separate expenses still apply. Every transaction requires the appropriate wallet signature.</p>
    {buyer&&!(plan?.orders?.length)&&<div className="space-y-3">
      <Button variant="ghost" onClick={()=>act(async()=>{const c=await chainClient();const original=await c.order(pk(escrowAddress));if(original&&!['cancelled','refunded'].includes(original.state)){await sendWithWallet(wallet,await c.cancelOrder(wallet.publicKey!,pk(escrowAddress)));await api(`/orders/${bountyId}/sync`,{method:'POST'});}})}>Cancel original escrow and return its funding</Button>
      <Field label="Final delivery deadline (local time)"><input className={inputCls} type="datetime-local" value={deadline} onChange={e=>setDeadline(e.target.value)}/></Field>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I approve the frozen contribution allocation and the displayed deadline for individual contributor contracts. Preparing contracts does not transfer funds.</label>
      <Button disabled={!consent} onClick={()=>act(()=>api(`/bounties/${bountyId}/settlement-plan`,{body:{manifestHash,deadline:new Date(deadline).toISOString(),acknowledgeSplitEscrow:true}}))}>Prepare contributor contracts</Button>
    </div>}
    {plan?.orders?.map((o:any)=><div key={o.id} className="mt-4 flex flex-wrap items-center gap-3 border-b border-line pb-4 text-sm">
      <p className="min-w-0 flex-1">{names[o.contributorId]??'Contributor'} · {o.count} accepted images · {o.onchain?sol(o.onchain.amount):'allocated reward'} · {o.status} · confirmed seller proceeds: {o.confirmedSellerMicro===null?'none':sol(o.confirmedSellerMicro)}</p>
      {buyer&&o.status==='draft'&&<Button onClick={()=>act(async()=>{
        const c=await chainClient(),existing=await c.order(pk(o.onchain.address));
        if(!existing){const p=o.onchain;const prepared=await c.createAndFundBounty(wallet.publicKey!,BigInt(p.orderId),{amount:BigInt(p.amount),termsHash:hexBytes(p.termsHash),criteriaHash:hexBytes(p.criteriaHash),licenseHash:hexBytes(p.licenseHash),deadline:p.deadline,maxCorrections:p.maxCorrections,designatedSeller:pk(p.designatedSeller)});await sendWithWallet(wallet,prepared.ixs);}
        await api(`/orders/${o.id}/sync`,{method:'POST'});
      })}>Fund this contributor’s escrow</Button>}
      <Link className="underline" href={`/orders/${o.id}`}>Open delivery and settlement</Link>
    </div>)}
    {plan?.orders?.length>0&&<p className="mt-3 text-xs text-muted">Contributors accept their designated contracts, upload and verify final bundles containing only their accepted images, and submit commitments. Buyer approval and settlement follow the existing escrow state machine. Licensed downloads become available on each settled order.</p>}
  </Card>;
}
