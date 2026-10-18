import Link from 'next/link';
import evidence from '@/data/hackathon-evidence.json';

const link = 'inline-flex min-h-11 items-center text-sm font-medium underline decoration-line underline-offset-4 hover:decoration-ink';
const displayName = (name: string) => name.replace(/^hackathon-/i, '').replace(/^./, c => c.toUpperCase());
const usdc = (value: string) => (BigInt(value) / 1_000_000n).toString();

/** A published snapshot of consenting operator-owned demo accounts, never private user data. */
export function HackathonEvidence() {
  const total = evidence.progress;
  const providerEvent = evidence.events.find(e => e.payload && 'provider' in e.payload && e.payload.provider === 'nvidia');
  return (
    <section id="hackathon" aria-labelledby="hackathon-title" className="scroll-mt-20 border-y border-line bg-panel">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 md:py-16">
        <div className="grid gap-6 border-b border-line pb-7 md:grid-cols-[1.2fr_1fr]">
          <div>
            <h2 id="hackathon-title" className="display text-3xl md:text-4xl">Five contributors. One company dataset.</h2>
            <p className="mt-4 max-w-[65ch] text-ink-2">Follow the hackathon run for {evidence.company}: real photo uploads, paid file checks, a duplicate replacement and buyer approval, with help from the AI agents.</p>
          </div>
          <div className="self-end text-sm leading-relaxed text-ink-2">
            <p>These are five operator-created seller accounts and a demo company, not independent customers. Transactions use mock USDC on a private validator.</p>
            <p className="mt-2">Recorded {new Date(evidence.createdAt).toISOString().slice(0, 10)}. This is a published run snapshot; the authenticated workspace holds current state.</p>
          </div>
        </div>

        <div className="grid gap-8 py-8 md:grid-cols-[1fr_1.2fr]">
          <figure>
            {/* NASA's public source image is the same photograph uploaded to private storage. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={evidence.sources[0].image} alt={evidence.sources[0].title} width={720} height={480} loading="lazy" className="aspect-[3/2] w-full bg-paper object-contain" />
            <figcaption className="mt-3 text-xs leading-relaxed text-ink-2">Actual photograph supplied by Giorgi’s demo account. Credit: NASA / {evidence.sources[0].credit}. <a href={evidence.sources[0].source} className="underline">Original source</a>. No NASA endorsement.</figcaption>
          </figure>
          <div>
            <h3 className="text-xl font-medium">What happened to this upload</h3>
            <ol className="mt-4 space-y-3 text-sm leading-relaxed text-ink-2">
              <li>Giorgi uploaded the photograph to private storage. The L2 report passed readability, format, resolution and exact-duplicate criteria for his uploaded version.</li>
              <li>Nika submitted the same photograph. Cross-seller comparison counted it as one duplicate, without increasing accepted progress.</li>
              <li>Nika’s agent proposed one replacement. Nika supplied a different photograph, then the demo buyer inspected and approved all five distinct contributions.</li>
              <li>The combined five-image dataset ran through L3, including sampled AI relevance checks. The report passed its stated criteria.</li>
            </ol>
            <p className="mt-4 text-xs leading-relaxed text-muted">Passing these checks does not establish authorship, legal rights or whether an image is AI-generated. The original NASA sources identify these as photographs; the service checks the submitted files.</p>
            <Link href={`/listings/${evidence.dataset.listingId}`} className={link}>Open the uploaded dataset and report →</Link>
          </div>
        </div>

        <div className="border-y border-line py-6">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="text-xl font-medium">{total.accepted} of {total.target} unique photographs accepted</h3>
            <p className="font-mono text-sm tabular-nums">{total.submitted} submitted · {total.duplicates} duplicate · {total.remaining} remaining</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Contribution totals from the recorded live hackathon run</caption>
              <thead className="border-y border-line text-left text-muted"><tr><th scope="col" className="py-3 pr-4 font-medium">Demo seller / agent</th><th scope="col" className="px-3 py-3 text-right font-medium">Submitted</th><th scope="col" className="px-3 py-3 text-right font-medium">Duplicates</th><th scope="col" className="px-3 py-3 text-right font-medium">Accepted</th></tr></thead>
              <tbody>{evidence.contributors.map(c => <tr key={c.name} className="border-b border-line"><th scope="row" className="py-3 pr-4 text-left font-medium">{displayName(c.name)} <span className="font-normal text-muted">/ {c.agentStatus}</span></th><td className="px-3 text-right font-mono tabular-nums">{c.submitted ?? 0}</td><td className="px-3 text-right font-mono tabular-nums">{c.duplicates ?? 0}</td><td className="px-3 text-right font-mono tabular-nums">{c.accepted ?? 0}</td></tr>)}</tbody>
              <tfoot><tr><th scope="row" className="py-3 text-left">Company total</th><td className="px-3 text-right font-mono">{total.submitted}</td><td className="px-3 text-right font-mono">{total.duplicates}</td><td className="px-3 text-right font-mono">{total.accepted}</td></tr></tfoot>
            </table>
          </div>
          <p className="mt-4 text-sm text-ink-2">The buyer froze a 500 mock-USDC gross allocation: {evidence.manifest.allocations.map(a => `${usdc(a.grossMicro)} per accepted contributor`).filter((v,i,a) => a.indexOf(v) === i).join(', ')}. This is approved accounting; this demo does not claim seller payments.</p>
          <Link href={`/orders/${evidence.bountyId}`} className={link}>Open the company workspace (participant sign-in required) →</Link>
        </div>

        <div className="grid gap-8 py-8 lg:grid-cols-2">
          <article>
            <h3 className="text-xl font-medium">The AI assistant’s actual response</h3>
            <p className="mt-2 break-words text-xs text-muted">NVIDIA · {evidence.assistant.model} · recorded response</p>
            <blockquote className="mt-4 whitespace-pre-line text-sm leading-relaxed text-ink-2">{evidence.assistant.answer}</blockquote>
            {providerEvent && 'explanation' in providerEvent.payload && <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer py-2 text-sm font-medium">Read Nika’s NVIDIA agent proposal</summary><p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-2">{String(providerEvent.payload.explanation)}</p><p className="mt-3 text-xs text-muted">This response imprecisely called the duplicate “accepted.” The coordinator excluded it. Authoritative counts come from file evidence and buyer decisions, independently of model wording.</p></details>}
            <p className="mt-4 text-xs text-muted">AI suggestions did not approve images, sign transactions or release funds. Provider capacity errors occurred earlier in the run; these displayed responses completed successfully.</p>
            <Link href="/assistant" className={link}>Use the AI assistant →</Link>
          </article>
          <article>
            <h3 className="text-xl font-medium">Models uploaded through the same pipeline</h3>
            <p className="mt-3 text-sm leading-relaxed text-ink-2">Two small ONNX color classifiers were uploaded, checked and published. They demonstrate model inspection, not space-image recognition or measured real-world accuracy.</p>
            <ul className="mt-4 divide-y divide-line">{evidence.models.map(m => <li key={m.listingId} className="py-3"><Link href={`/listings/${m.listingId}`} className={link}>{m.name} →</Link><p className="text-xs text-ink-2">L2 report: {m.report.passed ? 'stated checks passed' : 'checks did not pass'}. Open the listing to inspect the scope.</p></li>)}</ul>
            <div className="mt-5 flex flex-wrap gap-x-6"><Link href="/datasets" className={link}>Browse datasets →</Link><Link href="/models" className={link}>Browse models →</Link></div>
          </article>
        </div>

        <details className="border-t border-line py-4">
          <summary className="cursor-pointer py-3 text-sm font-medium">What the five scoped agents proposed</summary>
          <p className="mt-2 text-sm text-ink-2">Recorded coordination proposals from earlier in the run, before final acceptance. These messages use the deterministic coordinator; NVIDIA enrichment is labelled separately above. Proposals reserve no work or funds without human approval.</p>
          <ul className="mt-4 divide-y divide-line">{evidence.contributors.map(c => {
            const event = evidence.events.find(e => e.agentId === c.agentId && 'explanation' in e.payload && !('provider' in e.payload));
            return <li key={c.agentId} className="py-4"><h4 className="text-sm font-medium">{displayName(c.name)} Agent</h4><p className="mt-2 text-sm leading-relaxed text-ink-2">{event && 'explanation' in event.payload ? String(event.payload.explanation) : `Recorded ${c.accepted ?? 0} accepted photograph; no earlier work proposal is present in this snapshot.`}</p></li>;
          })}</ul>
          <p className="mt-3 text-sm font-medium">Final shared result: five accepted photographs for the company, one duplicate replaced, no remaining work.</p>
        </details>

        <details className="border-t border-line pt-4">
          <summary className="cursor-pointer py-3 text-sm font-medium">Inspect the evidence and photo sources</summary>
          <p className="mt-3 text-sm text-ink-2">The public snapshot contains only this operator-owned demo’s reports, source credits, agent events and allocation. It contains no sessions, private keys or storage URLs.</p>
          <a href="/hackathon-evidence.json" download className={link}>Download the recorded JSON evidence →</a>
          <ul className="mt-3 space-y-3 text-sm text-ink-2">{evidence.sources.map(s => <li key={s.id}><a href={s.source} className="underline">{s.title}</a> — NASA / {s.credit}</li>)}</ul>
          <p className="mt-4 text-xs text-muted">Photo use follows <a href="https://www.nasa.gov/nasa-brand-center/images-and-media/" className="underline">NASA’s media guidelines</a>. Source rights are retained; no exclusive rights or NASA endorsement are offered.</p>
        </details>
      </div>
    </section>
  );
}
