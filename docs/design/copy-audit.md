# Copy audit — Datasheet redesign

Principles: name the pain first, then the mechanism. One message per section. Be specific about
USDC, escrow, licensing and check levels. Never imply a guarantee the system can't give.

| Where | Before | After | Why |
|---|---|---|---|
| Home hero | "The AI marketplace where work is funded, evaluated, licensed and settled through verifiable contracts." | "Buy training data on evidence, not on a seller's word." | The old line listed four abstract verbs. The new one names the buyer's actual problem (trusting a seller) and the product's answer (evidence). |
| Home sub | "…with escrow and settlement rules enforced by a Solana program while the assets themselves stay private." | "Every listing shows which checks actually ran on the exact files you'd receive — and which statements are only the seller's. Your USDC waits in a Solana escrow until the data is delivered." | Concrete about what you see and where the money sits. |
| Home CTAs | "Fund a request" / "Sell a dataset or model" | "Browse datasets" (primary) / "Fund data that doesn't exist yet" | One primary action. The secondary action names the scenario instead of the feature. |
| Home steps | "Fund / Deliver privately / Verify / Settle" grid | Escrow timeline with the real program state names (`funded`, `submitted`, `under_review`, `settled`) and an exact 94/6 ledger | Shows the real states the user will meet on the order page. |
| Verification | "Verify" — "Automated checks and independent verifiers evaluate the submission" | Four levels (L1–L4) described from the backend's own definitions, with cost, plus "What a check is not" | "Verified" read as a guarantee. The levels are what the API actually reports. |
| Listing detail | "Description" | "Seller's description — claims by the seller, not checked unless a report below covers them" | Separates seller claims from findings (brief requirement). |
| Listing detail | "No verification report yet." | "No check reports are on file for this version. Everything above is the seller's own description." | Honest about what's missing. |
| Listing buy | "Fund escrow & buy" | "Pay into escrow and buy" + "Your USDC is held by the escrow program, not by the seller…" | Plain verbs. Says who holds the money. |
| Bounty create | Inline notice next to button | "Before you sign" ledger: reward, verification fee, total moving into escrow; network fees separate | Shows the financial breakdown before the transaction, using only values the page already computed. |
| Sign-in gate | "Sign in required" | "Sign in with your wallet to continue" + 3-step explanation, "moves no funds and authorizes no payment" | Wallet sign-in explained for non-crypto users. |
| Wallet button states | "Signing in…" / "Connecting…" | "Waiting for signature…" / "Connecting wallet…" | Tells the user that the next action is in their wallet. |
| Footer | "Test-chain MVP — not fully trustless" | "Test-network MVP. The escrow program is not audited, and some steps — delivery and dispute review — run off-chain." | Same honesty, but it names which steps instead of using "trustless". |
| 404 | (Next default) | "There's no page at this address… Orders and payments are not affected by a missing page." | Reassures on the one thing users fear. |

Removed or avoided everywhere: "seamless", "unlock the power", "revolutionary", "next-generation",
"trustless" (as a bare claim), and "verified dataset".

Discrepancies found between the brief and the repository (documented, not changed):
- The brief says the MVP verifier is the NVIDIA API, with Gemini planned. The architecture doc
  (`docs/architecture/overview.md`) names a multimodal LLM reviewer for L3, and the master-plan notes name
  NVIDIA embeddings for L3 similarity. Copy names no AI vendor.
- The brief implies listing is open. In the code, listing requires a passing L2 or L3 report on
  the exact version. The homepage says so.
- Payment currency is configurable (`NEXT_PUBLIC_PAYMENT_CURRENCY`: SOL or USDC). Amounts in the
  UI come from `sol()`, which prints the configured currency. Marketing copy says USDC, per the brief.
