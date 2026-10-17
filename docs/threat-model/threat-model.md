# EdgeBounty threat model (v1)

Scope: on-chain program, API, storage, delivery service, verification workers, indexer, web app.
Method: assets → actors → attacks → mitigations → where it is tested.

## Assets
* Escrowed USDC (order, failure-bounty and job vaults).
* Private datasets/models (pre-settlement), salts for commitments.
* Delivery entitlements and download tokens.
* Verification integrity (reports, attestations).
* Session tokens, API secrets, storage credentials.

## Actors
Buyer, seller, verifier, contributor, admin/dispute authority, anonymous internet user,
compromised worker, malicious uploaded file.

## Smart contract

| Threat | Mitigation | Test |
|---|---|---|
| Unauthorised withdrawal | Vault authority is the Order PDA; payouts only in terminal transitions | `security_*` tests |
| Wrong mint / fake token account | `token::mint = config.payment_mint`, owner checks on every destination ATA | `rejects_wrong_mint` |
| PDA confusion | Distinct seed prefixes per account type, ids are `u64 LE` | — |
| Duplicate settlement | Terminal state + vault closed in the same instruction | `settle_twice_fails` |
| Fake verifier | Verifier must be the `Provider` PDA's authority, `approved == true`, and named in the order at funding | `unapproved_verifier_rejected` |
| Self-dealing / conflict | buyer ≠ seller ≠ verifier enforced | `conflicted_verifier_rejected` |
| Deadline manipulation | Only `Clock::unix_timestamp`; windows fixed at funding | `deadline_*` |
| Overflow | `checked_*` math, `u128` intermediates, `overflow-checks = true` in release | `payout_sums_exact` |
| Fee escalation | `fee_bps` locked per order at funding; `MAX_FEE_BPS` constant | `fee_locked_at_funding` |
| Dispute privilege escalation | Resolver can only split buyer/seller and only from `Disputed` | `resolver_cannot_settle_undisputed` |
| Unprotected upgrades | Upgrade authority = multisig (Squads) on mainnet; documented in deployment runbook | ops |
| Admin key loss | Two-step admin transfer (`propose_admin` / `accept_admin`) | `admin_transfer` |
| Paused protocol traps funds | Pause blocks only new commitments | `pause_allows_exit` |

## Storage & delivery
* Unpredictable object keys (UUIDv4 + random) **and** authorisation on every request.
* Download tokens: HMAC-SHA256, bound to (order, file, wallet), 10-minute expiry, single version.
* Delivery requires indexer-confirmed `Settled` state with `seller_bps > 0` **and** a
  fresh on-chain re-read (not a browser callback).
* Uploads: max size per file/plan quota, multipart with per-part SHA-256, incomplete
  uploads purged after 24h.
* Archives: entry count limit, total uncompressed limit, ratio limit (zip-bomb),
  path-traversal rejection, no symlinks.
* Buckets private; no public ACLs; separate credentials per service.

## Verification workers
* Run untrusted inputs in a separate process with no secrets in env; in production
  inside Docker with `--network none --read-only --pids-limit --memory --cpus`,
  non-root user, tmpfs scratch, wall-clock timeout (see `infrastructure/docker`).
* ONNX only, operator allow-list, no custom ops, no pickle formats.
* Output size limit; results are JSON validated by schema before persistence.

## API / auth
* Sign-In-With-Solana: server nonce (single-use, 5 min), domain binding, expiry,
  ed25519 verification; session JWT (HS256, 12h) — never private keys.
* Rate limiting per IP + per wallet; CORS allow-list.
* Admin endpoints require a wallet in `ADMIN_WALLETS`; every admin action → `audit_events`.

## Marketplace fraud
* Self-trading: buyer ≠ seller on-chain; reputation counts distinct counterparties and
  volume separately from count.
* Verifier collusion: conflict exclusion, random secondary audits (`audit_sample_rate`),
  re-run of sampled evaluations, provider dispute history displayed.
* Stolen data: license evidence field, takedown flow, seller attestations, moderation queue.

## Residual risks (disclosed)
* Previews can leak value. Delivery is operated by an accountable off-chain service — the MVP
  is **not fully trustless**. Attestations prove who said what, not that it is true.
