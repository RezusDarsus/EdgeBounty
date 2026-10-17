import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export { bytesToHex, hexToBytes, randomBytes };

/** Deterministic JSON: object keys sorted recursively, no whitespace, no undefined. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v: unknown): unknown {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('non-finite number in canonical JSON');
    return v;
  }
  if (Array.isArray(v)) return v.map(sortDeep);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>).sort()) {
    const val = (v as Record<string, unknown>)[k];
    if (val !== undefined) out[k] = sortDeep(val);
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function sha256Hex(data: Uint8Array | string): string {
  return bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));
}

export const DOMAIN = {
  manifest: 'edgebounty:manifest:v1',
  terms: 'edgebounty:terms:v1',
  criteria: 'edgebounty:criteria:v1',
  license: 'edgebounty:license:v1',
  report: 'edgebounty:report:v1',
  evidence: 'edgebounty:evidence:v1',
  provider: 'edgebounty:provider:v1',
  spec: 'edgebounty:spec:v1',
} as const;

/** Domain-separated hash of a canonical JSON document → 32 bytes. */
export function hashDocument(domain: string, doc: unknown): Uint8Array {
  return sha256(concat(utf8ToBytes(domain), utf8ToBytes(canonicalJson(doc))));
}

/** Domain-separated hash of a text (e.g. license text). */
export function hashText(domain: string, text: string): Uint8Array {
  return sha256(concat(utf8ToBytes(domain), utf8ToBytes(text)));
}

/**
 * Salted manifest commitment. The salt stays private so equal datasets do not produce
 * linkable public hashes; anyone given (salt, manifest) can re-verify the commitment.
 */
export function manifestCommitment(manifest: unknown, salt: Uint8Array): Uint8Array {
  if (salt.length !== 32) throw new Error('salt must be 32 bytes');
  return sha256(concat(utf8ToBytes(DOMAIN.manifest), salt, utf8ToBytes(canonicalJson(manifest))));
}

export function newSalt(): Uint8Array {
  return randomBytes(32);
}
