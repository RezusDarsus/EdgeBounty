# EdgeBounty deployed MVP operations

Website: https://13-61-207-211.sslip.io

This deployment uses mock USDC on a private Solana validator. Never point its database at another genesis, currency or mint. Gemini is deferred; NVIDIA is configured for MVP verification.

## Services

Release: `/home/ubuntu/edgebounty-usdc-20261017-master`.

- PM2: `api-usdc`, `web-usdc`, `validator-usdc`, `verification-usdc`.
- Docker: `edgebounty-postgres`, PostgreSQL 17/pgvector, bound to loopback port 5433. Persistent volume: `edgebounty_pgdata`.
- Readiness: `https://api.13-61-207-211.sslip.io/health/ready` checks database, chain and worker heartbeat.
- `systemctl list-timers 'edgebounty-*'` shows daily backup and minute readiness timers. Failures and disk warnings are local journal/JSON records, without external notifications.
- Wallet-authenticated `/admin/operations` returns observed object-operation counters and gateway authorizations. Cloudflare's bill remains authoritative for billable attempts and retries.

## Backup and recovery

Run `npx tsx scripts/database-backup.ts --restore-drill` from the release directory. It creates an encrypted private R2 backup and restores a fetched copy into a disposable database, verifies table counts, then drops only that disposable database. The live database is never overwritten. Run during a quiet window; concurrent writes can cause count comparison differences.

Encrypted backups live under `operations/backups/` in the private R2 bucket. The key is separate: server `DATA_DIR/operations/backup-encryption.key`, with a local ignored copy at `.data/operations/backup-encryption.key`. Keep this key separately from object storage; losing all key copies makes backups unrecoverable. PostgreSQL backups do not replace Solana ledger/key custody or R2 object retention.

The original embedded database remains at `.data/usdc/db`; the offline migration snapshot/config are in `.data/operations/pre-postgres-20261017T180134Z`. They represent migration-time state, not subsequent writes. Do not switch to them after new transactions without reconciling later state.

## Verification boundaries

R2 multipart uploads and paid Worker downloads bypass the API data plane. A simulated 500 GiB transfer checks the control flow; no real 500 GiB transfer was purchased for testing.

Full-content validation is capped at 256 MiB on this host. Quotes disclose eligibility, and oversized standalone requests fail before billing. Large model training and full 500 GiB scans require separately provisioned capacity. ZIP expansion is restricted to isolated tmpfs with a 128 MiB aggregate extraction budget. Reports distinguish uploader-declared hashes, server-verified content and sampled AI conclusions.

NVIDIA image relevance is sampled. Text similarity uses `nvidia/nemotron-3-embed-1b`, 2,048-dimensional pgvector values, at most eight text prefixes and account-private comparisons. Similarity suggests overlap; it is not plagiarism proof or a complete corpus scan.

## Safe maintenance

Stop API and worker before an offline database migration. Preserve deployment identity and all payment records. The logical migration verifies every source public table before committing. Application database credentials live in ignored private configuration.

Do not rerun `usdc-bootstrap.ts` on this live database: bootstrap is for a new isolated deployment and rewrites database selection. The previous SOL release and rollback script remain available, with separate ledgers and databases.
