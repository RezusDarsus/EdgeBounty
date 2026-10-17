import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

/** Dev/test helpers. Never used against mainnet: they mint a mock "USDC". */
export async function airdrop(connection: Connection, to: PublicKey, sol = 10) {
  const sig = await connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  const bh = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
}

export async function createTestUsdc(connection: Connection, authority: Keypair): Promise<PublicKey> {
  return createMint(connection, authority, authority.publicKey, null, 6);
}

export async function fundTestUsdc(connection: Connection, authority: Keypair, mint: PublicKey, owner: PublicKey, amount: bigint) {
  const ata = await getOrCreateAssociatedTokenAccount(connection, authority, mint, owner, true);
  if (amount > 0n) await mintTo(connection, authority, mint, ata.address, authority, amount);
  return ata.address;
}

export function keypairFromJson(json: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(json)));
}
