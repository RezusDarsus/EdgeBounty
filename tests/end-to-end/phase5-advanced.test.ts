/** Phase 5 — advanced marketplace features, end to end against localnet. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import { CAPABILITIES } from '@edgebounty/shared-types';
import { ENC_CHUNK, ENC_SCHEME, decryptBytes, encryptBytes, keyFingerprint, newContentKey } from '@edgebounty/verification-schemas';
import { drainJobs } from '../../apps/api/src/services/jobs.js';
import { crank, syncAll } from '../../apps/api/src/services/indexer.js';
import { failureVerifierTick } from '../../apps/api/src/services/failure.js';
import { ROOT, UNIT, localnetAvailable } from './helpers.js';
import { actor, api, hex, ok, pk, png, send, sha256, startHarness, uploadAsset, type Actor, type Harness } from './api-harness.js';

const up = await localnetAvailable();
const criteria = { kind: 'image_dataset', minImages: 1 };
const base = (over: Record<string, unknown> = {}) => ({
  title: 'Contract work', description: 'Phase 5 test contract with structured payments.', deliverables: ['images'], criteria, licenseId: 'cc-by-4.0',
  deadline: new Date(Date.now() + 7200_000).toISOString(), maxCorrections: 0, ...over,
});

describe.skipIf(!up)('Phase 5 — advanced marketplace (localnet)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h?.close());

  async function fund(buyer: Actor, a: any) {
    const { ixs } = await h.p.client.createAndFundBounty(buyer.kp.publicKey, BigInt(a.orderId), {
      amount: BigInt(a.amount), verifier: a.verifier ? pk(a.verifier) : undefined, verifierFee: BigInt(a.verifierFee), termsHash: hex(a.termsHash), criteriaHash: hex(a.criteriaHash),
      licenseHash: hex(a.licenseHash), deadline: a.deadline, maxCorrections: a.maxCorrections, designatedSeller: a.designatedSeller ? pk(a.designatedSeller) : undefined, arbitrator: a.arbitrator ? pk(a.arbitrator) : undefined,
    });
    await send(h, buyer, ixs);
  }
  async function deliverAndSettle(buyer: Actor, seller: Actor, orderId: string, address: string) {
    const asset = await uploadAsset(h, seller, 'dataset', 'submission', [{ path: 'x.png', data: png(20, 20, Math.floor(Math.random() * 1e6)), mediaType: 'image/png' }]);
    const prep = await ok(h, seller, 'POST', `/orders/${orderId}/submissions`, { assetVersionId: asset.versionId });
    await send(h, seller, await h.p.client.submitDeliverable(seller.kp.publicKey, pk(address), hex(prep.onchain.commitment), prep.onchain.version));
    await ok(h, seller, 'POST', `/orders/${orderId}/sync`);
    await drainJobs(h.ctx); // platform verifier posts the verdict (funded requests always use it)
    await send(h, buyer, await h.p.client.acceptDeliverable(buyer.kp.publicKey, pk(address)));
    await ok(h, buyer, 'POST', `/orders/${orderId}/sync`);
    await crank(h.ctx);
    return asset;
  }

  it('milestone contracts bind later milestones to the same developer', async () => {
    const buyer = await actor(h, 500n * UNIT);
    const dev = await actor(h, 0n);
    const outsider = await actor(h, 0n);
    const r = await ok(h, buyer, 'POST', '/bounties', base({
      structure: 'milestones', budgetMicro: String(100n * UNIT),
      milestones: [
        { title: 'Data collection', amountMicro: String(60n * UNIT), deadline: new Date(Date.now() + 7200_000).toISOString() },
        { title: 'Labelling', amountMicro: String(40n * UNIT), deadline: new Date(Date.now() + 14_400_000).toISOString() },
      ],
    }));
    expect(r.orders).toHaveLength(2);
    expect(r.fundNow).toHaveLength(1);
    await fund(buyer, r.fundNow[0].onchain);
    const m1 = r.fundNow[0];
    await ok(h, buyer, 'POST', `/orders/${m1.orderId}/confirm`);
    // milestone 2 cannot start before milestone 1 settles
    expect((await api(h, buyer, 'POST', `/orders/${m1.orderId}/milestones/next`)).status).toBe(409);
    await send(h, dev, await h.p.client.acceptBounty(dev.kp.publicKey, pk(m1.onchain.address)));
    await ok(h, dev, 'POST', `/orders/${m1.orderId}/sync`);
    await deliverAndSettle(buyer, dev, m1.orderId, m1.onchain.address);
    const next = await ok(h, buyer, 'POST', `/orders/${m1.orderId}/milestones/next`);
    expect(next.onchain.designatedSeller).toBe(dev.wallet);
    await fund(buyer, next.onchain);
    await ok(h, buyer, 'POST', `/orders/${next.orderId}/confirm`);
    await expect(send(h, outsider, await h.p.client.acceptBounty(outsider.kp.publicKey, pk(next.onchain.address)))).rejects.toThrow();
    await send(h, dev, await h.p.client.acceptBounty(dev.kp.publicKey, pk(next.onchain.address)));
    expect((await ok(h, dev, 'POST', `/orders/${next.orderId}/sync`)).state).toBe('assigned');
    const group = await ok(h, null, 'GET', `/groups/${r.groupId}`);
    expect(group.orders.map((o: any) => o.chainState)).toEqual(['settled', 'assigned']);
  });

  it('multi-seller bounties fund parallel slots taken by different sellers', async () => {
    const buyer = await actor(h, 500n * UNIT);
    const r = await ok(h, buyer, 'POST', '/bounties', base({ structure: 'slots', slots: 3, budgetMicro: String(30n * UNIT) }));
    expect(r.fundNow).toHaveLength(3);
    for (const s of r.fundNow) {
      expect(s.onchain.amount).toBe(String(10n * UNIT));
      await fund(buyer, s.onchain);
      await ok(h, buyer, 'POST', `/orders/${s.orderId}/confirm`);
    }
    const sellers = [await actor(h, 0n), await actor(h, 0n), await actor(h, 0n)];
    for (const [i, s] of r.fundNow.entries()) {
      await send(h, sellers[i], await h.p.client.acceptBounty(sellers[i].kp.publicKey, pk(s.onchain.address)));
      await ok(h, sellers[i], 'POST', `/orders/${s.orderId}/sync`);
    }
    await deliverAndSettle(buyer, sellers[1], r.fundNow[1].orderId, r.fundNow[1].onchain.address);
    expect(await h.p.client.tokenBalance(h.p.client.ata(sellers[1].kp.publicKey, h.p.mint))).toBe(95_000_000n);
    const group = await ok(h, null, 'GET', `/groups/${r.groupId}`);
    expect(group.orders.map((o: any) => o.chainState)).toEqual(['assigned', 'settled', 'assigned']);
  });

  it('an independent arbitrator agreed at funding resolves the dispute on-chain', async () => {
    const buyer = await actor(h, 500n * UNIT);
    const seller = await actor(h, 0n);
    const arbiter = await actor(h, 0n);
    const r = await ok(h, buyer, 'POST', '/bounties', base({ budgetMicro: String(50n * UNIT), arbitratorWallet: arbiter.wallet }));
    await fund(buyer, r.onchain);
    await ok(h, buyer, 'POST', `/orders/${r.order.id}/confirm`);
    const addr = pk(r.onchain.address);
    await send(h, seller, await h.p.client.acceptBounty(seller.kp.publicKey, addr));
    await ok(h, seller, 'POST', `/orders/${r.order.id}/sync`);
    const asset = await uploadAsset(h, seller, 'dataset', 'submission', [{ path: 'y.png', data: png(20, 20, 31337), mediaType: 'image/png' }]);
    const prep = await ok(h, seller, 'POST', `/orders/${r.order.id}/submissions`, { assetVersionId: asset.versionId });
    await send(h, seller, await h.p.client.submitDeliverable(seller.kp.publicKey, addr, hex(prep.onchain.commitment), 1));
    const d = await ok(h, buyer, 'POST', `/orders/${r.order.id}/disputes`, { reason: 'Only one image delivered; brief asked for a set.' });
    await send(h, buyer, await h.p.client.openDispute(buyer.kp.publicKey, addr, hex(d.onchain.reasonHash)));
    await send(h, arbiter, await h.p.client.resolveDispute(arbiter.kp.publicKey, addr, 'split', 6_000));
    await ok(h, buyer, 'POST', `/orders/${r.order.id}/sync`);
    await crank(h.ctx);
    expect(await h.p.client.tokenBalance(h.p.client.ata(seller.kp.publicKey, h.p.mint))).toBe(285_000_000n); // 30 - 5%
    expect(await h.p.client.tokenBalance(h.p.client.ata(buyer.kp.publicKey, h.p.mint))).toBe(470n * UNIT);
  });

  it('encrypted delivery: the platform only ever holds ciphertext and a key sealed to the buyer', async () => {
    const buyer = await actor(h, 100n * UNIT);
    const seller = await actor(h, 0n);
    const r = await ok(h, buyer, 'POST', '/bounties', base({ budgetMicro: String(20n * UNIT) }));
    await fund(buyer, r.onchain);
    await ok(h, buyer, 'POST', `/orders/${r.order.id}/confirm`);
    const addr = pk(r.onchain.address);
    await send(h, seller, await h.p.client.acceptBounty(seller.kp.publicKey, addr));
    await ok(h, seller, 'POST', `/orders/${r.order.id}/sync`);

    // seller: encrypt client-side, upload ciphertext, declare parameters (never the key)
    const plaintext = Buffer.concat([png(300, 300, 7), Buffer.alloc(ENC_CHUNK + 1000, 9)]);
    const key = await newContentKey();
    const { ciphertext, ivPrefix } = await encryptBytes(key, plaintext);
    const { asset, version } = await ok(h, seller, 'POST', '/assets', { kind: 'dataset', name: 'secret', purpose: 'submission' });
    await ok(h, seller, 'POST', `/versions/${version.id}/encryption`, { scheme: ENC_SCHEME, chunkSize: ENC_CHUNK, files: { 'data.bin.enc': Buffer.from(ivPrefix).toString('hex') }, keyFingerprint: await keyFingerprint(key) });
    const ct = Buffer.from(ciphertext);
    const upl = await ok(h, seller, 'POST', `/versions/${version.id}/uploads`, { path: 'data.bin.enc', size: ct.length, sha256: sha256(ct), mediaType: 'application/octet-stream' });
    for (let i = 0; i < upl.partsTotal; i++) {
      const part = ct.subarray(i * upl.partSize, (i + 1) * upl.partSize);
      await h.app.inject({ method: 'PUT', url: `/uploads/${upl.uploadId}/parts/${i + 1}`, headers: { authorization: `Bearer ${seller.token}`, 'content-type': 'application/octet-stream' }, payload: part });
    }
    await ok(h, seller, 'POST', `/uploads/${upl.uploadId}/complete`, {});
    const fin = await ok(h, seller, 'POST', `/versions/${version.id}/finalize`);
    expect(asset.id).toBeTruthy();
    const prep = await ok(h, seller, 'POST', `/orders/${r.order.id}/submissions`, { assetVersionId: version.id });
    await send(h, seller, await h.p.client.submitDeliverable(seller.kp.publicKey, addr, hex(fin.commitment), 1));
    await ok(h, seller, 'POST', `/orders/${r.order.id}/sync`);
    expect(prep.onchain.commitment).toBe(fin.commitment);

    // buyer: one-time box key generated locally
    const box = nacl.box.keyPair();
    await ok(h, buyer, 'POST', `/orders/${r.order.id}/delivery-key`, { boxPublicKey: Buffer.from(box.publicKey).toString('base64') });
    // seller cannot release the key before settlement
    const early = nacl.box.keyPair();
    expect((await api(h, seller, 'POST', `/orders/${r.order.id}/delivery-key/envelope`, { envelope: 'AAAA', nonce: 'AAAA', sellerBoxPublicKey: Buffer.from(early.publicKey).toString('base64') })).status).toBe(409);
    await send(h, buyer, await h.p.client.acceptDeliverable(buyer.kp.publicKey, addr));
    await ok(h, buyer, 'POST', `/orders/${r.order.id}/sync`);
    await crank(h.ctx);

    // seller seals the content key to the buyer's box key
    const info = await ok(h, seller, 'GET', `/orders/${r.order.id}/delivery-key`);
    const eph = nacl.box.keyPair();
    const nonce = nacl.randomBytes(24);
    const sealed = nacl.box(key, nonce, Buffer.from(info.buyerBoxPublicKey, 'base64'), eph.secretKey);
    await ok(h, seller, 'POST', `/orders/${r.order.id}/delivery-key/envelope`, { envelope: Buffer.from(sealed).toString('base64'), nonce: Buffer.from(nonce).toString('base64'), sellerBoxPublicKey: Buffer.from(eph.publicKey).toString('base64') });

    // buyer: download ciphertext, open envelope, verify key fingerprint, decrypt
    const d = await ok(h, buyer, 'GET', `/orders/${r.order.id}/delivery`);
    const file = await api(h, buyer, 'GET', d.files[0].url);
    const env = await ok(h, buyer, 'GET', `/orders/${r.order.id}/delivery-key`);
    const opened = nacl.box.open(Buffer.from(env.envelope, 'base64'), Buffer.from(env.nonce, 'base64'), Buffer.from(env.sellerBoxPublicKey, 'base64'), box.secretKey)!;
    expect(await keyFingerprint(opened)).toBe(env.params.keyFingerprint);
    const out = await decryptBytes(opened, new Uint8Array(file.raw), hex(env.params.files['data.bin.enc']).slice(0, 4), env.params.chunkSize);
    expect(Buffer.from(out).equals(plaintext)).toBe(true);
    // the stored object is not the plaintext
    expect(sha256(file.raw)).not.toBe(sha256(plaintext));
  });

  it('failure bounty: the platform verifier re-runs the committed model and pays only real failures', async () => {
    const fx = mkdtempSync(join(tmpdir(), 'eb-fail-'));
    execFileSync(h.ctx.cfg.pythonBin, [join(ROOT, 'services', 'model-validator', 'fixtures.py'), fx], { cwd: join(ROOT, 'services', 'model-validator') });
    const creator = await actor(h, 200n * UNIT);
    const model = await uploadAsset(h, creator, 'model', 'verification', [{ path: 'red_blue.onnx', data: readFileSync(join(fx, 'model', 'red_blue.onnx')), mediaType: 'application/onnx' }]);
    const r = await ok(h, creator, 'POST', '/failure-bounties', {
      title: 'Find colour confusions', description: 'Inputs where the classifier picks the wrong colour.', modelAssetVersionId: model.versionId,
      spec: { kind: 'image_classification_failure', classes: ['red', 'blue'], preprocessing: { size: [8, 8], scale: 255, mean: [0, 0, 0], std: [1, 1, 1], layout: 'NCHW' }, failureDefinition: 'Top-1 prediction differs from the expected label.', inputType: 'RGB image', environment: 'ORT CPU' },
      rewardMicro: String(10n * UNIT), maxExamples: 2, maxEvaluations: 4, verifierWallet: h.platformVerifier.publicKey.toBase58(), verifierFeeMicro: String(UNIT), expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const a = r.onchain;
    await send(h, creator, (await h.p.client.createFailureBounty(creator.kp.publicKey, BigInt(a.bountyId), { verifier: pk(a.verifier), modelCommitment: hex(a.modelCommitment), specHash: hex(a.specHash), termsHash: hex(a.termsHash), rewardPerExample: BigInt(a.rewardPerExample), verifierFee: BigInt(a.verifierFee), maxExamples: a.maxExamples, maxEvaluations: a.maxEvaluations, expiresAt: a.expiresAt })).ixs);
    await ok(h, creator, 'POST', `/failure-bounties/${r.bounty.id}/sync`);

    const contrib = await actor(h, 0n);
    const submit = async (img: string, label: string) => {
      const ex = await uploadAsset(h, contrib, 'dataset', 'failure_example', [
        { path: 'img.png', data: readFileSync(join(fx, 'benchmark', 'images', img)), mediaType: 'image/png' },
        { path: 'labels.csv', data: Buffer.from(`filename,label\nimg.png,${label}\n`), mediaType: 'text/csv' },
      ]);
      const p = await ok(h, contrib, 'POST', `/failure-bounties/${r.bounty.id}/examples`, { assetVersionId: ex.versionId });
      await send(h, contrib, (await h.p.client.submitFailureExample(contrib.kp.publicKey, pk(p.onchain.bounty), hex(p.onchain.commitment))).ixs);
      return p;
    };
    await submit('000.png', 'blue'); // red image labelled blue: the model (correctly) says red → counted as a failure by the agreed definition
    await submit('001.png', 'blue'); // blue image labelled blue: the model is right → not a failure
    await syncAll(h.ctx);
    expect(await failureVerifierTick(h.ctx)).toBe(2);
    const detail = await ok(h, contrib, 'GET', `/failure-bounties/${r.bounty.id}`);
    expect(detail.examples.map((e: any) => e.status).sort()).toEqual(['accepted', 'rejected']);
    expect(await h.p.client.tokenBalance(h.p.client.ata(contrib.kp.publicKey, h.p.mint))).toBe(95_000_000n);
    const rep: any = await h.p.client.program.account.reputation.fetch(h.p.client.pda.reputation(contrib.kp.publicKey));
    expect(rep.verifiedContributions).toBe(1);
  });

  it('API keys are confined to their scopes', async () => {
    const u = await actor(h, 0n);
    const key = (await ok(h, u, 'POST', '/me/api-keys', { name: 'ro', scopes: ['read'] })).key;
    const r1 = await h.app.inject({ method: 'GET', url: '/me', headers: { 'x-api-key': key } });
    expect(r1.statusCode).toBe(200);
    const r2 = await h.app.inject({ method: 'POST', url: '/assets', headers: { 'x-api-key': key }, payload: { kind: 'dataset', name: 'x', purpose: 'storage' } });
    expect(r2.statusCode).toBe(403);
    const up2 = (await ok(h, u, 'POST', '/me/api-keys', { name: 'up', scopes: ['upload'] })).key;
    const r3 = await h.app.inject({ method: 'POST', url: '/assets', headers: { 'x-api-key': up2 }, payload: { kind: 'dataset', name: 'x', purpose: 'storage' } });
    expect(r3.statusCode).toBe(200);
    const r4 = await h.app.inject({ method: 'POST', url: '/bounties', headers: { 'x-api-key': up2 }, payload: {} });
    expect(r4.statusCode).toBe(403);
    expect(CAPABILITIES.failure_bounty).toBe(64);
  });
});
