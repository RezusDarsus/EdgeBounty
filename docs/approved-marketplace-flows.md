# Approved marketplace flows

> Historical SOL deployment notes from October 15. The October 17 USDC deployment supersedes currency and pricing details below; see [current implementation](MASTER_PLAN_IMPLEMENTATION.md). Retain this file with the preserved SOL release for rollback.

Implemented locally following the approved product discussion. No remote deployment or existing ledger reset is part of this change.

## Wallet identity

“Sign in with wallet” opens wallet selection, connects the chosen wallet, and asks for a login message signature. Reconnecting alone does not request a signature. Signing in authorizes no payment. The demo faucet supplies 2 test SOL; success and failure have separate messages.

The same account can act as creator/seller, requester, contributor, and verifier. These describe activities, not mutually exclusive account types.

## Publishing

Upload and finalize an immutable asset version, choose the checks, review the platform quote, and approve payment. Verification runs asynchronously. A completed passing L2 or L3 report for that exact version is required by listing creation, version preparation, confirmation, and indexing. Free preview checks do not qualify. Failed checks link to the report and offer a corrected upload.

Standalone private verification remains available in the footer under Tools. It is removed from the primary menu and home-page action buttons.

## Funded requests

Requesters set the contributor reward. Contributors accept the posted scope and reward. No automatic difficulty-based work pricing or bidding system is introduced.

Delivery requirements start with a dataset/model-specific checklist; additional requirements are optional. Rights labels describe the existing licenses and retain their underlying legal terms. Exclusive transfer selects the matching assignment terms.

The API calculates the verification fee. Client-supplied fees cannot lower it or select a different verifier for this request flow. The fixed fee covers the initial check and agreed correction rounds per delivery. Slots have a fee for each delivery; sequential milestones fund the current milestone only. Additional workload outside the agreed scope requires separate authorization; the platform does not silently increase the escrow charge.

## SOL payments and deployment

Amounts use lamports: 1 SOL = 1,000,000,000 lamports. Existing API/DB fields named `*Micro` retain their names for compatibility, but a new SOL deployment stores lamports in them. Compatibility pricing exports are also lamport-based.

The payment mint is wrapped SOL (`So11111111111111111111111111111111111111112`). Funding instructions create the wallet's associated token account, wrap only the shortfall, synchronize it, and fund escrow in one transaction. Existing wrapped SOL can be reused. Payouts and refunds arrive as wrapped SOL; the dashboard offers an owner-signed withdrawal to native SOL. Network fees and account rent remain separate from the quoted reward/service fee.

Initial platform rates are explicit SOL amounts, not an exchange-rate conversion: L2 base 0.005 SOL, 0.0005 SOL per additional 1,000 items over 5,000; sampled AI adds 0.002 SOL; model setup 0.003 SOL plus configured compute rates. The pricing page shows the schedule. These initial rates have not been validated against live provider costs.

The current ledger may still use the old mock USDC mint. The API and web payment path reject that configuration. `scripts/dev-setup.ts` now initializes wrapped SOL only on an uninitialized platform and refuses to repurpose a legacy one.

Before running the revised marketplace, preserve the old ledger and database, then provision a separate validator ledger and separate `DATA_DIR` (or a new production database). Do not reuse legacy invoices, credits, orders, or listings: relabeling their integer amounts would change their value. Restore the old code with the old data when operating the legacy environment.

On-chain program code and account layouts are unchanged; the existing configurable token escrow uses the native wrapped SOL mint. Historical USDC contract fixtures are not evidence that the revised SOL deployment works. End-to-end settlement must be verified in the separate SOL environment before remote rollout.
