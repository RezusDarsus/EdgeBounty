'use client';
import { use, useState } from 'react';
import { CollaborationWorkspace } from '@/components/collaboration';
import { SettlementBundleVerification } from '@/components/settlement-bundle-verification';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { api, downloadFile } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { date, dateTime, sol } from '@/lib/format';
import { chainClient, hexBytes, pk, sendWithWallet } from '@/lib/chain';
import { useSession } from '@/app/providers';
import { AssetUploader, type UploadedAsset } from '@/components/uploader';
import { ReportView } from '@/components/report';
import { AuthImg, Badge, Button, Card, ErrorNote, EscrowTrack, Field, Hash, KV, Notice, Page, StateBadge, inputCls, PageLoading } from '@/components/ui';

export default function OrderWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: o, error, reload } = useApi<any>(`/orders/${id}`);
  const { data: platform } = useApi<{ platformVerifier: string | null }>('/config');
  const { account } = useSession();
  const wallet = useWallet();
  const [err, setErr] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [collaborative, setCollaborative] = useState(false);

  async function act(label: string, build: () => Promise<any[]>) {
    setErr(null);
    setMsg(null);
    try {
      if (o?.kind === 'bounty' && !['Refunded', 'Cancelled'].includes(label)) {
        const mode = await api<{ enabled: boolean }>(`/bounties/${id}/collaboration-status`);
        if (mode.enabled) throw new Error('This collaboration pilot supports accounting only. Multi-recipient escrow settlement requires a reviewed contract integration.');
      }
      const sig = await sendWithWallet(wallet, await build());
      await api(`/orders/${id}/sync`, { method: 'POST' });
      setMsg(`${label}: ${sig.slice(0, 16)}…`);
      await reload();
    } catch (e) {
      setErr(e);
    }
  }

  if (error) return <Page kicker="Order" title="Order"><ErrorNote error={error} /></Page>;
  if (!o) return <PageLoading />;

  const me = account?.wallet;
  const role: string | null = o.role;
  const chain = o.chain ?? {};
  const state: string = o.chainState;
  const addr = pk(o.onchainAddress);
  const now = Date.now() / 1000;
  const latest = [...(o.verifications ?? [])].sort((a: any, b: any) => (b.submissionIndex ?? 0) - (a.submissionIndex ?? 0))[0];
  const verdictFailed = chain.verdictCurrent && !chain.verdictPassed;
  const correctionsLeft = chain.submissionCount < (chain.maxCorrections ?? 0) + 1;

  return (
    <Page kicker="Order" title={o.title} subtitle={<span className="flex flex-wrap items-center gap-2"><StateBadge state={state} /> {o.kind === 'bounty' ? 'Custom request' : 'Purchase'} · {sol(o.amountMicro)} · {role ? `you are the ${role}` : 'public view'}</span>}>
      {o.kind === 'bounty' && <div className="mb-8"><CollaborationWorkspace id={id} buyerId={o.buyerId} criteria={o.criteria} onEnabled={setCollaborative} /></div>}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="min-w-0 space-y-4">
          <EscrowTrack state={state} kind={o.kind} />
          {msg && <Notice>{msg}</Notice>}
          <ErrorNote error={err} />

          {/* ------------------------------------------------ seller: accept */}
          {!collaborative && state === 'funded' && me && me !== o.buyerWallet && me !== o.verifierWallet && (
            <Card title="Take this request">
              <p className="mb-3 text-sm">The budget is already escrowed. Accepting assigns the contract to your wallet; deliver before {date(o.deadline)}.</p>
              <Button onClick={() => act('Accepted', async () => (await chainClient()).acceptBounty(wallet.publicKey!, addr))}>Accept on-chain</Button>
            </Card>
          )}

          {/* ------------------------------------------------ seller: submit */}
          {!collaborative && role === 'seller' && (state === 'assigned' || state === 'correction_required') && <SubmitPanel orderId={id} address={o.onchainAddress} settlementBundle={!!o.collaborationSettlement} kind={o.criteria?.kind === 'model' ? 'model' : 'dataset'} allowEncryption={!!platform && o.verifierWallet !== platform.platformVerifier} onDone={reload} onError={setErr} />}

          {/* ------------------------------------------------ verifier (third-party) */}
          {!collaborative && role === 'verifier' && state === 'submitted' && latest && <VerifierPanel job={latest} address={o.onchainAddress} orderId={id} onDone={reload} onError={setErr} />}

          {/* ------------------------------------------------ buyer review */}
          {!collaborative && role === 'buyer' && state === 'under_review' && (
            <Card title="Your review" right={<span className="text-xs font-medium text-warn">Review closes {dateTime(chain.reviewDeadline)}</span>}>
              <Notice tone="warn">Review the delivery preview and verification report below before this deadline. If you take no action, the escrow may be settled to the seller after the review window expires. Set a reminder to review this order in time.</Notice>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => act('Approved', async () => (await chainClient()).acceptDeliverable(wallet.publicKey!, addr))}>Approve &amp; release payment</Button>
                {verdictFailed && correctionsLeft && <Button variant="ghost" onClick={() => act('Correction requested', async () => (await chainClient()).rejectDeliverable(wallet.publicKey!, addr))}>Request correction (verifier failed it)</Button>}
                {verdictFailed && !correctionsLeft && <Button variant="danger" onClick={() => act('Refunded', async () => (await chainClient()).refundOrder(wallet.publicKey!, addr))}>Refund (failed, no corrections left)</Button>}
              </div>
              <DisputeForm orderId={id} address={o.onchainAddress} onDone={reload} onError={setErr} />
            </Card>
          )}

          {(role === 'buyer' || role === 'seller') && state === 'disputed' && <EvidenceForm orderId={id} address={o.onchainAddress} onDone={reload} onError={setErr} />}
          {role === 'seller' && state === 'correction_required' && <DisputeForm orderId={id} address={o.onchainAddress} onDone={reload} onError={setErr} label="Contest the correction request" />}

          {/* ------------------------------------------------ refunds / cancel / settle */}
          {role === 'buyer' && (state === 'funded' || state === 'assigned') && now > chain.deadline && (
            <Card title="Deadline missed"><Button variant="danger" onClick={() => act('Refunded', async () => (await chainClient()).refundOrder(wallet.publicKey!, addr))}>Refund my deposit</Button></Card>
          )}
          {role === 'buyer' && state === 'correction_required' && now > chain.correctionDeadline && (
            <Card title="Correction not delivered"><Button variant="danger" onClick={() => act('Refunded', async () => (await chainClient()).refundOrder(wallet.publicKey!, addr))}>Refund my deposit</Button></Card>
          )}
          {role === 'buyer' && (state === 'funded' || state === 'created') && (
            <Card title="Cancel"><p className="mb-2 text-sm text-muted">No seller has accepted yet; cancelling refunds everything.</p><Button variant="ghost" onClick={() => act('Cancelled', async () => (await chainClient()).cancelOrder(wallet.publicKey!, addr))}>Cancel request</Button></Card>
          )}
          {!collaborative && me && (state === 'approved' || (state === 'under_review' && now > chain.reviewDeadline)) && (
            <Card title="Ready to settle"><Button onClick={() => act('Settled', async () => (await chainClient()).settleOrder(wallet.publicKey!, addr))}>Settle now</Button></Card>
          )}

          {/* ------------------------------------------------ delivery */}
          {role === 'buyer' && state === 'settled' && o.deliveryAvailable && <DeliveryPanel orderId={id} checkout={o.checkout} onCheckoutPaid={reload} />}
          <PrivateDeliveryPanel orderId={id} role={role} state={state} />

          {/* ------------------------------------------------ phase 5: milestones, arbitration */}
          {o.groupId && <GroupPanel order={o} onError={setErr} />}
          {state === 'disputed' && me && me === o.arbitratorWallet && (
            <Card title="Your ruling (agreed arbitrator)">
              <ArbitratorRuling address={o.onchainAddress} orderId={id} onDone={reload} onError={setErr} />
            </Card>
          )}

          {/* ------------------------------------------------ submissions & verification */}
          {(o.submissions?.length ?? 0) > 0 && (
            <Card title="Submissions">
              {o.submissions.map((s: any) => (
                <div key={s.index} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
                  <span>#{s.index + 1} <Hash value={s.commitment} /></span>
                  <span className="flex items-center gap-2">
                    {s.assetVersionId && role !== 'buyer' && <span className="text-xs text-muted">{s.status}</span>}
                    {role === 'buyer' && <Badge>{s.status}</Badge>}
                  </span>
                </div>
              ))}
              {role === 'buyer' && latest?.report && <SubmissionPreview orderId={id} />}
            </Card>
          )}
          {(o.verifications ?? []).filter((v: any) => v.report).map((v: any) => (
            <Card key={v.jobId} title={`Verification · submission #${v.submissionIndex}`}>
              <ReportView report={v.report} reportHash={v.reportHash} attestation={v.attestation} />
            </Card>
          ))}
          {(o.verifications ?? []).filter((v: any) => !v.report && v.status !== 'completed').map((v: any) => (
            <Card key={v.jobId} title="Verification in progress"><p className="text-sm text-muted">Status: {v.status}{v.error ? ` — ${v.error}` : ''}</p></Card>
          ))}

          {['settled', 'refunded'].includes(state) && (role === 'buyer' || role === 'seller') && <p className="text-sm"><Link className="underline" href={`/orders/${id}/receipt`}>View receipt</Link></p>}
          {['settled', 'refunded'].includes(state) && (role === 'buyer' || role === 'seller') && <ReviewForm orderId={id} />}
        </div>

        <div className="space-y-4">
          <Card title="Contract">
            <KV
              rows={[
                ['Escrow', sol(o.amountMicro)],
                ['Verifier fee', o.verifierWallet ? sol(o.verifierFeeMicro) : 'no verifier'],
                ['Platform fee', chain.feeBps !== undefined ? `${chain.feeBps / 100}% (locked)` : '—'],
                ['Deadline', date(o.deadline)],
                ['Corrections', o.maxCorrections],
                ['License', <Link key="l" className="underline" href={`/licenses/${o.licenseId}`}>{o.licenseId}</Link>],
                ['Buyer', <Hash key="b" value={o.buyerWallet} />],
                ['Seller', <Hash key="s" value={o.sellerWallet} />],
                ['Verifier', <Hash key="v" value={o.verifierWallet} />],
                ...(o.arbitratorWallet ? ([['Arbitrator', <Hash key="ar" value={o.arbitratorWallet} />]] as [string, React.ReactNode][]) : []),
                ...(o.designatedSeller ? ([['Designated seller', <Hash key="ds" value={o.designatedSeller} />]] as [string, React.ReactNode][]) : []),
                ['Order account', <Hash key="a" value={o.onchainAddress} />],
                ['Terms hash', <Hash key="t" value={o.termsHash} />],
              ]}
            />
          </Card>
          {o.criteria && (
            <Card title="Acceptance criteria">
              <pre className="mono overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(o.criteria, null, 2)}</pre>
            </Card>
          )}
          {o.terms?.deliverables && (
            <Card title="Deliverables">
              <ul className="list-disc pl-5 text-sm">{o.terms.deliverables.map((d: string, i: number) => <li key={i}>{d}</li>)}</ul>
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{o.description}</p>
            </Card>
          )}
          {(o.disputes ?? []).length > 0 && (
            <Card title="Disputes">
              {o.disputes.map((d: any) => (
                <div key={d.id} className="mb-2 text-sm">
                  <Badge tone={d.status === 'resolved' ? 'neutral' : 'bad'}>{d.status}</Badge> {d.reason}
                  {d.resolution && <p className="text-muted">Resolution: {d.resolution} {d.sellerBps !== null ? `(${d.sellerBps / 100}% to seller)` : ''} — {d.notes}</p>}
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}

function SubmitPanel({ orderId, address, kind, allowEncryption, settlementBundle=false, onDone, onError }: { orderId: string; address: string; kind: 'dataset' | 'model'; allowEncryption: boolean; settlementBundle?: boolean; onDone: () => void; onError: (e: unknown) => void }) {
  const wallet = useWallet();
  const [uploadKey, setUploadKey] = useState(0);
  const [asset, setAsset] = useState<UploadedAsset | null>(null);
  async function submit() {
    onError(null);
    try {
      const prep = await api(`/orders/${orderId}/submissions`, { body: { assetVersionId: asset!.versionId } });
      const c = await chainClient();
      await sendWithWallet(wallet, await c.submitDeliverable(wallet.publicKey!, pk(address), hexBytes(prep.onchain.commitment), prep.onchain.version));
      await api(`/orders/${orderId}/sync`, { method: 'POST' });
      onDone();
    } catch (e) {
      onError(e);
    }
  }
  return (
    <Card title="Deliver your work">
      <p className="mb-3 text-sm text-muted">Files stay private. Only a salted commitment to the exact file manifest goes on-chain; the buyer sees previews and reports until settlement.</p>
      {!allowEncryption && <p className="mb-3 text-sm text-muted">Automated verification requires readable files. Upload the originals without browser encryption; storage and buyer delivery remain private. If a previous encrypted upload was rejected, choose replacement files below.</p>}
      <AssetUploader key={uploadKey} kind={kind} purpose="submission" name={`submission ${orderId.slice(0, 8)}`} onDone={setAsset} allowEncryption={allowEncryption && !settlementBundle} />
      {settlementBundle && asset && <SettlementBundleVerification key={asset.versionId} versionId={asset.versionId}/>}
      {asset && <Button variant="ghost" className="mt-3 mr-2" onClick={() => { setAsset(null); setUploadKey((n) => n + 1); onError(null); }}>Choose replacement files</Button>}
      <Button className="mt-3" onClick={submit} disabled={!asset}>Submit commitment on-chain</Button>
    </Card>
  );
}

function VerifierPanel({ job, address, orderId, onDone, onError }: { job: any; address: string; orderId: string; onDone: () => void; onError: (e: unknown) => void }) {
  const wallet = useWallet();
  const [inputs, setInputs] = useState<any>(null);
  const [report, setReport] = useState('');
  return (
    <Card title="Independent evaluation">
      <p className="mb-3 text-sm text-muted">Download the job inputs (time-limited, logged), run the agreed checks, then upload your signed report. You are paid for the evaluation whatever the verdict.</p>
      <Button variant="ghost" onClick={async () => setInputs(await api(`/provider/jobs/${job.jobId}/inputs`).catch((e) => (onError(e), null)))}>Get input files</Button>
      {inputs && (
        <ul className="mono mt-2 max-h-40 overflow-auto text-xs">
          {inputs.files.map((f: any) => (
            <li key={f.path}><button className="underline" onClick={() => downloadFile(f.url, f.path.split('/').pop())}>{f.path}</button> {f.sha256.slice(0, 12)}</li>
          ))}
        </ul>
      )}
      <Field label="Report (JSON, edgebounty.report/1)">
        <textarea className={`${inputCls} mono h-32`} value={report} onChange={(e) => setReport(e.target.value)} />
      </Field>
      <Button
        className="mt-2"
        onClick={async () => {
          try {
            const parsed = JSON.parse(report);
            const r = await api(`/provider/jobs/${job.jobId}/report`, { body: { report: parsed } });
            const c = await chainClient();
            const { ixs } = await c.submitOrderVerification(wallet.publicKey!, pk(address), { resultHash: hexBytes(r.reportHash), specHash: hexBytes(r.specHash), benchmarkVersion: 1, passed: !!parsed.passed });
            await sendWithWallet(wallet, ixs);
            await api(`/orders/${orderId}/sync`, { method: 'POST' });
            onDone();
          } catch (e) {
            onError(e);
          }
        }}
      >
        Sign verdict on-chain
      </Button>
    </Card>
  );
}

function DisputeForm({ orderId, address, onDone, onError, label = 'Open a dispute' }: { orderId: string; address: string; onDone: () => void; onError: (e: unknown) => void; label?: string }) {
  const wallet = useWallet();
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  if (!open) return <button className="mt-3 text-sm text-bad underline" onClick={() => setOpen(true)}>{label}</button>;
  return (
    <div className="mt-4 space-y-2 border-t border-line pt-3">
      <Field label="Reason" hint="Be specific and reference the agreed criteria. The text stays private; only its hash goes on-chain.">
        <textarea className={`${inputCls} h-24`} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Button
        variant="danger"
        disabled={reason.length < 10}
        onClick={async () => {
          try {
            const prep = await api(`/orders/${orderId}/disputes`, { body: { reason } });
            const c = await chainClient();
            await sendWithWallet(wallet, await c.openDispute(wallet.publicKey!, pk(address), hexBytes(prep.onchain.reasonHash)));
            await api(`/orders/${orderId}/sync`, { method: 'POST' });
            onDone();
          } catch (e) {
            onError(e);
          }
        }}
      >
        Open dispute on-chain
      </Button>
    </div>
  );
}

function EvidenceForm({ orderId, address, onDone, onError }: { orderId: string; address: string; onDone: () => void; onError: (e: unknown) => void }) {
  const wallet = useWallet();
  const [note, setNote] = useState('');
  return (
    <Card title="Dispute evidence">
      <p className="mb-2 text-sm text-muted">An independent reviewer will examine the submission and both parties&apos; evidence. The asset is not released while the dispute is open.</p>
      <textarea className={`${inputCls} h-20`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Your evidence or explanation" />
      <Button
        className="mt-2"
        disabled={note.length < 3}
        onClick={async () => {
          try {
            const r = await api(`/orders/${orderId}/disputes/evidence`, { body: { note } });
            const c = await chainClient();
            await sendWithWallet(wallet, await c.addDisputeEvidence(wallet.publicKey!, pk(address), hexBytes(r.onchain.evidenceHash)));
            setNote('');
            onDone();
          } catch (e) {
            onError(e);
          }
        }}
      >
        Add evidence
      </Button>
    </Card>
  );
}

function SubmissionPreview({ orderId }: { orderId: string }) {
  const { data } = useApi<any>(`/orders/${orderId}/review`);
  if (!data?.previews?.length) return null;
  return (
    <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
      {data.previews.filter((p: any) => p.kind === 'image').map((p: any) => (
        <AuthImg key={p.url} path={p.url} className="aspect-square w-full rounded object-cover" />
      ))}
    </div>
  );
}

function DeliveryPanel({ orderId, checkout, onCheckoutPaid }: { orderId: string; checkout: any; onCheckoutPaid: () => Promise<void> }) {
  const wallet = useWallet();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const [paying, setPaying] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const needsCheckoutPayment = checkout?.status === 'awaiting_payment';
  return (
    <Card title="Download">
      <p className="mb-2 text-sm text-muted">Settlement is confirmed on-chain. Hosting and download capacity are separate checkout charges; your selected access period is {checkout?.months ?? '—'} month(s).</p>
      {needsCheckoutPayment ? (
        <>
          {checkout.invoice ? <>
            <p className="mb-2 text-sm">Checkout invoice: <b>{sol(checkout.invoice.amountMicro)}</b> for hosting and download capacity.</p>
            <Button disabled={!wallet.publicKey || paying} onClick={async () => {
              setErr(null); setPaying(true);
              try {
                const c = await chainClient();
                await sendWithWallet(wallet, await c.payService(wallet.publicKey!, hexBytes(checkout.invoice.reference), checkout.invoice.serviceKind, BigInt(checkout.invoice.amountMicro)));
                await api(`/invoices/${checkout.invoice.id}/confirm`, { method: 'POST' });
                await onCheckoutPaid();
              } catch (e) { setErr(e); }
              finally { setPaying(false); }
            }}>{paying ? 'Confirming checkout payment…' : `Pay ${sol(checkout.invoice.amountMicro)} checkout invoice`}</Button>
          </> : <p className="text-sm text-warn">The checkout invoice is {checkout.invoiceStatus ?? 'unavailable'} and cannot be paid from this page. Contact support to restore download access.</p>}
        </>
      ) : (
        <>
          <p className="mb-2 text-sm text-muted">Download links are bound to your wallet and expire in 10 minutes; request new ones any time.</p>
          <Button onClick={async () => {
            setErr(null);
            try { setD(await api(`/orders/${orderId}/delivery`)); }
            catch (e) { setErr(e); }
          }}>Get download links</Button>
        </>
      )}
      <ErrorNote error={err} />
      {d && (
        <>
          {d.zipUrl && <Button className="mt-3" onClick={() => downloadFile(d.zipUrl, 'edgebounty-dataset.zip')}>Download all as ZIP</Button>}
          {d.zipUrl && <p className="mt-2 text-xs text-muted">All files in one archive. Download capacity is charged for the full dataset when the ZIP starts.</p>}
          <p className="mt-2 text-xs">Licensed commitment <Hash value={d.commitment} /> · receipt <Hash value={d.licenseReceipt} /></p>
          <ul className="mono mt-2 max-h-64 overflow-auto text-xs">
            {d.files.map((f: any) => (
              <li key={f.path} className="flex justify-between gap-2 py-0.5">
                <button className="truncate text-left underline disabled:opacity-60" disabled={downloading === f.path} onClick={async () => {
                  setErr(null);
                  setDownloading(f.path);
                  try { await downloadFile(f.url, f.path.split('/').pop()); }
                  catch (e) { setErr(e); }
                  finally { setDownloading(null); }
                }}>{downloading === f.path ? `Preparing ${f.path}…` : f.path}</button>
                <span className="text-muted">{f.sha256.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function ReviewForm({ orderId }: { orderId: string }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  if (done) return <Notice>Thanks — your review is recorded.</Notice>;
  return (
    <Card title="Rate the counterparty">
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setRating(n)} className={`h-8 w-8 rounded ${n <= rating ? 'bg-accent text-accent-ink' : 'bg-code'}`}>{n}</button>)}
      </div>
      <textarea className={`${inputCls} mt-2 h-16`} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional comment" />
      <Button className="mt-2" onClick={async () => { try { await api(`/orders/${orderId}/reviews`, { body: { rating, comment } }); setDone(true); } catch (e) { setErr(e); } }}>Submit review</Button>
      <ErrorNote error={err} />
    </Card>
  );
}

function GroupPanel({ order, onError }: { order: any; onError: (e: unknown) => void }) {
  const wallet = useWallet();
  const { data, reload } = useApi<any>(`/groups/${order.groupId}`);
  if (!data) return null;
  return (
    <Card title={data.kind === 'milestone' ? 'Milestones' : 'Seller slots'}>
      {data.orders.map((g: any) => (
        <div key={g.id} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
          <Link className={g.id === order.id ? 'font-medium' : 'underline'} href={`/orders/${g.id}`}>{g.title}</Link>
          <span className="flex items-center gap-2">{sol(g.amountMicro)} <StateBadge state={g.chainState} /></span>
        </div>
      ))}
      {data.kind === 'milestone' && order.role === 'buyer' && (() => {
        const i = data.orders.findIndex((g: any) => g.chainState === 'draft');
        return i > 0 && data.orders[i - 1].chainState === 'settled';
      })() && (
        <Button
          className="mt-3"
          onClick={async () => {
            try {
              const next = await api(`/orders/${order.id}/milestones/next`, { method: 'POST' });
              const a = next.onchain;
              const c = await chainClient();
              const { ixs } = await c.createAndFundBounty(wallet.publicKey!, BigInt(a.orderId), {
                amount: BigInt(a.amount), verifier: a.verifier ? pk(a.verifier) : undefined, verifierFee: BigInt(a.verifierFee), termsHash: hexBytes(a.termsHash), criteriaHash: hexBytes(a.criteriaHash),
                licenseHash: hexBytes(a.licenseHash), deadline: a.deadline, maxCorrections: a.maxCorrections, designatedSeller: pk(a.designatedSeller), arbitrator: a.arbitrator ? pk(a.arbitrator) : undefined,
              });
              await sendWithWallet(wallet, ixs);
              await api(`/orders/${next.orderId}/confirm`, { method: 'POST' });
              reload();
            } catch (e) {
              onError(e);
            }
          }}
        >
          Fund next milestone
        </Button>
      )}
    </Card>
  );
}

function ArbitratorRuling({ address, orderId, onDone, onError }: { address: string; orderId: string; onDone: () => void; onError: (e: unknown) => void }) {
  const wallet = useWallet();
  const [bps, setBps] = useState('5000');
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Seller share (basis points)"><input className={inputCls} value={bps} onChange={(e) => setBps(e.target.value)} /></Field>
      <Button onClick={async () => { try { const c = await chainClient(); await sendWithWallet(wallet, await c.resolveDispute(wallet.publicKey!, pk(address), 'split', Number(bps))); await api(`/orders/${orderId}/sync`, { method: 'POST' }); onDone(); } catch (e) { onError(e); } }}>Rule: split</Button>
      <Button variant="ghost" onClick={async () => { try { const c = await chainClient(); await sendWithWallet(wallet, await c.resolveDispute(wallet.publicKey!, pk(address), 'correction', 0)); await api(`/orders/${orderId}/sync`, { method: 'POST' }); onDone(); } catch (e) { onError(e); } }}>Rule: correction</Button>
    </div>
  );
}

function PrivateDeliveryPanel({ orderId, role, state }: { orderId: string; role: string | null; state: string }) {
  const { data, reload } = useApi<any>(role === 'buyer' || role === 'seller' ? `/orders/${orderId}/delivery-key` : null);
  const [err, setErr] = useState<unknown>(null);
  const [files, setFiles] = useState<any[] | null>(null);
  if (!data?.encrypted) return null;
  return (
    <Card title="Encrypted delivery" right={<Badge>advanced private mode</Badge>}>
      <p className="mb-2 text-sm text-muted">Files are encrypted end-to-end. EdgeBounty stores ciphertext only; the seller seals the key to a key generated in the buyer&apos;s browser after settlement.</p>
      {role === 'buyer' && !data.buyerBoxPublicKey && (
        <Button onClick={async () => { try { const m = await import('@/lib/private-delivery'); await m.registerBuyerBoxKey(orderId); reload(); } catch (e) { setErr(e); } }}>Register my decryption key</Button>
      )}
      {role === 'buyer' && data.buyerBoxPublicKey && !data.envelope && <p className="text-sm">Decryption key registered. Waiting for the seller to release the content key after settlement.</p>}
      {role === 'seller' && state === 'settled' && !data.envelope && (
        <Button onClick={async () => { try { const m = await import('@/lib/private-delivery'); const r = await api(`/orders/${orderId}/review`); const sub = await api(`/orders/${orderId}`); const v = sub.submissions?.at(-1)?.assetVersionId ?? r.versionId; await m.sealKeyForBuyer(orderId, v); reload(); } catch (e) { setErr(e); } }}>Release key to buyer</Button>
      )}
      {role === 'buyer' && data.envelope && state === 'settled' && (
        <>
          <Button onClick={async () => setFiles((await api(`/orders/${orderId}/delivery`)).files)}>List encrypted files</Button>
          <ul className="mono mt-2 text-xs">{files?.map((f) => <li key={f.path}><button className="underline" onClick={async () => { try { const m = await import('@/lib/private-delivery'); await m.downloadDecrypted(orderId, f); } catch (e) { setErr(e); } }}>{f.path.replace(/\.enc$/, '')}</button> (decrypted locally)</li>)}</ul>
        </>
      )}
      <ErrorNote error={err} />
    </Card>
  );
}
