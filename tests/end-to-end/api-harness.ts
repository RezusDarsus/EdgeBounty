import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Keypair, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { CAPABILITIES } from '@edgebounty/shared-types';
import { loadConfig } from '../../apps/api/src/config.js';
import { createDb } from '../../apps/api/src/db/index.js';
import { createStorage } from '../../apps/api/src/storage/index.js';
import { ChainService } from '../../apps/api/src/chain.js';
import { buildApp } from '../../apps/api/src/app.js';
import { seed } from '../../apps/api/src/seed.js';
import type { AppContext } from '../../apps/api/src/context.js';
import { RPC, ensurePlatform, fundSol, newUser, type Platform } from './helpers.js';

// ------------------------------------------------------------------ tiny PNG encoder (fixtures)
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/** Deterministic RGB PNG with a seed-dependent pattern. */
export function png(w: number, h: number, seed: number): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (x * 7 + seed * 31) & 0xff;
      raw[o + 1] = (y * 5 + seed * 17) & 0xff;
      raw[o + 2] = ((x ^ y) + seed * 13) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

// ------------------------------------------------------------------ harness

export interface Harness {
  p: Platform;
  ctx: AppContext;
  app: Awaited<ReturnType<typeof buildApp>>;
  platformVerifier: Keypair;
  close: () => Promise<void>;
}

export async function startHarness(overrides: Record<string, string> = {}): Promise<Harness> {
  const p = await ensurePlatform();
  const platformVerifier = Keypair.generate();
  await fundSol(p.connection, p.admin, platformVerifier.publicKey, 5);
  const c = p.client;
  await c.send(await c.registerProvider(platformVerifier.publicKey, new Uint8Array(32), 0x7f), [platformVerifier]);
  await c.send(await c.reviewProvider(p.admin.publicKey, platformVerifier.publicKey, true, 0x7f), [p.admin]);
  const dataDir = mkdtempSync(join(tmpdir(), 'eb-e2e-'));
  const cfg = loadConfig({
    NODE_ENV: 'test',
    SOLANA_RPC_URL: RPC,
    DATA_DIR: dataDir,
    PLATFORM_VERIFIER_KEY: JSON.stringify(Array.from(platformVerifier.secretKey)),
    DISPUTE_AUTHORITY_KEY: JSON.stringify(Array.from(p.disputeAuthority.secretKey)),
    ADMIN_WALLETS: p.admin.publicKey.toBase58(),
    UPLOAD_PART_BYTES: String(64 * 1024),
    WORKERS: 'off',
    ...overrides,
  });
  const { db, close } = await createDb({ memory: true });
  await seed(db);
  const ctx: AppContext = { cfg, db, storage: createStorage(cfg), chain: new ChainService(cfg), events: {} };
  const app = await buildApp(ctx);
  return { p, ctx, app, platformVerifier, close: async () => { await app.close(); await close(); } };
}

export interface Actor {
  kp: Keypair;
  token: string;
  wallet: string;
}

export async function actor(h: Harness, wrapped: bigint): Promise<Actor> {
  const u = await newUser(h.p, wrapped);
  const token = await login(h, u.kp);
  return { kp: u.kp, token, wallet: u.kp.publicKey.toBase58() };
}

export async function login(h: Harness, kp: Keypair): Promise<string> {
  const ch = (await api(h, null, 'POST', '/auth/challenge', { wallet: kp.publicKey.toBase58() })).json;
  const sig = nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey);
  const res = await api(h, null, 'POST', '/auth/verify', { wallet: kp.publicKey.toBase58(), nonce: ch.nonce, signature: bs58.encode(sig) });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${res.body}`);
  return res.json.token;
}

export async function api(h: Harness, who: Actor | string | null, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const token = typeof who === 'string' ? who : who?.token;
  const res = await h.app.inject({
    method: method as any,
    url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(Buffer.isBuffer(body) ? { payload: body } : body !== undefined ? { payload: body as any } : {}),
  });
  let json: any = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    /* binary */
  }
  return { status: res.statusCode, json, body: res.body, raw: res.rawPayload, headers: res.headers };
}

export async function ok(h: Harness, who: Actor | null, method: string, url: string, body?: unknown) {
  const r = await api(h, who, method, url, body);
  if (r.status >= 300) throw new Error(`${method} ${url} -> ${r.status}: ${r.body}`);
  return r.json;
}

export async function send(h: Harness, who: Actor | Keypair, ixs: TransactionInstruction[]) {
  return h.p.client.send(ixs, ['kp' in who ? who.kp : who]);
}

/** Uploads files through the multipart API and finalizes the version. */
export async function uploadAsset(h: Harness, who: Actor, kind: 'dataset' | 'model', purpose: string, files: { path: string; data: Buffer; mediaType: string }[], name = 'asset') {
  if(['listing','benchmark','storage'].includes(purpose))await paidTestCapacity(h,who,files.reduce((n,f)=>n+f.data.length,0));
  const { asset, version } = await ok(h, who, 'POST', '/assets', { kind, name, purpose, category: 'object_detection' });
  for (const f of files) {
    const up = await ok(h, who, 'POST', `/versions/${version.id}/uploads`, { path: f.path, size: f.data.length, sha256: sha256(f.data), mediaType: f.mediaType });
    for (let i = 0; i < up.partsTotal; i++) {
      const part = f.data.subarray(i * up.partSize, (i + 1) * up.partSize);
      const r = await h.app.inject({ method: 'PUT', url: `/uploads/${up.uploadId}/parts/${i + 1}`, headers: { authorization: `Bearer ${who.token}`, 'content-type': 'application/octet-stream', 'x-part-sha256': sha256(part) }, payload: part });
      if (r.statusCode !== 200) throw new Error(`part upload failed: ${r.body}`);
    }
    await ok(h, who, 'POST', `/uploads/${up.uploadId}/complete`, {});
  }
  const fin = await ok(h, who, 'POST', `/versions/${version.id}/finalize`);
  return { assetId: asset.id as string, versionId: version.id as string, commitment: fin.commitment as string };
}

/** Fixtures pay the current storage policy rather than depending on the removed default free tier. */
export async function paidTestCapacity(h:Harness,who:Actor,needed=1){
  const usage=await ok(h,who,'GET','/storage');
  if(usage.quotaBytes-usage.usedBytes>=needed)return;
  const plan=await ok(h,who,'POST','/storage/allocations',{gb:10,termDays:30});
  await payInvoice(h,who,plan.invoice);
}

export const hex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));
export const pk = (s: string) => new PublicKey(s);
export { CAPABILITIES };

/** Listings require a passing paid L2/L3 report for the exact version: buy one, pay the invoice on-chain, run it. */
export async function paidVerification(h: Harness, who: Actor, versionId: string, level: 'L2' | 'L3' = 'L2') {
  const created = await ok(h, who, 'POST', '/verification/jobs', { assetVersionId: versionId, level });
  if (created.invoice) await payInvoice(h, who, created.invoice);
  const { drainJobs } = await import('../../apps/api/src/services/jobs.js');
  await drainJobs(h.ctx);
  const job = await ok(h, who, 'GET', `/verification/jobs/${created.job.id}`);
  if (job.status !== 'completed' || !job.result?.report?.passed) throw new Error(`listing verification did not pass: ${JSON.stringify(job).slice(0, 500)}`);
  return job;
}

/** Pays a platform invoice on-chain (wrapping only the SOL shortfall) and confirms it with the API. */
export async function payInvoice(h: Harness, who: Actor, inv: { id: string; reference: string; serviceKind: number; amountMicro: string }) {
  await send(h, who, await h.p.client.payService(who.kp.publicKey, hex(inv.reference), inv.serviceKind, BigInt(inv.amountMicro)));
  return ok(h, who, 'POST', `/invoices/${inv.id}/confirm`);
}
