'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
export function AssistantLink() {
  const path = usePathname();
  if (path === '/assistant') return null;
  return <Link href="/assistant" className="fixed bottom-4 right-4 z-20 inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-accent px-4 py-2 text-sm font-medium text-accent-ink shadow-md" aria-label="Open EdgeBounty AI assistant">Ask AI</Link>;
}
