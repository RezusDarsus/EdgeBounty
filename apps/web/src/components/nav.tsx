'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/app/providers';
const WalletMultiButton = dynamic(() => import('@solana/wallet-adapter-react-ui').then((m) => m.WalletMultiButton), { ssr: false });
const LINKS = [
  ['/datasets', 'Datasets'],
  ['/models', 'Models'],
  ['/bounties', 'Requests'],
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
  useEffect(() => setMounted(true), []);
  async function getTestFunds() {
    setFunding(true); setErr(null); setSuccess(null);
    try {
      const { api } = await import('@/lib/api');
      const funds = await api<{ sol: number; mockUsdc?: number }>('/dev/faucet', { body: { wallet: account!.wallet } });
      setSuccess(`Added ${funds.sol} test SOL${funds.mockUsdc ? ` and ${funds.mockUsdc} test USDC` : ''}. These funds have no real value.`);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not get test funds. Try again.'); }
    finally { setFunding(false); }
  }
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="shrink-0 font-semibold tracking-tight">
          Edge<span className="text-accent">Bounty</span>
        </Link>
        <nav className="hidden flex-1 gap-1 xl:flex">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className={`rounded-md px-2.5 py-1.5 text-sm ${path?.startsWith(href) ? 'bg-code font-medium' : 'text-muted hover:text-ink'}`}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {account ? (
            <>
              <Link href="/dashboard" className="rounded-md px-2.5 py-1.5 text-sm hover:bg-code">
                Dashboard
              </Link>
              {process.env.NEXT_PUBLIC_DEV_BURNER === '1' && (
                <button
                  title="Demo only: get test funds on the private test chain"
                  disabled={funding}
                  onClick={getTestFunds}
                  className="hidden rounded-md px-2.5 py-1.5 text-sm text-warn hover:bg-code xl:inline-flex"
                >
                  {funding ? 'Getting test funds…' : 'Get test funds'}
                </button>
              )}
              {isAdmin && (
                <Link href="/admin" className="hidden rounded-md px-2.5 py-1.5 text-sm text-warn hover:bg-code xl:block">
                  Admin
                </Link>
              )}
              <button onClick={signOut} className="hidden rounded-md px-2 py-1.5 text-sm text-muted hover:text-ink xl:block">
                Sign out
              </button>
            </>
          ) : <WalletSignIn />}
          {account && <div className="hidden xl:block"><WalletMultiButton /></div>}
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
              Change
            </button>
          )}
          <button className="shrink-0 rounded-md p-2 xl:hidden" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
        </div>
      </div>
      {open && (
        <nav className="flex flex-col border-t border-line px-4 py-2 xl:hidden">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)} className="py-2 text-sm">
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
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">Sign in required</h1>
        <p className="mt-2 text-sm text-muted">
          Choose your Solana wallet and sign a login message. Signing in costs nothing and authorizes no payment.
        </p>
        <div className="mt-4"><WalletSignIn /></div>
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
    <button className="h-9 rounded-lg bg-accent px-3 text-sm font-medium text-accent-ink disabled:opacity-50" disabled={signingIn || wallet.connecting} onClick={() => { setError(null); if (wallet.connected) { void signIn().catch((e) => setError(e.message)); } else { setPending(true); modal.setVisible(true); } }}>
      {signingIn ? 'Signing in…' : wallet.connecting ? 'Connecting…' : 'Sign in with wallet'}
    </button>
    {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
  </div>;
}
