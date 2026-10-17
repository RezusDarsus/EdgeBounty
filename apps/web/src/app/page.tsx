import Link from 'next/link';
import { CatalogDiscovery } from '@/components/catalog-discovery';
import { DatasheetFigure } from '@/components/datasheet-figure';

const ESCROW: [string, string, string][] = [
  ['Funded', 'The buyer signs one transaction. USDC moves into a vault controlled by the EdgeBounty program — not by us, and not by the seller.', 'funded'],
  ['Delivered', 'The seller uploads to private storage. A fingerprint of that exact version is recorded on-chain; the files themselves are not.', 'submitted'],
  ['Reviewed', 'Checks run on the delivered version. The buyer approves, asks for a correction, or opens a dispute.', 'under_review'],
  ['Settled', 'Funds release once: 94% to the seller, 6% platform fee. Only then does the full download unlock.', 'settled'],
];

const INDEX: [string, string, string][] = [
  ['/datasets', 'Datasets', 'Image, tabular and text data with previews, schemas and check reports.'],
  ['/models', 'Models', 'ONNX models with static inspection and sandboxed benchmark results.'],
  ['/bounties', 'Funded requests', 'Commissioned data work with the budget already in escrow.'],
  ['/failure-bounties', 'Failure bounties', 'Pay for confirmed examples where a model gets it wrong.'],
  ['/providers', 'Verifiers', 'Independent reviewers you can add to an order, paid for the work — not for a pass.'],
];

const LEVELS: [string, string, string, string][] = [
  ['L1', 'Technical checks', 'Checks attempt to open and parse files within the verification budget. Reports count detected corruption, exact duplicates, image sizes and null cells.', 'Free within limits'],
  ['L2', 'Structural and sample checks', 'Budgeted file and schema checks report detected corruption, duplicates and structural findings. Read the report for the actual scope and untested requirements.', 'Paid by seller'],
  ['L3', 'Advanced review', 'Deeper sampled AI analysis within a capped budget, plus text-similarity checks against the seller’s own earlier uploads.', 'Paid by seller'],
  ['L4', 'Human review', 'A person reviews the delivery against the stated criteria. Quoted case by case.', 'Quoted manually'],
];

const more = 'inline-flex items-center gap-2 text-sm font-medium underline decoration-line underline-offset-4 transition-colors hover:decoration-ink';

export default function Home() {
  return (
    <main>
      {/* Hero: one message, one primary action — then the datasheet, which is the argument */}
      <section className="mx-auto max-w-6xl px-4 pb-20 pt-12 sm:px-6 md:pt-20">
        <div className="rise grid items-end gap-x-16 gap-y-8 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <p className="kicker mb-6">Datasets · models · funded requests — settled in USDC on Solana</p>
            <h1 className="display text-[42px] sm:text-[54px] lg:text-[62px]">
              Find the data your AI needs. <em className="text-ink-2">Fund the data that doesn’t exist.</em>
            </h1>
          </div>
          <div className="lg:pb-2">
            <p className="max-w-[46ch] text-[17px] leading-relaxed text-ink-2">
              Every listing shows which checks actually ran on the exact files you’d receive — and which statements are only the seller’s. Your USDC waits in a Solana escrow until the data is delivered.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link href="/datasets" className="inline-flex h-11 items-center gap-2 rounded-md bg-accent px-5 text-[15px] font-medium text-accent-ink transition-colors hover:bg-[color-mix(in_oklab,var(--accent),var(--ink)_18%)]">
                Explore marketplace <span aria-hidden="true">→</span>
              </Link>
              <Link href="/bounties/new" className={more}>
                Create a bounty
              </Link>
            </div>
          </div>
        </div>
        <div className="mt-14 md:mt-16">
          <DatasheetFigure />
        </div>
      </section>

      <CatalogDiscovery />

      {/* The two problems */}
      <section className="border-y border-line bg-panel">
        <div className="mx-auto grid max-w-6xl px-4 sm:px-6 md:grid-cols-2">
          <article className="border-b border-line py-14 md:border-b-0 md:border-r md:py-20 md:pr-12">
            <p className="kicker mb-5">For buyers</p>
            <h2 className="display text-[30px] md:text-[34px]">The dataset you need is for sale somewhere. You just can’t tell if it’s any good.</h2>
            <p className="mt-4 max-w-[52ch] text-ink-2">
              Sample previews, schemas and check reports for the exact version on sale. Seller claims are marked as claims. If the delivered files don’t match what was listed, the fingerprint won’t either.
            </p>
            <Link href="/datasets" className={`mt-6 ${more}`}>
              Browse datasets and models <span aria-hidden="true">→</span>
            </Link>
          </article>
          <article className="py-14 md:py-20 md:pl-12">
            <p className="kicker mb-5">For teams with a gap</p>
            <h2 className="display text-[30px] md:text-[34px]">Or it doesn’t exist yet, and you need someone to make it.</h2>
            <p className="mt-4 max-w-[52ch] text-ink-2">
              Post a request — say, 20,000 labelled images of corroded pipe joints — with the budget in escrow and pass/fail criteria fixed up front. Contributors can see the money is there; you only pay for work that meets the criteria.
            </p>
            <Link href="/bounties/new" className={`mt-6 ${more}`}>
              Write a funded request <span aria-hidden="true">→</span>
            </Link>
          </article>
        </div>
      </section>

      {/* What "checked" means */}
      <section className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 md:py-28 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <p className="kicker mb-5">What “checked” means here</p>
          <h2 className="display text-[30px] md:text-[34px]">
            Four levels of evidence. Each listing shows which ones actually ran.<sup className="ml-0.5 text-[0.55em] text-muted">†</sup>
          </h2>
          <p className="mt-4 max-w-[48ch] text-ink-2">
            Checks run on the version you’d buy, and their reports stay attached to it. Higher levels cost the seller more, so not every listing has them — and that is shown, not hidden.
          </p>
          <p className="mt-8 max-w-[48ch] border-t border-line pt-4 text-sm text-ink-2">
            <span className="mr-1 font-serif text-base text-ink">†</span>
            <span className="font-medium text-ink">What a check is not.</span> A report is evidence about a sample, with stated limitations. It is not a guarantee that a dataset is correct, legal for your use, or good for your model.
          </p>
        </div>
        <ol className="self-start border-y-[3px] border-ink">
          {LEVELS.map(([l, name, desc, cost]) => (
            <li key={l} className="grid grid-cols-[40px_1fr] gap-4 border-b border-line py-5 last:border-0 sm:grid-cols-[40px_1fr_120px]">
              <span className="num mt-0.5 flex h-6 items-center justify-center rounded-[2px] border border-ink/60 text-xs text-ink">{l}</span>
              <div>
                <h3 className="font-medium">{name}</h3>
                <p className="mt-1 text-sm text-ink-2">{desc}</p>
              </div>
              <span className="col-start-2 text-xs text-muted sm:col-start-auto sm:pt-1 sm:text-right">{cost}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Where the money is */}
      <section className="border-t border-line bg-panel">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 md:py-28 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <p className="kicker mb-5">Where your money is, at every step</p>
            <h2 className="display text-[30px] md:text-[34px]">Payment moves on the program’s rules — once — and each move is on the record.</h2>
            <p className="mt-4 max-w-[48ch] text-ink-2">
              If review fails, the buyer can ask for a correction or open a dispute. Silence through the review window counts as approval. A refund returns the full escrowed amount.
            </p>
            <Link href="/how-escrow-works" className={`mt-6 ${more}`}>
              What the chain proves, and what it doesn’t <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div>
            <ol className="border-y-[3px] border-ink">
              {ESCROW.map(([t, desc, state], i) => (
                <li key={t} className="grid grid-cols-[20px_1fr] gap-4 border-b border-line py-5 last:border-0 sm:grid-cols-[20px_1fr_110px]">
                  <span className="mt-2.5 flex justify-center" aria-hidden="true">
                    <span className={`h-2.5 w-2.5 rounded-full ${i === ESCROW.length - 1 ? 'bg-accent' : 'border-[1.5px] border-ink bg-panel'}`} />
                  </span>
                  <div>
                    <h3 className="display text-[22px]">{t}</h3>
                    <p className="mt-1 text-sm text-ink-2">{desc}</p>
                  </div>
                  <span className="mono col-start-2 text-xs text-muted sm:col-start-auto sm:pt-2 sm:text-right">{state}</span>
                </li>
              ))}
            </ol>
            <table className="mt-8 w-full text-[15px]">
              <caption className="kicker mb-3 text-left">Settlement of a 240.00 USDC sale — example</caption>
              <tbody>
                <tr className="border-y border-line">
                  <td className="py-2 text-ink-2">Seller receives (94%)</td>
                  <td className="num py-2 text-right">225.60</td>
                </tr>
                <tr className="border-b border-ink">
                  <td className="py-2 text-ink-2">Platform fee (6%)</td>
                  <td className="num py-2 text-right">14.40</td>
                </tr>
                <tr>
                  <td className="py-2.5 font-medium">Released from escrow</td>
                  <td className="num py-2.5 text-right font-medium">240.00 USDC</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Index */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <p className="kicker mb-5">Index</p>
            <h2 className="display text-[30px] md:text-[34px]">Where to start.</h2>
            <p className="mt-4 max-w-[42ch] text-ink-2">
              Selling instead? A listing goes live once the exact version passes an L2 or L3 check. L1 technical checks are free within a monthly allowance.
            </p>
            <Link href="/sell" className="mt-6 inline-flex h-10 items-center rounded-md bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-ink-2">
              List a dataset or model
            </Link>
          </div>
          <ul className="border-y-[3px] border-ink">
            {INDEX.map(([href, t, desc]) => (
              <li key={href} className="border-b border-line last:border-0">
                <Link href={href} className="group grid grid-cols-[1fr_auto] items-baseline gap-4 py-5 transition-colors hover:bg-panel sm:px-2">
                  <span>
                    <span className="display block text-[22px]">{t}</span>
                    <span className="mt-1 block text-sm text-ink-2">{desc}</span>
                  </span>
                  <span aria-hidden="true" className="text-muted transition-transform duration-200 group-hover:translate-x-1 group-hover:text-ink">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
