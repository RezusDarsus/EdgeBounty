'use client';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, ErrorNote, EscrowTrack, EvidenceLadder, Field, Hash, KV, LedgerLine, Notice, Page, Skeleton, StateBadge, Tabs, inputCls } from '@/components/ui';
import { Mark, Specimen } from '@/components/brand';

const TOKENS = ['paper', 'panel', 'sunk', 'ink', 'ink-2', 'muted', 'line', 'accent', 'accent-wash', 'good', 'warn', 'bad'];
const FACES: Record<string, string> = {
  'Newsreader (display, chosen)': 'var(--font-serif)',
  'IBM Plex Sans (UI, chosen)': 'var(--font-sans)',
  'IBM Plex Mono (data, chosen)': 'var(--font-mono)',
  'System UI (fallback)': 'ui-sans-serif, system-ui, sans-serif',
  'Georgia (serif fallback)': 'Georgia, serif',
};

export function Showcase() {
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  const [face, setFace] = useState(Object.keys(FACES)[0]);
  const [sample, setSample] = useState('Street-level signage, 12 cities — 48,210 files');
  const [tab, setTab] = useState('Overview');
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'system') delete el.dataset.theme;
    else el.dataset.theme = theme;
    return () => {
      delete el.dataset.theme;
    };
  }, [theme]);

  return (
    <Page
      kicker="Internal · not linked from the product"
      title="Datasheet design system"
      subtitle="Tokens, type, components and states used across EdgeBounty. Every value on this page that looks like data is an example and is labelled as one. Source of truth: DESIGN.md."
      actions={
        <div className="flex rounded-[2px] border border-line bg-panel p-0.5" role="group" aria-label="Theme">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button key={t} onClick={() => setTheme(t)} aria-pressed={theme === t} className={`rounded-[1px] px-2.5 py-1 text-xs capitalize ${theme === t ? 'bg-ink text-paper' : 'text-muted hover:text-ink'}`}>
              {t}
            </button>
          ))}
        </div>
      }
    >
      <div className="space-y-14">
        <Section n="Color" note="Neutrals lean slightly toward cobalt. Cobalt itself is for the primary action and one focal element only.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {TOKENS.map((t) => (
              <div key={t} className="overflow-hidden rounded-md border border-line bg-panel">
                <div className="h-16 border-b border-line" style={{ background: `var(--${t})` }} />
                <p className="mono px-2.5 py-2 text-ink-2">--{t}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section n="Type" note="Newsreader for display, IBM Plex Sans for interface and body, IBM Plex Mono for numbers, hashes and kickers. All SIL OFL.">
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-5 rounded-md border border-line bg-panel p-6">
              <p className="kicker">Kicker · Plex Mono 11 / +0.08em</p>
              <p className="display text-[56px]">Display 56</p>
              <p className="display text-[34px]">Section title 34 — about 1.9× body</p>
              <p className="display text-[22px]">Card title 22</p>
              <p className="max-w-[68ch] text-[15px]">Body 15/1.55 in Plex Sans. A report is evidence about a sample, with stated limitations — not a guarantee that a dataset is correct.</p>
              <p className="num text-[22px]">240.00 USDC · 225.60 · 14.40</p>
              <Hash value="7f3a9e1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708c91e" />
            </div>
            <div className="space-y-4">
              <Field label="Preview face">
                <select className={inputCls} value={face} onChange={(e) => setFace(e.target.value)}>
                  {Object.keys(FACES).map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </Field>
              <Field label="Sample text">
                <input className={inputCls} value={sample} onChange={(e) => setSample(e.target.value)} />
              </Field>
              <div className="rounded-md border border-line bg-panel p-4" style={{ fontFamily: FACES[face] }}>
                <p className="text-[28px] leading-tight">{sample}</p>
                <p className="mt-2 text-[15px]">0123456789 — 1,204.50 USDC</p>
              </div>
            </div>
          </div>
        </Section>

        <Section n="Actions" note="One cobalt button per view. Ink for the strong secondary, ghost for the rest.">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Pay into escrow and buy</Button>
            <Button variant="ink">List a dataset</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="danger">Open a dispute</Button>
            <Button disabled>Disabled</Button>
            <Button onClick={() => new Promise((r) => setTimeout(r, 1500))}>Click: busy state</Button>
          </div>
        </Section>

        <Section n="Form controls">
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <Field label="Title" hint="What a buyer would search for.">
              <input className={inputCls} placeholder="Images of corroded pipe joints" />
            </Field>
            <Field label="License">
              <select className={inputCls}>
                <option>CC-BY-4.0</option>
              </select>
            </Field>
            <Field label="Disabled">
              <input className={inputCls} disabled value="Locked after funding" readOnly />
            </Field>
          </div>
        </Section>

        <Section n="State and status" note="Every state carries a shape as well as a colour.">
          <div className="flex flex-wrap gap-2">
            {['funded', 'assigned', 'submitted', 'under_review', 'approved', 'settled', 'correction_required', 'disputed', 'mismatch', 'refunded', 'cancelled'].map((s) => (
              <StateBadge key={s} state={s} />
            ))}
            <Badge tone="accent">Accent chip</Badge>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <EscrowTrack state="under_review" kind="bounty" />
            <EscrowTrack state="disputed" kind="purchase" />
          </div>
        </Section>

        <Section n="Evidence and money" note="Example values. The ladder fills only when a report exists; ledger values only ever come from the API or the pricing engine.">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Evidence on file" right="example">
              <EvidenceLadder levels={['L1', 'L2']} passed />
              <div className="mt-4 flex gap-6">
                <EvidenceLadder levels={['L1', 'L2', 'L3']} compact passed />
                <EvidenceLadder levels={[]} compact />
              </div>
            </Card>
            <Card title="Settlement" right="example">
              <LedgerLine rows={[['Seller receives (94%)', '225.60'], ['Platform fee (6%)', '14.40', 'deducted from the seller’s share']]} total={['Released from escrow', '240.00 USDC']} />
            </Card>
          </div>
        </Section>

        <Section n="Surfaces">
          <Tabs tabs={['Overview', 'Files', 'Reports']} active={tab} onChange={setTab} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Card">
              <KV rows={[['Files', '48,210'], ['Size', '31.4 GB'], ['Seller', 'northbound-labs']]} />
            </Card>
            <div className="space-y-3">
              <Notice>Neutral notice: your USDC is held by the escrow program, not by the seller.</Notice>
              <Notice tone="warn">Warning notice: this listing has no L2 report yet.</Notice>
              <ErrorNote error="The wallet rejected the transaction. Nothing was sent." />
            </div>
            <div className="space-y-2 rounded-md border border-line bg-panel p-4">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <div className="mt-4">
            <Empty>Empty state: no published datasets match these filters yet.</Empty>
          </div>
        </Section>

        <Section n="Specimens" note="Decorative plates drawn from a listing id when the seller supplies no image preview. They show the shape of the data, never its contents.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {(['image', 'table', 'model', 'audio', 'text'] as const).map((s) => (
              <figure key={s}>
                <Specimen seed={`example-${s}`} shape={s} label={s} className="aspect-[16/9] rounded-md border border-line" />
              </figure>
            ))}
          </div>
          <div className="mt-6 flex items-center gap-3 text-sm text-ink-2">
            <Mark className="h-8 w-8" /> The mark: a booktabs table reduced to a glyph.
          </div>
        </Section>

        <Section n="Motion" note="Reveals rise 8px over 320ms with cubic-bezier(.2,.7,.2,1). Only transform and opacity animate. Reduced motion shows final states.">
          <MotionDemo />
        </Section>
      </div>
    </Page>
  );
}

function Section({ n, note, children }: { n: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-5 border-b border-line pb-3">
        <h2 className="display text-[26px]">{n}</h2>
        {note && <p className="mt-1 max-w-[72ch] text-sm text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function MotionDemo() {
  const [k, setK] = useState(0);
  return (
    <div className="flex flex-wrap items-center gap-6">
      <Button variant="ghost" onClick={() => setK(k + 1)}>
        Replay
      </Button>
      <div key={k} className="flex flex-wrap gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rise h-14 w-24 rounded-md border border-line bg-panel" style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
      <div key={`b${k}`} className="h-2 w-full max-w-64 overflow-hidden rounded-[1px] bg-sunk">
        <div className="h-full w-full origin-left bg-ink [animation:fill-x_900ms_var(--ease-out)_both]" />
      </div>
    </div>
  );
}
