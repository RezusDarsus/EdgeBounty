import Link from 'next/link';
import { Page } from '@/components/ui';

function Table({ caption, head, rows, note }: { caption: string; head: [string, string]; rows: [string, string][]; note?: string }) {
  return (
    <section>
      <table className="w-full border-y-[3px] border-ink text-[15px]">
        <caption className="kicker mb-3 text-left !text-ink-2">{caption}</caption>
        <thead>
          <tr className="border-b border-ink text-left text-xs text-muted">
            <th className="py-2 font-normal">{head[0]}</th>
            <th className="py-2 text-right font-normal">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-line last:border-0">
              <td className="py-2.5 pr-4 text-ink-2">{k}</td>
              <td className={`py-2.5 text-right ${/\d/.test(v) ? 'num' : 'text-ink-2'}`}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="mt-3 max-w-[60ch] text-xs leading-relaxed text-muted">{note}</p>}
    </section>
  );
}

export default function Pricing() {
  return (
    <Page kicker="Fees and pricing" title="Pricing" subtitle="Marketplace escrow, hosting and verification use the payment token configured for this deployment (USDC or SOL). Solana network fees are separate and paid in SOL; checkout shows the exact charge before you sign.">
      <div className="grid gap-x-12 gap-y-14 lg:grid-cols-2">
        <section>
          <table className="w-full border-y-[3px] border-ink text-[15px]">
            <caption className="kicker mb-3 text-left !text-ink-2">Marketplace and funded requests · 6% commission at settlement</caption>
            <tbody>
              <tr className="border-b border-line">
                <td className="py-2.5 text-ink-2">Sale price held in escrow</td>
                <td className="num py-2.5 text-right">100.00 USDC</td>
              </tr>
              <tr className="border-b border-line">
                <td className="py-2.5 text-ink-2">Seller proceeds (94%)</td>
                <td className="num py-2.5 text-right">94.00</td>
              </tr>
              <tr className="border-b border-ink">
                <td className="py-2.5 text-ink-2">Platform commission (6%)</td>
                <td className="num py-2.5 text-right">6.00</td>
              </tr>
              <tr>
                <td className="py-2.5 font-medium">Total released from escrow</td>
                <td className="num py-2.5 text-right font-medium">100.00 USDC</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 max-w-[60ch] text-xs leading-relaxed text-muted">There is no flat commission or minimum transaction fee. Hosting, download capacity and paid verification are quoted separately before payment. Solana network fees are additional.</p>
        </section>

        <Table
          caption="Private hosting · monthly rate, prepaid for one or three months"
          head={['Storage', 'Price (USD)']}
          rows={[
            ['Per billable GB', '$0.045'],
            ['Monthly minimum', '$0.30'],
            ['10 GB', '$0.45'],
            ['100 GB', '$4.50'],
            ['500 GB', '$22.50'],
          ]}
          note="All storage is paid; there is no free storage allowance. We total the files in each asset version, then round that total up to a whole GiB (1,073,741,824 bytes) once. A $0.30 monthly minimum applies per version for prepaid 30-day months. A 10 GiB version costs $0.45/month; 100 GiB costs $4.50/month."
        />

        <Table
          caption="Downloads"
          head={['Item', 'Price (USD)']}
          rows={[
            ['Included download capacity', 'priced in the checkout quote'],
            ['Additional capacity, per started GB', '$0.15'],
          ]}
          note="The access period includes a paid, size-based download capacity: one complete copy for 1 month, two for 3 months, or three for 6 months. Additional capacity is $0.15 per started GiB. This is EdgeBounty's download-capacity service price, not a Cloudflare R2 egress charge. Range requests support resuming; the gateway reserves requested bytes, so an interrupted request may still consume the reservation."
        />

        <Table
          caption="Verification"
          head={['Level', 'Price']}
          rows={[
            ['L1 technical checks', 'included with listing verification'],
            ['L2–L3 sampled review', 'quoted, prepaid and capped'],
            ['L4 human review', 'quoted individually'],
          ]}
          note="Sample reports identify the model used, items examined, confidence and known limitations. Results may be reused for unchanged versions and settings. Large full-content scans require separately budgeted processing capacity."
        />
      </div>
      <section className="mt-14 max-w-3xl border-t-[3px] border-ink pt-6" aria-labelledby="fee-guide">
        <p className="kicker">How your quote is calculated</p>
        <h2 id="fee-guide" className="mt-2 font-display text-3xl">Every charge, before you pay.</h2>
        <div className="mt-5 space-y-5 text-sm leading-relaxed text-ink-2">
          <p><b>1. Listing price and commission.</b> The sale price is held in escrow. When payment is released, the seller receives 94% and EdgeBounty receives 6%. For a 100 USDC sale, that is 94 USDC to the seller and 6 USDC commission. There is no flat or minimum commission.</p>
          <p><b>2. Hosting.</b> Storage is always paid. The monthly price is the greater of $0.30 or $0.045 per started GiB. A small file still uses one billable GiB. Examples: 1 GiB costs $0.30/month; 10 GiB costs $0.45/month; 100 GiB costs $4.50/month. Hosting is prepaid for the selected term. Sellers can prepay listing hosting; at checkout buyers pay only any uncovered hosting period.</p>
          <p><b>3. Downloads.</b> The checkout quote includes paid capacity for one complete copy for a 1-month access period, two copies for 3 months, or three copies for 6 months. Capacity is priced at $0.15 per started GiB per included copy. A 10 GiB asset therefore has download charges of $1.50, $3.00 or $4.50 for those terms. Extra capacity is prepaid in whole GiB at $0.15 each. The checkout shows the actual amount before payment.</p>
          <p><b>4. Verification.</b> L1 technical checks are included with listing verification, within the published file and processing limits. L2–L3 sampled reviews are prepaid from a quote and capped to the work shown. L4 human review is quoted individually. Reusable reports may avoid charging for a repeat run on the same version and settings.</p>
          <p><b>5. Network fees and currency.</b> Escrow, hosting and verification are charged in the configured payment token (USDC or SOL). USD-denominated service prices are converted to that token at the rate locked into the quote. Solana transaction fees are separate and always paid in SOL. Review the amount, rate and breakdown before signing.</p>
          <p>Prices above describe this test-network MVP. Quotes show the charge for your specific asset, access term, hosting coverage and verification request. For help with a quote, email <a className="underline" href="mailto:darsavelidzerezo@gmail.com">darsavelidzerezo@gmail.com</a>.</p>
        </div>
      </section>
      <p className="mt-8 text-sm text-muted">Need the full breakdown? Read the <Link className="underline" href="/pricing/guide">detailed pricing and fees guide</Link> or <Link className="underline" href="/help">contact support</Link>.</p>
    </Page>
  );
}
