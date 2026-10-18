# Collaborative bounty release — October 18, 2026

Authorized scope: finish the collaboration workflow, retain the latest design/pricing changes, merge/push Git branches, and update the existing live site. This release targets the existing private-validator/mock-USDC deployment, not Mainnet or real-money operations.

## Release contents

Independent logical seller agents, structured proposals, expiring/partially fulfilled work reservations, private verifier evidence, cross-seller exact/near duplicate handling, buyer-authorized image inspection, revocation/withdrawal, shared SSE progress, immutable gross allocations, and an existing-contract settlement workflow. The parent is reserved with an unsignable program PDA; after final acceptance, explicit cancellation/refund and designated contributor funding replace direct multi-recipient payout. Accepted-only verified bundles, normal buyer approval, settlement replay protection and licensed private delivery remain enforced.

No Anchor program upgrade is required. Existing mint, genesis, treasury, database identity, 600-bps commission and credentials must remain unchanged. The configuration switch enables collaborative creation; each request still opts in. A separate small fix allows the confirmation-time tolerance needed to publish newly purchased monthly hosting, without extending hosting or changing its price.

## Validation evidence

- Full JavaScript suite with an isolated local validator available: **161 passed, 3 skipped**. Environment-dependent optional provider/PostgreSQL tests are not represented as passing by those skips.
- Final focused collaboration/security/real-image/settlement suites: **20 passed**.
- Existing contract Rust suite: **33 passed**, unchanged program source.
- Python validators: **10 dataset + 5 model tests passed**.
- API and frontend TypeScript checks and production Next.js builds passed.
- Independent PostgreSQL pools in a disposable database passed claim/duplicate races, transaction rollback, repeated delivery, authenticated live SSE notification and cursor recovery. That database was removed after the probe.
- Private R2 put/stat/read/range and interrupted-multipart abort passed using generated probe content; the probe objects were removed.
- The staged network-disabled/read-only/non-root Docker validator reports version 1.5.0, produces private per-image evidence and detects exact duplicate images.
- The real-file end-to-end flow exercises paid verification, scoped inspection, parent reservation/cancellation, three designated contributor escrows, exact final-bundle matching, licensed downloads and rejected repeated settlement on an isolated local validator. It does not move real funds on the public deployment.

Old validator-only suites were corrected to pay the current storage/hosting policy and explicitly distinguish legacy third-party/manual escrow fixtures from new platform-verifier policy. Safety checks and prices were not weakened to make fixtures pass.

## Promotion and recovery

Frontend release directory: `/home/ubuntu/edgebounty-web-20261018-collaboration`, PM2 `web-collaboration`, loopback port 3012. API/worker runtime directory remains `/home/ubuntu/edgebounty-usdc-20261017-master`; API port 4003, PM2 `api-usdc` and `verification-usdc`. Validator/RPC and private storage routing remain in place.

The promotion process backs up database, API/package/validator source, private environment, PM2 state, Caddy and the previous validator image under `/home/ubuntu/backups/pre-collaboration-20261018-r2` (the successful retry; the first attempt retained its own backup). It builds the exact committed source snapshot, verifies the staged frontend, stops API/worker writes, applies additive migration `0009_collaboration` once, switches the validator image, restarts services, and only then promotes web traffic after readiness and financial-configuration checks.

Rollback is prepared as `rollback.sh` in that backup directory and syntax-checked. It restores code/routes/image and retains the denial/revocation guard for already-issued image-inspection tokens. It does **not** rewind the database or chain. Existing additive tables remain. Old frontend/source and its process entry are retained for recovery.

The public release identities are exposed at [web revision](https://13-61-207-211.sslip.io/api/release) and [API revision](https://api.13-61-207-211.sslip.io/health/release); they must match the merged Git revision. [Readiness](https://api.13-61-207-211.sslip.io/health/ready) verifies database, chain and worker. Promotion writes the observed before/after configuration and release/health results to the private backup directory; Git publication alone is not evidence of successful promotion.

## Remaining external gates

This is still the existing mock-USDC private-validator environment. Mainnet promotion, independently commissioned audits, production signer custody and final operator/legal approvals are not claimed. Full unbounded load and archived-image review mapping are separate scale/workflow extensions; the implemented UI uses individual image files. The implementation/API/migration details and reproducible demonstration instructions are in [COLLABORATIVE_BOUNTIES.md](../COLLABORATIVE_BOUNTIES.md).
