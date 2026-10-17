'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { STATE_LABEL } from '@/lib/format';

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>
      {children}
    </main>
  );
}

export function Card({ title, children, className = '', right }: { title?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`rounded-xl border border-line bg-panel p-5 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({ children, onClick, variant = 'primary', disabled, type = 'button', className = '' }: { children: ReactNode; onClick?: () => void | Promise<void>; variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; type?: 'button' | 'submit'; className?: string }) {
  const [busy, setBusy] = useState(false);
  const styles = {
    primary: 'bg-accent text-accent-ink hover:opacity-90',
    ghost: 'border border-line bg-panel hover:bg-code',
    danger: 'bg-bad text-white hover:opacity-90',
  }[variant];
  return (
    <button
      type={type}
      disabled={disabled || busy}
      onClick={async () => {
        if (!onClick) return;
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {busy ? 'Working…' : children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent';

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const t = { neutral: 'bg-code text-ink', good: 'bg-good/15 text-good', warn: 'bg-warn/15 text-warn', bad: 'bg-bad/15 text-bad' }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export function StateBadge({ state }: { state: string }) {
  const tone = ['settled'].includes(state) ? 'good' : ['disputed', 'correction_required', 'mismatch'].includes(state) ? 'bad' : ['refunded', 'cancelled'].includes(state) ? 'neutral' : 'warn';
  return <Badge tone={tone}>{STATE_LABEL[state] ?? state}</Badge>;
}

export function Hash({ value, label }: { value?: string | null; label?: string }) {
  if (!value) return <span className="text-muted">—</span>;
  return (
    <span className="mono break-all rounded bg-code px-1.5 py-0.5" title={value}>
      {label ? `${label} ` : ''}
      {value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value}
    </span>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error instanceof Error ? error.message : String(error)}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(120px,max-content)_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => (
        <button key={t} onClick={() => onChange(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${active === t ? 'border-accent font-medium' : 'border-transparent text-muted hover:text-ink'}`}>
          {t}
        </button>
      ))}
    </div>
  );
}

export function LinkCard({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="block rounded-xl border border-line bg-panel p-4 transition hover:border-accent">
      {children}
    </Link>
  );
}

export function Notice({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warn' }) {
  return <div className={`rounded-lg border px-4 py-3 text-sm ${tone === 'warn' ? 'border-warn/40 bg-warn/10' : 'border-line bg-code/60'}`}>{children}</div>;
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
  return src ? <img src={src} alt={alt} className={className} /> : <div className={`${className} animate-pulse bg-code`} />;
}
