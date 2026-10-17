import Link from 'next/link';
import { Page } from '@/components/ui';

const examples = [
  ['Up to 1 GiB', '$0.30/month minimum'],
  ['10 GiB', '$0.45/month'],
  ['100 GiB', '$4.50/month'],
  ['500 GiB', '$22.50/month'],
];

export default function PricingGuide() {
  return (
    <Page kicker="Fees and pricing" title="How EdgeBounty charges" subtitle="A plain-language guide to commissions, hosting, downloads, verification and Solana network fees. Your checkout quote shows the exact amount before you sign.">
      <article className="max-w-3xl space-y-10 text-sm leading-relaxed text-ink-2">
        <section>
          <h2 className="font-display text-2xl text-ink">Marketplace sales and funded requests</h2>
          <p className="mt-3">EdgeBounty takes 6% of the reward when escrow settles. The seller receives 94%. There is no flat or minimum commission. For a 100 USDC sale, 94 USDC goes to the seller and 6 USDC is the platform commission. Hosting, download capacity and paid verification appear as separate checkout items.</p>
        </section>

        <section>
          <h2 className="font-display text-2xl text-ink">Paid storage and hosting</h2>
          <p className="mt-3">There is no free storage allowance. Customer uploads, including listing assets, need paid storage capacity. Listing versions also need funded hosting coverage before they remain available for sale.</p>
          <p className="mt-3">Hosting is prepaid in 30-day months. The price is the greater of $0.30 per month or $0.045 multiplied by each started GiB. One GiB is 1,073,741,824 bytes. Any positive file up to 1 GiB uses one billable GiB.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-y-[3px] border-ink text-left">
              <thead><tr className="border-b border-ink"><th className="py-2 font-normal">Stored asset size</th><th className="py-2 text-right font-normal">Hosting per month</th></tr></thead>
              <tbody>{examples.map(([size, price]) => <tr key={size} className="border-b border-line last:border-0"><td className="py-2">{size}</td><td className="num py-2 text-right">{price}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="mt-3">The storage page quotes the available capacity and term before payment. Expired storage follows the grace-period and retention terms shown in the product. Assets needed for active orders or disputes remain available under those terms.</p>
        </section>

        <section>
          <h2 className="font-display text-2xl text-ink">Buyer access and downloads</h2>
          <p className="mt-3">At checkout, buyers pay hosting only for gaps not already covered by seller prepayment or earlier funded hosting. The download line provides paid capacity for one complete copy of the asset for 1-month access, two copies for 3 months, or three copies for 6 months. It costs $0.15 per started GiB per included copy.</p>
          <p className="mt-3">For a 10 GiB asset, that is $1.50 for one month, $3.00 for three months, or $4.50 for six months. Additional capacity is prepaid at $0.15 per started GiB. Your checkout quote gives the exact amount for your asset.</p>
          <p className="mt-3">Byte-range downloads can resume. The gateway reserves bytes as it serves them; a connection interruption can still consume some reserved capacity. The service records bytes it authorized or sent, which cannot prove a full file was saved on your device.</p>
        </section>

        <section>
          <h2 className="font-display text-2xl text-ink">Verification and processing</h2>
          <p className="mt-3">L1 technical checks are included with listing verification within published limits. L2–L3 sampled reviews are quoted, prepaid and capped by the work limits in that quote. L4 human review is quoted individually. A report may be reused for the same immutable version and settings, avoiding a repeat verification run charge. Work beyond this deployment's processing capacity is declined until suitable capacity is available.</p>
          <p className="mt-3">AI drafts and explanations do not sign transactions or change listing details, verification outcomes, bounty budgets or escrow. The current assistant adds no separate user-facing AI charge and is subject to daily request limits.</p>
        </section>

        <section>
          <h2 className="font-display text-2xl text-ink">SOL network fees and currency conversion</h2>
          <p className="mt-3">Solana transaction fees are paid separately in SOL to network validators. USD-priced services are converted to SOL using the exchange rate locked in the quote. The quote lists line items, rate and total before you sign. If it does not match what you intend, do not sign.</p>
          <p className="mt-3">A network fee already paid to validators is not an EdgeBounty service charge and is not refunded by the platform. Service refunds and disputes follow the order terms and escrow state.</p>
        </section>

        <section className="border-t border-line pt-5">
          <h2 className="font-display text-2xl text-ink">Questions about a charge?</h2>
          <p className="mt-3">Email <a className="underline" href="mailto:darsavelidzerezo@gmail.com">darsavelidzerezo@gmail.com</a> with the relevant page or public transaction signature. Never send a wallet seed phrase or private key. This MVP currently uses mock USDC on a private test validator; it is not a Mainnet service.</p>
          <p className="mt-3"><Link className="underline" href="/pricing">Back to pricing</Link> · <Link className="underline" href="/help">Support and disputes</Link></p>
        </section>
      </article>
    </Page>
  );
}
