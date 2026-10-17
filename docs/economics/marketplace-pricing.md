# Marketplace pricing and cost protection

Status: **implemented locally, not deployed.** Code: `packages/pricing-engine/src/marketplace.ts` (formulas),
`apps/api/src/lib/billing.ts` (coverage, checkout, metering), `apps/api/src/lib/costs.ts` (reporting),
migration `apps/api/drizzle/0003_marketplace_pricing.sql` (additive only).
This replaces the earlier proposal in `buyer-hosting-design.md`.

All money is integers:
- USD rates are **micro-USD** (`1 USD = 1_000_000n`).
- Settlement is in **lamports**. Rates are converted once per quote at a locked `SOL_USD_MICRO`, rounded **up**,
  so a quote never under-funds what it promises.

## Rules → implementation

| Rule | Where | How |
|---|---|---|
| Marketplace, not a drive | `lib/assets.ts` `reserveUpload` | The free tier covers only `listing` and `benchmark` uploads. `storage` and other customer purposes need a prepaid plan |
| Sellers pay for listing storage, even with 0 sales | `ensureListingCoverage` in `POST /listings` and `/listings/:id/versions` | A listing needs `LISTING_MIN_COVERAGE_DAYS` (30) of funded hosting ahead. Free tier, or `POST /versions/:id/hosting {months}` |
| Free 1 GB, abuse-bounded | `grantFreeCoverage` | Once per version, `FREE_RETENTION_DAYS` (90), and only while the account's live free-hosted bytes ≤ `FREE_STORAGE_BYTES`. Serialised per account |
| `H = max(0.30·M, ceil(GB)·M·S3_RATE·3)` | `hostingFee` | `S3_RATE_MICRO_PER_GB_MONTH` (default 23 000 = $0.023, **estimate**) |
| One physical copy, many buyers | `hosting_coverage`, `delivery_entitlements` | Files are stored once per version. Each buyer has their own entitlement (access window + byte meter) |
| No double charge for seller-funded hosting | `checkoutQuote` → `uncoveredGaps` | The buyer pays only for the **gaps** in the access window not already covered (seller prepaid, free tier, earlier buyers). Prorated per second |
| Every promised period stays funded | `fundCheckout` | Paid gaps become `buyer` coverage rows. Coverage rows are immutable and only ever added, so a gap computed at quote time can't reopen later |
| Downloads $0.15/GB; 1/2/3 included for 1/3/6 months | `includedDownloadFee`, `downloadAllowanceBytes` | Allowance = N × object bytes. Fee = N × ceil(GB) × $0.15 |
| Extra downloads prepaid | `POST /entitlements/:id/download-credits {gb}` | Adds `extra_bytes` once the invoice is paid |
| Range / resume | `routes/delivery.ts` | Single-range RFC 9110: `206`/`416`, `accept-ranges: bytes` |
| 5% commission from seller; $0.50 minimum | `commission`, `minimumFeeShortfall` | The buyer pays `max(0, ceil($0.50 in lamports) − floor(5%·P))`. The 5% is the on-chain fee, unchanged |
| Verify once per version + policy | `verification_runs` (unique key), `claimRun` in `services/jobs.ts` | See below |
| Recover verification cost | the seller's paid listing verification (existing flow) + commission | Buyers are never charged for an existing result (`platformResultReusable` sets the verifier fee to 0) |
| Cost and break-even reporting | `GET /admin/costs` | See below |

### Proration rules

- The billing month is 30 days (`MONTH_SECS = 2 592 000`). Hosting for any interval is
  `ceil(H(size, 1 month) × seconds / MONTH_SECS)`, so one second is never free.
- **Access window:** `[t_quote, t_quote + M months)`, using the timestamp when the quote is locked
  (`POST /listings/:id/purchase`, with a per-version lock).
- **Seller prepayment** starts where the current funded run ends (`coveredUntil`), so nothing paid overlaps or is wasted.
- **Paid gaps** are split across coverage rows proportionally by seconds, with integer division.

### Verification idempotency

- `verification_runs` has a unique key on `(asset_version_id, spec_hash, policy_version)`.
- A job (except free L1 previews) first `INSERT … ON CONFLICT DO NOTHING`:
  - **The winner** runs inference, persists the result, then marks the run `completed`.
  - **Losers** are requeued while the run is in progress. They then copy the persisted report into their own
    `verification_results` row (`reused_from_job_id`, `actual_cost = 0`).
- An order still gets its own on-chain verdict (a signature, not inference).
- A failed canonical run releases its row so a retry can take over.
- Bump `VERIFICATION_POLICY_VERSION` when the method changes.

### Download metering and its limits

- **Proxied downloads (default):** bytes are reserved atomically before sending
  (`UPDATE … WHERE bytes_served + n <= allowance + extra`). Bytes never sent are refunded when the connection
  closes, so an interrupted download costs only what was sent. Parallel ranges can't jointly exceed the allowance,
  and new tokens don't reset the meter.
- **Limitation:** "sent" means written to the socket. Bytes still in kernel or network buffers when the client
  drops are charged. The error is in the platform's favour and limited to the buffer size.
- **Presigned S3 URLs (`?direct=1`):** **S3 does not enforce byte quotas on a presigned URL.** Anyone holding it can
  re-download until it expires (≤ 300 s). Mitigation: the **full object size** is charged when the URL is issued,
  with no refund. Worst-case leak per issued URL is *(TTL × achievable bandwidth)* of extra egress.
  - Range requests always go through the proxy.
  - For hard quotas, keep `direct=1` off for metered buyers, or front S3 with CloudFront signed URLs plus WAF
    rate rules (not built).

### Legacy data (migration 0003)

- **Additive only:** 4 new tables and nullable or defaulted columns. Existing accounts, listings, orders and
  invoices are untouched (covered by a test).
- **Pre-existing entitlements** keep `access_ends_at = NULL` and `allowance_bytes = NULL`: unmetered and
  open-ended, as originally sold. Their storage is unfunded (see risks).
- **Listings published before this change** have no coverage rows. `delistUnfundedListings` skips them, and they
  stay listed until the seller buys hosting.

## Cost reporting (`GET /admin/costs`, admin only)

- **Storage:** physically stored bytes by category (customer / workflow), open reservations, estimated $/month
  at the S3 rate.
- **Bandwidth:** bytes actually streamed (and bytes handed off via presigned URLs) this month × `AWS_EGRESS_MICRO_PER_GB`
  ($0.09 estimate). The AWS free egress allowance is not deducted, which is conservative.
- **Verification:**
  - Canonical runs vs reused results.
  - Recorded upstream usage from `cost_events`. NVIDIA free tier = **$0 with the call count**
    (`NVIDIA_USD_MICRO_PER_CALL=0`), never an invented price.
  - CPU seconds are logged at $0 because they run on the fixed instance.
- **Fixed costs:** `EC2_MONTHLY_USD_MICRO` and `EBS_MONTHLY_USD_MICRO` are **unset = unknown** (reported as null,
  never guessed). Set them from the AWS Pricing Calculator or your bill.
- **Break-even:** fixed cost ÷ platform revenue per purchase (the realised average, or $0.50 minimum if nothing
  has sold yet).
- **Budget:** `BUDGET_MONTHLY_USD_MICRO` adds `projectedUsd`, `usedBps` and `alert`.
  For real alerts, also create an **AWS Budgets** budget with email alerts in the console (free for the first
  2 budgets). I did not create it.
- **`billingData.verified = false`:** verified AWS spend needs Cost Explorer read access (`ce:GetCostAndUsage`),
  which this deployment does not have. Granting it is your decision.

## Unit economics (computed by the pricing code; SOL = $150; AWS rates are estimates)

What the buyer pays on top of the listing price when the seller's hosting covers **nothing** (the worst case).
With seller coverage, buyer hosting drops to $0.

| Size | Price | Months | Buyer hosting | Downloads | Min-fee top-up | Buyer extras | Platform revenue | Est. AWS egress (all included downloads) | Est. S3 storage for the period |
|---|---|---|---|---|---|---|---|---|---|
| 0.5 GB | $2 | 1 | 0.30 | 0.15 | 0.40 | 0.85 | 0.50 | 0.04 | 0.01 |
| 10 GB | $2 | 1 | 0.69 | 1.50 | 0.40 | 2.59 | 0.50 | 0.90 | 0.23 |
| 10 GB | $50 | 3 | 2.07 | 3.00 | 0 | 5.07 | 2.50 | 1.80 | 0.69 |
| 10 GB | $50 | 6 | 4.14 | 4.50 | 0 | 8.64 | 2.50 | 2.70 | 1.38 |
| 100 GB | $50 | 6 | 41.40 | 45.00 | 0 | 86.40 | 2.50 | 27.00 | 13.80 |

- **Downloads:** $0.15/GB charged vs ~$0.09/GB estimated egress, about a 40% margin before request costs.
- **Hosting:** 3× the S3 storage rate, with a $0.30/month floor.
- **Platform revenue:** at least $0.50 per sale. Above $10 it's the 5% commission.
- **Break-even:** every $1 of fixed monthly cost needs **2 purchases** at the minimum take, or fewer at higher prices.
  Example: a $50 listing yields $2.50, so 1 purchase covers $2.50 of fixed cost.

## Infrastructure (read-only assessment, 2026-10-15)

- **Instance:** `m7i-flex.large` (2 vCPU, 8 GB).
- **The test validator dominates:** ~115% of one CPU continuously (~57% of the instance) and ~0.8 GB RAM.
  API, web and Caddy together use < 5% CPU and ~0.6 GB.
- **Ledger growth is the urgent risk:**
  - The old USDC ledger is 5.7 GB.
  - The SOL ledger created at 21:04 UTC was already 1.9 GB minutes later.
  - Disk is 64% used (11 GB free).
  - Neither validator runs with `--limit-ledger-size`.
- **The validator is needed only for the private demo chain** (faucet, burner wallet). Moving to Solana devnet
  removes it, at the cost of the faucet and of deploying the program to devnet.
- **Downsizing:**
  - **With the validator:** a burstable `t3.medium` would run out of CPU credits at a constant 57%
    (baseline 20%/vCPU), so keep `m7i-flex.large`.
  - **Without the validator (devnet):** API + web + Postgres fit comfortably on `t3.small`/`t3.medium`.

  Nothing was resized or migrated.
