'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { DATASET_CATEGORIES } from '@edgebounty/shared-types';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { CURRENCY, sol, toMicro } from '@/lib/format';
import { chainClient, hexBytes, sendWithWallet } from '@/lib/chain';
import { RequireSession } from '@/components/nav';
import { AssetUploader, type UploadedAsset } from '@/components/uploader';
import { Button, Card, ErrorNote, Field, Notice, Page, inputCls } from '@/components/ui';
export default function Sell() {
  const router = useRouter();
  const wallet = useWallet();
  const { data: licenses } = useApi<any[]>('/licenses');
  const [kind, setKind] = useState<'dataset' | 'model'>('dataset');
  const [uploadKey, setUploadKey] = useState(0);
  const [asset, setAsset] = useState<UploadedAsset | null>(null);
  const [f, setF] = useState({ title: '', description: '', category: 'image_classification', formats: '', recordCount: '', language: '', labeling: '', licenseId: 'eb-nonexclusive-commercial-v1', price: '0.1', classes: '', inputSize: '224' });
  const [level, setLevel] = useState<'L2' | 'L3'>('L2');
  const [quote, setQuote] = useState<{ priceMicro: string; lines: { label: string; amount: string }[] } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<any>(null);
  const { data: job, error: jobError, reload: reloadJob } = useApi<any>(jobId ? `/verification/jobs/${jobId}` : null);
  const verified = job?.status === 'completed' && job?.result?.passed === true;
  useEffect(() => {
    if (!asset || jobId) return;
    let active = true;
    setQuote(null);
    api<any>('/verification/quote', { body: { assetVersionId: asset.versionId, level } }).then((q) => { if (active) setQuote(q); }).catch((e) => { if (active) setErr(e); });
    return () => { active = false; };
  }, [asset, level, jobId]);
  useEffect(() => {
    if (!jobId || ['completed', 'failed', 'needs_authorization'].includes(job?.status)) return;
    const timer = setInterval(() => void reloadJob(), 3000);
    return () => clearInterval(timer);
  }, [jobId, job?.status, reloadJob]);
  const [err, setErr] = useState<unknown>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function verify() {
    setErr(null);
    try {
      let payment = invoice;
      if (!jobId) {
        const r = await api<any>('/verification/jobs', { body: { assetVersionId: asset!.versionId, level } });
        setJobId(r.job.id);
        setInvoice(r.invoice);
        payment = r.invoice;
      }
      if (payment) {
        const c = await chainClient();
        await sendWithWallet(wallet, await c.payService(wallet.publicKey!, hexBytes(payment.reference), payment.serviceKind, BigInt(payment.amountMicro)));
        await api(`/invoices/${payment.id}/confirm`, { method: 'POST' });
        setInvoice(null);
      }
      await reloadJob();
    } catch (e) { setErr(e); }
  }
  async function publish() {
    setErr(null);
    try {
      if (!verified) throw new Error('Complete verification before publishing.');
      const prep = await api('/listings', {
        body: {
          assetVersionId: asset!.versionId,
          title: f.title,
          description: f.description,
          category: f.category,
          formats: f.formats.split(',').map((s) => s.trim()).filter(Boolean),
          recordCount: f.recordCount ? Number(f.recordCount) : undefined,
          language: f.language || undefined,
          labeling: f.labeling || undefined,
          licenseId: f.licenseId,
          priceMicro: toMicro(f.price),
          details:
            kind === 'model' && f.classes
              ? { task: f.category, inference: { size: [Number(f.inputSize), Number(f.inputSize)], scale: 255, mean: [0, 0, 0], std: [1, 1, 1], layout: 'NCHW', classes: f.classes.split(',').map((x) => x.trim()) } }
              : {},
        },
      });
      const a = prep.onchain;
      const c = await chainClient();
      const { ixs } = await c.createListing(wallet.publicKey!, BigInt(a.listingId), a.kind, {
        assetCommitment: hexBytes(a.assetCommitment),
        termsHash: hexBytes(a.termsHash),
        licenseHash: hexBytes(a.licenseHash),
        price: BigInt(a.price),
      });
      await sendWithWallet(wallet, ixs);
      await api(`/listings/${prep.listing.id}/confirm`, { method: 'POST' });
      router.push(`/listings/${prep.listing.id}`);
    } catch (e) {
      setErr(e);
    }
  }
  return (
    <RequireSession>
      <Page kicker="Sell" title="Sell a dataset or model" subtitle="Upload privately, then publish an immutable, versioned listing. Buyers see limited previews and verification reports; the full asset is delivered only after settlement.">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="1 · Upload">
            <div className="mb-3 flex gap-2">
              {(['dataset', 'model'] as const).map((k) => (
                <button key={k} disabled={!!asset} onClick={() => setKind(k)} className={`rounded-[2px] border px-3 py-1.5 text-sm transition-colors ${kind === k ? 'border-ink bg-ink text-paper' : 'border-line'}`}>
                  {k}
                </button>
              ))}
            </div>
            {kind === 'model' && <Notice>Models: upload a single .onnx file (or .safetensors for header-only inspection). Custom Python code is never executed.</Notice>}
            <div className="mt-3">
              <AssetUploader key={uploadKey} kind={kind} purpose="listing" name={f.title || `${kind} listing`} accept={kind === 'model' ? '.onnx,.safetensors' : undefined} onDone={setAsset} />
            </div>
            {asset && <p className="mt-3 text-sm text-muted">Basic preview checks start automatically. Complete the verification step below before publishing.</p>}
          </Card>
          <Card title="2 · Listing terms">
            <div className="space-y-3">
              <Field label="Title">
                <input className={inputCls} value={f.title} onChange={set('title')} />
              </Field>
              <Field label="Description" hint="Contents, collection method, labeling protocol, known limitations.">
                <textarea className={`${inputCls} h-28`} value={f.description} onChange={set('description')} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category">
                  <select className={inputCls} value={f.category} onChange={set('category')}>
                    {DATASET_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Formats" hint="comma separated">
                  <input className={inputCls} value={f.formats} onChange={set('formats')} placeholder="png, csv" />
                </Field>
                <Field label="Records">
                  <input className={inputCls} value={f.recordCount} onChange={set('recordCount')} />
                </Field>
                <Field label="Language">
                  <input className={inputCls} value={f.language} onChange={set('language')} />
                </Field>
              </div>
              {kind === 'model' && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Output classes" hint="comma separated, enables sandboxed inference trials"><input className={inputCls} value={f.classes} onChange={set('classes')} /></Field>
                  <Field label="Input size (px)"><input className={inputCls} value={f.inputSize} onChange={set('inputSize')} /></Field>
                </div>
              )}
              <Field label="Labeling">
                <input className={inputCls} value={f.labeling} onChange={set('labeling')} placeholder="e.g. YOLO boxes, double-annotated" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Rights the buyer receives" hint="Choose the usage rights granted by this license.">
                  <select className={inputCls} value={f.licenseId} onChange={set('licenseId')}>
                    {licenses?.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.id === 'eb-nonexclusive-commercial-v1' ? 'Commercial use — you retain ownership' : l.id === 'eb-nonexclusive-research-v1' ? 'Research use only — you retain ownership' : l.id === 'eb-exclusive-transfer-v1' ? 'Exclusive ownership transfer' : l.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={`Price (${CURRENCY})`} hint="6% platform fee on sale">
                  <input className={inputCls} value={f.price} onChange={set('price')} />
                </Field>
              </div>
              <div className="space-y-3 rounded-md border border-line p-3">
                <p className="font-medium">Verify before publishing</p>
                <Field label="Checks" hint="Reports describe the tested scope and any limitations; a pass is not a guarantee of every use case.">
                  <select className={inputCls} value={level} disabled={!!jobId} onChange={(e) => setLevel(e.target.value as 'L2' | 'L3')}>
                    <option value="L2">Full-file technical and quality checks</option>
                    {kind === 'dataset' && <option value="L3">Quality checks with sampled AI review</option>}
                  </select>
                </Field>
                {quote && <div className="text-sm"><p>Fixed verification quote: {sol(quote.priceMicro)}</p>{quote.lines.map((line, i) => <p key={i} className="text-xs text-muted">{line.label}: {sol(line.amount)}</p>)}</div>}
                {!verified && (!jobId || job?.status === 'awaiting_payment' || invoice) && <Button onClick={verify} disabled={!asset || !quote}>Pay {invoice ? sol(invoice.amountMicro) : quote ? sol(quote.priceMicro) : ''} and start verification</Button>}
                {job && <p role="status" className="text-sm">{verified ? 'Verification passed. Ready to publish.' : job.status === 'completed' ? 'Verification failed. Resolve the reported issues and upload a corrected version.' : `Verification: ${job.status.replaceAll('_', ' ')}`}</p>}
                {jobId && <a className="text-sm underline" href={`/verify/${jobId}`}>View report and verification details</a>}
                {(job?.status === 'failed' || (job?.status === 'completed' && !verified)) && <Button variant="ghost" onClick={() => { setAsset(null); setJobId(null); setInvoice(null); setQuote(null); setErr(null); setUploadKey((v) => v + 1); }}>Upload a corrected version</Button>}
                <ErrorNote error={jobError} />
              </div>
              <Button onClick={publish} disabled={!verified || f.title.length < 3 || f.description.length < 10}>
                Publish on-chain
              </Button>
              <p className="text-xs text-muted">You warrant you hold the rights to license this asset. Listing terms and the content commitment are recorded on-chain.</p>
              <ErrorNote error={err} />
            </div>
          </Card>
        </div>
      </Page>
    </RequireSession>
  );
}
