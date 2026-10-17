import { expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { accountIdFromEndpoint, compareWithObserved, fetchCloudflareUsage, opClass } from './cloudflare-usage.js';

const account = 'a'.repeat(32);
it('classifies R2 operations and derives the account from the R2 endpoint', () => {
  expect([opClass('UploadPart'), opClass('GetObject'), opClass('DeleteObject'), opClass('Mystery')]).toEqual(['A', 'B', 'free', 'unknown']);
  expect(accountIdFromEndpoint(`https://${account}.r2.cloudflarestorage.com`)).toBe(account);
  expect(accountIdFromEndpoint('https://s3.eu-north-1.amazonaws.com')).toBeNull();
});

it('prices only usage above the monthly free allowances and never sends the token elsewhere', async () => {
  const cfg = loadConfig({ NODE_ENV: 'test', CLOUDFLARE_ANALYTICS_TOKEN: 'read-only', S3_ENDPOINT: `https://${account}.r2.cloudflarestorage.com`, S3_BUCKET: 'b', CLOUDFLARE_WORKERS_PLAN: 'paid' });
  const fake = (async (url: any, init: any) => {
    expect(String(url)).toBe('https://api.cloudflare.com/client/v4/graphql');
    expect(init.headers.authorization).toBe('Bearer read-only');
    expect(JSON.parse(init.body).variables).toMatchObject({ a: account, b: 'b', w: 'edgebounty-downloads' });
    return new Response(JSON.stringify({ data: { viewer: { accounts: [{
      ops: [
        { dimensions: { actionType: 'UploadPart', actionStatus: 'success' }, sum: { requests: 3_000_000 } },
        { dimensions: { actionType: 'GetObject', actionStatus: 'success' }, sum: { requests: 12_000_000 } },
        { dimensions: { actionType: 'DeleteObject', actionStatus: 'success' }, sum: { requests: 99 } },
      ],
      storage: [{ max: { objectCount: 5, payloadSize: 40 * 1024 ** 3, metadataSize: 0 } }],
      workers: [{ sum: { requests: 11_000_000, errors: 2 }, quantiles: { cpuTimeP50: 900 } }],
    }] } } }), { status: 200 });
  }) as typeof fetch;
  const u = await fetchCloudflareUsage(cfg, new Date(Date.UTC(2026, 9, 31, 23, 59)), fake);
  expect(u.r2).toMatchObject({ classA: 3_000_000, classB: 12_000_000, free: 99 });
  expect(u.estimate.classAMicro).toBe('9000000'); // (3M - 1M free) x $4.50/M
  expect(u.estimate.classBMicro).toBe('720000'); // (12M - 10M free) x $0.36/M
  expect(Number(u.estimate.storageMicro)).toBeGreaterThan(440_000); // ~(40 - 10) GB-month x $0.015
  expect(u.estimate.workerMicro).toBe('5300000'); // $5 base + 1M x $0.30/M
  const rows = compareWithObserved(u, [{ key: 'r2:GetObjectCommand:ok', count: 4n }, { key: 's3:GetObjectCommand:ok', count: 1n }], 'r2');
  expect(rows.find((r) => r.action === 'GetObject')).toMatchObject({ cloudflareMonthToDate: 12_000_000, apiObservedAllTime: 4 });
});
