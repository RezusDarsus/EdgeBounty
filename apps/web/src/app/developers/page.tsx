import Link from 'next/link';
import { Card, Page } from '@/components/ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.example.com';

const ENDPOINTS: [string, string, string, string][] = [
  ['GET', '/listings?q=&kind=&category=&sort=&verified=1', 'read', 'Search published datasets and models. Sort by relevance, newest, price (ascending or descending), or sales.'],
  ['GET', '/listings/:id', 'read', 'Retrieve a listing, its verification reports and the limitations of those reports.'],
  ['GET', '/collections/:id', 'read', 'Retrieve a shared collection or a private collection owned by your account.'],
  ['GET', '/me/analytics?days=30', 'read', 'Retrieve listing views, settled sales, platform fees and net proceeds for your account.'],
  ['GET', '/me/receipts', 'read', 'Retrieve receipts for settled or refunded orders.'],
  ['POST', '/assets', 'upload', 'Create an asset and a version for its files.'],
  ['POST', '/versions/:id/uploads', 'upload', 'Start an upload. Large files are divided into resumable parts and sent directly to storage.'],
  ['POST', '/uploads/:id/parts/:n/url', 'upload', 'Request a short-lived signed URL for a specific upload part.'],
  ['POST', '/uploads/:id/complete', 'upload', 'Complete an upload. The server checks the stored object before recording it.'],
  ['POST', '/versions/:id/finalize', 'upload', 'Finalize a version so it can be verified and listed.'],
  ['POST', '/verification/quote', 'verify', 'Request the price for verifying a version before payment.'],
  ['POST', '/verification/jobs', 'verify', 'Request verification. Eligible results are reused for unchanged versions at no additional charge.'],
  ['GET', '/verification/jobs/:id', 'verify', 'Retrieve the job status and completed report.'],
];

export default function Developers() {
  return (
    <Page kicker="Developers" title="Marketplace API" subtitle="Automate uploads, verification and catalog search with API keys scoped to specific permissions.">
      <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <Card title="Endpoints">
            <div className="overflow-x-auto">
              <table className="booktabs w-full text-sm">
                <thead className="text-left">
                  <tr className="kicker"><th className="py-2 pr-3 font-normal">Request</th><th className="py-2 pr-3 font-normal">Scope</th><th className="py-2 font-normal">What it does</th></tr>
                </thead>
                <tbody>
                  {ENDPOINTS.map(([m, path, scope, what]) => (
                    <tr key={m + path} className="border-b border-line align-top last:border-0">
                      <td className="mono whitespace-nowrap py-2.5 pr-3 text-[12.5px]"><span className="mr-2 text-muted">{m}</span>{path}</td>
                      <td className="py-2.5 pr-3">{scope}</td>
                      <td className="py-2.5 text-ink-2">{what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Request example" className="mt-10">
            <pre className="mono overflow-x-auto rounded-[2px] border border-line bg-sunk p-4 text-[12.5px] leading-relaxed">{`curl -H "x-api-key: $EDGEBOUNTY_KEY" \\
  "${API}/listings?q=road%20signs&verified=1&sort=relevance"`}</pre>
          </Card>
        </div>
        <aside className="space-y-8 text-sm text-ink-2">
          <section>
            <h2 className="kicker mb-2">API keys and scopes</h2>
            <p>Create keys under <Link className="underline" href="/dashboard">Dashboard → Settings</Link>. Include the key in the <code className="mono">x-api-key</code> request header.</p>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              <li><b>read</b>: retrieve data available to your account through GET requests.</li>
              <li><b>upload</b>: create assets and versions, then upload files.</li>
              <li><b>verify</b>: request quotes, create verification jobs and retrieve their invoices.</li>
            </ul>
          </section>
          <section>
            <h2 className="kicker mb-2">What keys cannot do</h2>
            <p>API keys cannot sign blockchain transactions, transfer escrowed funds or grant administrator access. Purchases and payouts require a signature from your wallet.</p>
          </section>
          <section>
            <h2 className="kicker mb-2">Limits</h2>
            <p>Requests are rate limited per client. Large files are uploaded directly to storage using signed URLs; they do not pass through the API server.</p>
          </section>
        </aside>
      </div>
    </Page>
  );
}
