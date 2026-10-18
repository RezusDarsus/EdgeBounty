'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSession } from '@/app/providers';
import { api, API_URL, ApiError, loadToken } from '@/lib/api';
import { chainClient, hexBytes, sendWithWallet } from '@/lib/chain';
import { sol } from '@/lib/format';
import { AssetUploader, type UploadedAsset } from './uploader';
import { CollaborationSubmissions } from './collaboration-submissions';
import { CollaborationSettlement } from './collaboration-settlement';
import { AuthImg, Button, Card, ErrorNote, Field, Notice, inputCls } from './ui';

interface Contributor { userId:string;agentId:string;name:string;agentStatus:string;submitted?:number;accepted?:number;duplicates?:number;pending?:number;status:string }
interface View {
  buyerId:string;revision:number;progress:{target:number;accepted:number;remaining:number;percent:number;pending:number;duplicates:number;rejected:number};
  contributors:Contributor[];claims:{id:string;userId:string;reservedCount:number;acceptedCount:number;expiresAt:string}[];
  proposals:{id:string;userId:string;type:string;count:number}[];events:{id:string;sequence:string;type:string;agentId:string|null;payload:Record<string,unknown>;createdAt:string}[];
  rewardMicro:string;escrowAddress:string;escrowStatus:string;manifest:null|{hash:string;allocations:{userId:string;count:number;grossMicro:string}[]};workPlan:string[];
}

export function CollaborationWorkspace({id,buyerId,criteria,onEnabled}:{id:string;buyerId:string;criteria:unknown;onEnabled?:(enabled:boolean)=>void}) {
  const {account}=useSession();
  const wallet=useWallet();
  const root=`/bounties/${id}`;
  const [available,setAvailable]=useState(false),[enabled,setEnabled]=useState(false),[joined,setJoined]=useState(false);
  const [view,setView]=useState<View|null>(null),[error,setError]=useState<unknown>(null),[connection,setConnection]=useState('Connecting');
  const [target,setTarget]=useState('10000'),[count,setCount]=useState('300'),[asset,setAsset]=useState<UploadedAsset|null>(null);
  const [license,setLicense]=useState(''),[review,setReview]=useState<{id:string;userId:string;status:string;reviewAccessGranted:boolean;licenseDeclaration:string}[]>([]),[reason,setReason]=useState('');
  const [job,setJob]=useState<{id:string;invoice:any}|null>(null),[quote,setQuote]=useState<string|null>(null);
  const [aiEnabled,setAiEnabled]=useState(false),[aiConsent,setAiConsent]=useState(false);
  const reviewOffset=useRef(0);
  const scope=`${account?.id}:${root}`,currentScope=useRef(scope);currentScope.current=scope;
  const buyer=account?.id===buyerId;
  const refresh=useCallback(async()=>{
    try {
      const v=await api<View>(`${root}/collaboration`);
      if(currentScope.current!==scope)return null;
      setView(v);setJoined(true);setError(null);
      if(account?.id===v.buyerId) setReview(await api(`${root}/review-items?offset=${reviewOffset.current}`));
      return v;
    } catch(e) {if(e instanceof ApiError&&e.status===403){setJoined(false);setView(null);}else setError(e);return null;}
  },[root,account?.id,scope]);
  useEffect(()=>{
    setView(null);setJoined(false);setAvailable(false);setEnabled(false);onEnabled?.(false);
    if(!account) return;
    void api<{chat:boolean}>('/agents/capabilities').then(c=>setAiEnabled(c.chat)).catch(()=>setAiEnabled(false));
    let cancelled=false;
    api<{available:boolean;enabled:boolean}>(`${root}/collaboration-status`).then(s=>{
      if(cancelled)return;setAvailable(s.available);setEnabled(s.enabled);onEnabled?.(s.enabled);if(s.enabled)void refresh();
    }).catch(setError);
    return()=>{cancelled=true;};
  },[root,account?.id,refresh,onEnabled]);
  useEffect(()=>{
    if(!joined||!enabled||!account) return;
    const abort=new AbortController();let cursor=0;
    const run=async()=>{
      while(!abort.signal.aborted){
        try{
          await refresh(); // Authoritative snapshot on every reconnect.
          const token=loadToken();if(!token)return;
          const res=await fetch(`${API_URL}${root}/events/stream?after=${cursor}`,{headers:{authorization:`Bearer ${token}`},signal:abort.signal});
          if(!res.ok||!res.body)throw new Error('Live connection interrupted');
          setConnection('Live');const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='';
          while(!abort.signal.aborted){
            const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});
            let end;let changed=false;
            while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const match=frame.match(/^id: (\d+)/m);if(match){cursor=Number(match[1]);changed=true;}}
            if(changed)await refresh();
          }
        }catch{if(abort.signal.aborted)return;}
        setConnection('Reconnecting');
        await new Promise<void>(resolve=>{const timer=setTimeout(resolve,3000);abort.signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
      }
    };void run();return()=>abort.abort();
  },[joined,enabled,account?.id,root,refresh]);
  const act=async(path:string,body:unknown={})=>{try{await api(`${root}${path}`,{body});await refresh();setError(null);}catch(e){setError(e);}};
  if(!account||!available)return null;
  if(!enabled)return buyer?<Card title="Collaborative dataset bounty"><p className="mb-3 text-sm text-ink-2">Invite multiple contributors to share a verified image target. Accepted ownership determines each contributor’s allocation. Settlement uses separate designated-seller escrows and explicit wallet approvals.</p><Field label="Required accepted images"><input className={inputCls} type="number" min="1" max="1000000" value={target} onChange={e=>setTarget(e.target.value)}/></Field><Button onClick={async()=>{try{await api(`${root}/collaboration/enable`,{body:{target:Number(target)}});setEnabled(true);onEnabled?.(true);await refresh();}catch(e){setError(e);}}}>Enable collaboration pilot</Button><ErrorNote error={error}/></Card>:null;
  if(!joined&&!buyer)return <Card title="Collaborative dataset bounty"><p className="mb-3 text-sm">Contribute photographs and review your agent’s work proposals. Joining makes no financial commitment.</p><Button onClick={()=>act('/collaborators/join')}>Join collaboration</Button><ErrorNote error={error}/></Card>;
  if(!view)return <Card title="Collaboration"><p role="status">Loading shared workspace…</p><ErrorNote error={error}/></Card>;
  const p=view.progress;
  const mine=view.proposals.filter(q=>q.userId===account.id);
  return <div className="space-y-8">
    <Card title="Shared progress" right={connection}>
      <ErrorNote error={error}/>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><p className="text-xl font-semibold tabular-nums">{p.accepted.toLocaleString()} / {p.target.toLocaleString()} accepted</p><span className="tabular-nums">{p.percent.toFixed(1)}%</span></div>
      <progress aria-label="Accepted unique images" className="h-3 w-full accent-accent" value={p.accepted} max={p.target}/>
      <p className="mt-3 text-sm text-ink-2">{p.remaining.toLocaleString()} needed · {p.pending.toLocaleString()} awaiting verification or review · {p.duplicates.toLocaleString()} duplicates · {p.rejected.toLocaleString()} rejected</p>
      <p className="mt-2 text-xs text-muted">Reservations and AI suggestions do not count as accepted work. Escrow: {view.escrowStatus}.</p>
    </Card>
    <Card title="Contributors">
      <div className="overflow-x-auto"><table className="w-full text-left text-sm tabular-nums"><caption className="sr-only">Contributions and independently scoped agents</caption><thead><tr className="border-b border-line">{['Contributor / agent','Uploaded','Accepted','Duplicates','Pending','Reserved'].map(h=><th key={h} className="px-2 py-3 font-medium">{h}</th>)}</tr></thead><tbody>{view.contributors.map(c=><tr key={c.userId} className="border-b border-line"><th scope="row" className="px-2 py-3 font-normal">{c.name}<span className="block text-xs text-muted">{c.status==='left'?'Left workspace':c.agentStatus}</span></th><td className="px-2">{c.submitted??0}</td><td className="px-2">{c.accepted??0}</td><td className="px-2">{c.duplicates??0}</td><td className="px-2">{c.pending??0}</td><td className="px-2">{view.claims.filter(q=>q.userId===c.userId).reduce((n,q)=>n+q.reservedCount-q.acceptedCount,0)}</td></tr>)}</tbody></table></div>
    </Card>
    <Card title="Shared work plan"><ul className="list-disc space-y-2 pl-5 text-sm">{view.workPlan.map((t,i)=><li key={i}>{t}</li>)}</ul>
      {!buyer&&!view.manifest&&<div className="mt-4 space-y-3"><Field label="Images to reserve"><input className={inputCls} type="number" min="1" max={p.remaining} value={count} onChange={e=>setCount(e.target.value)}/></Field><Button disabled={!p.remaining} onClick={()=>act('/work-claims',{count:Number(count),idempotencyKey:crypto.randomUUID()})}>Reserve work</Button>{view.claims.filter(q=>q.userId===account.id).map(q=><p key={q.id} className="text-sm">{q.reservedCount-q.acceptedCount} remaining until {new Date(q.expiresAt).toLocaleString()} <Button variant="ghost" onClick={()=>act(`/work-claims/${q.id}/release`)}>Release unused work</Button></p>)}</div>}
    </Card>
    <Card title="Your agent’s proposals">{!mine.length?<p className="text-sm text-muted">No proposals awaiting your approval.</p>:mine.map(q=><div key={q.id} className="mb-4 border-b border-line pb-4"><p className="mb-2 text-sm">Agent suggestion: {q.type==='REPLACEMENT_REQUESTED'?'replace duplicates with':'offer'} {q.count} unique images.</p><div className="flex flex-wrap gap-2"><Button onClick={()=>act(`/proposals/${q.id}/respond`,{accept:true})}>Approve reservation</Button><Button variant="ghost" onClick={()=>act(`/proposals/${q.id}/respond`,{accept:true,count:Number(count)})}>Use count above</Button><Button variant="ghost" onClick={()=>act(`/proposals/${q.id}/respond`,{accept:false})}>Reject</Button></div></div>)}</Card>
    {!buyer&&aiEnabled&&!view.manifest&&<Card title="AI explanation"><label className="mb-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={aiConsent} onChange={e=>setAiConsent(e.target.checked)}/>Share my accepted and duplicate counts and the remaining target with NVIDIA for a work suggestion. Files and dataset metadata stay private.</label><Button disabled={!aiConsent||!p.remaining} onClick={()=>act(`/agents/${view.contributors.find(c=>c.userId===account.id)?.agentId}/propose`,{consent:true})}>Ask my agent for a proposal</Button></Card>}
    {!buyer&&!view.manifest&&<Card title="Contribute photographs"><AssetUploader kind="dataset" purpose="submission" name="Collaborative bounty photographs" accept=".jpg,.jpeg,.png,.webp" onDone={setAsset}/>{asset&&<div className="mt-4 space-y-3"><Field label="License and provenance declaration"><textarea className={`${inputCls} min-h-24`} value={license} onChange={e=>setLicense(e.target.value)} placeholder="Describe the rights you hold and how these photographs meet the bounty’s license."/></Field><Button variant="ghost" onClick={async()=>{try{const q=await api('/verification/quote',{body:{assetVersionId:asset.versionId,level:'L2'}});setQuote(q.priceMicro);}catch(e){setError(e);}}}>Get verification quote</Button>{quote&&<p className="text-sm">Verification charge: {sol(quote)}. Storage and other existing fees remain separate.</p>}{quote&&!job&&<Button disabled={license.trim().length<20} onClick={async()=>{try{const r=await api('/verification/jobs',{body:{assetVersionId:asset.versionId,level:'L2',criteria:criteria??undefined}});setJob({id:r.job.id,invoice:r.invoice});}catch(e){setError(e);}}}>Create verification request</Button>}{job&&<Button onClick={async()=>{try{if(job.invoice){const c=await chainClient();await sendWithWallet(wallet,await c.payService(wallet.publicKey!,hexBytes(job.invoice.reference),job.invoice.serviceKind,BigInt(job.invoice.amountMicro)));await api(`/invoices/${job.invoice.id}/confirm`,{method:'POST'});}await act('/contributions',{assetVersionId:asset.versionId,verificationJobId:job.id,licenseDeclaration:license});}catch(e){setError(e);}}}>{job.invoice?'Pay verification and submit':'Submit for review'}</Button>}</div>}</Card>}
    <CollaborationSubmissions revision={view.revision} bountyId={id} userId={account.id} buyer={buyer} frozen={!!view.manifest} onChange={refresh}/>
    {buyer&&<Card title="Final image review"><p className="mb-3 text-sm text-ink-2">Review relevance, quality, and licensing through your authorized review process. Similarity flags require judgment. Only approve evidence you have reviewed.</p><Field label="Review reason"><input className={inputCls} value={reason} onChange={e=>setReason(e.target.value)}/></Field>{review.length===0?<p className="text-sm text-muted">No image records to review.</p>:review.map(i=><div key={i.id} className="flex flex-wrap items-center gap-2 border-b border-line py-2 text-sm"><div className="min-w-0 flex-1"><span className="break-all">{i.id} · {i.status}</span>{i.reviewAccessGranted?<AuthImg path={`${root}/review-items/${i.id}/content`} alt="Contributor-authorized image for buyer review" className="mt-2 max-h-48 max-w-full object-contain"/>:<p className="text-xs text-muted">Contributor has not authorized image access.</p>}<p className="mt-2 break-words text-xs">{i.licenseDeclaration}</p></div>{i.status==='review'&&<Button disabled={reason.trim().length<10} onClick={()=>act(`/review-items/${i.id}/respond`,{accept:true,reason})}>Accept image</Button>}<Button variant="ghost" disabled={reason.trim().length<10} onClick={()=>act(`/review-items/${i.id}/respond`,{accept:false,reason})}>{i.status==='accepted'?'Invalidate':'Reject'}</Button></div>)}<div className="mt-3 flex gap-2"><Button variant="ghost" disabled={reviewOffset.current===0} onClick={async()=>{reviewOffset.current=Math.max(0,reviewOffset.current-50);await refresh();}}>Previous images</Button><Button variant="ghost" disabled={review.length<50} onClick={async()=>{reviewOffset.current+=50;await refresh();}}>Next images</Button></div></Card>}
    <Card title="Agent collaboration feed"><ol className="max-h-80 space-y-4 overflow-auto text-sm">{[...view.events].reverse().map(e=><li key={e.id}><span className="font-medium">{e.agentId?'Agent suggestion':'Coordinator / verification'} · {e.type.replaceAll('_',' ').toLowerCase()}</span><p className="mt-1 break-words text-ink-2">{Object.entries(e.payload).filter(([k])=>['accepted','remaining','count','explanation','action','status'].includes(k)).map(([k,v])=>`${k}: ${String(v)}`).join(' · ')}</p><time className="text-xs text-muted" dateTime={e.createdAt}>{new Date(e.createdAt).toLocaleString()}</time></li>)}</ol><p className="mt-3 text-xs text-muted">Showing the latest 100 events. Durable history is available through the paginated activity API.</p></Card>
    <Card title="Contribution accounting"><p className="mb-3 text-sm">Gross bounty reward: {sol(view.rewardMicro)}. Marketplace commission uses the existing settlement policy. Seller expenses are accounted separately.</p><Notice>The original escrow cannot pay multiple recipients directly. The settlement plan below uses existing designated-seller escrows. Agents never sign or transfer funds.</Notice>{view.manifest?<><p className="mt-3 break-all text-xs">Frozen manifest: {view.manifest.hash}</p>{view.manifest.allocations.map(a=><p key={a.userId} className="mt-2 text-sm">{view.contributors.find(c=>c.userId===a.userId)?.name}: {a.count} images · gross {sol(a.grossMicro)} · confirmed payment shown in the settlement plan</p>)}</>:<><p className="mt-3 text-sm">Projected gross shares follow final accepted ownership. Confirmed compensation: none.</p>{view.contributors.map(c=><p key={c.userId} className="mt-2 text-sm">{c.name}: projected gross {sol((BigInt(view.rewardMicro)*BigInt(c.accepted??0)/BigInt(p.target)).toString())}</p>)}{buyer&&<Button className="mt-3" disabled={p.remaining>0||p.pending>0} onClick={()=>act('/payout-manifest')}>Approve and freeze payout manifest</Button>}</>}</Card>
    {view.manifest&&<CollaborationSettlement bountyId={id} escrowAddress={view.escrowAddress} manifestHash={view.manifest.hash} buyer={buyer} names={Object.fromEntries(view.contributors.map(c=>[c.userId,c.name]))}/>}
    {!buyer&&<Button variant="ghost" onClick={()=>act('/collaborators/leave')}>Leave workspace and release reservations</Button>}
  </div>;
}
