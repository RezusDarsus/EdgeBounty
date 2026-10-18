'use client';
import {useEffect,useState,useCallback} from 'react';
import {api} from '@/lib/api';
import {Button,Card,ErrorNote} from './ui';

interface Submission {id:string;userId:string;status:string;reviewAccessGranted:boolean;licenseDeclaration:string}
export function CollaborationSubmissions({bountyId,userId,buyer,frozen,onChange,revision}:{bountyId:string;userId:string;buyer:boolean;frozen:boolean;revision:number;onChange:()=>Promise<unknown>}) {
  const [items,setItems]=useState<Submission[]>([]),[error,setError]=useState<unknown>(null),[offset,setOffset]=useState(0);
  const root=`/bounties/${bountyId}`;
  const load=useCallback(async()=>{try{setItems(await api(`${root}/contributions?offset=${offset}`));setError(null);}catch(e){setError(e);}},[root,offset,userId,revision]);
  useEffect(()=>{void load();},[load]);
  async function act(id:string,path:string,body:unknown={}) {
    try{await api(`${root}/contributions/${id}/${path}`,{body});await load();await onChange();}catch(e){setError(e);}
  }
  return <Card title={buyer?'Submission declarations':'Your submissions'}>
    <ErrorNote error={error}/>
    {!items.length?<p className="text-sm text-muted">No submissions on this page.</p>:items.map(s=><article key={s.id} className="space-y-3 border-b border-line py-4 text-sm">
      <p className="break-all font-medium">{s.id} · {s.status}</p>
      <p className="whitespace-pre-wrap break-words text-ink-2">{s.licenseDeclaration}</p>
      <p>Buyer image review: {s.reviewAccessGranted?'authorized by contributor':'not authorized'}</p>
      {!buyer&&s.userId===userId&&s.status!=='withdrawn'&&<div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={()=>act(s.id,'review-access',{granted:!s.reviewAccessGranted})}>{s.reviewAccessGranted?'Revoke buyer review access':'Authorize buyer image review before payment'}</Button>
        {!frozen&&<Button variant="danger" onClick={()=>act(s.id,'withdraw')}>Withdraw contribution</Button>}
      </div>}
      {!buyer&&<p className="text-xs text-muted">Review access lets the buyer inspect original images before payment. It does not grant a purchase license. Withdrawal removes accepted progress and compensation eligibility before accounting is frozen.</p>}
    </article>)}
    <div className="mt-3 flex gap-2"><Button variant="ghost" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-50))}>Previous submissions</Button><Button variant="ghost" disabled={items.length<50} onClick={()=>setOffset(offset+50)}>Next submissions</Button><Button variant="ghost" onClick={load}>Refresh submissions</Button></div>
  </Card>;
}
