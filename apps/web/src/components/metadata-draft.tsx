'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Button, ErrorNote } from './ui';
type Metadata = { title: string; description: string; formats: string[] };
export function MetadataDraft({ versionId, apply }: { versionId: string; apply: (m: Metadata) => void }) {
  const [consent, setConsent] = useState(false);
  const [draft, setDraft] = useState<Metadata | null>(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return <details className="mt-4 border-t border-line pt-3">
    <summary className="cursor-pointer py-2 text-sm font-medium">Suggest listing metadata with AI</summary>
    <p className="mt-2 text-sm text-muted">The assistant sees this version's manifest, including names, sizes and media types. It cannot infer license rights or inspect file contents. Review every suggestion.</p>
    <label className="my-3 flex min-h-11 items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />Send this manifest to NVIDIA to suggest a title, description and formats.</label>
    <Button variant="ghost" disabled={!consent || busy} onClick={async () => {
      setBusy(true); setError(null); setDraft(null); setAnswer('');
      try { const r = await api<{ answer: string; metadata?: Metadata }>('/agents/chat', { body: { mode: 'metadata', versionId, message: 'Suggest conservative listing metadata from this authorized manifest. Return the metadata field. Do not invent collection details, data quality, record counts, consent or license rights.', consent: true } }); setAnswer(r.answer); setDraft(r.metadata ?? null); }
      catch (e) { setError(e); } finally { setBusy(false); }
    }}>{busy ? 'Preparing suggestions…' : 'Generate metadata suggestions'}</Button>
    <ErrorNote error={error} />
    <div aria-live="polite">{answer && <p className="mt-3 whitespace-pre-wrap text-sm">{answer}</p>}{draft && <div className="mt-4 space-y-3 text-sm"><h3 className="font-medium">{draft.title}</h3><p className="whitespace-pre-wrap">{draft.description}</p><p>Formats: {draft.formats.join(', ')}</p><p className="text-muted">Applying replaces only the title, description and format fields. Price and license stay under your control.</p><Button onClick={() => { apply(draft); setDraft(null); setAnswer('Reviewed metadata applied to the form. Check it before publishing.'); }}>Apply reviewed metadata</Button></div>}</div>
  </details>;
}
