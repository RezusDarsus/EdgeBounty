'use client';
import { use, useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { date } from '@/lib/format';
import { Badge, Button, Card, ErrorNote, Hash, KV, Notice, Page, inputCls } from '@/components/ui';

export default function AttestationPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const { data: a, error } = useApi<any>(`/attestations/${address}`);
  const [report, setReport] = useState('');
  const [check, setCheck] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  return (
    <Page title="Verification attestation" subtitle={<Hash value={address} />}>
      <ErrorNote error={error} />
      {a && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="On-chain record">
            <KV rows={[
              ['Result', <Badge key="r" tone={a.passed ? 'good' : 'bad'}>{a.passed ? 'passed' : 'failed'}</Badge>],
              ['Status', a.revoked ? <Badge key="s" tone="bad">revoked</Badge> : <Badge key="s" tone="good">active</Badge>],
              ['Verifier', <Hash key="v" value={a.verifier} />],
              ['Asset commitment', <Hash key="c" value={a.assetCommitment} />],
              ['Asset version', a.assetVersion],
              ['Spec hash', <Hash key="sp" value={a.specHash} />],
              ['Benchmark version', a.benchmarkVersion],
              ['Result hash', <Hash key="rh" value={a.resultHash} />],
              ['Issued', date(a.issuedAt)],
              ['Expires', a.expiresAt ? date(a.expiresAt) : 'no expiry'],
              ['Subject', <Hash key="sub" value={a.subject} />],
            ]} />
            <div className="mt-3"><Notice>{a.disclaimer}</Notice></div>
          </Card>
          <Card title="Check a disclosed report">
            <p className="mb-2 text-sm text-muted">Paste a report JSON that someone shared with you. We recompute its fingerprint and compare it to the on-chain result hash.</p>
            <textarea className={`${inputCls} mono h-40`} value={report} onChange={(e) => setReport(e.target.value)} />
            <Button className="mt-2" onClick={async () => { setErr(null); try { const parsed = JSON.parse(report); setCheck(await api(`/attestations/${address}/verify-report`, { body: { report: parsed.report ?? parsed } })); } catch (e) { setErr(e); } }}>Verify</Button>
            {check && <p className="mt-2 text-sm">{check.matches ? <Badge tone="good">matches the attestation</Badge> : <Badge tone="bad">does not match</Badge>}</p>}
            <ErrorNote error={err} />
          </Card>
        </div>
      )}
    </Page>
  );
}
