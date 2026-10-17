# EdgeBounty product truth

2026-10-18 follow-up: the NVIDIA assistant now implements four task modes with account/global daily caps, private cached responses and human-only financial authority. The earlier default-off drafting and missing durable-quota statements below describe the initial pass; current scope and production gates are in MASTER_IMPLEMENTATION_STATUS.md.

EdgeBounty helps buyers find AI datasets/models and commission missing data through funded bounties. Sellers publish metadata, license declarations and version-specific check reports. Contributors deliver against agreed criteria; reviewers assess the delivery; administrators handle moderation and disputes through authorized workflows.

The current target is a test-network MVP. Historical reports describe mock-USDC settlement on a private validator. They do not establish public Devnet/Mainnet readiness, independent audit, genuine redeemable USDC or legal approval.

## Product rules

- Default marketplace commission is 6%; the seller/contributor receives 94% of the applicable gross settled reward before separately disclosed costs.
- Prices and payouts use integer token units. SOL remains necessary for network fees in USDC mode.
- Wallet sign-in is separate from payment authorization. Agents never sign or settle.
- Listings come from backend data. Empty catalogs stay empty; illustrative diagrams must remain identified as such.
- Technical validation, bounded sampling, AI observations and human review are different evidence classes. None guarantees legal ownership, accuracy or downstream performance.
- License declarations are seller claims unless supported by separate evidence. Human review remains necessary.
- New AI drafting is optional, disabled by default, and only sends user-entered requirements after consent. Catalog discovery is deterministic keyword matching, openly labeled.

## Fees and exposure

Existing hosting policy uses the pricing engine's versioned quotes (historically $0.045 per started GiB-month with a $0.30 floor). Treat this as code/configuration policy, not a new charge introduced by this change. Sale/bounty fees, hosting, verification and network fees must be shown separately before signature. Existing quotes and on-chain locked splits govern refunds and payouts; no new refund policy is implied. Downloads use entitlement periods and range quotas, including authorized ranges on interrupted transfers. See `economics/marketplace-pricing.md` and `economics/buyer-hosting-design.md`.

Operations count observed storage/API/verification usage; unconfigured provider prices remain unknown. Full Cloudflare invoice reconciliation and a durable global agent spend cap are launch gaps. Do not enable drafts with only an in-memory rate limiter as a production cost control.

Final legal terms/privacy pages require the actual operator, jurisdiction, support contacts and reviewed policies. Existing help/license pages are not a substitute for those missing business inputs.
