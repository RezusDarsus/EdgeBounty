import { Card, Page } from '@/components/ui';

export default function Pricing() {
  return (
    <Page title="Pricing" subtitle="Exact quotes before payment. Solana network fees are paid separately in SOL.">
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Marketplace and bounties">
          <p className="text-sm">6% commission at settlement. A 100 USDC sale pays the seller 94 USDC and the platform 6 USDC.</p>
          <p className="mt-2 text-sm text-muted">No flat commission or minimum transaction fee. Verification, hosting, and download charges are disclosed separately.</p>
        </Card>
        <Card title="Private hosting">
          <ul className="space-y-1 text-sm">
            <li>Eligible free storage: 1 GB, with usage limits.</li>
            <li>$0.045 per billable GB per month; minimum $0.30/month.</li>
            <li>Prepay 1 or 3 months.</li>
            <li>10 GB: $0.45/month. 100 GB: $4.50/month. 500 GB: $22.50/month.</li>
          </ul>
          <p className="mt-2 text-xs text-muted">Billing uses started GiB (1,073,741,824 bytes) and 30-day months. Retention follows funded hosting, grace periods, and existing buyer access.</p>
        </Card>
        <Card title="Downloads">
          <p className="text-sm">Checkout shows your download allowance and its cost. Extra capacity costs $0.15 per started GB.</p>
          <p className="mt-2 text-xs text-muted">Range requests support resuming downloads. The private gateway reserves requested bytes; interrupted requests can consume the reservation. Authorized bytes do not prove a completed download.</p>
        </Card>
        <Card title="Verification">
          <p className="text-sm">Basic checks are included within limits. Advanced verification is separately quoted, prepaid, and capped.</p>
          <p className="mt-2 text-xs text-muted">Sample reports identify the model, examined items, confidence, and limitations. Results can be reused for unchanged versions and check settings. Large full-content scans need a separately budgeted worker.</p>
        </Card>
      </div>
    </Page>
  );
}
