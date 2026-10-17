'use client';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { api, previewUrl } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { CURRENCY, amount, bytes, date, toMicro, sol } from '@/lib/format';
import { chainClient, pk, sendWithWallet } from '@/lib/chain';
import { useSession } from '@/app/providers';
import { Badge, Button, Card, ErrorNote, EvidenceLadder, Field, Hash, KV, Notice, Page, Skeleton, inputCls } from '@/components/ui';
import { BPS, DEFAULT_FEE_BPS, computePayout } from '@edgebounty/pricing-engine';
import { EvidenceTable, ReportView } from '@/components/report';

function InfringementForm({listingId,signedIn}:{listingId:string;signedIn:boolean}) {
 const [reason,setReason]=useState(''),[evidenceUrl,setEvidenceUrl]=useState(''),[goodFaith,setGoodFaith]=useState(false),[sent,setSent]=useState(false),[error,setError]=useState<unknown>(null);
 return <details className="border-t border-line pt-4"><summary className="cursor-pointer text-sm text-muted hover:text-ink">Report copyright or data-rights infringement</summary>
 <div className="mt-4 space-y-3">
 <p className="text-sm text-muted">Reports are reviewed privately by moderators. A report does not automatically remove content. Do not include private keys or sensitive personal data.</p>
 {!signedIn ? <p>Sign in with your wallet to submit a report.</p> : sent ? <p role="status">Report received. A review notice will appear in your dashboard.</p> : <>
 <Field label="Describe the work and the rights you believe were infringed"><textarea className={inputCls} value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)} /></Field>
 <Field label="HTTPS link to supporting evidence"><input className={inputCls} type="url" value={evidenceUrl} onChange={e=>setEvidenceUrl(e.target.value)} /></Field>
 <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={goodFaith} onChange={e=>setGoodFaith(e.target.checked)} />I believe this report is accurate and submitted in good faith.</label>
 <Button disabled={!goodFaith||reason.trim().length<20||!evidenceUrl} onClick={async()=>{try{await api(`/listings/${listingId}/report`,{body:{reason,evidenceUrl,goodFaith}});setSent(true);}catch(e){setError(e);}}}>Submit report</Button><ErrorNote error={error}/>
 </>}
 </div></details>;
}

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

  if (error) return <Page kicker="Listing" title="This listing couldn’t be loaded"><ErrorNote error={error} /></Page>;
  if (!l)
    return (
      <main className="mx-auto max-w-6xl px-4 pt-14 sm:px-6" aria-busy="true">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="mt-4 h-10 w-2/3" />
        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_360px]"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
      </main>
    );
  const mine = account?.wallet === l.seller.wallet;
  const levels: string[] = (l.verification ?? []).map((v: any) => v.level);
  const anyFailed = (l.verification ?? []).some((v: any) => v.passed === false);
  return (
    <Page
      kicker={<>{l.kind === 'model' ? 'Model' : 'Dataset'} · {l.category.replace(/_/g, ' ')}</>}
      title={l.title}
      actions={!mine ? <a href="#purchase" className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-panel px-3 text-sm lg:hidden"><span className="num">{sol(l.priceMicro)}</span><span className="text-muted">· Buy ↓</span></a> : undefined}
      subtitle={<>Version {l.version ?? '—'} · listed {date(l.createdAt)} by <Link className="underline" href={`/profile/${l.seller.wallet}`}>{l.seller.alias ?? 'seller'}</Link></>}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <Card title="Preview" right="limited, downscaled and watermarked">
            {l.previews.length === 0 && (
              <div>
                <p className="text-sm text-muted">{l.previewStatus === 'pending' ? 'A preview is being generated from the uploaded files…' : 'No preview was generated for these files. Judge the listing by the schema, the reports below, and the seller’s description.'}</p>
              </div>
            )}
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
          <Card title="Seller’s description" right="claims by the seller — not checked unless a report below covers them">
            <p className="max-w-[68ch] whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{l.description}</p>
          </Card>
          {l.kind === 'model' && l.details?.inference && account && !mine && <InferenceTrial listingId={id} />}
          <Card title="Evidence on file" right={levels.length ? 'reports for this exact version' : undefined}>
            <EvidenceLadder levels={levels} passed={anyFailed ? false : levels.length ? true : null} />
            <div className="mt-5" />
            {l.verification?.length ? (
              <>
              <EvidenceTable reports={l.verification} />
              {l.verification.filter((v: any) => v.metrics?.totalFiles === undefined).map((v: any, i: number) => (
                <div key={i} className="mb-3 border-b border-line pb-3 last:border-0">
                  <ReportView report={{ ...v, criteria: [], tools: [], sampling: '', verifier: 'edgebounty-platform', datasetMetrics: v.metrics?.totalFiles !== undefined ? v.metrics : null, modelMetrics: v.metrics?.format ? v.metrics : null, untested: [] }} reportHash={v.reportHash} attestation={v.attestation} />
                </div>
              ))}
              </>
            ) : (
              <p className="text-sm text-muted">No check reports are on file for this version. Everything above is the seller’s own description.</p>
            )}
          </Card>
        </div>
        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card title="Purchase" className="scroll-mt-24">
            <span id="purchase" />
            {(() => {
              const price = BigInt(l.priceMicro);
              const split = computePayout(price, 0n, DEFAULT_FEE_BPS, BPS, false);
              const sellerPct = Number(((split.sellerNet * 1000n) / (price || 1n))) / 10;
              return (
                <div className="mb-5">
                  <div className="flex items-baseline justify-between">
                    <span className="kicker">You pay into escrow</span>
                  </div>
                  <p className="num mt-2 text-[30px] leading-none tracking-tight">{sol(l.priceMicro)}</p>
                  <div className="mt-4 flex h-2 overflow-hidden rounded-[1px]" aria-hidden="true">
                    <span className="h-full bg-ink" style={{ width: `${sellerPct}%` }} />
                    <span className="h-full flex-1 bg-accent" />
                  </div>
                  <div className="mt-2 flex justify-between text-xs text-ink-2">
                    <span>Seller on settlement <span className="num text-ink">{amount(split.sellerNet)}</span></span>
                    <span>Platform 6% <span className="num text-ink">{amount(split.platformFee)}</span></span>
                  </div>
                  {verifier && <p className="mt-2 text-xs text-muted">Plus the verifier fee you set below, paid from your deposit.</p>}
                </div>
              );
            })()}
            <KV
              rows={[
                ['License', <Link key="l" className="underline" href={`/licenses/${l.licenseId}`}>{l.licenseId}</Link>],
                ['Size', `${l.asset.fileCount?.toLocaleString('en-US')} files · ${bytes(l.asset.totalSize)}`],
                ['Formats', l.formats.join(', ') || '—'],
                ['Records', l.recordCount?.toLocaleString('en-US') ?? '—'],
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
                <Button onClick={buy} disabled={!account || !wallet.connected} className="h-11 w-full">
                  Pay into escrow and buy †
                </Button>
                {!account && <p className="text-xs text-muted">Sign in with your wallet to buy. Your wallet will ask you to approve the payment before anything moves.</p>}
                {account && !wallet.connected && <p className="text-xs text-warn">Your wallet is disconnected. Reconnect it from the menu to continue.</p>}
                <p className="border-t border-line pt-3 text-xs leading-relaxed text-ink-2">
                  <span className="mr-1 font-serif text-sm text-ink">†</span>Your USDC is held by the escrow program, not by the seller. You get the full files after you approve the delivery or the review window passes. Solana network fees are separate.
                </p>
              </div>
            )}
            {mine && <Badge>Your listing</Badge>}
            <ErrorNote error={err} />
          </Card>
        </div>
      </div>
      <div className="mt-10"><InfringementForm listingId={id} signedIn={!!account} /></div>
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
