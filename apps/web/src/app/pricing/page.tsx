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
    <Page kicker="Fees and pricing" title="Pricing" subtitle="Exact quotes before payment. Solana network fees are paid separately, in SOL.">
      <div className="grid gap-x-12 gap-y-14 lg:grid-cols-2">
        <section>
          <table className="w-full border-y-[3px] border-ink text-[15px]">
            <caption className="kicker mb-3 text-left !text-ink-2">Marketplace and funded requests — 6% at settlement</caption>
            <tbody>
              <tr className="border-b border-line">
                <td className="py-2.5 text-ink-2">Sale price, held in escrow</td>
                <td className="num py-2.5 text-right">100.00 USDC</td>
              </tr>
              <tr className="border-b border-line">
                <td className="py-2.5 text-ink-2">Seller receives (94%)</td>
                <td className="num py-2.5 text-right">94.00</td>
              </tr>
              <tr className="border-b border-ink">
                <td className="py-2.5 text-ink-2">Platform commission (6%)</td>
                <td className="num py-2.5 text-right">6.00</td>
              </tr>
              <tr>
                <td className="py-2.5 font-medium">Released from escrow</td>
                <td className="num py-2.5 text-right font-medium">100.00 USDC</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 max-w-[60ch] text-xs leading-relaxed text-muted">No flat commission and no minimum transaction fee. Verification, hosting and download charges are quoted separately, before you pay.</p>
        </section>

        <Table
          caption="Private hosting — per month, prepaid for 1 or 3 months"
          head={['Stored', 'Price (USD)']}
          rows={[
            ['Eligible free allowance', '1 GB free'],
            ['Per billable GB', '$0.045'],
            ['Minimum', '$0.30'],
            ['10 GB', '$0.45'],
            ['100 GB', '$4.50'],
            ['500 GB', '$22.50'],
          ]}
          note="Billing uses started GiB (1,073,741,824 bytes) and 30-day months. Retention follows funded hosting, grace periods and existing buyer access."
        />

        <Table
          caption="Downloads"
          head={['Item', 'Price (USD)']}
          rows={[
            ['Allowance included at checkout', 'shown before payment'],
            ['Extra capacity, per started GB', '$0.15'],
          ]}
          note="Range requests let downloads resume. The private gateway reserves the requested bytes, so an interrupted request can use up its reservation. Authorized bytes do not prove that a download completed."
        />

        <Table
          caption="Verification"
          head={['Level', 'Price']}
          rows={[
            ['L1 technical checks', 'included within limits'],
            ['L2–L3 sampled review', 'quoted, prepaid, capped'],
            ['L4 human review', 'quoted case by case'],
          ]}
          note="Sample reports state the model used, the items examined, the confidence and the limitations. Results are reused for unchanged versions and settings. Large full-content scans need a separately budgeted worker."
        />
      </div>
    </Page>
  );
}
