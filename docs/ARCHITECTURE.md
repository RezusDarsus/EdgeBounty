# Architecture audit — 2026-10-18

This is an incremental audit of the existing, dirty working tree. Previous deployment reports are historical evidence, not confirmation of current remote runtime state. No existing user changes were reverted. No production migration or deployment was performed in this run.

## Verified source layout

| Area | Implementation |
|---|---|
| Frontend | Next.js App Router 16.4 installed, React 19, Tailwind 4, wallet adapters, `next/font`; `apps/web/src/app` |
| API | Fastify, Zod validation, Drizzle queries, per-wallet/IP limits; `apps/api/src/app.ts` registers route modules |
| Persistence | PostgreSQL through node-postgres in production; PGlite for development/tests. `createDb` applies Drizzle migrations automatically on startup. |
| Chain | Anchor Rust program; typed instruction builders, IDL and PDAs in `packages/blockchain-client`; backend indexer/reconciliation |
| Storage | Local or S3-compatible private objects, explicit R2 mode, signed multipart uploads; Cloudflare download Worker with entitlement revalidation |
| Verification | Durable jobs, Python dataset/model validators, Docker/process sandbox; sampled NVIDIA and optional Gemini image review, semantic duplicate heuristics |
| Economics | Integer pricing engine, six-decimal USDC mode, 600 basis-point commission, immutable deployment identity |
| Operations | EC2/Caddy/PM2 procedures, Docker configuration, backup and health timers; historical deployment evidence in `MASTER_PLAN_IMPLEMENTATION.md` |

## Route inventory

Public pages include `/`, `/datasets`, `/models`, `/listings/[id]`, `/profile/[wallet]`, `/bounties`, `/providers`, `/pricing`, `/how-escrow-works`, `/help`, `/developers`, license and attestation pages. Wallet-gated pages include selling, verification, storage, bounty creation, dashboard and order workflows. Administrator actions use backend authority checks, not only hidden UI.

API modules cover auth/challenge/verify, assets/versions/uploads, listings/purchases, bounties/orders/submissions/reviews/disputes, delivery/licenses, verification/jobs/quotes, storage/credits/billing, organizations, notifications, infringement, collections/analytics/API keys and administrators. New `/agents/capabilities`, `/agents/discovery` and `/agents/bounty-draft` endpoints isolate discovery and optional drafting from financial actions.

## Trust boundaries

1. Wallet signatures prove control of an address. Single-use server challenges bind domain and expiry; JWT sessions last 12 hours. Browser tokens currently use localStorage (residual XSS exposure).
2. Browser-signed transactions are proposals. Chain confirmation/reconciliation determines financial state and entitlement. Currency/mint/genesis/program identity prevents relabeling an old ledger.
3. R2 is private. Upload metadata is not proof of content truth. Direct multipart completion validates sizes; supplied full hashes remain uploader assertions until materialized checks run.
4. Download capabilities are short-lived and wallet-bound. Worker range accounting tracks authorized bytes, not confirmed receipt. R2 bulk bodies avoid EC2.
5. Uploaded files and provider responses are untrusted. Sandboxed parsing and schema validation are distinct from authenticity, rights or quality guarantees.
6. Draft agents have no chain, storage or payment tools. Only an authorized human can apply suggestions and separately sign funding.

## Environment and deployment

Node >=26, Python validators and optional WSL Rust/Solana/Anchor are existing dependencies. Runtime configuration lives in `apps/api/src/config.ts`; secrets belong only in ignored server configuration. The two supplied key-file paths were checked for presence without printing or importing contents; existing credential configuration was preserved. No provider calls were authorized for this run.

Use the existing staging/rollback scripts only after reviewing target identity. Starting the production API can apply migrations; never run it against an unapproved database for a smoke test. `scripts/local-review.ts` instead creates a disposable in-memory database and disables workers, AI and chain operations. Its catalog is intentionally empty and payment routes fail closed.
