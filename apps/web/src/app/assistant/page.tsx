'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/app/providers';
import { WalletSignIn } from '@/components/nav';
import { Button, ErrorNote, Field, Page, inputCls } from '@/components/ui';

type Mode = 'discovery' | 'bounty' | 'metadata' | 'verification';
type Answer = { answer: string; suggestions: string[]; warnings: string[]; limitations: string[]; cached: boolean; sources: { id: string; title: string; href: string }[]; metadata?: { title: string; description: string; formats: string[] }; model: string };
type Message = { role: 'user' | 'assistant'; content: string; response?: Answer };
const MODES: [Mode, string, string][] = [
  ['discovery', 'Find data', 'Describe your task. The assistant uses real public catalog listings and explains its matches.'],
  ['bounty', 'Plan a bounty', 'Turn a data need into requirements, deliverables and questions to resolve before funding.'],
  ['metadata', 'Prepare metadata', 'Choose your asset version. Share its manifest, or explicitly preview and include one bounded text sample. Licensing rights are not inferred.'],
  ['verification', 'Explain a report', 'Choose an authorized report to understand its findings, evidence and untested requirements.'],
];
function AssistantContent() {
  const params = useSearchParams();
  const initial = MODES.some(m => m[0] === params.get('mode')) ? params.get('mode') as Mode : 'discovery';
  const { account } = useSession();
  const [mode, setMode] = useState<Mode>(initial);
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [versionId, setVersionId] = useState(params.get('version') ?? '');
  const [jobId, setJobId] = useState(params.get('job') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [copyState, setCopyState] = useState('');
  const [sample, setSample] = useState<{ sample: { path: string; text: string; bytes: number } | null; limitation: string } | null>(null);
  const [includeSample, setIncludeSample] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const { data: capabilities } = useApi<{ chat: boolean; model: string; dailyAccountLimit: number }>('/agents/capabilities');
  const { data: context, error: contextError } = useApi<{ versions: { id: string; name: string; version: number }[]; reports: { id: string; level: string }[] }>(account ? '/agents/context' : null, [account?.id]);
  const { data: usage, reload: reloadUsage } = useApi<{ callsToday: number; limit: number; resets: string }>(account ? '/agents/usage' : null, [account?.id]);
  const transcript = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight }); }, [messages, busy]);
  useEffect(() => { generation.current++; setMessages([]); setMessage(''); setError(null); setConsent(false); setCopyState(''); setBusy(false); setSample(null); setIncludeSample(false); setSampleLoading(false); return () => { generation.current++; }; }, [account?.id, mode, versionId, jobId]);
  async function send() {
    if (busy || !message.trim() || !consent) return;
    const text = message.trim(); const requestGeneration = generation.current; setBusy(true); setError(null);
    try {
      const response = await api<Answer>('/agents/chat', { body: { mode, message: text, consent, history: messages.slice(-6).map(({ role, content }) => ({ role, content: content.slice(0, 4000) })), ...(mode === 'metadata' ? { versionId, includeSample } : {}), ...(mode === 'verification' ? { jobId } : {}) } });
      if (generation.current !== requestGeneration) return;
      setMessages(current => [...current, { role: 'user', content: text }, { role: 'assistant', content: response.answer, response }]); setMessage(''); void reloadUsage();
    } catch (err) { if (generation.current === requestGeneration) { setError(err); void reloadUsage(); } }
    finally { if (generation.current === requestGeneration) setBusy(false); }
  }
  return <Page title="Ask EdgeBounty AI" subtitle="Find data, draft requirements, prepare metadata and understand check reports. You review the suggestions and authorize every marketplace action.">
    <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside>
        <nav aria-label="Assistant tasks" className="flex flex-wrap gap-2 lg:flex-col">{MODES.map(([key, name]) => <button key={key} type="button" aria-pressed={mode === key} disabled={busy} onClick={() => setMode(key)} className={`min-h-11 rounded-md px-3 py-2 text-left text-sm ${mode === key ? 'bg-ink text-paper' : 'border border-line text-ink-2 hover:bg-sunk'}`}>{name}</button>)}</nav>
        <p className="mt-4 text-xs text-muted">{usage ? `${usage.callsToday}/${usage.limit} calls today · reset ${usage.resets}.` : `Up to ${capabilities?.dailyAccountLimit ?? 10} calls per wallet daily.`} Cached answers reuse no calls.</p>
      </aside>
      <div className="min-w-0">
        <p className="mb-5 max-w-[68ch] text-ink-2">{MODES.find(m => m[0] === mode)?.[2]}</p>
        {!account ? <section className="rounded-md border border-line p-6"><h2 className="mb-3 text-xl font-medium">Sign in to start a conversation</h2><p className="mb-5 max-w-[60ch] text-sm text-muted">Your wallet identifies your account and usage allowance. Signing the login message moves no funds. You will choose what to share with NVIDIA before sending.</p><WalletSignIn /></section> : <>
          {capabilities && !capabilities.chat && <p className="mb-4 rounded-md border border-line p-4 text-sm text-warn">The AI provider is currently unavailable. <Link className="underline" href="/datasets">Browse datasets</Link> or <Link className="underline" href="/bounties/new">create a bounty manually</Link>.</p>}
          {mode === 'metadata' && <Field label="Your finalized asset version"><select className={inputCls} value={versionId} onChange={e => setVersionId(e.target.value)} disabled={busy}><option value="">Choose an uploaded asset</option>{context?.versions.map(v => <option key={v.id} value={v.id}>{v.name} · version {v.version}</option>)}</select>{context && !context.versions.length && <p className="mt-2 text-sm text-muted">No finalized uploads. <Link className="underline" href="/sell">Upload an asset first</Link>.</p>}</Field>}
          {mode === 'metadata' && versionId && <div className="mt-4 space-y-3 text-sm"><Button variant="ghost" disabled={busy || sampleLoading} onClick={async () => {
            const requestGeneration = generation.current; setSampleLoading(true); setError(null); setSample(null); setIncludeSample(false);
            try { const r = await api<NonNullable<typeof sample>>(`/agents/metadata-sample?versionId=${encodeURIComponent(versionId)}`); if (generation.current === requestGeneration) setSample(r); }
            catch (e) { if (generation.current === requestGeneration) setError(e); }
            finally { if (generation.current === requestGeneration) setSampleLoading(false); }
          }}>{sampleLoading ? 'Reading bounded preview…' : 'Preview optional text sample'}</Button><p className="text-xs text-muted">Reads at most 4,096 bytes of one text file from your private storage. Preview it for sensitive information before sharing. Nothing is sent to AI by this button.</p>{sample && <><p className="text-xs text-muted">{sample.limitation}</p>{sample.sample && <><p className="break-words text-xs">{sample.sample.path} · {sample.sample.bytes} bytes</p><pre tabIndex={0} aria-label="Private text sample preview" className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-sunk p-3 text-xs">{sample.sample.text}</pre><label className="flex min-h-11 items-start gap-3 py-2"><input className="mt-1" type="checkbox" checked={includeSample} disabled={busy} onChange={e => setIncludeSample(e.target.checked)} />I reviewed this prefix and authorize including it in my next NVIDIA request.</label></>}</>}</div>}
          {mode === 'verification' && <Field label="Your completed verification report"><select className={inputCls} value={jobId} onChange={e => setJobId(e.target.value)} disabled={busy}><option value="">Choose a report</option>{context?.reports.map(v => <option key={v.id} value={v.id}>{v.level} · {v.id.slice(0, 8)}</option>)}</select>{context && !context.reports.length && <p className="mt-2 text-sm text-muted">No completed reports. <Link className="underline" href="/verify">View verification</Link>. New checks require a separate quote and authorization.</p>}</Field>}
          <ErrorNote error={contextError} />
          <div ref={transcript} tabIndex={0} role="log" aria-label="Conversation" aria-live="polite" aria-busy={busy} className="my-5 max-h-[60vh] min-h-40 overflow-y-auto rounded-md border border-line bg-panel px-4 sm:px-6">
            {!messages.length && <div className="py-7"><h2 className="text-lg font-medium">What are you working on?</h2><p className="mt-2 max-w-[65ch] text-sm text-muted">{mode === 'discovery' ? 'For example: I need Georgian speech recordings for a transcription model. What is available, and what should I check?' : mode === 'bounty' ? 'For example: Help me specify a consented speech collection bounty, including delivery requirements and a review checklist.' : 'Select the authorized context above, then ask a specific question.'}</p></div>}
            {messages.map((m, i) => <article key={i} className="border-b border-line py-5 last:border-0"><h2 className="mb-2 text-sm font-semibold">{m.role === 'user' ? 'You' : 'EdgeBounty AI'}{m.response?.cached ? ' · cached response' : ''}</h2><p className="max-w-[70ch] whitespace-pre-wrap break-words text-sm leading-relaxed">{m.content}</p>
              {m.response?.sources.length ? <ul className="mt-3 space-y-2">{m.response.sources.map(s => <li key={s.id}><Link className="text-sm underline" href={s.href}>{s.title}</Link></li>)}</ul> : null}
              {m.response?.suggestions.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{m.response.suggestions.map((v, n) => <li key={n}>{v}</li>)}</ul> : null}
              {m.response?.metadata && <div className="mt-4 space-y-2 text-sm"><h3 className="font-medium">Suggested metadata</h3><p>{m.response.metadata.title}</p><p className="whitespace-pre-wrap">{m.response.metadata.description}</p><p>Formats: {m.response.metadata.formats.join(', ')}</p><Button variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(m.response!.metadata, null, 2)); setCopyState('Metadata copied. Review it before publishing.'); } catch { setCopyState('Clipboard unavailable. Select and copy the suggested text above.'); } }}>Copy metadata</Button></div>}
              {m.response && <div className="mt-4 space-y-2">{[...m.response.warnings, ...m.response.limitations].map((v, n) => <p key={n} className="max-w-[70ch] text-xs text-muted">{v}</p>)}</div>}
            </article>)}
            {busy && <p role="status" className="py-4 text-sm text-muted">Reading the supplied context and preparing an answer…</p>}
          </div>
          <form onSubmit={e => { e.preventDefault(); void send(); }} className="space-y-4">
            <Field label="Message to the assistant" hint="Maximum 4,000 characters. Do not enter secrets or personal data."><textarea className={`${inputCls} min-h-28`} maxLength={4000} value={message} onChange={e => setMessage(e.target.value)} disabled={busy} /></Field>
            <label className="flex min-h-11 items-start gap-3 py-2 text-sm"><input className="mt-1" type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} /><span>Send my messages and selected context to NVIDIA. Responses are cached privately in my account. {mode === 'metadata' ? (includeSample ? 'The selected manifest and the reviewed text prefix will be included.' : 'The selected manifest includes file names, sizes and media types; no file contents will be sent.') : mode === 'verification' ? 'The selected report may contain private findings.' : 'Public catalog metadata may be included.'}</span></label>
            <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy || !capabilities?.chat || !consent || message.trim().length < 2 || (mode === 'metadata' && !versionId) || (mode === 'verification' && !jobId)}>{busy ? 'Preparing answer…' : 'Send message'}</Button><Button variant="ghost" disabled={busy || !messages.length} onClick={() => { setMessages([]); setError(null); }}>Clear conversation</Button>{mode === 'bounty' && <Link className="inline-flex min-h-11 items-center text-sm underline" href="/bounties/new">Open bounty form</Link>}</div>
            <ErrorNote error={error} />{copyState && <p role="status" className="text-sm text-muted">{copyState}</p>}
            <p className="text-xs text-muted">NVIDIA · {capabilities?.model ?? 'configured text model'}. No transaction signing or escrow control. Cache retention: 30 days.</p>
          </form>
        </>}
      </div>
    </div>
  </Page>;
}
function AssistantSession() { const { account } = useSession(); return <AssistantContent key={account?.id ?? 'anonymous'} />; }
export default function AssistantPage() { return <Suspense fallback={<p role="status" className="p-8">Loading assistant…</p>}><AssistantSession /></Suspense>; }
