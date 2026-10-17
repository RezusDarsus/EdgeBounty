'use client';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { api, previewUrl } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { CURRENCY, bytes, date, toMicro, sol } from '@/lib/format';
import { chainClient, pk, sendWithWallet } from '@/lib/chain';
import { useSession } from '@/app/providers';
import { Badge, Button, Card, ErrorNote, Field, Hash, KV, Notice, Page, inputCls } from '@/components/ui';
import { ReportView } from '@/components/report';

export default function ListingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: l, error } = useApi<any>(`/listings/${id}`);
  const { data: providers } = useApi<any[]>('/providers');
  const { account } = useSession();
  const wallet = useWallet();
  const router = useRouter();
  const [verifier, setVerifier] = useState('');
  const [verifierFee, setVerifierFee] = useState('2');
  const { data: benchmarks } = useApi<any[]>('/benchmarks');
  const [benchmarkId, setBenchmarkId] = useState('');
  const [threshold, setThreshold] = useState('0.9');
  const [err, setErr] = useState<unknown>(null);

  async function buy() {
    setErr(null);
    try {
      const criteria = verifier && benchmarkId && l.kind === 'model' ? { kind: 'model', task: l.details?.task ?? 'image_classification', benchmarkId, metric: 'accuracy', thresholdE4: Math.round(Number(threshold) * 10_000) } : undefined;
      const prep = await api(`/listings/${id}/purchase`, { body: verifier ? { verifierWallet: verifier, verifierFeeMicro: toMicro(verifierFee), criteria } : {} });
      const c = await chainClient();
      const a = prep.onchain;
      const { ixs } = await c.createOrder(wallet.publicKey!, pk(a.listing), BigInt(a.orderId), {
        expectedPrice: BigInt(a.expectedPrice),
        expectedVersion: a.expectedVersion,
        verifier: a.verifier ? pk(a.verifier) : undefined,
        verifierFee: BigInt(a.verifierFee),
      });
      await sendWithWallet(wallet, ixs);
      await api(`/orders/${prep.order.id}/confirm`, { method: 'POST' });
      router.push(`/orders/${prep.order.id}`);
    } catch (e) {
      setErr(e);
    }
  }

  if (error) return <Page title="Listing"><ErrorNote error={error} /></Page>;
  if (!l) return <Page title="Loading…"><span /></Page>;
  const mine = account?.wallet === l.seller.wallet;
  return (
    <Page title={l.title} subtitle={<>{l.kind} · {l.category.replace(/_/g, ' ')} · version {l.version} · listed {date(l.createdAt)}</>}>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Card title="Preview" right={<span className="text-xs text-muted">limited, downscaled and watermarked</span>}>
            {l.previews.length === 0 && <p className="text-sm text-muted">{l.previewStatus === 'pending' ? 'Preview is being generated…' : 'No preview available.'}</p>}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {l.previews.filter((p: any) => p.kind === 'image').map((p: any) => (
                <figure key={p.url}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl(p.url)} alt={p.label ?? ''} className="aspect-square w-full rounded-md bg-code object-cover" />
                  {p.label && <figcaption className="mt-1 text-xs text-muted">{p.label}</figcaption>}
                </figure>
              ))}
            </div>
            {l.previews.some((p: any) => p.kind === 'table') && <TablePreview url={l.previews.find((p: any) => p.kind === 'table').url} />}
          </Card>
          <Card title="Description">
            <p className="whitespace-pre-wrap text-sm">{l.description}</p>
          </Card>
          {l.kind === 'model' && l.details?.inference && account && !mine && <InferenceTrial listingId={id} />}
          <Card title="Verification">
            {l.verification?.length ? (
              l.verification.map((v: any, i: number) => (
                <div key={i} className="mb-3 border-b border-line pb-3 last:border-0">
                  <ReportView report={{ ...v, criteria: [], tools: [], sampling: '', verifier: 'edgebounty-platform', datasetMetrics: v.metrics?.totalFiles !== undefined ? v.metrics : null, modelMetrics: v.metrics?.format ? v.metrics : null, untested: [] }} reportHash={v.reportHash} attestation={v.attestation} />
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">No verification report yet.</p>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Purchase">
            <p className="text-2xl font-semibold">{sol(l.priceMicro)}</p>
            <KV
              rows={[
                ['License', <Link key="l" className="underline" href={`/licenses/${l.licenseId}`}>{l.licenseId}</Link>],
                ['Size', `${l.asset.fileCount} files · ${bytes(l.asset.totalSize)}`],
                ['Formats', l.formats.join(', ') || '—'],
                ['Records', l.recordCount ?? '—'],
                ['Commitment', <Hash key="c" value={l.asset.commitment} />],
                ['Seller', <Link key="s" className="underline" href={`/profile/${l.seller.wallet}`}>{l.seller.alias}</Link>],
              ]}
            />
            {!mine && (
              <div className="mt-4 space-y-3">
                <Field label="Independent verifier (optional)" hint="The verifier evaluates the exact version before you approve; paid from your deposit even if it fails the asset.">
                  <select className={inputCls} value={verifier} onChange={(e) => setVerifier(e.target.value)}>
                    <option value="">No verifier — review previews and reports yourself</option>
                    {providers?.map((p) => (
                      <option key={p.wallet} value={p.wallet}>
                        {p.profile?.name ?? p.wallet.slice(0, 8)} · {p.jobsCompleted} jobs
                      </option>
                    ))}
                  </select>
                </Field>
                {verifier && l.kind === 'model' && (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Benchmark (independent)">
                      <select className={inputCls} value={benchmarkId} onChange={(e) => setBenchmarkId(e.target.value)}>
                        <option value="">Static inspection only</option>
                        {benchmarks?.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
                      </select>
                    </Field>
                    <Field label="Min accuracy"><input className={inputCls} value={threshold} onChange={(e) => setThreshold(e.target.value)} /></Field>
                  </div>
                )}
                {verifier && (
                  <Field label={`Verifier fee (${CURRENCY})`}>
                    <input className={inputCls} value={verifierFee} onChange={(e) => setVerifierFee(e.target.value)} />
                  </Field>
                )}
                <Button onClick={buy} disabled={!account || !wallet.connected} className="w-full">
                  Fund escrow &amp; buy
                </Button>
                {!account && <p className="text-xs text-muted">Sign in to buy.</p>}
                <Notice>Funds go into escrow. The full dataset is delivered after you approve or the review window passes.</Notice>
              </div>
            )}
            {mine && <Badge>Your listing</Badge>}
            <ErrorNote error={err} />
          </Card>
        </div>
      </div>
    </Page>
  );
}

function TablePreview({ url }: { url: string }) {
  const { data } = useApi<any>(url);
  if (!data) return null;
  const cols = data.columns.map((c: any) => c.name);
  return (
    <div className="mt-3 overflow-auto">
      <p className="mb-2 text-xs text-muted">{data.rows} rows · schema and a limited sample</p>
      <table className="mono w-full text-left text-xs">
        <thead>
          <tr>{data.columns.map((c: any) => <th key={c.name} className="pr-3">{c.name} <span className="text-muted">{c.type}</span></th>)}</tr>
        </thead>
        <tbody>{data.sample.map((r: any, i: number) => <tr key={i} className="border-t border-line">{cols.map((c: string) => <td key={c} className="pr-3">{r[c]}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function InferenceTrial({ listingId }: { listingId: string }) {
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  return (
    <Card title="Try the model" right={<span className="text-xs text-muted">5 trials/day · weights stay private</span>}>
      <input
        type="file"
        accept="image/*"
        className="text-sm"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setErr(null);
          try {
            setRes(await api(`/listings/${listingId}/inference-trial`, { raw: f, headers: { 'content-type': 'application/octet-stream' } }));
          } catch (x) {
            setErr(x);
          }
        }}
      />
      {res?.top && (
        <ul className="mt-3 space-y-1 text-sm">
          {res.top.map((t: any) => (
            <li key={t.label} className="flex items-center gap-2">
              <span className="w-24">{t.label}</span>
              <div className="h-2 flex-1 rounded bg-code"><div className="h-2 rounded bg-accent" style={{ width: `${Math.max(2, Math.min(100, t.score * 100))}%` }} /></div>
              <span className="mono w-16 text-right">{t.score.toFixed(3)}</span>
            </li>
          ))}
        </ul>
      )}
      {res?.error && <p className="mt-2 text-sm text-bad">{res.error}</p>}
      <ErrorNote error={err} />
    </Card>
  );
}
