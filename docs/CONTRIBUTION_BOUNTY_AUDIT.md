# Contribution bounty implementation audit

Audit date: 2026-10-18

## Existing building blocks

- Bounties are rows in `orders`; each is backed by one Anchor `Order` account and one escrow vault. The buyer funds the order before worker activity.
- `accept_bounty` changes a funded order to `Assigned` and records one seller wallet. Submissions and corrections remain bound to that seller.
- Settlement closes the vault in one transaction and pays one seller. The current on-chain policy deducts the configured marketplace fee from that seller's reward.
- Private R2 multipart uploads, storage quota reservations, hosting coverage, invoice confirmation, and asset access controls already exist.
- Verification jobs already record a policy version and actual cost; reusable results are keyed by immutable asset version, specification hash, and policy version.
- Existing bounties support revisions, verifier attestations, buyer review, disputes, and refunds.

Evidence: `programs/edgebounty-marketplace/src/instructions/order.rs`, `programs/edgebounty-marketplace/src/instructions/settlement.rs`, `apps/api/src/routes/marketplace.ts`, `apps/api/src/routes/assets.ts`, `apps/api/src/routes/storage.ts`, `apps/api/src/routes/verification.ts`, and `apps/api/src/lib/billing.ts`.

## New policy helpers

`packages/pricing-engine/src/contributions.ts` contains deterministic integer arithmetic for contribution batches:

- The 92% threshold is inclusive and compares valid-file count to evaluated-file count, not model confidence.
- Under-threshold batches remain unpaid and report zero accepted units until revision policy is satisfied.
- Accepted rewards are based on accepted units, with separately bounded reward and reimbursement reserves and a total escrow ceiling.
- Storage reimbursement is prorated by accepted bytes and capped.
- Commission is calculated on accepted rewards; infrastructure reimbursements are excluded from the commission base.

This is a pure policy module. It does not yet create contribution records, verify files, reserve capacity, or submit settlements.

## Blocking integration gaps

The specification cannot safely be enabled by routing contributions through the current bounty order:

1. Anchor binds one seller to an order and only permits that seller to submit. It has no shared target, reservations, per-contributor accepted units, payout caps, or partial pool settlement.
2. The current order settlement is a whole-vault, one-seller payout. Application-side contribution math cannot authorize token transfers or prevent a client from bypassing it.
3. Current uploads are workflow/customer assets with account quota behavior; there is no worker-paid reusable entitlement tied to contribution revisions, nor a logical partial ownership transfer to the buyer.
4. Existing verification is version-level and report-level. It does not persist per-file accepted/rejected decisions or incremental replacement verification for a contribution batch.
5. Existing 6% settlement deducts the commission from seller proceeds. The new example policy charges the buyer on top of the full worker reward. This needs an explicit on-chain policy/version and matching UI quote before use.
6. No buyer-funded reimbursement reserve, append-only contribution ledger, contribution dispute lifecycle, or reimbursement-farming controls exist yet.

Therefore contribution settlements must not be represented as production-ready or sent to mainnet. The current order flow remains the only authoritative bounty settlement path.

## Verification

- `npm run typecheck` passed.
- `npx vitest run packages/pricing-engine/src/contributions.test.ts` passed (4 tests).
- Full `npx vitest run`: 24 files passed, 7 skipped; 120 tests passed, 22 skipped, and one time-sensitive marketplace billing assertion exceeded its 2-month bound by one second. Rerunning that assertion alone passed.
- No Anchor program, API route, database migration, or frontend change was made in this increment. Mainnet and real-money transfers were not activated.
