# Deployment runbook (devnet → mainnet)

## Program
1. `wsl -d Ubuntu -- bash -l scripts/build-program.sh all` — build + 31 LiteSVM tests must pass.
2. Devnet deploy: `solana program deploy target/deploy/edgebounty_marketplace.so --program-id keys/edgebounty_marketplace-keypair.json -u devnet`.
3. **Initialize in the same session right after deploy** (`initialize_platform` is first-come; if anyone
   front-runs it, redeploy to a fresh program id). Use the real USDC mint on mainnet
   (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) and a treasury owned by the treasury multisig.
4. Transfer the upgrade authority to a Squads multisig: `solana program set-upgrade-authority <id> --new-upgrade-authority <squads vault>`.
5. Set `dispute_authority` to a separate multisig (or an independent arbitration provider) via `update_config`;
   transfer `admin` with `propose_admin` → `accept_admin` from the admin multisig.
6. Mainnet only after a professional audit, a bug bounty and a staged TVL cap (pause switch documented).

## Off-chain
* API: Postgres (`DATABASE_URL`), R2 (`STORAGE_DRIVER=s3`), real `JWT_SECRET` / `DOWNLOAD_TOKEN_SECRET`
  (config refuses dev defaults in production), `SANDBOX=docker` (enforced in production).
* Build the sandbox image: `docker build -f infrastructure/docker/validators.Dockerfile -t edgebounty/validators:latest .`
* Run sandbox workers on dedicated hosts (they need the Docker socket); never on the API's public hosts.
  When the API itself runs in a container, `DATA_DIR` must be a host path mounted at the same location so
  the sandbox bind mounts resolve.
* Platform keys (`PLATFORM_VERIFIER_KEY`, crank) belong in a KMS/HSM; the dispute authority should only
  propose transactions to its multisig.
* Indexer: one instance per environment (idempotent; safe to restart). Orchestrator: scale horizontally
  (optimistic job claiming).

## Backups & retention
Daily Postgres backups (30-day retention), R2 object versioning off for private uploads (deletion must be
real), audit events kept 1 year, purchase/delivery records 7 years.
