# Test-chain MVP acceptance — October 17, 2026

The user explicitly selected **Finish the test-chain MVP** as the completion scope. This is a functional test deployment using mock USDC, not a mainnet release or a claim that the entire production roadmap is complete.

## Final checks

- TypeScript typecheck: passed.
- Unit/security: 83 tests across 15 files passed.
- Rust contracts: 31 tests passed, covering escrow, settlement, disputes, refunds, mint checks, permissions and replay protection.
- Python dataset/media validation: 10 tests passed.
- Live NVIDIA L3 marketplace flow: passed against deployed preview/API, including direct private R2 upload, paid verification, no-charge result reuse, listing, purchase, 94/6 settlement, denied early delivery, Worker ranges and quota-exhaustion denial. Fixture listing delisted. Order: `B4Ti3xzY8pB2XHpckE3Hu5MBmT7NZvHy6j5YeKcx29my`.
- Live Docker probe: read-only archive input, isolated scratch/output permissions and timeout checks passed.
- Final readiness: database, chain and worker all healthy.
- Earlier deployment evidence: web production build, encrypted R2 backup/restore across 41 tables, retention-notice rendering and acknowledgement, backup/health timers.

## Accepted boundaries

NVIDIA is the MVP provider; Gemini is deferred by user choice. Full-content scans on this host are capped at 256 MiB, including benchmark materialization; oversized standalone work is rejected before billing. Upload transport can support larger datasets, but this does not promise a large-file quality scan or automatic listing approval.

Mainnet, independent audit, advanced cross-modal AI, large-file full-content infrastructure and commercial validation belong to the future production roadmap. External alerts have no configured destination. See `MVP_OPERATIONS.md` for recovery procedures and measurement limitations.
