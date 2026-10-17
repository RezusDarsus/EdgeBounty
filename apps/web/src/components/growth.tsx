'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { date, pct, sol } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorNote, Field, Skeleton, inputCls } from './ui';

type Analytics = {
  days: number;
  totals: { views: number; sales: number; refunds: number; grossMicro: string; feeMicro: string; netMicro: string };
  daily: { day: string; views: number }[];
  listings: { listingId: string; title: string; status: string; views: number; sales: number; refunds: number; conversionBps: number | null; grossMicro: string; feeMicro: string; netMicro: string }[];
  notes: string[];
};

/** Seller analytics: approximate views, settled sales and what the seller actually received. */
export function SellerAnalytics() {
  const [days, setDays] = useState(30);
  const { data, error, loading } = useApi<Analytics>(`/me/analytics?days=${days}`, [days]);
  const peak = Math.max(1, ...(data?.daily.map((d) => d.views) ?? [1]));
  return (
    <Card title="Seller analytics" right={
      <label className="flex items-center gap-2">Period
        <select className={`${inputCls} w-auto py-1`} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90, 365].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
      </label>
    }>
      <ErrorNote error={error} />
      {loading && !data && <Skeleton className="h-40 w-full" />}
      {data && (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-line pb-5 sm:grid-cols-4">
            <Stat k="Listing views" v={data.totals.views.toLocaleString('en-US')} />
            <Stat k="Sales" v={`${data.totals.sales}${data.totals.refunds ? ` · ${data.totals.refunds} refunded` : ''}`} />
            <Stat k="Platform fees" v={sol(data.totals.feeMicro)} />
            <Stat k="You received" v={sol(data.totals.netMicro)} />
          </dl>
          {data.daily.length > 0 && (
            <figure className="mt-5">
              <figcaption className="kicker mb-2">Views per day</figcaption>
              <div className="flex h-24 items-end gap-[2px]" role="img" aria-label={`Daily views over ${data.days} days, peak ${peak}`}>
                {data.daily.map((d) => (
                  <div key={d.day} title={`${date(d.day)}: ${d.views} views`} className="min-w-[3px] flex-1 bg-ink/70 transition-colors hover:bg-accent" style={{ height: `${Math.max(4, (d.views / peak) * 100)}%` }} />
                ))}
              </div>
            </figure>
          )}
          {data.listings.length === 0 ? (
            <Empty>No listings yet. <Link className="underline" href="/sell">List a dataset or model</Link> to see its views and sales here.</Empty>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <table className="booktabs w-full text-sm">
                <thead className="text-left">
                  <tr className="kicker">
                    <th className="py-2 pr-3 font-normal">Listing</th>
                    <th className="py-2 pr-3 text-right font-normal">Views</th>
                    <th className="py-2 pr-3 text-right font-normal">Sales</th>
                    <th className="hidden py-2 pr-3 text-right font-normal sm:table-cell">Conversion</th>
                    <th className="py-2 text-right font-normal">Net received</th>
                  </tr>
                </thead>
                <tbody>
                  {data.listings.map((l) => (
                    <tr key={l.listingId} className="border-b border-line last:border-0">
                      <td className="py-2.5 pr-3"><Link className="underline-offset-4 hover:underline" href={`/listings/${l.listingId}`}>{l.title}</Link>{l.status !== 'published' && <> <Badge>{l.status}</Badge></>}</td>
                      <td className="num py-2.5 pr-3 text-right">{l.views.toLocaleString('en-US')}</td>
                      <td className="num py-2.5 pr-3 text-right">{l.sales}</td>
                      <td className="num hidden py-2.5 pr-3 text-right sm:table-cell">{l.conversionBps === null ? '—' : pct(l.conversionBps)}</td>
                      <td className="num py-2.5 text-right">{sol(l.netMicro)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.notes.map((n) => <p key={n} className="mt-4 text-xs leading-relaxed text-muted">{n}</p>)}
        </>
      )}
    </Card>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="num mt-1 text-[20px] text-ink">{v}</dd>
    </div>
  );
}

type Collection = { id: string; title: string; description: string; public: boolean; items: number; containsListing: boolean; updatedAt: string };

export function MyCollections() {
  const { data, error, reload } = useApi<Collection[]>('/me/collections');
  const [title, setTitle] = useState('');
  const [actionError, setActionError] = useState<unknown>(null);
  return (
    <Card title="Collections" right="Save listings to compare later or share a reading list">
      <ErrorNote error={error ?? actionError} />
      <div className="mb-5 flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <Field label="New collection"><input className={inputCls} value={title} maxLength={120} placeholder="e.g. Speech datasets to evaluate" onChange={(e) => setTitle(e.target.value)} /></Field>
        </div>
        <Button disabled={!title.trim()} onClick={async () => {
          try { await api('/collections', { body: { title } }); setTitle(''); setActionError(null); await reload(); } catch (e) { setActionError(e); }
        }}>Create</Button>
      </div>
      {data?.length === 0 && <Empty>No collections yet. Create one here, or use “Save” on any listing.</Empty>}
      <ul className="divide-y divide-line">
        {data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <Link href={`/collections/${c.id}`} className="font-medium underline-offset-4 hover:underline">{c.title}</Link>
              <p className="text-xs text-muted">{c.items} {c.items === 1 ? 'listing' : 'listings'} · updated {date(c.updatedAt)}</p>
            </div>
            <div className="flex items-center gap-2">
              {c.public ? <Badge tone="accent">Shared</Badge> : <Badge>Private</Badge>}
              <Button variant="ghost" onClick={async () => {
                try { await api(`/collections/${c.id}`, { method: 'PATCH', body: { public: !c.public } }); await reload(); } catch (e) { setActionError(e); }
              }}>{c.public ? 'Make private' : 'Share'}</Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** “Save” control for a listing page: toggles membership in the viewer's collections. */
export function SaveToCollection({ listingId }: { listingId: string }) {
  const [open, setOpen] = useState(false);
  const { data, error, reload } = useApi<Collection[]>(open ? `/me/collections?listing=${listingId}` : null, [open]);
  const [title, setTitle] = useState('');
  const [actionError, setActionError] = useState<unknown>(null);
  const toggle = async (c: Collection) => {
    try {
      await api(c.containsListing ? `/collections/${c.id}/items/${listingId}` : `/collections/${c.id}/items`, c.containsListing ? { method: 'DELETE' } : { body: { listingId } });
      await reload();
    } catch (e) { setActionError(e); }
  };
  return (
    <div className="relative">
      <Button variant="ghost" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Save to collection'}</Button>
      {open && (
        <div className="mt-2 rounded-md border border-line bg-panel p-3 text-sm">
          <ErrorNote error={error ?? actionError} />
          {data?.map((c) => (
            <label key={c.id} className="flex items-center gap-2 py-1">
              <input type="checkbox" checked={c.containsListing} onChange={() => toggle(c)} />
              <span className="truncate">{c.title}</span>
            </label>
          ))}
          {data?.length === 0 && <p className="text-muted">You have no collections yet.</p>}
          <div className="mt-2 flex gap-2">
            <input className={`${inputCls} py-1.5`} value={title} maxLength={120} placeholder="New collection" onChange={(e) => setTitle(e.target.value)} />
            <Button variant="ink" disabled={!title.trim()} onClick={async () => {
              try {
                const c = await api<{ id: string }>('/collections', { body: { title } });
                await api(`/collections/${c.id}/items`, { body: { listingId } });
                setTitle('');
                await reload();
              } catch (e) { setActionError(e); }
            }}>Add</Button>
          </div>
        </div>
      )}
    </div>
  );
}

type ReceiptRow = { orderId: string; receiptNumber: string; title: string; role: 'buyer' | 'seller'; status: string; issuedAt: string; priceMicro: string; sellerNetMicro: string; platformFeeMicro: string };

export function MyReceipts() {
  const { data, error } = useApi<ReceiptRow[]>('/me/receipts');
  return (
    <Card title="Receipts" right="Issued when an order settles or is refunded">
      <ErrorNote error={error} />
      {data?.length === 0 && <Empty>No settled orders yet.</Empty>}
      {!!data?.length && (
        <div className="overflow-x-auto">
          <table className="booktabs w-full text-sm">
            <thead className="text-left">
              <tr className="kicker">
                <th className="py-2 pr-3 font-normal">Receipt</th>
                <th className="py-2 pr-3 font-normal">Order</th>
                <th className="hidden py-2 pr-3 font-normal sm:table-cell">Role</th>
                <th className="py-2 text-right font-normal">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.orderId} className="border-b border-line last:border-0">
                  <td className="mono py-2.5 pr-3 text-[12.5px]"><Link className="underline" href={`/orders/${r.orderId}/receipt`}>{r.receiptNumber}</Link></td>
                  <td className="py-2.5 pr-3">{r.title} <span className="text-xs text-muted">· {date(r.issuedAt)}{r.status === 'refunded' ? ' · refunded' : ''}</span></td>
                  <td className="hidden py-2.5 pr-3 capitalize sm:table-cell">{r.role}</td>
                  <td className="num py-2.5 text-right">{sol(r.role === 'seller' ? r.sellerNetMicro : r.priceMicro)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
