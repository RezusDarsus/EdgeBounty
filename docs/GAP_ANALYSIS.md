# EdgeBounty 2.0 gap register

Follow-up update: [MASTER_IMPLEMENTATION_STATUS.md](MASTER_IMPLEMENTATION_STATUS.md) records the implemented AI conversation/metadata/report flows, durable limits/cache, auth/invoice fixes, ClamAV publication gate and new verification evidence. The original inventory below describes the earlier pass and is retained as audit history.

Audit date: 2026-10-18. WORKING means directly tested within the stated local scope, not production approval. PARTIALLY IMPLEMENTED means source exists with material coverage/operation gaps. UNVERIFIED means not exercised in this run. Prior reports are linked rather than reasserted as new results.

| Capability | Classification | Evidence / remaining work |
|---|---|---|
| Next.js routes, shared tokens/components | PARTIALLY IMPLEMENTED | Existing app and design-system preview; new desktop/mobile smoke captures recorded separately. Full route/a11y certification remains open. |
| Catalog search, filters, sorts, pagination | PARTIALLY IMPLEMENTED | Existing API/UI; unit/security tests exercise server ranking. Live catalog requires matching chain config. |
| Listing details, versions, licenses, seller profiles | UNVERIFIED | Source routes/components present; fresh authenticated browser journey not run. |
| SIWS and session authorization | PARTIALLY IMPLEMENTED | Existing integration/security tests; localStorage XSS and revocation model require review. |
| R2/S3 authorization and Worker | PARTIALLY IMPLEMENTED | Existing private storage/control tests; fresh remote CORS, bucket policy and real transfer checks not run. |
| Malware scanning/quarantine | NOT IMPLEMENTED | Format/archive controls are not a malware scanner. Define quarantine/scanner/release policy before production uploads. |
| 6% integer pricing and reconciliation | PARTIALLY IMPLEMENTED | Existing pricing/security coverage; fresh on-chain settlement not executed here. |
| Anchor escrow, mint checks, refunds, replay | UNVERIFIED | Rust source and historical evidence; no program changes or validator run in this change. Independent audit/custody still blocking Mainnet. |
| Bounty creation/submission/review/disputes | PARTIALLY IMPLEMENTED | Existing API/UI and test suites; chain/browser journey requires isolated validator. |
| Deterministic verification and caching | PARTIALLY IMPLEMENTED | Existing validators/spec identity/budget controls; full large-file coverage is capped. |
| NVIDIA/Gemini provider adapters | PARTIALLY IMPLEMENTED | Existing review adapters; live requests intentionally not made. Gemini production activation is deferred. |
| Discovery helper | WORKING | New public-metadata query, explanations and privacy/validation regression test; explicitly keyword-based. |
| Bounty drafting helper | PARTIALLY IMPLEMENTED | New schema-bounded NVIDIA request and human-review UI; mocked provider tests; disabled until budget approval. |
| Metadata agent | NOT IMPLEMENTED | No new autonomous file analysis or metadata-writing agent claimed. Existing seller-entered metadata remains. |
| Verification agent | PARTIALLY IMPLEMENTED | Existing job orchestration/report explanation; no autonomous payment authority. |
| Global agent spend controls/cache | NOT IMPLEMENTED | Per-wallet in-memory rate limit and one bounded call are insufficient across replicas/restarts; durable quotas/dedup needed before activation. |
| Provider billing reconciliation | PARTIALLY IMPLEMENTED | Existing cost counters/Cloudflare analytics source; no fresh invoice reconciliation. |
| Legal operator terms/privacy | NOT IMPLEMENTED | Requires real entity/contact/policy inputs; do not invent. |
| Staged release | UNVERIFIED | Existing procedures; no deployment authorized or performed in this run. |

## Threat review priorities

P0 launch gates: independently audit exact deployed binary/source; production signer custody and upgrade authority; verify intended USDC mint/chain; isolated database identity; exit/refund procedures. Source initialization-authority remediation is already present in the user's working tree and is not attributed to this change.

P1: hostile-file quarantine/malware controls, worker-host separation, session XSS/revocation, durable AI quotas and idempotency, secret-safe error logging, entitlement/indexer race tests, backup restore and external alert receipt confirmation. Paid drafting remains off until durable cost controls and budget are accepted.

P2: full keyboard/screen-reader/contrast audit across authenticated views; listing metadata agent; load/performance SLO evidence; legal policy completion; provider-specific live staging tests.

See `threat-model/threat-model.md`, `PRODUCTION_LAUNCH.md`, `audit/AUDIT_PACKET.md` and `MASTER_PLAN_IMPLEMENTATION.md` for existing detailed evidence and risks. Historical operational claims must be rechecked against the release target before deployment.
