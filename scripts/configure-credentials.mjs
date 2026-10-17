import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// Import credentials as data. Never execute snippets or print credential values.
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const root = resolve(import.meta.dirname, '..');
const envPath = resolve(root, 'apps/api/.env');
const previous = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const values = {};
if (option('--r2')) {
  const data = readFileSync(option('--r2'), 'utf8');
  const lines = data.split(/\r?\n/).map((x) => x.trim());
  values.S3_ACCESS_KEY_ID = lines.find((x) => /^[a-f0-9]{32}$/i.test(x));
  values.S3_SECRET_ACCESS_KEY = lines.find((x) => /^[a-f0-9]{64}$/i.test(x));
  values.S3_ENDPOINT = data.match(/https:\/\/[a-z0-9.-]+\.r2\.cloudflarestorage\.com/i)?.[0];
  const bucketIndex = lines.findIndex((x) => /^Buckets:$/i.test(x));
  values.S3_BUCKET = lines.slice(bucketIndex + 1).find((x) => /^[a-z0-9][a-z0-9.-]{2,62}$/.test(x));
  if (!values.S3_ACCESS_KEY_ID || !values.S3_SECRET_ACCESS_KEY || !values.S3_ENDPOINT || !values.S3_BUCKET) throw new Error('R2 credential document is incomplete');
  Object.assign(values, { STORAGE_DRIVER: 'r2', S3_REGION: 'auto', S3_DIRECT_TRANSFERS: '1', S3_RATE_MICRO_PER_GB_MONTH: '15000', MAX_FILE_BYTES: String(500 * 1024 ** 3), MAX_UPLOAD_BYTES: String(500 * 1024 ** 3) });
}
if (option('--nvidia')) {
  const data = readFileSync(option('--nvidia'), 'utf8');
  const key = data.match(/api_key\s*=\s*["']([^"']+)["']/)?.[1];
  if (!key || !key.startsWith('nvapi-')) throw new Error('NVIDIA credential document is incomplete');
  Object.assign(values, { AI_PROVIDER: 'nvidia', NVIDIA_API_KEY: key });
  const model = data.match(/\bmodel\s*=\s*["']([^"']+)["']/)?.[1];
  if (model && /^[a-z0-9/_.-]+$/i.test(model)) values.L3_TEXT_MODEL = model;
}
for (const name of ['JWT_SECRET', 'DOWNLOAD_TOKEN_SECRET', 'GATEWAY_SHARED_SECRET']) {
  if (!new RegExp(`^${name}=.+`, 'm').test(previous)) values[name] = randomBytes(32).toString('hex');
}
const backupDir = resolve(root, '.data/config-backups');
mkdirSync(backupDir, { recursive: true });
if (previous) writeFileSync(resolve(backupDir, `api-${Date.now()}.env`), previous, { mode: 0o600 });
const kept = previous.split(/\r?\n/).filter((line) => line && !Object.hasOwn(values, line.split('=')[0]));
mkdirSync(dirname(envPath), { recursive: true });
writeFileSync(envPath, [...kept, ...Object.entries(values).map(([key, value]) => `${key}=${value}`), ''].join('\n'), { mode: 0o600 });
console.log(`Configured ${Object.keys(values).join(', ')}. Values withheld; previous configuration backed up in ignored storage.`);
