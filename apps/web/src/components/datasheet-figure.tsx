/**
 * Homepage signature: a typeset specimen of a listing ("Fig. 1"). Example values only — it illustrates how a real
 * listing page presents evidence and settlement, and is labelled as such.
 * CSS-only animation, plays once; under prefers-reduced-motion it renders its final state.
 */
const d = (ms: number) => ({ animationDelay: `${ms}ms` });

const SPEC: [string, string][] = [
  ['Files', '48,210'],
  ['Size', '31.4 GB'],
  ['Formats', 'PNG · CSV labels'],
  ['License', 'CC-BY-4.0'],
  ['Commitment', '7f3a9e…08c91e'],
];

const RUNGS: [string, string, string, boolean][] = [
  ['L1', 'Technical checks', '0 corrupt · 14 exact duplicates', true],
  ['L2', 'Full-dataset quality checks', 'passed', true],
  ['L3', 'Sampled AI review', 'relevance 96.1% · 95% CI 94.0–97.6 · n=400', true],
  ['L4', 'Human review', 'not run', false],
];

export function DatasheetFigure() {
  return (
    <figure className="relative">
      <div className="border-y-[3px] border-ink">
        <div className="flex items-center justify-between border-b border-ink/70 py-3">
          <span className="kicker">Dataset · image classification</span>
          <span className="kicker flex items-center gap-1.5 !text-warn">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-warn" aria-hidden="true" />
            Example
          </span>
        </div>
        <div className="grid gap-x-10 pb-6 pt-5 md:grid-cols-[1fr_1fr]">
          <div>
            <h3 className="display rise text-[30px] leading-tight sm:text-[34px]" style={d(80)}>
              Street-level signage, 12&nbsp;cities
            </h3>
            <p className="rise mt-1.5 text-[15px] text-muted" style={d(140)}>
              Seller <span className="text-ink-2">northbound-labs</span> · version 3
            </p>
            <table className="mt-5 w-full border-t border-ink/70 text-[15px]">
              <tbody>
                {SPEC.map(([k, v], i) => (
                  <tr key={k} className="rise border-b border-line last:border-0" style={d(220 + i * 70)}>
                    <td className="py-2 text-muted">{k}</td>
                    <td className={`py-2 text-right ${k === 'Commitment' ? 'mono text-ink-2' : 'num'}`}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-7 md:mt-1">
            <p className="kicker mb-3">Completed checks</p>
            <ol className="border-t border-ink/70 text-[15px]">
              {RUNGS.map(([l, name, note, done], i) => (
                <li key={l} className="rise grid grid-cols-[30px_1fr] items-baseline gap-x-3 border-b border-line py-2 last:border-0" style={d(640 + i * 160)}>
                  <span className={`num flex h-5 items-center justify-center rounded-[2px] text-[11px] ${done ? 'bg-ink text-paper' : 'border border-line text-muted'}`}>{l}</span>
                  <span className={done ? 'text-ink' : 'text-muted'}>{name}</span>
                  <span className={`col-start-2 text-[13px] ${done ? 'mono text-ink-2' : 'text-muted'}`}>{note}</span>
                </li>
              ))}
            </ol>
            <p className="rise mt-4 font-serif text-[16px] italic leading-snug text-ink-2" style={d(1300)}>
              “Every label hand-checked.”<sup className="not-italic text-muted">*</sup>
              <span className="mt-1 block font-sans text-[13px] not-italic text-muted">* seller statement; not assessed by EdgeBounty</span>
            </p>
          </div>
        </div>

        <div className="rise border-t border-ink/70 py-4" style={d(1450)}>
          <div className="flex items-baseline justify-between">
            <span className="kicker">Held in escrow</span>
            <span className="num text-[22px]">240.00 USDC</span>
          </div>
          <div className="mt-3 flex h-2 overflow-hidden rounded-[1px]" aria-hidden="true">
            <span className="h-full origin-left bg-ink [animation:fill-x_900ms_var(--ease-out)_1650ms_both]" style={{ width: '94%' }} />
            <span className="h-full origin-left bg-accent [animation:fill-x_500ms_var(--ease-out)_2400ms_both]" style={{ width: '6%' }} />
          </div>
          <div className="mt-2.5 flex justify-between text-[13px]">
            <span className="text-ink-2">
              Seller on settlement <span className="num text-ink">225.60</span>
            </span>
            <span className="text-ink-2">
              Platform 6% <span className="num text-ink">14.40</span>
            </span>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-[13px] leading-relaxed text-muted">
        <span className="font-medium text-ink">Fig. 1.</span> A buyer’s view of a listing: completed checks, seller statements and the escrow balance. The 6% platform fee is deducted from the seller’s share at settlement. Values are illustrative.
      </figcaption>
    </figure>
  );
}
