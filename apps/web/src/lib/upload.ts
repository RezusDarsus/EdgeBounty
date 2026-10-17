'use client';
import { sha256 } from '@noble/hashes/sha2.js';
import { md5 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { api, API_URL } from './api';
import { requestWithRateLimit } from './request';

const HASH_CHUNK = 8 * 1024 * 1024;

/** Streaming SHA-256 of a File (works for multi-GB files without loading them into memory). */
export async function hashFile(file: File, onProgress?: (p: number) => void): Promise<string> {
  const h = sha256.create();
  for (let o = 0; o < file.size; o += HASH_CHUNK) {
    h.update(new Uint8Array(await file.slice(o, o + HASH_CHUNK).arrayBuffer()));
    onProgress?.(Math.min(1, (o + HASH_CHUNK) / file.size));
  }
  return bytesToHex(h.digest());
}

export function guessMediaType(name: string, type: string): string {
  if (type) return type;
  const ext = name.split('.').pop()?.toLowerCase();
  return (
    { csv: 'text/csv', json: 'application/json', jsonl: 'application/jsonl', parquet: 'application/vnd.apache.parquet', onnx: 'application/onnx', safetensors: 'application/x-safetensors', zip: 'application/zip', txt: 'text/plain' } as Record<string, string>
  )[ext ?? ''] ?? 'application/octet-stream';
}

export interface UploadProgress {
  file: string;
  phase: 'hashing' | 'uploading' | 'verifying' | 'done' | 'error';
  progress: number;
  error?: string;
}

/**
 * Multipart, resumable upload: per-part checksums, retries per part, server-side
 * whole-object verification on completion. Presigned URLs are used when the API returns them (R2/S3).
 */
export async function uploadFile(versionId: string, file: File, path: string, token: string | null, onProgress: (p: UploadProgress) => void, resume: { uploadId?: string; onCreated?: (id: string) => void } = {}) {
  onProgress({ file: path, phase: 'hashing', progress: 0 });
  const digest = await hashFile(file, (p) => onProgress({ file: path, phase: 'hashing', progress: p }));
  const up = resume.uploadId ? { uploadId: resume.uploadId, partSize: 0, partsTotal: 0, partUrls: null } : await api<{ uploadId: string; partSize: number; partsTotal: number; partUrls: (string | null)[] | null }>(`/versions/${versionId}/uploads`, {
    body: { path, size: file.size, sha256: digest, mediaType: guessMediaType(file.name, file.type) },
  });
  resume.onCreated?.(up.uploadId);
  const status = await api<{ status: string; partSize: number; partsTotal: number; partsReceived: number[]; partUrls: Record<number, string | null> | null; directParts?: boolean }>(`/uploads/${up.uploadId}`);
  if (status.status === 'complete') { onProgress({ file: path, phase: 'done', progress: 1 }); return; }
  if (status.status !== 'open') throw new Error('This upload is no longer open. Choose replacement files to start a new version.');
  up.partSize = status.partSize;
  up.partsTotal = status.partsTotal;
  const have = new Set(status.partsReceived);
  const urlFor = (n: number) => status.partUrls?.[n] ?? up.partUrls?.[n - 1] ?? null;
  const pending = Array.from({ length: up.partsTotal }, (_, i) => i + 1).filter((n) => !have.has(n));
  let completed = have.size;
  const worker = async () => {
  for (let n = pending.shift(); n !== undefined; n = pending.shift()) {
    const blob = file.slice((n - 1) * up.partSize, n * up.partSize);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const partHash = bytesToHex(sha256(buf));
    for (let attempt = 0; ; attempt++) {
      try {
        const signed = status.directParts ? await api<{ url: string; headers: Record<string, string> }>(`/uploads/${up.uploadId}/parts/${n}/url`, { body: { md5: btoa(String.fromCharCode(...md5(buf))) } }) : null;
        const url = signed?.url ?? urlFor(n);
        if (url) {
          const r = await fetch(url, { method: 'PUT', headers: signed?.headers, body: buf });
          if (!r.ok) throw new Error(`part ${n}: ${r.status}`);
        } else {
          const r = await requestWithRateLimit(`${API_URL}/uploads/${up.uploadId}/parts/${n}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/octet-stream', 'x-part-sha256': partHash, ...(token ? { authorization: `Bearer ${token}` } : {}) },
            body: buf,
          });
          if (!r.ok) throw new Error(`part ${n}: ${r.status} ${await r.text()}`);
        }
        break;
      } catch (e) {
        if (attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
    completed++;
    onProgress({ file: path, phase: 'uploading', progress: completed / up.partsTotal });
  }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(3, pending.length) }, worker));
  const failed = results.find((r) => r.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  onProgress({ file: path, phase: 'verifying', progress: 1 });
  await api(`/uploads/${up.uploadId}/complete`, { body: {} });
  onProgress({ file: path, phase: 'done', progress: 1 });
}
