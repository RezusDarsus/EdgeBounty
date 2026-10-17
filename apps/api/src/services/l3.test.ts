import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import { assessRelevance } from './l3.js';

describe('L3 relevance aggregation', () => {
  it('estimates relevance with an interval, excludes refusals and tracks tokens', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eb-l3-'));
    const samples = Array.from({ length: 10 }, (_, i) => {
      const path = join(dir, `${i}.jpg`);
      writeFileSync(path, Buffer.from([0xff, 0xd8, i]));
      return { path, source: `img/${i}.jpg`, label: i % 2 ? 'car' : 'bike' };
    });
    const calls: any[] = [];
    const fake = {
      messages: {
        parse: async (req: any) => {
          calls.push(req);
          const i = Number(String(req.messages[0].content[0].source.data === Buffer.from([0xff, 0xd8, 9]).toString('base64') ? 9 : calls.length));
          if (i === 9) return { stop_reason: 'refusal', parsed_output: null, usage: { input_tokens: 10, output_tokens: 0 } };
          const relevant = !req.messages[0].content[0].source.data.endsWith(Buffer.from([0xff, 0xd8, 3]).toString('base64').slice(-2));
          return { stop_reason: 'end_turn', parsed_output: { relevant, label_matches: true, confidence: 'high', reason: 'x' }, usage: { input_tokens: 100, output_tokens: 20 } };
        },
      },
    } as any;
    const cfg = loadConfig({ NODE_ENV: 'test' });
    const r = await assessRelevance(cfg, samples, 'vehicles', 10, fake);
    expect(r.apiCalls).toBe(10);
    expect(r.sampleSize + r.undetermined).toBe(10);
    expect(r.undetermined).toBeGreaterThanOrEqual(1);
    expect(r.lowBps).toBeLessThanOrEqual(r.estimateBps);
    expect(r.highBps).toBeGreaterThanOrEqual(r.estimateBps);
    expect(r.inputTokens).toBeGreaterThan(0);
    expect(calls[0].model).toBe(cfg.L3_MODEL);
    expect(calls[0].messages[0].content[0].type).toBe('image');
    expect(calls[0].output_config.format).toBeTruthy();
  });
  it('respects the per-job call budget', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eb-l3b-'));
    const samples = Array.from({ length: 50 }, (_, i) => {
      const path = join(dir, `${i}.jpg`);
      writeFileSync(path, Buffer.from([i]));
      return { path, source: String(i), label: null };
    });
    let n = 0;
    const fake = { messages: { parse: async () => (n++, { stop_reason: 'end_turn', parsed_output: { relevant: true, label_matches: null, confidence: 'high', reason: '' }, usage: { input_tokens: 1, output_tokens: 1 } }) } } as any;
    const r = await assessRelevance(loadConfig({ NODE_ENV: 'test' }), samples, 't', 7, fake);
    expect(n).toBe(7);
    expect(r.estimateBps).toBe(10_000);
  });
});
