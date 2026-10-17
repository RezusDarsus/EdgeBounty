'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { CAPABILITIES, type Capability } from '@edgebounty/shared-types';
import { api, downloadFile } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { bytes, date, sol } from '@/lib/format';
import { chainClient, pk, sendWithWallet } from '@/lib/chain';
import { useSession } from '@/app/providers';
import { RequireSession } from '@/components/nav';
import { Badge, Button, Card, Empty, ErrorNote, Field, Hash, KV, Page, Tabs, inputCls } from '@/components/ui';

const TABS = ['Overview', 'Disputes', 'Providers', 'Moderation', 'Escrow', 'Economics', 'Fraud', 'Audit log'];

function InfringementQueue() {
 const {data,error,reload}=useApi<any[]>('/admin/infringement-reports');
 return <Card title="Infringement reports"><ErrorNote error={error}/>{!data?.length?<Empty>No reports.</Empty>:data.map(r=><InfringementReview key={r.id} report={r} reload={reload}/>)}</Card>;
}
function InfringementReview({report:r,reload}:{report:any;reload:()=>Promise<void>}) {
 const [resolution,setResolution]=useState(''),[error,setError]=useState<unknown>(null);
 return <div className="space-y-3 border-t border-line py-4"><Link className="underline" href={`/listings/${r.listingId}`}>View reported listing</Link><p className="whitespace-pre-wrap text-sm">{r.reason}</p><a className="text-sm underline" href={r.evidenceUrl} target="_blank" rel="noopener noreferrer">Open reporter-supplied evidence</a><p className="text-sm">Status: {r.status}</p>{r.status==='open'&&<><Field label="Review decision and explanation"><textarea className={inputCls} value={resolution} onChange={e=>setResolution(e.target.value)} maxLength={2000}/></Field><div className="flex gap-3">{(['upheld','rejected'] as const).map(status=><Button key={status} disabled={resolution.trim().length<10} onClick={async()=>{try{await api(`/admin/infringement-reports/${r.id}/review`,{body:{status,resolution}});await reload();}catch(e){setError(e);}}}>{status==='upheld'?'Uphold report':'Reject report'}</Button>)}</div><p className="text-sm text-muted">For upheld reports, use listing moderation below to remove content and sign on-chain moderation.</p></>}<ErrorNote error={error}/></div>;
}

export default function Admin() {
  const { isAdmin } = useSession();
  const [tab, setTab] = useState(TABS[0]);
  return (
    <RequireSession>
      {!isAdmin ? (
        <Page kicker="Operations" title="Admin"><Empty>Administrator wallets only.</Empty></Page>
      ) : (
        <Page kicker="Operations" title="Administration" subtitle="Every action here is recorded in the audit log. Administrative powers are limited by the program: no one can redirect escrowed funds.">
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
          {tab === 'Overview' && <Overview />}
          {tab === 'Disputes' && <Disputes />}
          {tab === 'Providers' && <ProvidersAdmin />}
          {tab === 'Moderation' && <><InfringementQueue /><Moderation /></>}
          {tab === 'Escrow' && <Escrow />}
          {tab === 'Economics' && <Economics />}
          {tab === 'Fraud' && <Fraud />}
          {tab === 'Audit log' && <AuditLog />}
        </Page>
      )}
    </RequireSession>
  );
}

function Overview() {
  const { data: o, reload } = useApi<any>('/admin/overview');
  const wallet = useWallet();
  const [err, setErr] = useState<unknown>(null);
  if (!o) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Platform">
        <KV rows={[['Accounts', o.accounts], ['Published listings', o.listings], ['Orders by state', Object.entries(o.orders).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'], ['Open disputes', o.openDisputes], ['Pending providers', o.pendingProviders], ['Jobs', Object.entries(o.jobs).map(([k, v]) => `${k}: ${v}`).join(', ') || '—']]} />
      </Card>
      <Card title="Money">
        <KV rows={[['Settled GMV', sol(o.gmvMicro)], ['Service revenue', sol(o.serviceRevenueMicro)], ['Treasury balance', sol(o.treasuryBalanceMicro)], ['Fee', o.feeBps !== null ? `${o.feeBps / 100}%` : '—'], ['Paused', String(o.paused)]]} />
        <Button className="mt-3" variant={o.paused ? 'primary' : 'danger'} onClick={async () => { try { const c = await chainClient(); await sendWithWallet(wallet, await c.setPaused(wallet.publicKey!, !o.paused)); reload(); } catch (e) { setErr(e); } }}>
          {o.paused ? 'Unpause new commitments' : 'Pause new commitments'}
        </Button>
        <p className="mt-2 text-xs text-muted">Pausing blocks new listings, orders and jobs. Settlement, refunds and disputes keep working.</p>
        <ErrorNote error={err} />
      </Card>
    </div>
  );
}

function Disputes() {
  const { data, reload } = useApi<any[]>('/admin/disputes');
  return (
    <div className="space-y-3">
      {data?.length === 0 && <Empty>No disputes.</Empty>}
      {data?.map((d) => <DisputeRow key={d.id} d={d} onDone={reload} />)}
    </div>
  );
}

function DisputeRow({ d, onDone }: { d: any; onDone: () => void }) {
  const [files, setFiles] = useState<any[] | null>(null);
  const [bps, setBps] = useState('5000');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<unknown>(null);
  return (
    <Card title={<span className="normal-case">{d.order?.title}</span>} right={<Badge tone={d.status === 'open' ? 'bad' : 'neutral'}>{d.status}</Badge>}>
      <p className="text-sm"><b>Reason:</b> {d.reason}</p>
      <p className="mt-1 text-xs text-muted">Opened by <Hash value={d.openedByWallet} /> · {date(d.createdAt)} · order <Link className="underline" href={`/orders/${d.orderId}`}>{d.orderId.slice(0, 8)}</Link> · escrow {sol(d.order?.amountMicro)}</p>
      {d.evidence.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm">{d.evidence.map((e: any, i: number) => <li key={i}><Hash value={e.by} />: {e.note}</li>)}</ul>}
      {d.status === 'open' && (
        <div className="mt-3 space-y-2">
          <Button variant="ghost" onClick={async () => setFiles(await api(`/admin/disputes/${d.id}/files`))}>Inspect submission (audited)</Button>
          {files && <ul className="mono max-h-32 overflow-auto text-xs">{files.map((f) => <li key={f.url}><button className="underline" onClick={() => downloadFile(f.url, f.path.split('/').pop())}>{f.path}</button> {bytes(f.size)}</li>)}</ul>}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Seller share (bps, split only)"><input className={inputCls} value={bps} onChange={(e) => setBps(e.target.value)} /></Field>
            <Field label="Ruling notes"><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
          <div className="flex gap-2">
            <Button onClick={async () => { try { await api(`/admin/disputes/${d.id}/resolve`, { body: { resolution: 'split', sellerBps: Number(bps), notes } }); onDone(); } catch (e) { setErr(e); } }} disabled={notes.length < 5}>Resolve: split</Button>
            <Button variant="ghost" onClick={async () => { try { await api(`/admin/disputes/${d.id}/resolve`, { body: { resolution: 'correction', notes } }); onDone(); } catch (e) { setErr(e); } }} disabled={notes.length < 5}>Resolve: correction</Button>
          </div>
        </div>
      )}
      {d.resolution && <p className="mt-2 text-sm text-muted">Ruling: {d.resolution} {d.sellerBps !== null && `(${d.sellerBps / 100}% to seller)`} — {d.notes}</p>}
      <ErrorNote error={err} />
    </Card>
  );
}

function ProvidersAdmin() {
  const { data, reload } = useApi<any[]>('/admin/providers');
  const wallet = useWallet();
  const [err, setErr] = useState<unknown>(null);
  return (
    <Card title="Provider approvals">
      <ErrorNote error={err} />
      {data?.map((p) => {
        const requested = (Object.keys(CAPABILITIES) as Capability[]).filter((c) => (p.requestedCapabilities & CAPABILITIES[c]) !== 0);
        return (
          <div key={p.wallet} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 text-sm last:border-0">
            <span><b>{p.profile?.name ?? 'unnamed'}</b> <Hash value={p.wallet} /> requests {requested.join(', ') || '—'} · audits {p.audits.agreed}✓ {p.audits.disagreed}✗</span>
            <span className="flex gap-2">
              {p.approved ? <Badge tone="good">approved</Badge> : <Badge tone="warn">pending</Badge>}
              <Button variant="ghost" onClick={async () => { try { const c = await chainClient(); await sendWithWallet(wallet, await c.reviewProvider(wallet.publicKey!, pk(p.wallet), !p.approved, p.requestedCapabilities)); reload(); } catch (e) { setErr(e); } }}>{p.approved ? 'Suspend' : 'Approve requested'}</Button>
            </span>
          </div>
        );
      })}
    </Card>
  );
}

function Moderation() {
  const { data } = useApi<{ items: any[] }>('/listings?limit=100');
  const wallet = useWallet();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<unknown>(null);
  return (
    <Card title="Listings">
      <Field label="Takedown reason (logged)"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ErrorNote error={err} />
      {data?.items.map((l) => (
        <div key={l.id} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
          <Link className="underline" href={`/listings/${l.id}`}>{l.title}</Link>
          <Button variant="danger" disabled={reason.length < 3} onClick={async () => { try { await api(`/admin/listings/${l.id}/moderate`, { body: { moderated: true, reason } }); const c = await chainClient(); await sendWithWallet(wallet, await c.moderateListing(wallet.publicKey!, pk(l.onchainAddress), true)); } catch (e) { setErr(e); } }}>Take down</Button>
        </div>
      ))}
    </Card>
  );
}

function Escrow() {
  const { data } = useApi<any>('/admin/reconciliation');
  if (!data) return null;
  return (
    <Card title="Escrow reconciliation" right={data.ok ? <Badge tone="good">all vaults match</Badge> : <Badge tone="bad">{data.mismatches.length} mismatches</Badge>}>
      <p className="text-sm">Checked {data.checked} live vaults against recorded liabilities (amount + verifier fee).</p>
      {data.mismatches.map((m: any) => <p key={m.order} className="mono text-xs text-bad">{m.address}: expected {m.expected}, actual {m.actual}</p>)}
    </Card>
  );
}

function Economics() {
  const { data } = useApi<any>('/admin/economics');
  if (!data) return null;
  return (
    <Card title="Unit economics">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted"><tr><th>Service</th><th>Jobs</th><th>Revenue</th><th>Cost</th><th>Margin</th></tr></thead>
        <tbody>{data.byService.map((r: any, i: number) => <tr key={i} className="border-t border-line"><td className="py-1">{r.kind} L{r.level.slice(1)}</td><td>{r.n}</td><td>{sol(r.revenue)}</td><td>{sol(r.cost)}</td><td>{sol(r.marginMicro)}</td></tr>)}</tbody>
      </table>
      <p className="mt-3 text-sm">Stored: {bytes(Number(data.storedBytes))} · est. storage cost {sol(data.storageCostMicroPerMonth)}/month · failed jobs {data.failedJobs}</p>
    </Card>
  );
}

function Fraud() {
  const { data } = useApi<any>('/admin/fraud');
  if (!data) return null;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card title="Repeated buyer/seller pairs">{data.repeatedPairs.length ? data.repeatedPairs.map((p: any, i: number) => <p key={i} className="text-sm"><Hash value={p.buyer} /> → <Hash value={p.seller} />: {p.n}</p>) : <p className="text-sm text-muted">None.</p>}</Card>
      <Card title="Verifier audit disagreements">{data.verifierDisagreements.length ? data.verifierDisagreements.map((v: any) => <p key={v.wallet} className="text-sm"><Hash value={v.wallet} /> {v.disagreed} of {v.agreed + v.disagreed}</p>) : <p className="text-sm text-muted">None.</p>}</Card>
      <Card title="Orders with integrity mismatch">{data.mismatchedOrders.length ? data.mismatchedOrders.map((id: string) => <Link key={id} className="block underline" href={`/orders/${id}`}>{id}</Link>) : <p className="text-sm text-muted">None.</p>}</Card>
    </div>
  );
}

function AuditLog() {
  const { data } = useApi<any[]>('/admin/audit');
  return (
    <Card title="Audit log">
      <table className="w-full text-left text-xs">
        <tbody>{data?.map((a) => <tr key={a.id} className="border-t border-line"><td className="py-1 pr-2 text-muted">{date(a.createdAt)}</td><td className="mono pr-2">{a.action}</td><td className="pr-2"><Hash value={a.actorWallet} /></td><td className="mono truncate">{a.target}</td></tr>)}</tbody>
      </table>
    </Card>
  );
}
