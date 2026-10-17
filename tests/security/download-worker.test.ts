import { afterEach, expect, it, vi } from 'vitest';
const modulePath = '../../infrastructure/cloudflare/download-worker.mjs';
const { default: worker } = await import(modulePath);
afterEach(() => vi.restoreAllMocks());

const env = { API_ORIGIN: 'https://api.example.com', GATEWAY_SHARED_SECRET: 'private-test-secret', DATASETS: { get: vi.fn() } };
const grant = { key: 'tenants/buyer/file', start: 10, end: 19, length: '10', size: 100, partial: true, name: 'file.bin', sha256: 'a'.repeat(64) };

it('streams an authorized R2 range with correct HTTP headers and keeps bytes off the API', async () => {
  const api = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(grant), { status: 200 }));
  env.DATASETS.get.mockResolvedValue({ size: 100, body: new Uint8Array(10).fill(7) });
  const r = await worker.fetch(new Request('https://downloads.example.com/download/test.mac', { headers: { range: 'bytes=10-19' } }), env);
  expect(r.status).toBe(206);
  expect(r.headers.get('content-range')).toBe('bytes 10-19/100');
  expect(r.headers.get('x-download-accounting')).toBe('authorized-bytes');
  expect(new Uint8Array(await r.arrayBuffer())).toHaveLength(10);
  expect(env.DATASETS.get).toHaveBeenCalledWith(grant.key, { range: { offset: 10, length: 10 } });
  const headers = api.mock.calls[0][1]!.headers as Headers;
  expect(headers.get('range')).toBe('bytes=10-19');
  expect(api).toHaveBeenCalledTimes(1);
});

it('refunds once when object lookup fails before streaming', async () => {
  const api = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(grant))).mockResolvedValueOnce(new Response('{}'));
  env.DATASETS.get.mockRejectedValue(new Error('storage offline'));
  const r = await worker.fetch(new Request('https://downloads.example.com/download/test.mac'), env);
  expect(r.status).toBe(503);
  expect(api).toHaveBeenCalledTimes(2);
  expect(String(api.mock.calls[1][0])).toMatch(/\/gateway\/transfers\/.+\/failed$/);
});

it('propagates quota rejection without reading storage', async () => {
  env.DATASETS.get.mockClear();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"download_quota_exhausted"}', { status: 402 }));
  const r = await worker.fetch(new Request('https://downloads.example.com/download/test.mac'), env);
  expect(r.status).toBe(402);
  expect(env.DATASETS.get).not.toHaveBeenCalled();
});
