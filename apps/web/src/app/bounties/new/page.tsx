'use client';
import { useEffect, useState } from 'react';
import { BountyDraft } from '@/components/bounty-draft';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { CURRENCY, toMicro, sol } from '@/lib/format';
import { chainClient, hexBytes, pk, platformConfig, sendWithWallet } from '@/lib/chain';
import { RequireSession } from '@/components/nav';
import { Button, Card, ErrorNote, Field, LedgerLine, Page, inputCls } from '@/components/ui';
type Kind = 'image_dataset' | 'tabular_dataset' | 'model';
export default function NewBounty() {
  const router = useRouter();
  const wallet = useWallet();
  const { data: licenses } = useApi<any[]>('/licenses');
  const { data: benchmarks } = useApi<any[]>('/benchmarks');
  const [kind, setKind] = useState<Kind>('image_dataset');
  const [f, setF] = useState({
    title: '', description: '', deliverables: '', licenseId: 'eb-nonexclusive-commercial-v1', budget: '0.1', deadlineDays: '14', maxCorrections: '1', 
    minImages: '1000', minWidth: '640', minHeight: '640', maxExactDuplicates: '0', minReadablePct: '100', minRelevancePct: '', relevancePrompt: '',
    minRows: '10000', requiredColumns: '', maxNullPct: '5', maxDupRowPct: '1',
    task: 'image_classification', benchmarkId: '', metric: 'accuracy', threshold: '0.9', maxLatencyMs: '',
    structure: 'single', slots: '3', milestones: 'Data collection:0.06:7\nLabelling:0.04:14', arbitrator: '',
  });
  const [verificationQuote, setVerificationQuote] = useState<{ feeMicro: string; rounds: number; key: string } | null>(null);
  const [quoteError, setQuoteError] = useState<unknown>(null);
  const [err, setErr] = useState<unknown>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const bps = (p: string) => Math.round(Number(p) * 100);
  function criteria() {
    if (kind === 'image_dataset')
      return {
        kind, minImages: Number(f.minImages), minWidth: Number(f.minWidth), minHeight: Number(f.minHeight), maxExactDuplicates: Number(f.maxExactDuplicates), minReadableBps: bps(f.minReadablePct),
        ...(f.minRelevancePct ? { minRelevanceBps: bps(f.minRelevancePct), relevancePrompt: f.relevancePrompt || f.title } : {}),
      };
    if (kind === 'tabular_dataset')
      return { kind, minRows: Number(f.minRows), requiredColumns: f.requiredColumns.split(',').map((s) => s.trim()).filter(Boolean), maxNullBps: bps(f.maxNullPct), maxDuplicateRowBps: bps(f.maxDupRowPct) };
    return { kind, task: f.task, benchmarkId: f.benchmarkId, metric: f.metric, thresholdE4: Math.round(Number(f.threshold) * 10_000), ...(f.maxLatencyMs ? { maxLatencyMs: Number(f.maxLatencyMs) } : {}) };
  }
  const quoteKey = JSON.stringify({ criteria: criteria(), maxCorrections: Number(f.maxCorrections) });
  const quoteReady = verificationQuote?.key === quoteKey;
  const includedDeliverables = kind === 'model' ? ['Model weights in ONNX format', 'README with inputs, outputs, and usage instructions'] : kind === 'tabular_dataset' ? ['Dataset in CSV or Parquet format', 'Column definitions and collection notes'] : ['Image files', 'Labels or annotations in the agreed format', 'README with collection and labeling notes'];
  useEffect(() => {
    let active = true;
    setQuoteError(null);
    const timer = setTimeout(() => {
      api<any>('/bounties/verification-quote', { body: JSON.parse(quoteKey) }).then((q) => { if (active) setVerificationQuote({ ...q, key: quoteKey }); }).catch((e) => { if (active) setQuoteError(e); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [quoteKey]);
  async function submit() {
    setErr(null);
    try {
      const cfg = await platformConfig();
      if (!quoteReady) throw new Error('Wait for the platform verification quote.');
      const verifierWallet = cfg.platformVerifier;
      if (!verifierWallet) throw new Error('Platform verification is unavailable.');
      const prep = await api('/bounties', {
        body: {
          title: f.title, description: f.description, deliverables: [...includedDeliverables, ...f.deliverables.split('\n').map((s) => s.trim()).filter(Boolean)], criteria: criteria(), licenseId: f.licenseId, ipTerms: f.licenseId === 'eb-exclusive-transfer-v1' ? 'assignment' : 'non_exclusive_license',
          budgetMicro: toMicro(f.budget), deadline: new Date(Date.now() + Number(f.deadlineDays) * 86_400_000).toISOString(), maxCorrections: Number(f.maxCorrections),
          verifierWallet,
          ...(f.arbitrator ? { arbitratorWallet: f.arbitrator } : {}),
          structure: f.structure,
          ...(f.structure === 'slots' ? { slots: Number(f.slots) } : {}),
          ...(f.structure === 'milestones'
            ? { milestones: f.milestones.split('\n').filter(Boolean).map((line) => { const [title, amount, days] = line.split(':'); return { title: title.trim(), amountMicro: toMicro(amount.trim()), deadline: new Date(Date.now() + Number(days) * 86_400_000).toISOString() }; }) }
            : {}),
        },
      });
      const c = await chainClient();
      const mint = (await c.config())!.paymentMint;
      for (const part of prep.fundNow as { orderId: string; onchain: any }[]) {
        const a = part.onchain;
        const { ixs } = await c.createAndFundBounty(wallet.publicKey!, BigInt(a.orderId), {
          amount: BigInt(a.amount), verifier: a.verifier ? pk(a.verifier) : undefined, verifierFee: BigInt(a.verifierFee), verifierCapability: 0,
          termsHash: hexBytes(a.termsHash), criteriaHash: hexBytes(a.criteriaHash), licenseHash: hexBytes(a.licenseHash), deadline: a.deadline, maxCorrections: a.maxCorrections,
          designatedSeller: a.designatedSeller ? pk(a.designatedSeller) : undefined, arbitrator: a.arbitrator ? pk(a.arbitrator) : undefined,
        });
        await sendWithWallet(wallet, [c.ensureAta(wallet.publicKey!, wallet.publicKey!, mint), ...ixs]);
        await api(`/orders/${part.orderId}/confirm`, { method: 'POST' });
      }
      router.push(`/orders/${prep.order.id}`);
    } catch (e) {
      setErr(e);
    }
  }
  const total = (() => {
    try {
      if (!quoteReady) return null;
      const fee = BigInt(verificationQuote!.feeMicro);
      return f.structure === 'milestones' ? BigInt(toMicro(f.milestones.split('\n')[0].split(':')[1]?.trim() ?? '')) + fee : BigInt(toMicro(f.budget)) + fee * BigInt(f.structure === 'slots' ? Number(f.slots) : 1);
    } catch {
      return null;
    }
  })();
  return (
    <RequireSession>
      <Page kicker="New funded request" title="Commission custom work" subtitle="Define the deliverables, acceptance criteria and contributor reward. Contributors decide whether to accept the stated terms. Funds remain in escrow until settlement.">
        <BountyDraft apply={draft => setF(current => ({ ...current, title: draft.title, description: draft.description, deliverables: draft.deliverables.join('\n') }))} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Scope and deliverables">
            <div className="space-y-3">
              <Field label="Title">
                <input className={inputCls} value={f.title} onChange={set('title')} placeholder="Images of broken vehicle windows" />
              </Field>
              <Field label="Description">
                <textarea className={`${inputCls} h-28`} value={f.description} onChange={set('description')} />
              </Field>
              <div className="text-sm">
                <p className="mb-2 font-medium">Required deliverables</p>
                <ul className="list-disc space-y-1 pl-5">{includedDeliverables.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
              <Field label="Additional requirements (optional)" hint="Enter one requirement per line. These terms form part of the agreement.">
                <textarea className={`${inputCls} h-20`} value={f.deliverables} onChange={set('deliverables')} placeholder="For example: annotation guide and collection log" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Contributor reward (${CURRENCY})`} hint="You define the reward. Verification and network fees are charged separately.">
                  <input className={inputCls} value={f.budget} onChange={set('budget')} />
                </Field>
                <Field label="Delivery deadline (days)">
                  <input className={inputCls} value={f.deadlineDays} onChange={set('deadlineDays')} />
                </Field>
                <Field label="Permitted correction rounds">
                  <input className={inputCls} value={f.maxCorrections} onChange={set('maxCorrections')} />
                </Field>
                <Field label="Rights to the delivered work" hint="Select the license terms that will govern this delivery.">
                  <select className={inputCls} value={f.licenseId} onChange={set('licenseId')}>
                    {licenses?.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.id === 'eb-nonexclusive-commercial-v1' ? 'Contributor retains ownership; you receive commercial usage rights' : l.id === 'eb-nonexclusive-research-v1' ? 'Contributor retains ownership; research use only' : l.id === 'eb-exclusive-transfer-v1' ? 'Exclusive ownership transfers to you' : l.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          </Card>
          <Card title="Acceptance criteria">
            <div className="mb-3 flex flex-wrap gap-2">
              {(['image_dataset', 'tabular_dataset', 'model'] as Kind[]).map((k) => (
                <button key={k} onClick={() => setKind(k)} className={`rounded-[2px] border px-3 py-1.5 text-sm transition-colors ${kind === k ? 'border-ink bg-ink text-paper' : 'border-line'}`}>
                  {k.replace('_', ' ')}
                </button>
              ))}
            </div>
            {kind === 'image_dataset' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Minimum distinct images"><input className={inputCls} value={f.minImages} onChange={set('minImages')} /></Field>
                <Field label="Readable files (%)"><input className={inputCls} value={f.minReadablePct} onChange={set('minReadablePct')} /></Field>
                <Field label="Minimum width (px)"><input className={inputCls} value={f.minWidth} onChange={set('minWidth')} /></Field>
                <Field label="Minimum height (px)"><input className={inputCls} value={f.minHeight} onChange={set('minHeight')} /></Field>
                <Field label="Maximum exact duplicates"><input className={inputCls} value={f.maxExactDuplicates} onChange={set('maxExactDuplicates')} /></Field>
                <Field label="Minimum relevance (%)" hint="Sampled AI review (L3); the lower bound of the 95% confidence interval must meet this value."><input className={inputCls} value={f.minRelevancePct} onChange={set('minRelevancePct')} placeholder="Optional, e.g. 95" /></Field>
                {f.minRelevancePct && (
                  <div className="col-span-2">
                    <Field label="Relevance criteria"><input className={inputCls} value={f.relevancePrompt} onChange={set('relevancePrompt')} placeholder="A vehicle photographed with a visibly broken window" /></Field>
                  </div>
                )}
              </div>
            )}
            {kind === 'tabular_dataset' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Minimum rows"><input className={inputCls} value={f.minRows} onChange={set('minRows')} /></Field>
                <Field label="Required columns" hint="Separate column names with commas."><input className={inputCls} value={f.requiredColumns} onChange={set('requiredColumns')} /></Field>
                <Field label="Maximum null cells (%)"><input className={inputCls} value={f.maxNullPct} onChange={set('maxNullPct')} /></Field>
                <Field label="Maximum duplicate rows (%)"><input className={inputCls} value={f.maxDupRowPct} onChange={set('maxDupRowPct')} /></Field>
              </div>
            )}
            {kind === 'model' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Task">
                  <select className={inputCls} value={f.task} onChange={set('task')}>
                    {['image_classification', 'tabular_classification', 'tabular_regression', 'object_detection', 'text_classification', 'speech_recognition'].map((t) => <option key={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Benchmark">
                  <select className={inputCls} value={f.benchmarkId} onChange={set('benchmarkId')}>
                    <option value="">Select…</option>
                    {benchmarks?.map((b) => <option key={b.id} value={b.id}>{b.id} ({b.task})</option>)}
                  </select>
                </Field>
                <Field label="Metric">
                  <select className={inputCls} value={f.metric} onChange={set('metric')}>
                    {['accuracy', 'f1_macro', 'precision_macro', 'recall_macro', 'map50', 'wer', 'cer', 'rmse'].map((t) => <option key={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Threshold" hint="min (max for wer/cer/rmse)"><input className={inputCls} value={f.threshold} onChange={set('threshold')} /></Field>
                <Field label="Max p95 latency (ms)"><input className={inputCls} value={f.maxLatencyMs} onChange={set('maxLatencyMs')} placeholder="optional" /></Field>
              </div>
            )}
            <div className="mt-4 space-y-2 text-sm">
              <p className="font-medium">Platform verification</p>
              <p>{quoteReady ? `Verification fee per delivery: ${sol(verificationQuote!.feeMicro)} · includes ${verificationQuote!.rounds} verification rounds.` : 'Calculating the verification fee…'}</p>
              <p className="text-muted">The fee follows the platform rate schedule and is fixed when the request is funded. Contributors cannot change it. Checks beyond the agreed scope require a separate agreement.</p>
              <ErrorNote error={quoteError} />
            </div>
          </Card>
        </div>
        <Card title="Contract structure" className="mt-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Structure">
              <select className={inputCls} value={f.structure} onChange={set('structure')}>
                <option value="single">Single delivery</option>
                <option value="milestones">Milestones (one developer)</option>
                <option value="slots">Separate contributor slots</option>
              </select>
            </Field>
            {f.structure === 'slots' && <Field label="Slots" hint="The budget is divided equally. Each slot is assigned to a different contributor."><input className={inputCls} value={f.slots} onChange={set('slots')} /></Field>}
            {f.structure === 'milestones' && (
              <Field label="Milestones" hint="one per line: title:amount:days — amounts must add up to the budget; later milestones are funded when the previous one settles">
                <textarea className={`${inputCls} h-20`} value={f.milestones} onChange={set('milestones')} />
              </Field>
            )}
            <Field label="Independent arbitrator (optional)" hint="wallet that may rule on disputes for this contract instead of the platform">
              <input className={inputCls} value={f.arbitrator} onChange={set('arbitrator')} placeholder="arbitrator wallet" />
            </Field>
          </div>
        </Card>
        <section className="mt-6 grid gap-6 rounded-md border border-line bg-panel p-5 sm:p-6 lg:grid-cols-[1fr_380px]" aria-label="Escrow summary">
          <div>
            <h2 className="kicker !text-ink-2">Before you sign</h2>
              <p className="mt-3 max-w-[60ch] text-sm text-ink-2">
              Your wallet will display a single transaction that places the amount shown at right in escrow. No funds are transferred to EdgeBounty or a contributor before settlement. Solana network fees are charged separately in SOL.
            </p>
            <p className="mt-3 max-w-[60ch] text-sm text-ink-2">
              You may reject a delivery only if the agreed verifier records a failed result. If you take no action during the review period, the contributor is paid.
            </p>
          </div>
          <div>
            {(() => {
              const n = f.structure === 'slots' ? Number(f.slots) || 1 : 1;
              let reward: string | null = null;
              try {
                reward = f.structure === 'milestones' ? toMicro(f.milestones.split('\n')[0].split(':')[1]?.trim() ?? '') : toMicro(f.budget);
              } catch {}
              return (
                <LedgerLine
                  rows={[
                    [f.structure === 'milestones' ? 'First milestone reward' : 'Contributor reward', reward ? sol(reward) : '—', f.structure === 'milestones' ? 'subsequent milestones are funded as each preceding milestone settles' : 'held in escrow and released at settlement'],
                    [`Verification fee${n > 1 ? ` × ${n} slots` : ''}`, quoteReady ? sol(BigInt(verificationQuote!.feeMicro) * BigInt(n)) : "Calculating…", 'fixed platform rate, locked at funding'],
                  ]}
                  total={['Total placed in escrow', total !== null ? sol(total) : '—']}
                />
              );
            })()}
            <Button onClick={submit} disabled={f.title.length < 3 || f.description.length < 10 || !quoteReady} className="mt-4 h-11 w-full">
              {total !== null ? `Sign and fund ${sol(total)}` : 'Waiting for the fee quote…'}
            </Button>
            {(f.title.length < 3 || f.description.length < 10) && <p className="mt-2 text-xs text-muted">Enter a title and a description of at least 10 characters to continue.</p>}
          </div>
        </section>
        <div className="mt-3">
          <ErrorNote error={err} />
        </div>
      </Page>
    </RequireSession>
  );
}
