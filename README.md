# EdgeBounty

Solana-native marketplace for AI datasets, models, funded development work and independent
verification. Buyers escrow USDC, sellers deliver privately against fixed criteria, verifiers
sign attestations, and a Solana program settles exactly once — while the assets stay private.

**Status:** October 17 master-plan update implemented and tested in parts, including 6% commission,
R2 direct uploads, gateway source, and isolated mock-USDC settlement. See
[implementation evidence and remaining work](docs/MASTER_PLAN_IMPLEMENTATION.md).
The full production roadmap is not live. Not audited; not for mainnet funds.

## Layout

```
programs/edgebounty-marketplace   Anchor 1.1 program (escrow, orders, disputes, attestations, …) + LiteSVM tests
packages/blockchain-client        typed TS client (PDAs, instruction builders, decoders)
packages/verification-schemas     zod schemas, canonical hashing, criteria evaluation, client-side crypto
packages/pricing-engine           integer-only pricing (mirrors on-chain payout math)
packages/shared-types             enums & constants
apps/api                          Fastify API: auth, uploads, marketplace, delivery, verification, indexer
apps/web                          Next.js app
services/dataset-validator        Python L1/L2 dataset checks (images, tabular, audio, video, archives)
services/model-validator          Python ONNX inspection, sandboxed benchmarks, inference trials
tests/                            end-to-end (localnet), security
docs/                             protocol spec, threat model, pricing, privacy, runbook
```

## Run it locally (Windows + WSL, or Linux)

The earlier wallet, publishing, request, and SOL payment flows are documented in
[approved-marketplace-flows](docs/approved-marketplace-flows.md). Those historical flows require a
wrapped-SOL platform. Keep its ledger and database with its matching release. The new USDC mode uses
a separate environment and refuses to relabel existing financial data.

For the new USDC demo, use `bash scripts/localnet-usdc.sh`, then `npx tsx scripts/usdc-bootstrap.ts`.
This creates a separate mock-USDC chain/database and preserves the SOL environment. Run
`npx tsx scripts/usdc-e2e.ts` to verify 94/6 bounty settlement and replay rejection. Runtime private
configuration stays in ignored `apps/api/.env`; Cloudflare deployment credentials stay in ignored
`.data/cloudflare-admin.env`. Deploy the Worker before enabling metered R2 downloads.

Prerequisites: Node 26+, Python 3.12+, Rust/Solana 3.x/Anchor 1.1 (in WSL on Windows).

```bash
npm install
python -m venv .venv && .venv/Scripts/pip install pillow numpy pyarrow onnx onnxruntime
```

```bash
wsl -d Ubuntu -- bash -l scripts/build-program.sh all
```

```bash
node scripts/sync-idl.mjs
```

Start the validator (keep it running in its own terminal):

```bash
wsl -d Ubuntu -- bash -l scripts/localnet-usdc.sh
```

Bootstrap the platform (mock USDC, treasury, approved platform verifier, env files):

```bash
npx tsx scripts/usdc-bootstrap.ts
```

```bash
npx tsx apps/api/src/server.ts
```

```bash
npm run dev -w @edgebounty/web
```

Open http://localhost:3000, click **Sign in with wallet**, choose **Dev Burner (localnet)**,
then *Get test funds* for 2 test SOL and 1,000 mock USDC. Real wallets (Phantom, Solflare, Backpack) work through
Wallet Standard. The burner exists only when `NEXT_PUBLIC_DEV_BURNER=1`.

## Tests

```bash
wsl -d Ubuntu -- bash -l scripts/build-program.sh test
```

```bash
npx vitest run
```

```bash
cd services/dataset-validator && ../../.venv/Scripts/python -m unittest
```

End-to-end suites (`tests/end-to-end`) run against the local validator and skip when it is down.

## What is (and isn't) trustless

The program enforces escrow, deadlines, exactly-once payouts, bounded dispute power and fee caps.
Delivery of private files is done by an accountable off-chain service; attestations prove *who said
what about which commitment*, not that it is true. See `docs/threat-model/threat-model.md`.
