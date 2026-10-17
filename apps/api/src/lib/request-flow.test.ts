import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { loadConfig } from '../config.js';
import { createDb } from '../db/index.js';
import { ChainService } from '../chain.js';
import { createStorage } from '../storage/index.js';
import { buildApp } from '../app.js';
import { seed } from '../seed.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let close: () => Promise<void>;
let token: string;
let chain: ChainService;
const verifier = Keypair.generate();
const criteria = { kind: 'image_dataset', minImages: 1000 };
beforeAll(async () => {
  const cfg = loadConfig({ NODE_ENV: 'test', WORKERS: 'off', SOLANA_RPC_URL: 'http://127.0.0.1:1', PLATFORM_VERIFIER_KEY: JSON.stringify(Array.from(verifier.secretKey)) });
  const database = await createDb({ memory: true });
  close = database.close;
  await seed(database.db);
  chain = new ChainService(cfg);
  vi.spyOn(chain.client, 'config').mockResolvedValue({ paymentMint: NATIVE_MINT } as any);
  app = await buildApp({ cfg, db: database.db, chain, storage: createStorage(cfg), events: {} });
  const user = Keypair.generate();
  const challenge = (await app.inject({ method: 'POST', url: '/auth/challenge', payload: { wallet: user.publicKey.toBase58() } })).json();
  const response = await app.inject({ method: 'POST', url: '/auth/verify', payload: { wallet: user.publicKey.toBase58(), nonce: challenge.nonce, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), user.secretKey)) } });
  token = response.json().token;
});
afterAll(async () => { await app.close(); await close(); });

it('ignores a client-supplied zero fee and locks the quoted platform fee', async () => {
  const headers = { authorization: `Bearer ${token}` };
  const quote = await app.inject({ method: 'POST', url: '/bounties/verification-quote', headers, payload: { criteria, maxCorrections: 1 } });
  expect(quote.statusCode).toBe(200);
  const result = await app.inject({ method: 'POST', url: '/bounties', headers, payload: { title: 'Collect vehicle photos', description: 'Create an annotated dataset of damaged vehicles.', deliverables: ['Image archive', 'Annotations'], licenseId: 'eb-nonexclusive-commercial-v1', budgetMicro: '100000000', deadline: new Date(Date.now() + 86400000).toISOString(), criteria, maxCorrections: 1, verifierFeeMicro: '0' } });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().onchain.verifierFee).toBe(quote.json().feeMicro);
  expect(result.json().onchain.verifier).toBe(verifier.publicKey.toBase58());
  expect(result.json().onchain.verifierFee).toBe('10000000');
});

it('rejects using the SOL interface against a legacy token deployment', async () => {
  vi.mocked(chain.client.config).mockResolvedValueOnce({ paymentMint: Keypair.generate().publicKey } as any);
  const response = await app.inject({ method: 'GET', url: '/listings' });
  expect(response.statusCode).toBe(409);
  expect(response.json().error).toBe('legacy_currency');
});
