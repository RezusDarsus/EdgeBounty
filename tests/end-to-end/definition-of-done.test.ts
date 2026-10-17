/**
 * Blueprint §22 Definition of Done, end to end through the API + real validator + localnet:
 * a buyer deposits 1 SOL (wrapped), a seller submits a private dataset, an authorized verifier
 * attaches an evaluation result, the program settles exactly once, and the buyer obtains the
 * dataset without unrestricted access before approval. Plus the failed and disputed paths.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drainJobs } from '../../apps/api/src/services/jobs.js';
import { crank } from '../../apps/api/src/services/indexer.js';
import { UNIT, localnetAvailable } from './helpers.js';
import { actor, api, hex, login, ok, pk, png, send, sha256, startHarness, uploadAsset, type Harness } from './api-harness.js';
import { eq } from 'drizzle-orm';
import { RATES } from '@edgebounty/pricing-engine';
import { schema } from '../../apps/api/src/db/index.js';

const up = await localnetAvailable();

function dataset(n: number, opts: { dupes?: number; corrupt?: number; size?: number } = {}) {
  const files = Array.from({ length: n }, (_, i) => ({ path: `images/${String(i).padStart(3, '0')}.png`, data: png(opts.size ?? 80, opts.size ?? 80, i + 1), mediaType: 'image/png' }));
  for (let i = 0; i < (opts.dupes ?? 0); i++) files.push({ path: `images/dup_${i}.png`, data: files[i].data, mediaType: 'image/png' });
  for (let i = 0; i < (opts.corrupt ?? 0); i++) files.push({ path: `images/bad_${i}.png`, data: Buffer.from('\x89PNG\r\n\x1a\ngarbage' + i), mediaType: 'image/png' });
  return files;
}

const criteria = { kind: 'image_dataset', minImages: 12, minWidth: 64, minHeight: 64, maxExactDuplicates: 0, minReadableBps: 10000 };

describe.skipIf(!up)('Definition of Done (§22) via API + localnet', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h?.close());

  async function fundedBounty(buyer: Awaited<ReturnType<typeof actor>>, maxCorrections = 1) {
    const created = await ok(h, buyer, 'POST', '/bounties', {
      title: 'Broken vehicle window images',
      description: 'Need labelled images of broken vehicle windows for a detector.',
      deliverables: ['>= 12 PNG images, >= 64x64, no duplicates'],
      criteria,
      licenseId: 'eb-nonexclusive-commercial-v1',
      budgetMicro: String(100n * UNIT),
      deadline: new Date(Date.now() + 3 * 3600_000).toISOString(),
      maxCorrections,
      verifierWallet: h.platformVerifier.publicKey.toBase58(),
    });
    const a = created.onchain;
    // the API sets the fixed platform verification fee (initial check + agreed correction rounds)
    expect(BigInt(a.verifierFee)).toBe(RATES.l2Base * BigInt(1 + maxCorrections));
    const { ixs } = await h.p.client.createAndFundBounty(buyer.kp.publicKey, BigInt(a.orderId), {
      amount: BigInt(a.amount), verifier: pk(a.verifier), verifierFee: BigInt(a.verifierFee), verifierCapability: 1,
      termsHash: hex(a.termsHash), criteriaHash: hex(a.criteriaHash), licenseHash: hex(a.licenseHash), deadline: a.deadline, maxCorrections: a.maxCorrections,
    });
    await send(h, buyer, ixs);
    const conf = await ok(h, buyer, 'POST', `/orders/${created.order.id}/confirm`);
    expect(conf.state).toBe('funded');
    return { orderId: created.order.id as string, address: pk(a.address), fee: BigInt(a.verifierFee) };
  }

  async function submit(seller: Awaited<ReturnType<typeof actor>>, orderId: string, address: ReturnType<typeof pk>, files: ReturnType<typeof dataset>) {
    const asset = await uploadAsset(h, seller, 'dataset', 'submission', files, 'windows');
    const prep = await ok(h, seller, 'POST', `/orders/${orderId}/submissions`, { assetVersionId: asset.versionId });
    expect(prep.onchain.commitment).toBe(asset.commitment);
    await send(h, seller, await h.p.client.submitDeliverable(seller.kp.publicKey, address, hex(prep.onchain.commitment), prep.onchain.version));
    expect((await ok(h, seller, 'POST', `/orders/${orderId}/sync`)).state).toBe('submitted');
    await drainJobs(h.ctx); // preview job + order verification job (posts verdict on-chain)
    return asset;
  }

  it('funds 1 SOL (100 units), verifies a private dataset, settles exactly once and delivers only after settlement', async () => {
    const buyer = await actor(h, 500n * UNIT);
    const seller = await actor(h, 0n);
    const { orderId, address, fee } = await fundedBounty(buyer);
    expect(await h.p.client.tokenBalance(h.p.client.pda.vault(address))).toBe(100n * UNIT + fee);

    // seller accepts the funded request
    await send(h, seller, await h.p.client.acceptBounty(seller.kp.publicKey, address));
    expect((await ok(h, seller, 'POST', `/orders/${orderId}/sync`)).state).toBe('assigned');

    // a large file exercises multipart (part size is 64 KiB in tests)
    const files = dataset(12);
    files.push({ path: 'images/large.png', data: png(256, 256, 99), mediaType: 'image/png' });
    expect(files.at(-1)!.data.length).toBeGreaterThan(64 * 1024);
    await submit(seller, orderId, address, files);

    const order = await ok(h, buyer, 'GET', `/orders/${orderId}`);
    expect(order.chainState).toBe('under_review');
    const v = order.verifications.find((x: any) => x.status === 'completed');
    expect(v.report.passed).toBe(true);
    expect(v.report.datasetMetrics.readableFiles).toBe(13);
    expect(v.attestation).toBeTruthy();
    const att = await ok(h, null, 'GET', `/attestations/${v.attestation}`);
    expect(att.resultHash).toBe(v.reportHash);
    expect((await ok(h, null, 'POST', `/attestations/${v.attestation}/verify-report`, { report: v.report })).matches).toBe(true);

    // no unrestricted access before approval: delivery refused, only previews
    expect((await api(h, buyer, 'GET', `/orders/${orderId}/delivery`)).status).toBe(409);
    const [asset] = await h.ctx.db.select().from(schema.submissions).where(eq(schema.submissions.orderId, orderId));
    const prev = await api(h, buyer, 'GET', `/previews/${asset.assetVersionId}/0`);
    expect(prev.status).toBe(200);
    expect(prev.headers['content-type']).toBe('image/jpeg');
    const stranger = await actor(h, 0n);
    expect((await api(h, stranger, 'GET', `/previews/${asset.assetVersionId}/0`)).status).toBe(404);

    // buyer approves; settlement crank pays out exactly once
    const treasuryBefore = await h.p.client.tokenBalance(h.p.treasury);
    await send(h, buyer, await h.p.client.acceptDeliverable(buyer.kp.publicKey, address));
    await ok(h, buyer, 'POST', `/orders/${orderId}/sync`);
    const settled = await crank(h.ctx);
    expect(settled).toBeGreaterThanOrEqual(1);
    expect(await crank(h.ctx)).toBe(0); // nothing left to settle
    await expect(send(h, h.platformVerifier, await h.p.client.settleOrder(h.platformVerifier.publicKey, address))).rejects.toThrow();

    const c = h.p.client;
    expect(await c.tokenBalance(c.ata(seller.kp.publicKey, h.p.mint))).toBe(95n * UNIT);
    expect(await c.tokenBalance(c.ata(h.platformVerifier.publicKey, h.p.mint))).toBeGreaterThanOrEqual(fee);
    expect((await c.tokenBalance(h.p.treasury)) - treasuryBefore).toBe(5n * UNIT);

    // delivery: fresh on-chain entitlement check, signed short-lived links, exact bytes
    const d = await ok(h, buyer, 'GET', `/orders/${orderId}/delivery`);
    expect(d.files).toHaveLength(13);
    const f = d.files.find((x: any) => x.path === 'images/large.png');
    const dl = await api(h, buyer, 'GET', f.url);
    expect(dl.status).toBe(200);
    expect(sha256(dl.raw)).toBe(f.sha256);
    // another wallet cannot use the buyer's link; tampered tokens are rejected
    expect((await api(h, stranger, 'GET', f.url)).status).toBe(403);
    expect((await api(h, null, 'GET', f.url.slice(0, -3) + 'abc')).status).toBe(401);
    expect((await api(h, seller, 'GET', `/orders/${orderId}/delivery`)).status).toBe(403);
  });

  it('rejects a failing submission objectively, allows a correction, then refunds (verifier still paid)', async () => {
    const buyer = await actor(h, 500n * UNIT);
    const seller = await actor(h, 0n);
    const { orderId, address, fee } = await fundedBounty(buyer, 1);
    await send(h, seller, await h.p.client.acceptBounty(seller.kp.publicKey, address));
    await ok(h, seller, 'POST', `/orders/${orderId}/sync`);

    await submit(seller, orderId, address, dataset(10, { dupes: 2, corrupt: 1 }));
    let order = await ok(h, buyer, 'GET', `/orders/${orderId}`);
    const failed = order.verifications.find((x: any) => x.report);
    expect(failed.report.passed).toBe(false);
    const failing = failed.report.criteria.filter((c: any) => c.status === 'fail').map((c: any) => c.criterion);
    expect(failing).toEqual(expect.arrayContaining(['min_images', 'min_readable_bps', 'max_exact_duplicates']));
    expect(failed.report.findings.map((f: any) => f.code)).toEqual(expect.arrayContaining(['corrupted_images', 'exact_duplicates']));

    await send(h, buyer, await h.p.client.rejectDeliverable(buyer.kp.publicKey, address));
    expect((await ok(h, buyer, 'POST', `/orders/${orderId}/sync`)).state).toBe('correction_required');

    // still failing after the single allowed correction
    await submit(seller, orderId, address, dataset(5));
    order = await ok(h, buyer, 'GET', `/orders/${orderId}`);
    expect(order.verifications.filter((x: any) => x.report).length).toBe(2);
    expect((await api(h, buyer, 'GET', `/orders/${orderId}/delivery`)).status).toBe(409);
    await send(h, buyer, await h.p.client.refundOrder(buyer.kp.publicKey, address));
    expect((await ok(h, buyer, 'POST', `/orders/${orderId}/sync`)).state).toBe('refunded');
    expect(await h.p.client.tokenBalance(h.p.client.ata(buyer.kp.publicKey, h.p.mint))).toBe(500n * UNIT - fee);
    expect(await h.p.client.tokenBalance(h.p.client.ata(seller.kp.publicKey, h.p.mint))).toBe(0n);
    expect((await api(h, buyer, 'GET', `/orders/${orderId}/delivery`)).status).toBe(409);
  });

  it('resolves a dispute with a split through audited admin review, without releasing the asset to the buyer', async () => {
    const buyer = await actor(h, 500n * UNIT);
    const seller = await actor(h, 0n);
    const admin = { kp: h.p.admin, wallet: h.p.admin.publicKey.toBase58(), token: '' };
    admin.token = await login(h, h.p.admin);
    const { orderId, address, fee } = await fundedBounty(buyer, 0);
    await send(h, seller, await h.p.client.acceptBounty(seller.kp.publicKey, address));
    await ok(h, seller, 'POST', `/orders/${orderId}/sync`);
    await submit(seller, orderId, address, dataset(12));

    const prep = await ok(h, buyer, 'POST', `/orders/${orderId}/disputes`, { reason: 'Images show intact windows; the content is not relevant.' });
    await send(h, buyer, await h.p.client.openDispute(buyer.kp.publicKey, address, hex(prep.onchain.reasonHash)));
    expect((await ok(h, buyer, 'POST', `/orders/${orderId}/sync`)).state).toBe('disputed');
    const ev = await ok(h, seller, 'POST', `/orders/${orderId}/disputes/evidence`, { note: 'All images match the brief; see report.' });
    await send(h, seller, await h.p.client.addDisputeEvidence(seller.kp.publicKey, address, hex(ev.onchain.evidenceHash)));

    // buyer gets nothing during the dispute; non-admins cannot resolve
    expect((await api(h, buyer, 'GET', `/orders/${orderId}/delivery`)).status).toBe(409);
    const disputes = await ok(h, admin as any, 'GET', '/admin/disputes');
    const mine = disputes.find((d: any) => d.orderId === orderId);
    expect((await api(h, buyer, 'POST', `/admin/disputes/${mine.id}/resolve`, { resolution: 'split', sellerBps: 5000, notes: 'n/a' })).status).toBe(403);
    const files = await ok(h, admin as any, 'GET', `/admin/disputes/${mine.id}/files`);
    expect(files.length).toBe(12);
    expect((await api(h, admin as any, 'GET', files[0].url)).status).toBe(200);

    await ok(h, admin as any, 'POST', `/admin/disputes/${mine.id}/resolve`, { resolution: 'split', sellerBps: 5000, notes: 'Half the images are relevant.' });
    await crank(h.ctx);
    expect((await ok(h, buyer, 'POST', `/orders/${orderId}/sync`)).state).toBe('settled');
    const c = h.p.client;
    expect(await c.tokenBalance(c.ata(seller.kp.publicKey, h.p.mint))).toBe(475_000_000n);
    // 500 - (100 + verifier fee) + 50 refunded half
    expect(await c.tokenBalance(c.ata(buyer.kp.publicKey, h.p.mint))).toBe(450n * UNIT - fee);
    const audit = await ok(h, admin as any, 'GET', '/admin/audit');
    expect(audit.map((a: any) => a.action)).toEqual(expect.arrayContaining(['dispute.reviewer_access', 'dispute.resolve']));
    const rec = await ok(h, admin as any, 'GET', '/admin/reconciliation');
    expect(rec.ok).toBe(true);
  });
});
