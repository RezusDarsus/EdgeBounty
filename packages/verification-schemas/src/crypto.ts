/**
 * Advanced private mode: client-side encryption shared by browser and tests (WebCrypto + NaCl box).
 * Files are encrypted in fixed-size chunks with AES-256-GCM so multi-GB files never sit in memory.
 * IV for chunk i = 4-byte random per-file prefix || 8-byte big-endian chunk index.
 * Ciphertext layout: concat(chunk_i ciphertext || 16-byte tag), chunk plaintext size = chunkSize.
 */
export const ENC_SCHEME = 'aes-256-gcm-chunked-v1';
export const ENC_CHUNK = 4 * 1024 * 1024;
const TAG = 16;

const subtle = () => globalThis.crypto.subtle;

function iv(prefix: Uint8Array, i: number) {
  const out = new Uint8Array(12);
  out.set(prefix, 0);
  new DataView(out.buffer).setBigUint64(4, BigInt(i), false);
  return out;
}

export async function newContentKey(): Promise<Uint8Array> {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

async function aesKey(raw: Uint8Array) {
  return subtle().importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptBytes(raw: Uint8Array, data: Uint8Array, chunkSize = ENC_CHUNK): Promise<{ ciphertext: Uint8Array; ivPrefix: Uint8Array }> {
  const key = await aesKey(raw);
  const ivPrefix = globalThis.crypto.getRandomValues(new Uint8Array(4));
  const parts: Uint8Array[] = [];
  const n = Math.max(1, Math.ceil(data.length / chunkSize));
  for (let i = 0; i < n; i++) {
    const chunk = data.subarray(i * chunkSize, (i + 1) * chunkSize);
    parts.push(new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv(ivPrefix, i) as BufferSource }, key, chunk as BufferSource)));
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return { ciphertext: out, ivPrefix };
}

export async function decryptBytes(raw: Uint8Array, ciphertext: Uint8Array, ivPrefix: Uint8Array, chunkSize = ENC_CHUNK): Promise<Uint8Array> {
  const key = await aesKey(raw);
  const step = chunkSize + TAG;
  const parts: Uint8Array[] = [];
  for (let i = 0, o = 0; o < ciphertext.length; i++, o += step) {
    parts.push(new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: iv(ivPrefix, i) as BufferSource }, key, ciphertext.subarray(o, o + step) as BufferSource)));
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export async function keyFingerprint(raw: Uint8Array): Promise<string> {
  const d = new Uint8Array(await subtle().digest('SHA-256', raw as BufferSource));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}
