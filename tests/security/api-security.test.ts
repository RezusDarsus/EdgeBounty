/** Off-chain security properties of the API (no validator required). */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NATIVE_MINT } from '@solana/spl-token';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import { loadConfig } from '../../apps/api/src/config.js';
import { createDb } from '../../apps/api/src/db/index.js';
import { createStorage, LocalStorage } from '../../apps/api/src/storage/index.js';
import { ChainService } from '../../apps/api/src/chain.js';
import { buildApp } from '../../apps/api/src/app.js';
import { seed } from '../../apps/api/src/seed.js';
import { signDownloadToken, verifyDownloadToken } from '../../apps/api/src/lib/tokens.js';
import { sanitizePath } from '../../apps/api/src/lib/assets.js';
import type { AppContext } from '../../apps/api/src/context.js';
import { png, sha256 } from '../end-to-end/api-harness.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let ctx: AppContext;
let close: () => Promise<void>;

beforeAll(async () => {
  const cfg = loadConfig({ NODE_ENV: 'test', DATA_DIR: mkdtempSync(join(tmpdir(), 'eb-sec-')), WORKERS: 'off', UPLOAD_PART_BYTES: '1024', FREE_STORAGE_BYTES: '20000', SOLANA_RPC_URL: 'http://127.0.0.1:1' });
  const d = await createDb({ memory: true });
  await seed(d.db);
  ctx = { cfg, db: d.db, storage: createStorage(cfg), chain: new ChainService(cfg), events: {} };
  vi.spyOn(ctx.chain.client, 'config').mockResolvedValue({ paymentMint: NATIVE_MINT } as any);
  app = await buildApp(ctx);
  close = d.close;
});
afterAll(async () => {
  await app.close();
  await close();
});

const req = (method: string, url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: method as any, url, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, ...(payload !== undefined ? { payload: payload as any } : {}) });

async function signIn(kp = Keypair.generate()) {
  const ch = (await req('POST', '/auth/challenge', undefined, { wallet: kp.publicKey.toBase58() })).json();
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey));
  const r = await req('POST', '/auth/verify', undefined, { wallet: kp.publicKey.toBase58(), nonce: ch.nonce, signature });
  return { kp, ch, signature, res: r, token: r.json().token as string };
}

describe('authentication (SIWS)', () => {
  it('binds domain, nonce and expiry into the signed message', async () => {
    const { ch, res } = await signIn();
    expect(res.statusCode).toBe(200);
    expect(ch.message).toContain('localhost:3000 wants you to sign in');
    expect(ch.message).toContain(`Nonce: ${ch.nonce}`);
    expect(ch.message).toContain('Expiration Time:');
  });
  it('rejects replayed nonces, wrong signers and forged signatures', async () => {
    const a = await signIn();
    const replay = await req('POST', '/auth/verify', undefined, { wallet: a.kp.publicKey.toBase58(), nonce: a.ch.nonce, signature: a.signature });
    expect(replay.statusCode).toBe(401);
    const victim = Keypair.generate();
    const attacker = Keypair.generate();
    const ch = (await req('POST', '/auth/challenge', undefined, { wallet: victim.publicKey.toBase58() })).json();
    const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), attacker.secretKey));
    expect((await req('POST', '/auth/verify', undefined, { wallet: victim.publicKey.toBase58(), nonce: ch.nonce, signature: sig })).statusCode).toBe(401);
    expect((await req('GET', '/me', 'not-a-jwt')).statusCode).toBe(401);
  });
  it('creates a pseudonymous account with a generated alias and no public profile', async () => {
    const { token, kp } = await signIn();
    const me = (await req('GET', '/me', token)).json();
    expect(me.account.mode).toBe('pseudonymous');
    expect(me.account.alias).toMatch(/^[a-z]+-[a-z]+-\d+$/);
    await req('PATCH', '/me', token, { displayName: 'Secret Name' });
    const pub = (await req('GET', `/profiles/${kp.publicKey.toBase58()}`)).json();
    expect(pub.profile).toBeNull();
  });
});

describe('uploads & storage', () => {
  it('rejects path traversal and disallowed media types', async () => {
    expect(() => sanitizePath('../../etc/passwd')).toThrow();
    expect(() => sanitizePath('/abs/path')).toThrow();
    expect(() => sanitizePath('a/./b')).toThrow();
    expect(sanitizePath('a\\b.png')).toBe('a/b.png');
    const { token } = await signIn();
    const { version } = (await req('POST', '/assets', token, { kind: 'dataset', name: 'x', purpose: 'listing' })).json();
    const bad = await req('POST', `/versions/${version.id}/uploads`, token, { path: 'x.exe', size: 10, sha256: '0'.repeat(64), mediaType: 'application/x-msdownload' });
    expect(bad.statusCode).toBe(400);
  });
  it('verifies part checksums, part sizes and the final object hash; enforces quota', async () => {
    const { token } = await signIn();
    const other = await signIn();
    const { version } = (await req('POST', '/assets', token, { kind: 'dataset', name: 'x', purpose: 'listing' })).json();
    const data = png(40, 40, 3);
    const up = (await req('POST', `/versions/${version.id}/uploads`, token, { path: 'a.png', size: data.length, sha256: sha256(data), mediaType: 'image/png' })).json();
    expect(up.partsTotal).toBeGreaterThan(1);
    const part1 = data.subarray(0, up.partSize);
    const put = (n: number, body: Buffer, t = token, sum = sha256(body)) => req('PUT', `/uploads/${up.uploadId}/parts/${n}`, t, body, { 'content-type': 'application/octet-stream', 'x-part-sha256': sum });
    expect((await put(1, part1, token, '0'.repeat(64))).statusCode).toBe(400);
    expect((await put(1, part1.subarray(1))).statusCode).toBe(400);
    expect((await put(1, part1, other.token)).statusCode).toBe(403);
    for (let i = 0; i < up.partsTotal; i++) expect((await put(i + 1, data.subarray(i * up.partSize, (i + 1) * up.partSize))).statusCode).toBe(200);
    // resumable: server reports received parts
    expect((await req('GET', `/uploads/${up.uploadId}`, token)).json().partsReceived).toHaveLength(up.partsTotal);
    expect((await req('POST', `/uploads/${up.uploadId}/complete`, token, {})).statusCode).toBe(200);
    // a lying declared hash is caught after assembly
    const up2 = (await req('POST', `/versions/${version.id}/uploads`, token, { path: 'b.png', size: data.length, sha256: 'f'.repeat(64), mediaType: 'image/png' })).json();
    for (let i = 0; i < up2.partsTotal; i++) await req('PUT', `/uploads/${up2.uploadId}/parts/${i + 1}`, token, data.subarray(i * up2.partSize, (i + 1) * up2.partSize), { 'content-type': 'application/octet-stream' });
    expect((await req('POST', `/uploads/${up2.uploadId}/complete`, token, {})).statusCode).toBe(400);
    // quota: free tier is 20 KB in this test
    const big = (await req('POST', `/versions/${version.id}/uploads`, token, { path: 'c.bin', size: 50_000, sha256: '0'.repeat(64), mediaType: 'application/octet-stream' })).json();
    expect(big.error).toBe('quota_exceeded');
  });
  it('finalized versions are immutable and commitments are salted', async () => {
    const { token } = await signIn();
    const { version } = (await req('POST', '/assets', token, { kind: 'dataset', name: 'x', purpose: 'listing' })).json();
    const data = png(8, 8, 1);
    const up = (await req('POST', `/versions/${version.id}/uploads`, token, { path: 'a.png', size: data.length, sha256: sha256(data), mediaType: 'image/png' })).json();
    await req('PUT', `/uploads/${up.uploadId}/parts/1`, token, data, { 'content-type': 'application/octet-stream' });
    await req('POST', `/uploads/${up.uploadId}/complete`, token, {});
    const fin = (await req('POST', `/versions/${version.id}/finalize`, token)).json();
    expect(fin.commitment).toMatch(/^[0-9a-f]{64}$/);
    expect((await req('POST', `/versions/${version.id}/uploads`, token, { path: 'z.png', size: 1, sha256: '0'.repeat(64), mediaType: 'image/png' })).statusCode).toBe(409);
    const proof = (await req('GET', `/versions/${version.id}/commitment-proof`, token)).json();
    expect(proof.salt).toMatch(/^[0-9a-f]{64}$/);
    const stranger = await signIn();
    expect((await req('GET', `/versions/${version.id}/commitment-proof`, stranger.token)).statusCode).toBe(403);
  });
  it('local object storage refuses keys that escape its root', async () => {
    const s = new LocalStorage(mkdtempSync(join(tmpdir(), 'eb-store-')));
    await expect(s.put('../escape', Buffer.from('x'))).rejects.toThrow();
    await expect(s.put('a\\..\\b', Buffer.from('x'))).rejects.toThrow();
  });
});

describe('download tokens', () => {
  it('are HMAC-bound, expiring and tamper-evident', () => {
    const secret = 'x'.repeat(40);
    const t = signDownloadToken(secret, { s: 'delivery', g: 'g', f: 'f', w: 'w', x: Math.floor(Date.now() / 1000) + 60 });
    expect(verifyDownloadToken(secret, t)?.f).toBe('f');
    expect(verifyDownloadToken('y'.repeat(40), t)).toBeNull();
    const [body, mac] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ s: 'delivery', g: 'g', f: 'other', w: 'w', x: 9e9 })).toString('base64url');
    expect(verifyDownloadToken(secret, `${forged}.${mac}`)).toBeNull();
    expect(verifyDownloadToken(secret, signDownloadToken(secret, { s: 'delivery', g: 'g', f: 'f', w: 'w', x: 1 }))).toBeNull();
    expect(body.length).toBeGreaterThan(10);
  });
});

describe('access control', () => {
  it('admin endpoints require an admin wallet; API keys authenticate and can be revoked', async () => {
    const { token } = await signIn();
    expect((await req('GET', '/admin/overview', token)).statusCode).toBe(403);
    const key = (await req('POST', '/me/api-keys', token, { name: 'ci', scopes: ['read'] })).json();
    expect(key.key).toMatch(/^eb_/);
    expect((await req('GET', '/me', undefined, undefined, { 'x-api-key': key.key })).statusCode).toBe(200);
    await req('DELETE', `/me/api-keys/${key.id}`, token);
    expect((await req('GET', '/me', undefined, undefined, { 'x-api-key': key.key })).statusCode).toBe(401);
  });
  it('previews of unpublished assets are private', async () => {
    const r = await req('GET', '/previews/00000000-0000-0000-0000-000000000000/0');
    expect(r.statusCode).toBe(404);
  });
});

describe('CORS (browser clients)', () => {
  it('uses current administrator configuration rather than stale JWT roles', async () => {
    const kp = Keypair.generate(); const previous = ctx.cfg.ADMIN_WALLETS;
    try {
      ctx.cfg.ADMIN_WALLETS = kp.publicKey.toBase58();
      const s = await signIn(kp);
      expect((await req('GET', '/me', s.token)).json().roles).toContain('admin');
      ctx.cfg.ADMIN_WALLETS = '';
      expect((await req('GET', '/me', s.token)).json().roles).not.toContain('admin');
    } finally { ctx.cfg.ADMIN_WALLETS = previous; }
  });
  it('revokes JWT and API-key access immediately after account deletion', async () => {
    const s = await signIn();
    const token = s.token;
    const key = (await req('POST', '/me/api-keys', token, { name: 'delete regression', scopes: ['read'] })).json();
    expect((await req('GET', '/me', token)).statusCode).toBe(200);
    expect((await req('DELETE', '/me', token)).statusCode).toBe(200);
    expect((await req('GET', '/me', token)).statusCode).toBe(401);
    expect((await req('GET', '/me', undefined, undefined, { 'x-api-key': key.key })).statusCode).toBe(401);
  });
  it('preflight allows the methods and headers the web app uses', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const r = await app.inject({ method: 'OPTIONS', url: '/uploads/x/parts/1', headers: { origin: 'http://localhost:3000', 'access-control-request-method': method, 'access-control-request-headers': 'authorization,content-type,x-part-sha256' } });
      expect(r.statusCode).toBe(204);
      expect(String(r.headers['access-control-allow-methods'])).toContain(method);
      expect(String(r.headers['access-control-allow-headers']).toLowerCase()).toContain('x-part-sha256');
    }
    const evil = await app.inject({ method: 'OPTIONS', url: '/me', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});
