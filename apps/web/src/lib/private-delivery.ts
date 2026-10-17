'use client';
import nacl from 'tweetnacl';
import { decryptBytes, encryptBytes, keyFingerprint, newContentKey, ENC_CHUNK, ENC_SCHEME } from '@edgebounty/verification-schemas';
import { api, API_URL, loadToken } from './api';

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));

function store(key: string, value?: string) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
  return null;
}

/** Seller: encrypt files in the browser. The content key is kept locally (needed to seal it to the buyer later). */
export async function encryptFiles(files: File[]): Promise<{ encrypted: File[]; ivs: Record<string, string>; key: Uint8Array; fingerprint: string }> {
  const key = await newContentKey();
  const encrypted: File[] = [];
  const ivs: Record<string, string> = {};
  for (const f of files) {
    const { ciphertext, ivPrefix } = await encryptBytes(key, new Uint8Array(await f.arrayBuffer()));
    const name = `${((f as any).webkitRelativePath as string) || f.name}.enc`;
    encrypted.push(new File([ciphertext as BlobPart], name.split('/').pop()!, { type: 'application/octet-stream' }));
    Object.defineProperty(encrypted.at(-1)!, 'webkitRelativePath', { value: name });
    ivs[name] = hex(ivPrefix);
  }
  return { encrypted, ivs, key, fingerprint: await keyFingerprint(key) };
}

export async function declareEncryption(versionId: string, ivs: Record<string, string>, key: Uint8Array, fingerprint: string) {
  await api(`/versions/${versionId}/encryption`, { body: { scheme: ENC_SCHEME, chunkSize: ENC_CHUNK, files: ivs, keyFingerprint: fingerprint } });
  store(`eb_ck_${versionId}`, hex(key));
}

/** Buyer: create (once) and register a box key for this order; the secret never leaves the browser. */
export async function registerBuyerBoxKey(orderId: string) {
  let secret = store(`eb_box_${orderId}`);
  if (!secret) {
    const kp = nacl.box.keyPair();
    secret = hex(kp.secretKey);
    store(`eb_box_${orderId}`, secret);
  }
  const kp = nacl.box.keyPair.fromSecretKey(unhex(secret));
  await api(`/orders/${orderId}/delivery-key`, { body: { boxPublicKey: b64(kp.publicKey) } });
}

/** Seller: seal the content key to the buyer's registered box key (after settlement). */
export async function sealKeyForBuyer(orderId: string, versionId: string) {
  const ck = store(`eb_ck_${versionId}`);
  if (!ck) throw new Error('content key not found in this browser — use the browser you encrypted with');
  const info = await api(`/orders/${orderId}/delivery-key`);
  if (!info.buyerBoxPublicKey) throw new Error('the buyer has not registered a delivery key yet');
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const sealed = nacl.box(unhex(ck), nonce, unb64(info.buyerBoxPublicKey), eph.secretKey);
  await api(`/orders/${orderId}/delivery-key/envelope`, { body: { envelope: b64(sealed), nonce: b64(nonce), sellerBoxPublicKey: b64(eph.publicKey) } });
}

/** Buyer: download a ciphertext file, open the envelope, verify the key fingerprint and decrypt locally. */
export async function downloadDecrypted(orderId: string, file: { url: string; path: string }) {
  const info = await api(`/orders/${orderId}/delivery-key`);
  const secret = store(`eb_box_${orderId}`);
  if (!info.envelope || !secret) throw new Error('decryption key not available yet');
  const key = nacl.box.open(unb64(info.envelope), unb64(info.nonce), unb64(info.sellerBoxPublicKey), unhex(secret));
  if (!key || (await keyFingerprint(key)) !== info.params.keyFingerprint) throw new Error('key envelope does not match the declared key');
  const t = loadToken();
  const res = await fetch(`${API_URL}${file.url}`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
  const ct = new Uint8Array(await res.arrayBuffer());
  const plain = await decryptBytes(key, ct, unhex(info.params.files[file.path]).slice(0, 4), info.params.chunkSize);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([plain as BlobPart]));
  a.download = file.path.replace(/\.enc$/, '').split('/').pop()!;
  a.click();
}
