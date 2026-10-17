import { Card, Page } from '@/components/ui';

export default function Help() {
  return (
    <Page title="Help & dispute policy">
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Opening a dispute">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>Buyers may dispute during the review window; the reason is hashed on-chain, evidence files stay private.</li>
            <li>Sellers may contest a correction request, and either party may escalate if the agreed verifier does not respond.</li>
            <li>Both parties can add evidence while the dispute is open.</li>
            <li>The full asset is never released to the buyer during a dispute. The reviewer gets audited, time-limited access.</li>
          </ul>
        </Card>
        <Card title="Possible outcomes">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>Correction: the seller resubmits within the correction window.</li>
            <li>Split: the escrow is divided between buyer and seller (any proportion, including a full refund or full payment).</li>
            <li>The reviewer can never send funds anywhere else — the program only allows buyer/seller splits.</li>
          </ul>
        </Card>
        <Card title="Prohibited content">
          <p className="text-sm">
            Personal data without a lawful basis, abusive or illegal material, malware, stolen or unlicensed data, and datasets built for unlawful surveillance. Listings can be taken down; funded orders still settle
            under their contract rules.
          </p>
        </Card>
        <Card title="Privacy">
          <p className="text-sm">
            Accounts are wallet-based and pseudonymous by default. We avoid advertising trackers and fingerprinting and never train unrelated models on your uploads. Public blockchain records are visible to anyone
            and cannot be deleted. Pseudonymity is not anonymity.
          </p>
        </Card>
      </div>
    </Page>
  );
}
