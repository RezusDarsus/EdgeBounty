import type { Metadata } from 'next';
import Link from 'next/link';
import { Gloock, IBM_Plex_Mono, Schibsted_Grotesk } from 'next/font/google';
import '@solana/wallet-adapter-react-ui/styles.css';
import './globals.css';
import { Providers } from './providers';
import { Nav } from '@/components/nav';
import { Mark } from '@/components/brand';

const plexSans = Schibsted_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex-sans', display: 'swap' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono', display: 'swap' });
const newsreader = Gloock({ subsets: ['latin'], weight: '400', variable: '--font-newsreader', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'EdgeBounty — datasets and models, sold on evidence', template: '%s · EdgeBounty' },
  description: 'Buy and sell AI datasets and models, or fund the data you need. Payment sits in USDC escrow on Solana until delivery, and every listing shows what was actually checked.',
};

const FOOTER: [string, [string, string][]][] = [
  ['Marketplace', [['/datasets', 'Datasets'], ['/models', 'Models'], ['/bounties', 'Funded requests'], ['/failure-bounties', 'Failure bounties'], ['/providers', 'Verifiers']]],
  ['Sell', [['/sell', 'List a dataset or model'], ['/provider', 'Become a verifier'], ['/storage', 'Storage'], ['/pricing', 'Fees and pricing']]],
  ['How it works', [['/how-escrow-works', 'How escrow works'], ['/verify', 'Private verification'], ['/help', 'Help and disputes']]],
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${newsreader.variable}`}>
      <body className="flex min-h-screen flex-col">
        <Providers>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-paper">
            Skip to content
          </a>
          <Nav />
          <div id="main" className="flex-1">{children}</div>
          <footer className="mt-24 border-t border-line bg-panel">
            <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
              <div>
                <Link href="/" className="inline-flex items-center gap-2 font-medium">
                  <Mark className="h-5 w-5" />
                  EdgeBounty
                </Link>
                <p className="mt-3 max-w-xs text-sm text-muted">Datasets and models, sold on evidence. Payments settle in USDC through a Solana escrow program.</p>
              </div>
              {FOOTER.map(([h, links]) => (
                <nav key={h} aria-label={h}>
                  <p className="kicker mb-4">{h}</p>
                  <ul className="space-y-2 text-sm">
                    {links.map(([href, label]) => (
                      <li key={href}>
                        <Link href={href} className="text-ink-2 transition-colors hover:text-ink">
                          {label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </div>
            <div className="border-t border-line">
              <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted sm:px-6">
                Test-network MVP. The escrow program is not audited, and some steps — delivery and dispute review — run off-chain. <Link href="/how-escrow-works" className="underline">Read what the chain does and does not prove.</Link>
              </p>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
