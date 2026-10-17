# Product requirements & policies (Phase 0)

## Initial customer group
Small computer-vision teams and independent ML developers who need niche image datasets
(classification / detection) and model-failure examples.

## The reference transaction (Phase 0 completion criterion)
1. Buyer signs in with a wallet, drafts a request (description, acceptance criteria JSON,
   license, deadline, budget 100 USDC, optional verifier + fee).
2. API canonicalises the terms → `terms_hash`, criteria → `criteria_hash`.
3. Buyer signs `create_bounty` + `fund_bounty`: 100 USDC (+ verifier fee) moves to the order vault.
4. Seller signs `accept_bounty`, uploads files privately (multipart), API builds the salted
   manifest commitment.
5. Automated Level 1/2 validation runs, producing a report and a watermarked preview.
6. Seller signs `submit_deliverable(commitment)`.
7. Verifier downloads the evaluation input with a job-scoped token, runs checks, signs
   `submit_order_verification(result_hash, passed)` → `Attestation` PDA.
8. Buyer reviews preview + report within the review window; accepts or disputes.
9. `settle_order` pays seller 95, treasury 5, verifier its fee, writes `LicenseReceipt`.
10. Delivery service re-reads the chain, issues short-lived download tokens; buyer downloads.

## Acceptance policy
* Criteria are fixed at funding (hash on-chain). Amendments require a new order.
* Objective criteria are evaluated by the agreed verifier; a FAILED verdict lets the buyer
  request a correction (up to `max_corrections`) and then a refund.
* The review window defaults to 72h; silence means acceptance (seller protection).

## Dispute policy
* Buyer may dispute within the review window with an evidence hash (evidence files are
  uploaded privately and shared only with the dispute reviewer).
* Seller may add counter-evidence.
* Reviewer outcomes: request correction, full refund, full payment, or a split (bps).
* The full asset is never released to the buyer during a dispute; the reviewer gets
  access via an audited reviewer token.

## Prohibited content
Personal data without lawful basis, CSAM, malware, stolen or unlicensed data,
datasets designed for unlawful surveillance, sanctioned-party transactions.
