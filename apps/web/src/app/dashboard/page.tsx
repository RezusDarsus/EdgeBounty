'use client';

import Link from 'next/link';

import { useState } from 'react';

import { useWallet } from '@solana/wallet-adapter-react';

import { chainClient, sendWithWallet } from '@/lib/chain';

import { api } from '@/lib/api';

import { useApi } from '@/lib/hooks';

import { CURRENCY, date, sol } from '@/lib/format';

import { useSession } from '@/app/providers';

import { RequireSession } from '@/components/nav';

import { Badge, Button, Card, Empty, ErrorNote, Field, Hash, Page, StateBadge, Tabs, inputCls } from '@/components/ui';

import { MyCollections, MyReceipts, SellerAnalytics } from '@/components/growth';

const TABS = ['Buying & requests', 'Selling & contributions', 'My datasets & models', 'Analytics', 'Collections', 'Receipts', 'Verification', 'Settings'];

export default function Dashboard() {

  const [tab, setTab] = useState(TABS[0]);

  return (

    <RequireSession>

      <Page

        title="Dashboard"

        actions={

          <>

            <Link href="/bounties/new" className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink transition-colors hover:bg-[color-mix(in_oklab,var(--accent),var(--ink)_18%)]">New request</Link>

            <Link href="/sell" className="inline-flex h-9 items-center rounded-md border border-line bg-panel px-4 text-sm font-medium transition-colors hover:border-ink/40">Sell</Link>

          </>

        }

      >

        <SolWithdrawal />

        <Notifications />

        <p className="mb-4 text-sm text-muted">One wallet can be a creator, requester, contributor, and verifier. Your role is shown on each activity.</p>

        <Tabs tabs={TABS} active={tab} onChange={setTab} />

        {tab === 'Buying & requests' && <Orders role="buyer" />}

        {tab === 'Selling & contributions' && <Orders role="seller" />}

        {tab === 'My datasets & models' && <MyListings />}

        {tab === 'Analytics' && <SellerAnalytics />}

        {tab === 'Collections' && <MyCollections />}

        {tab === 'Receipts' && <MyReceipts />}

        {tab === 'Verification' && <MyJobs />}

        {tab === 'Settings' && <Settings />}

      </Page>

    </RequireSession>

  );

}

function Notifications() {
  const { data, error, reload } = useApi<{ id: string; title: string; message: string; href: string; readAt: string | null }[]>('/me/notifications');
  const [actionError, setActionError] = useState<unknown>(null);
  const unread = data?.filter(n => !n.readAt) ?? [];
  if (!unread.length && !error) return null;
  return <div className="mb-4"><Card title="Account notices">
    <ErrorNote error={error || actionError} />
    <ul className="divide-y divide-line" aria-label="Unread account notices">
      {unread.map(n => <li key={n.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
        <div><p className="font-medium">{n.title}</p><p className="mt-1 text-sm text-muted">{n.message}</p><Link href={n.href} className="text-sm underline">View details</Link></div>
        <Button onClick={async () => { try { await api(`/me/notifications/${n.id}/read`, { method: 'POST' }); await reload(); setActionError(null); } catch (e) { setActionError(e); } }}>Mark read</Button>
      </li>)}
    </ul>
  </Card></div>;
}

function Orders({ role }: { role: 'buyer' | 'seller' }) {

  const { data, error } = useApi<any[]>('/me/orders');

  const rows = data?.filter((o) => o.role === role || (role === 'seller' && o.role === 'verifier')) ?? [];

  const spend = rows.filter((o) => o.chainState === 'settled').reduce((n, o) => n + BigInt(o.amountMicro), 0n);

  return (

    <Card title={role === 'buyer' ? 'Your purchases and funded requests' : 'Your sales, contracts and verification work'} right={<span className="text-sm text-muted">{role === 'buyer' ? 'settled spend' : 'settled volume'} {sol(spend)}</span>}>

      <ErrorNote error={error} />

      {rows.length === 0 ? <Empty>Nothing here yet.</Empty> : (

        <table className="w-full text-left text-sm">

          <thead className="text-xs text-muted"><tr><th className="py-1">Title</th><th>Activity / your role</th><th>Amount</th><th>State</th><th>Created</th></tr></thead>

          <tbody>

            {rows.map((o) => (

              <tr key={o.id} className="border-t border-line">

                <td className="py-2"><Link className="underline" href={`/orders/${o.id}`}>{o.title}</Link>{o.role === 'verifier' && <Badge>verifier</Badge>}</td>

                <td>{o.kind === 'bounty' ? 'Custom request' : 'Asset purchase'} · {o.role === 'buyer' ? o.kind === 'bounty' ? 'Requester' : 'Buyer' : o.role === 'verifier' ? 'Verifier' : o.kind === 'bounty' ? 'Contributor' : 'Creator / Seller'}</td>

                <td>{sol(o.amountMicro)}</td>

                <td><StateBadge state={o.chainState} /></td>

                <td className="text-muted">{date(o.createdAt)}</td>

              </tr>

            ))}

          </tbody>

        </table>

      )}

    </Card>

  );

}

function MyListings() {

  const { data, error } = useApi<any[]>('/me/listings');

  return (

    <Card title="Your listings">

      <ErrorNote error={error} />

      {data?.length === 0 && <Empty>No listings. <Link className="underline" href="/sell">Create one</Link>.</Empty>}

      {data?.map((l) => (

        <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 text-sm last:border-0">

          <Link className="underline" href={`/listings/${l.id}`}>{l.title}</Link>

          <span className="flex items-center gap-2"><Badge>{l.status}</Badge> v{l.version} · {sol(l.priceMicro)} · {l.sales} sold · preview {l.previewStatus}</span>

        </div>

      ))}

    </Card>

  );

}

function MyJobs() {

  const { data } = useApi<any[]>('/verification/jobs');

  return (

    <Card title="Verification jobs" right={<Link className="text-sm underline" href="/verify">New verification</Link>}>

      {data?.length === 0 && <Empty>No jobs yet.</Empty>}

      {data?.map((j) => (

        <div key={j.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 text-sm last:border-0">

          <Link className="underline" href={`/verify/${j.id}`}>{j.kind} · Level {j.level.slice(1)}</Link>

          <span className="flex items-center gap-2"><Badge tone={j.status === 'completed' ? 'good' : j.status === 'failed' ? 'bad' : 'warn'}>{j.status}</Badge>{sol(j.quoteMicro)} · {date(j.createdAt)}</span>

        </div>

      ))}

    </Card>

  );

}

function Settings() {

  const { account } = useSession();

  const { data: me, reload } = useApi<any>('/me');

  const { data: keys, reload: reloadKeys } = useApi<any[]>('/me/api-keys');

  const { data: org, reload: reloadOrg } = useApi<any>('/orgs/me');

  const [p, setP] = useState<any>(null);

  const [newKey, setNewKey] = useState<string | null>(null);

  const [orgName, setOrgName] = useState('');

  const [member, setMember] = useState('');

  const [err, setErr] = useState<unknown>(null);

  const prof = p ?? { mode: me?.account.mode, displayName: me?.profile?.displayName ?? '', organization: me?.profile?.organization ?? '', bio: me?.profile?.bio ?? '' };

  return (

    <div className="grid gap-4 md:grid-cols-2">

      <Card title="Identity">

        <p className="mb-3 text-sm">Wallet <Hash value={account?.wallet} /> · alias <b>{me?.account.alias}</b> · <Link className="underline" href={`/profile/${account?.wallet}`}>public page</Link></p>

        <div className="space-y-3">

          <Field label="Mode" hint="Pseudonymous hides profile fields. Public shows your professional portfolio.">

            <select className={inputCls} value={prof.mode} onChange={(e) => setP({ ...prof, mode: e.target.value })}>

              <option value="pseudonymous">Pseudonymous</option>

              <option value="public">Public professional</option>

            </select>

          </Field>

          <Field label="Display name"><input className={inputCls} value={prof.displayName} onChange={(e) => setP({ ...prof, displayName: e.target.value })} /></Field>

          <Field label="Organization"><input className={inputCls} value={prof.organization} onChange={(e) => setP({ ...prof, organization: e.target.value })} /></Field>

          <Field label="Bio"><textarea className={`${inputCls} h-20`} value={prof.bio} onChange={(e) => setP({ ...prof, bio: e.target.value })} /></Field>

          <Button onClick={async () => { try { await api('/me', { method: 'PATCH', body: { mode: prof.mode, displayName: prof.displayName || null, organization: prof.organization || null, bio: prof.bio || null } }); await reload(); } catch (e) { setErr(e); } }}>Save</Button>

          <p className="text-xs text-muted">Pseudonymity is not anonymity: your wallet&apos;s on-chain activity is public.</p>

        </div>

      </Card>

      <div className="space-y-4">

        <Card title="API keys">

          {newKey && <p className="mono mb-2 break-all rounded bg-code p-2 text-xs">{newKey} (shown once)</p>}

          {keys?.map((k) => (

            <div key={k.id} className="flex items-center justify-between py-1 text-sm">

              <span>{k.name} <span className="mono text-muted">{k.prefix}…</span> {k.revokedAt && <Badge tone="bad">revoked</Badge>}</span>

              {!k.revokedAt && <button className="text-xs text-bad underline" onClick={async () => { await api(`/me/api-keys/${k.id}`, { method: 'DELETE' }); reloadKeys(); }}>revoke</button>}

            </div>

          ))}

          <Button variant="ghost" className="mt-2" onClick={async () => { const r = await api('/me/api-keys', { body: { name: 'integration', scopes: ['read', 'verify', 'upload'] } }); setNewKey(r.key); reloadKeys(); }}>Create key</Button>

        </Card>

        <Card title="Organization">

          {org?.organization ? (

            <>

              <p className="text-sm font-medium">{org.organization.name} · settled spend {sol(org.settledSpendMicro)}</p>

              <ul className="mt-2 text-sm">{org.members.map((m: any) => <li key={m.id}>{m.alias} <Hash value={m.wallet} /></li>)}</ul>

              <div className="mt-2 flex gap-2"><input className={inputCls} placeholder="member wallet" value={member} onChange={(e) => setMember(e.target.value)} /><Button variant="ghost" onClick={async () => { try { await api('/orgs/me/members', { body: { wallet: member } }); setMember(''); reloadOrg(); } catch (e) { setErr(e); } }}>Add</Button></div>

            </>

          ) : (

            <div className="flex gap-2"><input className={inputCls} placeholder="organization name" value={orgName} onChange={(e) => setOrgName(e.target.value)} /><Button variant="ghost" onClick={async () => { try { await api('/orgs', { body: { name: orgName } }); reloadOrg(); } catch (e) { setErr(e); } }}>Create</Button></div>

          )}

        </Card>

        <Card title="Delete account">

          <p className="mb-2 text-sm text-muted">Erases your profile. On-chain records are public and cannot be deleted.</p>

          <Button variant="danger" onClick={async () => { if (confirm('Erase your profile?')) await api('/me', { method: 'DELETE' }); }}>Erase profile</Button>

        </Card>

        <ErrorNote error={err} />

      </div>

    </div>

  );

}

function SolWithdrawal() {

  const wallet = useWallet();

  const [error, setError] = useState<unknown>(null);

  const [done, setDone] = useState(false);
  if (CURRENCY === 'USDC') return <p className="mb-4 text-sm text-muted">Payouts and refunds arrive in your wallet as USDC. Keep SOL available for network fees.</p>;

  return <div className="mb-4 space-y-2 text-sm">

    <p>Escrow payouts and refunds arrive as wrapped SOL. Withdraw them to your wallet as native SOL.</p>

    <Button variant="ghost" disabled={!wallet.publicKey} onClick={async () => { setError(null); setDone(false); try { const c = await chainClient(); await sendWithWallet(wallet, c.unwrapSol(wallet.publicKey!)); setDone(true); } catch (e) { setError(e); } }}>Withdraw received SOL</Button>

    {done && <p role="status" className="text-good">Received SOL is now in your wallet.</p>}

    <ErrorNote error={error} />

  </div>;

}

