import { and, eq, gt, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { buildManifest, bytesToHex, hexToBytes, manifestCommitment, newSalt } from '@edgebounty/verification-schemas';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from './http.js';
import { WORKFLOW_PURPOSES } from '../storage/index.js';

export const ALLOWED_MEDIA = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif', 'image/tiff',
  'text/csv', 'application/json', 'application/x-ndjson', 'application/jsonl', 'text/plain', 'text/markdown', 'application/xml', 'text/xml', 'application/yaml', 'text/yaml',
  'application/vnd.apache.parquet', 'application/x-parquet', 'application/octet-stream',
  'application/onnx', 'application/x-onnx', 'application/x-safetensors',
  'application/zip', 'audio/wav', 'audio/mpeg', 'audio/flac', 'video/mp4',
]);

export function sanitizePath(p: string): string {
  const n = p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
  if (!n || n.length > 512 || n.startsWith('/') || n.split('/').some((s) => s === '..' || s === '.' || s === '') || /[\x00-\x1f]/.test(n)) {
    throw badRequest(`invalid file path: ${p}`);
  }
  return n;
}

export async function getVersionWithAsset(ctx: AppContext, versionId: string) {
  const [v] = await ctx.db.select().from(schema.assetVersions).where(eq(schema.assetVersions.id, versionId));
  if (!v) throw notFound('asset version');
  const [a] = await ctx.db.select().from(schema.assets).where(eq(schema.assets.id, v.assetId));
  if (!a || a.deletedAt) throw notFound('asset');
  return { version: v, asset: a };
}

export async function getOwnedVersion(ctx: AppContext, versionId: string, accountId: string) {
  const r = await getVersionWithAsset(ctx, versionId);
  if (r.asset.ownerId !== accountId) throw forbidden('not the asset owner');
  return r;
}

type Q = Pick<AppContext['db'], 'select'>;

/** Purposes the MVP free tier may hold; everything else customer-side needs a prepaid plan. */
export const FREE_TIER_PURPOSES = ['listing', 'benchmark', 'storage'];

/**
 * Bytes charged to the account's quota: stored customer-category files plus open upload reservations
 * (an open upload holds its declared size until it completes, is aborted or expires).
 * Workflow files (bounty submissions, evidence, …) are paid by escrow and never counted here.
 */
export async function storageUsedBytes(ctx: AppContext, accountId: string, q: Q = ctx.db, opts: { excludeListing?: boolean } = {}): Promise<number> {
  const excluded = opts.excludeListing ? [...WORKFLOW_PURPOSES, ...FREE_TIER_PURPOSES] : [...WORKFLOW_PURPOSES];
  const [stored] = await q
    .select({ n: sql<string>`coalesce(sum(${schema.assetFiles.size}), 0)` })
    .from(schema.assetFiles)
    .innerJoin(schema.assetVersions, eq(schema.assetVersions.id, schema.assetFiles.versionId))
    .innerJoin(schema.assets, eq(schema.assets.id, schema.assetVersions.assetId))
    .where(and(eq(schema.assets.ownerId, accountId), isNull(schema.assets.deletedAt), notInArray(schema.assets.purpose, excluded as any),
      sql`not (${schema.assets.purpose} = 'listing' and exists (select 1 from hosting_coverage hc where hc.asset_version_id = ${schema.assetFiles.versionId} and hc.source = 'seller_prepaid' and hc.starts_at <= now() and hc.ends_at > now()))`));
  return Number(stored.n) + (await reservedBytes(accountId, q, excluded));
}

async function reservedBytes(accountId: string, q: Q, excludedPurposes: string[]): Promise<number> {
  const [r] = await q
    .select({ n: sql<string>`coalesce(sum(${schema.uploads.size}), 0)` })
    .from(schema.uploads)
    .innerJoin(schema.assetVersions, eq(schema.assetVersions.id, schema.uploads.versionId))
    .innerJoin(schema.assets, eq(schema.assets.id, schema.assetVersions.assetId))
    .where(and(eq(schema.uploads.accountId, accountId), eq(schema.uploads.status, 'open'), eq(schema.uploads.category, 'customer'), gt(schema.uploads.expiresAt, new Date()), notInArray(schema.assets.purpose, excludedPurposes as any)));
  return Number(r.n);
}

/**
 * Atomically checks the quota and records the upload (= the reservation). A per-account transaction-scoped
 * advisory lock serialises concurrent reservations, so parallel uploads cannot jointly overshoot the quota.
 */
export async function reserveUpload(
  ctx: AppContext,
  accountId: string,
  row: typeof schema.uploads.$inferInsert,
  purpose: string,
): Promise<typeof schema.uploads.$inferSelect> {
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'storage:' + accountId}, 0))`);
    const [version] = await tx.select().from(schema.assetVersions).where(eq(schema.assetVersions.id, row.versionId));
    if (!version || version.status !== 'draft') throw conflict('version is finalized');
    const open = await tx.select().from(schema.uploads).where(and(eq(schema.uploads.versionId, row.versionId), eq(schema.uploads.status, 'open')));
    if (open.some((u) => u.path === row.path)) throw conflict('an upload for this path is already in progress');
    const reserved = open.reduce((n, u) => n + u.size, 0);
    if (version.totalSize + reserved + row.size > ctx.cfg.MAX_UPLOAD_BYTES) throw badRequest('version exceeds max upload size including reservations');
    if (row.category === 'workflow' && version.totalSize + reserved + row.size > ctx.cfg.SUBMISSION_MAX_BYTES) throw badRequest('submission exceeds its cap including reservations');
    if (row.category === 'customer') {
      // committed (completed) files and open reservations both count
      const [used, quota] = await Promise.all([storageUsedBytes(ctx, accountId, tx), storageQuotaBytes(ctx, accountId, tx)]);
      if (used + row.size > quota) throw new HttpError(402, 'quota_exceeded', `storage quota exceeded (${used}/${quota} bytes); purchase a storage plan`);
      // the free tier covers marketplace listings (and the benchmarks model verification needs) only:
      // EdgeBounty is not a general-purpose drive
      if (!FREE_TIER_PURPOSES.includes(purpose)) {
        const [paidUsed, paid] = await Promise.all([storageUsedBytes(ctx, accountId, tx, { excludeListing: true }), storageQuotaBytes(ctx, accountId, tx, { paidOnly: true })]);
        if (paidUsed + row.size > paid) throw new HttpError(402, 'quota_exceeded', `the free tier covers marketplace listings only; ${purpose} storage needs a prepaid plan (${paidUsed}/${paid} paid bytes used)`);
      }
    }
    const [u] = await tx.insert(schema.uploads).values(row).returning();
    return u;
  });
}

export async function storageQuotaBytes(ctx: AppContext, accountId: string, q: Q = ctx.db, opts: { paidOnly?: boolean } = {}): Promise<number> {
  const allocs = await q
    .select()
    .from(schema.storageAllocations)
    .where(and(eq(schema.storageAllocations.accountId, accountId), inArray(schema.storageAllocations.status, ['active', 'grace'])));
  return (opts.paidOnly ? 0 : ctx.cfg.FREE_STORAGE_BYTES) + allocs.filter((a) => a.status === 'active').reduce((n, a) => n + a.gb * 1024 ** 3, 0);
}

/** Freezes a version: canonical manifest, private salt, public commitment. Immutable afterwards. */
export async function finalizeVersion(ctx: AppContext, versionId: string) {
  const { version, asset } = await getVersionWithAsset(ctx, versionId);
  if (version.status === 'finalized') return version;
  const files = await ctx.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.versionId, versionId));
  if (files.length === 0) throw badRequest('version has no files');
  const open = await ctx.db.select().from(schema.uploads).where(and(eq(schema.uploads.versionId, versionId), eq(schema.uploads.status, 'open')));
  if (open.length) throw conflict('version has unfinished uploads');
  const manifest = buildManifest(
    asset.id,
    version.id,
    files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256, mediaType: f.mediaType })),
  );
  const salt = newSalt();
  const commitment = bytesToHex(manifestCommitment(manifest, salt));
  const [v] = await ctx.db
    .update(schema.assetVersions)
    .set({ status: 'finalized', manifest, salt: bytesToHex(salt), commitment, totalSize: manifest.totalSize, fileCount: manifest.fileCount, finalizedAt: new Date() })
    .where(and(eq(schema.assetVersions.id, versionId), eq(schema.assetVersions.status, 'draft')))
    .returning();
  if (!v) throw conflict('version was finalized concurrently');
  return v;
}

/** Recomputes the commitment from stored manifest+salt (used by verifiers and audits). */
export function recomputeCommitment(manifest: unknown, saltHex: string): string {
  return bytesToHex(manifestCommitment(manifest, hexToBytes(saltHex)));
}
