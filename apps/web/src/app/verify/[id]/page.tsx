'use client';
import { use, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { CAPABILITIES } from '@edgebounty/shared-types';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { CURRENCY, toMicro, sol } from '@/lib/format';
import { chainClient, hexBytes, pk, platformConfig, sendWithWallet } from '@/lib/chain';
import { RequireSession } from '@/components/nav';
import { ReportView } from '@/components/report';
import { Badge, Button, Card, ErrorNote, Field, KV, Page, inputCls } from '@/components/ui';

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: j, reload, error } = useApi<any>(`/verification/jobs/${id}`);
  const { data: providers } = useApi<any[]>('/providers');
  const wallet = useWallet();
  const [provider, setProvider] = useState('platform');
  const [price, setPrice] = useState('5');
  const [err, setErr] = useState<unknown>(null);
  const [cert, setCert] = useState<string | null>(null);

  useEffect(() => {
    if (!j || ['completed', 'failed', 'needs_authorization'].includes(j.status)) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [j, reload]);

  function exportReport() {
    const blob = new Blob([JSON.stringify({ report: j.result.report, reportHash: j.result.reportHash }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `edgebounty-report-${id}.json`;
    a.click();
  }

  async function requestCertificate() {
    setErr(null);
    try {
      const cfg = await platformConfig();
      const providerWallet = provider === 'platform' ? cfg.platformVerifier : provider;
      const cap = j.result.report.modelMetrics ? CAPABILITIES.model_vision : CAPABILITIES.dataset_image;
      const prep = await api('/provider-jobs', { body: { assetVersionId: j.assetVersionId, level: j.level, criteria: j.criteria ?? undefined, priceMicro: toMicro(price), providerWallet, requiredCapability: cap, deadline: new Date(Date.now() + 2 * 86_400_000).toISOString() } });
      const a = prep.onchain;
      const c = await chainClient();
      const { ixs } = await c.createVerificationJob(wallet.publicKey!, BigInt(a.jobId), { provider: a.provider ? pk(a.provider) : undefined, requiredCapability: a.requiredCapability, assetCommitment: hexBytes(a.assetCommitment), specHash: hexBytes(a.specHash), price: BigInt(a.price), deadline: a.deadline });
      await sendWithWallet(wallet, ixs);
      await api(`/provider-jobs/${prep.job.id}/sync`, { method: 'POST' });
      setCert(prep.job.onchainAddress);
    } catch (e) {
      setErr(e);
    }
  }

  return (
    <RequireSession>
      <Page title="Verification job" subtitle={j && <span className="flex items-center gap-2"><Badge tone={j.status === 'completed' ? 'good' : j.status === 'failed' ? 'bad' : 'warn'}>{j.status}</Badge> Level {j.level.slice(1)} · quoted {sol(j.quoteMicro)}</span>}>
        <ErrorNote error={error} />
        {j && (
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Card title="Report" right={j.result && <Button variant="ghost" onClick={exportReport}>Export JSON</Button>}>
              {j.result ? <ReportView report={j.result.report} reportHash={j.result.reportHash} attestation={j.result.attestation} /> : <p className="text-sm text-muted">{j.status === 'needs_authorization' ? j.error : j.error ?? 'Running in an isolated worker…'}</p>}
              {j.status === 'needs_authorization' && <Button className="mt-3" onClick={async () => { await api(`/verification/jobs/${id}/reauthorize`, { method: 'POST' }); reload(); }}>Accept new quote</Button>}
            </Card>
            <div className="space-y-4">
              <Card title="Job">
                <KV rows={[['Spec hash', <span key="s" className="mono break-all">{j.specHash.slice(0, 24)}…</span>], ['Actual cost', sol(j.actualCostMicro)], ['Budget', `${j.budget.maxItems} items · ${j.budget.maxSeconds}s`]]} />
              </Card>
              {j.result && (
                <Card title="On-chain certificate">
                  <p className="mb-2 text-sm text-muted">An approved provider evaluates the same commitment and spec and signs an attestation. You pay for the work, not for a pass.</p>
                  <Field label="Provider">
                    <select className={inputCls} value={provider} onChange={(e) => setProvider(e.target.value)}>
                      <option value="platform">EdgeBounty platform verifier</option>
                      {providers?.map((p) => <option key={p.wallet} value={p.wallet}>{p.profile?.name ?? p.wallet.slice(0, 8)}</option>)}
                    </select>
                  </Field>
                  <Field label={`Price (${CURRENCY})`}><input className={inputCls} value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
                  <Button className="mt-2" onClick={requestCertificate}>Escrow & request</Button>
                  {cert && <p className="mt-2 text-sm">Job created: <span className="mono">{cert.slice(0, 12)}…</span> — the provider will accept and attest.</p>}
                  <ErrorNote error={err} />
                </Card>
              )}
            </div>
          </div>
        )}
      </Page>
    </RequireSession>
  );
}
