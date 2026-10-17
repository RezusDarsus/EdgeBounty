'use client';
import { use } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { bytes, date, sol } from '@/lib/format';
import { Badge, Empty, ErrorNote, Page, PageLoading } from '@/components/ui';

type View = { id: string; title: string; description: string; public: boolean; mine: boolean; owner: { alias: string | null }; updatedAt: string; items: { note: string; addedAt: string; listing: any }[] };

export default function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading } = useApi<View>(`/collections/${id}`);
  if (loading && !data) return <PageLoading />;
  if (!data) return <Page title="Collection"><ErrorNote error={error ?? new Error('This collection is private or no longer exists.')} /></Page>;
  return (
    <Page
      kicker={<>Collection · {data.public ? 'shared' : 'private'}{data.owner.alias ? ` · by ${data.owner.alias}` : ''}</>}
      title={data.title}
      subtitle={data.description || undefined}
      actions={data.mine ? <Link href="/dashboard" className="text-sm underline">Manage in dashboard</Link> : undefined}
    >
      {data.mine && !data.public && <p className="mb-6 text-sm text-muted">Only you can see this collection. Share it from the dashboard to give others this link.</p>}
      {data.items.length === 0 && <Empty>No published listings in this collection.</Empty>}
      <ul className="divide-y divide-line border-y border-line">
        {data.items.map(({ listing: l, note, addedAt }) => (
          <li key={l.id} className="grid gap-2 py-4 sm:grid-cols-[1fr_auto] sm:items-baseline">
            <div className="min-w-0">
              <Link href={`/listings/${l.id}`} className="display text-[20px] leading-snug underline-offset-4 hover:underline">{l.title}</Link>
              <p className="mt-1 text-xs capitalize text-muted">{l.kind} · {l.category.replace(/_/g, ' ')} · {bytes(l.asset.totalSize)} · saved {date(addedAt)}</p>
              {note && <p className="mt-2 text-sm text-ink-2">{note}</p>}
            </div>
            <div className="flex items-center gap-2 sm:justify-end">
              {l.verifiedLevel && <Badge tone="good">Passed {l.verifiedLevel}</Badge>}
              <span className="num">{sol(l.priceMicro)}</span>
            </div>
          </li>
        ))}
      </ul>
    </Page>
  );
}
