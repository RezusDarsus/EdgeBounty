'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Button, ErrorNote, inputCls } from './ui';

type Result = { items: { id: string; title: string; explanation: string }[]; limitations: string[] };
export function CatalogDiscovery() {
  const [q, setQ] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6" aria-labelledby="discovery-title">
    <h2 id="discovery-title" className="display text-3xl">Find a starting point in the catalog</h2>
    <p className="mt-3 max-w-[68ch] text-sm text-ink-2">Describe the subject you need. We match words against real public listings and show why they appeared.</p>
    <form className="mt-5 flex max-w-2xl flex-col gap-3 sm:flex-row" onSubmit={async e => {
      e.preventDefault(); if (busy) return; setBusy(true); setError(null); setResult(null);
      try { setResult(await api<Result>(`/agents/discovery?q=${encodeURIComponent(q)}`)); }
      catch (err) { setError(err); } finally { setBusy(false); }
    }}>
      <label className="flex-1"><span className="sr-only">Dataset subject</span><input className={inputCls} maxLength={100} minLength={2} required value={q} onChange={e => setQ(e.target.value)} placeholder="For example: Georgian speech recordings" /></label>
      <Button type="submit" disabled={busy || q.trim().length < 2}>{busy ? 'Searching…' : 'Find listings'}</Button>
    </form>
    <ErrorNote error={error} />
    <div aria-live="polite">{result && <>
      {result.items.length ? <ul className="mt-6 divide-y divide-line">{result.items.map(l => <li key={l.id} className="py-4"><Link href={`/listings/${l.id}`} className="font-medium underline">{l.title}</Link><p className="mt-1 text-sm text-muted">{l.explanation}</p></li>)}</ul> : <p className="mt-5 text-sm">No matching public listings. Try a broader subject or <Link className="underline" href="/bounties/new">create a bounty</Link>.</p>}
      {result.limitations.map(v => <p key={v} className="mt-3 text-xs text-muted">{v}</p>)}
    </>}</div>
  </section>;
}
