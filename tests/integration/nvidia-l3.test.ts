/** Live check of the NVIDIA-backed Level 3 review. Skips unless NVIDIA_API_KEY is configured. */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../apps/api/src/config.js';
import { assessRelevance, explainReport, parseJudgement } from '../../apps/api/src/services/l3.js';
import { png } from '../end-to-end/api-harness.js';

const envFile = join(import.meta.dirname, '..', '..', 'apps', 'api', '.env');
// A credential is not permission to spend credits during the default test suite.
const approved = process.env.RUN_LIVE_AI_TESTS === '1';
if (approved && !process.env.NVIDIA_API_KEY && existsSync(envFile)) process.loadEnvFile(envFile);
const live = approved && !!process.env.NVIDIA_API_KEY;

describe('parseJudgement', () => {
  it('extracts JSON from chatty model output and rejects garbage', () => {
    expect(parseJudgement('Sure! {"relevant": false, "reason": "a dog"} hope that helps')?.relevant).toBe(false);
    expect(parseJudgement('no json here')).toBeNull();
    expect(parseJudgement('{"relevant": "maybe"}')).toBeNull();
  });
});

describe.skipIf(!live)('NVIDIA L3 (live API)', () => {
  it('judges sampled images with the vision model and explains a report with the text model', async () => {
    const cfg = loadConfig({ NODE_ENV: 'test', AI_PROVIDER: 'nvidia' });
    const dir = mkdtempSync(join(tmpdir(), 'eb-nv-'));
    // structured pattern images: not "photos of cats" → mostly irrelevant for that task
    const samples = [1, 2, 3].map((i) => {
      const p = join(dir, `s${i}.png`);
      writeFileSync(p, png(96, 96, i * 40));
      return { path: p, source: `s${i}.png`, label: null };
    });
    const r = await assessRelevance(cfg, samples, 'real photographs of cats', 3);
    expect(r.apiCalls).toBe(3);
    expect(r.sampleSize + r.undetermined).toBe(3);
    expect(r.method).toContain(cfg.L3_VISION_MODEL);
    if (r.sampleSize > 0) expect(r.estimateBps).toBeLessThanOrEqual(5000);

    const summary = await explainReport(cfg, {
      passed: false,
      criteria: [{ criterion: 'max_exact_duplicates', required: 0, actual: 3, status: 'fail' }],
      findings: [{ severity: 'confirmed', code: 'exact_duplicates', message: '3 exact duplicate files' }],
      untested: ['min_relevance_bps'],
    });
    expect(summary).toBeTruthy();
    expect(summary!.toLowerCase()).toMatch(/duplicate/);
  }, 240_000);
});
