import { describe, expect, it } from 'vitest';
import { AcceptanceCriteria, buildManifest, canonicalJson, evaluateCriteria, hashDocument, manifestCommitment, newSalt, bytesToHex, DOMAIN, type DatasetMetrics } from './index';

const metrics = (o: Partial<DatasetMetrics> = {}): DatasetMetrics => ({
  totalFiles: 1000, totalSize: 1, dataFiles: 1000, readableFiles: 1000, corruptedFiles: 0, exactDuplicates: 0,
  nearDuplicates: 3, minWidth: 640, minHeight: 640, belowResolution: 0, formats: { jpeg: 1000 }, labelIssues: 0,
  labeledFiles: 1000, labels: { car: 600, bike: 400 }, outliers: 0, rows: null, columns: null, duplicateRows: null,
  nullCells: null, relevance: null, ...o,
});

describe('canonical hashing', () => {
  it('is key-order independent and domain separated', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe('{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}');
    const a = bytesToHex(hashDocument(DOMAIN.terms, { x: 1, y: 2 }));
    expect(bytesToHex(hashDocument(DOMAIN.terms, { y: 2, x: 1 }))).toBe(a);
    expect(bytesToHex(hashDocument(DOMAIN.report, { x: 1, y: 2 }))).not.toBe(a);
  });
  it('salted manifest commitments differ per salt but verify deterministically', () => {
    const m = buildManifest('a', 'v', [{ path: 'b.jpg', size: 1, sha256: '0'.repeat(64), mediaType: 'image/jpeg' }, { path: 'a.jpg', size: 2, sha256: '1'.repeat(64), mediaType: 'image/jpeg' }]);
    expect(m.files[0].path).toBe('a.jpg');
    expect(m.totalSize).toBe(3);
    const s = newSalt();
    expect(bytesToHex(manifestCommitment(m, s))).toBe(bytesToHex(manifestCommitment(structuredClone(m), s)));
    expect(bytesToHex(manifestCommitment(m, newSalt()))).not.toBe(bytesToHex(manifestCommitment(m, s)));
  });
});

describe('acceptance criteria', () => {
  const crit = AcceptanceCriteria.parse({ kind: 'image_dataset', minImages: 1000, minWidth: 640, minHeight: 640, maxExactDuplicates: 0 });
  it('passes the blueprint example dataset', () => {
    const r = evaluateCriteria(crit, { dataset: metrics() });
    expect(r.passed).toBe(true);
  });
  it('fails on duplicates and corrupted files', () => {
    const r = evaluateCriteria(crit, { dataset: metrics({ exactDuplicates: 2, readableFiles: 990, corruptedFiles: 10 }) });
    expect(r.passed).toBe(false);
    expect(r.results.filter((x) => x.status === 'fail').map((x) => x.criterion)).toEqual(['min_images', 'min_readable_bps', 'max_exact_duplicates']);
  });
  it('marks unmeasured relevance as untested (never a silent pass)', () => {
    const c = AcceptanceCriteria.parse({ kind: 'image_dataset', minImages: 10, minRelevanceBps: 9500 });
    const r = evaluateCriteria(c, { dataset: metrics() });
    expect(r.passed).toBe(false);
    expect(r.results.find((x) => x.criterion === 'min_relevance_bps')?.status).toBe('untested');
    const ok = evaluateCriteria(c, { dataset: metrics({ relevance: { estimateBps: 9800, lowBps: 9600, highBps: 9900, sampleSize: 200, method: 'clip' } }) });
    expect(ok.passed).toBe(true);
  });
  it('evaluates model thresholds with lower-is-better metrics', () => {
    const c = AcceptanceCriteria.parse({ kind: 'model', task: 'speech_recognition', benchmarkId: 'b', metric: 'wer', thresholdE4: 1500 });
    const model = { format: 'onnx', opset: 17, operators: [], disallowedOperators: [], parameters: 1, inputs: [], outputs: [], benchmark: { id: 'b', version: 1, samples: 10, metrics: { wer: 0.12 }, confusionMatrix: null, latencyMsP50: 1, latencyMsP95: 2, hardware: 'cpu' } };
    expect(evaluateCriteria(c, { model }).passed).toBe(true);
    expect(evaluateCriteria(c, { model: { ...model, benchmark: { ...model.benchmark, metrics: { wer: 0.2 } } } }).passed).toBe(false);
  });
});
