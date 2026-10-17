# Pricing & unit economics (preliminary — validate against measured costs)

All prices are implemented in `packages/pricing-engine` as integer micro-USDC.

## Marketplace commission
5% (`fee_bps = 500`) of completed order value, locked at funding. Hard ceiling 10%.

| Buyer funds | Seller receives | Platform |
|---:|---:|---:|
| 100 USDC | 95 USDC | 5 USDC |

## Storage rental
* 10 GB / 30 days: 1.99 USDC (base plan).
* Additional capacity: 0.10 USDC per GB-month (R2 cost ≈ 0.015/GB-month + ops + margin).
* Terms: 7, 30, 90, 365 days (pro-rated on the 30-day price; 365 days = 10 × monthly).
* Grace period: 14 days read-only, then deletion. Assets in active orders are never deleted.

## Verification
| Service | Price |
|---|---:|
| Level 1 technical checks | free up to 2 GB / 5,000 files per month |
| Sampled AI verification (≤ 200 items) | 2 USDC |
| Lightweight full-dataset (L1+L2) | 5 USDC base + 0.50 per 1,000 items over 5,000 |
| Advanced multimodal (L3) | quote = items × model cost × 1.5 margin, min 10 USDC |
| Human review | manual quote |
| Model benchmark | 3 USDC setup + compute seconds × rate |

Quote formula:
```
price = fixed + processing + third_party_api + storage_transfer + margin
```
Every job carries a hard budget (`max_spend`, `max_seconds`, `max_items`, `max_api_calls`).
If projected cost exceeds the budget the job stops in `needs_authorization`.

## Unit-economics tracking
`verification_jobs.actual_cost_micro` is recorded per job; `/admin/economics` aggregates
cost per 1,000 items, GPU seconds, margin by service, dispute handling cost.
