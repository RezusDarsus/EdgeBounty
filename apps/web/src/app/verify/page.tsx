'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { sol } from '@/lib/format';
import { chainClient, hexBytes, sendWithWallet } from '@/lib/chain';
import { RequireSession } from '@/components/nav';
import { AssetUploader, type UploadedAsset } from '@/components/uploader';
import { Button, Card, ErrorNote, Field, Notice, Page, inputCls } from '@/components/ui';

const LEVELS = [
  ['L1', 'Technical checks', 'Readability, corruption, dimensions, formats, exact duplicates, annotation and schema validity.'],
  ['L2', 'Lightweight statistics', 'Adds perceptual-hash near duplicates, outliers and label-consistency heuristics.'],
  ['L3', 'Sampled AI review', 'Adds a seeded random sample reviewed by a multimodal model, reported as an estimate with a 95% interval.'],
] as const;

/** Module E — standalone verification for users who never buy or sell. */
export default function Verify() {
  const router = useRouter();
  const wallet = useWallet();
  const { data: benchmarks } = useApi<any[]>('/benchmarks');
  const [kind, setKind] = useState<'dataset' | 'model'>('dataset');
  const [asset, setAsset] = useState<UploadedAsset | null>(null);
  const [level, setLevel] = useState<'L1' | 'L2' | 'L3'>('L2');
  const [benchmarkId, setBenchmarkId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [quote, setQuote] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);

  async function getQuote() {
    setErr(null);
    try {
      setQuote(await api('/verification/quote', { body: { assetVersionId: asset!.versionId, level, benchmarkId: benchmarkId || undefined } }));
    } catch (e) {
      setErr(e);
    }
  }

  async function run() {
    setErr(null);
    try {
      const criteria = kind === 'dataset' && level === 'L3' && prompt ? { kind: 'image_dataset', minImages: 1, minRelevanceBps: 0, relevancePrompt: prompt } : undefined;
      const r = await api('/verification/jobs', { body: { assetVersionId: asset!.versionId, level, criteria, benchmarkId: benchmarkId || undefined } });
      if (r.invoice) {
        const c = await chainClient();
        await sendWithWallet(wallet, await c.payService(wallet.publicKey!, hexBytes(r.invoice.reference), r.invoice.serviceKind, BigInt(r.invoice.amountMicro)));
        await api(`/invoices/${r.invoice.id}/confirm`, { method: 'POST' });
      }
      router.push(`/verify/${r.job.id}`);
    } catch (e) {
      setErr(e);
    }
  }

  return (
    <RequireSession>
      <Page kicker="Private verification" title="Verify a dataset or model" subtitle="Analyse a private asset without selling it. You get a report that separates confirmed errors, suspected issues, estimates and untested requirements.">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="1 · Asset">
            <div className="mb-3 flex gap-2">
              {(['dataset', 'model'] as const).map((k) => (
                <button key={k} disabled={!!asset} onClick={() => setKind(k)} className={`rounded-[2px] border px-3 py-1.5 text-sm transition-colors ${kind === k ? 'border-ink bg-ink text-paper' : 'border-line'}`}>{k}</button>
              ))}
            </div>
            <AssetUploader kind={kind} purpose="verification" name="verification upload" accept={kind === 'model' ? '.onnx,.safetensors' : undefined} onDone={setAsset} />
          </Card>
          <Card title="2 · Analysis">
            <div className="space-y-2">
              {LEVELS.map(([l, t, d]) => (
                <label key={l} className={`block cursor-pointer rounded-md border p-3 ${level === l ? 'border-ink bg-panel shadow-[inset_3px_0_0_var(--accent)]' : 'border-line'}`}>
                  <input type="radio" className="mr-2" checked={level === l} onChange={() => { setLevel(l); setQuote(null); }} />
                  <b>Level {l.slice(1)} · {t}</b>
                  <p className="text-sm text-muted">{d}</p>
                </label>
              ))}
            </div>
            {kind === 'dataset' && level === 'L3' && (
              <Field label="What should the images show?"><input className={`${inputCls} mt-2`} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Vehicles with a visibly broken window" /></Field>
            )}
            {kind === 'model' && (
              <Field label="Benchmark">
                <select className={`${inputCls} mt-2`} value={benchmarkId} onChange={(e) => setBenchmarkId(e.target.value)}>
                  <option value="">Static inspection only</option>
                  {benchmarks?.map((b) => <option key={b.id} value={b.id}>{b.id} — {b.task}</option>)}
                </select>
              </Field>
            )}
            <div className="mt-4 flex gap-2">
              <Button variant="ghost" onClick={getQuote} disabled={!asset}>Get exact quote</Button>
              <Button onClick={run} disabled={!asset || !quote}>{quote ? `Pay ${sol(quote.priceMicro)} & run` : 'Run'}</Button>
            </div>
            {quote && (
              <div className="mt-3 text-sm">
                <ul>{quote.lines.map((l: any, i: number) => <li key={i} className="flex justify-between"><span>{l.label}</span><span>{sol(l.amount)}</span></li>)}</ul>
                <p className="mt-1 text-xs text-muted">Budget: up to {quote.budget.maxItems.toLocaleString()} items, {quote.budget.maxSeconds}s, {quote.budget.maxApiCalls} AI calls. If the data differs materially, the job stops and asks you to re-authorize. Credits available: {sol(quote.credits)}.</p>
              </div>
            )}
            <ErrorNote error={err} />
          </Card>
        </div>
        <div className="mt-4"><Notice>Want an on-chain certificate from an independent provider? Create a provider job from the job page after it completes.</Notice></div>
      </Page>
    </RequireSession>
  );
}
