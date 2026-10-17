# EdgeBounty — Design System ("Datasheet")

## Brief (binding)

Build the EdgeBounty web app: dataset and model listings, funded requests, failure bounties,
verifier marketplace, seller upload, orders with USDC escrow, dashboards.
Used by ML engineers, researchers and dataset sellers, at the moment they decide whether a
dataset is worth paying for, or whether to fund a request, to make that decision on
**evidence** — what was actually checked, by whom, and where the money sits.
Constraints: desktop-first but fully usable at 360px; light and dark both designed; every
financial number is exact and never decorated; verification never reads as a guarantee.

## References

Evaluated: Stripe, Linear, Vercel, Together AI, Replicate, Mercury, Supabase, Coinbase,
WIRED, Hugging Face, Kaggle, Refero Styles library. `docs/design/references/` holds the
DESIGN.md teardowns that were pulled (stripe, together.ai, replicate, mercury, wired).

| Reference | Role | Why it won |
|---|---|---|
| **Stripe** (stripe.com) | Primary: layout and financial trust | White canvas with cool off-white bands. The hero is the product UI, not an illustration. Numbers are tabular. One filled CTA per band. This is the bar for "I trust this with money". |
| **Replicate** (replicate.com) | Interaction: marketplace browsing | A model/dataset catalogue where each card carries real technical metadata. Search is the main entry point. Uses a code-forward detail layout. |
| **WIRED** (wired.com) | Visual identity: editorial language | Serif display over a grotesk UI, mono kickers, hairline and heavy rules, broadsheet density. |

Rejected: Linear/Mercury/Together (dark-first purple/indigo or gradient chrome, the AI-SaaS
default), Supabase (near-black + emerald, which was the *old* EdgeBounty look), Coinbase (crypto
exchange: wrong emphasis), Hugging Face/Kaggle (we must not clone them).

## Concept: the dataset as a datasheet

Datasets live in research papers: *Datasheets for Datasets*, booktabs tables,
"Fig. 1" captions, footnoted claims. EdgeBounty's job is to separate what the
seller **claims** from what was **checked**. A research paper has exactly the right
vocabulary for that: tables with heavy top/bottom rules, footnotes for claims, figure captions
that say what you are looking at.

Three directions were considered:
1. *Data constellation*: nodes and links on dark. Rejected: generic, and it carries no information.
2. *Vault / exchange terminal*: dark trading-desk density. Rejected: it reads as a crypto casino and hides the evidence.
3. **Datasheet** (chosen). A paper-white canvas with booktabs rules. Evidence is shown as a ladder,
   and settlement as an exact ledger line. It is the only direction where the visuals *are* the trust argument.

**Signature:** the *Datasheet figure*, a typeset specimen of a listing ("Fig. 1") on the
homepage hero. Rows set in, the evidence ladder fills rung by rung, and the escrow line splits
into seller and platform shares. The same evidence ladder and ledger line then recur, live, on every real listing,
order and request page.

## Color

The product is always light ("Paper"): a marketplace handling money should feel open and daylit. Dark ("Night ledger") tokens exist only for preview on /design-system.

| Token | Light | Dark | For | Never |
|---|---|---|---|---|
| `paper` | `#F5F6F8` | `#0C0F17` | page canvas, cool-biased toward cobalt | cards |
| `panel` | `#FFFFFF` | `#131826` | cards, tables, inputs | page canvas |
| `sunk` | `#ECEEF3` | `#090C13` | wells, code, skeletons, preview frames | text backgrounds behind body copy |
| `ink` | `#0E1220` | `#E8EAF0` | text, **booktabs heavy rules**, primary button | — |
| `ink-2` | `#3A4152` | `#B7BDCB` | secondary text | metadata |
| `muted` | `#5F6678` | `#8C93A5` | metadata, captions, labels | prices, primary values |
| `line` | `#DDE0E7` | `#232A3B` | hairlines, card borders | heavy rules |
| `accent` (cobalt) | `#2A3BD9` | `#8A99FF` | primary action, focus ring, live/active state, the signature figure | body type, numerals, metadata, decoration |
| `good` | `#12734A` | `#4CC38A` | settled, criteria met, confirmed on-chain | "verified" claims about quality |
| `warn` | `#9A5B00` | `#E3A548` | pending, awaiting, untested, demo-only | — |
| `bad` | `#B4271F` | `#F07A70` | failed, disputed, mismatch, errors | — |

Cobalt was chosen from the subject. It is stamp-ink blue: the colour of certificate stamps and
ledger rules, and the colour USDC users already associate with settlement. It is a flat ink,
never a gradient, and never drifts to violet. **Placement rule:** at most two cobalt elements per
viewport, the primary action and one focal element.

## Typography

All faces are SIL Open Font License (free for commercial use), self-hosted through `next/font`.

| Role | Face | Spec |
|---|---|---|
| Display (h1–h2, hero, section and card titles) | **Gloock** (Duarte Pinto) | 400, tracking +0.005em, leading 1.1–1.15, no italics (emphasis by colour), `text-wrap: balance` |
| UI + body | **Schibsted Grotesk** (Bakken & Bæck) | 400/500/600, body 15px/1.55, max 68ch |
| Data: hashes, numerals, all prices and amounts, kickers, table figures | **IBM Plex Mono** | 400/500, `tabular-nums`, kickers 11px uppercase +0.08em |

Why: Gloock is a high-contrast display serif with the weight of a printed journal headline, and it is rarely
used on AI products. Schibsted Grotesk was drawn for a newspaper group: plain, sturdy, built for long reading.
Plex Mono keeps hashes and amounts exact and tabular.
Rejected: Inter, Space Grotesk, Fraunces, Instrument Serif (AI defaults), Geist (Vercel's identity). Newsreader + IBM Plex Sans was v1.

Scale (ratio ≈1.25): 12 · 13 · 15 (body) · 18 · 22 · 28 · 40 · 56/72 (hero only).
Section titles are 28 (≈1.9× body). Hierarchy otherwise comes from weight, rules and space.

## Layout

- Container 1200px (`max-w-6xl` + 24px gutters, 16px under 640px).
- 4px base spacing. Section rhythm 96 / 64 / 40px (desktop / tablet / mobile).
- 12-column grid. Detail pages split 8/4 with a sticky purchase rail.
- Breakpoints: Tailwind defaults (640/768/1024/1280). Nav collapses below 1024.
- Radii: 2px (chips, inputs), 6px (cards, buttons). Paper is not pill-shaped.
- Elevation: canvas < panel (1px `line`) < raised (1px line + `0 1px 2px` ink/6%). There are no shadow stacks.

## Components (in `apps/web/src/components/ui.tsx`)

`Page` (kicker + serif title + rule), `Card` (a ruled section: heavy ink top rule, no box), `PageLoading`, `EscrowTrack`, `Button` (primary ink / accent / ghost /
danger), `Field` + `inputCls`, `Badge` (square chips), `StateBadge`, `Hash`, `KV` (booktabs
definition list), `Tabs` (underline, animated), `LinkCard`, `Notice`, `ErrorNote`, `Empty`,
`Skeleton`, `EvidenceLadder`, `LedgerLine`, `Kicker`, `Figure`. Every interactive element has
hover, focus-visible (2px cobalt ring, 2px offset), active and disabled states.

### Evidence ladder (verification honesty)

Four rungs map **exactly** to backend levels (`L1`–`L4`):
L1 *Technical checks* (files open, formats, duplicates) · L2 *Sampled AI review* · L3 *Advanced review*
(budget-capped, sampled) · L4 *Human review*. A rung fills only when a report at that level exists.
"Seller claim" is shown separately in italic serif with a footnote mark. The ladder never says
"verified" alone: the copy is always "*Checked at L2: criteria met*" plus the report's own limitations.

### Ledger line (money honesty)

Amounts are always Plex Mono with tabular numerals, right-aligned, and come from the API or
`@edgebounty/pricing-engine`. The ledger never shows a computed split that the pricing engine did not produce.
Transaction states: *not connected → awaiting signature → submitted → confirming → confirmed*.
A submitted transaction is never styled as confirmed.

## Motion

- Durations: 120ms (hover/press), 200ms (tabs, chips), 320ms (reveals), 1.6s (hero sequence, once).
- Easing: `cubic-bezier(.2,.7,.2,1)` (out), `cubic-bezier(.6,0,.2,1)` (in-out). No bounce.
- Only `transform` and `opacity` are animated. Reveals rise 8px. Card hover lifts the rule, not the card.
- The hero figure plays once. `prefers-reduced-motion` renders its final state with no movement.
- Loading uses skeletons in `sunk`, never spinners over financial values.

## Copy rules

Name the pain, then the mechanism. Say "USDC held in escrow by a Solana program", not "trustless".
Say "checked at L2", never "verified dataset". Never write "seamless", "unlock", "revolutionary" or
"next-generation". See `docs/design/copy-audit.md`.

## Internal showcase

`/design-system` renders tokens, the type specimen with a live font switcher, components, states,
the evidence ladder and ledger line. It uses clearly-labelled example data and is excluded from navigation and
indexing (`robots: noindex`).
