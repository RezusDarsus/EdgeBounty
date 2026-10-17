/**
 * Phase 2 completion criterion: a third-party verifier can evaluate a private submission and
 * receive payment without being the seller or buyer. Also: provider registry, job-scoped input
 * access, signed result submission, on-chain certificate from the platform-as-provider, and
 * the provider-job market with dispute-free settlement.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAPABILITIES } from '@edgebounty/shared-types';
import { DOMAIN, bytesToHex, hashDocument, type VerificationReport } from '@edgebounty/verification-schemas';
import { drainJobs, platformProviderTick } from '../../apps/api/src/services/jobs.js';
import { crank, syncAll } from '../../apps/api/src/services/indexer.js';
import { wilson } from '../../apps/api/src/services/l3.js';
import { UNIT, localnetAvailable } from './helpers.js';
import { actor, api, hex, login, ok, pk, png, send, sha256, startHarness, uploadAsset, type Harness } from './api-harness.js';

const up = await localnetAvailable();

describe('L3 statistics', () => {
  it('Wilson interval is conservative for small samples', () => {
    const w = wilson(19, 20);
    expect(w.low).toBeLessThan(9500);
    expect(w.high).toBeLessThanOrEqual(10_000);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 0 });
    const big = wilson(1900, 2000);
    expect(big.high - big.low).toBeLessThan(w.high - w.low);
  });
});

describe.skipIf(!up)('Phase 2 — independent verification (localnet)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h?.close());

  async function approvedProvider(name: string, caps: number) {
    const v = await actor(h, 0n);
    const prof = await ok(h, v, 'POST', '/providers/profile', {
      profile: { schema: 'edgebounty.provider/1', name, description: 'Independent CV dataset audits', assetTypes: ['image datasets'], hardware: '1× L4, isolated VM', methods: ['pHash', 'manual spot checks'], pricing: '0.02 SOL per job', capacityJobsPerDay: 50, securityCapabilities: ['no egress'] },
      requestedCapabilities: caps,
    });
    await send(h, v, await h.p.client.registerProvider(v.kp.publicKey, hex(prof.onchain.metadataHash), caps));
    // not trusted until approved
    expect((await h.p.client.provider(v.kp.publicKey))?.approved).toBe(false);
    await send(h, h.p.admin, await h.p.client.reviewProvider(h.p.admin.publicKey, v.kp.publicKey, true, caps));
    await syncAll(h.ctx);
    return v;
  }

  it('third-party verifier evaluates a private submission and is paid, without being buyer or seller', async () => {
    const verifier = await approvedProvider('Acme Audits', CAPABILITIES.dataset_image);
    const listed = await ok(h, null, 'GET', '/providers');
    expect(listed.some((p: any) => p.wallet === verifier.wallet && p.profile.name === 'Acme Audits')).toBe(true);

    const buyer = await actor(h, 300n * UNIT);
    const seller = await actor(h, 0n);
    const created = await ok(h, buyer, 'POST', '/bounties', {
      title: 'Street sign photos', description: 'Photos of damaged street signs for a classifier.', deliverables: ['10+ images'],
      criteria: { kind: 'image_dataset', minImages: 10, minWidth: 32, minHeight: 32, maxExactDuplicates: 0 },
      licenseId: 'cc-by-4.0', budgetMicro: String(50n * UNIT), deadline: new Date(Date.now() + 7200_000).toISOString(), maxCorrections: 0,
      verifierWallet: verifier.wallet, verifierFeeMicro: String(3n * UNIT),
    });
    const a = created.onchain;
    const addr = pk(a.address);
    await send(h, buyer, (await h.p.client.createAndFundBounty(buyer.kp.publicKey, BigInt(a.orderId), { amount: BigInt(a.amount), verifier: pk(a.verifier), verifierFee: BigInt(a.verifierFee), verifierCapability: CAPABILITIES.dataset_image, termsHash: hex(a.termsHash), criteriaHash: hex(a.criteriaHash), licenseHash: hex(a.licenseHash), deadline: a.deadline, maxCorrections: 0 })).ixs);
    await ok(h, buyer, 'POST', `/orders/${created.order.id}/confirm`);
    // the verifier cannot also take the job (conflict of interest)
    await expect(send(h, verifier, await h.p.client.acceptBounty(verifier.kp.publicKey, addr))).rejects.toThrow();
    await send(h, seller, await h.p.client.acceptBounty(seller.kp.publicKey, addr));
    await ok(h, seller, 'POST', `/orders/${created.order.id}/sync`);

    const files = Array.from({ length: 10 }, (_, i) => ({ path: `signs/${i}.png`, data: png(48, 48, i + 50), mediaType: 'image/png' }));
    const asset = await uploadAsset(h, seller, 'dataset', 'submission', files);
    const prep = await ok(h, seller, 'POST', `/orders/${created.order.id}/submissions`, { assetVersionId: asset.versionId });
    await send(h, seller, await h.p.client.submitDeliverable(seller.kp.publicKey, addr, hex(prep.onchain.commitment), prep.onchain.version));
    await ok(h, seller, 'POST', `/orders/${created.order.id}/sync`);
    await drainJobs(h.ctx); // only the preview job runs: the order job awaits the third-party provider

    const dash = await ok(h, verifier, 'GET', '/provider/jobs');
    const job = dash.orderJobs.find((j: any) => j.orderId === created.order.id);
    expect(job.status).toBe('awaiting_provider');

    // job-scoped, wallet-bound input access; outsiders and the buyer are refused
    expect((await api(h, buyer, 'GET', `/provider/jobs/${job.id}/inputs`)).status).toBe(403);
    const inputs = await ok(h, verifier, 'GET', `/provider/jobs/${job.id}/inputs`);
    expect(inputs.commitment).toBe(asset.commitment);
    const f0 = await api(h, verifier, 'GET', inputs.files[0].url);
    expect(sha256(f0.raw)).toBe(inputs.files[0].sha256);
    expect((await api(h, buyer, 'GET', inputs.files[0].url)).status).toBe(403);

    // the provider evaluates in its own environment and submits a signed report
    const report: VerificationReport = {
      schema: 'edgebounty.report/1', assetId: asset.assetId, assetVersion: asset.versionId, assetCommitment: asset.commitment, level: 'L2', specHash: job.specHash,
      datasetMetrics: null, modelMetrics: null, findings: [], criteria: [{ criterion: 'min_images', required: 10, actual: 10, status: 'pass' }], passed: true,
      sampling: 'all items', tools: [{ name: 'acme-audit', version: '3.1' }], limitations: ['Independent provider evaluation.'], untested: [], verifier: verifier.wallet, createdAt: new Date().toISOString(),
    };
    // a report about a different asset is rejected
    expect((await api(h, verifier, 'POST', `/provider/jobs/${job.id}/report`, { report: { ...report, assetCommitment: '0'.repeat(64) } })).status).toBe(400);
    const r = await ok(h, verifier, 'POST', `/provider/jobs/${job.id}/report`, { report });
    expect(r.reportHash).toBe(bytesToHex(hashDocument(DOMAIN.report, report)));
    const v = await h.p.client.submitOrderVerification(verifier.kp.publicKey, addr, { resultHash: hex(r.reportHash), specHash: hex(r.specHash), benchmarkVersion: 1, passed: true });
    await send(h, verifier, v.ixs);
    expect((await ok(h, buyer, 'POST', `/orders/${created.order.id}/sync`)).state).toBe('under_review');
    const att = await ok(h, null, 'GET', `/attestations/${v.attestation.toBase58()}`);
    expect(att.verifier).toBe(verifier.wallet);
    expect(att.resultHash).toBe(r.reportHash);

    await send(h, buyer, await h.p.client.acceptDeliverable(buyer.kp.publicKey, addr));
    await ok(h, buyer, 'POST', `/orders/${created.order.id}/sync`);
    await crank(h.ctx);
    const c = h.p.client;
    expect(await c.tokenBalance(c.ata(verifier.kp.publicKey, h.p.mint))).toBe(3n * UNIT);
    expect(await c.tokenBalance(c.ata(seller.kp.publicKey, h.p.mint))).toBe(47_500_000n);
    expect((await c.provider(verifier.kp.publicKey))?.jobsCompleted).toBe(1);
  });

  it('platform-as-provider issues an on-chain certificate for a private dataset (no marketplace trade)', async () => {
    const owner = await actor(h, 50n * UNIT);
    const asset = await uploadAsset(h, owner, 'dataset', 'verification', Array.from({ length: 6 }, (_, i) => ({ path: `x/${i}.png`, data: png(40, 40, 200 + i), mediaType: 'image/png' })));
    const prep = await ok(h, owner, 'POST', '/provider-jobs', {
      assetVersionId: asset.versionId, level: 'L2', criteria: { kind: 'image_dataset', minImages: 5 }, priceMicro: String(4n * UNIT),
      providerWallet: h.platformVerifier.publicKey.toBase58(), requiredCapability: CAPABILITIES.dataset_image, deadline: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const a = prep.onchain;
    const { job, ixs } = await h.p.client.createVerificationJob(owner.kp.publicKey, BigInt(a.jobId), { provider: pk(a.provider), requiredCapability: a.requiredCapability, assetCommitment: hex(a.assetCommitment), specHash: hex(a.specHash), price: BigInt(a.price), deadline: a.deadline });
    await send(h, owner, ixs);
    await ok(h, owner, 'POST', `/provider-jobs/${prep.job.id}/sync`);
    expect(await platformProviderTick(h.ctx)).toBe(1);
    await drainJobs(h.ctx);
    const view = await h.p.client.job(job);
    expect(view?.state).toBe('result_submitted');
    const att = await h.p.client.attestation(h.p.client.pda.attestation(job, 0));
    expect(att?.assetCommitment).toBe(asset.commitment);
    expect(att?.passed).toBe(true);
    // requester confirms → provider paid minus 5%
    await send(h, owner, await h.p.client.settleVerificationJob(owner.kp.publicKey, job));
    expect((await h.p.client.job(job))?.state).toBe('completed');
    expect(await h.p.client.tokenBalance(h.p.client.ata(h.platformVerifier.publicKey, h.p.mint))).toBeGreaterThanOrEqual(3_800_000n);
  });

  it('unapproved providers cannot accept jobs; admin approval is required and audited', async () => {
    const rogue = await actor(h, 0n);
    await send(h, rogue, await h.p.client.registerProvider(rogue.kp.publicKey, new Uint8Array(32), CAPABILITIES.dataset_image));
    const owner = await actor(h, 20n * UNIT);
    const asset = await uploadAsset(h, owner, 'dataset', 'verification', [{ path: 'a.png', data: png(16, 16, 1), mediaType: 'image/png' }]);
    const prep = await ok(h, owner, 'POST', '/provider-jobs', { assetVersionId: asset.versionId, level: 'L1', priceMicro: String(UNIT), requiredCapability: CAPABILITIES.dataset_image, deadline: new Date(Date.now() + 86_400_000).toISOString() });
    const a = prep.onchain;
    const { job, ixs } = await h.p.client.createVerificationJob(owner.kp.publicKey, BigInt(a.jobId), { requiredCapability: a.requiredCapability, assetCommitment: hex(a.assetCommitment), specHash: hex(a.specHash), price: BigInt(a.price), deadline: a.deadline });
    await send(h, owner, ixs);
    await expect(send(h, rogue, await h.p.client.acceptVerificationJob(rogue.kp.publicKey, job))).rejects.toThrow();
    // open job can be cancelled by the requester before anyone accepts
    await send(h, owner, await h.p.client.refundVerificationJob(owner.kp.publicKey, job));
    expect((await h.p.client.job(job))?.state).toBe('refunded');
    await syncAll(h.ctx); // indexer mirrors registry accounts
    const admin = { kp: h.p.admin, wallet: h.p.admin.publicKey.toBase58(), token: await login(h, h.p.admin) };
    const providers = await ok(h, admin as any, 'GET', '/admin/providers');
    expect(providers.find((p: any) => p.wallet === rogue.wallet)?.approved).toBe(false);
  });
});
