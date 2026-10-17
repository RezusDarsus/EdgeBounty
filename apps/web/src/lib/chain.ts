'use client';
import { Connection, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import type { WalletContextState } from '@solana/wallet-adapter-react';
import { EdgeBountyClient } from '@edgebounty/blockchain-client';
import { CURRENCY } from './format';

let client: EdgeBountyClient | null = null;
let cfgPromise: Promise<{ programId: string; rpcUrl: string; currency: string; paymentReady: boolean; paymentMint: string | null; platformVerifier: string | null; admin: string | null; disputeAuthority: string | null; feeBps: number | null; reviewWindowSecs: number | null }> | null = null;

export function platformConfig() {
  if (!cfgPromise) cfgPromise = import('./api').then((m) => m.api('/config'));
  return cfgPromise;
}

export async function chainClient(): Promise<EdgeBountyClient> {
  if (client) return client;
  const cfg = await platformConfig();
  if (!cfg.paymentReady || cfg.currency !== CURRENCY) throw new Error('The app currency does not match the payment deployment. Reload after the matching app build is deployed.');
  const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? cfg.rpcUrl;
  client = new EdgeBountyClient(new Connection(rpc, 'confirmed'), new PublicKey(cfg.programId));
  return client;
}

/**
 * Signs with the connected wallet, sends through OUR RPC, and waits for confirmation.
 * Sign-only on purpose: wallet.sendTransaction lets Phantom/Solflare broadcast via their own RPC
 * (mainnet for any non-standard endpoint), which never reaches this platform's cluster.
 */
export async function sendWithWallet(wallet: WalletContextState, ixs: TransactionInstruction[]): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error('connect a wallet that can sign transactions');
  const c = await chainClient();
  const tx = await c.buildTransaction(ixs, wallet.publicKey);
  const signed = await wallet.signTransaction(tx);
  const sig = await c.connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  const res = await c.connection.confirmTransaction({ signature: sig, blockhash: tx.recentBlockhash!, lastValidBlockHeight: tx.lastValidBlockHeight! }, 'confirmed');
  if (res.value.err) throw new Error(`transaction failed: ${JSON.stringify(res.value.err)}`);
  return sig;
}

export const hexBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
export const pk = (s: string) => new PublicKey(s);
