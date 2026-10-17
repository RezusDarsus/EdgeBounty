'use client';
import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { date, sol } from '@/lib/format';
import { Badge, Empty, LinkCard, Page } from '@/components/ui';

export default function FailureBounties() {
  const { data } = useApi<any[]>('/failure-bounties');
  return (
    <Page
      title="AI failure bounties"
      subtitle="Model owners pay contributors for independently verified examples where their model fails. Exact duplicates are rejected on-chain; each example is re-run against the committed model version."
      actions={<Link href="/failure-bounties/new" className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink transition-colors hover:bg-[color-mix(in_oklab,var(--accent),var(--ink)_18%)]">New failure bounty</Link>}
    >
      {data?.length === 0 && <Empty>No open failure bounties.</Empty>}
      <div className="grid gap-3 md:grid-cols-2">
        {data?.map((b) => (
          <LinkCard key={b.id} href={`/failure-bounties/${b.id}`}>
            <div className="flex justify-between gap-2"><h3 className="font-semibold">{b.title}</h3><span className="whitespace-nowrap font-medium">{sol(b.rewardMicro)} / example</span></div>
            <p className="mt-1 line-clamp-2 text-sm text-muted">{b.description}</p>
            <div className="mt-3 flex flex-wrap gap-2"><Badge tone="good">{b.accepted}/{b.maxExamples} paid</Badge><Badge>{b.spec.kind.replace(/_/g, ' ')}</Badge><Badge>expires {date(b.expiresAt)}</Badge></div>
          </LinkCard>
        ))}
      </div>
    </Page>
  );
}
