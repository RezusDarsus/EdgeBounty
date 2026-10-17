'use client';
import { bytes, pct } from '@/lib/format';
import { Badge, Hash, KV } from './ui';

/** Renders a verification report; separates confirmed errors, suspected issues, estimates and untested requirements. */
export function ReportView({ report, reportHash, attestation }: { report: any; reportHash?: string | null; attestation?: string | null }) {
  if (!report) return null;
  const d = report.datasetMetrics;
  const m = report.modelMetrics;
  const confirmed = report.findings.filter((f: any) => f.severity === 'confirmed');
  const suspected = report.findings.filter((f: any) => f.severity === 'suspected');
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={report.passed ? 'good' : 'bad'}>{report.passed ? 'Criteria met' : 'Criteria not met'}</Badge>
        <Badge>Level {report.level.slice(1)}</Badge>
        <span className="text-muted">verifier {report.verifier === 'edgebounty-platform' ? 'EdgeBounty platform' : <Hash value={report.verifier} />}</span>
        {attestation && (
          <a className="text-accent underline" href={`/attestations/${attestation}`}>
            on-chain attestation
          </a>
        )}
      </div>
      {report.summary && <p className="rounded-md bg-code/60 p-3 text-sm">{report.summary}</p>}
      {report.criteria.length > 0 && (
        <table className="w-full text-left">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1">Criterion</th>
              <th>Required</th>
              <th>Measured</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {report.criteria.map((c: any) => (
              <tr key={c.criterion} className="border-t border-line align-top">
                <td className="mono py-1.5">{c.criterion}</td>
                <td>{String(c.required)}</td>
                <td>
                  {c.actual === null ? '—' : String(c.actual)}
                  {c.note && <div className="text-xs text-muted">{c.note}</div>}
                </td>
                <td>
                  <Badge tone={c.status === 'pass' ? 'good' : c.status === 'fail' ? 'bad' : 'warn'}>{c.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d && (
        <KV
          rows={[
            ['Files', `${d.totalFiles?.toLocaleString('en-US')} total (${bytes(d.totalSize)}) · ${d.dataFiles?.toLocaleString('en-US')} data files${d.totalFiles > d.dataFiles ? ` · ${(d.totalFiles - d.dataFiles).toLocaleString('en-US')} non-data (labels, manifests)` : ''}`],
            ['Readable / corrupted', `${d.readableFiles?.toLocaleString('en-US')} / ${d.corruptedFiles?.toLocaleString('en-US')}`],
            ['Exact duplicates', d.exactDuplicates],
            ['Near duplicates', d.nearDuplicates ?? 'not tested (Level 2)'],
            ...(d.minWidth !== null ? ([['Smallest image', `${d.minWidth}×${d.minHeight}`]] as [string, string][]) : []),
            ...(d.labels ? ([['Labels', Object.entries(d.labels).map(([k, v]) => `${k}: ${v}`).join(', ')]] as [string, string][]) : []),
            ...(d.rows !== null ? ([['Rows / columns', `${d.rows} / ${d.columns?.length}`], ['Duplicate rows', d.duplicateRows], ['Null cells', d.nullCells]] as [string, any][]) : []),
            ...(d.relevance ? ([['Relevance (estimate)', `${pct(d.relevance.estimateBps)} (95% CI ${pct(d.relevance.lowBps)}–${pct(d.relevance.highBps)}, n=${d.relevance.sampleSize})`]] as [string, string][]) : []),
            ...(d.mediaRelevance ? ([['Audio/video relevance (estimate)', d.mediaRelevance.sampleSize ? `${pct(d.mediaRelevance.estimateBps)} (95% CI ${pct(d.mediaRelevance.lowBps)}–${pct(d.mediaRelevance.highBps)}, n=${d.mediaRelevance.sampleSize}${d.mediaRelevance.skipped ? `, ${d.mediaRelevance.skipped} skipped` : ''})` : `not judged (${d.mediaRelevance.skipped} clips skipped)`]] as [string, string][]) : []),
          ]}
        />
      )}
      {m && (
        <KV
          rows={[
            ['Format', `${m.format}${m.opset ? ` (opset ${m.opset})` : ''}`],
            ['Parameters', m.parameters?.toLocaleString() ?? '—'],
            ['Inputs', m.inputs.map((i: any) => `${i.name} ${JSON.stringify(i.shape)} ${i.dtype}`).join('; ')],
            ['Disallowed operators', m.disallowedOperators.length ? m.disallowedOperators.join(', ') : 'none'],
            ...(m.benchmark
              ? ([
                  ['Benchmark', `${m.benchmark.id} v${m.benchmark.version} · ${m.benchmark.samples} samples · ${m.benchmark.hardware}`],
                  ['Metrics', Object.entries(m.benchmark.metrics).map(([k, v]) => `${k}=${(v as number).toFixed(4)}`).join(', ')],
                  ['Latency p50 / p95', `${m.benchmark.latencyMsP50} / ${m.benchmark.latencyMsP95} ms`],
                ] as [string, string][])
              : []),
          ]}
        />
      )}
      {confirmed.length > 0 && (
        <div>
          <h4 className="mb-1 font-medium">Confirmed errors</h4>
          <ul className="list-disc space-y-0.5 pl-5">{confirmed.map((f: any, i: number) => <li key={i}>{f.message}</li>)}</ul>
        </div>
      )}
      {suspected.length > 0 && (
        <div>
          <h4 className="mb-1 font-medium">Suspected issues</h4>
          <ul className="list-disc space-y-0.5 pl-5 text-muted">{suspected.map((f: any, i: number) => <li key={i}>{f.message}</li>)}</ul>
        </div>
      )}
      {report.untested?.length > 0 && <p className="text-warn">Untested requirements: {report.untested.join(', ')}</p>}
      <div className="text-xs text-muted">
        {report.sampling && <p>Sampling: {report.sampling}</p>}
        {report.tools?.length > 0 && <p>Tools: {report.tools.map((t: any) => `${t.name} ${t.version}`).join(', ')}</p>}
        <ul className="mt-1 list-disc pl-4">{report.limitations.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul>
        {reportHash && (
          <p className="mt-1">
            Report fingerprint <Hash value={reportHash} />
          </p>
        )}
      </div>
    </div>
  );
}

const n = (v: any) => (v === null || v === undefined ? null : typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
const DATASET_ROWS: [string, (d: any) => string | null][] = [
  ['Data files', (d) => n(d.dataFiles)],
  ['Other files (labels, manifests)', (d) => (d.totalFiles > d.dataFiles ? n(d.totalFiles - d.dataFiles) : '0')],
  ['Total size', (d) => bytes(d.totalSize)],
  ['Readable', (d) => n(d.readableFiles)],
  ['Corrupted', (d) => n(d.corruptedFiles)],
  ['Exact duplicates', (d) => n(d.exactDuplicates)],
  ['Near duplicates', (d) => n(d.nearDuplicates)],
  ['Smallest image', (d) => (d.minWidth != null ? `${d.minWidth}×${d.minHeight}` : null)],
  ['Rows / columns', (d) => (d.rows != null ? `${n(d.rows)} / ${d.columns?.length ?? '—'}` : null)],
  ['Null cells', (d) => n(d.nullCells)],
  ['Relevance (estimate)', (d) => (d.relevance ? `${pct(d.relevance.estimateBps)}` : null)],
];

/** Dataset check reports for one version, side by side by level: what each level measured, and what it did not. */
export function EvidenceTable({ reports }: { reports: any[] }) {
  const ds = [...reports].filter((r) => r.metrics?.totalFiles !== undefined).sort((a, b) => a.level.localeCompare(b.level));
  if (!ds.length) return null;
  const rows = DATASET_ROWS.filter(([, f]) => ds.some((r) => f(r.metrics) !== null));
  const rel = ds.find((r) => r.metrics.relevance)?.metrics.relevance;
  return (
    <div className="space-y-6">
      <div>
        <dl className="border-y-[3px] border-ink text-sm sm:hidden">
          {rows.map(([label, f]) => (
            <div key={label} className="border-b border-line py-2 last:border-0">
              <dt className="text-ink-2">{label}</dt>
              <dd className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                {ds.map((r) => {
                  const v = f(r.metrics);
                  return (
                    <span key={r.level} className="num text-[13px]">
                      <span className="text-muted">{r.level}</span> <span className={v === null ? 'text-muted' : 'text-ink'}>{v ?? 'not tested'}</span>
                    </span>
                  );
                })}
              </dd>
            </div>
          ))}
        </dl>
        <table className="hidden w-full border-y-[3px] border-ink text-sm sm:table">
          <thead>
            <tr className="border-b border-ink text-left">
              <th className="py-2 pr-3 text-xs font-normal text-muted">Measured</th>
              {ds.map((r) => (
                <th key={r.level} className="py-2 pl-3 text-right font-normal">
                  <span className="num rounded-[2px] bg-ink px-1.5 py-0.5 text-[11px] text-paper">{r.level}</span>
                  <span className={`ml-2 text-xs ${r.passed === false ? 'text-bad' : 'text-good'}`}>{r.passed === false ? 'criteria not met' : 'criteria met'}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, f]) => {
              const vals = ds.map((r) => f(r.metrics));
              const changed = vals.some((v, i) => i > 0 && v !== vals[i - 1]);
              return (
                <tr key={label} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 text-ink-2">{label}</td>
                  {vals.map((v, i) => (
                    <td key={i} className={`num py-2 pl-3 text-right ${v === null ? 'text-muted' : changed && i > 0 && v !== vals[i - 1] ? 'font-medium text-ink' : 'text-ink-2'}`}>
                      {v ?? 'not tested'}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rel && <p className="mt-2 text-xs text-muted">Relevance: 95% CI {pct(rel.lowBps)}–{pct(rel.highBps)}, from a random sample of n={rel.sampleSize.toLocaleString('en-US')}.</p>}
      </div>
      {ds.map((r) => (
        (r.findings?.length > 0 || r.limitations?.length > 0) && (
          <div key={r.level} className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[48px_1fr]">
            <span className="num pt-0.5 text-xs text-muted">{r.level}</span>
            <div>
              {r.findings?.map((f: any, i: number) => (
                <p key={i} className={f.severity === 'confirmed' ? 'text-bad' : 'text-ink'}>
                  <span className="mr-1.5 text-xs text-muted">{f.severity === 'confirmed' ? 'Confirmed' : 'Suspected'}</span>
                  {f.message}
                </p>
              ))}
              {r.limitations?.map((x: string, i: number) => (
                <p key={i} className="text-xs text-muted">Limitation: {x}</p>
              ))}
              {r.reportHash && <p className="mt-1 text-xs text-muted">Report fingerprint <Hash value={r.reportHash} />{r.attestation && <> · <a className="underline" href={`/attestations/${r.attestation}`}>on-chain attestation</a></>}</p>}
            </div>
          </div>
        )
      ))}
    </div>
  );
}
