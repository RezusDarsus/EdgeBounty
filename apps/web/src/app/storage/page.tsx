'use client';
import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { bytes, date, toMicro, sol } from '@/lib/format';
import { chainClient, hexBytes, sendWithWallet } from '@/lib/chain';
import { RequireSession } from '@/components/nav';
import { Badge, Button, Card, ErrorNote, Field, Page, inputCls } from '@/components/ui';

/** Module F — storage rental. */
export default function Storage() {
  const wallet = useWallet();
  const { data, reload } = useApi<any>('/storage');
  const { data: assets, reload: reloadAssets } = useApi<any[]>('/assets');
  const [gb, setGb] = useState('10');
  const [term, setTerm] = useState('30');
  const [quote, setQuote] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const used = data ? Math.min(100, (data.usedBytes / Math.max(data.quotaBytes, 1)) * 100) : 0;
  return (
    <RequireSession>
      <Page title="Storage" subtitle="Rent private storage for datasets and models. Expired storage enters a read-only grace period, then deletion — but assets backing active orders, listings or disputes are never deleted.">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Usage">
            {data && (
              <>
                <p className="text-sm">{bytes(data.usedBytes)} of {bytes(data.quotaBytes)} ({bytes(data.freeBytes)} free tier)</p>
                <div className="mt-2 h-2 rounded bg-code"><div className="h-2 rounded bg-accent" style={{ width: `${used}%` }} /></div>
                <ul className="mt-4 space-y-1 text-sm">
                  {data.allocations.map((a: any) => (
                    <li key={a.id} className="flex justify-between"><span>{a.gb} GB · {a.termDays} days</span><span><Badge tone={a.status === 'active' ? 'good' : a.status === 'grace' ? 'warn' : 'neutral'}>{a.status}</Badge> {a.expiresAt && `until ${date(a.expiresAt)}`}</span></li>
                  ))}
                </ul>
              </>
            )}
          </Card>
          <Card title="Buy storage">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Capacity (GB)"><input className={inputCls} value={gb} onChange={(e) => { setGb(e.target.value); setQuote(null); }} /></Field>
              <Field label="Term">
                <select className={inputCls} value={term} onChange={(e) => { setTerm(e.target.value); setQuote(null); }}>{['30', '90'].map((t) => <option key={t} value={t}>{t} days</option>)}</select>
              </Field>
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="ghost" onClick={async () => setQuote(await api('/storage/quote', { body: { gb: Number(gb), termDays: Number(term) } }))}>Quote</Button>
              <Button disabled={!quote} onClick={async () => {
                setErr(null);
                try {
                  const r = await api('/storage/allocations', { body: { gb: Number(gb), termDays: Number(term) } });
                  const c = await chainClient();
                  await sendWithWallet(wallet, await c.payService(wallet.publicKey!, hexBytes(r.invoice.reference), r.invoice.serviceKind, BigInt(r.invoice.amountMicro)));
                  await api(`/invoices/${r.invoice.id}/confirm`, { method: 'POST' });
                  setQuote(null);
                  reload();
                } catch (e) { setErr(e); }
              }}>{quote ? `Pay ${sol(quote.priceMicro)}` : 'Pay'}</Button>
            </div>
            {quote && <p className="mt-2 text-xs text-muted">{quote.breakdown}</p>}
            <ErrorNote error={err} />
          </Card>
        </div>
        <Billing />
        <Card title="Your assets" className="mt-4">
          {assets?.map((a) => (
            <div key={a.id} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
              <span>{a.name} <Badge>{a.kind}</Badge> <Badge>{a.purpose}</Badge></span>
              <button className="text-xs text-bad underline" onClick={async () => { try { await api(`/assets/${a.id}`, { method: 'DELETE' }); reloadAssets(); reload(); } catch (e) { setErr(e); } }}>delete</button>
            </div>
          ))}
        </Card>
      </Page>
    </RequireSession>
  );
}

function Billing() {
  const wallet = useWallet();
  const { data, reload } = useApi<any>('/usage');
  const [amount, setAmount] = useState('0.01');
  const [err, setErr] = useState<unknown>(null);
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card title="Processing credits">
        <p className="text-sm">Balance: <b>{sol(data?.credits)}</b>. Paid verification jobs draw from credits before invoicing.</p>
        <div className="mt-3 flex gap-2">
          <input className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button onClick={async () => {
            setErr(null);
            try {
              const { invoice } = await api('/credits/purchase', { body: { amountMicro: toMicro(amount) } });
              const c = await chainClient();
              await sendWithWallet(wallet, await c.payService(wallet.publicKey!, hexBytes(invoice.reference), invoice.serviceKind, BigInt(invoice.amountMicro)));
              await api(`/invoices/${invoice.id}/confirm`, { method: 'POST' });
              reload();
            } catch (e) { setErr(e); }
          }}>Buy credits</Button>
        </div>
        <ErrorNote error={err} />
      </Card>
      <Card title="Billing history" right={<span className="text-sm text-muted">paid {sol(data?.paidMicro)}</span>}>
        {data?.invoices.map((i: any) => (
          <div key={i.id} className="flex justify-between border-b border-line py-1.5 text-sm last:border-0">
            <span>{i.kind} · {date(i.createdAt)}</span>
            <span className="flex items-center gap-2">{sol(i.amountMicro)} <Badge tone={i.status === 'paid' ? 'good' : i.status === 'open' ? 'warn' : 'neutral'}>{i.status}</Badge></span>
          </div>
        ))}
      </Card>
    </div>
  );
}
