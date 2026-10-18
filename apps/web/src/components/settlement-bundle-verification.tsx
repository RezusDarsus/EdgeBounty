'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useWallet} from '@solana/wallet-adapter-react';
import {api} from '@/lib/api';
import {chainClient,hexBytes,sendWithWallet} from '@/lib/chain';
import {sol} from '@/lib/format';
import {Button,ErrorNote} from './ui';

export function SettlementBundleVerification({versionId}:{versionId:string}) {
  const wallet=useWallet();const [quote,setQuote]=useState<string|null>(null),[job,setJob]=useState<string|null>(null),[error,setError]=useState<unknown>(null);
  return <div className="mt-4 space-y-3 border-t border-line pt-4 text-sm">
    <p>Final delivery must contain exactly your accepted images. Verify this bundle before submitting its commitment. Rejected and duplicate images cannot receive payment.</p>
    <ErrorNote error={error}/>
    {!quote&&<Button variant="ghost" onClick={async()=>{try{const q=await api('/verification/quote',{body:{assetVersionId:versionId,level:'L2'}});setQuote(q.priceMicro);}catch(e){setError(e);}}}>Quote final-bundle verification</Button>}
    {quote&&!job&&<><p>Verification charge: {sol(quote)}. Existing storage and network fees are separate.</p><Button onClick={async()=>{try{const r=await api('/verification/jobs',{body:{assetVersionId:versionId,level:'L2'}});if(r.invoice){const c=await chainClient();await sendWithWallet(wallet,await c.payService(wallet.publicKey!,hexBytes(r.invoice.reference),r.invoice.serviceKind,BigInt(r.invoice.amountMicro)));await api(`/invoices/${r.invoice.id}/confirm`,{method:'POST'});}setJob(r.job.id);setError(null);}catch(e){setError(e);}}}>Authorize verification</Button></>}
    {job&&<p>Verification requested. <Link className="underline" href={`/verify/${job}`}>Open verification status</Link>. Submit the commitment below after verification completes.</p>}
  </div>;
}
