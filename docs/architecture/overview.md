# Architecture overview

```text
 ┌──────────── apps/web (Next.js) ───────────┐
 │ wallet-standard login · dashboards · tx   │──signs──► Solana program (programs/edgebounty-marketplace)
 └───────────────┬───────────────────────────┘                     ▲  │ accounts / events
                 │ REST (JWT)                                       │  ▼
 ┌───────────────▼─────────── apps/api (Fastify) ──────────────┐   services/chain-indexer
 │ auth(SIWS) · listings · orders · uploads · previews ·        │◄── polls program accounts,
 │ verification · storage billing · providers · admin           │    reconciles vault balances
 │ delivery-service (entitlement → signed download tokens)      │
 └──────┬─────────────────────┬─────────────────────────────────┘
        │ Drizzle             │ object storage driver (local fs | S3/R2)
   PostgreSQL / PGlite        ▼
        │            private-uploads/ marketplace-assets/ evaluation-*/ previews/ delivery/
        ▼
 services/verification-orchestrator ── claims jobs (SKIP LOCKED), enforces budgets,
        │                               spawns sandboxed workers
        ├─► services/dataset-validator (Python: L1 technical, L2 pHash/outliers, previews)
        ├─► services/model-validator   (Python: ONNX inspection, operator allow-list, benchmarks)
        └─► L3 advanced review (Claude multimodal, sampled, budget-capped, optional)
```

Shared packages:
* `shared-types` — domain enums & DTOs shared by API and web.
* `verification-schemas` — zod schemas for reports, criteria, manifests + canonical JSON & hashing.
* `pricing-engine` — integer-only quotes, fee and storage maths.
* `blockchain-client` — PDA derivation, instruction builders, account decoders for the program.

Queue: the orchestrator uses a Postgres-backed job table (`FOR UPDATE SKIP LOCKED`) so the
MVP needs no Redis; a BullMQ adapter can replace it when throughput requires.
