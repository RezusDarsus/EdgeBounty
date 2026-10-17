'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Button, ErrorNote, Field, inputCls } from './ui';

type Draft = { title: string; description: string; deliverables: string[]; reviewChecklist: string[]; questions: string[] };
export function BountyDraft({ apply }: { apply: (draft: Draft) => void }) {
  const { data } = useApi<{ bountyDraft: boolean }>('/agents/capabilities');
  const [requirements, setRequirements] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<unknown>(null);
  async function generate() {
    if (busy) return;
    setBusy(true); setError(null); setDraft(null);
    try { setDraft((await api<{ draft: Draft }>('/agents/bounty-draft', { body: { requirements, consent } })).draft); }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  return <details className="mb-8 border-y border-line py-4">
    <summary className="cursor-pointer py-2 font-medium">Draft requirements with AI</summary>
    <p className="mt-3 max-w-[68ch] text-sm text-muted">Describe your task to prepare a draft. Review every suggestion before applying it. Budget, license, acceptance criteria and funding stay under your control.</p>
    {!data?.bountyDraft ? <p className="mt-3 text-sm text-warn">AI drafting is currently unavailable. You can create the request manually below.</p> : <div className="mt-4 max-w-2xl space-y-4">
      <Field label="What data do you need?" hint="Do not include private files, personal data or secrets. Maximum 4,000 characters.">
        <textarea className={`${inputCls} min-h-28`} maxLength={4000} value={requirements} onChange={e => setRequirements(e.target.value)} />
      </Field>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />Send this text to NVIDIA to generate one draft.</label>
      <Button onClick={generate} disabled={busy || !consent || requirements.trim().length < 20}>{busy ? 'Preparing draft…' : 'Generate draft'}</Button>
      <ErrorNote error={error} />
    </div>}
    {draft && <div className="mt-5 max-w-2xl space-y-4" aria-live="polite">
      <h2 className="text-lg font-medium">{draft.title}</h2><p className="whitespace-pre-wrap text-sm">{draft.description}</p>
      <h3 className="font-medium">Proposed deliverables</h3><ul className="list-disc space-y-1 pl-5 text-sm">{draft.deliverables.map((v, i) => <li key={i}>{v}</li>)}</ul>
      <h3 className="font-medium">Review checklist</h3><ul className="list-disc space-y-1 pl-5 text-sm">{draft.reviewChecklist.map((v, i) => <li key={i}>{v}</li>)}</ul>
      {draft.questions.length > 0 && <><h3 className="font-medium">Decisions still needed</h3><ul className="list-disc space-y-1 pl-5 text-sm">{draft.questions.map((v, i) => <li key={i}>{v}</li>)}</ul></>}
      <p className="text-sm text-muted">AI suggestions do not establish ownership, accuracy or feasibility. Applying this replaces the title, description and additional deliverables in your form.</p>
      <Button onClick={() => { apply(draft); setDraft(null); }}>Apply reviewed text to form</Button>
    </div>}
  </details>;
}
