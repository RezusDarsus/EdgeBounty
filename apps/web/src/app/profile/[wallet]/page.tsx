'use client';
import { use } from 'react';
import { useApi } from '@/lib/hooks';
import { sol } from '@/lib/format';
import { Badge, Card, ErrorNote, Hash, KV, LinkCard, Page } from '@/components/ui';

export default function Profile({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = use(params);
  const { data: p, error } = useApi<any>(`/profiles/${wallet}`);
  const { data: listings } = useApi<{ items: any[] }>(`/listings?seller=${wallet}`);
  if (error) return <Page title="Profile"><ErrorNote error={error} /></Page>;
  if (!p) return <Page title="Loading…"><span /></Page>;
  return (
    <Page title={p.profile?.displayName ?? p.alias} subtitle={<span><Hash value={p.wallet} /> · {p.mode === 'public' ? 'public professional profile' : 'pseudonymous account'}</span>}>
      <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
        <div className="space-y-4">
          {p.profile && (
            <Card title="About">
              <KV rows={[['Organization', p.profile.organization ?? '—'], ['Verified business', p.profile.verifiedBusiness ? 'yes' : 'no'], ['Bio', p.profile.bio ?? '—']]} />
            </Card>
          )}
          <Card title="On-chain record">
            {p.reputation ? (
              <KV
                rows={[
                  ['Sales completed', p.reputation.salesCompleted],
                  ['Purchases completed', p.reputation.purchasesCompleted],
                  ['Volume sold', sol(p.reputation.volumeSold)],
                  ['Disputed orders', p.reputation.disputedOrders],
                  ['Refunded orders', p.reputation.refundedOrders],
                  ['Verified failure contributions', p.reputation.verifiedContributions],
                ]}
              />
            ) : (
              <p className="text-sm text-muted">No completed on-chain activity yet.</p>
            )}
            <p className="mt-2 text-xs text-muted">Counts are recorded by the program at settlement; volume is shown separately from quality signals. Buyer and seller must be different wallets.</p>
          </Card>
          {p.rating && <Card title="Reviews"><p className="text-sm">{p.rating.average} / 5 from {p.rating.count} completed orders</p></Card>}
        </div>
        <Card title="Listings">
          <div className="grid gap-3 sm:grid-cols-2">
            {listings?.items.map((l) => (
              <LinkCard key={l.id} href={`/listings/${l.id}`}>
                <p className="font-medium">{l.title}</p>
                <p className="mt-1 text-sm text-muted">{sol(l.priceMicro)} · <Badge>{l.kind}</Badge></p>
              </LinkCard>
            ))}
          </div>
        </Card>
      </div>
    </Page>
  );
}
