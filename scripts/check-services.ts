import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { S3Client, GetBucketCorsCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
const adminEnv = join(import.meta.dirname, '../.data/cloudflare-admin.env');
if (process.argv.includes('--configure-cors') && existsSync(adminEnv)) process.loadEnvFile(adminEnv);
process.loadEnvFile(join(import.meta.dirname, '../apps/api/.env'));
const { loadConfig } = await import('../apps/api/src/config.js');
const { createStorage } = await import('../apps/api/src/storage/index.js');
const cfg = loadConfig();
const storage = createStorage(cfg);
const prefix = `r2/healthchecks/${randomUUID()}`;
const body = Buffer.from('EdgeBounty private integration fixture');
const result: Record<string, unknown> = {};
let uploadId: string | undefined;
try {
  await storage.put(prefix, body);
  result.write = true;
  result.head = (await storage.stat(prefix))?.size === body.length;
  result.read = (await storage.read(prefix)).equals(body);
  const signed = await storage.presignGet(prefix, 60);
  result.signedDownload = !!signed && (await (await fetch(signed)).text()) === body.toString();
  uploadId = await storage.initMultipart(prefix + '-multipart');
  const md5 = createHash('md5').update(body).digest('base64');
  const put = await storage.presignPart(prefix + '-multipart', uploadId, 1, 60, md5);
  const origin = 'https://preview.13-61-207-211.sslip.io';
  const preflight = await fetch(put!, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-md5' } });
  result.browserCors = { status: preflight.status, allowed: preflight.headers.get('access-control-allow-origin') === origin };
  const response = await fetch(put!, { method: 'PUT', headers: { 'content-md5': md5 }, body });
  result.directMultipartPartStatus = response.status;
  if (!response.ok) throw new Error('direct multipart part failed');
  const parts = await storage.listParts(prefix + '-multipart', uploadId);
  await storage.completeMultipart(prefix + '-multipart', uploadId, parts);
  uploadId = undefined;
  result.multipartComplete = (await storage.stat(prefix + '-multipart'))?.size === body.length;
  const anonymous = new URL(signed!); anonymous.search = '';
  const denied = await fetch(anonymous);
  result.anonymousStatus = denied.status;
  result.private = denied.status >= 400;
} catch (e: any) { result.error = { name: e.name, status: e.$metadata?.httpStatusCode }; }
finally {
  if (uploadId) await storage.abortMultipart(prefix + '-multipart', uploadId).catch(() => {});
  await storage.delete(prefix).catch(() => {});
  await storage.delete(prefix + '-multipart').catch(() => {});
}
const s3 = new S3Client({ region: 'auto', endpoint: cfg.S3_ENDPOINT, credentials: { accessKeyId: cfg.S3_ACCESS_KEY_ID!, secretAccessKey: cfg.S3_SECRET_ACCESS_KEY! } });
try {
  const cors = await s3.send(new GetBucketCorsCommand({ Bucket: cfg.S3_BUCKET })).catch((e) => { if (e.name === 'NoSuchCORSConfiguration') return { CORSRules: [] }; throw e; });
  const origins = [...new Set([...cfg.CORS_ORIGINS.split(',').map((x) => x.trim()), ...JSON.parse(readFileSync(join(import.meta.dirname, '../infrastructure/cloudflare/r2-cors.json'), 'utf8'))[0].AllowedOrigins])];
  if (process.argv.includes('--configure-cors')) {
    const rules = (cors.CORSRules ?? []).filter((r) => r.ID !== 'edgebounty-browser');
    await s3.send(new PutBucketCorsCommand({ Bucket: cfg.S3_BUCKET, CORSConfiguration: { CORSRules: [...rules, { ID: 'edgebounty-browser', AllowedOrigins: origins, AllowedMethods: ['GET', 'HEAD', 'PUT'], AllowedHeaders: ['content-type', 'content-md5'], ExposeHeaders: ['ETag', 'Content-Length', 'Content-Range'], MaxAgeSeconds: 3600 }] } }));
    result.corsConfigured = true;
  } else result.corsRules = cors.CORSRules?.length ?? 0;
} catch (e: any) { result.corsSettings = { readable: false, name: e.name, status: e.$metadata?.httpStatusCode, note: 'Runtime object credentials need not read bucket settings; browserCors is the transfer check.' }; }
try {
  const models = await fetch(`${cfg.NVIDIA_BASE_URL}/models`, { headers: { authorization: `Bearer ${cfg.NVIDIA_API_KEY}` }, signal: AbortSignal.timeout(30_000) });
  const doc = models.ok ? await models.json() as any : {};
  result.nvidia = { status: models.status, visionModelListed: doc.data?.some((m: any) => m.id === cfg.L3_VISION_MODEL), textModelListed: doc.data?.some((m: any) => m.id === cfg.L3_TEXT_MODEL) };
} catch (e: any) { result.nvidia = { error: e.name }; }
console.log(JSON.stringify(result, null, 2));
if (!result.multipartComplete || !result.private) process.exitCode = 1;
