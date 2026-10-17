/**
 * Local development bootstrap (run after `scripts/localnet.sh` is up):
 *   npx tsx scripts/dev-setup.ts
 * - initializes the platform (wrapped SOL mint, treasury, dispute authority) if needed
 * - creates + approves the platform verifier provider
 * - writes apps/api/.env and apps/web/.env.local
 * LOCALNET ONLY: keys are written to ./keys (gitignored).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { ensureSolPlatform, fundSol, RPC, ROOT } from './sol-platform.js';

const p = await ensureSolPlatform();
const vPath = join(ROOT, 'keys', 'platform-verifier.json');
let verifier: Keypair;
if (existsSync(vPath)) verifier = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(vPath, 'utf8'))));
else {
  verifier = Keypair.generate();
  writeFileSync(vPath, JSON.stringify(Array.from(verifier.secretKey)));
}
if ((await p.connection.getBalance(verifier.publicKey)) < 1e9) await fundSol(p.connection, p.admin, verifier.publicKey, 10);
const c = p.client;
if (!(await c.provider(verifier.publicKey))) {
  await c.send(await c.registerProvider(verifier.publicKey, new Uint8Array(32), 0x7f), [verifier]);
}
if (!(await c.provider(verifier.publicKey))?.approved) {
  await c.send(await c.reviewProvider(p.admin.publicKey, verifier.publicKey, true, 0x7f), [p.admin]);
}

const key = (k: Keypair) => JSON.stringify(Array.from(k.secretKey));
// merge: keep settings this script does not manage (AI provider keys, S3 credentials, …)
const envPath = join(ROOT, 'apps', 'api', '.env');
const managed = ['APP_DOMAIN', 'NODE_ENV', 'SOLANA_RPC_URL', 'PROGRAM_ID', 'PLATFORM_VERIFIER_KEY', 'DISPUTE_AUTHORITY_KEY', 'ADMIN_WALLETS', 'DEV_FAUCET_KEY', 'CORS_ORIGINS', 'DATA_DIR', 'INDEXER_INTERVAL_MS'];
const kept = existsSync(envPath)
  ? readFileSync(envPath, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !managed.includes(l.split('=')[0]))
  : [];
writeFileSync(
  envPath,
  [
    ...kept,
    // hosted demo (EC2) overrides these via env; defaults are plain localhost dev
    `APP_DOMAIN=${process.env.APP_DOMAIN ?? 'localhost:3000'}`,
    'NODE_ENV=development',
    `SOLANA_RPC_URL=${RPC}`,
    `PROGRAM_ID=${c.programId.toBase58()}`,
    `PLATFORM_VERIFIER_KEY=${key(verifier)}`,
    `DISPUTE_AUTHORITY_KEY=${key(p.disputeAuthority)}`,
    `ADMIN_WALLETS=${p.admin.publicKey.toBase58()}`,
    `DEV_FAUCET_KEY=${key(p.admin)}`,
    `CORS_ORIGINS=${process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000'}`,
    `DATA_DIR=${join(ROOT, '.data').replace(/\\/g, '/')}`,
    'INDEXER_INTERVAL_MS=4000',
    '',
  ].join('\n'),
);
writeFileSync(
  join(ROOT, 'apps', 'web', '.env.local'),
  [`NEXT_PUBLIC_API_URL=${process.env.PUBLIC_API_URL ?? 'http://127.0.0.1:4000'}`, `NEXT_PUBLIC_SOLANA_RPC_URL=${process.env.PUBLIC_RPC_URL ?? RPC}`, 'NEXT_PUBLIC_DEV_BURNER=1', ''].join('\n'),
);
console.log('platform ready');
console.log('  program          ', c.programId.toBase58());
console.log('  payment mint     ', p.mint.toBase58());
console.log('  platform verifier', verifier.publicKey.toBase58());
console.log('  admin            ', p.admin.publicKey.toBase58(), '(keys/localnet-authority.json)');
console.log('wrote apps/api/.env and apps/web/.env.local');
