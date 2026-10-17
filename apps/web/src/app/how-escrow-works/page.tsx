import { Page, Card } from '@/components/ui';

export default function HowEscrowWorks() {
  return (
    <Page title="How escrow works" subtitle="Every order is a small contract executed by the EdgeBounty Solana program.">
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Lifecycle">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>The buyer funds the order. USDC moves into a vault owned by the order&apos;s program address — neither EdgeBounty nor the seller can move it.</li>
            <li>Terms, acceptance criteria and the license are hashed on-chain at funding. The platform fee is locked at that moment (hard cap 10%).</li>
            <li>The seller accepts and submits a salted commitment to the exact file manifest.</li>
            <li>If a verifier was agreed, it evaluates the submission and signs an attestation (pass or fail). Verifiers are paid for the work either way.</li>
            <li>The buyer reviews previews and reports, then accepts, requests a correction (only when the agreed verifier failed the submission) or opens a dispute.</li>
            <li>If the review window passes in silence, the order settles in the seller&apos;s favour.</li>
            <li>Settlement pays seller, verifier and platform fee in one instruction and closes the vault — it cannot run twice.</li>
            <li>The delivery service re-reads the chain and issues short-lived download links to the buyer&apos;s wallet only.</li>
          </ol>
        </Card>
        <div className="space-y-4">
          <Card title="Buyer protection">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>Objective criteria fixed before work starts</li>
              <li>Independent verification and previews before paying out</li>
              <li>Corrections, refunds on missed deadlines or failed verification</li>
              <li>Evidence-based disputes reviewed by an independent reviewer</li>
            </ul>
          </Card>
          <Card title="Seller protection">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>Work starts only after funds are in escrow</li>
              <li>No unrestricted download before settlement</li>
              <li>Buyers cannot change criteria after submission</li>
              <li>Silence after the review window means acceptance</li>
            </ul>
          </Card>
          <Card title="Limits we disclose">
            <p className="text-sm text-muted">
              The program cannot prove that a private file was delivered; an accountable delivery service does that and keeps delivery logs. Previews can leak value. An attestation proves who issued which result,
              not that the result is true. Pseudonymous wallets are not anonymous: Solana transactions and amounts are public.
            </p>
          </Card>
        </div>
      </div>
    </Page>
  );
}
