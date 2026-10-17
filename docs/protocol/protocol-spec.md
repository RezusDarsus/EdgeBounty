# EdgeBounty on-chain protocol specification (v1)

Program: `edgebounty_marketplace` (Anchor 1.1, Solana 3.x). All token amounts are `u64`
in the payment mint's smallest unit (USDC: 6 decimals, `1 USDC = 1_000_000`). No
floating point is used anywhere in settlement.

## 1. Design principles

1. **The chain is authoritative for contractual state** (funding, submissions, verdicts,
   settlement). The off-chain database is a query/ops mirror maintained by the indexer.
2. **Exactly-once payouts.** Every payout happens in a single instruction that moves the
   order into a terminal state (`Settled`, `Refunded`, `Cancelled`) and closes the vault.
   A closed vault + terminal state make replay impossible.
3. **Users can always exit.** `paused` blocks *new* commitments (listings, orders, jobs)
   but never blocks settlement, refunds, or dispute resolution.
4. **Bounded admin power.** The dispute authority can only split an escrow between its
   buyer and seller (and only while the order is `Disputed`). It can never redirect funds
   to a third address. Fee changes never affect already-funded orders (fee is locked at
   funding). `fee_bps <= MAX_FEE_BPS (1000 = 10%)` is a compile-time ceiling.
5. **Only commitments on-chain.** 32-byte hashes of manifests, terms, licenses, reports.
   No filenames, descriptions, or report contents.

## 2. Accounts (PDAs)

| Account | Seeds | Purpose |
|---|---|---|
| `PlatformConfig` | `["config"]` | admin, pending_admin, dispute_authority, payment mint, treasury, fee_bps, review window, correction window, paused |
| `Provider` | `["provider", authority]` | verification provider: approved flag, capability bitmask, metadata hash, job stats |
| `Listing` | `["listing", seller, listing_id u64 LE]` | asset kind, version, asset commitment, terms hash, license hash, price, active |
| `Order` | `["order", buyer, order_id u64 LE]` | purchase or custom bounty contract; state machine below |
| order vault | `["vault", order]` | SPL token account, authority = `Order` PDA |
| `Submission` | `["submission", order, index u8]` | deliverable commitment + version, per submission |
| `Attestation` | `["attestation", subject, index u8]` | verifier-signed result: asset commitment, spec hash, benchmark version, result hash, pass/fail, expiry, revoked |
| `Dispute` | `["dispute", order]` (or job) | opener, reason hash, latest evidence hashes, resolution |
| `LicenseReceipt` | `["license", order]` | buyer entitlement: asset commitment, version, license hash |
| `Reputation` | `["reputation", wallet]` | activity counters (sales, purchases, verifications, disputes) |
| `FailureBounty` | `["fbounty", creator, id u64 LE]` | AI-failure bounty: per-example reward, slots, verifier |
| bounty vault | `["fvault", failure_bounty]` | escrow for failure bounty |
| `FailureExample` | `["fexample", failure_bounty, commitment]` | one contributed example; PDA seed = exact-duplicate guard |
| `VerificationJob` | `["vjob", requester, job_id u64 LE]` | standalone paid verification job |
| job vault | `["jvault", job]` | escrow for verification job |
| `ServiceReceipt` | `["receipt", reference]` | paid platform service (storage rental, automated verification) |

## 3. Order state machine

```text
               create_bounty            create_order (listing purchase, funds immediately)
                    |                               |
                 CREATED --cancel--> CANCELLED      |
                    | fund_bounty                   |
                 FUNDED  --cancel(refund)--> CANCELLED
                    | accept_bounty                 |
                 ASSIGNED --deadline passed--> refund_order -> REFUNDED
                    | submit_deliverable            |
                    v                               v
     (verifier?) SUBMITTED --submit_order_verification--> UNDER_REVIEW
     (no verifier) ------------------------------------> UNDER_REVIEW
                                                           |
        accept_deliverable -> APPROVED --settle_order--> SETTLED (license receipt)
        review window elapsed ---------------settle_order--> SETTLED (seller protection)
        reject_deliverable (verifier FAILED) -> CORRECTION_REQUIRED --submit--> SUBMITTED ("resubmitted")
                                                 | correction deadline passed -> refund_order -> REFUNDED
        verifier FAILED and no corrections left -> refund_order -> REFUNDED
        open_dispute (buyer, within window) -> DISPUTED
             resolve_dispute(Correction)     -> CORRECTION_REQUIRED
             resolve_dispute(Split seller_bps)-> APPROVED(seller_bps) --settle_order--> SETTLED | REFUNDED (bps=0)
```

Invariants (all tested in `programs/edgebounty-marketplace/tests`):

* Buyer cannot withdraw while a submission is `SUBMITTED`, `UNDER_REVIEW` (in window), or `DISPUTED`.
* Seller cannot be paid twice: payouts only from `APPROVED`/`UNDER_REVIEW(expired)` and the
  instruction ends in a terminal state with the vault closed.
* `seller_net + platform_fee + buyer_refund + verifier_fee == vault balance` (exact).
* Acceptance criteria hash and terms hash are immutable after funding.
* Buyer, seller and verifier must be three distinct wallets (conflict exclusion).
* Seller must accept before `deadline`; submissions after `deadline` are rejected
  (corrections use `correction_deadline`).

## 4. Payout math

```
seller_gross = amount * seller_bps / 10_000            (u128 intermediate)
platform_fee = seller_gross * fee_bps_locked / 10_000
seller_net   = seller_gross - platform_fee
buyer_refund = amount - seller_gross
verifier_out = verifier_fee if a verification result was recorded else 0
buyer_refund += verifier_fee - verifier_out
```

Verifiers are paid for a completed evaluation regardless of the verdict, so they are not
incentivised to report "pass".

## 5. Failure bounties (Module D)

`create_failure_bounty` escrows `reward * max_examples + verifier_fee * max_evaluations`.
Contributors call `submit_failure_example(commitment)`; the PDA seed rejects exact duplicates.
The assigned verifier calls `verify_failure_example(passed, result_hash)`:
* verifier always receives `verifier_fee` (bounded by `max_evaluations`);
* if `passed` and slots remain, contributor receives `reward - fee`, treasury the fee.
`close_failure_bounty` returns the remainder to the creator once filled, or after expiry
plus a grace period (so pending examples get a fair chance of evaluation).

## 6. Standalone verification jobs (Module E / §8)

`create_verification_job` → `accept_verification_job` (approved provider with matching
capability, not the requester) → `submit_verification_job_result` (creates `Attestation`)
→ `settle_verification_job` (requester confirm, or anyone after review window) or
`dispute_verification_job` → `resolve_verification_dispute(provider_bps)`.
`refund_verification_job` if no result before the deadline.

## 7. Attestations

An `Attestation` proves *that an authorised verifier issued a given result for a given
asset commitment and evaluation spec*. It does **not** prove the result is true.
Fields: `subject`, `verifier`, `asset_commitment`, `asset_version`, `spec_hash`,
`benchmark_version`, `result_hash`, `passed`, `issued_at`, `expires_at`, `revoked`.
`revoke_attestation` may be called by the issuing verifier or the admin.
An adapter to the Solana Attestation Service can mirror these records off the critical path.

## 8. Service receipts

`pay_service(reference, amount)` transfers to the treasury and creates
`ServiceReceipt["receipt", reference]`. The backend issues invoices with a random 32-byte
reference; a receipt can only exist once per reference, so a payment cannot be counted twice.
Used for storage rental and platform-run verification.

## 9. Commitments

* Asset commitment = `sha256("edgebounty:manifest:v1" || salt(32) || canonical_manifest_json)`.
  The salt is private, so equal datasets do not produce linkable public hashes.
* Terms hash = `sha256("edgebounty:terms:v1" || canonical_json(terms))`.
* License hash = `sha256("edgebounty:license:v1" || license_text)`.
* Report/result hash = `sha256("edgebounty:report:v1" || canonical_json(report))`.

Canonical JSON = keys sorted recursively, no insignificant whitespace, UTF-8.

## 10. Phase 5 additions

* `Order.designated_seller` — if set at `create_bounty`, only that wallet can `accept_bounty`.
  Milestone contracts are sequences of ordinary escrowed orders; milestone *n+1* designates the
  developer who delivered milestone *n*. No new payout path exists.
* `Order.arbitrator` — an independent arbitrator agreed at funding. `resolve_dispute` accepts either the
  platform `dispute_authority` or this arbitrator; the arbitrator has the same bounded power (correction
  or buyer/seller split) and only over orders that appointed it. It must differ from buyer, seller and verifier.
* Multi-seller bounties are N parallel orders funded together (one per slot), grouped off-chain.
