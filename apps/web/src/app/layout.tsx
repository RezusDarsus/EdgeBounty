import type { Metadata } from 'next';
import Link from 'next/link';
import '@solana/wallet-adapter-react-ui/styles.css';
import './globals.css';
import { Providers } from './providers';
import { Nav } from '@/components/nav';

export const metadata: Metadata = {
  title: 'EdgeBounty',
  description: 'Solana-native marketplace for AI datasets, models, funded development work and independent verification.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Providers>
          <Nav />
          {children}
          <footer className="mt-16 border-t border-line">
            <div className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted">
              <Link href="/how-escrow-works">How escrow works</Link>
              <Link href="/pricing">Pricing</Link>
              <Link href="/help">Help &amp; dispute policy</Link>
              <Link href="/storage">Storage</Link>
              <Link href="/verify">Tools: private verification</Link>
              <span className="ml-auto">Test-chain MVP — not fully trustless; see How escrow works.</span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
