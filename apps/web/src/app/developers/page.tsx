import Link from 'next/link';
import { Card, Page } from '@/components/ui';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.example.com';

const ENDPOINTS: [string, string, string, string][] = [
  ['GET', '/listings?q=&kind=&category=&sort=&verified=1', 'read', 'Search published datasets and models. Sort: relevance, newest, price-asc, price-desc, sales.'],
  ['GET', '/listings/:id', 'read', 'Listing detail with verification reports and their limitations.'],
  ['GET', '/collections/:id', 'read', 'A shared collection, or one of your own private ones.'],
  ['GET', '/me/analytics?days=30', 'read', 'Your listing views, settled sales, platform fees and net proceeds.'],
  ['GET', '/me/receipts', 'read', 'Receipts for your settled or refunded orders.'],
  ['POST', '/assets', 'upload', 'Create an asset, then a version to upload files into.'],
  ['POST', '/versions/:id/uploads', 'upload', 'Start an upload; large files use resumable multipart parts sent straight to storage.'],
  ['POST', '/uploads/:id/parts/:n/url', 'upload', 'Get a short-lived signed URL for one part.'],
  ['POST', '/uploads/:id/complete', 'upload', 'Finish an upload; the server checks the stored object before counting it.'],
  ['POST', '/versions/:id/finalize', 'upload', 'Freeze the version so it can be verified and listed.'],
  ['POST', '/verification/quote', 'verify', 'Price a verification level for a version before paying.'],
  ['POST', '/verification/jobs', 'verify', 'Request verification; unchanged versions reuse earlier results at no extra cost.'],
  ['GET', '/verification/jobs/:id', 'verify', 'Job status and the finished report.'],
];

export default function Developers() {
  return (
    <Page kicker="Developers" title="Marketplace API" subtitle="Automate uploads, verification and catalog search from your own systems with scoped API keys.">
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
          <Card title="Example" className="mt-10">
            <pre className="mono overflow-x-auto rounded-[2px] border border-line bg-sunk p-4 text-[12.5px] leading-relaxed">{`curl -H "x-api-key: $EDGEBOUNTY_KEY" \\
  "${API}/listings?q=road%20signs&verified=1&sort=relevance"`}</pre>
          </Card>
        </div>
        <aside className="space-y-8 text-sm text-ink-2">
          <section>
            <h2 className="kicker mb-2">Keys and scopes</h2>
            <p>Create keys under <Link className="underline" href="/dashboard">Dashboard → Settings</Link>. Send the key in the <code className="mono">x-api-key</code> header.</p>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              <li><b>read</b>: any GET request for data your account can see.</li>
              <li><b>upload</b>: create assets and versions and upload files.</li>
              <li><b>verify</b>: quote, request and read verification jobs and their invoices.</li>
            </ul>
          </section>
          <section>
            <h2 className="kicker mb-2">What keys cannot do</h2>
            <p>Keys never sign blockchain transactions, move escrowed funds or act as an administrator. Purchases and payouts always need your wallet’s signature.</p>
          </section>
          <section>
            <h2 className="kicker mb-2">Limits</h2>
            <p>Requests are rate limited per client. Large files go directly to storage through signed URLs, never through the API server.</p>
          </section>
        </aside>
      </div>
    </Page>
  );
}
