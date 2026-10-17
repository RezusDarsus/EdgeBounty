import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile, rename, readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Readable } from 'node:stream';
import type { Config } from '../config.js';

export interface ObjectStat {
  size: number;
}

/** Private object storage. Keys must be unguessable; authorization never relies on key secrecy alone. */
export interface ObjectStorage {
  readonly kind: 'local' | 's3';
  put(key: string, body: Buffer | Readable): Promise<void>;
  get(key: string): Promise<Readable>;
  /** Inclusive byte range [start, end] (HTTP Range semantics). */
  getRange(key: string, start: number, end: number): Promise<Readable>;
  read(key: string): Promise<Buffer>;
  stat(key: string): Promise<ObjectStat | null>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<number>;
  initMultipart(key: string): Promise<string>;
  putPart(key: string, uploadId: string, partNo: number, body: Buffer): Promise<string>;
  presignPart(key: string, uploadId: string, partNo: number, expiresSec: number, contentMd5?: string): Promise<string | null>;
  /** Short-lived direct download URL (null when the backend cannot presign; stream through the API instead). */
  presignGet(key: string, expiresSec: number, downloadName?: string): Promise<string | null>;
  completeMultipart(key: string, uploadId: string, parts: { partNo: number; etag: string }[]): Promise<void>;
  /** Parts the storage backend actually holds (authoritative for resume/complete). */
  listParts(key: string, uploadId: string): Promise<{ partNo: number; etag: string; size: number }[]>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  /** Copy an object to a local file (for sandboxed workers). */
  materialize(key: string, dest: string): Promise<void>;
}

export const keys = {
  /** Tenant-scoped: every customer object lives under tenants/<accountId>/<category>/. */
  asset: (ownerId: string, category: StorageCategory, assetId: string, versionId: string) => `${tenantPrefix(ownerId)}${category}/${assetId}/${versionId}/${randomUUID()}`,
  preview: (versionId: string, name: string) => `temporary-previews/${versionId}/${randomUUID()}-${name}`,
  evalResult: (jobId: string) => `evaluation-results/${jobId}/${randomUUID()}.json`,
};

/**
 * Two storage categories:
 * - `workflow`: bounty submissions, dispute evidence, failure examples, verification inputs. Paid for by the
 *   bounty / order escrow, capped per version (SUBMISSION_MAX_BYTES), never counted against the paid quota.
 * - `customer`: marketplace listings, models, benchmarks and plain storage — counted against the account's
 *   storage quota (free tier + active monthly plans).
 */
export type StorageCategory = 'workflow' | 'customer';
export const WORKFLOW_PURPOSES = ['submission', 'evidence', 'failure_example', 'verification'] as const;
export function storageCategory(purpose: string): StorageCategory {
  return (WORKFLOW_PURPOSES as readonly string[]).includes(purpose) ? 'workflow' : 'customer';
}

export const tenantPrefix = (accountId: string) => `tenants/${accountId}/`;
/** True when `key` belongs to `accountId`. Keys created before tenant prefixes (marketplace-assets/…) are legacy and only reachable via DB ownership. */
export function keyBelongsTo(key: string, accountId: string) {
  if (key.startsWith('r2/')) key = key.slice(3);
  return key.startsWith(tenantPrefix(accountId)) || key.startsWith('marketplace-assets/');
}

export async function sha256OfStream(s: Readable): Promise<{ sha256: string; size: number }> {
  const h = createHash('sha256');
  let size = 0;
  for await (const chunk of s) {
    h.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { sha256: h.digest('hex'), size };
}

// ------------------------------------------------------------------ local filesystem

export class LocalStorage implements ObjectStorage {
  readonly kind = 'local' as const;
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string) {
    if (key.includes('..') || key.startsWith('/') || key.includes('\\')) throw new Error('invalid key');
    const p = resolve(this.root, ...key.split('/'));
    if (!p.startsWith(this.root + sep)) throw new Error('invalid key');
    return p;
  }
  async put(key: string, body: Buffer | Readable) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${randomUUID()}.tmp`;
    if (Buffer.isBuffer(body)) await writeFile(tmp, body);
    else await pipeline(body, createWriteStream(tmp));
    await rename(tmp, p);
  }
  async get(key: string) {
    const p = this.path(key);
    await stat(p);
    return createReadStream(p);
  }
  async getRange(key: string, start: number, end: number) {
    return createReadStream(this.path(key), { start, end });
  }

  async read(key: string) {
    return readFile(this.path(key));
  }
  async stat(key: string) {
    try {
      const s = await stat(this.path(key));
      return { size: s.size };
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
  async deletePrefix(prefix: string) {
    const p = this.path(prefix.replace(/\/$/, ''));
    let n = 0;
    try {
      n = (await readdir(p, { recursive: true })).length;
    } catch {
      return 0;
    }
    await rm(p, { recursive: true, force: true });
    return n;
  }
  private partDir(uploadId: string) {
    if (!/^[0-9a-f-]{36}$/.test(uploadId)) throw new Error('invalid upload id');
    return join(this.root, '.multipart', uploadId);
  }
  async initMultipart() {
    const id = randomUUID();
    await mkdir(this.partDir(id), { recursive: true });
    return id;
  }
  async putPart(_key: string, uploadId: string, partNo: number, body: Buffer) {
    await writeFile(join(this.partDir(uploadId), String(partNo)), body);
    return createHash('md5').update(body).digest('hex');
  }
  async presignGet() {
    return null;
  }
  async presignPart() {
    return null;
  }
  async completeMultipart(key: string, uploadId: string, parts: { partNo: number; etag: string }[]) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${randomUUID()}.tmp`;
    const out = createWriteStream(tmp);
    for (const part of [...parts].sort((a, b) => a.partNo - b.partNo)) {
      for await (const chunk of createReadStream(join(this.partDir(uploadId), String(part.partNo)))) {
        if (!out.write(chunk)) await once(out, 'drain');
      }
    }
    await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())));
    await rename(tmp, p);
    await rm(this.partDir(uploadId), { recursive: true, force: true });
  }
  async abortMultipart(_key: string, uploadId: string) {
    await rm(this.partDir(uploadId), { recursive: true, force: true });
  }
  async listParts(_key: string, uploadId: string) {
    const dir = this.partDir(uploadId);
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const out = [];
    for (const n of names.filter((x) => /^\d+$/.test(x))) {
      const b = await readFile(join(dir, n));
      out.push({ partNo: Number(n), etag: createHash('md5').update(b).digest('hex'), size: b.length });
    }
    return out.sort((a, b) => a.partNo - b.partNo);
  }
  async materialize(key: string, dest: string) {
    await mkdir(dirname(dest), { recursive: true });
    await pipeline(createReadStream(this.path(key)), createWriteStream(dest));
  }
}

// ------------------------------------------------------------------ S3 / Cloudflare R2

export class S3Storage implements ObjectStorage {
  readonly kind = 's3' as const;
  private clientP: Promise<any>;
  constructor(private cfg: Config, private record?: (operation: string, ok: boolean) => Promise<void>) {
    this.clientP = (async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');
      return new S3Client({
        region: s3Region(cfg),
        endpoint: cfg.S3_ENDPOINT || undefined,
        // static keys only for non-AWS endpoints (R2); on AWS the default provider chain picks up the
        // EC2 instance role's short-lived credentials, so no long-lived secret lives on the box
        ...(cfg.S3_ACCESS_KEY_ID && cfg.S3_SECRET_ACCESS_KEY ? { credentials: { accessKeyId: cfg.S3_ACCESS_KEY_ID, secretAccessKey: cfg.S3_SECRET_ACCESS_KEY } } : {}),
      });
    })();
  }
  private get bucket() {
    return this.cfg.S3_BUCKET!;
  }
  private async send(cmdName: string, input: Record<string, unknown>) {
    const mod: any = await import('@aws-sdk/client-s3');
    try {
      const result = await (await this.clientP).send(new mod[cmdName]({ Bucket: this.bucket, ...input }));
      await this.record?.(cmdName, true).catch(() => {});
      return result;
    } catch (e) {
      await this.record?.(cmdName, false).catch(() => {});
      throw e;
    }
  }
  async put(key: string, body: Buffer | Readable) {
    await this.send('PutObjectCommand', { Key: key, Body: body });
  }
  async get(key: string) {
    const r = await this.send('GetObjectCommand', { Key: key });
    return r.Body as Readable;
  }
  async getRange(key: string, start: number, end: number) {
    const r = await this.send('GetObjectCommand', { Key: key, Range: `bytes=${start}-${end}` });
    return r.Body as Readable;
  }
  async read(key: string) {
    const chunks: Buffer[] = [];
    for await (const c of await this.get(key)) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }
  async stat(key: string) {
    try {
      const r = await this.send('HeadObjectCommand', { Key: key });
      return { size: Number(r.ContentLength) };
    } catch (e: any) {
      if (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound') return null;
      throw e;
    }
  }
  async delete(key: string) {
    await this.send('DeleteObjectCommand', { Key: key });
  }
  async deletePrefix(prefix: string) {
    let n = 0;
    let token: string | undefined;
    do {
      const r = await this.send('ListObjectsV2Command', { Prefix: prefix, ContinuationToken: token });
      for (const o of r.Contents ?? []) {
        await this.delete(o.Key);
        n++;
      }
      token = r.NextContinuationToken;
    } while (token);
    return n;
  }
  async initMultipart(key: string) {
    const r = await this.send('CreateMultipartUploadCommand', { Key: key });
    return r.UploadId as string;
  }
  async putPart(key: string, uploadId: string, partNo: number, body: Buffer) {
    const r = await this.send('UploadPartCommand', { Key: key, UploadId: uploadId, PartNumber: partNo, Body: body });
    return r.ETag as string;
  }
  async presignGet(key: string, expiresSec: number, downloadName?: string) {
    if (this.cfg.S3_DIRECT_TRANSFERS === '0') return null;
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const disposition = downloadName ? `attachment; filename="${downloadName.replace(/["\\\r\n]/g, '_')}"` : undefined;
    return getSignedUrl(await this.clientP, new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: disposition }), { expiresIn: expiresSec });
  }
  async presignPart(key: string, uploadId: string, partNo: number, expiresSec: number, contentMd5?: string) {
    if (this.cfg.S3_DIRECT_TRANSFERS === '0') return null;
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const { UploadPartCommand } = await import('@aws-sdk/client-s3');
    return getSignedUrl(await this.clientP, new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNo, ContentMD5: contentMd5 }), { expiresIn: expiresSec });
  }
  async completeMultipart(key: string, uploadId: string, parts: { partNo: number; etag: string }[]) {
    await this.send('CompleteMultipartUploadCommand', {
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: [...parts].sort((a, b) => a.partNo - b.partNo).map((p) => ({ PartNumber: p.partNo, ETag: p.etag })) },
    });
  }
  async abortMultipart(key: string, uploadId: string) {
    await this.send('AbortMultipartUploadCommand', { Key: key, UploadId: uploadId });
  }
  async listParts(key: string, uploadId: string) {
    const out: { partNo: number; etag: string; size: number }[] = [];
    let marker: string | undefined;
    do {
      const r = await this.send('ListPartsCommand', { Key: key, UploadId: uploadId, PartNumberMarker: marker });
      for (const p of r.Parts ?? []) out.push({ partNo: p.PartNumber, etag: p.ETag, size: Number(p.Size) });
      marker = r.IsTruncated ? String(r.NextPartNumberMarker) : undefined;
    } while (marker);
    return out;
  }
  async materialize(key: string, dest: string) {
    await mkdir(dirname(dest), { recursive: true });
    await pipeline(await this.get(key), createWriteStream(dest));
  }
}

/** S3_REGION wins; else AWS_REGION; 'auto' is only valid for R2-style endpoints. */
export function s3Region(cfg: Config) {
  if (cfg.S3_REGION) return cfg.S3_REGION;
  return process.env.AWS_REGION ?? (cfg.S3_ENDPOINT ? 'auto' : 'us-east-1');
}

export function createStorage(cfg: Config, record?: (operation: string, ok: boolean) => Promise<void>): ObjectStorage {
  if (cfg.STORAGE_DRIVER === 's3' || cfg.STORAGE_DRIVER === 'r2') {
    if (!cfg.S3_BUCKET) throw new Error('S3 storage requires S3_BUCKET');
    if (cfg.S3_ENDPOINT && !(cfg.S3_ACCESS_KEY_ID && cfg.S3_SECRET_ACCESS_KEY)) throw new Error('a custom S3_ENDPOINT (e.g. R2) requires S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
    const remote = new S3Storage(cfg, record);
    if (cfg.STORAGE_DRIVER !== 'r2') return remote;
    if (!cfg.S3_ENDPOINT?.match(/^https:\/\/[a-z0-9.-]+\.r2\.cloudflarestorage\.com$/i)) throw new Error('R2 requires its HTTPS S3 endpoint');
    // Existing filesystem objects retain their keys. Only new, explicitly prefixed objects use R2.
    const local = new LocalStorage(join(cfg.DATA_DIR, 'objects'));
    return new Proxy(remote, {
      get(target, prop) {
        if (prop === 'kind') return 's3';
        const value = Reflect.get(target, prop, target);
        if (typeof value !== 'function') return value;
        return (key: string, ...args: any[]) => {
          const isRemote = key.startsWith('r2/');
          const backend = isRemote ? target : local;
          return (backend as any)[prop](isRemote ? key.slice(3) : key, ...args);
        };
      },
    });
  }
  return new LocalStorage(join(cfg.DATA_DIR, 'objects'));
}
