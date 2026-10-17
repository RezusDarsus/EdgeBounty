'use client';
import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { sol } from '@/lib/format';
import { ErrorNote } from './ui';
export function RecentListings() {
  const { data, error } = useApi<{ items: { id: string; title: string; category: string; kind: string; priceMicro: string; verifiedLevel?: string }[] }>('/listings?sort=newest&limit=3');
  return <section className="mx-auto max-w-6xl border-t border-line px-4 py-12 sm:px-6" aria-labelledby="recent-listings">
    <div className="flex flex-wrap items-center justify-between gap-4"><h2 id="recent-listings" className="display text-3xl">Recently published listings</h2><Link href="/datasets" className="inline-flex min-h-11 items-center text-sm underline">Browse all listings</Link></div>
    <ErrorNote error={error} />
    {!data && !error && <p role="status" className="mt-5 text-sm text-muted">Loading published listings…</p>}
    {data && !data.items.length && <p className="mt-5 text-sm text-muted">There are no public listings yet. <Link className="underline" href="/bounties/new">Create a funded request for the data you need</Link>.</p>}
    {data && data.items.length > 0 && <ul className="mt-6 grid gap-6 md:grid-cols-3">{data.items.map(l => <li key={l.id} className="border-t border-ink py-5"><p className="text-sm text-muted">{l.kind} · {l.category}</p><h3 className="mt-2 text-xl font-medium"><Link className="underline decoration-line" href={`/listings/${l.id}`}>{l.title}</Link></h3><p className="num mt-4 text-sm">{sol(l.priceMicro)}</p><p className="mt-2 text-xs text-muted">{l.verifiedLevel ? `${l.verifiedLevel} report available; review its scope and limitations.` : 'Review the seller’s claims and any available reports before purchasing.'}</p></li>)}</ul>}
  </section>;
}
