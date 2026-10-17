import Link from 'next/link';

const steps = [
  ['Fund', 'Buyers escrow USDC in a program-controlled vault. Terms and acceptance criteria are hashed on-chain and cannot change.'],
  ['Deliver privately', 'Sellers upload to private storage. A salted manifest commitment identifies the exact version — no file ever touches the chain.'],
  ['Verify', 'Automated checks and independent verifiers evaluate the submission and sign an attestation of their result.'],
  ['Settle', 'Approval, silence after the review window, or a dispute ruling releases funds exactly once. Then — and only then — the buyer downloads.'],
];

const markets = [
  ['/datasets', 'Datasets', 'Image, tabular and structured datasets with previews and verification reports.'],
  ['/models', 'Models', 'ONNX models benchmarked in a sandbox against independent, versioned test sets.'],
  ['/bounties', 'Funded requests', 'Commission custom datasets or models with escrowed budgets and objective criteria.'],
  ['/failure-bounties', 'Failure bounties', 'Pay contributors for verified examples where your model fails.'],
  ['/providers', 'Verifiers', 'Approved providers sell reproducible evaluations — paid for the work, not for a pass.'],
];

export default function Home() {
  return (
    <main>
      <section className="mx-auto max-w-6xl px-4 pb-12 pt-16">
        <p className="mono mb-4 text-accent">Solana · USDC escrow · signed attestations</p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight md:text-5xl">The AI marketplace where work is funded, evaluated, licensed and settled through verifiable contracts.</h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">
          Buy and sell datasets and models, commission development work, and pay for independent verification — with escrow and settlement rules enforced by a Solana program while the assets themselves stay private.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/bounties/new" className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink">
            Fund a request
          </Link>
          <Link href="/sell" className="rounded-lg border border-line bg-panel px-5 py-2.5 text-sm font-medium">
            Sell a dataset or model
          </Link>
        </div>
      </section>

      <section className="border-y border-line bg-panel">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 md:grid-cols-4">
          {steps.map(([t, d], i) => (
            <div key={t}>
              <div className="mono text-muted">0{i + 1}</div>
              <h3 className="mt-1 font-semibold">{t}</h3>
              <p className="mt-1 text-sm text-muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-4 md:grid-cols-3">
          {markets.map(([href, t, d]) => (
            <Link key={href} href={href} className="rounded-xl border border-line bg-panel p-5 transition hover:border-accent">
              <h3 className="font-semibold">{t}</h3>
              <p className="mt-1 text-sm text-muted">{d}</p>
            </Link>
          ))}
        </div>
        <p className="mt-10 max-w-3xl text-sm text-muted">
          What the chain proves: who funded what, which exact version was submitted, which authorized verifier said what, and how funds were released. What it does not prove: that a verifier is right, or that a
          download happened — delivery is run by an accountable off-chain service. Attestations are evidence, not truth.
        </p>
      </section>
    </main>
  );
}
