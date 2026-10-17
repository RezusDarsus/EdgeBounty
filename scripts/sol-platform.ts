import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { NATIVE_MINT, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import { EdgeBountyClient } from '@edgebounty/blockchain-client';

export const ROOT = join(import.meta.dirname, '..');
export const RPC = process.env.SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';
export async function fundSol(connection: Connection, from: Keypair, to: PublicKey, sol = 2) {
  await sendAndConfirmTransaction(connection, new Transaction().add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: BigInt(sol) * 1_000_000_000n })), [from]);
}

/** Never repurpose an existing token platform or erase its ledger. */
export async function ensureSolPlatform() {
  const connection = new Connection(RPC, 'confirmed');
  const client = new EdgeBountyClient(connection);
  const load = (name: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(ROOT, 'keys', name), 'utf8'))));
  const admin = load('localnet-authority.json');
  const existing = await client.config();
  if (existing && !existing.paymentMint.equals(NATIVE_MINT)) throw new Error('This ledger uses the legacy payment token. Preserve its orders and database. Bootstrap a separate SOL demo ledger and DATA_DIR; do not relabel old balances.');
  const daPath = join(ROOT, 'keys', 'localnet-dispute-authority.json');
  const disputeAuthority = existsSync(daPath) ? load('localnet-dispute-authority.json') : Keypair.generate();
  if (!existsSync(daPath)) writeFileSync(daPath, JSON.stringify(Array.from(disputeAuthority.secretKey)));
  if (!existing) {
    await fundSol(connection, admin, disputeAuthority.publicKey, 5);
    const treasury = (await getOrCreateAssociatedTokenAccount(connection, admin, NATIVE_MINT, admin.publicKey)).address;
    await client.send(await client.initializePlatform(admin.publicKey, NATIVE_MINT, treasury, { feeBps: 600, reviewWindowSecs: Number(process.env.REVIEW_WINDOW_SECS ?? 60), correctionWindowSecs: 60, failureBountyGraceSecs: 60, disputeAuthority: disputeAuthority.publicKey }), [admin]);
  }
  const cfg = (await client.config())!;
  return { connection, client, admin, disputeAuthority, mint: NATIVE_MINT, treasury: cfg.treasury };
}
