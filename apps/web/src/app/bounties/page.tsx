'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { date, sol } from '@/lib/format';
import { Badge, Empty, ErrorNote, LinkCard, Page, inputCls } from '@/components/ui';

export default function Bounties() {
  const [q, setQ] = useState('');
  const { data, error } = useApi<any[]>(`/bounties?state=funded${q ? `&q=${encodeURIComponent(q)}` : ''}`, [q]);
  return (
    <Page
      title="Funded requests"
      subtitle="Custom dataset and model work with the budget already in escrow. Accept a request on-chain to start; deliver against fixed, objective criteria."
      actions={
        <Link href="/bounties/new" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink">
          New request
        </Link>
      }
    >
      <input className={`${inputCls} mb-4 max-w-sm`} placeholder="Search requests…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorNote error={error} />
      {data?.length === 0 && <Empty>No open funded requests right now.</Empty>}
      <div className="grid gap-3 md:grid-cols-2">
        {data?.map((b) => (
          <LinkCard key={b.id} href={`/orders/${b.id}`}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold">{b.title}</h3>
              <span className="whitespace-nowrap font-medium">{sol(b.amountMicro)}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-muted">{b.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge>Custom request</Badge>
              <Badge tone="good">USDC reward in escrow</Badge>
              <Badge>{b.criteria?.kind?.replace(/_/g, ' ')}</Badge>
              <Badge>due {date(b.deadline)}</Badge>
              <Badge>Posted by requester</Badge>
              {b.verifierWallet && <Badge>Platform verification</Badge>}
            </div>
          </LinkCard>
        ))}
      </div>
    </Page>
  );
}
