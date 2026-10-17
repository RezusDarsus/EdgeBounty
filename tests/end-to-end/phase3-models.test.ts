/**
 * Phase 3 completion criterion: a buyer can purchase a model supported by an independently
 * generated performance report. Also covers the curated benchmark library, sandboxed inference
 * trials (weights never released), and refusal of unsafe models.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drainJobs } from '../../apps/api/src/services/jobs.js';
import { crank } from '../../apps/api/src/services/indexer.js';
import { ROOT, UNIT, localnetAvailable } from './helpers.js';
import { actor, api, hex, login, ok, paidVerification, payInvoice, pk, send, sha256, startHarness, uploadAsset, type Harness } from './api-harness.js';

const up = await localnetAvailable();

describe.skipIf(!up)('Phase 3 — model marketplace (localnet)', () => {
  let h: Harness;
  let fx: string;
  let benchmarkId: string;
  beforeAll(async () => {
    h = await startHarness();
    fx = mkdtempSync(join(tmpdir(), 'eb-models-'));
    execFileSync(h.ctx.cfg.pythonBin, [join(ROOT, 'services', 'model-validator', 'fixtures.py'), fx], { cwd: join(ROOT, 'services', 'model-validator') });
    // curated benchmark registered by an admin (versioned, separate from seller data)
    const admin = { kp: h.p.admin, wallet: h.p.admin.publicKey.toBase58(), token: await login(h, h.p.admin) };
    const bdir = join(fx, 'benchmark');
    const files = [
      ...['benchmark.json', 'labels.csv', 'classes.txt'].map((f) => ({ path: f, data: readFileSync(join(bdir, f)), mediaType: f.endsWith('.json') ? 'application/json' : f.endsWith('.csv') ? 'text/csv' : 'text/plain' })),
      ...readdirSync(join(bdir, 'images')).map((f) => ({ path: `images/${f}`, data: readFileSync(join(bdir, 'images', f)), mediaType: 'image/png' })),
    ];
    const bench = await uploadAsset(h, admin as any, 'dataset', 'benchmark', files, 'red/blue benchmark');
    const row = await ok(h, admin as any, 'POST', '/benchmarks', {
      id: 'eb-redblue-cls', version: 1, task: 'image_classification', description: 'Synthetic colour-dominance classification benchmark.', license: 'CC0-1.0',
      methodology: 'Top-1 accuracy on 20 held-out synthetic images; preprocessing 8x8 NCHW /255.', assetVersionId: bench.versionId, inputSpec: { size: [8, 8] },
    });
    benchmarkId = row.id;
    expect(benchmarkId).toBe('eb-redblue-cls@1');
    // versions are immutable
    expect((await api(h, admin as any, 'POST', '/benchmarks', { id: 'eb-redblue-cls', version: 1, task: 'image_classification', description: 'dup dup dup', license: 'x', methodology: 'dup dup dup', assetVersionId: bench.versionId, inputSpec: {} })).status).toBe(409);
  }, 120_000);
  afterAll(async () => h?.close());

  async function listModel(seller: Awaited<ReturnType<typeof actor>>, file: string, title: string) {
    const asset = await uploadAsset(h, seller, 'model', 'listing', [{ path: file.split(/[\\/]/).pop()!, data: readFileSync(file), mediaType: 'application/onnx' }], title);
    await drainJobs(h.ctx);
    await paidVerification(h, seller, asset.versionId);
    const prep = await ok(h, seller, 'POST', '/listings', {
      assetVersionId: asset.versionId, title, description: 'Tiny ONNX classifier for colour dominance (demo).', category: 'image_classification', formats: ['onnx'], licenseId: 'eb-nonexclusive-commercial-v1', priceMicro: String(30n * UNIT),
      details: { task: 'image_classification', inference: { size: [8, 8], scale: 255, mean: [0, 0, 0], std: [1, 1, 1], layout: 'NCHW', classes: ['red', 'blue'] } },
    });
    const a = prep.onchain;
    await send(h, seller, (await h.p.client.createListing(seller.kp.publicKey, BigInt(a.listingId), 'model', { assetCommitment: hex(a.assetCommitment), termsHash: hex(a.termsHash), licenseHash: hex(a.licenseHash), price: BigInt(a.price) })).ixs);
    await ok(h, seller, 'POST', `/listings/${prep.listing.id}/confirm`);
    return { listingId: prep.listing.id as string, asset };
  }

  async function buyWithBenchmark(buyer: Awaited<ReturnType<typeof actor>>, listingId: string, threshold: number) {
    const prep = await ok(h, buyer, 'POST', `/listings/${listingId}/purchase`, {
      verifierWallet: h.platformVerifier.publicKey.toBase58(), verifierFeeMicro: String(2n * UNIT),
      criteria: { kind: 'model', task: 'image_classification', benchmarkId, metric: 'accuracy', thresholdE4: threshold },
    });
    if (prep.checkout.invoice) await payInvoice(h, buyer, prep.checkout.invoice);
    const a = prep.onchain;
    const { ixs } = await h.p.client.createOrder(buyer.kp.publicKey, pk(a.listing), BigInt(a.orderId), { expectedPrice: BigInt(a.expectedPrice), expectedVersion: a.expectedVersion, verifier: pk(a.verifier), verifierFee: BigInt(a.verifierFee) });
    await send(h, buyer, ixs);
    expect((await ok(h, buyer, 'POST', `/orders/${prep.order.id}/confirm`)).state).toBe('submitted');
    await drainJobs(h.ctx); // sandboxed benchmark run + on-chain verdict
    return { orderId: prep.order.id as string, address: pk(a.address) };
  }

  it('buyer purchases a model backed by an independent benchmark report and receives the weights after settlement', async () => {
    const seller = await actor(h, 0n);
    const buyer = await actor(h, 100n * UNIT);
    const { listingId, asset } = await listModel(seller, join(fx, 'model', 'red_blue.onnx'), 'RedBlue classifier');

    const detail = await ok(h, buyer, 'GET', `/listings/${listingId}`);
    expect(detail.kind).toBe('model');
    expect(detail.verification[0].metrics.format).toBe('onnx'); // automatic static inspection

    // controlled preview: one input in, scores out
    const red = readFileSync(join(fx, 'benchmark', 'images', '000.png'));
    const trial = await h.app.inject({ method: 'POST', url: `/listings/${listingId}/inference-trial`, headers: { authorization: `Bearer ${buyer.token}`, 'content-type': 'application/octet-stream' }, payload: red });
    expect(trial.statusCode).toBe(200);
    expect(trial.json().top[0].label).toBe('red');

    const { orderId, address } = await buyWithBenchmark(buyer, listingId, 9000);
    const order = await ok(h, buyer, 'GET', `/orders/${orderId}`);
    expect(order.chainState).toBe('under_review');
    const rep = order.verifications[0].report;
    expect(rep.modelMetrics.benchmark.id).toBe('eb-redblue-cls');
    expect(rep.modelMetrics.benchmark.metrics.accuracy).toBe(1);
    expect(rep.modelMetrics.benchmark.samples).toBe(20);
    expect(rep.passed).toBe(true);
    expect(order.verifications[0].attestation).toBeTruthy();
    expect((await api(h, buyer, 'GET', `/orders/${orderId}/delivery`)).status).toBe(409);

    await send(h, buyer, await h.p.client.acceptDeliverable(buyer.kp.publicKey, address));
    await ok(h, buyer, 'POST', `/orders/${orderId}/sync`);
    await crank(h.ctx);
    const d = await ok(h, buyer, 'GET', `/orders/${orderId}/delivery`);
    expect(d.commitment).toBe(asset.commitment);
    const file = await api(h, buyer, 'GET', d.files[0].url);
    expect(sha256(file.raw)).toBe(sha256(readFileSync(join(fx, 'model', 'red_blue.onnx'))));
    expect(await h.p.client.tokenBalance(h.p.client.ata(seller.kp.publicKey, h.p.mint))).toBe(285_000_000n);
  });

  it('a model with custom operators is never executed; a failed independent verdict lets the buyer refund', async () => {
    const seller = await actor(h, 0n);
    const buyer = await actor(h, 100n * UNIT);
    const { listingId } = await listModel(seller, join(fx, 'model_bad', 'custom_op.onnx'), 'Suspicious model');
    const trial = await h.app.inject({ method: 'POST', url: `/listings/${listingId}/inference-trial`, headers: { authorization: `Bearer ${buyer.token}`, 'content-type': 'application/octet-stream' }, payload: readFileSync(join(fx, 'benchmark', 'images', '001.png')) });
    expect(trial.json().error).toMatch(/safety/);
    const { orderId, address } = await buyWithBenchmark(buyer, listingId, 9000);
    const order = await ok(h, buyer, 'GET', `/orders/${orderId}`);
    const rep = order.verifications[0].report;
    expect(rep.passed).toBe(false);
    expect(rep.modelMetrics.disallowedOperators).toContain('EvilOp');
    expect(rep.criteria.find((c: any) => c.criterion === 'allowed_operators').status).toBe('fail');
    await send(h, buyer, await h.p.client.refundOrder(buyer.kp.publicKey, address));
    expect((await ok(h, buyer, 'POST', `/orders/${orderId}/sync`)).state).toBe('refunded');
    expect(await h.p.client.tokenBalance(h.p.client.ata(buyer.kp.publicKey, h.p.mint))).toBe(98n * UNIT);
  });
});
