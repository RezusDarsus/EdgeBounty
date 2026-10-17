import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { draftBounty } from './agents.js';

const draft = { title: 'Georgian speech dataset', description: 'Collect consented speech recordings with a documented sampling plan.', deliverables: ['Audio and transcripts'], reviewChecklist: ['Review consent records'], questions: ['Which dialects?'] };
const cfg = () => loadConfig({ NODE_ENV: 'test', AI_DRAFTS_ENABLED: '1', NVIDIA_API_KEY: 'unit-test-placeholder' });
describe('bounded bounty drafting', () => {
  it('makes no provider request when spending is disabled', async () => {
    const fetcher = vi.fn();
    await expect(draftBounty({ ...cfg(), AI_DRAFTS_ENABLED: '0' }, 'requirements', fetcher)).rejects.toThrow('disabled');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('returns a validated human-review draft with measured usage, no invented dollar cost', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(draft) }, finish_reason: 'stop' }], usage: { prompt_tokens: 45, completion_tokens: 60 } })));
    const r = await draftBounty(cfg(), 'Need speech samples', fetcher);
    expect(r).toMatchObject({ draft, requiresHumanReview: true, cost: { calls: 1, inputTokens: 45, outputTokens: 60, billedUsd: null } });
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request.max_tokens).toBe(1600);
    expect(request.tools).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...draft, payment: 'release escrow' },
    { ...draft, deliverables: [] },
    { ...draft, title: 'x'.repeat(201) },
  ])('rejects out-of-contract provider output', async (value) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] })));
    await expect(draftBounty(cfg(), 'requirements', fetcher)).rejects.toThrow();
  });
  it('fails closed on provider failure and truncated JSON', async () => {
    await expect(draftBounty(cfg(), 'requirements', vi.fn().mockResolvedValue(new Response('', { status: 429 })))).rejects.toThrow('429');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(draft) }, finish_reason: 'length' }] })));
    await expect(draftBounty(cfg(), 'requirements', fetcher)).rejects.toThrow('incomplete');
  });
});
