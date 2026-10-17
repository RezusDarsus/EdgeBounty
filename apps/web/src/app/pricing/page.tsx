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
    <Page kicker="Fees and pricing" title="Pricing" subtitle="Review an exact quote before you pay. Solana network fees are charged separately in SOL.">
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
          <p className="mt-3 max-w-[60ch] text-xs leading-relaxed text-muted">There is no flat commission or minimum transaction fee. Verification, hosting and download charges are quoted separately before payment.</p>
        </section>

        <Table
          caption="Private hosting · monthly rate, prepaid for one or three months"
          head={['Storage', 'Price (USD)']}
          rows={[
            ['Eligible free allowance', '1 GB included'],
            ['Per billable GB', '$0.045'],
            ['Monthly minimum', '$0.30'],
            ['10 GB', '$0.45'],
            ['100 GB', '$4.50'],
            ['500 GB', '$22.50'],
          ]}
          note="Billing is based on each started GiB (1,073,741,824 bytes) and 30-day months. Retention depends on paid hosting, applicable grace periods and existing buyer access."
        />

        <Table
          caption="Downloads"
          head={['Item', 'Price (USD)']}
          rows={[
            ['Included allowance', 'disclosed at checkout'],
            ['Additional capacity, per started GB', '$0.15'],
          ]}
          note="Range requests support resumable downloads. The private gateway reserves the requested bytes, so an interrupted request may still consume the reservation. Authorized bytes do not confirm that a download completed."
        />

        <Table
          caption="Verification"
          head={['Level', 'Price']}
          rows={[
            ['L1 technical checks', 'included within limits'],
            ['L2–L3 sampled review', 'quoted, prepaid and capped'],
            ['L4 human review', 'quoted individually'],
          ]}
          note="Sample reports identify the model used, items examined, confidence and known limitations. Results may be reused for unchanged versions and settings. Large full-content scans require separately budgeted processing capacity."
        />
      </div>
    </Page>
  );
}
