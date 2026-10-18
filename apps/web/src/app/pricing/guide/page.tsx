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
          <p className="mt-3">Hosting is prepaid in 30-day months. The price is the greater of $0.30 per month or $0.045 multiplied by each started GiB of the <b>combined file size in one immutable asset version</b>. We add the version's files first, then round once; we do not round each photo or file separately. One GiB is 1,073,741,824 bytes.</p>
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
          <p className="mt-3">At checkout, buyers pay hosting only for gaps not already covered by seller prepayment or earlier funded hosting. The download line provides paid capacity for one complete copy of the asset for 1-month access, two copies for 3 months, or three copies for 6 months. The buyer funds this download capacity at checkout; it is separate from the seller's 1- or 3-month listing-hosting prepayment. It costs $0.15 per started GiB per included copy.</p>
          <p className="mt-3">For a 10 GiB asset, that is $1.50 for one month, $3.00 for three months, or $4.50 for six months. Additional capacity is prepaid at $0.15 per started GiB. Your checkout quote gives the exact amount for your asset.</p>
          <p className="mt-3">Byte-range downloads can resume. The gateway reserves bytes as it serves them; a connection interruption can still consume some reserved capacity. The service records bytes it authorized or sent, which cannot prove a full file was saved on your device. Cloudflare R2 Standard currently charges no Internet egress fee; EdgeBounty's $0.15/GiB is our own priced download-capacity service, not a pass-through of an R2 egress bill. R2 storage and request costs remain infrastructure costs.</p>
        </section>

        <section>
          <h2 className="font-display text-2xl text-ink">Verification and processing</h2>
          <p className="mt-3">L1 technical checks are included with listing verification within published limits. Paid L2 full-dataset quality checks start at 0.005 SOL-equivalent; L3 sampled AI review starts at 0.007 SOL-equivalent for up to 200 sampled items. Larger files, more items and model setup can raise the quote. L2–L3 are prepaid and capped by the work limits in the quote, which is shown in the configured payment token before work starts. L4 human review is quoted individually. A report may be reused for the same immutable version and settings, avoiding a repeat verification run charge. Work beyond this deployment's processing capacity is declined until suitable capacity is available.</p>
          <p className="mt-3">The L2–L3 quote is a capped processing price shown before work starts. When Gemini is configured for an L3 review, token counts are recorded for cost reporting, but the current quote does not add a separate per-token Gemini line item. Provider usage cost can be unknown if the operator has not configured the provider's current token rates; the quote is not a provider invoice.</p>
          <p className="mt-3">The deployed chat assistant uses NVIDIA and has no separate user-facing token charge; daily request limits apply. Gemini token billing for general assistant or multi-step agent use is not enabled. See the proposed Gemini 2.5 Flash rates below; these are planning prices, not charges currently collected.</p>
        </section>

        <section>
          <h2 className="font-display text-2xl text-ink">Proposed Gemini token prices</h2>
          <p className="mt-3">For planning, EdgeBounty proposes a 2× rate on Gemini 2.5 Flash text tokens, the model currently configured by default for Gemini verification. Google's published standard API rate is $0.30 per million input tokens and $2.50 per million output tokens (including reported thinking tokens). The proposed EdgeBounty rates are:</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-y-[3px] border-ink text-left">
              <thead><tr className="border-b border-ink"><th className="py-2 font-normal">Metered usage</th><th className="py-2 text-right font-normal">Proposed EdgeBounty price</th></tr></thead>
              <tbody><tr className="border-b border-line"><td className="py-2">1 million input tokens</td><td className="num py-2 text-right">$0.60</td></tr><tr className="border-b border-line"><td className="py-2">1 million output tokens</td><td className="num py-2 text-right">$5.00</td></tr></tbody>
            </table>
          </div>
          <p className="mt-3">Example: 10,000 input tokens and 2,000 output tokens would total $0.016 at these proposed rates. At Google's listed Gemini 2.5 Flash rates, provider inference would be $0.008 before infrastructure, failed calls, support or other costs. That is a proposed 50% gross margin before those costs, not a profitability guarantee. Rates were checked 18 October 2026; model, modality, caching and provider rates can change.</p>
          <p className="mt-3">No Gemini assistant token charge is active today. Any future paid token use would need a visible per-request estimate, an explicit spending limit and approval before it can run. Model changes, image/audio pricing, caching, tools and agent loops may have different rates. Google's current <a className="underline" href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noreferrer">Gemini API pricing</a> is the source for provider rates.</p>
        </section>

        <section>
          <h2 className="font-display text-2xl text-ink">SOL network fees and currency conversion</h2>
          <p className="mt-3">Marketplace escrow, hosting and verification are charged in the payment token configured for this deployment (USDC or SOL); the checkout displays that token and the exact amount. USD-based service prices are converted to that token in the quote. Solana network transaction fees are always separate and paid in SOL. Review the line items and conversion rate before signing.</p>
          <p className="mt-3">Underlying providers can bill EdgeBounty separately for storage and operations. Cloudflare lists R2 Standard storage at $0.015 per GB-month and request charges for Class A and Class B operations, with no Internet egress charge. These are EdgeBounty infrastructure costs; they do not replace or automatically change the prices shown in your quote. See <a className="underline" href="https://developers.cloudflare.com/r2/pricing/" target="_blank" rel="noreferrer">Cloudflare R2 pricing</a>.</p>
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
