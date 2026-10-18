# Independent developer analytics

Private dashboard: `https://stats.13-61-207-211.sslip.io/`. Separate loopback Node service on port 4020; no marketplace UI, wallet sign-in or Next.js runtime required. Caddy supplies HTTPS. Passwords and ingestion secrets are never committed.

## Measurements

- **Active guests:** distinct anonymous browser identifiers with a visible-page heartbeat in the last five minutes.
- **Active registered users:** distinct server-authenticated accounts with a recent heartbeat. Multiple browsers for one account count once. Guest browsers and signed-in accounts are different units, not a verified people count.
- **Registered accounts:** all current, non-deleted marketplace accounts; total-ever and deleted records are shown separately. These totals include operator/demo identities.
- **Traffic:** distinct browsers, signed-in accounts and page views by UTC day. Starts at deployment; no historical visitor traffic is invented. Browser privacy settings, bots, blocked requests and network failures affect estimates. The collector is best effort and never blocks marketplace operations.
- **Feature usage:** counts by fixed API route template, method and response status. No raw URLs, tokens, request bodies, prompts, wallets or IP addresses are stored in the activity database.
- **Accounting:** lifetime settled seller allocations, commission and seller net proceeds calculated from each order's indexed chain fee split. Partial allocations use their recorded seller basis points; unknown splits are excluded. Paid service invoices and prepaid credit receipts are separate, not summed into a net-profit claim. Registered accounts and accounting do not change with the traffic-window selector. All live token totals currently represent mock USDC with no monetary value.
- **AI/download usage:** attempt statuses for the last 24 hours and cumulative accounted download bytes. Reservations are not proof of a completed browser transfer.

## Independence and protection

Browser presence/pageviews and feature counters use a dedicated SQLite database. Historical activity is logically pruned to 30 UTC calendar days. The public web client respects Do Not Track and Global Privacy Control. Visitor and account identifiers are HMAC-hashed before storage; the dashboard exposes aggregates only.

Marketplace totals use a separate PostgreSQL role with SELECT access only to five restricted views. Those views omit account identifiers, wallet addresses, invoice references and prompts. The role defaults to read-only transactions; queries also explicitly start read-only transactions. If the marketplace database is unavailable, independent traffic remains visible and accounting is marked unavailable, not zero.

The public API authenticates heartbeat identity from its existing session, never a client-supplied account ID. It forwards metrics to loopback using a separate ingestion secret. Ingestion and HTTP Basic dashboard credentials are distinct. Data endpoints require authentication and use `Cache-Control: no-store`; static assets are also private.

## Deployment

1. Back up the existing API environment, changed API/web source and Caddy configuration. Preserve all financial configuration.
2. From the existing API runtime root, run `node scripts/provision-analytics.mjs` once. Supply `ANALYTICS_PROVISION_DATABASE_URL` only to that process when the runtime account cannot create roles. Use the deployment administrator for provisioning; do not grant CREATEROLE to the marketplace account or persist the administrator credentials in the analytics environment. The script creates the read-only role/views, `services/analytics/.env`, a private `.data/developer-analytics-access.txt`, and the API ingestion configuration. It preserves existing analytics credentials on reruns. Restore those files together with the role if provisioning was interrupted; never print or commit their values.
3. Start the independent process: `node --env-file=services/analytics/.env services/analytics/server.mjs`. Persist it with the existing process supervisor as `developer-analytics`, using the API runtime directory as its working directory. Bind only to loopback.
4. Build a versioned frontend with the heartbeat component, install the new API route/config registration, and restart the API. No marketplace table migration is needed; provisioning adds read-only views and a restricted role.
5. Route the protected stats hostname to `127.0.0.1:4020`. Validate and reload Caddy, then promote the new web build. Save supervisor state.
6. Confirm unauthenticated dashboard/snapshot requests return 401, invalid ingestion secrets are rejected, the read-only role cannot read base tables, legitimate metrics load, and the marketplace remains ready. Use only test heartbeats for deployment checks and remove them from telemetry afterward.

Access details are stored on the deployment host at `.data/developer-analytics-access.txt` and copied to the operator's local ignored `.data/` directory. They are deliberately absent from the public site and repository. Back up the SQLite database using SQLite's backup API or stop the service and copy its database/WAL files together. Rollback can disable ingestion and restore the prior API/web/Caddy source without touching purchases, financial records, or chain state.

## Checks

`node --test services/analytics/analytics.test.mjs`

`npx vitest run tests/security/analytics.test.ts`

The standalone tests cover authentication, independent outage behavior, deduplication, expiry/retention, identifier hashing and exact financial aggregation. API tests verify identity comes from authenticated sessions, usage uses route templates, and collector failures do not fail the public heartbeat endpoint.
