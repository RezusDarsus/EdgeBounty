import type { AcceptanceCriteria, CriterionResult, DatasetMetrics, ModelMetrics } from './schemas';

const bps = (num: number, den: number) => (den === 0 ? 0 : Math.floor((num * 10_000) / den));

function check(criterion: string, required: number | string | boolean, actual: number | string | boolean | null, ok: boolean | null, note?: string): CriterionResult {
  return { criterion, required, actual, status: ok === null ? 'untested' : ok ? 'pass' : 'fail', ...(note ? { note } : {}) };
}

/**
 * Evaluates objective acceptance criteria against measured metrics.
 * A criterion that could not be measured is `untested` and makes the overall verdict fail:
 * the report never claims something it did not check.
 */
export function evaluateCriteria(
  criteria: AcceptanceCriteria,
  m: { dataset?: DatasetMetrics | null; model?: ModelMetrics | null },
): { results: CriterionResult[]; passed: boolean } {
  const r: CriterionResult[] = [];
  if (criteria.kind === 'image_dataset') {
    const d = m.dataset;
    if (!d) return { results: [check('dataset', 'metrics', null, null, 'no dataset metrics')], passed: false };
    // distinct readable images: exact duplicate copies do not count towards the minimum
    const distinct = d.readableFiles - d.exactDuplicates;
    r.push(check('min_images', criteria.minImages, distinct, distinct >= criteria.minImages));
    const readable = bps(d.readableFiles, d.dataFiles);
    r.push(check('min_readable_bps', criteria.minReadableBps, readable, readable >= criteria.minReadableBps));
    if (criteria.minWidth > 0 || criteria.minHeight > 0) {
      const ok = d.belowResolution === null ? null : d.belowResolution === 0;
      r.push(check('min_resolution', `${criteria.minWidth}x${criteria.minHeight}`, d.belowResolution === null ? null : `${d.belowResolution} below`, ok));
    }
    r.push(check('max_exact_duplicates', criteria.maxExactDuplicates, d.exactDuplicates, d.exactDuplicates <= criteria.maxExactDuplicates));
    if (criteria.maxNearDuplicateBps < 10_000) {
      const v = d.nearDuplicates === null ? null : bps(d.nearDuplicates, d.readableFiles);
      r.push(check('max_near_duplicate_bps', criteria.maxNearDuplicateBps, v, v === null ? null : v <= criteria.maxNearDuplicateBps));
    }
    if (criteria.allowedFormats) {
      const bad = Object.keys(d.formats).filter((f) => !criteria.allowedFormats!.includes(f as never));
      r.push(check('allowed_formats', criteria.allowedFormats.join(','), Object.keys(d.formats).join(','), bad.length === 0));
    }
    if (criteria.minLabelValidBps !== undefined) {
      const v = d.labelIssues === null || d.labeledFiles === null ? null : bps(d.labeledFiles - d.labelIssues, Math.max(d.readableFiles, 1));
      r.push(check('min_label_valid_bps', criteria.minLabelValidBps, v, v === null ? null : v >= criteria.minLabelValidBps));
    }
    if (criteria.requiredLabels?.length) {
      const have = d.labels ? Object.keys(d.labels) : null;
      const missing = have ? criteria.requiredLabels.filter((l) => !have.includes(l)) : null;
      r.push(check('required_labels', criteria.requiredLabels.join(','), missing === null ? null : missing.length ? `missing: ${missing.join(',')}` : 'all present', missing === null ? null : missing.length === 0));
    }
    if (criteria.minRelevanceBps !== undefined) {
      const rel = d.relevance;
      // conservative: the lower confidence bound must clear the bar
      r.push(
        check('min_relevance_bps', criteria.minRelevanceBps, rel ? rel.lowBps : null, rel ? rel.lowBps >= criteria.minRelevanceBps : null, rel ? `estimate ${rel.estimateBps} (${rel.lowBps}-${rel.highBps}), n=${rel.sampleSize}, ${rel.method}` : 'relevance requires L2/L3 analysis'),
      );
    }
  } else if (criteria.kind === 'tabular_dataset') {
    const d = m.dataset;
    if (!d || d.rows === null) return { results: [check('dataset', 'metrics', null, null, 'no tabular metrics')], passed: false };
    r.push(check('min_rows', criteria.minRows, d.rows, d.rows >= criteria.minRows));
    const cols = d.columns ?? [];
    const missing = criteria.requiredColumns.filter((c) => !cols.some((x) => x.name === c));
    r.push(check('required_columns', criteria.requiredColumns.join(','), missing.length ? `missing: ${missing.join(',')}` : 'all present', missing.length === 0));
    const cells = d.rows * Math.max(cols.length, 1);
    const nullBps = bps(d.nullCells ?? 0, cells);
    r.push(check('max_null_bps', criteria.maxNullBps, nullBps, nullBps <= criteria.maxNullBps));
    const dupBps = bps(d.duplicateRows ?? 0, d.rows);
    r.push(check('max_duplicate_row_bps', criteria.maxDuplicateRowBps, dupBps, dupBps <= criteria.maxDuplicateRowBps));
    for (const [name, type] of Object.entries(criteria.columnTypes ?? {})) {
      const c = cols.find((x) => x.name === name);
      r.push(check(`column_type:${name}`, type, c?.type ?? null, c ? c.type === type || (type === 'float' && c.type === 'int') : false));
    }
  } else {
    const b = m.model?.benchmark;
    if (!m.model) return { results: [check('model', 'metrics', null, null, 'no model metrics')], passed: false };
    r.push(check('allowed_operators', 'allow-list', m.model.disallowedOperators.join(',') || 'ok', m.model.disallowedOperators.length === 0));
    // library ids are versioned (`id@version`); a bare id matches any version
    const sameBenchmark = !!b && (b.id === criteria.benchmarkId || `${b.id}@${b.version}` === criteria.benchmarkId);
    if (!b || !sameBenchmark) {
      r.push(check(`metric:${criteria.metric}`, criteria.thresholdE4 / 1e4, null, null, `benchmark ${criteria.benchmarkId} not run`));
    } else {
      const v = b.metrics[criteria.metric];
      const lowerIsBetter = ['wer', 'cer', 'rmse'].includes(criteria.metric);
      const ok = v === undefined ? null : lowerIsBetter ? v * 1e4 <= criteria.thresholdE4 : v * 1e4 >= criteria.thresholdE4;
      r.push(check(`metric:${criteria.metric}`, criteria.thresholdE4 / 1e4, v ?? null, ok, `${b.id} v${b.version}, n=${b.samples}, ${b.hardware}`));
      if (criteria.maxLatencyMs) r.push(check('max_latency_ms_p95', criteria.maxLatencyMs, b.latencyMsP95, b.latencyMsP95 <= criteria.maxLatencyMs));
    }
  }
  return { results: r, passed: r.length > 0 && r.every((x) => x.status === 'pass') };
}
