'use client';
import { Buffer } from 'buffer';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import bs58 from 'bs58';
import { api, loadToken, setToken } from '@/lib/api';
import { BurnerWalletAdapter } from '@/lib/burner';

if (typeof window !== 'undefined' && !(window as any).Buffer) (window as any).Buffer = Buffer;

interface Account {
  id: string;
  wallet: string;
  alias: string;
  mode: 'pseudonymous' | 'public';
  roles: string[];
}
interface SessionCtx {
  account: Account | null;
  signingIn: boolean;
  signIn: () => Promise<void>;
  signOut: () => void;
  isAdmin: boolean;
}
const Ctx = createContext<SessionCtx>({ account: null, signingIn: false, signIn: async () => {}, signOut: () => {}, isAdmin: false });
export const useSession = () => useContext(Ctx);

function SessionProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const [account, setAccount] = useState<Account | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const inFlight = useRef(false);
  const currentWallet = useRef<string | undefined>(undefined);
  currentWallet.current = wallet.publicKey?.toBase58();

  useEffect(() => {
    if (!loadToken()) return;
    api('/me')
      .then((r) => setAccount({ ...r.account, roles: r.roles }))
      .catch(() => setToken(null));
  }, []);

  // a different wallet means a different identity
  useEffect(() => {
    if (account && wallet.publicKey && wallet.publicKey.toBase58() !== account.wallet) {
      setToken(null);
      setAccount(null);
    }
  }, [wallet.publicKey, account]);

  const signIn = useCallback(async () => {
    if (inFlight.current) return;
    if (!wallet.publicKey || !wallet.signMessage) throw new Error('This wallet cannot sign messages');
    inFlight.current = true;
    setSigningIn(true);
    try {
      const w = wallet.publicKey.toBase58();
      const ch = await api<{ nonce: string; message: string }>('/auth/challenge', { body: { wallet: w } });
      const sig = await wallet.signMessage(new TextEncoder().encode(ch.message));
      const r = await api('/auth/verify', { body: { wallet: w, nonce: ch.nonce, signature: bs58.encode(sig) } });
      if (currentWallet.current !== w) throw new Error('Your wallet changed during sign-in. Sign in with the selected wallet again.');
      setToken(r.token);
      setAccount(r.account);
    } finally {
      inFlight.current = false;
      setSigningIn(false);
    }
  }, [wallet]);

  const signOut = useCallback(() => {
    setToken(null);
    setAccount(null);
    wallet.disconnect().catch(() => {});
  }, [wallet]);

  const value = useMemo(() => ({ account, signingIn, signIn, signOut, isAdmin: !!account?.roles.includes('admin') }), [account, signingIn, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function Providers({ children }: { children: ReactNode }) {
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';
  // Installed Wallet Standard wallets (Backpack, …) register themselves and replace these adapters when present;
  // listing Phantom/Solflare explicitly keeps them visible (with an install link) when the extension is missing.
  // The burner is localnet-only.
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      ...(process.env.NEXT_PUBLIC_DEV_BURNER === '1' ? [new BurnerWalletAdapter()] : []),
    ],
    [],
  );
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <SessionProvider>{children}</SessionProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
