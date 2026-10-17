import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { assessMedia, folderLabels, sampleMedia, truncateWav, type MediaJudge } from './media-review.js';
import { embedImage } from './semantic.js';

function wav(samples: number, extraChunk = false) {
  const data = Buffer.alloc(samples * 2, 1);
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'ascii'); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(16000, 12); fmt.writeUInt32LE(32000, 16); fmt.writeUInt16LE(2, 20); fmt.writeUInt16LE(16, 22);
  const list = extraChunk ? Buffer.concat([Buffer.from('LIST'), Buffer.from([3, 0, 0, 0]), Buffer.from('abc\0')]) : Buffer.alloc(0);
  const head = Buffer.alloc(8); head.write('data', 0, 'ascii'); head.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([Buffer.from('WAVE'), fmt, list, head, data]);
  const riff = Buffer.alloc(8); riff.write('RIFF', 0, 'ascii'); riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

it('cuts PCM WAV to a frame-aligned prefix with consistent RIFF/data sizes, skipping odd-sized chunks', () => {
  for (const extra of [false, true]) {
    const cut = truncateWav(wav(10_000, extra), 1001)!;
    expect(cut.length).toBeLessThanOrEqual(1001);
    expect(cut.readUInt32LE(4)).toBe(cut.length - 8);
    const dataAt = cut.indexOf('data');
    const size = cut.readUInt32LE(dataAt + 4);
    expect(size % 2).toBe(0);
    expect(dataAt + 8 + size).toBe(cut.length);
  }
  expect(truncateWav(Buffer.from('not a wav file at all'), 100)).toBeNull();
});

it('samples media deterministically and only uses folder labels for class layouts', () => {
  const paths = ['a/1.wav', 'a/2.wav', 'b/3.mp4', 'notes.txt', 'b/4.MP3'];
  expect(sampleMedia(paths, 7, 10)).toHaveLength(4);
  expect(sampleMedia(paths, 7, 3)).toEqual(sampleMedia([...paths].reverse(), 7, 3));
  expect(folderLabels(['a/1.wav', 'b/2.wav'])('a/1.wav')).toBe('a');
  expect(folderLabels(['clips/1.wav', 'clips/2.wav'])('clips/1.wav')).toBeNull();
});

it('reviews within the call budget, counts skips and undetermined answers, and reports an interval', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'media-'));
  await mkdir(join(dir, 'dog'), { recursive: true });
  await mkdir(join(dir, 'cat'), { recursive: true });
  await writeFile(join(dir, 'dog', 'a.wav'), wav(100));
  await writeFile(join(dir, 'cat', 'b.wav'), wav(100));
  await writeFile(join(dir, 'cat', 'big.mp4'), Buffer.alloc(2048));
  await writeFile(join(dir, 'dog', 'long.wav'), wav(5_000));
  const cfg = loadConfig({ NODE_ENV: 'test', NVIDIA_API_KEY: 'fixture', L3_MEDIA_MAX_BYTES: '1024' });
  const seen: string[] = [];
  const judge: MediaJudge = {
    model: 'mock-omni',
    concurrency: 2,
    async judge(kind, dataUrl, prompt) {
      seen.push(kind);
      expect(dataUrl.startsWith('data:audio/wav;base64,')).toBe(true);
      expect(Buffer.from(dataUrl.split(',')[1], 'base64').length).toBeLessThanOrEqual(1024);
      if (prompt.includes('Assigned label: cat')) return { out: { relevant: false, label_matches: false }, inputTokens: 5, outputTokens: 2 };
      if (seen.length === 1) return { out: null, inputTokens: 0, outputTokens: 0 };
      return { out: { relevant: true, label_matches: true }, inputTokens: 5, outputTokens: 2 };
    },
  };
  const files = ['dog/a.wav', 'cat/b.wav', 'cat/big.mp4', 'dog/long.wav'];
  const r = await assessMedia(cfg, dir, files, 'animal sounds', 1, 10, judge);
  expect(r.skipped).toEqual([{ path: 'cat/big.mp4', reason: expect.stringContaining('cap') }]);
  expect(r.truncated).toBe(1);
  expect(r.apiCalls).toBe(3);
  expect(r.sampleSize + r.undetermined).toBe(3);
  expect(r.labelMismatches).toEqual(['cat/b.wav']);
  expect(r.lowBps).toBeLessThanOrEqual(r.estimateBps);
  const limited = await assessMedia(cfg, dir, files, 'animal sounds', 1, 1, judge);
  expect(limited.apiCalls + limited.skipped.length).toBe(1);
});

it('sends image embeddings as a data-URL string', async () => {
  const cfg = loadConfig({ NODE_ENV: 'test', NVIDIA_API_KEY: 'fixture' });
  const mock = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    expect(body.model).toBe(cfg.NVIDIA_IMAGE_EMBEDDING_MODEL);
    expect(body.input[0]).toBe('data:image/jpeg;base64,AAAA');
    return new Response(JSON.stringify({ data: [{ embedding: Array(2048).fill(1) }], usage: { prompt_tokens: 3 } }), { status: 200 });
  }) as typeof fetch;
  expect((await embedImage(cfg, 'AAAA', mock)).inputTokens).toBe(3);
});
