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
      {report.summary && <p className="rounded-lg bg-code/60 p-3 text-sm">{report.summary}</p>}
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
            ['Files', `${d.totalFiles} (${bytes(d.totalSize)}), ${d.dataFiles} data files`],
            ['Readable / corrupted', `${d.readableFiles} / ${d.corruptedFiles}`],
            ['Exact duplicates', d.exactDuplicates],
            ['Near duplicates', d.nearDuplicates ?? 'not tested (Level 2)'],
            ...(d.minWidth !== null ? ([['Smallest image', `${d.minWidth}×${d.minHeight}`]] as [string, string][]) : []),
            ...(d.labels ? ([['Labels', Object.entries(d.labels).map(([k, v]) => `${k}: ${v}`).join(', ')]] as [string, string][]) : []),
            ...(d.rows !== null ? ([['Rows / columns', `${d.rows} / ${d.columns?.length}`], ['Duplicate rows', d.duplicateRows], ['Null cells', d.nullCells]] as [string, any][]) : []),
            ...(d.relevance ? ([['Relevance (estimate)', `${pct(d.relevance.estimateBps)} (95% CI ${pct(d.relevance.lowBps)}–${pct(d.relevance.highBps)}, n=${d.relevance.sampleSize})`]] as [string, string][]) : []),
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
        <p>Sampling: {report.sampling}</p>
        <p>Tools: {report.tools.map((t: any) => `${t.name} ${t.version}`).join(', ')}</p>
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
