import { afterEach, expect, it, vi } from 'vitest';
import { requestWithRateLimit } from '../../apps/web/src/lib/request';
import { uploadFile } from '../../apps/web/src/lib/upload';
import { api } from '../../apps/web/src/lib/api';

vi.mock('../../apps/web/src/lib/api', () => ({ API_URL: 'http://test-api', api: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

it('waits for Retry-After instead of exhausting retries before a rate limit resets', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '60' } })).mockResolvedValueOnce(new Response('', { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  const pending = requestWithRateLimit('http://test-api/part', { method: 'PUT', body: 'part' });
  await vi.advanceTimersByTimeAsync(59_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect((await pending).status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('does not automatically repeat a potentially processed server error', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
  vi.stubGlobal('fetch', fetcher);
  expect((await requestWithRateLimit('http://test-api/payment', { method: 'POST' })).status).toBe(500);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('resumes the original multipart upload and sends only the missing part', async () => {
  vi.mocked(api).mockResolvedValueOnce({ status: 'open', partSize: 2, partsTotal: 2, partsReceived: [1], partUrls: null }).mockResolvedValueOnce({ fileId: 'complete' });
  const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  await uploadFile('version', new File([new Uint8Array([1, 2, 3, 4])], 'image.bin'), 'image.bin', null, vi.fn(), { uploadId: 'original' });
  expect(api).toHaveBeenNthCalledWith(1, '/uploads/original');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('http://test-api/uploads/original/parts/2');
  expect(Array.from(fetcher.mock.calls[0][1].body)).toEqual([3, 4]);
  expect(api).toHaveBeenLastCalledWith('/uploads/original/complete', { body: {} });
});

it('recognizes a completed upload after a lost completion response', async () => {
  vi.mocked(api).mockResolvedValueOnce({ status: 'complete', partsReceived: [], partUrls: null });
  const fetcher = vi.fn();
  const progress = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await uploadFile('version', new File(['photo'], 'photo.jpg'), 'photo.jpg', null, progress, { uploadId: 'completed' });
  expect(api).toHaveBeenCalledTimes(1);
  expect(fetcher).not.toHaveBeenCalled();
  expect(progress).toHaveBeenLastCalledWith({ file: 'photo.jpg', phase: 'done', progress: 1 });
});
