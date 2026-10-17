'use client';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { bytes, sol } from '@/lib/format';
import { previewUrl } from '@/lib/api';
import { Badge, Empty, ErrorNote, LinkCard, Page, inputCls } from './ui';

export function ListingGrid({ kind, title, subtitle }: { kind: 'dataset' | 'model'; title: string; subtitle: string }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const { data, error, loading } = useApi<{ items: any[]; categories: string[] }>(`/listings?kind=${kind}${q ? `&q=${encodeURIComponent(q)}` : ''}${category ? `&category=${category}` : ''}`, [q, category]);
  return (
    <Page title={title} subtitle={subtitle}>
      <div className="mb-4 flex flex-wrap gap-2">
        <input className={`${inputCls} max-w-xs`} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${inputCls} max-w-xs`} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {data?.categories.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>
      <ErrorNote error={error} />
      {loading && !data ? <p className="text-sm text-muted">Loading…</p> : null}
      {data && data.items.length === 0 && <Empty>No published {kind}s yet.</Empty>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.items.map((l) => (
          <LinkCard key={l.id} href={`/listings/${l.id}`}>
            {l.previews?.[0]?.kind === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl(l.previews[0].url)} alt="" className="mb-3 aspect-video w-full rounded-lg bg-code object-cover" />
            ) : (
              <div className="mono mb-3 flex aspect-video w-full items-center justify-center rounded-lg bg-code text-muted">{l.formats?.join(' · ') || l.kind}</div>
            )}
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold">{l.title}</h3>
              <span className="whitespace-nowrap text-sm font-medium">{sol(l.priceMicro)}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-muted">{l.description}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Badge>{l.kind === 'model' ? 'AI model' : 'Dataset'}</Badge>
              <Badge>Creator / Seller</Badge>
              <Badge>{l.category.replace(/_/g, ' ')}</Badge>
              <Badge>{l.asset.fileCount} files · {bytes(l.asset.totalSize)}</Badge>
              <Badge>{l.licenseId}</Badge>
              {l.sales > 0 && <Badge tone="good">{l.sales} sold</Badge>}
            </div>
          </LinkCard>
        ))}
      </div>
    </Page>
  );
}
