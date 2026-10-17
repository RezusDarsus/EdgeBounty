import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { NATIVE_MINT, createSyncNativeInstruction, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import { EdgeBountyClient } from '@edgebounty/blockchain-client';

/** Separate wrapped-SOL validator (scripts/localnet-sol-e2e.sh); the legacy USDC ledger stays on 8899. */
export const RPC = process.env.SOLANA_RPC_URL ?? 'http://127.0.0.1:8999';
/** Test amounts are expressed in this unit: 0.01 SOL, so "100 units" = 1 SOL. */
export const UNIT = 10_000_000n;
export const ROOT = join(import.meta.dirname, '..', '..');

export async function localnetAvailable(): Promise<boolean> {
  try {
    const c = new Connection(RPC);
    await c.getVersion();
    return true;
  } catch {
    return false;
  }
}

export function loadKeypair(path: string) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
}

/** Faucet = validator --mint authority (holds the genesis SOL). */
export function faucet(): Keypair {
  const p = join(ROOT, 'keys', 'localnet-authority.json');
  if (!existsSync(p)) throw new Error('run scripts/localnet.sh first');
  return loadKeypair(p);
}

export async function fundSol(connection: Connection, from: Keypair, to: PublicKey, sol = 2) {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: BigInt(sol) * BigInt(LAMPORTS_PER_SOL) }));
  await sendAndConfirmTransaction(connection, tx, [from], { commitment: 'confirmed' });
}

export interface Platform {
  client: EdgeBountyClient;
  connection: Connection;
  admin: Keypair;
  disputeAuthority: Keypair;
  mint: PublicKey;
  treasury: PublicKey;
}

/** Initializes the platform once per validator lifetime (idempotent). */
export async function ensurePlatform(): Promise<Platform> {
  const connection = new Connection(RPC, 'confirmed');
  const client = new EdgeBountyClient(connection);
  const admin = faucet();
  const existing = await client.config();
  // keyed per RPC endpoint so the legacy ledger's dispute authority key is never overwritten
  const daPath = join(ROOT, 'keys', `e2e-dispute-authority-${new URL(RPC).port || 'default'}.json`);
  if (existing) {
    if (!existing.paymentMint.equals(NATIVE_MINT)) throw new Error(`${RPC} is a legacy token ledger; start the SOL e2e validator (scripts/localnet-sol-e2e.sh)`);
    return { client, connection, admin, disputeAuthority: loadKeypair(daPath), mint: existing.paymentMint, treasury: existing.treasury };
  }
  const disputeAuthority = Keypair.generate();
  const { writeFileSync } = await import('node:fs');
  writeFileSync(daPath, JSON.stringify(Array.from(disputeAuthority.secretKey)));
  await fundSol(connection, admin, disputeAuthority.publicKey, 5);
  const mint = NATIVE_MINT;
  const treasury = (await getOrCreateAssociatedTokenAccount(connection, admin, mint, admin.publicKey)).address;
  const ixs = await client.initializePlatform(admin.publicKey, mint, treasury, {
    feeBps: 500,
    reviewWindowSecs: Number(process.env.REVIEW_WINDOW_SECS ?? 60),
    correctionWindowSecs: 60,
    failureBountyGraceSecs: 60,
    disputeAuthority: disputeAuthority.publicKey,
  });
  await client.send(ixs, [admin]);
  return { client, connection, admin, disputeAuthority, mint, treasury };
}

/** New wallet with 2 SOL for fees/rent plus `wrapped` lamports already wrapped into its wSOL account. */
export async function newUser(p: Platform, wrapped: bigint) {
  const kp = Keypair.generate();
  await fundSol(p.connection, p.admin, kp.publicKey, 2);
  const token = p.client.ata(kp.publicKey, NATIVE_MINT);
  const tx = new Transaction().add(p.client.ensureAta(kp.publicKey, kp.publicKey, NATIVE_MINT));
  if (wrapped > 0n) tx.add(SystemProgram.transfer({ fromPubkey: p.admin.publicKey, toPubkey: token, lamports: wrapped }), createSyncNativeInstruction(token));
  await sendAndConfirmTransaction(p.connection, tx, wrapped > 0n ? [kp, p.admin] : [kp], { commitment: 'confirmed' });
  return { kp, token };
}
