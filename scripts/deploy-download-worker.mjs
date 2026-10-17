import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
process.loadEnvFile(join(import.meta.dirname, '../apps/api/.env'));
const deploymentEnv = join(import.meta.dirname, '../.data/cloudflare-admin.env');
if (existsSync(deploymentEnv)) process.loadEnvFile(deploymentEnv);
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = new URL(process.env.S3_ENDPOINT).hostname.split('.')[0];
if (!token || !/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('Cloudflare API credential/account missing');
const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
const name = 'edgebounty-downloads';
const headers = { authorization: `Bearer ${token}` };
let domainResponse = await fetch(`${base}/workers/subdomain`, { headers, signal: AbortSignal.timeout(30_000) });
let domain = await domainResponse.json();
if (domainResponse.status === 404 && domain.errors?.some((e) => e.code === 10007) && !process.argv.includes('--check')) {
  domainResponse = await fetch(`${base}/workers/subdomain`, { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ subdomain: `edgebounty-${accountId.slice(0, 8)}` }), signal: AbortSignal.timeout(30_000) });
  domain = await domainResponse.json();
}
if (!domainResponse.ok || !domain.success) {
  console.log(JSON.stringify({ deployed: false, step: 'Workers account access', status: domainResponse.status, errors: domain.errors?.map(({ code, message }) => ({ code, message })) }));
  process.exit(1);
}
if (process.argv.includes('--check')) {
  console.log(JSON.stringify({ workersAccess: true, subdomainConfigured: !!domain.result?.subdomain }));
  process.exit(0);
}
if (!domain.result?.subdomain) throw new Error('Set the account Workers subdomain before deployment');
const form = new FormData();
form.set('metadata', new Blob([JSON.stringify({ main_module: 'download-worker.mjs', compatibility_date: '2026-10-17', bindings: [
  { type: 'r2_bucket', name: 'DATASETS', bucket_name: process.env.S3_BUCKET },
  { type: 'plain_text', name: 'API_ORIGIN', text: process.env.WORKER_API_ORIGIN ?? 'https://api.preview.13-61-207-211.sslip.io' },
  { type: 'secret_text', name: 'GATEWAY_SHARED_SECRET', text: process.env.GATEWAY_SHARED_SECRET },
] })], { type: 'application/json' }));
form.set('download-worker.mjs', new Blob([readFileSync(join(import.meta.dirname, '../infrastructure/cloudflare/download-worker.mjs'))], { type: 'application/javascript+module' }), 'download-worker.mjs');
const upload = await fetch(`${base}/workers/scripts/${name}`, { method: 'PUT', headers, body: form, signal: AbortSignal.timeout(60_000) });
const result = await upload.json();
if (!upload.ok || !result.success) {
  console.log(JSON.stringify({ deployed: false, step: 'upload', status: upload.status, errors: result.errors?.map(({ code, message }) => ({ code, message })) }));
  process.exit(1);
}
const enable = await fetch(`${base}/workers/scripts/${name}/subdomain`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, previews_enabled: false }), signal: AbortSignal.timeout(30_000) });
if (!enable.ok) throw new Error(`Worker subdomain activation failed (${enable.status})`);
const url = `https://${name}.${domain.result.subdomain}.workers.dev`;
const envPath = join(import.meta.dirname, '../apps/api/.env');
const lines = readFileSync(envPath, 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith('DOWNLOAD_GATEWAY_URL='));
writeFileSync(envPath, [...lines, `DOWNLOAD_GATEWAY_URL=${url}`, ''].join('\n'), { mode: 0o600 });
console.log(JSON.stringify({ deployed: true, url, configured: true }));
