'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/hooks';
import { date, sol } from '@/lib/format';
import { Badge, Empty, ErrorNote, Page, Skeleton, inputCls } from '@/components/ui';

export default function Bounties() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error, loading } = useApi<any[]>(`/bounties?state=funded${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`, [debounced]);
  return (
    <Page
      kicker="Marketplace · commissioned work"
      title="Funded requests"
      subtitle="Custom dataset and model work where the reward is already in escrow. Accept a request on-chain to start, then deliver against criteria that were fixed before anyone began."
      actions={
        <Link href="/bounties/new" className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink transition-colors hover:bg-[color-mix(in_oklab,var(--accent),var(--ink)_18%)]">
          Post a request
        </Link>
      }
    >
      <label className="relative mb-6 block max-w-sm">
        <span className="sr-only">Search requests</span>
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" />
          <path d="m10.5 10.5 3 3" />
        </svg>
        <input className={`${inputCls} pl-9`} placeholder="Search requests" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <ErrorNote error={error} />
      {loading && !data && (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}
      {data?.length === 0 && (
        <Empty>
          {debounced ? <>No open requests match “{debounced}”.</> : <>No open funded requests right now.</>}{' '}
          <Link href="/bounties/new" className="text-ink underline">
            Post one
          </Link>{' '}
          — the reward goes into escrow when you publish it.
        </Empty>
      )}
      {!!data?.length && (
        <ul className="border-y-[3px] border-ink">
          {data.map((b, i) => (
            <li key={b.id} className="rise border-b border-line last:border-0" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
              <Link href={`/orders/${b.id}`} className="group grid gap-x-8 gap-y-3 py-5 transition-colors md:grid-cols-[1fr_200px]">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <Badge tone="good">
                      <span aria-hidden="true" className="text-[9px]">●</span>
                      Reward in escrow
                    </Badge>
                    <span className="kicker">
                      {[b.criteria?.kind?.replace(/_/g, ' '), b.verifierWallet ? 'platform-checked delivery' : null].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <h3 className="display text-[22px] leading-snug group-hover:underline group-hover:decoration-line">{b.title}</h3>
                  <p className="mt-1 line-clamp-2 max-w-[72ch] text-sm text-ink-2">{b.description}</p>
                </div>
                <dl className="flex items-baseline justify-between gap-4 text-sm md:block md:text-right">
                  <div>
                    <dt className="sr-only">Reward</dt>
                    <dd className="num text-[20px] text-ink">{sol(b.amountMicro)}</dd>
                  </div>
                  <div className="md:mt-2">
                    <dt className="sr-only">Deadline</dt>
                    <dd className="text-xs text-muted">Due {date(b.deadline)}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
