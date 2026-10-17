'use client';
import { use } from 'react';
import { useApi } from '@/lib/hooks';
import { Badge, Card, ErrorNote, Hash, KV, Page } from '@/components/ui';

export default function ProviderPage({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = use(params);
  const { data: p, error } = useApi<any>(`/providers/${wallet}`);
  if (error) return <Page title="Provider"><ErrorNote error={error} /></Page>;
  if (!p) return <Page title="Loading…"><span /></Page>;
  const pr = p.profile ?? {};
  return (
    <Page title={pr.name ?? 'Provider'} subtitle={<Hash value={p.wallet} />}>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Profile">
          <KV
            rows={[
              ['Status', p.approved ? <Badge key="a" tone="good">approved</Badge> : <Badge key="a" tone="warn">pending approval</Badge>],
              ['Capabilities', p.capabilities.join(', ') || '—'],
              ['Asset types', pr.assetTypes?.join(', ') ?? '—'],
              ['Hardware', pr.hardware ?? '—'],
              ['Methods', pr.methods?.join(', ') ?? '—'],
              ['Pricing', pr.pricing ?? '—'],
              ['Capacity', pr.capacityJobsPerDay ? `${pr.capacityJobsPerDay} jobs/day` : '—'],
              ['Security', pr.securityCapabilities?.join(', ') ?? '—'],
              ['Profile hash', <Hash key="h" value={p.metadataHash} />],
            ]}
          />
          <p className="mt-3 whitespace-pre-wrap text-sm">{pr.description}</p>
        </Card>
        <Card title="Track record">
          <KV
            rows={[
              ['Completed jobs (on-chain)', p.onchain?.jobsCompleted ?? p.jobsCompleted],
              ['Disputed jobs', p.onchain?.jobsDisputed ?? p.jobsDisputed],
              ['Random audits agreed', p.audits.agreed],
              ['Random audits disagreed', p.audits.disagreed],
            ]}
          />
          <p className="mt-3 text-xs text-muted">A share of submitted reports is independently re-run by the platform. Disagreements are reviewed; they are not automatically proof of misconduct.</p>
        </Card>
      </div>
    </Page>
  );
}
