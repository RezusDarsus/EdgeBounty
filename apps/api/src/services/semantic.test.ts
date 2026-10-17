import { expect, it } from 'vitest';
import { vectorLiteral, embedText } from './semantic.js';
import { loadConfig } from '../config.js';
it('normalizes embeddings and rejects dimension, NaN and zero vectors', () => {
  const v = Array(2048).fill(0); v[0] = 2;
  expect(JSON.parse(vectorLiteral(v))[0]).toBe(1);
  expect(() => vectorLiteral([1, 2])).toThrow();
  expect(() => vectorLiteral(Array(2048).fill(0))).toThrow();
  expect(() => vectorLiteral(Array(2048).fill(NaN))).toThrow();
});
it('bounds provider input and uses passage embeddings without leaking provider errors', async () => {
  const cfg = loadConfig({ NODE_ENV: 'test', NVIDIA_API_KEY: 'fixture' });
  const mock = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    expect(body.input_type).toBe('passage');
    expect(body.input[0]).toHaveLength(8192);
    return new Response(JSON.stringify({ data: [{ embedding: Array(2048).fill(1) }], usage: { prompt_tokens: 10 } }), { status: 200 });
  }) as typeof fetch;
  expect((await embedText(cfg, 'a'.repeat(10_000), mock)).inputTokens).toBe(10);
});
