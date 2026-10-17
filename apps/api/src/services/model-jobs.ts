import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { RATES } from '@edgebounty/pricing-engine';
import { processingAmount } from '../lib/payments.js';
import { AcceptanceCriteria, ModelMetrics, evaluateCriteria, type VerificationReport } from '@edgebounty/verification-schemas';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { runSandboxed } from './sandbox.js';
import type { JobOutput } from './jobs.js';

type Job = typeof schema.verificationJobs.$inferSelect;

/**
 * Model evaluation: static inspection + sandboxed ONNX Runtime benchmark. The benchmark is a
 * versioned, separately-owned dataset (curated library or a buyer's private benchmark), so the
 * seller cannot choose the test data.
 */
export async function runModelJob(
  ctx: AppContext,
  job: Job,
  version: typeof schema.assetVersions.$inferSelect,
  asset: typeof schema.assets.$inferSelect,
  inDir: string,
  outDir: string,
): Promise<JobOutput> {
  const args = ['--input', '{in}', '--output', '{out}/result.json', '--max-items', String(job.budget.maxItems), '--max-seconds', String(job.budget.maxSeconds)];
  let bench: typeof schema.benchmarks.$inferSelect | undefined;
  if (job.benchmarkId) {
    [bench] = await ctx.db.select().from(schema.benchmarks).where(eq(schema.benchmarks.id, job.benchmarkId));
    if (!bench?.assetVersionId) throw new Error(`benchmark ${job.benchmarkId} not found`);
    const files = await ctx.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.versionId, bench.assetVersionId));
    if (files.reduce((n, f) => n + f.size, version.totalSize) > ctx.cfg.VERIFICATION_MAX_MATERIALIZE_BYTES) throw new Error('Model and benchmark exceed the authorized materialization budget');
    for (const f of files) await ctx.storage.materialize(f.objectKey, join(outDir, 'bench', ...f.path.split('/')));
    args.push('--benchmark', '{out}/bench');
  }
  const r = await runSandboxed(ctx.cfg, { script: 'model-validator/validate_model.py', args, inputDir: inDir, outputDir: outDir, timeoutMs: (job.budget.maxSeconds + 30) * 1000, memoryMb: 4096 });
  if (r.timedOut) throw new Error('model validator exceeded the job time budget');
  if (r.code !== 0) throw new Error(`model validator failed (${r.code}): ${r.stderr.slice(-1500)}`);
  const doc = JSON.parse(await readFile(join(outDir, 'result.json'), 'utf8'));
  const metrics = ModelMetrics.parse(doc.metrics);
  const criteria = job.criteria ? AcceptanceCriteria.parse(job.criteria) : null;
  const evaluation = criteria
    ? evaluateCriteria(criteria, { model: metrics })
    : { results: [], passed: metrics.disallowedOperators.length === 0 && doc.findings.every((f: any) => f.severity !== 'confirmed') };
  if (doc.truncated) evaluation.passed = false;
  const limitations: string[] = [...doc.limitations];
  if (bench) limitations.push(`Benchmark ${bench.id} v${bench.version}: ${bench.methodology} (license ${bench.license}).`);
  const report: VerificationReport = {
    schema: 'edgebounty.report/1',
    assetId: asset.id,
    assetVersion: version.id,
    assetCommitment: version.commitment!,
    level: job.level,
    specHash: job.specHash,
    datasetMetrics: null,
    modelMetrics: metrics,
    findings: doc.findings,
    criteria: evaluation.results,
    passed: evaluation.passed,
    sampling: metrics.benchmark ? `${metrics.benchmark.samples} benchmark samples` : 'static inspection only',
    tools: doc.tools,
    limitations,
    untested: evaluation.results.filter((c) => c.status === 'untested').map((c) => c.criterion),
    verifier: job.providerWallet ?? 'edgebounty-platform',
    createdAt: new Date().toISOString(),
  };
  return { report, costMicro: processingAmount(ctx.cfg, RATES.modelSetup + BigInt(Math.ceil(r.elapsedMs / 1000)) * RATES.cpuSecond) };
}
