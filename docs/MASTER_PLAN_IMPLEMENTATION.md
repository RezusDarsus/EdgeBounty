# Master-plan implementation — October 17, 2026

The supplied [master plan](MASTER_PLAN_2026-10-17.md) is the strategic baseline. This document records implementation evidence and remaining work, rather than claiming the full production roadmap is live.

## Implemented

- 6% default commission, versioned quotes, 94% seller share, and no flat/minimum marketplace commission. Hosting uses $0.045 per started GiB-month with a $0.30 monthly floor; seller hosting and personal plans offer 1 or 3 months. Existing access periods are preserved.
- R2 and NVIDIA credentials imported as data into ignored backend configuration, with ignored private configuration backups. No keys are copied into the web environment or source files.
- Explicit `r2` storage mode, private S3-compatible access, `auto` signing region, and key routing that preserves existing local object references. S3 remains selectable; no existing S3 files are migrated or deleted.
- Browser uploads use three parallel part workers, per-part retries, resume, fresh per-part signed URLs, and signed Content-MD5 validated by R2. Part sizes grow to stay within 10,000 parts. Quota reservations include concurrent open uploads.
- R2 completion validates authoritative part sizes and final object size without fetching the whole dataset through the API. Full SHA-256 is explicitly labelled uploader-declared until a separately budgeted content scan checks it. This is transport validation, not independent content verification.
- Private Cloudflare Worker source and configuration, Range handling, backend entitlement revalidation, atomic requested-byte reservation, request replay rejection, and idempotent refund when storage lookup fails before streaming. No R2 dataset download body is proxied through EC2.
- Download accounting explicitly measures authorized byte ranges. It does not assert browser completion. Interrupted streams can consume the requested range; this limitation is disclosed in pricing.
- Bounded personal free storage. Separately prepaid, currently active marketplace hosting is excluded from personal committed-byte usage.
- USDC deployment mode validates configured mint, six decimals, and 6% on-chain fee. Bootstrap creates a separate mock-USDC ledger and data directory. A database identity binds currency, mint, genesis hash, and program to prevent relabelling balances.
- USDC-aware UI parsing, amounts and payment checks, with SOL still needed for network fees. Legacy SOL mode remains available for its original ledger.
- Existing escrow, submissions, acceptance, disputes, refunds and licensing are retained. A real local-validator bounty test verifies 100 mock USDC -> 94 seller + 6 treasury and rejects double settlement.
- Configurable Gemini image reviewer, structured responses, bounded requests and token usage. NVIDIA remains the configured MVP provider. Gemini is not live without its own key.
- Verification cache identity includes model, provider, prompt version and sampling configuration. Concurrent standalone requests reuse one job/invoice; processing credits are debited under an account transaction lock.
- Automatic whole-content materialization has a 256 MiB default budget, including model benchmarks. Oversized standalone requests are rejected before billing; quotes disclose execution eligibility. Large uploads remain supported independently of full-content analysis. Small materialized files are checked against declared SHA-256 before analysis.
- Live PostgreSQL 17 with pgvector 0.8.7, loopback binding, persistent Docker volume and separate application credentials. All 38 original public tables migrated with row-count and SHA-256 content verification; the embedded database was preserved.
- A dedicated PM2 verification worker consumes durable jobs; API indexing and housekeeping remain separate. Validators run without network access, as the host's non-root UID, with read-only inputs/root filesystem, isolated tmpfs, memory/CPU/PID limits and container cleanup on timeout/shutdown. Archives expand only in bounded scratch, with a 128 MiB aggregate extraction ceiling. Image and Python dependencies are pinned.
- NVIDIA text embeddings and pgvector similarity checks are enabled for paid L3 jobs when call budget remains. At most eight text prefixes (about 8 KiB total) are compared only within the owner's account, cached by immutable version/model/input hash. Reports label this as a heuristic; image/audio/video semantic similarity is excluded.
- Durable, deduplicated retention notices appear in the dashboard. Account-scoped listing and acknowledgement endpoints enforce ownership. Notices cover upcoming storage/hosting expiry and grace transitions.
- Observed S3/R2 SDK calls and gateway authorizations are available through `/admin/operations`. These counters do not claim to equal Cloudflare's billable totals; direct browser retries and failed requests require provider reconciliation.
- Daily AES-256-GCM encrypted PostgreSQL backups to private R2 and minute-by-minute database/chain/worker/disk monitoring are installed as systemd timers. Restore drills fetched the encrypted R2 object, authenticated/decrypted it, restored into a disposable database, and verified all 41 current public table counts. A separate local copy of the backup encryption key is saved in ignored `.data/operations/`.
- Revenue estimates include settled bounties and purchases with the fee and split locked on each order. R2 bandwidth costs are distinguished from still-unpriced Worker and object-operation charges. Unconfigured provider prices are identified as unknown.

## Verification evidence

- Live R2: write, HEAD, read, signed GET, direct signed multipart PUT and completion passed. Unsigned access returns an error. Only disposable healthcheck objects created by this run were deleted.
- NVIDIA: authenticated model-list request returned HTTP 200; configured vision and supplied text model were listed. A real synthetic-image inference also returned HTTP 200 with a nonempty answer (1,624 input tokens, 3 output tokens). An initial 30-second timeout was resolved by a bounded retry with a larger timeout.
- Local validator: `npx tsx scripts/usdc-e2e.ts` completed a 100 mock-USDC bounty, verified 94/6 balances and granted license, and rejected settlement replay.
- `tests/security/master-plan.test.ts` simulates a 500 GiB transfer using metadata-only mock parts; checks no object stream crosses the API; tests gateway quota concurrency/replay/refund, exact USDC units, model cache identity, and Gemini parsing.
- `npm run typecheck` passed. All 83 unit/security tests in 15 files and 10 Python validator tests passed. The updated Next.js production build passed on EC2. A live Docker probe verified archive input preservation, scratch/output permissions and timeout behavior.
- Live NVIDIA `nemotron-3-embed-1b` embedding returned 2,048 dimensions; a synthetic vector was inserted, compared and removed in PostgreSQL. The previously documented E5 endpoint returned 410 and was replaced before activation.
- Live L3 marketplace sale, exact 94/6 settlement, Worker byte ranges, exhausted-quota denial and no-charge result reuse passed after the PostgreSQL/worker migration and validator rebuild. Final integration order: `2Pry9GCiFXPKuWCK6hqcJBkbvDupYqAM93WRxoHcdnFF`.
- `scripts/usdc-marketplace-e2e.ts` passed against the public EC2 preview: wallet authentication, test faucet, direct R2 upload, paid L2 verification, listing publication, 100 mock-USDC purchase, denied delivery before settlement, 94/6 payout, exact Worker Range download, denied quota overspend, and fixture delisting. The live integration order is `5b9WHWRtBbncm2H8ZULtzxoX3k8qc9MntEbjcqhretV6`.

## Live demo and rollback

- Main website: https://13-61-207-211.sslip.io
- Main API health: https://api.13-61-207-211.sslip.io/health
- Preview alias: https://preview.13-61-207-211.sslip.io
- Worker: https://edgebounty-downloads.edgebounty-fbd88c7e.workers.dev
- Release directory: `/home/ubuntu/edgebounty-usdc-20261017-master`.
- Running PM2 services: `api-usdc`, `web-usdc`, `validator-usdc`, `verification-usdc`. The earlier SOL services were stopped after promotion; their source, ledger, database and PM2 definitions were preserved. `edgebounty-postgres` is a separate Docker container.
- Caddy backup: `/etc/caddy/Caddyfile.pre-usdc-20261017`. `bash scripts/rollback-usdc-demo.sh` restores the prior services and routes without deleting USDC state.
- Main health returned 200 with `chain: true`; config returned `currency: USDC`, `feeBps: 600`, `paymentReady: true`. Main-origin API preflight returned 204 with the correct allowed origin.
- This is mock USDC on a private test validator. It is not Circle-issued production USDC, Solana public devnet or mainnet.

## External configuration

1. R2 bucket CORS was applied with the subsequently supplied administrator credential. Browser OPTIONS preflight returned 204 and allowed the preview app origin. Runtime uses the original narrower object credentials; those intentionally cannot administer CORS. Add the actual app origin when changing deployments.
2. Cloudflare Worker deployed at `https://edgebounty-downloads.edgebounty-fbd88c7e.workers.dev`, with private R2 binding, staged API origin and shared secret. Deployment credentials are kept separately in ignored `.data/cloudflare-admin.env`. Strictly metered R2 downloads fail closed when the gateway is unavailable.
3. Gemini is deferred at the user's request; NVIDIA is the MVP provider. The optional Gemini image adapter remains implemented and mock-tested.

## Remaining production roadmap

The live environment remains a private test-chain MVP. PostgreSQL, Docker verification isolation, encrypted backups, restore drills and local monitoring are now deployed. Production mint/RPC selection, independent contract audit and production key custody remain launch work. No production funds were moved.

A separately provisioned large-file full-content verifier, audio/video content AI review, cross-modal semantic similarity, provider-billing reconciliation and the remaining commercial-growth roadmap are future work. Existing audio/video technical checks are retained; NVIDIA image review and bounded text similarity are live. Dedicated GPU training remains deferred by the plan. Upload support does not imply a 500 GiB quality scan is available on this 29 GiB host.

The validator now uses `--limit-blockstore-size 100000`; the obsolete flag was replaced after observing disk growth. The same genesis, accounts and program survived the restart, and free disk recovered from roughly 1.3 GiB to more than 4 GiB. Old ledgers were preserved. Monitoring writes `.data/operations/health.json` and systemd journal entries; no external alert destination has been configured.

## Operations

- `node scripts/configure-credentials.mjs --r2 PATH --nvidia PATH` imports credential documents without executing their contents or printing values.
- `npx tsx scripts/check-services.ts` checks private fixtures. Add `--configure-cors` only with bucket-administration credentials.
- `bash scripts/localnet-usdc.sh` starts an isolated persistent validator; `npx tsx scripts/usdc-bootstrap.ts` configures its mock-USDC application.
- `scripts/ec2-stage-usdc.sh` stages a separate release on API 4003, web 3003, RPC 8901. The original SOL release is preserved. It does not switch Caddy public routes.
- Restore configuration from the ignored `.data/config-backups` files only with the matching ledger and database. Never substitute USDC labels for legacy SOL balances.

## Provider references

Implementation follows [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/), [R2 Worker bindings and ranges](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), and [Gemini generateContent](https://ai.google.dev/api/generate-content). Multipart ETags are not treated as full-file SHA-256 hashes.
