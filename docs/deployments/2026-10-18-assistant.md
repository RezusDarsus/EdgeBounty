# Assistant deployment — 2026-10-18

Live application: https://13-61-207-211.sslip.io/assistant. API: https://api.13-61-207-211.sslip.io. This remains mock USDC on the existing private validator, with a 600-bps marketplace fee. No Mainnet promotion or contract configuration change occurred.

## Deployed scope

Four assistant modes cover published-catalog discovery, bounty planning, owner metadata suggestions and authorized report explanations. Drafts require human review/apply. Optional metadata text sharing has a separate unchecked consent and a 4096-byte range-read limit. Wallet/context changes discard stale private responses throughout the shared client API hook. Deleted accounts immediately lose JWT/API-key access.

NVIDIA interactive requests use `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`. The supplied `nvidia/nemotron-3.5-lightning-30b-a3b` remains the existing L3 text model. Lightning interactive probes timed out; Omni passed bounty, metadata and report probes. A later discovery probe returned an invalid response; JSON response mode was added and the eight assistant security tests rerun successfully. No provider output bypasses schema/citation validation. No paid GPU instances were created. Actual NVIDIA billing remains account-dependent and is not asserted to be zero.

Daily reservations persist in PostgreSQL: 100 global and 10 per account, including failures. Exact completed account/input/model cache hits use zero additional calls. Responses expire after 30 days; account deletion erases their content immediately. Prompts and credentials are not logged.

ClamAV is installed with fresh definitions; paid verification scans after immutable hash validation, and publication requires the same commitment's clean scan. Clean and EICAR probes passed. Invoice payment and purchased effects now commit atomically; a rotating bounded reconciliation checks late expired receipts.

## Runtime and recovery

Active web: PM2 `web-assistant-secure`, port 3008, `/home/ubuntu/edgebounty-web-20261018-assistant-secure`. Active API and verification worker remain in `/home/ubuntu/edgebounty-usdc-20261017-master`, port 4003. Caddy routes the public and preview web hosts to 3008. Previous web processes are stopped and retained. PM2 state is saved.

Backups: `/home/ubuntu/backups/pre-assistant-20261018` contains previous API source, private environment, Caddy config, PM2 state and a pre-migration database dump. Subsequent frontend backup directories are `pre-assistant-final-20261018` and `pre-assistant-session-scope-20261018`. Migration `0008_agent_requests.sql` is additive. Rollback restores prior API source/environment and `web-edge2` plus its Caddy route; retain the additive table and never rewind the database or chain to roll back application code. The uploaded `rollback-assistant.sh` is syntax-checked, not executed.

## Validation and evidence

- Full JS suite: 117 passed, 22 prerequisite skips. Python: 15 passed. Matching-source Rust: 33 passed. Production Next.js build passed.
- Live bounty draft preview/apply passed without changing budget/deadline or submitting a payment. Private synthetic metadata/report probes passed and were removed; no public listings were fabricated.
- Browser privacy race and keyboard transcript regression passed. Real local private sample preview passed with sharing unchecked and context-reset clearing.
- Fresh private-validator settlement: 100 mock USDC split 94 seller / 6 treasury; license and replay rejection passed. Order `DXHiATKqMdnB49NQgyZfAYEUdxPUD5RojxBRc7KQXxGk`.
- Evidence directories: `docs/evidence/assistant-local-2026-10-18`, `docs/evidence/assistant-live-2026-10-18` and final live captures in `docs/evidence/assistant-final-2026-10-18`. Earlier screenshots may show the earlier Lightning configuration.
- Final live JSON-mode discovery: HTTP 200, 296 input / 259 output tokens; desktop repeat was cached with zero additional calls. Twelve page captures at 320/390/1280/1440 widths returned HTTP 200, no browser exceptions and no horizontal overflow. Final public capabilities report chat, bounty drafting and metadata drafting enabled, with no financial authority.

The complete directive is not certified finished: independent production/contract audit, real operator/legal agreements, production custody, separate worker infrastructure and public-network launch remain external gates. See `../MASTER_IMPLEMENTATION_STATUS.md` for the scope-by-scope register.
