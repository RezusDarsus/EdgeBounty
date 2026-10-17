/** Regression tests for bugs found in the review pass. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crank, syncAll } from '../../apps/api/src/services/indexer.js';
import { UNIT, localnetAvailable } from './helpers.js';
import { actor, api, hex, ok, paidVerification, payInvoice, pk, png, send, sha256, startHarness, uploadAsset, type Harness } from './api-harness.js';

const up = await localnetAvailable();

describe.skipIf(!up)('review-pass regressions', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h?.close());

  it('a prepared-but-unsigned listing version never replaces the live one; old-version buyers get the files they paid for', async () => {
    const seller = await actor(h, 0n);
    const buyer = await actor(h, 100n * UNIT);
    const v1 = await uploadAsset(h, seller, 'dataset', 'listing', [{ path: 'v1.png', data: png(20, 20, 11), mediaType: 'image/png' }]);
    await paidVerification(h, seller, v1.versionId);
    const prep = await ok(h, seller, 'POST', '/listings', { assetVersionId: v1.versionId, title: 'Versioned set', description: 'Version safety regression test.', category: 'image_classification', licenseId: 'cc-by-4.0', priceMicro: String(5n * UNIT) });
    const a = prep.onchain;
    await send(h, seller, (await h.p.client.createListing(seller.kp.publicKey, BigInt(a.listingId), 'dataset', { assetCommitment: hex(a.assetCommitment), termsHash: hex(a.termsHash), licenseHash: hex(a.licenseHash), price: BigInt(a.price) })).ixs);
    await ok(h, seller, 'POST', `/listings/${prep.listing.id}/confirm`);

    // buyer purchases version 1
    const p = await ok(h, buyer, 'POST', `/listings/${prep.listing.id}/purchase`, {});
    if (p.checkout.invoice) await payInvoice(h, buyer, p.checkout.invoice);
    await send(h, buyer, (await h.p.client.createOrder(buyer.kp.publicKey, pk(p.onchain.listing), BigInt(p.onchain.orderId), { expectedPrice: BigInt(p.onchain.expectedPrice), expectedVersion: p.onchain.expectedVersion })).ixs);
    await ok(h, buyer, 'POST', `/orders/${p.order.id}/confirm`);

    // seller prepares version 2 but does not sign yet: listing must keep serving v1
    const v2ver = await ok(h, seller, 'POST', `/assets/${v1.assetId}/versions`);
    const data2 = png(20, 20, 22);
    const upl = await ok(h, seller, 'POST', `/versions/${v2ver.id}/uploads`, { path: 'v2.png', size: data2.length, sha256: sha256(data2), mediaType: 'image/png' });
    await h.app.inject({ method: 'PUT', url: `/uploads/${upl.uploadId}/parts/1`, headers: { authorization: `Bearer ${seller.token}`, 'content-type': 'application/octet-stream' }, payload: data2 });
    await ok(h, seller, 'POST', `/uploads/${upl.uploadId}/complete`, {});
    const fin2 = await ok(h, seller, 'POST', `/versions/${v2ver.id}/finalize`);
    await paidVerification(h, seller, v2ver.id);
    const nv = await ok(h, seller, 'POST', `/listings/${prep.listing.id}/versions`, { assetVersionId: v2ver.id });
    expect((await ok(h, null, 'GET', `/listings/${prep.listing.id}`)).asset.commitment).toBe(v1.commitment);
    await syncAll(h.ctx);
    expect((await ok(h, null, 'GET', `/listings/${prep.listing.id}`)).asset.commitment).toBe(v1.commitment);

    // now the seller signs v2 on-chain; confirm switches the listing
    await send(h, seller, await h.p.client.updateListingVersion(seller.kp.publicKey, pk(prep.listing.onchainAddress), { assetCommitment: hex(nv.onchain.assetCommitment), termsHash: hex(nv.onchain.termsHash), licenseHash: hex(nv.onchain.licenseHash), price: BigInt(nv.onchain.price) }));
    await ok(h, seller, 'POST', `/listings/${prep.listing.id}/confirm`);
    expect((await ok(h, null, 'GET', `/listings/${prep.listing.id}`)).asset.commitment).toBe(fin2.commitment);

    // the v1 buyer settles afterwards and still receives exactly v1
    await send(h, buyer, await h.p.client.acceptDeliverable(buyer.kp.publicKey, pk(p.onchain.address)));
    await ok(h, buyer, 'POST', `/orders/${p.order.id}/sync`);
    await crank(h.ctx);
    const d = await ok(h, buyer, 'GET', `/orders/${p.order.id}/delivery`);
    expect(d.commitment).toBe(v1.commitment);
    expect(d.files.map((f: any) => f.path)).toEqual(['v1.png']);
  });

  it('uploads resume from the parts storage actually holds; parallel uploads to one path are refused', async () => {
    const u = await actor(h, 0n);
    const { version } = await ok(h, u, 'POST', '/assets', { kind: 'dataset', name: 'resume', purpose: 'listing' });
    const data = png(200, 200, 5); // > 64 KiB test part size → several parts
    const upl = await ok(h, u, 'POST', `/versions/${version.id}/uploads`, { path: 'big.png', size: data.length, sha256: sha256(data), mediaType: 'image/png' });
    expect(upl.partsTotal).toBeGreaterThan(1);
    expect((await api(h, u, 'POST', `/versions/${version.id}/uploads`, { path: 'big.png', size: data.length, sha256: sha256(data), mediaType: 'image/png' })).status).toBe(409);
    const put = (n: number) => h.app.inject({ method: 'PUT', url: `/uploads/${upl.uploadId}/parts/${n}`, headers: { authorization: `Bearer ${u.token}`, 'content-type': 'application/octet-stream' }, payload: data.subarray((n - 1) * upl.partSize, n * upl.partSize) });
    await put(1);
    // "connection dropped": completing now is refused, status reports what arrived
    expect((await api(h, u, 'POST', `/uploads/${upl.uploadId}/complete`, {})).status).toBe(400);
    expect((await ok(h, u, 'GET', `/uploads/${upl.uploadId}`)).partsReceived).toEqual([1]);
    for (let n = 2; n <= upl.partsTotal; n++) await put(n);
    const done = await ok(h, u, 'POST', `/uploads/${upl.uploadId}/complete`, {});
    expect(done.sha256).toBe(sha256(data));
  });
});
