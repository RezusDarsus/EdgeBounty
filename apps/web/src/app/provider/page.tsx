'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { CAPABILITIES, capabilityMask, type Capability } from '@edgebounty/shared-types';
import { api, downloadFile } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { date, sol } from '@/lib/format';
import { chainClient, hexBytes, pk, sendWithWallet } from '@/lib/chain';
import { RequireSession } from '@/components/nav';
import { Badge, Button, Card, Empty, ErrorNote, Field, Notice, Page, inputCls } from '@/components/ui';

export default function ProviderDashboard() {
  const wallet = useWallet();
  const { data, reload } = useApi<any>('/provider/jobs');
  const [err, setErr] = useState<unknown>(null);
  return (
    <RequireSession>
      <Page kicker="Verifier workspace" title="Provider dashboard" subtitle="Offer verification services, accept jobs, evaluate inputs in your controlled environment, and sign results on-chain.">
        <ErrorNote error={err} />
        <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
          <Register current={data?.provider} onDone={reload} onError={setErr} />
          <div className="space-y-4">
            <Card title="Order verifications assigned to you">
              {!data?.orderJobs?.length && <Empty>No assigned order verifications.</Empty>}
              {data?.orderJobs?.map((j: any) => (
                <div key={j.id} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
                  <span>Level {j.level.slice(1)} · submission #{j.submissionIndex}</span>
                  <span className="flex items-center gap-2"><Badge>{j.status}</Badge><Link className="underline" href={`/orders/${j.orderId}`}>open order</Link></span>
                </div>
              ))}
            </Card>
            <Card title="Verification jobs (escrowed)">
              {!data?.marketJobs?.length && <Empty>No open or assigned jobs matching your capabilities.</Empty>}
              {data?.marketJobs?.map((j: any) => <MarketJob key={j.id} job={j} wallet={wallet} onDone={reload} onError={setErr} />)}
            </Card>
          </div>
        </div>
      </Page>
    </RequireSession>
  );
}

function Register({ current, onDone, onError }: { current: any; onDone: () => void; onError: (e: unknown) => void }) {
  const wallet = useWallet();
  const [f, setF] = useState({ name: current?.profile?.name ?? '', description: current?.profile?.description ?? '', hardware: '', methods: '', pricing: '', capacity: '20', security: '', assetTypes: 'image datasets' });
  const [caps, setCaps] = useState<Capability[]>(['dataset_image']);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title={current ? 'Your provider profile' : 'Become a provider'}>
      {current && <p className="mb-3 text-sm">{current.approved ? <Badge tone="good">approved: {current.capabilities.join(', ')}</Badge> : <Badge tone="warn">awaiting admin approval</Badge>}</p>}
      <div className="space-y-2">
        <Field label="Name"><input className={inputCls} value={f.name} onChange={set('name')} /></Field>
        <Field label="Description"><textarea className={`${inputCls} h-20`} value={f.description} onChange={set('description')} /></Field>
        <Field label="Hardware"><input className={inputCls} value={f.hardware} onChange={set('hardware')} placeholder="2× L4 GPU, isolated VMs" /></Field>
        <Field label="Methods" hint="comma separated"><input className={inputCls} value={f.methods} onChange={set('methods')} /></Field>
        <Field label="Pricing"><input className={inputCls} value={f.pricing} onChange={set('pricing')} placeholder="from 5 USDC per 1k images" /></Field>
        <Field label="Security capabilities" hint="comma separated"><input className={inputCls} value={f.security} onChange={set('security')} placeholder="no egress, encrypted disks" /></Field>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(CAPABILITIES) as Capability[]).map((c) => (
            <button key={c} onClick={() => setCaps(caps.includes(c) ? caps.filter((x) => x !== c) : [...caps, c])} className={`rounded-[2px] border px-2 py-1 text-xs transition-colors ${caps.includes(c) ? 'border-ink bg-ink text-paper' : 'border-line'}`}>{c}</button>
          ))}
        </div>
        <Button
          onClick={async () => {
            try {
              const r = await api('/providers/profile', {
                body: {
                  profile: { schema: 'edgebounty.provider/1', name: f.name, description: f.description, assetTypes: f.assetTypes.split(',').map((s) => s.trim()), hardware: f.hardware, methods: f.methods.split(',').map((s) => s.trim()).filter(Boolean), pricing: f.pricing, capacityJobsPerDay: Number(f.capacity), securityCapabilities: f.security.split(',').map((s) => s.trim()).filter(Boolean) },
                  requestedCapabilities: capabilityMask(caps),
                },
              });
              const c = await chainClient();
              const exists = await c.provider(wallet.publicKey!);
              const ixs = exists ? await c.updateProvider(wallet.publicKey!, hexBytes(r.onchain.metadataHash), r.onchain.requestedCapabilities) : await c.registerProvider(wallet.publicKey!, hexBytes(r.onchain.metadataHash), r.onchain.requestedCapabilities);
              await sendWithWallet(wallet, ixs);
              onDone();
            } catch (e) {
              onError(e);
            }
          }}
          disabled={f.name.length < 2 || !caps.length}
        >
          {current ? 'Update on-chain' : 'Register on-chain'}
        </Button>
        <Notice>Registration does not grant trust. An administrator approves capabilities; your verdicts are randomly re-run.</Notice>
      </div>
    </Card>
  );
}

function MarketJob({ job, wallet, onDone, onError }: { job: any; wallet: ReturnType<typeof useWallet>; onDone: () => void; onError: (e: unknown) => void }) {
  const [inputs, setInputs] = useState<any>(null);
  const [report, setReport] = useState('');
  const mine = job.providerWallet === wallet.publicKey?.toBase58();
  const addr = pk(job.onchainAddress);
  return (
    <div className="border-b border-line py-3 text-sm last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>Level {job.spec.level?.slice(1)} · {sol(job.priceMicro)} · due {date(job.deadline)}</span>
        <Badge>{job.chainState}</Badge>
      </div>
      {job.spec.instructions && <p className="mt-1 text-muted">{job.spec.instructions}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {job.chainState === 'open' && (
          <Button onClick={async () => { try { const c = await chainClient(); await sendWithWallet(wallet, await c.acceptVerificationJob(wallet.publicKey!, addr)); await api(`/provider-jobs/${job.id}/sync`, { method: 'POST' }); onDone(); } catch (e) { onError(e); } }}>Accept job</Button>
        )}
        {mine && job.chainState === 'accepted' && <Button variant="ghost" onClick={async () => setInputs(await api(`/provider/jobs/${job.id}/inputs`).catch((e) => (onError(e), null)))}>Get inputs</Button>}
      </div>
      {inputs && <ul className="mono mt-2 max-h-32 overflow-auto text-xs">{inputs.files.map((f: any) => <li key={f.path}><button className="underline" onClick={() => downloadFile(f.url, f.path.split('/').pop())}>{f.path}</button></li>)}</ul>}
      {mine && job.chainState === 'accepted' && (
        <div className="mt-2">
          <textarea className={`${inputCls} mono h-24`} placeholder="Report JSON (edgebounty.report/1)" value={report} onChange={(e) => setReport(e.target.value)} />
          <Button className="mt-1" onClick={async () => {
            try {
              const parsed = JSON.parse(report);
              const r = await api(`/provider/jobs/${job.id}/report`, { body: { report: parsed } });
              const c = await chainClient();
              const { ixs } = await c.submitVerificationJobResult(wallet.publicKey!, addr, { resultHash: hexBytes(r.reportHash), passed: !!parsed.passed, assetVersion: 1, benchmarkVersion: 1 });
              await sendWithWallet(wallet, ixs);
              await api(`/provider-jobs/${job.id}/sync`, { method: 'POST' });
              onDone();
            } catch (e) {
              onError(e);
            }
          }}>Sign result on-chain</Button>
        </div>
      )}
    </div>
  );
}
