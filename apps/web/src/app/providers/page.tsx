'use client';
import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { Badge, Empty, LinkCard, Page } from '@/components/ui';

export default function Providers() {
  const { data } = useApi<any[]>('/providers');
  return (
    <Page
      title="Verification providers"
      subtitle="Approved providers who sell reproducible evaluations. Registration alone grants no trust: providers are approved by capability, audited by random re-runs, and excluded when conflicted."
      actions={<Link href="/provider" className="rounded-lg border border-line bg-panel px-3 py-2 text-sm">Provider dashboard</Link>}
    >
      {data?.length === 0 && <Empty>No approved providers yet.</Empty>}
      <div className="grid gap-3 md:grid-cols-2">
        {data?.map((p) => (
          <LinkCard key={p.wallet} href={`/providers/${p.wallet}`}>
            <h3 className="font-semibold">{p.profile?.name ?? `${p.wallet.slice(0, 8)}…`}</h3>
            <p className="mt-1 line-clamp-2 text-sm text-muted">{p.profile?.description ?? 'No public profile.'}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {p.capabilities.map((c: string) => <Badge key={c}>{c.replace('_', ' ')}</Badge>)}
              <Badge tone="good">{p.jobsCompleted} jobs</Badge>
              {p.jobsDisputed > 0 && <Badge tone="warn">{p.jobsDisputed} disputed</Badge>}
            </div>
          </LinkCard>
        ))}
      </div>
    </Page>
  );
}
