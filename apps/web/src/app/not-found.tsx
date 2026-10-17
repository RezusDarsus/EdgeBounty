import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-24 sm:px-6">
      <p className="kicker mb-4">Error 404</p>
      <h1 className="display text-[44px]">There’s no page at this address.</h1>
      <p className="mt-4 text-ink-2">The link may be out of date, or the listing may have been withdrawn by its seller. Orders and payments are not affected by a missing page.</p>
      <div className="mt-8 flex flex-wrap gap-5 text-sm font-medium">
        <Link href="/datasets" className="underline underline-offset-4">Browse datasets</Link>
        <Link href="/bounties" className="underline underline-offset-4">Funded requests</Link>
        <Link href="/dashboard" className="underline underline-offset-4">Your dashboard</Link>
      </div>
    </main>
  );
}
