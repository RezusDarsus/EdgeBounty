# Buyer-paid dataset hosting & dynamic checkout pricing (design)

Status: **proposal, not implemented**. Replaces the fixed storage plans (`storage_allocations`,
`STORAGE.basePlan*`) for marketplace purchases. EdgeBounty is a marketplace, not cloud storage:
the buyer buys a dataset and pays for how long EdgeBounty keeps delivering it.

All AWS prices below are **placeholders for `eu-north-1` that must be confirmed in the AWS Pricing
Calculator**; they live in a versioned config table, never in code.

---

## 1. Business model

* **One physical copy per dataset version.** The seller's upload is stored once in S3. Buyers get
  *entitlements* (access rights with dates), never copies. 100 buyers of a 9.8 GB dataset = 9.8 GB stored.
* **What the buyer pays for** at checkout, in one USDC total:
  1. the dataset (license) - seller's price, settled through the existing escrow;
  2. a **hosting period** (1 / 3 / 6 / 12 months) during which they can download;
  3. a **download allowance** (bytes) included in that period;
  4. a capped **share of the one-time verification cost** of that dataset version (until it is recovered);
  5. a **minimum platform fee** only when the 5% commission is too small to cover per-order costs.
* **Renewal** = another hosting period + allowance. Never the dataset price again.
* **Expiry** removes the buyer's *hosting access*, not their *license*. The on-chain `LicenseReceipt`
  and purchase records are permanent.
* The seller's listing (and its S3 object) is never deleted because one buyer's hosting expired.

### Who pays for the shared copy?
The object must exist while **(a)** it is listed, or **(b)** any buyer entitlement is active or in grace,
or **(c)** an order/dispute references it.

* (a) While listed: covered by the marketplace commission up to a size cap (config `listing_free_gb`,
  default 50 GB per version). Above the cap the seller pays a listing hosting fee. *Decision needed.*
* (b) After delisting: buyers' hosting fees fund retention (see the sharing factor in §2).

---

## 2. Pricing formula (all integer micro-USDC, rounded up to 0.01 USDC at the end)

```
G   = ceil(size_bytes / 1 GiB)                     billable GB (9.8 GB -> 10)
M   = hosting months chosen (1, 3, 6, 12)

H   = max( H_min , G * M * r_s * k_s / S )          hosting
D   = G * A(M) * r_e * k_e  +  R                    included downloads
V   = min( V_share , V_unrecovered )                verification share (stops once recovered)
F   = max( 0 , F_min - c * P )                      minimum platform fee, net of commission
TOTAL = P + H + D + V + F
```

| Symbol | Meaning | Default (configurable) |
|---|---|---|
| `P` | dataset price set by the seller (commission `c` = 5% comes out of P, not added) | seller |
| `r_s` | S3 Standard storage, USD per GB-month | 0.023 (verify) |
| `k_s` | storage multiplier: requests, metadata, monitoring, backups, risk, margin | 3.0 |
| `S` | sharing factor = current concurrent holders of this version after delisting, clamped `[1, S_max]`; `S=1` while we cannot rely on sharing | 1 at launch, `S_max` 5 |
| `H_min` | minimum hosting fee per period | 0.50 USDC |
| `A(M)` | included download multiple of the dataset size: `2 + (M - 1)`, capped at 6 | 1 mo -> 2x, 3 mo -> 4x |
| `r_e` | data transfer out to the internet, USD per GB | 0.09 (verify) |
| `k_e` | delivery multiplier: GET requests, URL issuance, metering, margin | 1.25 |
| `R` | request cost per allowance (GET per 16 MB range) | ~0.01 USDC |
| `V_share` | max verification recovery per sale | 0.50 USDC |
| `V_unrecovered` | actual verification cost of the version minus what earlier sales already recovered | ledger |
| `F_min` | minimum platform take per order (compute, DB, jobs, RPC, support) | 1.00 USDC |

Why not `S3 cost x 1.1`: storage is the **smallest** cost. For a 10 GB dataset, storage is about
0.23 USD/month while **one full download is about 0.90 USD** of egress. Pricing must be driven by
delivery (bandwidth), with storage as a minor line and fixed costs covered by a floor.

**No double counting:**
* Marketplace operations (escrow, settlement, disputes, support) are covered by the 5% commission;
  `F` only tops up the commission when it is below `F_min`.
* Physical storage is shared: `S` (and listing retention covered by commission) prevents charging for copies that do not exist.
* Verification is charged per **version**, recovered across sales, and stops once recovered.

**Safeguards:** `H_min` and `F_min` floors; download hard cap (§9); prices quoted from a
versioned `pricing_configs` row with `effective_from`; a quote is locked for 15 minutes.

---

## 3. Worked example: 9.8 GB dataset, P = 50 USDC, version verification cost 0.80 USDC, first buyer

`G = 10`, `S = 1`, commission `c*P = 2.50` (>= `F_min`, so `F = 0`).

| Line | 1 month | 3 months |
|---|---:|---:|
| Dataset (license) `P` | 50.00 | 50.00 |
| Hosting `H` = 10 x M x 0.023 x 3.0 | 0.69 | 2.07 |
| Downloads `D`: allowance | 20 GB (2x) | 40 GB (4x) |
| Downloads `D` = GB x 0.09 x 1.25 + 0.01 | 2.26 | 4.51 |
| Verification share `V` (of 0.80 unrecovered) | 0.50 | 0.50 |
| Minimum platform fee `F` | 0.00 | 0.00 |
| **Total** | **53.45 USDC** | **57.08 USDC** |

The second buyer pays `V = 0.30` (the rest of 0.80); later buyers pay `V = 0`.

**Renewal (same buyer, later):** `H + D` only, with `A = M` (1x per renewed month):
1 month = 0.69 + (10 x 1 x 0.1125 + 0.01) = **1.83 USDC**; 3 months = 2.07 + 3.39 = **5.46 USDC**.

**Cost check (3-month purchase, worst case: full allowance used, buyer is the only holder):**
storage 9.8 x 0.023 x 3 = 0.68; egress 40 x 0.09 = 3.60; requests about 0.01 -> about 4.29 USD cost vs 6.58 USDC
of H + D charged -> about 35% margin on infrastructure, plus 2.50 commission for marketplace operations.

**Low-price example:** P = 2 USDC -> commission 0.10 -> `F = 0.90`, so a cheap dataset still covers its fixed per-order cost.

---

## 4. AWS costs to account for

| Cost | Driver | Notes |
|---|---|---|
| S3 Standard storage | GB-month of physical objects (shared) | listing originals, previews, evaluation scratch |
| Data transfer out | bytes downloaded by buyers | **dominant cost**; 100 GB/month free account-wide only |
| Requests | PUT/LIST (uploads), GET (downloads, ranged) | small but non-zero; multipart = many PUTs |
| Incomplete multipart uploads | billed as storage until aborted | lifecycle rule: abort after 1 day |
| EC2 | API, indexer, validators, Solana RPC | fixed monthly, covered by `F_min` + commission |
| EBS | instance disk, validator ledger, work dirs | fixed |
| AI verification | NVIDIA free tier now; paid inference later | `V` ledger, actual cost recorded per job |
| Optional CloudFront | delivery through CDN | S3 -> CloudFront transfer is free; CloudFront has its own free tier; likely the cheapest egress path once volume grows |

---

## 5. Backend architecture & database changes

Reuse: `asset_versions` (size, commitment), `delivery_entitlements` (already per order, per buyer),
`invoices` + on-chain `pay_service` receipts, `verification_jobs.actual_cost_micro`, the indexer, the delivery service.

New / changed tables:

| Table | Purpose |
|---|---|
| `pricing_configs` | versioned rates and multipliers (`r_s`, `r_e`, `k_s`, `k_e`, `H_min`, `F_min`, `V_share`, `A` rule, `S_max`, `listing_free_gb`), `effective_from`, created_by (audited) |
| `checkout_quotes` | quote id, buyer, listing version, months, breakdown JSON, total, pricing_config id, reference (32 bytes), `expires_at` (15 min), status |
| `delivery_entitlements` (extend) | `hosting_starts_at`, `hosting_expires_at`, `grace_until`, `status` (`active`/`grace`/`expired`), `allowance_bytes`, `downloaded_bytes` |
| `hosting_periods` | one row per purchase or renewal: entitlement, months, H, D, quote, invoice/receipt, period dates (audit trail; never deleted) |
| `download_grants` | entitlement, file, bytes authorized, presigned URL issued_at/expires_at (no IP stored) |
| `verification_recovery` | asset_version, actual cost, recovered so far |
| `object_retention` | asset_version: `retain_until` = max(listing active, max entitlement `grace_until`, open orders/disputes); deletion only when no reason remains |
| `notifications` | account, kind (`expiry_7d`, `expiry_1d`, `grace_started`, `grace_ending`, `expired`), entitlement, sent_at, channel |

Services:
* **Pricing service** (`packages/pricing-engine`): pure function `checkoutQuote(config, size, P, months, holders, vUnrecovered)` (testable, integer-only).
* **Hosting worker** (hourly): transitions active -> grace -> expired, enqueues notifications, recomputes `object_retention`, deletes S3 objects only when `retain_until` has passed and no reason remains.
* **Delivery service** (existing `/orders/:id/delivery`): checks entitlement status + remaining allowance; issues **S3 presigned GET** (5-minute TTL, `response-content-disposition`) instead of streaming through EC2; counts bytes at issuance.

S3 layout (one private bucket, `edgebounty-uploads-rezus-2026`):
```
tenants/{sellerAccountId}/listings/{assetId}/{versionId}/{random}   shared original (one copy)
tenants/{accountId}/submissions/{orderId}/{versionId}/{random}       bounty deliverables
previews/{versionId}/...                                             lifecycle: expire after 30 days unused
evaluation/{jobId}/...                                               lifecycle: expire after 7 days
```
Authorization is always checked in the API; prefixes organize data and scope IAM, they are not the security boundary.

---

## 6. User flows

**Checkout**
1. Buyer opens a listing -> picks 1/3/6/12 months -> `POST /listings/:id/quote` -> breakdown + total + allowance shown.
2. Wallet signs **one transaction**: `create_order` (escrows P) + `pay_service(reference, H+D+V+F)` - atomic, both or neither.
3. API confirms both on-chain (order account + receipt PDA) -> entitlement created with dates and allowance.
4. After settlement: downloads via presigned links; dashboard shows "hosted until …, 14.2 / 40 GB downloads left, Renew".

**Renewal**
1. "Extend hosting" -> renewal quote (H + D only, current config) -> pay_service -> confirm -> `hosting_expires_at` extended from the later of now / current expiry; allowance increased.
2. Allowed during `active` and `grace`; after `expired` allowed only while the object is still retained ("re-host").

**Refund path:** if the dataset order ends refunded, the hosting payment is returned as prepaid credits automatically
(MVP), or refunded on-chain once the program carries a `hosting_fee` field (see §7).

---

## 7. Solana USDC integration

* Reuse the existing on-chain pieces: escrowed `create_order` for P and `pay_service` + `ServiceReceipt` PDA for hosting.
  The receipt reference = quote reference, so a quote can be paid once only; the API confirms
  amount >= quote and payer == buyer from the chain (never from the browser).
* Quotes are locked for 15 minutes; an expired quote is re-priced.
* Program improvement (recommended after MVP): add `hosting_fee` to `Order`, paid to the treasury on settlement
  and back to the buyer on refund. This makes hosting refunds trustless and removes the credits workaround.
* Mint = USDC (devnet test mint now). USD prices from AWS are converted 1:1 to USDC.

---

## 8. Expiration, notifications, deletion

| Time | Action |
|---|---|
| expires - 7 days | notify "hosting ends in 7 days" + renewal price |
| expires - 1 day | notify again |
| expires | status `grace` (default 7 days): downloads paused, renewal still at normal price, banner warning |
| grace ends - 1 day | final warning |
| grace ends | status `expired`; access removed; license receipt and records kept |
| object `retain_until` passed, no listing / entitlement / order / dispute | S3 object deleted; audit event written |

Channels: accounts are pseudonymous wallets with no email by default -> **in-app notification inbox** (always),
plus **opt-in email or webhook**. The UI must show dates and the grace policy before payment.
Retention: purchase receipts, hosting periods and audit events kept per the privacy policy (7 years for financial records);
on-chain records are permanent.

---

## 9. Security, anti-abuse, cost optimization

* Bucket private, Block Public Access on, SSE-S3, TLS-only bucket policy; EC2 **IAM role** with least privilege
  (no access keys on the server); IMDSv2 required.
* Presigned GET: 5-minute TTL, one file per URL, wallet-bound grant, rate-limited issuance (e.g. 30 per hour),
  bytes counted at issuance against the allowance -> **hard cap**, then an explicit, priced "extra downloads" pack (never an automatic charge).
* Reconcile metering with S3 server access logs (or CloudFront logs) daily; flag entitlements whose real egress exceeds the counted bytes.
* Multipart: per-file and per-version size limits, part checksums, server-side size verification, abort-incomplete lifecycle rule.
* Cost: single shared copy; previews/evaluation prefixes auto-expire; CloudFront for egress at scale;
  optional S3 Intelligent-Tiering for retained but rarely downloaded versions.
* Abuse: one entitlement per order (no re-download farms via many cheap renewals - allowance is per period and capped);
  unusual download patterns flagged in the admin fraud view.

---

## 10. MVP plan (existing architecture)

| Step | Work | Size |
|---|---|---|
| 1 | `pricing_configs` + `checkoutQuote()` in `pricing-engine` with unit tests (the examples above become tests) | S |
| 2 | Schema: `checkout_quotes`, `hosting_periods`, `download_grants`, `verification_recovery`, `object_retention`, `notifications`; extend `delivery_entitlements` | M |
| 3 | S3 driver: IAM-role credentials (no keys), presigned GET, tenant prefixes for new uploads | S |
| 4 | Checkout API: quote -> combined transaction (create_order + pay_service) -> confirm -> entitlement with dates | M |
| 5 | Delivery: entitlement status + allowance checks, presigned GET, byte metering | S |
| 6 | Renewal API + UI; hosting worker (grace/expiry, notifications, retention, deletion) | M |
| 7 | Web: period picker, price breakdown, "hosted until / downloads left / Renew", notification inbox | M |
| 8 | Remove the fixed storage plans UI for marketplace purchases (keep code paths only where needed) | S |
| 9 | Tests: quotes, atomic checkout, refund -> credits, renewal extension, allowance cap, tenant isolation, expiry never deleting a listed original, S3 via MinIO; smoke test on the real bucket after approval | M |
| 10 | AWS console checklist (IAM role + policy, IMDSv2, CORS, lifecycle rules, budget alarm) | S |
| Later | `hosting_fee` in the program; CloudFront; email notifications | - |

## Open decisions
1. Listing retention while listed: covered by commission up to `listing_free_gb` (proposed 50 GB), seller pays above? 
2. Grace period length: 7 days (proposed) or 14 (current code)?
3. Hosting periods offered: 1 / 3 / 6, plus 12 months?
4. Extra download packs: offer them, or a hard cap only for the MVP?
