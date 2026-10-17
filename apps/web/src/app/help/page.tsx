import { Card, Page } from '@/components/ui';

export default function Help() {
  return (
    <Page kicker="Help" title="Support and dispute policy">
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Opening a dispute">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>Buyers may open a dispute during the review period. Its reason is recorded on-chain as a hash; evidence files remain private.</li>
            <li>Sellers may contest a correction request. Either party may escalate the matter if the agreed verifier does not respond.</li>
            <li>Both parties may submit evidence while the dispute is open.</li>
            <li>The buyer cannot access the full asset during a dispute. The reviewer receives audited, time-limited access.</li>
          </ul>
        </Card>
        <Card title="Possible outcomes">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li><b>Correction:</b> the seller submits a revised delivery within the correction period.</li>
            <li><b>Split:</b> escrow funds are divided between the buyer and seller in an agreed proportion, including a full refund or full payment.</li>
            <li>The reviewer cannot direct funds to another party. The program permits transfers only to the buyer and seller.</li>
          </ul>
        </Card>
        <Card title="Prohibited content">
          <p className="text-sm">
            Prohibited material includes personal data processed without a lawful basis, abusive or illegal content, malware, stolen or unlicensed data, and datasets intended for unlawful surveillance. Listings may be removed; funded orders remain subject to their contract terms.
          </p>
        </Card>
        <Card title="Privacy">
          <p className="text-sm">
            Accounts use wallet addresses and are pseudonymous by default. We do not use advertising trackers or browser fingerprinting, and we do not train unrelated models on uploaded files. Public blockchain records are visible to everyone and cannot be deleted. Pseudonymity is not anonymity.
          </p>
        </Card>
      </div>
    </Page>
  );
}
