'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/app/providers';
import { Mark } from './brand';
import { buttonCls } from './ui';
const WalletMultiButton = dynamic(() => import('@solana/wallet-adapter-react-ui').then((m) => m.WalletMultiButton), { ssr: false });
const LINKS = [
  ['/assistant', 'AI assistant'],
  ['/datasets', 'Datasets'],
  ['/models', 'Models'],
  ['/bounties', 'Funded requests'],
  ['/failure-bounties', 'Failure bounties'],
  ['/providers', 'Verifiers'],
] as const;
export function Nav() {
  const path = usePathname();
  const wallet = useWallet();
  const walletModal = useWalletModal();
  const { account, signOut, isAdmin } = useSession();
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [networkLabel, setNetworkLabel] = useState('Checking payment network…');
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    let active = true;
    import('@/lib/api').then(({ api }) => api<{ rpcUrl: string; currency: string }>('/config')).then((config) => {
      if (!active) return;
      const rpc = config.rpcUrl.toLowerCase();
      const currency = config.currency === 'USDC' ? 'USDC' : 'SOL';
      const network = /devnet/.test(rpc) ? 'Public Solana Devnet' : /mainnet/.test(rpc) ? 'Solana Mainnet' : /localhost|127\.0\.0\.1|0\.0\.0\.0|solana-test-validator|validator:/.test(rpc) ? 'Private validator' : 'Configured Solana RPC';
      const token = network === 'Private validator' && currency === 'USDC' ? 'mock USDC · no monetary value' : network === 'Public Solana Devnet' && currency === 'USDC' ? 'Devnet USDC · test tokens' : `${currency} payments`;
      setNetworkLabel(`${network} · ${token}`);
    }).catch(() => { if (active) setNetworkLabel('Network unavailable · do not fund'); });
    return () => { active = false; };
  }, []);
  async function getTestFunds() {
    setFunding(true); setErr(null); setSuccess(null);
    try {
      const { api } = await import('@/lib/api');
      const funds = await api<{ sol: number; mockUsdc?: number }>('/dev/faucet', { body: { wallet: account!.wallet } });
      setSuccess(`Added ${funds.sol} test SOL${funds.mockUsdc ? ` and ${funds.mockUsdc} test USDC` : ''}. These tokens have no monetary value.`);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Test funds could not be added. Please try again.'); }
    finally { setFunding(false); }
  }
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-[15px] font-semibold tracking-tight">
          <Mark className="h-5 w-5" />
          EdgeBounty
        </Link>
        <nav aria-label="Marketplace" className="hidden flex-1 items-center gap-1 lg:flex">
          {LINKS.filter(([href]) => !['/failure-bounties', '/providers'].includes(href)).map(([href, label]) => {
            const on = path?.startsWith(href);
            return (
              <Link key={href} href={href} aria-current={on ? 'page' : undefined} className={`relative px-2.5 py-2 text-sm transition-colors ${on ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}>
                {label}
                <span className={`absolute inset-x-2.5 -bottom-[13px] h-[2px] bg-ink transition-transform duration-200 ${on ? 'scale-x-100' : 'scale-x-0'}`} />
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span title="Network and payment token for all funding actions" className="max-w-32 truncate rounded border border-line px-1.5 py-1 text-[9px] text-muted sm:max-w-56 sm:px-2 sm:text-[11px]">{networkLabel}</span>
          {account ? (
            <>
              <Link href="/dashboard" className={`rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-sunk ${path?.startsWith('/dashboard') ? 'font-medium text-ink' : 'text-ink-2'}`}>
                Dashboard
              </Link>
              {process.env.NEXT_PUBLIC_DEV_BURNER === '1' && (
                <button
                  title="Demo only: get test funds on the private test chain"
                  disabled={funding}
                  onClick={getTestFunds}
                  className="hidden rounded-md px-2.5 py-1.5 text-sm text-warn hover:bg-sunk lg:inline-flex"
                >
                  {funding ? 'Getting test funds…' : 'Get test funds'}
                </button>
              )}
              {isAdmin && (
                <Link href="/admin" className="hidden rounded-md px-2.5 py-1.5 text-sm text-warn hover:bg-sunk lg:block">
                  Admin
                </Link>
              )}
              <button onClick={signOut} className="hidden rounded-md px-2 py-1.5 text-sm text-muted hover:text-ink lg:block">
                Sign out
              </button>
            </>
          ) : <WalletSignIn />}
          {account && <div className="hidden lg:block"><WalletMultiButton /></div>}
          {/* the multi-button only offers "change wallet" once connected; without this a wallet that is
              selected but not installed (e.g. Phantom) leaves the user stuck on "Connect" */}
          {mounted && wallet.wallet && !wallet.connected && !wallet.connecting && (
            <button
              onClick={() => {
                wallet.select(null);
                walletModal.setVisible(true);
              }}
              className="rounded-md px-2 py-1.5 text-sm text-muted hover:text-ink"
            >
              Change wallet
            </button>
          )}
          <button className="shrink-0 rounded-md p-2 text-ink hover:bg-sunk lg:hidden" onClick={() => setOpen(!open)} aria-label="Open menu" aria-expanded={open}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
        </div>
      </div>
      {open && (
        <nav aria-label="Mobile" className="rise flex flex-col border-t border-line bg-panel px-4 py-2 sm:px-6 lg:hidden">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)} className={`border-b border-line py-3 text-[15px] last:border-0 ${path?.startsWith(href) ? 'font-medium' : 'text-ink-2'}`}>
              {label}
            </Link>
          ))}
          {account && <div className="flex flex-wrap items-center gap-3 border-t border-line py-3">
            <WalletMultiButton />
            {process.env.NEXT_PUBLIC_DEV_BURNER === '1' && <button disabled={funding} onClick={getTestFunds} className="text-sm text-warn">{funding ? 'Getting test funds…' : 'Get test funds'}</button>}
            {isAdmin && <Link href="/admin" className="text-sm">Admin</Link>}
            <button onClick={() => { setOpen(false); signOut(); }} className="text-sm">Sign out</button>
          </div>}
        </nav>
      )}
      {success && <div role="status" className="bg-good/10 px-4 py-2 text-center text-sm text-good">{success}<button className="ml-3 underline" onClick={() => setSuccess(null)}>Dismiss</button></div>}
      {err && (
        <div role="alert" className="bg-bad/10 px-4 py-2 text-center text-sm text-bad" onClick={() => setErr(null)}>
          {err}
        </div>
      )}
    </header>
  );
}
export function RequireSession({ children }: { children: React.ReactNode }) {
  const { account } = useSession();
  if (!account)
    return (
      <main className="mx-auto max-w-lg px-4 py-20 sm:px-6">
        <p className="kicker mb-3">Sign in</p>
        <h1 className="display text-[36px]">Sign in with your wallet to continue</h1>
        <p className="mt-4 text-[15px] text-ink-2">
          Your Solana wallet is your account. You sign a short login message — it costs nothing, moves no funds and authorizes no payment.
        </p>
        <ol className="booktabs my-6 text-sm">
          {['Choose a wallet (Phantom, Solflare or any Wallet Standard wallet)', 'Approve the connection in the wallet', 'Sign the login message — no transaction is created'].map((t, i) => (
            <li key={t} className="flex gap-3 border-b border-line py-2.5 last:border-0"><span className="num text-muted">{i + 1}</span>{t}</li>
          ))}
        </ol>
        <WalletSignIn />
      </main>
    );
  return <>{children}</>;
}
/** Only an explicit sign-in action triggers a signature; reconnecting alone never does. */
export function WalletSignIn() {
  const wallet = useWallet();
  const modal = useWalletModal();
  const { signIn, signingIn } = useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connecting = useRef(false);
  const signing = useRef(false);
  useEffect(() => {
    if (!pending || !wallet.wallet || modal.visible) return;
    if (!wallet.connected && !wallet.connecting && !connecting.current) {
      connecting.current = true;
      wallet.connect().catch((e) => { setError(e.message); setPending(false); }).finally(() => { connecting.current = false; });
    } else if (wallet.connected && !signing.current) {
      signing.current = true;
      setPending(false);
      signIn().catch((e) => setError(e.message)).finally(() => { signing.current = false; });
    }
  }, [pending, wallet.wallet, wallet.connected, wallet.connecting, wallet.connect, modal.visible, signIn]);
  return <div>
    <button className={buttonCls('ink')} disabled={signingIn || wallet.connecting} onClick={() => { setError(null); if (wallet.connected) { void signIn().catch((e) => setError(e.message)); } else { setPending(true); modal.setVisible(true); } }}>
      {signingIn ? 'Waiting for signature…' : wallet.connecting ? 'Connecting wallet…' : 'Sign in with wallet'}
    </button>
    {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
  </div>;
}
