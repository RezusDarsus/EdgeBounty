# EdgeBounty — implementation phase markers

Each phase is marked `✅ DONE` only when its completion criterion is met and its tests pass.

| Phase | Status | Completion criterion |
|---|---|---|
| 0 — Product validation & protocol design | ✅ DONE | One transaction explained from funding to delivery (`docs/product/requirements.md`) |
| 1 — Solana marketplace MVP | ✅ DONE | One end-to-end transaction works |
| 2 — Independent verification | ✅ DONE | Third-party verifier evaluates a private submission and gets paid |
| 3 — AI model marketplace | ✅ DONE | Buyer purchases a model backed by an independent performance report |
| 4 — Storage & verification business | ✅ DONE | Non-trading user buys verification / storage independently |
| 5 — Advanced marketplace | ✅ DONE | Selected advanced features implemented |

---

## ✅ PHASE 0 DONE — Product validation & protocol design

Deliverables:
- `docs/product/requirements.md` — customer group, reference transaction, acceptance & dispute policy
- `docs/protocol/protocol-spec.md` — accounts, state machine, payout math, commitments
- `docs/threat-model/threat-model.md` — threats, mitigations, test mapping
- `docs/economics/pricing.md` — pricing proposal and unit-economics tracking
- `docs/compliance/privacy-retention.md` — data minimisation & retention
- `docs/architecture/overview.md` — system architecture

Not done by code (needs humans): customer interviews with 5 buyers / 5 sellers.

---

## ✅ PHASE 1 DONE — Working Solana marketplace MVP

Completion criterion met: **one end-to-end transaction works** — and the blueprint §22
Definition of Done passes as an automated test against a real local validator
(`tests/end-to-end/definition-of-done.test.ts`): a buyer deposits 100 test USDC, a seller
submits a private dataset, an authorized verifier attaches an evaluation result on-chain,
the program settles exactly once, and the buyer downloads the dataset only after settlement.
The failed (correction → refund) and disputed (audited review → split) paths are tested too.

Built:
- `programs/edgebounty-marketplace` — Anchor 1.1 program: platform config (fee cap, pause,
  two-step admin), listings, purchases, funded bounties, USDC escrow vaults (PDA authority),
  submissions, verifier attestations, objective rejection/corrections, disputes (bounded
  resolver), settlement/refunds (exactly-once), license receipts, reputation, failure bounties,
  verification jobs, service receipts. **29 LiteSVM tests**.
- `packages/*` — shared types, zod schemas + canonical hashing + criteria evaluation,
  integer-only pricing engine, typed blockchain client.
- `apps/api` — Fastify API: Sign-In-With-Solana, pseudonymous profiles, private multipart
  uploads (resumable, per-part + whole-object checksums, quotas), salted manifest commitments,
  listings, bounties, orders, submissions, disputes, reviews, controlled previews, delivery
  service (fresh on-chain entitlement check, HMAC wallet-bound short-lived links), chain
  indexer + settlement crank, escrow reconciliation, audit log.
- `services/dataset-validator` — Level 1/2 technical validation with archive-bomb protection.
- `apps/web` — Next.js app: wallet login, marketplace, sell wizard, funded requests, order
  workspace (accept/submit/verify/review/dispute/settle/download), dashboards.

Verified in the browser: wallet connect → SIWS sign-in → faucet → bounty funded on-chain from the UI.

Test totals at this marker: 29 Rust · 11 package · 10 API security · 4 localnet e2e · 11 Python.

---

## ✅ PHASE 2 DONE — Independent verification prototype

Completion criterion met: **a third-party verifier evaluated a private submission and was paid
without being the seller or buyer** (`tests/end-to-end/phase2-verification.test.ts`):
the provider registers a profile (hash on-chain), is approved by the admin per capability,
gets job-scoped wallet-bound input access (buyer and outsiders refused), submits a report
whose hash it signs on-chain (Attestation PDA), and receives its 3 USDC fee at settlement.

Built:
- Verification job creation, quotes with hard budgets, `needs_authorization` stop on material workload change.
- Level 2 duplicate/near-duplicate/outlier/label-consistency analysis; Level 3 sampled AI relevance review
  (Claude, structured output, seeded sample, 95% Wilson interval, refusals counted as undetermined).
- Detailed reports separating confirmed / suspected / estimates / untested; report fingerprint.
- Provider registry + dashboard, provider-job market (on-chain VerificationJob), platform-as-provider
  certificates, random secondary audits with agreement tracking, conflict-of-interest exclusion,
  provider payment, verification-job disputes. Public attestation viewer + disclosed-report checker.

Honest gap: Level 3 was verified with an injected test client (aggregation, budget, refusals) —
no Claude API credentials were available on this machine to run it live. Set `ANTHROPIC_API_KEY` to enable.

---

## ✅ PHASE 3 DONE — AI model marketplace

Completion criterion met: **a buyer purchased a model supported by an independently generated
performance report** (`tests/end-to-end/phase3-models.test.ts`): the buyer attaches benchmark
criteria (accuracy ≥ 0.90 on the curated `eb-redblue-cls@1`) to the purchase, the platform
verifier runs the ONNX model in the sandbox (20/20 samples, accuracy 1.0, latency p50/p95),
posts the verdict on-chain, the order settles, and the buyer downloads byte-identical weights.

Built:
- Model listings (ONNX; SafeTensors header-only inspection), automatic static inspection on upload.
- `services/model-validator`: onnx checker, operator allow-list (default domain only, no custom ops,
  no external data), parameter count, IO schema; ONNX Runtime CPU benchmark with accuracy /
  precision / recall / F1 / confusion matrix / RMSE, latency percentiles, budget truncation.
- Curated, immutable, versioned benchmark library (admin) + private buyer benchmarks.
- Buyer-specified benchmark criteria on purchases; job budgets sized from the benchmark.
- Controlled inference previews: one input in, top-k scores out, sandboxed, 5/day/wallet, audited.
- Model-version certificates via attestations; web UI for trials and benchmark-gated purchases.
- Unsafe models (custom operators) are never executed; failed verdict → buyer refund (tested).

---

## ✅ PHASE 4 DONE — Storage and verification business

Completion criterion met: **a user who never buys or sells a marketplace item independently
purchased verification services** (`tests/end-to-end/phase4-business.test.ts`): exact quote →
invoice → on-chain `pay_service` (receipt PDA; a reference can never be paid twice; confirming
without a receipt is refused) → sandboxed L2 job → report, with actual cost metered.

Built:
- Standalone private analysis with preflight quotes and hard budgets (items, seconds, AI calls, spend);
  material workload changes stop the job at `needs_authorization` until the user re-authorizes.
- Storage subscriptions (7/30/90/365 days) paid on-chain; quota enforcement on upload; expiry
  lifecycle active → 14-day read-only grace → deletion of unprotected assets, oldest first; assets
  backing published listings, live orders, entitlements or open disputes are never deleted.
- Prepaid processing credits, usage metering endpoint, billing history; admin unit-economics view.
- Incomplete-upload purge; hourly housekeeping loop.

---

## ✅ PHASE 5 DONE — Advanced marketplace

Completion criterion met: the advanced features below are implemented and pass end-to-end against
localnet (`tests/end-to-end/phase5-advanced.test.ts`, 6 scenarios) plus new program tests.

| Feature | How | Proof |
|---|---|---|
| Development milestones | `Order.designated_seller`: milestone n+1 binds the developer of milestone n | e2e + LiteSVM `designated_seller_binds_milestone_orders`; UI "Fund next milestone" |
| Multi-seller bounties | N escrowed slots funded together, each taken by a different seller | e2e (3 slots, 3 sellers) |
| Independent dispute-resolution providers | `Order.arbitrator` agreed at funding, bounded like the platform resolver | e2e + LiteSVM `agreed_arbitrator_resolves_only_its_own_orders`; UI ruling panel |
| Advanced encrypted delivery | browser AES-256-GCM (chunked) + NaCl box key envelope to a buyer-generated key; platform holds ciphertext only | e2e round-trip decrypts byte-identical plaintext; release refused before settlement |
| Structured-data benchmarks | tabular classification/regression (accuracy, F1, RMSE) | `test_tabular.py` |
| Audio & video evaluations | WAV signal checks (duration, rates, silence, clipping); MP4/MOV container parsing | `test_media.py` |
| Custom evaluation datasets | private buyer benchmarks + immutable curated library | Phase 3 e2e |
| Contributor reputation | on-chain `verified_contributions` from failure bounties | e2e asserts it |
| Automated failure-bounty verification | platform re-runs the committed ONNX model on contributed inputs; pays only failures | e2e (1 accepted & paid, 1 rejected) |
| Organization accounts | orgs, members, shared order/spend view | API + dashboard |
| Enterprise API integration | scoped API keys (read / upload / verify), never admin | e2e scope test |
| Multiple competing providers | open on-chain jobs, any approved provider with the capability may take them | Phase 2 e2e |

## Final test totals
31 Rust (LiteSVM) · 42 TypeScript (packages, API security, L3, 7 localnet e2e suites) · 14 Python.

## Honest gaps (not done, or not verifiable on this machine)
- ~~Level 3 AI review untested live~~ → **now live on NVIDIA**: images judged by `meta/llama-3.2-11b-vision-instruct`, plain-English report explanations by `nvidia/nemotron-3.5-lightning-30b-a3b` (`AI_PROVIDER=nvidia`; Anthropic remains supported). Verified by `tests/integration/nvidia-l3.test.ts` and `tests/end-to-end/l3-nvidia-pipeline.test.ts`.
- **Docker sandbox mode** (`SANDBOX=docker`, required in production) is written but was not executed: Docker Desktop was not running. Dev runs used the scrubbed-environment process sandbox.
- **R2/S3 storage driver** is implemented but untested against a real bucket (local driver used).
- **Not deployed to devnet/mainnet; not audited.** Follow `docs/architecture/deployment-runbook.md`.
- Blueprint items marked optional/research and **not** built: tokenized/transferable licenses, verifier staking & slashing,
  a fully decentralized dispute system, multi-verifier consensus, Solana Attestation Service mirroring (native attestation PDAs are used).
- Audio/video checks are container/signal-level only (no codec decoding, no content relevance).
- Encrypted delivery needs the seller to come back after settlement to release the key (disclosed in the UI).
- Phase 0 customer interviews and §20 commercial validation need people, not code.
