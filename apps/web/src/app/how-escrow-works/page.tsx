import { Page } from '@/components/ui';

const STEPS: [string, string, string][] = [
  ['Funded', 'The buyer funds the order. USDC moves into a vault owned by the order’s program address — neither EdgeBounty nor the seller can move it.', 'funded'],
  ['Terms fixed', 'Terms, acceptance criteria and the license are hashed on-chain at funding. The platform fee (currently 6%) is locked at that moment; the program will not accept a fee above 10%.', ''],
  ['Delivered', 'The seller accepts and submits a salted commitment to the exact file manifest. The files stay in private storage.', 'submitted'],
  ['Checked', 'If a verifier was agreed, it evaluates the submission and signs an attestation, pass or fail. Verifiers are paid for the work either way.', ''],
  ['Reviewed', 'The buyer reviews previews and reports, then accepts, requests a correction (only when the agreed verifier failed the submission) or opens a dispute. If the review window passes in silence, the order settles in the seller’s favour.', 'under_review'],
  ['Settled', 'One instruction pays the seller, the verifier and the platform fee, and closes the vault — it cannot run twice.', 'settled'],
  ['Downloaded', 'The delivery service re-reads the chain and issues short-lived download links to the buyer’s wallet only.', 'off-chain'],
];

export default function HowEscrowWorks() {
  return (
    <Page kicker="How it works" title="How escrow works" subtitle="Every order is a small contract executed by the EdgeBounty Solana program. Here is each step, who can act, and what the chain does not prove.†">
      <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
        <ol className="self-start border-y-[3px] border-ink">
          {STEPS.map(([t, desc, state], i) => (
            <li key={t} className="grid grid-cols-[28px_1fr] gap-4 border-b border-line py-5 last:border-0 sm:grid-cols-[28px_1fr_100px]">
              <span className="num pt-1 text-xs text-muted">{i + 1}</span>
              <div>
                <h2 className="display text-[22px]">{t}</h2>
                <p className="mt-1 max-w-[62ch] text-sm text-ink-2">{desc}</p>
              </div>
              <span className="mono col-start-2 text-xs text-muted sm:col-start-auto sm:pt-1.5 sm:text-right">{state}</span>
            </li>
          ))}
        </ol>

        <div className="space-y-10">
          <section className="border-t-[3px] border-ink pt-3">
            <h2 className="kicker mb-3 border-b border-ink/25 pb-2.5 !text-ink-2">What the rules give a buyer</h2>
            <ul className="space-y-2 text-sm text-ink-2">
              <li>Acceptance criteria are fixed before work starts.</li>
              <li>Previews and any agreed checks come before the money moves.</li>
              <li>A correction when the agreed verifier fails a delivery; a refund if the deadline is missed.</li>
              <li>Disputes are decided on evidence by a reviewer, not by the seller.</li>
            </ul>
          </section>
          <section className="border-t-[3px] border-ink pt-3">
            <h2 className="kicker mb-3 border-b border-ink/25 pb-2.5 !text-ink-2">What they give a seller</h2>
            <ul className="space-y-2 text-sm text-ink-2">
              <li>Work starts only once the money is in escrow.</li>
              <li>No full download before settlement.</li>
              <li>Buyers cannot change the criteria after a submission.</li>
              <li>Silence through the review window counts as acceptance.</li>
            </ul>
          </section>
          <section className="border-t border-line pt-4">
            <h2 className="mb-2 text-sm font-medium">
              <span className="mr-1 font-serif text-base">†</span>Limits we disclose
            </h2>
            <p className="text-sm leading-relaxed text-ink-2">
              The program cannot prove that a private file was delivered; an accountable delivery service does that and keeps delivery logs. Previews can leak value. An attestation proves who issued which result, not that
              the result is true. Pseudonymous wallets are not anonymous: Solana transactions and amounts are public.
            </p>
          </section>
        </div>
      </div>
    </Page>
  );
}
