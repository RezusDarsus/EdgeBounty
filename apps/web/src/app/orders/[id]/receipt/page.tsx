'use client';
import { use } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { CURRENCY, dateTime, short, sol } from '@/lib/format';
import { RequireSession } from '@/components/nav';
import { Button, ErrorNote, KV, Page, PageLoading } from '@/components/ui';

type Receipt = {
  receiptNumber: string; status: string; kind: string; issuedAt: string; currency: string; testNetwork: boolean;
  item: { title: string; listingId: string | null; licenseId: string; orderAddress: string };
  buyer: { wallet: string; alias: string | null }; seller: { wallet: string | null; alias: string | null };
  amounts: { priceMicro: string; refundedToBuyerMicro: string; platformFeeBps: number; platformFeeMicro: string; sellerNetMicro: string; buyerTotalMicro: string; extras: null | { hostingMicro: string; includedDownloadsMicro: string; minimumFeeMicro: string; accessStartsAt: string; accessEndsAt: string } };
  transactions: { signature: string; kind: string; createdAt: string }[];
  notice: string;
};

export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RequireSession><ReceiptView id={id} /></RequireSession>;
}

function ReceiptView({ id }: { id: string }) {
  const { data: r, error, loading } = useApi<Receipt>(`/orders/${id}/receipt`);
  if (loading && !r) return <PageLoading />;
  if (!r) return <Page title="Receipt"><ErrorNote error={error} /></Page>;
  const a = r.amounts;
  const party = (p: { wallet: string | null; alias: string | null }) => (p.wallet ? `${p.alias ?? 'Wallet'} · ${short(p.wallet, 6)}` : '—');
  return (
    <Page kicker={<>Receipt · {r.status === 'refunded' ? 'refunded order' : 'settled order'}</>} title={r.receiptNumber} subtitle={r.item.title}
      actions={<><Button variant="ghost" onClick={() => window.print()}>Print or save as PDF</Button><Link href={`/orders/${id}`} className="inline-flex h-9 items-center text-sm underline">Back to order</Link></>}>
      {r.testNetwork && <p className="mb-6 rounded-md border border-warn/35 bg-warn/6 px-4 py-3 text-sm">Test network record: amounts are test {CURRENCY} on a private validator and have no monetary value.</p>}
      <div className="grid gap-10 lg:grid-cols-2">
        <section>
          <h2 className="kicker mb-3">Parties and item</h2>
          <KV rows={[
            ['Issued', dateTime(r.issuedAt)],
            ['Buyer', party(r.buyer)],
            ['Seller', party(r.seller)],
            ['Order type', r.kind === 'bounty' ? 'Funded request (bounty)' : 'Marketplace purchase'],
            ['License', r.item.licenseId],
            ['Escrow account', <span key="o" className="mono text-[12.5px]">{r.item.orderAddress}</span>],
          ]} />
        </section>
        <section>
          <h2 className="kicker mb-3">Amounts ({r.currency})</h2>
          <KV rows={[
            ['Price held in escrow', sol(a.priceMicro)],
            ...(a.refundedToBuyerMicro !== '0' ? ([['Refunded to buyer', sol(a.refundedToBuyerMicro)]] as [string, string][]) : []),
            [`Platform fee (${a.platformFeeBps / 100}%)`, sol(a.platformFeeMicro)],
            ['Paid to seller', sol(a.sellerNetMicro)],
            ...(a.extras ? ([['Hosting for access period', sol(a.extras.hostingMicro)], ['Included downloads', sol(a.extras.includedDownloadsMicro)], ...(a.extras.minimumFeeMicro !== '0' ? [['Minimum platform fee top-up', sol(a.extras.minimumFeeMicro)]] : [])] as [string, string][]) : []),
            ['Total paid by buyer', sol(a.buyerTotalMicro)],
          ]} />
        </section>
      </div>
      {r.transactions.length > 0 && (
        <section className="mt-10">
          <h2 className="kicker mb-3">On-chain transactions</h2>
          <ul className="space-y-1 text-sm">
            {r.transactions.map((t) => <li key={t.signature} className="flex flex-wrap gap-x-3"><span className="w-44 text-muted">{t.kind.replace(/_/g, ' ')}</span><span className="mono break-all text-[12.5px]">{t.signature}</span></li>)}
          </ul>
        </section>
      )}
      <p className="mt-10 max-w-[68ch] text-xs leading-relaxed text-muted">{r.notice}</p>
    </Page>
  );
}
