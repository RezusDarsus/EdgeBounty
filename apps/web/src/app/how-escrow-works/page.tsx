import { Page } from '@/components/ui';

const STEPS: [string, string, string][] = [
  ['Funded', 'The buyer funds the order. USDC moves into a vault controlled by the order’s program address; neither EdgeBounty nor the seller can transfer it directly.', 'funded'],
  ['Terms fixed', 'The program records hashes of the terms, acceptance criteria and license at funding. It also locks the platform fee, currently 6%, subject to the program’s 10% maximum.', ''],
  ['Delivered', 'The seller accepts the order and submits a salted commitment to the exact file manifest. The files remain in private storage.', 'submitted'],
  ['Checked', 'If the parties selected a verifier, that provider evaluates the submission and signs an attestation with a pass or fail result. The verifier is paid for completing the work, regardless of the outcome.', ''],
  ['Reviewed', 'The buyer reviews available previews and reports, then accepts the delivery, requests a correction when the agreed verifier has failed it, or opens a dispute. If the review period expires without action, the order settles in the seller’s favour.', 'under_review'],
  ['Settled', 'A single instruction pays the seller, verifier and platform, then closes the vault. The instruction cannot be executed twice.', 'settled'],
  ['Downloaded', 'The delivery service checks the on-chain order and issues short-lived download links exclusively to the buyer’s wallet.', 'off-chain'],
];

export default function HowEscrowWorks() {
  return (
    <Page kicker="How it works" title="How escrow works" subtitle="Each order follows rules enforced by the EdgeBounty Solana program. This guide explains the process, who may act at each stage and what the blockchain cannot establish.†">
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
            <h2 className="kicker mb-3 border-b border-ink/25 pb-2.5 !text-ink-2">Buyer protections</h2>
            <ul className="space-y-2 text-sm text-ink-2">
              <li>Acceptance criteria are fixed before work starts.</li>
              <li>Available previews and agreed verification results can be reviewed before settlement.</li>
              <li>A correction may be requested when the agreed verifier rejects a delivery; missed deadlines may qualify for a refund.</li>
              <li>An independent reviewer resolves disputes based on submitted evidence.</li>
            </ul>
          </section>
          <section className="border-t-[3px] border-ink pt-3">
            <h2 className="kicker mb-3 border-b border-ink/25 pb-2.5 !text-ink-2">Seller protections</h2>
            <ul className="space-y-2 text-sm text-ink-2">
              <li>Work begins only after the buyer funds the escrow.</li>
              <li>The buyer cannot download the full delivery before settlement.</li>
              <li>The buyer cannot change acceptance criteria after submission.</li>
              <li>If the buyer takes no action during the review period, the order settles in the seller’s favour.</li>
            </ul>
          </section>
          <section className="border-t border-line pt-4">
            <h2 className="mb-2 text-sm font-medium">
              <span className="mr-1 font-serif text-base">†</span>Limits we disclose
            </h2>
            <p className="text-sm leading-relaxed text-ink-2">
              The program cannot confirm that a private file was delivered; the delivery service performs that check and retains access logs. Previews may disclose valuable information. An attestation identifies who issued a result, but does not prove that the result is correct. Wallet pseudonyms do not provide anonymity: Solana transactions and amounts are public.
            </p>
          </section>
        </div>
      </div>
    </Page>
  );
}
