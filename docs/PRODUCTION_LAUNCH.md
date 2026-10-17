# Production launch work register

Status: preparation in progress; test-chain deployment remains active. No mainnet deployment or independent audit has been completed.

## Independent audit handoff

Scope includes all Rust instructions/accounts, CPI/token account constraints, initialization, admin/upgrade transfers, escrow settlements/refunds, disputes and verification trust. Off-chain scope includes SIWS, payment reconciliation, R2/Worker authorization, credit billing, Docker isolation and key custody.

Known findings to resolve before launch:

1. `InitializePlatform` currently accepts the first signing administrator without binding that signer to the program upgrade authority. Deploying then immediately initializing is not an adequate security control. Require an authority-bound initializer and negative tests for initialization takeover; preserve an upgrade/migration strategy for existing test deployment accounts.
2. `ChainService` currently loads JSON operational signing keys from environment variables. Implement an agreed remote signer/KMS design for verifier/crank; administrator, treasury and dispute authorities must use the selected multisigs and documented recovery owners.
3. API and verification orchestration share the MVP host. Production needs separate worker-host isolation; Docker process isolation alone is not host separation.
4. Audit report, remediation evidence and retest must refer to the exact source revision and deployed binary hash. Internal tests and assistant review are not an independent audit.

Source evidence: 31 Rust tests, 83 unit/security tests, 10 Python tests and live mock-USDC flows are recorded in `MVP_ACCEPTANCE.md`. Include protocol spec, threat model, IDL, reproducible build instructions, deployment configuration with secrets removed, and final binary/source hashes in the auditor packet. Do not share credentials or private keys.

## Mainnet prerequisites

Obtain the production RPC credential file, deployment SOL budget, domain, administrator/upgrade/treasury/dispute multisig addresses and selected signing service. Provision a new PostgreSQL database and deployment identity; never relabel or migrate mock balances into genuine USDC balances. Verify genuine USDC against Circle's published mint and verify six decimals on-chain. Stage and review transactions before broadcasting. Preserve exit/refund behavior when paused. Define initial value/exposure limits and incident owners before activation.

## Operations acceptance

- External alert destination and credentials supplied and authorized; send a clearly marked test alert and confirm receipt.
- Load tests cover authenticated upload control, billing, database concurrency, indexer lag and download authorization, with agreed SLOs. `scripts/load-readiness.mjs` is only a bounded readiness probe.
- Restore PostgreSQL and private object fixtures into isolated targets; compare content hashes and access control. Restore signer access through the selected custody service without exporting production private keys. Reconcile restored database order state against mainnet, never roll back the chain.
- Prove RPC failover, stale-worker detection, missed-backup alerts, low-disk alerts and pause/incident procedures.
- Separate production infrastructure credentials and secrets from the demo.

## Business details required

Legal entity/name, jurisdiction, support and privacy contacts, domain, tax treatment and customer eligibility. Prepare terms, privacy/data-rights disclosures, takedown and dispute procedures around the actual operator and custody model. Qualified review is required to finalize jurisdiction-specific obligations; no legal approval is claimed by this repository.

## Authoritative technical references

- https://solana.com/docs/programs/deploying
- https://solana.com/docs/programs/verified-builds
- https://help.circle.com/support/en/usdc-supported-blockchains-minting-redemption-faqs?id=kb_article_view&sysparm_article=KB0010590
