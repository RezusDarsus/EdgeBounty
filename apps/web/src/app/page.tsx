import Link from 'next/link';
import { CatalogDiscovery } from '@/components/catalog-discovery';
import { RecentListings } from '@/components/recent-listings';
import { DatasheetFigure } from '@/components/datasheet-figure';
import { HackathonEvidence } from '@/components/hackathon-evidence';

const PAYMENT_CURRENCY = process.env.NEXT_PUBLIC_PAYMENT_CURRENCY === 'USDC' ? 'USDC' : 'SOL';
const ESCROW: [string, string, string][] = [
  ['Funded', `The buyer signs a transaction that places ${PAYMENT_CURRENCY} in a vault controlled by the EdgeBounty program.`, 'funded'],
  ['Delivered', 'The seller uploads the files to private storage. The chain records a fingerprint of that specific version, not the files themselves.', 'submitted'],
  ['Reviewed', 'Checks run against the delivered version. The buyer can approve it, request a correction or open a dispute.', 'under_review'],
  ['Settled', 'Funds are released once: 94% to the seller and 6% as the platform fee. Full downloads become available after settlement.', 'settled'],
];

const INDEX: [string, string, string][] = [
  ['/datasets', 'Datasets', 'Image, tabular and text data, with previews, schemas and reports on completed checks.'],
  ['/models', 'Models', 'ONNX models with static inspection and benchmark results from an isolated environment.'],
  ['/bounties', 'Funded requests', 'Commission data collection with the agreed budget held in escrow.'],
  ['/failure-bounties', 'Failure bounties', 'Submit examples that demonstrate a model failure and earn a reward when confirmed.'],
  ['/providers', 'Verifiers', 'Engage independent reviewers for an order. Providers are paid for their work, regardless of the verdict.'],
];

const LEVELS: [string, string, string, string][] = [
  ['L1', 'Technical checks', 'Files are opened and parsed within the verification budget. Reports identify detected corruption, exact duplicates, image dimensions and null values.', 'Free within limits'],
  ['L2', 'Full-dataset quality checks', 'Budgeted structural and quality checks inspect the files and report detected corruption, duplicates and other findings.', 'Paid by seller'],
  ['L3', 'Sampled AI review', 'A budgeted AI review estimates relevance from a sample and reports its sample size, confidence range and limitations.', 'Paid by seller'],
  ['L4', 'Human review', 'A reviewer assesses the delivery against the stated criteria. The service is quoted individually.', 'Quoted individually'],
];

const more = 'inline-flex items-center gap-2 text-sm font-medium underline decoration-line underline-offset-4 transition-colors hover:decoration-ink';

export default function Home() {
  return (
    <main>
      {/* Hero: one message, one primary action — then the datasheet, which is the argument */}
      <section className="mx-auto max-w-6xl px-4 pb-20 pt-12 sm:px-6 md:pt-20">
        <div className="rise grid items-end gap-x-16 gap-y-8 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <p className="kicker mb-6">Datasets · models · funded requests · {PAYMENT_CURRENCY} escrow on Solana</p>
            <h1 className="display text-[42px] sm:text-[54px] lg:text-[62px]">
              Find the data your AI needs. <em className="text-ink-2">Commission what does not exist yet.</em>
            </h1>
          </div>
          <div className="lg:pb-2">
            <p className="max-w-[46ch] text-[17px] leading-relaxed text-ink-2">
              Each listing distinguishes checks performed on the exact files offered from claims made by the seller. Your payment remains in Solana escrow until delivery; the network and payment token are shown beside funding actions.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link href="/datasets" className="inline-flex h-11 items-center gap-2 rounded-md bg-accent px-5 text-[15px] font-medium text-accent-ink transition-colors hover:bg-[color-mix(in_oklab,var(--accent),var(--ink)_18%)]">
                Explore the marketplace <span aria-hidden="true">→</span>
              </Link>
              <Link href="/bounties/new" className={more}>
                Create a funded request
              </Link>
              <a href="#hackathon" className={more}>See the hackathon demo</a>
            </div>
          </div>
        </div>
        <div className="mt-14 md:mt-16">
          <DatasheetFigure />
        </div>
      </section>

      <HackathonEvidence />
      <CatalogDiscovery />
      <RecentListings />
      <section className="mx-auto max-w-6xl border-t border-line px-4 py-10 sm:px-6"><h2 className="display text-3xl">Turn your requirements into a clear plan with AI.</h2><p className="mt-3 max-w-[65ch] text-ink-2">Search published listings, prepare a funded request, draft metadata for an upload or review a verification report. You approve all content before publishing and authorize every payment.</p><Link href="/assistant" className="mt-5 inline-flex min-h-11 items-center rounded-md bg-accent px-5 text-sm font-medium text-accent-ink">Open the AI assistant</Link></section>

      {/* The two problems */}
      <section className="border-y border-line bg-panel">
        <div className="mx-auto grid max-w-6xl px-4 sm:px-6 md:grid-cols-2">
          <article className="border-b border-line py-14 md:border-b-0 md:border-r md:py-20 md:pr-12">
            <p className="kicker mb-5">For buyers</p>
            <h2 className="display text-[30px] md:text-[34px]">The dataset you need may already exist. Its quality is harder to assess.</h2>
            <p className="mt-4 max-w-[52ch] text-ink-2">
              Review sample previews, schemas and reports for the specific version offered. Seller statements are identified as claims. If the delivered files differ from the listed version, their fingerprint will differ as well.
            </p>
            <Link href="/datasets" className={`mt-6 ${more}`}>
              Browse datasets and models <span aria-hidden="true">→</span>
            </Link>
          </article>
          <article className="py-14 md:py-20 md:pl-12">
            <p className="kicker mb-5">For teams with a gap</p>
            <h2 className="display text-[30px] md:text-[34px]">When the data does not exist, commission its collection.</h2>
            <p className="mt-4 max-w-[52ch] text-ink-2">
              Publish a request, such as 20,000 labelled images of corroded pipe joints, with its budget in escrow and acceptance criteria agreed in advance. Contributors can confirm that funds are reserved, and payment follows the order’s acceptance terms.
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
          <p className="kicker mb-5">What a completed check tells you</p>
          <h2 className="display text-[30px] md:text-[34px]">
            Four levels of evidence. Every listing identifies the checks completed for its version.<sup className="ml-0.5 text-[0.55em] text-muted">†</sup>
          </h2>
          <p className="mt-4 max-w-[48ch] text-ink-2">
            Reports are linked to the version offered for sale. Higher-level checks cost more, so coverage varies by listing and is shown explicitly.
          </p>
          <p className="mt-8 max-w-[48ch] border-t border-line pt-4 text-sm text-ink-2">
            <span className="mr-1 font-serif text-base text-ink">†</span>
            <span className="font-medium text-ink">Limits of verification.</span> A report describes the checks performed and their limitations. It does not guarantee that a dataset is accurate, lawfully usable for your purpose or suitable for your model.
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
            <p className="kicker mb-5">How funds move through escrow</p>
            <h2 className="display text-[30px] md:text-[34px]">The program applies the agreed settlement rules once, with each transfer recorded on-chain.</h2>
            <p className="mt-4 max-w-[48ch] text-ink-2">
              If a delivery does not meet the review criteria, the buyer may request a correction or open a dispute. If the review period expires without action, the order is treated as approved. A refund returns the escrowed amount.
            </p>
            <Link href="/how-escrow-works" className={`mt-6 ${more}`}>
              What the blockchain records—and what it cannot establish <span aria-hidden="true">→</span>
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
            <caption className="kicker mb-3 text-left">Example settlement for a 240.00 USDC sale</caption>
              <tbody>
                <tr className="border-y border-line">
                  <td className="py-2 text-ink-2">Seller proceeds (94%)</td>
                  <td className="num py-2 text-right">225.60</td>
                </tr>
                <tr className="border-b border-ink">
                  <td className="py-2 text-ink-2">Platform fee (6%)</td>
                  <td className="num py-2 text-right">14.40</td>
                </tr>
                <tr>
                  <td className="py-2.5 font-medium">Total released from escrow</td>
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
            <p className="kicker mb-5">Explore EdgeBounty</p>
            <h2 className="display text-[30px] md:text-[34px]">Choose where to begin.</h2>
            <p className="mt-4 max-w-[42ch] text-ink-2">
              To sell an asset, publish its listing after the exact version passes an L2 or L3 check. L1 technical checks are free within the allowance, but do not qualify a listing for publication. L2 and L3 costs are quoted before the check starts.
            </p>
            <Link href="/sell" className="mt-6 inline-flex h-10 items-center rounded-md bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-ink-2">
              List a dataset or a model
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
