# Implementation phases and acceptance

All phases use the existing app. No destructive migration, Mainnet switch, remote deployment or paid provider calls are authorized by the blanket request where the supplied directive expressly reserves separate approval.

| Phase | Existing implementation | This run / acceptance |
|---|---|---|
| 1 Audit | Extensive code, protocol/threat/deployment notes | Added consolidated architecture, product, flow, gap, design and implementation documents with explicit status taxonomy. |
| 2 Design/home/nav | Shared design system, evidence diagrams, responsive nav, preview | Reused dark navy tokens per new brief, preserved typography/components, adopted supplied headline/CTAs, clarified bounded technical checks. Copy proposal recorded in DESIGN before edits. |
| 3 Catalog/details | Real backend listings, details, filters and seller/verification panels | Added public-metadata discovery with reasons and honest no-result/error states. Existing catalog remains authoritative. |
| 4 Storage | Direct R2 multipart, quotas, entitlement gateway and S3 fallback | Preserved current flows. Security suites rerun; remote provider verification and malware quarantine remain open. |
| 5 Payments/bounties | Anchor escrow, USDC guards, existing bounty workflows | Financial source/configuration preserved. Added draft preview/apply before the existing human funding step. No transactions sent. |
| 6 Verification/AI | Validators, provider adapters and caching | Added bounded NVIDIA draft schema/provider with default-off gate and consent; both live AI suites now explicitly opt-in. Metadata agent and durable draft budget/cache remain open. |
| 7 Hardening | Existing unit/security/API/browser/Python/Rust suites | Typecheck, offline API/security/provider tests and real local browser smoke; exact current results in RUN_EVIDENCE. No invented independent quality score. |
| 8 Release | Existing staging/rollback scripts | No deployment. First close launch gates, approve target/costs, run isolated Devnet/staging acceptance, then separately approve promotion. |

## Safe next implementation sequence

1. Add durable per-account/global draft budget reservation, request identity/result reuse, provider price configuration and usage reconciliation before enabling AI drafts.
2. Add metadata suggestions from owner-authorized immutable manifests; no automatic license inference or private-file sharing. Add explicit optional sample consent.
3. Run all authenticated buyer/seller/contributor/reviewer paths on an isolated matching USDC validator; test replay, delayed indexing, rejected signatures and refunds.
4. Quarantine new uploads; implement approved malware scanner with archive/resource limits and a tested promotion policy.
5. Complete independent contract review, remote signer custody, operator legal inputs, accessibility audit, load tests, restore drill and alert delivery.
6. Review staged release evidence and rollback plan before authorized deployment. Preserve previous ledger/database state.

## Reusable design review workflow

Applicable to Claude Code or another code agent: read repository AGENTS instructions, design/product truth and the exact changed scope; render with real backend states; batch desktop/mobile captures and keyboard/error/loading tests; inspect spacing/type/contrast/overflow; repair verified defects; rerun changed tests; save screenshots and findings. Maximum five repair iterations per component; prefer a single batched repair and confirmation.

When independent evaluators are available, assign separate design, usability and technical reviews against the same captures and source revision. They must cite actual evidence, identify critical defects and state uncertainty. A score target of 85/100 is an acceptance goal, never an automatic generated pass. No claim of independent evaluators or Claude Code execution is made for this run.

## Report format

For each batch record discovered behavior, changed files, completion scope, exact test commands/results, evidence paths, remaining defects, security/cost concerns and next action. Current run: see RUN_EVIDENCE.md. Do not infer production correctness from generated source or historical deployment notes.
