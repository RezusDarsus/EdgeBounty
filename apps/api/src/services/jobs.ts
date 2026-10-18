import { mkdir, readFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { and, asc, eq, sql } from 'drizzle-orm';
import { PublicKey } from '@solana/web3.js';
import { RATES, verificationQuote, ceilDiv, type AnalysisLevel } from '@edgebounty/pricing-engine';
import {
  AcceptanceCriteria,
  DatasetMetrics,
  DOMAIN,
  bytesToHex,
  evaluateCriteria,
  hashDocument,
  hexToBytes,
  type Finding,
  type VerificationReport,
} from '@edgebounty/verification-schemas';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { processingQuote, processingAmount } from '../lib/payments.js';
import { keys, sha256OfStream } from '../storage/index.js';
import type { Config } from '../config.js';
import { runSandboxed } from './sandbox.js';
import { aiProvider, assessRelevance, explainReport } from './l3.js';
import { runModelJob } from './model-jobs.js';
import { VERIFICATION_POLICY_VERSION } from '../lib/verification-policy.js';
import { scanMaterialized, MALWARE_POLICY } from './malware.js';
import { checkImageDuplicates, checkTextDuplicates, IMAGE_DUPLICATE_SAMPLES } from './semantic.js';
import { assessMedia, mediaKind, MEDIA_PROMPT_VERSION } from './media-review.js';
import { drainCollaboration } from './collaboration-worker.js';

export const DATASET_VALIDATOR = { name: 'edgebounty-dataset-validator', version: '1.5.0' };
type Job = typeof schema.verificationJobs.$inferSelect;

/** Spec hash = what exactly was promised to be evaluated (level, criteria, tool versions, benchmark). */
export function specFor(level: AnalysisLevel, criteria: unknown, benchmarkId?: string | null, cfg?: Config) {
  const provider = cfg ? aiProvider(cfg) : null;
  const ai = level === 'L3' && cfg ? { provider, model: provider === 'gemini' ? cfg.GEMINI_MODEL : provider === 'nvidia' ? cfg.L3_VISION_MODEL : cfg.L3_MODEL, promptVersion: 'image-review-2026-10-17', sampleItems: RATES.sampledAiItems } : null;
  const semantic = level === 'L3' && cfg?.SEMANTIC_DUPLICATES === 'on' ? { model: cfg.NVIDIA_EMBEDDING_MODEL, policy: 'owner-text-prefix-8192-v1', imageModel: cfg.NVIDIA_IMAGE_EMBEDDING_MODEL, imagePolicy: `owner-image-sample-${IMAGE_DUPLICATE_SAMPLES}-v1` } : null;
  const media = level === 'L3' && cfg && provider === 'nvidia' ? { model: cfg.L3_MEDIA_MODEL, promptVersion: MEDIA_PROMPT_VERSION, maxClips: cfg.L3_MEDIA_MAX_CLIPS, maxClipBytes: cfg.L3_MEDIA_MAX_BYTES } : null;
  const spec = { schema: 'edgebounty.spec/1', level, criteria: criteria ?? null, validator: DATASET_VALIDATOR, benchmarkId: benchmarkId ?? null, ai, ...(semantic ? { semantic } : {}), ...(media ? { media } : {}), ...(cfg?.MALWARE_SCAN_REQUIRED === '1' && level !== 'L1' ? { malwarePolicy: MALWARE_POLICY } : {}) };
  return { spec, specHash: bytesToHex(hashDocument(DOMAIN.spec, spec)) };
}

/** Shared by the displayed quote and the invoice so model workload fees agree. */
export async function quoteVersion(ctx: AppContext, versionId: string, level: AnalysisLevel, benchmarkId?: string | null) {
  const [v] = await ctx.db.select().from(schema.assetVersions).where(eq(schema.assetVersions.id, versionId));
  if (!v) throw new Error('asset version not found');
  const [asset] = await ctx.db.select().from(schema.assets).where(eq(schema.assets.id, v.assetId));
  let items = Math.max(v.fileCount, 1);
  if (benchmarkId) {
    const [bm] = await ctx.db.select().from(schema.benchmarks).where(eq(schema.benchmarks.id, benchmarkId));
    const [bv] = bm?.assetVersionId ? await ctx.db.select().from(schema.assetVersions).where(eq(schema.assetVersions.id, bm.assetVersionId)) : [];
    if (bv) items = Math.max(items, bv.fileCount);
  }
  const q = processingQuote(ctx.cfg, verificationQuote({ items, bytes: v.totalSize, level: level === 'L4' ? 'L2' : level, sampleSize: level === 'L3' ? RATES.sampledAiItems : undefined, modelBenchmark: asset.kind === 'model' && level !== 'L1' ? { computeSeconds: 60, gpu: false } : undefined }));
  // L3 auxiliary calls (duplicate embeddings, report explanation) get their own allowance so they do not shrink the review sample
  if (level === 'L3') q.budget.maxApiCalls += 1 + (ctx.cfg.SEMANTIC_DUPLICATES === 'on' ? IMAGE_DUPLICATE_SAMPLES + 1 : 0);
  return q;
}

export async function createJob(
  ctx: AppContext,
  p: {
    kind: Job['kind'];
    assetVersionId: string;
    requesterId: string;
    level: AnalysisLevel;
    criteria?: unknown;
    benchmarkId?: string | null;
    orderId?: string | null;
    submissionIndex?: number | null;
    providerWallet?: string | null;
    publishOnchain?: boolean;
    status?: Job['status'];
    auditOf?: string | null;
  },
) {
  const [v] = await ctx.db.select().from(schema.assetVersions).where(eq(schema.assetVersions.id, p.assetVersionId));
  if (!v) throw new Error('asset version not found');
  const q = await quoteVersion(ctx, v.id, p.level, p.benchmarkId);
  const { specHash } = specFor(p.level, p.criteria, p.benchmarkId, ctx.cfg);
  const [job] = await ctx.db
    .insert(schema.verificationJobs)
    .values({
      kind: p.kind,
      assetVersionId: p.assetVersionId,
      requesterId: p.requesterId,
      level: p.level,
      criteria: p.criteria ?? null,
      benchmarkId: p.benchmarkId ?? null,
      specHash,
      orderId: p.orderId ?? null,
      submissionIndex: p.submissionIndex ?? null,
      providerWallet: p.providerWallet ?? null,
      publishOnchain: p.publishOnchain ?? false,
      status: p.status ?? 'queued',
      quoteMicro: q.price,
      budget: { ...q.budget, maxSpend: q.budget.maxSpend.toString() },
      auditOf: p.auditOf ?? null,
      policyVersion: VERIFICATION_POLICY_VERSION,
    })
    .returning();
  return job;
}

/** L1 preview jobs write per-version previews; everything else is a pure function of version + spec. */
const reusable = (job: Job) => job.level !== 'L1';

/**
 * Idempotent claim of the canonical inference run. The unique (version, spec, policy) insert is the
 * concurrency guard: exactly one job wins and runs; the rest wait, then copy its persisted result.
 */
async function claimRun(ctx: AppContext, job: Job): Promise<'run' | 'reused' | 'wait'> {
  const policyVersion = job.policyVersion || VERIFICATION_POLICY_VERSION;
  const [mine] = await ctx.db
    .insert(schema.verificationRuns)
    .values({ assetVersionId: job.assetVersionId, specHash: job.specHash, policyVersion, jobId: job.id })
    .onConflictDoNothing()
    .returning();
  if (mine) return 'run';
  const [run] = await ctx.db
    .select()
    .from(schema.verificationRuns)
    .where(and(eq(schema.verificationRuns.assetVersionId, job.assetVersionId), eq(schema.verificationRuns.specHash, job.specHash), eq(schema.verificationRuns.policyVersion, policyVersion)));
  if (run?.jobId === job.id) return 'run'; // our own run, re-claimed after a worker restart
  if (!run || run.status === 'running') {
    // another job is (or was just) running inference for this exact check: wait and reuse its result
    await ctx.db.update(schema.verificationJobs).set({ status: 'queued', lockedBy: null, attempts: Math.max(0, job.attempts - 1) }).where(eq(schema.verificationJobs.id, job.id));
    return 'wait';
  }
  const [src] = await ctx.db.select().from(schema.verificationResults).where(eq(schema.verificationResults.id, run.resultId!));
  const [result] = await ctx.db
    .insert(schema.verificationResults)
    .values({ jobId: job.id, report: src.report, reportHash: src.reportHash, passed: src.passed, reusedFromJobId: run.jobId })
    .onConflictDoNothing()
    .returning();
  await ctx.db.update(schema.verificationJobs).set({ status: 'completed', completedAt: new Date(), actualCostMicro: 0n, error: null }).where(eq(schema.verificationJobs.id, job.id));
  // a reused report still needs this order's own on-chain verdict (a cheap signature, no inference)
  if (result && job.publishOnchain && job.kind === 'order') await publishOrderVerdict(ctx, job, src.reportHash, src.passed);
  if (result && job.publishOnchain && job.kind === 'provider_job' && job.onchainJobAddress) await publishJobResult(ctx, job, src.reportHash, src.passed);
  return 'reused';
}

/** Actual upstream usage of a canonical run. Free-tier calls are recorded at $0 with their count. */
async function recordVerificationCost(ctx: AppContext, job: Job, usage?: JobUsage) {
  if (!usage) return;
  const rows: (typeof schema.costEvents.$inferInsert)[] = [
    { category: 'compute', provider: 'ec2', quantity: BigInt(Math.ceil(usage.computeMs / 1000)), unit: 'cpu_second', usdMicro: 0n, estimated: true, note: 'runs on the fixed-cost instance; no marginal charge', subjectId: job.id },
  ];
  if (usage.apiCalls > 0) {
    const perCall = usage.provider === 'nvidia' ? ctx.cfg.NVIDIA_USD_MICRO_PER_CALL : 0n;
    rows.push({ category: 'verification', provider: usage.provider ?? 'unknown', quantity: BigInt(usage.apiCalls), unit: 'api_call', usdMicro: perCall * BigInt(usage.apiCalls), estimated: true, note: perCall === 0n ? (usage.provider === 'nvidia' ? 'configured free tier: calls counted' : 'provider cost unavailable unless token rates are configured; omitted from cost total') : 'configured per-call rate', subjectId: job.id });
    if (usage.provider === 'gemini') {
      for (const [unit, quantity, rate] of [['input_token', usage.inputTokens ?? 0, ctx.cfg.GEMINI_INPUT_MICRO_PER_MILLION], ['output_token', usage.outputTokens ?? 0, ctx.cfg.GEMINI_OUTPUT_MICRO_PER_MILLION]] as const) {
        rows.push({ category: 'verification', provider: 'gemini', quantity: BigInt(quantity), unit, usdMicro: rate === undefined ? 0n : ceilDiv(BigInt(quantity) * rate, 1_000_000n), estimated: true, note: rate === undefined ? 'unpriced token usage; cost unknown' : 'measured tokens multiplied by configured model rate', subjectId: job.id });
      }
    }
  }
  await ctx.db.insert(schema.costEvents).values(rows);
}

/** Free Level-1 validation + controlled preview generation after an asset version is finalized. */
export async function enqueuePreview(ctx: AppContext, versionId: string, requesterId: string) {
  await ctx.db.update(schema.assetVersions).set({ previewStatus: 'pending' }).where(eq(schema.assetVersions.id, versionId));
  return createJob(ctx, { kind: 'listing', assetVersionId: versionId, requesterId, level: 'L1' });
}

/** Optimistic claim: safe with multiple orchestrator instances. */
export async function claimNextJob(ctx: AppContext, workerId: string): Promise<Job | null> {
  for (let i = 0; i < 5; i++) {
    const [cand] = await ctx.db.select().from(schema.verificationJobs).where(eq(schema.verificationJobs.status, 'queued')).orderBy(asc(schema.verificationJobs.createdAt)).limit(1);
    if (!cand) return null;
    const [claimed] = await ctx.db
      .update(schema.verificationJobs)
      .set({ status: 'running', lockedAt: new Date(), lockedBy: workerId, attempts: cand.attempts + 1 })
      .where(and(eq(schema.verificationJobs.id, cand.id), eq(schema.verificationJobs.status, 'queued')))
      .returning();
    if (claimed) return claimed;
  }
  return null;
}

/** Re-queue jobs whose worker died (lock older than twice the job time budget). */
export async function reclaimStaleJobs(ctx: AppContext) {
  const running = await ctx.db.select().from(schema.verificationJobs).where(eq(schema.verificationJobs.status, 'running'));
  for (const j of running) {
    if (j.lockedAt && Date.now() - j.lockedAt.getTime() > j.budget.maxSeconds * 2000 + 60_000) {
      await ctx.db.update(schema.verificationJobs).set({ status: 'queued', lockedBy: null, error: 'reclaimed after worker timeout' }).where(and(eq(schema.verificationJobs.id, j.id), eq(schema.verificationJobs.status, 'running')));
    }
  }
}

export async function runJob(ctx: AppContext, job: Job): Promise<void> {
  const work = join(ctx.cfg.DATA_DIR, 'work', job.id);
  const inDir = join(work, 'in');
  const outDir = join(work, 'out');
  try {
    const [version] = await ctx.db.select().from(schema.assetVersions).where(eq(schema.assetVersions.id, job.assetVersionId));
    const [asset] = await ctx.db.select().from(schema.assets).where(eq(schema.assets.id, version.assetId));
    if (version.status !== 'finalized') throw new Error('asset version is not finalized');
    if ((version.metadata as any)?.encrypted) {
      await ctx.db
        .update(schema.verificationJobs)
        .set({ status: 'failed', error: 'client-side encrypted assets cannot be analysed automatically', attempts: 99 })
        .where(eq(schema.verificationJobs.id, job.id));
      return;
    }
    // preflight against budget: never silently exceed what the customer authorized
    if (version.fileCount > job.budget.maxItems) {
      await ctx.db
        .update(schema.verificationJobs)
        .set({ status: 'needs_authorization', error: `asset has ${version.fileCount} files; budget covers ${job.budget.maxItems}. Re-quote required.` })
        .where(eq(schema.verificationJobs.id, job.id));
      return;
    }
    // verify once per immutable version + spec + policy: reuse a persisted result instead of paying again
    if (reusable(job)) {
      const claim = await claimRun(ctx, job);
      if (claim === 'reused' || claim === 'wait') return;
    }
    await rm(work, { recursive: true, force: true });
    await mkdir(inDir, { recursive: true });
    await mkdir(outDir, { recursive: true });
    const files = await ctx.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.versionId, version.id));
    if (version.totalSize > ctx.cfg.VERIFICATION_MAX_MATERIALIZE_BYTES) {
      await ctx.db.delete(schema.verificationRuns).where(and(eq(schema.verificationRuns.jobId, job.id), eq(schema.verificationRuns.status, 'running')));
      await ctx.db.update(schema.verificationJobs).set({ status: 'needs_authorization', lockedBy: null, error: 'Full-content verification exceeds the materialization budget. A separately provisioned verification worker is required.' }).where(eq(schema.verificationJobs.id, job.id));
      return;
    }
    for (const f of files) {
      const path = join(inDir, ...f.path.split('/'));
      await ctx.storage.materialize(f.objectKey, path);
      const actual = await sha256OfStream(createReadStream(path));
      if (actual.sha256 !== f.sha256 || actual.size !== f.size) throw new Error('Stored content does not match the immutable declared SHA-256 and size');
    }
    if (files.some((f) => f.objectKey.startsWith('r2/'))) await ctx.db.execute(sql`update asset_versions set metadata = coalesce(metadata, '{}'::jsonb) || '{"hashVerification":"server-verified"}'::jsonb where id = ${version.id}`);

    const malware = job.level === 'L1' ? null : await scanMaterialized(ctx.cfg, inDir);
    if (malware) await ctx.db.execute(sql`update asset_versions set metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify({ malware: { ...malware, commitment: version.commitment } })}::jsonb where id=${version.id}`);
    const report = asset.kind === 'model' ? await runModelJob(ctx, job, version, asset, inDir, outDir) : await runDatasetJob(ctx, job, version, asset, inDir, outDir);
    if (malware) {
      report.report.tools.push({ name: 'ClamAV signature scan', version: malware.engine });
      report.report.limitations.push(malware.limitation);
      if (report.usage) report.usage.computeMs += malware.elapsedMs;
    }
    const reportHash = bytesToHex(hashDocument(DOMAIN.report, report.report));
    const [result] = await ctx.db.insert(schema.verificationResults).values({ jobId: job.id, report: report.report, reportHash, passed: report.report.passed }).returning();
    await ctx.db
      .update(schema.verificationJobs)
      .set({ status: 'completed', completedAt: new Date(), actualCostMicro: report.costMicro, error: null })
      .where(eq(schema.verificationJobs.id, job.id));
    if (reusable(job)) {
      await ctx.db.update(schema.verificationRuns).set({ status: 'completed', resultId: result.id, completedAt: new Date() }).where(eq(schema.verificationRuns.jobId, job.id));
    }
    await recordVerificationCost(ctx, job, report.usage);
    if (job.publishOnchain && job.kind === 'order') await publishOrderVerdict(ctx, job, reportHash, report.report.passed);
    if (job.publishOnchain && job.kind === 'provider_job' && job.onchainJobAddress) await publishJobResult(ctx, job, reportHash, report.report.passed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // release the run so a retry (or another job for the same version) can claim it
    await ctx.db.delete(schema.verificationRuns).where(and(eq(schema.verificationRuns.jobId, job.id), eq(schema.verificationRuns.status, 'running'))).catch(() => {});
    await ctx.db
      .update(schema.verificationJobs)
      .set({ status: job.attempts >= 3 ? 'failed' : 'queued', error: msg.slice(0, 2000), lockedBy: null })
      .where(eq(schema.verificationJobs.id, job.id));
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

export interface JobUsage {
  computeMs: number;
  apiCalls: number;
  provider: string | null;
  inputTokens?: number;
  outputTokens?: number;
}
export interface JobOutput {
  report: VerificationReport;
  /** platform-rate processing estimate (lamports), not an upstream cost */
  costMicro: bigint;
  usage?: JobUsage;
}

async function runDatasetJob(ctx: AppContext, job: Job, version: typeof schema.assetVersions.$inferSelect, asset: typeof schema.assets.$inferSelect, inDir: string, outDir: string): Promise<JobOutput> {
  const criteria = job.criteria ? AcceptanceCriteria.parse(job.criteria) : null;
  const img = criteria?.kind === 'image_dataset' ? criteria : null;
  const wantL3 = job.level === 'L3';
  const args = [
    '--input', '{in}', '--output', '{out}/result.json', '--previews', '{out}/previews',
    '--level', job.level === 'L1' ? 'L1' : 'L2',
    '--min-width', String(img?.minWidth ?? 0), '--min-height', String(img?.minHeight ?? 0),
    '--max-items', String(job.budget.maxItems), '--max-seconds', String(job.budget.maxSeconds),
    '--seed', String(parseInt(job.id.slice(0, 8), 16)),
  ];
  if (wantL3) args.push('--sample-dir', '{out}/samples', '--sample-size', String(job.budget.maxApiCalls || RATES.sampledAiItems));
  const r = await runSandboxed(ctx.cfg, { script: 'dataset-validator/validate.py', args, inputDir: inDir, outputDir: outDir, timeoutMs: (job.budget.maxSeconds + 30) * 1000 });
  if (r.timedOut) throw new Error('validator exceeded the job time budget');
  if (r.code !== 0) throw new Error(`validator failed (${r.code}): ${r.stderr.slice(-1500)}`);
  const doc = JSON.parse(await readFile(join(outDir, 'result.json'), 'utf8'));
  if (ctx.cfg.COLLABORATIVE_BOUNTIES_ENABLED === '1' && Array.isArray(doc.collaborationItems)) {
    await ctx.db.execute(sql`insert into collaboration_verifier_evidence(job_id,asset_version_id,evidence,complete)
      values(${job.id},${version.id},${JSON.stringify(doc.collaborationItems)}::jsonb,${!doc.truncated})
      on conflict(job_id) do update set evidence=excluded.evidence,complete=excluded.complete`);
  }
  const findings: Finding[] = doc.findings;
  const limitations: string[] = [...doc.limitations];
  const metrics = DatasetMetrics.parse(doc.metrics);
  let costMicro = processingAmount(ctx.cfg, BigInt(Math.ceil(r.elapsedMs / 1000)) * RATES.cpuSecond);
  const usage: JobUsage = { computeMs: r.elapsedMs, apiCalls: 0, provider: null };
  const tools = [...doc.tools];

  const task = img?.relevancePrompt ?? `${asset.name}${asset.category ? ` (${asset.category})` : ''}`;
  const remainingCalls = () => job.budget.maxApiCalls - usage.apiCalls;
  if (wantL3) {
    const provider = aiProvider(ctx.cfg);
    if (!provider) {
      limitations.push('Level 3 AI review was requested but no AI provider is configured; relevance is untested.');
    } else if (doc.samples.length) {
      const rel = await assessRelevance(
        ctx.cfg,
        doc.samples.map((s: any) => ({ path: join(outDir, 'samples', s.file), source: s.source, label: s.label })),
        task,
        Math.min(RATES.sampledAiItems, job.budget.maxApiCalls),
      );
      metrics.relevance = { estimateBps: rel.estimateBps, lowBps: rel.lowBps, highBps: rel.highBps, sampleSize: rel.sampleSize, method: rel.method };
      if (rel.irrelevant.length) findings.push({ severity: 'suspected', code: 'irrelevant_content', message: `${rel.irrelevant.length} of ${rel.sampleSize} sampled items judged irrelevant`, files: rel.irrelevant });
      if (rel.labelMismatches.length) findings.push({ severity: 'suspected', code: 'label_mismatch', message: `${rel.labelMismatches.length} sampled items appear mislabeled`, files: rel.labelMismatches });
      if (rel.undetermined) limitations.push(`${rel.undetermined} sampled items could not be judged by the AI reviewer and were excluded.`);
      limitations.push('Relevance is a sample-based estimate with a 95% confidence interval, produced by an AI model; it is not proof of quality.');
      tools.push({ name: provider === 'gemini' ? ctx.cfg.GEMINI_MODEL : provider === 'nvidia' ? ctx.cfg.L3_VISION_MODEL : ctx.cfg.L3_MODEL, version: provider });
      // SOL-denominated processing estimate; upstream USD invoices are not lamports.
      costMicro += processingAmount(ctx.cfg, BigInt(rel.sampleSize) * RATES.l3PerItemCost);
      usage.apiCalls += rel.apiCalls;
      usage.provider = provider;
      usage.inputTokens = rel.inputTokens;
      usage.outputTokens = rel.outputTokens;
    }
  }

  const versionFiles = wantL3 ? await ctx.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.versionId, version.id)) : [];
  const mediaPaths = versionFiles.map((f) => f.path).filter((p) => mediaKind(p));
  if (wantL3 && mediaPaths.length) {
    const provider = aiProvider(ctx.cfg);
    if (provider !== 'nvidia') {
      limitations.push('Audio/video AI review currently runs on the NVIDIA omni model only; clip relevance is untested.');
    } else if (remainingCalls() <= 0) {
      limitations.push('The AI call budget was used by image review; audio/video clips were not reviewed.');
    } else {
      const media = await assessMedia(ctx.cfg, inDir, mediaPaths, task, parseInt(job.id.slice(0, 8), 16), remainingCalls());
      usage.apiCalls += media.apiCalls;
      usage.provider = 'nvidia';
      usage.inputTokens = (usage.inputTokens ?? 0) + media.inputTokens;
      usage.outputTokens = (usage.outputTokens ?? 0) + media.outputTokens;
      if (media.apiCalls || media.skipped.length) {
        metrics.mediaRelevance = { estimateBps: media.estimateBps, lowBps: media.lowBps, highBps: media.highBps, sampleSize: media.sampleSize, method: media.method, skipped: media.skipped.length };
        if (media.irrelevant.length) findings.push({ severity: 'suspected', code: 'irrelevant_media', message: `${media.irrelevant.length} of ${media.sampleSize} sampled audio/video clips judged irrelevant`, files: media.irrelevant });
        if (media.labelMismatches.length) findings.push({ severity: 'suspected', code: 'media_label_mismatch', message: `${media.labelMismatches.length} sampled clips do not appear to match their folder label`, files: media.labelMismatches });
        limitations.push(`Audio/video review examined ${media.sampleSize} of ${mediaPaths.length} clips (seeded random sample) with ${ctx.cfg.L3_MEDIA_MODEL}; it is an AI estimate with a 95% interval, not proof of quality.`);
        if (media.truncated) limitations.push(`${media.truncated} long WAV clips were reviewed from their first ${Math.round(ctx.cfg.L3_MEDIA_MAX_BYTES / 1024 ** 2)} MiB only.`);
        if (media.skipped.length) limitations.push(`${media.skipped.length} sampled clips were skipped: ${[...new Set(media.skipped.map((s) => s.reason))].join('; ')}.`);
        if (media.undetermined) limitations.push(`${media.undetermined} sampled clips could not be judged by the AI reviewer and were excluded.`);
        tools.push({ name: ctx.cfg.L3_MEDIA_MODEL, version: 'nvidia' });
        costMicro += processingAmount(ctx.cfg, BigInt(media.sampleSize) * RATES.l3PerItemCost);
      }
    }
  }

  let imagesCompared = 0;
  if (wantL3 && ctx.cfg.SEMANTIC_DUPLICATES === 'on' && doc.samples.length && remainingCalls() > 0) {
    try {
      const similar = await checkImageDuplicates(ctx, version.id, asset.ownerId, doc.samples.map((s: any) => join(outDir, 'samples', s.file)), remainingCalls());
      usage.apiCalls += similar.calls;
      usage.inputTokens = (usage.inputTokens ?? 0) + similar.inputTokens;
      if (similar.calls) usage.provider = 'nvidia';
      imagesCompared = similar.compared;
      if (similar.matches.length) findings.push({ severity: 'suspected', code: 'semantic_image_overlap', message: `Sampled images closely resemble images in ${similar.matches.length} previously checked versions in your account. Similarity is a heuristic, not proof of duplicate content.`, files: similar.matches.map((m) => m.version_id) });
      if (similar.compared) limitations.push(`Image near-duplicate check compared ${similar.compared} downscaled samples with earlier versions in the owner's account only, using ${ctx.cfg.NVIDIA_IMAGE_EMBEDDING_MODEL}.`);
    } catch {
      usage.apiCalls += 1; usage.provider = 'nvidia';
      limitations.push('Image near-duplicate check was unavailable; no image similarity conclusion was made.');
    }
  }

  if (wantL3 && ctx.cfg.SEMANTIC_DUPLICATES === 'on' && usage.apiCalls < job.budget.maxApiCalls) {
    const files = versionFiles;
    try {
      const similar = await checkTextDuplicates(ctx, version.id, asset.ownerId, inDir, files.map(f => f.path));
      usage.apiCalls += similar.calls;
      usage.inputTokens = (usage.inputTokens ?? 0) + similar.inputTokens;
      if (similar.calls) usage.provider = 'nvidia';
      if (similar.matches.length) findings.push({ severity: 'suspected', code: 'semantic_text_overlap', message: `Text prefixes resemble ${similar.matches.length} previously checked versions in your account. Similarity is a heuristic, not proof of duplicate content.`, files: similar.matches.map(m => m.version_id) });
      if (similar.sampledBytes) limitations.push(`Semantic duplicate check compared at most 8 text prefixes (${similar.sampledBytes} bytes) within the owner's account using ${ctx.cfg.NVIDIA_EMBEDDING_MODEL}. ${imagesCompared ? 'Audio and video are' : 'Images, audio and video are'} excluded.`);
    } catch {
      // A failed provider attempt still consumes the authorized call budget.
      usage.apiCalls += 1; usage.provider = 'nvidia';
      limitations.push('Semantic text duplicate check was unavailable; no semantic conclusion was made.');
    }
  }
  const evaluation = criteria ? evaluateCriteria(criteria, { dataset: metrics }) : { results: [], passed: findings.every((f) => f.severity !== 'confirmed') };
  if (doc.truncated) evaluation.passed = false;
  const untested = evaluation.results.filter((c) => c.status === 'untested').map((c) => c.criterion);

  // controlled previews → private storage, served only via the preview endpoint
  if (doc.previews.length && version.previewStatus !== 'ready') {
    const stored = [];
    for (const p of doc.previews) {
      const key = keys.preview(version.id, p.file);
      await ctx.storage.put(key, await readFile(join(outDir, 'previews', p.file)));
      stored.push({ key, kind: p.kind, label: p.label ?? null });
    }
    await ctx.db.update(schema.assetVersions).set({ preview: stored, previewStatus: 'ready' }).where(eq(schema.assetVersions.id, version.id));
  } else if (!doc.previews.length && version.previewStatus === 'pending') {
    await ctx.db.update(schema.assetVersions).set({ previewStatus: 'failed' }).where(eq(schema.assetVersions.id, version.id));
  }

  const report: VerificationReport = {
    schema: 'edgebounty.report/1',
    assetId: asset.id,
    assetVersion: version.id,
    assetCommitment: version.commitment!,
    level: job.level,
    specHash: job.specHash,
    datasetMetrics: metrics,
    modelMetrics: null,
    findings,
    criteria: evaluation.results,
    passed: evaluation.passed,
    sampling: doc.truncated ? `prefix of ${doc.itemsProcessed} items (budget)` : wantL3 ? `all items for L1/L2; random sample (seeded) for L3` : 'all items',
    tools,
    limitations,
    untested,
    verifier: job.providerWallet ?? 'edgebounty-platform',
    createdAt: new Date().toISOString(),
  };
  if (wantL3 && usage.apiCalls < job.budget.maxApiCalls) {
    const summary = await explainReport(ctx.cfg, { ...report, summary: undefined });
    if (summary) report.summary = `AI-generated explanation (${ctx.cfg.L3_TEXT_MODEL}); not evidence: ${summary}`;
    if (summary && usage.provider === 'nvidia') usage.apiCalls += 1;
  }
  return { report, costMicro, usage };
}

/** Platform-operated verifier posts the verdict on-chain, creating the Attestation PDA. */
export async function publishOrderVerdict(ctx: AppContext, job: Job, reportHash: string, passed: boolean) {
  const key = ctx.chain.platformVerifier;
  if (!key || !job.orderId) return;
  const [order] = await ctx.db.select().from(schema.orders).where(eq(schema.orders.id, job.orderId));
  if (!order || order.verifierWallet !== key.publicKey.toBase58()) return;
  const onchain = await ctx.chain.client.order(new PublicKey(order.onchainAddress));
  if (!onchain || onchain.state !== 'submitted') return;
  const { attestation, ixs } = await ctx.chain.client.submitOrderVerification(key.publicKey, new PublicKey(order.onchainAddress), {
    resultHash: hexToBytes(reportHash),
    specHash: hexToBytes(job.specHash),
    benchmarkVersion: 1,
    passed,
  });
  const sig = await ctx.chain.send(ixs, key, 'platform verifier');
  await ctx.db.update(schema.verificationResults).set({ attestationAddress: attestation.toBase58(), txSignature: sig }).where(eq(schema.verificationResults.jobId, job.id));
  await ctx.db.insert(schema.onchainTransactions).values({ signature: sig, kind: 'submit_order_verification', subject: order.onchainAddress, wallet: key.publicKey.toBase58(), status: 'confirmed' });
  const { syncOrder } = await import('./indexer.js');
  await syncOrder(ctx, order);
}

/** Platform acting as a provider on an on-chain VerificationJob: posts the attested result. */
export async function publishJobResult(ctx: AppContext, job: Job, reportHash: string, passed: boolean) {
  const key = ctx.chain.platformVerifier;
  if (!key || !job.onchainJobAddress) return;
  const addr = new PublicKey(job.onchainJobAddress);
  const v = await ctx.chain.client.job(addr);
  if (!v || v.state !== 'accepted' || v.provider !== key.publicKey.toBase58()) return;
  const [version] = await ctx.db.select().from(schema.assetVersions).where(eq(schema.assetVersions.id, job.assetVersionId));
  const { attestation, ixs } = await ctx.chain.client.submitVerificationJobResult(key.publicKey, addr, { resultHash: hexToBytes(reportHash), passed, assetVersion: version.version, benchmarkVersion: 1 });
  const sig = await ctx.chain.send(ixs, key, 'platform verifier');
  await ctx.db.update(schema.verificationResults).set({ attestationAddress: attestation.toBase58(), txSignature: sig }).where(eq(schema.verificationResults.jobId, job.id));
  await ctx.db.update(schema.providerJobs).set({ report: (await ctx.db.select().from(schema.verificationResults).where(eq(schema.verificationResults.jobId, job.id)))[0].report, reportHash }).where(eq(schema.providerJobs.onchainAddress, job.onchainJobAddress));
}

/**
 * The platform's own provider identity picks up on-chain jobs addressed to it (or open jobs it is
 * qualified for), runs them on the orchestrator and publishes results — giving any user an
 * on-chain certificate without a marketplace transaction.
 */
export async function platformProviderTick(ctx: AppContext) {
  const key = ctx.chain.platformVerifier;
  if (!key) return 0;
  const me = key.publicKey.toBase58();
  const prov = await ctx.chain.client.provider(key.publicKey);
  if (!prov?.approved) return 0;
  let n = 0;
  const rows = await ctx.db.select().from(schema.providerJobs).where(eq(schema.providerJobs.chainState, 'open'));
  for (const r of rows) {
    const v = await ctx.chain.client.job(new PublicKey(r.onchainAddress));
    if (!v || v.state !== 'open' || v.requester === me) continue;
    if (v.provider !== PublicKey.default.toBase58() && v.provider !== me) continue;
    if ((prov.capabilities & v.requiredCapability) !== v.requiredCapability) continue;
    const [version] = await ctx.db.select().from(schema.assetVersions).where(eq(schema.assetVersions.id, r.assetVersionId));
    if (!version || version.commitment !== v.assetCommitment) continue;
    try {
      await ctx.chain.send(await ctx.chain.client.acceptVerificationJob(key.publicKey, new PublicKey(r.onchainAddress)), key, 'platform verifier');
    } catch (e) {
      console.warn('[platform-provider] accept failed', (e as Error).message);
      continue;
    }
    const spec = r.spec as { level: AnalysisLevel; criteria: unknown };
    const job = await createJob(ctx, { kind: 'provider_job', assetVersionId: r.assetVersionId, requesterId: r.requesterId, level: spec.level, criteria: spec.criteria, providerWallet: me, publishOnchain: true });
    // the job's spec hash must equal the one the requester committed on-chain
    await ctx.db.update(schema.verificationJobs).set({ onchainJobAddress: r.onchainAddress, specHash: r.specHash }).where(eq(schema.verificationJobs.id, job.id));
    await ctx.db.update(schema.providerJobs).set({ chainState: 'accepted', providerWallet: me }).where(eq(schema.providerJobs.id, r.id));
    n++;
  }
  return n;
}

/** Background loop: claim → run, plus stale-lock recovery. Returns a stop function. */
export function startOrchestrator(ctx: AppContext, opts: { intervalMs?: number; workerId?: string } = {}) {
  const workerId = opts.workerId ?? `worker-${process.pid}`;
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await reclaimStaleJobs(ctx);
      for (let job = await claimNextJob(ctx, workerId); job && !stopped; job = await claimNextJob(ctx, workerId)) await runJob(ctx, job);
      if (ctx.cfg.COLLABORATIVE_BOUNTIES_ENABLED === '1') await drainCollaboration(ctx);
    } catch (e) {
      console.error('[orchestrator]', e);
    } finally {
      running = false;
    }
  };
  const t = setInterval(tick, opts.intervalMs ?? 2000);
  void tick();
  return () => {
    stopped = true;
    clearInterval(t);
  };
}

/** Drain the queue synchronously (tests and CLI). */
export async function drainJobs(ctx: AppContext, workerId = 'drain') {
  let n = 0;
  for (let job = await claimNextJob(ctx, workerId); job; job = await claimNextJob(ctx, workerId)) {
    await runJob(ctx, job);
    n++;
  }
  if (ctx.cfg.COLLABORATIVE_BOUNTIES_ENABLED === '1') await drainCollaboration(ctx);
  return n;
}

