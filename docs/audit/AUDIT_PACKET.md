# Independent audit packet

Prepared October 18, 2026 for an external Solana security reviewer. Internal tests and assistant review are **not** an independent audit; this packet only makes the review faster and reproducible. Do not send credentials, private keys or `.data/` contents to the auditor.

## Scope

On-chain (`programs/edgebounty-marketplace`, Anchor 1.1.2, Rust 1.89.0):

- Platform config, two-step admin transfer, pause, treasury changes, upgrade-authority-bound initialization.
- Listings, purchases, bounties (single, milestone and parallel slot orders), deliverables, verification verdicts, attestations and revocation.
- Escrow vaults, settlement, refunds, dispute opening/evidence/resolution with basis-point splits.
- Failure bounties (per-example rewards), standalone verification jobs and their disputes, single-use service payment receipts.
- All token account / mint / PDA constraints and CPI transfers (`util.rs`: `mul_bps`, `vault_transfer`, `close_vault`).

Off-chain (in scope as integration points): SIWS login (`apps/api/src/auth/siws.ts`), payment reconciliation and indexer (`apps/api/src/services/indexer.ts`), R2 signing and the download Worker (`apps/api/src/storage`, `infrastructure/cloudflare/download-worker.mjs`), credit billing (`apps/api/src/lib/billing.ts`), Docker validator isolation (`apps/api/src/services/sandbox.ts`) and operational key loading (`apps/api/src/chain.ts`).

## Reference documents

- Protocol: [protocol-spec.md](../protocol/protocol-spec.md)
- Threat model: [threat-model.md](../threat-model/threat-model.md)
- Launch register and known findings: [PRODUCTION_LAUNCH.md](../PRODUCTION_LAUNCH.md)
- IDL: `target/idl/edgebounty_marketplace.json` (copied to `packages/blockchain-client/src/idl/`)

## Reproducible build

```bash
wsl -d Ubuntu -- bash -l scripts/build-program.sh all
sha256sum target/deploy/edgebounty_marketplace.so target/idl/edgebounty_marketplace.json
```

Program ID (test deployments): `6L6441Vus4rUdQXLiGfFtXUtRWbjqg3Lk1AfCjj6x3E`. A mainnet deployment will use a new program keypair. Before sign-off, rebuild with `solana-verify build` and record the verified hash for the exact source revision handed to the auditor.

Hashes of the build that produced the evidence below (local `anchor build`, not yet a verified build):

| Artifact | SHA-256 |
|---|---|
| `edgebounty_marketplace.so` | `f9a3b6d2a4be4a5769222e66a7fdf505d8a60e3e9857de053b7c6664d3b1e7ec` |
| `edgebounty_marketplace.json` (IDL) | `469ba538e7ba2b9787e341a35c073557449c348a712dd2ac35966589397e7a60` |

## Internal evidence

- 33 Rust tests (LiteSVM), including `initialization_requires_upgrade_authority` and `immutable_program_cannot_be_initialized`.
- Fresh `solana-test-validator` with `--upgradeable-program`: a funded stranger's `initialize_platform` failed with `NotUpgradeAuthority` (0x1790) and left no config; the end-to-end chain flow then initialized with the upgrade authority and passed.
- Live mock-USDC flows on the private validator (see [MVP_ACCEPTANCE.md](../MVP_ACCEPTANCE.md)).

## Questions for the auditor

1. Are dispute `seller_bps` splits and verifier-fee refunds exact under every rounding path?
2. Can any order state be settled or refunded twice through a different instruction sequence (order vs. job vs. failure-bounty paths)?
3. Is the pause semantics (block new commitments, allow exits) complete?
4. Is the upgrade-authority binding sufficient once the upgrade authority becomes a multisig, and what is the recommended authority hand-off for the initial deploy → multisig transfer?
