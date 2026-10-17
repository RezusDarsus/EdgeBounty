# EdgeBounty 2.0 design decisions

Reviewed 2026-10-18. The existing design system is documented in [../DESIGN.md](../DESIGN.md); reusable components and the internal `/design-system` preview already exist. Preserve the application structure, evidence ladder, ledger breakdowns, and readable technical values.

The supplied 2.0 brief supersedes the earlier light-only decision: use the existing Night Ledger navy tokens for the application. Retain the established Gloock, Schibsted Grotesk and IBM Plex Mono families; the brief's Space Grotesk/Inter/JetBrains choices are suggestions, not requirements. Evaluate any typography replacement separately against real catalog content. Blue remains restrained; semantic colors retain their status meanings.

Reference principles: Linear's compact hierarchy, Mercury's explicit financial state and fee clarity, Hugging Face's metadata-driven discovery. These are conceptual references from the supplied brief and existing reference notes, not a claim of a fresh live reference-site evaluation. No proprietary artwork or brand assets are copied.

## Copy proposal recorded before changes

| Surface | Original | Replacement | Reason |
|---|---|---|---|
| Hero | Buy training data on evidence, not on a seller's word. | Find the data your AI needs. Fund the data that doesn't exist. | Supplied brief; expresses both buying and commissioning without a quality guarantee. |
| Main CTA | Browse datasets | Explore marketplace | Supplied brief; keeps the existing dataset route. |
| Secondary CTA | Fund data that doesn't exist yet | Create a bounty | Names the action and matches the brief. |
| L1 description | Every file opens | Checks attempt to open and parse files within the verification budget | Avoids an unconditional guarantee and reflects processing caps. |
| L2 description | Sampled AI review | Structural and sample checks | Source gates AI relevance review at L3; do not advertise L2 as an AI judgment. |

New discovery copy explicitly says keyword matching; it does not market deterministic search as an AI recommendation. New drafting copy discloses NVIDIA text sharing, requires review, and never claims a draft is funded.

## Components and evaluation

Tokens: `apps/web/src/app/globals.css`. Components: `ui.tsx` (buttons, fields, cards, status, ledger and loading), `nav.tsx`, `report.tsx`, `listings.tsx`. Discovery and draft controls reuse these primitives. Focus rings and reduced-motion rules remain active. Default dark rendering uses the existing dark palette rather than scattered color replacements.

Use `scripts/review-ui.mjs` for real desktop/mobile captures and interaction checks. Each UI scope gets one batched inspection, one repair batch if needed, then confirmation. Record evidence and unresolved issues; do not invent an 85/100 result or claim complete WCAG conformance from an automated smoke check.
