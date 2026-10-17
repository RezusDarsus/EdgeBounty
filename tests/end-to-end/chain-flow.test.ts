import { describe, expect, it, beforeAll } from 'vitest';
import { CAPABILITIES } from '@edgebounty/shared-types';
import { DOMAIN, hashDocument, hashText } from '@edgebounty/verification-schemas';
import { ensurePlatform, UNIT, localnetAvailable, newUser, type Platform } from './helpers.js';

const up = await localnetAvailable();

describe.skipIf(!up)('blockchain-client against localnet', () => {
  let p: Platform;
  beforeAll(async () => {
    p = await ensurePlatform();
  });

  it('runs a verified bounty from funding to exactly-once settlement', async () => {
    const { client } = p;
    const buyer = await newUser(p, 500n * UNIT);
    const seller = await newUser(p, 0n);
    const verifier = await newUser(p, 0n);

    await client.send(await client.registerProvider(verifier.kp.publicKey, hashDocument(DOMAIN.provider, { name: 'v' }), CAPABILITIES.dataset_image), [verifier.kp]);
    await client.send(await client.reviewProvider(p.admin.publicKey, verifier.kp.publicKey, true, CAPABILITIES.dataset_image), [p.admin]);

    const orderId = BigInt(Date.now());
    const { order, ixs } = await client.createAndFundBounty(buyer.kp.publicKey, orderId, {
      amount: 100n * UNIT,
      verifier: verifier.kp.publicKey,
      verifierFee: 2n * UNIT,
      verifierCapability: CAPABILITIES.dataset_image,
      termsHash: hashDocument(DOMAIN.terms, { t: 1 }),
      criteriaHash: hashDocument(DOMAIN.criteria, { c: 1 }),
      licenseHash: hashText(DOMAIN.license, 'license'),
      deadline: Math.floor(Date.now() / 1000) + 3600,
      maxCorrections: 1,
    });
    await client.send(ixs, [buyer.kp]);
    expect((await client.order(order))?.state).toBe('funded');

    await client.send(await client.acceptBounty(seller.kp.publicKey, order), [seller.kp]);
    await client.send(await client.submitDeliverable(seller.kp.publicKey, order, new Uint8Array(32).fill(7), 1), [seller.kp]);
    const v = await client.submitOrderVerification(verifier.kp.publicKey, order, { resultHash: new Uint8Array(32).fill(8), specHash: new Uint8Array(32).fill(9), benchmarkVersion: 1, passed: true });
    await client.send(v.ixs, [verifier.kp]);
    const att = await client.attestation(v.attestation);
    expect(att?.passed).toBe(true);
    expect(att?.assetCommitment).toBe('07'.repeat(32));

    await client.send(await client.acceptDeliverable(buyer.kp.publicKey, order), [buyer.kp]);
    const before = await client.tokenBalance(p.treasury);
    await client.send(await client.settleOrder(seller.kp.publicKey, order), [seller.kp]);

    const o = await client.order(order);
    expect(o?.state).toBe('settled');
    expect(await client.tokenBalance(client.ata(seller.kp.publicKey, p.mint))).toBe(95n * UNIT);
    expect(await client.tokenBalance(client.ata(verifier.kp.publicKey, p.mint))).toBe(2n * UNIT);
    expect((await client.tokenBalance(p.treasury)) - before).toBe(5n * UNIT);
    expect((await client.licenseReceipt(order))?.granted).toBe(true);
    await expect(client.send(await client.settleOrder(seller.kp.publicKey, order).catch(() => []), [seller.kp])).rejects.toThrow();
  });
});
