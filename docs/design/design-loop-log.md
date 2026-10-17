# Design loop log — Datasheet redesign

Method: the `design-loop` skill (github.com/devonbweaver/design-loop),
invoked as `/design-loop`. Critics ran as independent
fresh-context agents that saw only rendered screenshots (never code), plus the bar (DESIGN.md
and the skill's `craft-standards.md`). The limit was five repair rounds.

Evidence rendering: `apps/web/tests/visual.mjs` (Playwright driving the locally installed
Chrome) at 320 / 390 / 768 / 1280 / 1440px, light and dark, with reduced motion. The API could not
run in this environment, so populated marketplace screens use `apps/web/tests/fixtures.mjs`. These are
labelled test fixtures, injected only inside the test's network layer and never imported by the app.

| Round | Scope | Verdict | Defects found → fixed |
|---|---|---|---|
| 1 | Homepage | FAIL (Craft) | Signature figure too small and boxed like a SaaS card → full-width typeset figure with booktabs rules. Dark slab of identical escrow cards → ruled timeline plus exact ledger. Decorative 01–05 numbering removed. Template stat strip removed. Boxed callout → † footnote. |
| 2 | Home, marketplace, detail, bounties, escrow page | FAIL (Craft + System/UX/copy) | Homepage passed. Boxed panels everywhere → `Card` became a ruled section. No escrow line on the purchase rail → seller/platform split from `computePayout`. Inexact money (`240 USDC`) → `240.00 USDC` with grouping. Raw locale dates → `8 Oct 2026`. Placeholder thumbnails with excess cobalt → removed. Weak disabled button → sunk/muted state. Misaligned content edges fixed. "Hard cap 10%" read as a contradiction → "currently 6%; the program will not accept a fee above 10%". "Trustless" and "verified" copy removed. |
| 3 | Same + pricing, sell | FAIL (Craft) | Pricing prose quadrants → booktabs tables. Report numbers set in mono. † footnotes got anchors. Card rows aligned. Bounty chip clutter → one state chip plus a mono kicker. |
| 4 | Same | FAIL (Craft) | Duplicated L1/L2 report dumps → one comparative evidence table that highlights what changed between levels. Mono restricted to figures. Duplicate state label fixed. Type spec amended so all amounts are mono. |
| 5 | Same | FAIL on one item (Craft) | L2 column clipped at 390px → stacked per-level layout on phones (fixed after the round; verified by render, not re-judged, because the round limit was reached). |

Result: the homepage passed the Craft critic from round 2 onward and never regressed. Every other
round-N defect was confirmed fixed in round N+1. The round-5 mobile defect was fixed and verified
visually. A sixth critic pass was not run because of the five-round limit.

Open nits (non-blocking): the escrow page's mono state column is uneven; pricing rows rely on the
bracketing rows for the unit; the detail page leaves white space beside long tables.

Not covered by the loop (needs a running API, wallet and chain): signed-in dashboards, the
order page in each escrow state, the seller upload flow with real R2 uploads, and wallet modals.
These use the same shared components and passed type-checking and the production build, but were
not visually judged.
