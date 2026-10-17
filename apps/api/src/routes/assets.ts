import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, isNull, lt, max, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { multipartLayout } from '../lib/multipart.js';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { keyBelongsTo, keys, sha256OfStream, storageCategory } from '../storage/index.js';
import { ALLOWED_MEDIA, finalizeVersion, getOwnedVersion, reserveUpload, sanitizePath } from '../lib/assets.js';
import { badRequest, conflict, forbidden, notFound, parse, requireSession, zUuid } from '../lib/http.js';
import { enqueuePreview } from '../services/jobs.js';

const UPLOAD_TTL_MS = 24 * 3600 * 1000;

export function assetRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, storage, cfg } = ctx;

  // raw part bodies
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: cfg.UPLOAD_PART_BYTES + 1024 }, (_req, body, done) => done(null, body));

  app.post('/assets', async (req) => {
    const s = requireSession(req);
    const b = parse(
      z.object({
        kind: z.enum(['dataset', 'model', 'code', 'other']),
        name: z.string().min(1).max(200),
        category: z.string().max(60).optional(),
        purpose: z.enum(['listing', 'submission', 'verification', 'evidence', 'failure_example', 'benchmark', 'storage']),
      }),
      req.body,
    );
    const [a] = await db.insert(schema.assets).values({ ownerId: s.accountId, ...b }).returning();
    const [v] = await db.insert(schema.assetVersions).values({ assetId: a.id, version: 1 }).returning();
    return { asset: a, version: v };
  });

  app.get('/assets', async (req) => {
    const s = requireSession(req);
    const rows = await db.select().from(schema.assets).where(and(eq(schema.assets.ownerId, s.accountId), isNull(schema.assets.deletedAt))).orderBy(desc(schema.assets.createdAt));
    return rows;
  });

  app.post('/assets/:id/versions', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const [a] = await db.select().from(schema.assets).where(eq(schema.assets.id, id));
    if (!a || a.deletedAt) throw notFound('asset');
    if (a.ownerId !== s.accountId) throw forbidden();
    const [{ m }] = await db.select({ m: max(schema.assetVersions.version) }).from(schema.assetVersions).where(eq(schema.assetVersions.assetId, id));
    const [v] = await db.insert(schema.assetVersions).values({ assetId: id, version: (m ?? 0) + 1 }).returning();
    return v;
  });

  app.get('/versions/:id', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { version, asset } = await getOwnedVersion(ctx, id, s.accountId);
    const files = await db.select().from(schema.assetFiles).where(eq(schema.assetFiles.versionId, id));
    const ups = await db.select().from(schema.uploads).where(and(eq(schema.uploads.versionId, id), eq(schema.uploads.status, 'open')));
    return { asset, version, files: files.map(({ objectKey, ...f }) => f), openUploads: ups.map((u) => ({ id: u.id, path: u.path, partsTotal: u.partsTotal, partsReceived: Object.keys(u.partsReceived).map(Number) })) };
  });

  // ---------------------------------------------------------------- multipart uploads

  app.post('/versions/:id/uploads', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const b = parse(z.object({ path: z.string(), size: z.number().int().positive(), sha256: z.string().regex(/^[0-9a-f]{64}$/), mediaType: z.string() }), req.body);
    const { version, asset } = await getOwnedVersion(ctx, id, s.accountId);
    if (version.status !== 'draft') throw conflict('version is finalized (immutable)');
    const path = sanitizePath(b.path);
    if (!ALLOWED_MEDIA.has(b.mediaType)) throw badRequest(`media type not allowed: ${b.mediaType}`);
    if (b.size > cfg.MAX_FILE_BYTES) throw badRequest(`file exceeds max size ${cfg.MAX_FILE_BYTES}`);
    if (version.totalSize + b.size > cfg.MAX_UPLOAD_BYTES) throw badRequest('version exceeds max upload size');
    const category = storageCategory(asset.purpose);
    // workflow storage is escrow-funded: capped per submission instead of charged to the quota
    if (category === 'workflow' && version.totalSize + b.size > cfg.SUBMISSION_MAX_BYTES) throw badRequest(`submission exceeds the ${cfg.SUBMISSION_MAX_BYTES}-byte cap`);
    const [dup] = await db.select().from(schema.assetFiles).where(and(eq(schema.assetFiles.versionId, id), eq(schema.assetFiles.path, path)));
    if (dup) throw conflict('file with this path already exists in the version');
    const [pending] = await db.select().from(schema.uploads).where(and(eq(schema.uploads.versionId, id), eq(schema.uploads.path, path), eq(schema.uploads.status, 'open')));
    if (pending) throw conflict(`an upload for this path is already in progress (resume upload ${pending.id})`);

    const objectKey = (cfg.STORAGE_DRIVER === 'r2' ? 'r2/' : '') + keys.asset(asset.ownerId, category, asset.id, version.id);
    const { partSize, partsTotal } = storage.kind === 's3' ? multipartLayout(b.size, cfg.UPLOAD_PART_BYTES) : { partSize: cfg.UPLOAD_PART_BYTES, partsTotal: Math.max(1, Math.ceil(b.size / cfg.UPLOAD_PART_BYTES)) };
    const row = { versionId: id, accountId: s.accountId, path, size: b.size, sha256: b.sha256, mediaType: b.mediaType, partSize, partsTotal, objectKey, category, expiresAt: new Date(Date.now() + UPLOAD_TTL_MS) };
    // reserve first (atomic quota check), then open the multipart upload; roll the reservation back on failure
    let u = await reserveUpload(ctx, s.accountId, row, asset.purpose);
    try {
      const s3UploadId = await storage.initMultipart(objectKey);
      [u] = await db.update(schema.uploads).set({ s3UploadId }).where(eq(schema.uploads.id, u.id)).returning();
    } catch (e) {
      await db.update(schema.uploads).set({ status: 'aborted' }).where(eq(schema.uploads.id, u.id));
      throw e;
    }
    const s3UploadId = u.s3UploadId!;
    let partUrls: (string | null)[] | null = null;
    if (storage.kind === 's3' && cfg.STORAGE_DRIVER !== 'r2') partUrls = await Promise.all(Array.from({ length: partsTotal }, (_, i) => storage.presignPart(objectKey, s3UploadId, i + 1, cfg.PRESIGN_TTL_SECS)));
    return { uploadId: u.id, partSize, partsTotal, partUrls, directParts: objectKey.startsWith('r2/') };
  });

  app.get('/uploads/:id', async (req) => {
    const s = requireSession(req);
    const u = await ownedUpload(req.params, s.accountId);
    // ask the storage backend which parts really arrived; re-issue URLs for the rest (resume)
    const have = u.status === 'open' ? (await storage.listParts(u.objectKey, u.s3UploadId!)).filter((p) => p.size === expectedPartSize(u, p.partNo)).map((p) => p.partNo) : [];
    let partUrls: Record<number, string | null> | null = null;
    if (storage.kind === 's3' && !u.objectKey.startsWith('r2/') && u.status === 'open') {
      partUrls = {};
      for (let n = 1; n <= u.partsTotal; n++) if (!have.includes(n)) partUrls[n] = await storage.presignPart(u.objectKey, u.s3UploadId!, n, cfg.PRESIGN_TTL_SECS);
    }
    return { id: u.id, path: u.path, status: u.status, partSize: u.partSize, partsTotal: u.partsTotal, partsReceived: have, partUrls, directParts: u.objectKey.startsWith('r2/') };
  });

  app.post('/uploads/:id/parts/:n/url', async (req) => {
    const s = requireSession(req);
    const u = await ownedUpload(req.params, s.accountId);
    const n = Number((req.params as any).n);
    if (u.status !== 'open' || u.expiresAt < new Date()) throw conflict('upload not open or expired');
    if (!Number.isInteger(n) || n < 1 || n > u.partsTotal) throw badRequest('invalid part number');
    const { md5 } = parse(z.object({ md5: z.string().regex(/^[A-Za-z0-9+/]{22}==$/) }), req.body);
    const url = await storage.presignPart(u.objectKey, u.s3UploadId!, n, cfg.PRESIGN_TTL_SECS, md5);
    if (!url) throw conflict('direct transfer unavailable');
    return { url, headers: { 'content-md5': md5 } };
  });

  app.put('/uploads/:id/parts/:n', async (req) => {
    const s = requireSession(req);
    const u = await ownedUpload(req.params, s.accountId);
    const n = Number((req.params as any).n);
    if (u.status !== 'open') throw conflict('upload not open');
    if (u.objectKey.startsWith('r2/')) throw badRequest('use a signed direct part URL for R2');
    if (u.expiresAt < new Date()) throw conflict('upload expired');
    if (!Number.isInteger(n) || n < 1 || n > u.partsTotal) throw badRequest('invalid part number');
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body)) throw badRequest('expected application/octet-stream body');
    const expected = n < u.partsTotal ? u.partSize : u.size - u.partSize * (u.partsTotal - 1);
    if (body.length !== expected) throw badRequest(`part ${n} must be ${expected} bytes, got ${body.length}`);
    const declared = req.headers['x-part-sha256'];
    if (typeof declared === 'string' && createHash('sha256').update(body).digest('hex') !== declared) throw badRequest('part checksum mismatch');
    const etag = await storage.putPart(u.objectKey, u.s3UploadId!, n, body);
    // merge part atomically (jsonb concat) so concurrent part uploads do not clobber each other
    await db.execute(sql`update uploads set parts_received = parts_received || ${JSON.stringify({ [n]: etag })}::jsonb where id = ${u.id}`);
    return { part: n, etag };
  });

  app.post('/uploads/:id/complete', async (req) => {
    const s = requireSession(req);
    const u = await ownedUpload(req.params, s.accountId);
    if (u.status !== 'open') throw conflict('upload not open');
    if (u.expiresAt < new Date()) throw conflict('upload expired');
    // the backend's own part list is authoritative (client-reported ETags are not trusted)
    const listed = await storage.listParts(u.objectKey, u.s3UploadId!);
    const parts = listed.filter((p) => p.partNo >= 1 && p.partNo <= u.partsTotal && p.size === expectedPartSize(u, p.partNo));
    if (parts.length !== u.partsTotal || new Set(parts.map((p) => p.partNo)).size !== u.partsTotal) throw badRequest(`missing parts: have ${parts.length}/${u.partsTotal}`);
    await storage.completeMultipart(u.objectKey, u.s3UploadId!, parts);
    // server-side verification of size and checksum
    const remote = u.objectKey.startsWith('r2/');
    const object = remote ? await storage.stat(u.objectKey) : null;
    // R2 checks signed per-part MD5. Full SHA-256 is declared until a budgeted full scan verifies it.
    const { sha256, size } = remote ? { sha256: u.sha256, size: object?.size ?? -1 } : await sha256OfStream(await storage.get(u.objectKey));
    if (size !== u.size || sha256 !== u.sha256) {
      await storage.delete(u.objectKey);
      await db.update(schema.uploads).set({ status: 'aborted' }).where(eq(schema.uploads.id, u.id));
      throw badRequest('uploaded content does not match declared size/sha256');
    }
    // one transaction: the reservation turns into a committed file atomically (never counted twice, never lost)
    const f = await db.transaction(async (tx) => {
      const [closed] = await tx.update(schema.uploads).set({ status: 'complete' }).where(and(eq(schema.uploads.id, u.id), eq(schema.uploads.status, 'open'))).returning();
      if (!closed) throw conflict('upload already completed or aborted');
      const [file] = await tx.insert(schema.assetFiles).values({ versionId: u.versionId, path: u.path, size, sha256, mediaType: u.mediaType, objectKey: u.objectKey }).returning();
      await tx.execute(sql`update asset_versions set total_size = total_size + ${size}, file_count = file_count + 1 where id = ${u.versionId}`);
      if (remote) await tx.execute(sql`update asset_versions set metadata = coalesce(metadata, '{}'::jsonb) || '{"hashVerification":"uploader-declared","transferValidation":"storage-part-md5-and-size"}'::jsonb where id = ${u.versionId}`);
      return file;
    });
    return { fileId: f.id, path: f.path, sha256, size };
  });

  app.delete('/uploads/:id', async (req) => {
    const s = requireSession(req);
    const u = await ownedUpload(req.params, s.accountId);
    if (u.status === 'open') await storage.abortMultipart(u.objectKey, u.s3UploadId!);
    await db.update(schema.uploads).set({ status: 'aborted' }).where(eq(schema.uploads.id, u.id));
    return { ok: true };
  });

  app.delete('/versions/:id/files/:fileId', async (req) => {
    const s = requireSession(req);
    const { id, fileId } = parse(z.object({ id: zUuid, fileId: zUuid }), req.params);
    const { version } = await getOwnedVersion(ctx, id, s.accountId);
    if (version.status !== 'draft') throw conflict('version is finalized (immutable)');
    const [f] = await db.delete(schema.assetFiles).where(and(eq(schema.assetFiles.id, fileId), eq(schema.assetFiles.versionId, id))).returning();
    if (!f) throw notFound('file');
    await storage.delete(f.objectKey);
    await db.update(schema.assetVersions).set({ totalSize: version.totalSize - f.size, fileCount: version.fileCount - 1 }).where(eq(schema.assetVersions.id, id));
    return { ok: true };
  });

  app.post('/versions/:id/finalize', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { asset } = await getOwnedVersion(ctx, id, s.accountId);
    const v = await finalizeVersion(ctx, id);
    // automatic Level-1 validation + controlled preview generation (free tier)
    const encrypted = !!(v.metadata as any)?.encrypted;
    if (!encrypted && ['listing', 'submission', 'failure_example'].includes(asset.purpose)) await enqueuePreview(ctx, v.id, s.accountId);
    return { versionId: v.id, commitment: v.commitment, fileCount: v.fileCount, totalSize: v.totalSize, manifest: v.manifest };
  });

  /** Owner-only: manifest + salt, enough for anyone the owner chooses to re-verify the commitment. */
  app.get('/versions/:id/commitment-proof', async (req) => {
    const s = requireSession(req);
    const { id } = parse(z.object({ id: zUuid }), req.params);
    const { version } = await getOwnedVersion(ctx, id, s.accountId);
    if (version.status !== 'finalized') throw conflict('not finalized');
    return { commitment: version.commitment, salt: version.salt, manifest: version.manifest, algorithm: 'sha256("edgebounty:manifest:v1" || salt || canonical_json(manifest))' };
  });

  async function ownedUpload(params: unknown, accountId: string) {
    const { id } = parse(z.object({ id: zUuid }), params);
    const [u] = await db.select().from(schema.uploads).where(eq(schema.uploads.id, id));
    if (!u) throw notFound('upload');
    if (u.accountId !== accountId) throw forbidden();
    // defence in depth: the object key must sit under the caller's tenant prefix
    if (!keyBelongsTo(u.objectKey, accountId)) throw forbidden('object outside tenant scope');
    return u;
  }
}

function expectedPartSize(u: { size: number; partSize: number; partsTotal: number }, n: number) {
  return n < u.partsTotal ? u.partSize : u.size - u.partSize * (u.partsTotal - 1);
}

/** Purges incomplete uploads older than their TTL (run periodically). */
export async function purgeExpiredUploads(ctx: AppContext): Promise<number> {
  const stale = await ctx.db.select().from(schema.uploads).where(and(eq(schema.uploads.status, 'open'), lt(schema.uploads.expiresAt, new Date())));
  for (const u of stale) {
    if (u.s3UploadId) await ctx.storage.abortMultipart(u.objectKey, u.s3UploadId).catch(() => {});
    await ctx.db.update(schema.uploads).set({ status: 'aborted' }).where(eq(schema.uploads.id, u.id));
  }
  return stale.length;
}
