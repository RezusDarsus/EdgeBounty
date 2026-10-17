'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@/lib/hooks';
import { bytes, sol } from '@/lib/format';
import { previewUrl } from '@/lib/api';
import { Badge, Empty, ErrorNote, Page, Skeleton, inputCls } from './ui';
import { Specimen, shapeFor } from './brand';

const PAGE = 24;
type Sort = 'newest' | 'price-asc' | 'price-desc' | 'sales';

export function ListingGrid({ kind, title, subtitle }: { kind: 'dataset' | 'model'; title: string; subtitle: string }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('');
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<Sort>('newest');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setOffset(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    try {
      const v = localStorage.getItem('eb:view');
      if (v === 'list' || v === 'grid') setView(v);
    } catch {}
  }, []);
  const setViewSaved = (v: 'grid' | 'list') => {
    setView(v);
    try {
      localStorage.setItem('eb:view', v);
    } catch {}
  };
  const { data, error, loading } = useApi<{ items: any[]; categories: string[] }>(
    `/listings?kind=${kind}&limit=${PAGE}&offset=${offset}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}${category ? `&category=${category}` : ''}`,
    [debounced, category, offset],
  );
  const items = useMemo(() => {
    const list = [...(data?.items ?? [])];
    if (sort === 'price-asc') list.sort((a, b) => Number(BigInt(a.priceMicro) - BigInt(b.priceMicro)));
    if (sort === 'price-desc') list.sort((a, b) => Number(BigInt(b.priceMicro) - BigInt(a.priceMicro)));
    if (sort === 'sales') list.sort((a, b) => b.sales - a.sales);
    return list;
  }, [data, sort]);
  const noun = kind === 'model' ? 'models' : 'datasets';

  return (
    <Page kicker={kind === 'model' ? 'Marketplace · models' : 'Marketplace · datasets'} title={title} subtitle={subtitle}>
      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        {/* Filters */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <label className="relative block">
            <span className="sr-only">Search {noun}</span>
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" />
            </svg>
            <input className={`${inputCls} pl-9`} placeholder={`Search ${noun}`} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <p className="kicker mb-2 mt-6">Category</p>
          <div className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0">
            {['', ...(data?.categories ?? [])].map((c) => {
              const on = category === c;
              return (
                <button
                  key={c || 'all'}
                  onClick={() => {
                    setCategory(c);
                    setOffset(0);
                  }}
                  aria-pressed={on}
                  className={`rounded-[2px] border px-2.5 py-1.5 text-left text-sm capitalize transition-colors lg:border-0 lg:border-l-2 lg:px-3 ${
                    on ? 'border-ink bg-panel font-medium text-ink lg:bg-transparent' : 'border-line text-ink-2 hover:text-ink lg:border-transparent'
                  }`}
                >
                  {c ? c.replace(/_/g, ' ') : <span className="normal-case">All {noun}</span>}
                </button>
              );
            })}
          </div>
          <p className="mt-6 hidden text-xs leading-relaxed text-muted lg:block">
            Published {noun} passed at least the check level the seller paid for. Open a listing to read its reports and their limitations.
          </p>
        </aside>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <p className="text-sm text-muted" aria-live="polite">
              {loading && !data ? 'Loading…' : data ? `${data.items.length === PAGE ? `${offset + 1}–${offset + data.items.length}` : data.items.length ? `${offset + 1}–${offset + data.items.length}` : '0'} ${noun}${debounced ? ` matching “${debounced}”` : ''}` : ''}
            </p>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted">
                <span className="hidden sm:inline">Sort</span>
                <select className={`${inputCls} w-auto py-1.5`} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="newest">Newest</option>
                  <option value="price-asc">Price, low to high</option>
                  <option value="price-desc">Price, high to low</option>
                  <option value="sales">Most sold</option>
                </select>
              </label>
              <div className="flex rounded-[2px] border border-line bg-panel p-0.5" role="group" aria-label="Layout">
                {(['grid', 'list'] as const).map((v) => (
                  <button key={v} onClick={() => setViewSaved(v)} aria-pressed={view === v} className={`rounded-[1px] px-2 py-1 text-xs capitalize transition-colors ${view === v ? 'bg-ink text-paper' : 'text-muted hover:text-ink'}`}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <ErrorNote error={error} />
          {loading && !data && (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="rounded-md border border-line bg-panel p-4">
                  <Skeleton className="aspect-[16/9] w-full" />
                  <Skeleton className="mt-4 h-4 w-3/4" />
                  <Skeleton className="mt-2 h-3 w-full" />
                  <Skeleton className="mt-1.5 h-3 w-2/3" />
                </div>
              ))}
            </div>
          )}
          {data && data.items.length === 0 && (
            <Empty>
              {debounced || category ? (
                <>No {noun} match these filters. Clear the search or pick another category.</>
              ) : (
                <>
                  No published {noun} yet. <Link href="/sell" className="text-ink underline">List the first one</Link>, or <Link href="/bounties/new" className="text-ink underline">fund a request</Link> for the data you need.
                </>
              )}
            </Empty>
          )}

          {view === 'grid' ? (
            <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((l, i) => (
                <li key={l.id} className="rise" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                  <Link href={`/listings/${l.id}`} className="group flex h-full flex-col border-t-[3px] border-ink pt-3">
                    <div className="flex items-baseline justify-between gap-3 border-b border-ink/25 pb-2">
                      <span className="kicker truncate">{l.category.replace(/_/g, ' ')}</span>
                      <span className="mono shrink-0 text-[11px] uppercase text-muted">{l.formats?.slice(0, 2).join(' · ') || l.kind}</span>
                    </div>
                    {l.previews?.[0]?.kind === 'image' && <Thumb l={l} className="mt-3 aspect-[16/9] w-full rounded-[2px]" />}
                    <h3 className="display mt-3 line-clamp-2 min-h-[2.75em] text-[22px] leading-snug decoration-1 underline-offset-4 group-hover:underline">{l.title}</h3>
                    <p className="mt-1.5 line-clamp-2 min-h-[2.9em] text-sm text-ink-2">{l.description}</p>
                    <dl className="mt-4 border-t border-line text-[13px]">
                      <Meta k="Size" v={bytes(l.asset.totalSize)} />
                      <Meta k="Files" v={l.asset.fileCount?.toLocaleString('en-US') ?? '—'} />
                      <Meta k="License" v={l.licenseId} />
                    </dl>
                    <div className="mt-auto flex items-baseline justify-between gap-2 pt-2.5">
                      <span className="text-xs text-muted">
                        {l.seller.alias ?? 'Seller'}
                        {l.sales > 0 && <> · {l.sales} sold</>}
                      </span>
                      <span className="num text-[16px] text-ink">{sol(l.priceMicro)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            items.length > 0 && (
              <table className="booktabs w-full text-sm">
                <thead className="text-left">
                  <tr className="kicker">
                    <th className="py-2.5 pr-3 font-normal">{kind === 'model' ? 'Model' : 'Dataset'}</th>
                    <th className="hidden py-2.5 pr-3 font-normal md:table-cell">Formats</th>
                    <th className="hidden py-2.5 pr-3 text-right font-normal sm:table-cell">Size</th>
                    <th className="hidden py-2.5 pr-3 font-normal lg:table-cell">License</th>
                    <th className="py-2.5 text-right font-normal">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((l) => (
                    <tr key={l.id} className="group border-b border-line last:border-0 hover:bg-panel">
                      <td className="py-3 pr-3">
                        <Link href={`/listings/${l.id}`} className="flex items-center gap-3">
                          <span className="min-w-0">
                            <span className="block font-medium group-hover:underline">{l.title}</span>
                            <span className="block text-xs capitalize text-muted">{l.category.replace(/_/g, ' ')} · {l.seller.alias ?? 'Seller'}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="mono hidden py-3 pr-3 text-ink-2 md:table-cell">{l.formats?.join(', ') || '—'}</td>
                      <td className="num hidden py-3 pr-3 text-right text-ink-2 sm:table-cell">{bytes(l.asset.totalSize)}</td>
                      <td className="hidden py-3 pr-3 lg:table-cell"><Badge>{l.licenseId}</Badge></td>
                      <td className="num py-3 text-right">{sol(l.priceMicro)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {data && (offset > 0 || data.items.length === PAGE) && (
            <nav className="mt-8 flex items-center justify-between border-t border-line pt-4 text-sm" aria-label="Pagination">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="text-ink-2 hover:text-ink disabled:opacity-40">
                ← Previous
              </button>
              <span className="num text-xs text-muted">Page {offset / PAGE + 1}</span>
              <button disabled={data.items.length < PAGE} onClick={() => setOffset(offset + PAGE)} className="text-ink-2 hover:text-ink disabled:opacity-40">
                Next →
              </button>
            </nav>
          )}
        </div>
      </div>
    </Page>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-1.5">
      <dt className="text-muted">{k}</dt>
      <dd className="num truncate text-ink-2">{v}</dd>
    </div>
  );
}

function Thumb({ l, className }: { l: any; className: string }) {
  if (l.previews?.[0]?.kind === 'image')
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={previewUrl(l.previews[0].url)} alt="" loading="lazy" className={`${className} bg-sunk object-cover`} />;
  return <Specimen seed={l.id} shape={shapeFor(l.kind, l.formats, l.category)} label={l.formats?.slice(0, 2).join(' · ') || l.kind} className={className} />;
}
