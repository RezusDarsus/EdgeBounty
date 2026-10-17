'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { STATE_LABEL } from '@/lib/format';

export function Kicker({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`kicker ${className}`}>{children}</p>;
}

export function Page({ title, subtitle, actions, kicker, children, wide }: { title: string; subtitle?: ReactNode; actions?: ReactNode; kicker?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <main className={`mx-auto w-full ${wide ? 'max-w-7xl' : 'max-w-6xl'} px-4 pb-12 pt-10 sm:px-6 md:pt-14`}>
      <header className="rise mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-ink pb-6">
        <div className="min-w-0 max-w-3xl">
          {kicker && <Kicker className="mb-3">{kicker}</Kicker>}
          <h1 className="display break-words text-[34px] md:text-[44px]">{title}</h1>
          {subtitle && <p className="mt-3 max-w-[68ch] text-[15px] text-ink-2">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>
      {children}
    </main>
  );
}

export function PageLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-14 sm:px-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-3 w-40" />
      <Skeleton className="mt-4 h-10 w-2/3 max-w-xl" />
      <Skeleton className="mt-3 h-4 w-1/2 max-w-md" />
      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_360px]">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </main>
  );
}

export function Card({ title, children, className = '', right }: { title?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`border-t-[3px] border-ink pb-2 pt-3 ${className}`}>
      {(title || right) && (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/25 pb-2.5">
          {title && <h2 className="kicker !text-ink-2">{title}</h2>}
          {right && <div className="text-xs text-muted">{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = 'primary' | 'ink' | 'ghost' | 'danger';
export const buttonCls = (variant: Variant = 'primary', size: 'md' | 'lg' = 'md') =>
  `inline-flex select-none items-center justify-center gap-2 rounded-md font-medium transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px disabled:pointer-events-none ${
    size === 'lg' ? 'h-11 px-5 text-[15px]' : 'h-9 px-4 text-sm'
  } ${
    {
      primary: 'bg-accent text-accent-ink hover:bg-[color-mix(in_oklab,var(--accent),var(--ink)_18%)] disabled:border disabled:border-line disabled:bg-sunk disabled:text-muted',
      ink: 'bg-ink text-paper hover:bg-ink-2 disabled:border disabled:border-line disabled:bg-sunk disabled:text-muted',
      ghost: 'border border-line bg-panel text-ink hover:border-ink/40 hover:bg-sunk disabled:text-muted',
      danger: 'bg-bad text-white hover:bg-[color-mix(in_oklab,var(--bad),black_15%)] disabled:opacity-50',
    }[variant]
  }`;

export function Button({ children, onClick, variant = 'primary', disabled, type = 'button', className = '' }: { children: ReactNode; onClick?: () => void | Promise<void>; variant?: Variant; disabled?: boolean; type?: 'button' | 'submit'; className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={async () => {
        if (!onClick) return;
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
      className={`${buttonCls(variant)} ${className}`}
    >
      {busy ? (
        <>
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          Working…
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-[2px] border border-line bg-panel px-3 py-2 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted/80 hover:border-ink/30 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-wash)] disabled:opacity-50';

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent' }) {
  const t = {
    neutral: 'border-line bg-panel text-ink-2',
    good: 'border-good/30 bg-good/8 text-good',
    warn: 'border-warn/35 bg-warn/8 text-warn',
    bad: 'border-bad/35 bg-bad/8 text-bad',
    accent: 'border-accent/30 bg-accent-wash text-accent',
  }[tone];
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[2px] border px-1.5 py-[3px] text-[11.5px] font-medium leading-none ${t}`}>{children}</span>;
}

/** A state chip with a shape cue as well as a colour, so state reads without colour vision. */
export function StateBadge({ state }: { state: string }) {
  const tone = ['settled'].includes(state) ? 'good' : ['disputed', 'correction_required', 'mismatch'].includes(state) ? 'bad' : ['refunded', 'cancelled', 'draft'].includes(state) ? 'neutral' : 'warn';
  const glyph = tone === 'good' ? '●' : tone === 'bad' ? '■' : tone === 'neutral' ? '○' : '◐';
  return (
    <Badge tone={tone}>
      <span aria-hidden="true" className="text-[9px]">{glyph}</span>
      {STATE_LABEL[state] ?? state}
    </Badge>
  );
}

export function Hash({ value, label }: { value?: string | null; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-muted">—</span>;
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="mono inline-flex max-w-full items-center gap-1 break-all rounded-[2px] bg-sunk px-1.5 py-0.5 text-left text-ink-2 transition-colors hover:text-ink"
      title={`${value} — click to copy`}
    >
      {label ? `${label} ` : ''}
      {value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value}
      <span className="text-[10px] text-muted" aria-live="polite">{copied ? 'copied' : ''}</span>
    </button>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const raw = error instanceof Error ? error.message : String(error);
  const msg = /failed to fetch|networkerror|load failed/i.test(raw) ? 'Can’t reach the EdgeBounty server right now. Check your connection and try again.' : raw;
  return (
    <p role="alert" className="flex gap-2 rounded-md border border-bad/35 bg-bad/6 px-3 py-2.5 text-sm text-bad">
      <span aria-hidden="true">■</span>
      <span>{msg}</span>
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line bg-panel/50 px-6 py-14 text-center">
      <svg viewBox="0 0 48 24" className="mx-auto mb-4 h-6 w-12 text-muted" aria-hidden="true">
        <rect x="0" y="1" width="48" height="2" fill="currentColor" />
        <rect x="0" y="11" width="48" height="1" fill="currentColor" opacity=".4" strokeDasharray="2 2" />
        <rect x="0" y="21" width="48" height="2" fill="currentColor" />
      </svg>
      <div className="mx-auto max-w-md text-sm text-muted">{children}</div>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-[2px] ${className}`} aria-hidden="true" />;
}

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="text-sm">
      {rows.map(([k, v], i) => (
        <div key={i} className="grid grid-cols-[minmax(108px,38%)_1fr] gap-x-4 border-b border-line py-2 last:border-0">
          <dt className="text-muted">{k}</dt>
          <dd className={`min-w-0 break-words text-ink ${typeof v === 'number' || (typeof v === 'string' && /^[\d\s.,×%/()–·-]+(\s?(GB|MB|KB|TB|B|ms|files|USDC|SOL))*$/.test(v)) ? 'num text-[13.5px]' : ''}`}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div role="tablist" className="mb-6 flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]">
      {tabs.map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={active === t}
          onClick={() => onChange(t)}
          className={`relative -mb-px whitespace-nowrap px-3 pb-3 pt-2 text-sm transition-colors ${active === t ? 'font-medium text-ink' : 'text-muted hover:text-ink'}`}
        >
          {t}
          <span className={`absolute inset-x-2 bottom-0 h-[2px] origin-left bg-ink transition-transform duration-200 ${active === t ? 'scale-x-100' : 'scale-x-0'}`} />
        </button>
      ))}
    </div>
  );
}

export function LinkCard({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`group relative block rounded-md border border-line bg-panel p-5 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-ink/35 ${className}`}>
      {children}
    </Link>
  );
}

export function Notice({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warn' }) {
  return (
    <div className={`flex gap-3 text-sm ${tone === 'warn' ? 'rounded-md border border-warn/35 bg-warn/6 px-4 py-3 text-ink' : 'border-t border-line pt-3 text-ink-2'}`}>
      <span aria-hidden="true" className={`mt-[3px] text-[10px] ${tone === 'warn' ? 'text-warn' : 'text-muted'}`}>{tone === 'warn' ? '▲' : '§'}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const RUNGS = [
  ['L1', 'Technical checks', 'Files open, formats parse, corrupt files and exact duplicates counted'],
  ['L2', 'Sampled AI review', 'Near-duplicates and outliers flagged; a sample checked for relevance'],
  ['L3', 'Advanced review', 'Deeper sampled AI analysis within a capped budget'],
  ['L4', 'Human review', 'A person reviews against the stated criteria'],
] as const;

/** Which levels a listing was actually checked at. A rung fills only when a report exists; nothing here is a guarantee. */
export function EvidenceLadder({ levels, passed, compact }: { levels: string[]; passed?: boolean | null; compact?: boolean }) {
  const top = Math.max(0, ...levels.map((l) => Number(l.slice(1)) || 0));
  if (compact)
    return (
      <span className="inline-flex items-center gap-2" title={top ? `Checked up to level ${top}` : 'No checks reported'}>
        <span className="flex gap-[3px]" aria-hidden="true">
          {RUNGS.map(([l], i) => (
            <span key={l} className={`h-2.5 w-1.5 rounded-[1px] ${i < top ? (passed === false ? 'bg-bad' : 'bg-ink') : 'bg-line'}`} />
          ))}
        </span>
        <span className="text-xs text-muted">{top ? `Checked to L${top}` : 'Unchecked'}</span>
      </span>
    );
  return (
    <ol className="space-y-0" aria-label="Verification evidence">
      {RUNGS.map(([l, name, desc], i) => {
        const done = levels.includes(l) || i < top;
        return (
          <li key={l} className="grid grid-cols-[28px_1fr_auto] items-start gap-3 border-b border-line py-2.5 last:border-0">
            <span className={`num mt-0.5 flex h-5 w-7 items-center justify-center rounded-[2px] text-[11px] ${done ? 'bg-ink text-paper' : 'border border-line text-muted'}`}>{l}</span>
            <span>
              <span className={`block text-sm ${done ? 'text-ink' : 'text-muted'}`}>{name}</span>
              <span className="block text-xs text-muted">{desc}</span>
            </span>
            <span className={`text-xs ${done ? (passed === false ? 'text-bad' : 'text-good') : 'text-muted'}`}>{done ? (passed === false ? 'Criteria not met' : 'Report on file') : 'Not run'}</span>
          </li>
        );
      })}
    </ol>
  );
}

const TRACK = [
  ['funded', 'Funded'],
  ['assigned', 'In progress'],
  ['submitted', 'Delivered'],
  ['under_review', 'Buyer review'],
  ['approved', 'Approved'],
  ['settled', 'Settled'],
] as const;
const OFF_TRACK: Record<string, { at: string; tone: 'bad' | 'warn' | 'neutral' }> = {
  correction_required: { at: 'submitted', tone: 'warn' },
  disputed: { at: 'under_review', tone: 'bad' },
  mismatch: { at: 'submitted', tone: 'bad' },
  refunded: { at: 'funded', tone: 'neutral' },
  cancelled: { at: 'funded', tone: 'neutral' },
};

/** Where the escrowed funds are, read from the on-chain order state. It never runs ahead of the chain. */
export function EscrowTrack({ state, kind }: { state: string; kind?: string }) {
  const steps = TRACK.filter(([s]) => kind === 'bounty' || s !== 'assigned');
  const off = OFF_TRACK[state];
  const current = steps.findIndex(([s]) => s === (off ? off.at : state));
  return (
    <div className="min-w-0 border-y border-line py-4" aria-label="Escrow progress">
      <ol className="flex items-start">
        {steps.map(([s, label], i) => {
          const done = i < current || (i === current && !off);
          const here = i === current;
          return (
            <li key={s} className="flex min-w-0 flex-1 flex-col" aria-current={here ? 'step' : undefined}>
              <div className="flex items-center">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${here && off ? (off.tone === 'bad' ? 'bg-bad' : off.tone === 'warn' ? 'bg-warn' : 'border-[1.5px] border-muted') : done ? (s === 'settled' ? 'bg-good' : 'bg-ink') : 'border-[1.5px] border-line bg-panel'}`} />
                {i < steps.length - 1 && <span className={`h-px flex-1 ${i < current ? 'bg-ink' : 'bg-line'}`} />}
              </div>
              <span className={`mt-2 pr-1 text-[11px] leading-tight sm:text-xs ${here ? 'font-medium text-ink' : done ? 'text-ink-2' : 'text-muted'}`}>{label}</span>
            </li>
          );
        })}
      </ol>
      {off && <p className={`mt-3 text-xs ${off.tone === 'bad' ? 'text-bad' : off.tone === 'warn' ? 'text-warn' : 'text-muted'}`}>{STATE_LABEL[state] ?? state}</p>}
    </div>
  );
}

/** Exact money rows. Values must come from the API or the pricing engine — never computed for display here. */
export function LedgerLine({ rows, total }: { rows: [ReactNode, ReactNode, ReactNode?][]; total?: [ReactNode, ReactNode] }) {
  return (
    <table className="booktabs w-full text-sm">
      <tbody>
        {rows.map(([k, v, note], i) => (
          <tr key={i} className="border-b border-line last:border-0">
            <td className="py-2 pr-3 text-ink-2">
              {k}
              {note && <span className="block text-xs text-muted">{note}</span>}
            </td>
            <td className="num py-2 text-right align-top text-ink">{v}</td>
          </tr>
        ))}
      </tbody>
      {total && (
        <tfoot>
          <tr className="border-t border-ink">
            <td className="py-2.5 pr-3 font-medium">{total[0]}</td>
            <td className="num py-2.5 text-right font-medium">{total[1]}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/** Image fetched with the session token (private previews cannot use a plain <img src>). */
export function AuthImg({ path, alt = '', className = '' }: { path: string; alt?: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      const { API_URL, loadToken } = await import('@/lib/api');
      const t = loadToken();
      const r = await fetch(`${API_URL}${path}`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
      if (!r.ok || cancelled) return;
      url = URL.createObjectURL(await r.blob());
      setSrc(url);
    })().catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={alt} className={className} /> : <div className={`${className} skeleton`} />;
}
