# Implementation evidence — 2026-10-18

## Scope and ownership

The repository began with extensive tracked and untracked user work. That work was preserved. Existing contract initialization fixes, media/semantic verification, growth/analytics, infringement, operations changes and historical remote deployments are not attributed to this run.

Implemented here:

- Six requested audit/product/flow/gap/implementation/design documents, plus this evidence report and an amendment pointing the root design document at the new brief.
- Default navy theme through existing tokens, supplied hero and CTA copy, bounded-check wording and corrected L2 description. Existing typography, navigation, shared components, listing/purchase and bounty financial flows retained.
- `/agents/discovery`: only published listing metadata, bounded query/candidates/results, literal word matching, match explanations, no private files or provider requests. Homepage includes a working subject search and honest empty/error states.
- `/agents/bounty-draft`: wallet session, strict input/consent/output validation, single request with 30-second timeout and 1,600-token response cap, usage metadata, no financial capabilities. Default `AI_DRAFTS_ENABLED=0`; no budget assumed from possessing a key.
- Bounty draft UI supports text-sharing consent, preview of deliverables/checklist/questions and explicit human application. Reward, license, acceptance criteria and deadline are never populated by the agent.
- Explicit `RUN_LIVE_AI_TESTS=1` opt-in in both paid NVIDIA suites, regardless of credentials being present.
- Unit/security coverage for provider failure, disabled spend, malformed/extra/truncated outputs, real catalog privacy, validation and unauthenticated drafting.
- Disposable local review API, reproducible browser script and `.claude/skills/edgebounty-review/SKILL.md`. The Claude skill is local and ignored by the existing repository `.gitignore`; no Claude Code or independent evaluator execution is claimed.

## Tests executed

| Command/check | Result |
|---|---|
| `npm run typecheck` | Passed after API/UI implementation. |
| `npx vitest run --exclude tests/end-to-end/**` | 20 files passed; 101 tests passed, 1 skipped. |
| `npm test` | 21 files passed, 7 files skipped; 102 tests passed, 22 skipped. |
| `.venv/Scripts/python.exe -m unittest discover -s services/dataset-validator -p 'test_*.py'` | 10 passed. |
| `.venv/Scripts/python.exe -m unittest discover -s services/model-validator -p 'test_*.py'` | 5 passed. |
| `npm run build -w @edgebounty/web` | Passed, including Next.js TypeScript and 22 static pages. |
| `git diff --check` | Passed; line-ending conversion warnings only. |
| Real Chrome via `scripts/review-ui.mjs` | 8 renders, all HTTP 200, zero horizontal overflow, broken images or uncaught page exceptions. |

The first broad test invocation was interrupted to audit provider spending behavior. Completed counts above refer to subsequent runs after explicit opt-in guards were installed.

## Browser evidence

Screenshots and machine-readable measurements: [evidence/ui-2026-10-18/report.json](evidence/ui-2026-10-18/report.json).

Desktop 1440×1000 and mobile 390×844 cover home, datasets, new bounty and design-system preview. Captures use real Fastify routes and a disposable PGlite database with no fabricated catalog listings. Home search was submitted and returned the real empty-catalog state. Bounty captures use a real random wallet challenge/signature and valid server session; the disabled draft disclosure was opened. The unavailable chain produces a visible quote error and prevents funding. No financial transactions were attempted.

Desktop/mobile home and mobile bounty screenshots were visually inspected. The showcase initially revealed a theme-cleanup regression: leaving it could remove the application's default theme. Cleanup now restores the previous theme. The screenshot helper resets scroll before full-page capture so sticky navigation is represented correctly. A second batched capture passed. The preview can deliberately use the light palette; this is not the product default.

The final L2 label/description correction followed the captures and production build; it was typechecked, but the screenshot set retains the earlier L2 wording. No additional visual pass is claimed for that text-only correction.

## Limits and defects

- No local validator was available during this run; 22 tests skipped for live-provider/chain prerequisites. No fresh Anchor, public Devnet or end-to-end settlement success is claimed.
- No R2/S3 remote transfers, cloud deployment, production migrations or deliberate paid inference probes were performed. Credential documents were not printed, imported or rotated.
- The browser API uses an empty temporary database with unavailable chain; it verifies failure behavior, not successful purchasing or upload delivery. Full catalog/detail/seller/reviewer/admin interaction testing remains open.
- Enabled-provider draft UI is covered by provider/schema tests, not a live inference browser capture. Durable account/global budget limits, caching/idempotency and provider pricing reconciliation must precede production activation.
- Existing whole-site reduced motion uses near-zero global animation duration. A targeted reduced-motion treatment, computed contrast, screen-reader audit and 320px/authenticated route matrix remain accessibility work. No WCAG certification or 85/100 quality score is claimed.
- Existing build warnings: optional bigint native bindings fall back to JS; Node reports experimental server localStorage availability. Build succeeds; these warnings are not silently treated as failures.
- Malware quarantine, dedicated worker hosts, production signer custody, final legal policies and independent audit remain launch gates. See GAP_ANALYSIS.md and PRODUCTION_LAUNCH.md.

## Reproduce safely

Run `npx tsx scripts/local-review.ts` and the web development server in separate terminals. Set `PLAYWRIGHT_MODULE` to an installed Playwright package and run `node scripts/review-ui.mjs`. The review API binds loopback, keeps its database in memory and disables workers/AI; payment-dependent routes intentionally fail closed. Use a separate matching chain/database for financial acceptance. Never point a smoke test at production by editing private configuration.

## Next step

Implement durable cost reservations and result reuse before enabling draft inference; then run isolated USDC validator acceptance and full authenticated browser coverage. Release and live spending still require the approvals explicitly reserved by the supplied directive. This run is an incremental implementation, not completion of all production phases.
