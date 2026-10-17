import { and, eq, inArray } from 'drizzle-orm';
import { verificationQuote } from '@edgebounty/pricing-engine';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { processingAmount } from './payments.js';
import type { Config } from '../config.js';
import { conflict } from './http.js';

/** Listings need paid full-file checks; a free preview is not publication approval. */
export async function requireListingVerification(ctx: AppContext, versionId: string) {
  if (ctx.cfg.MALWARE_SCAN_REQUIRED === '1') {
    const [version] = await ctx.db.select().from(schema.assetVersions).where(eq(schema.assetVersions.id, versionId));
    const scan = (version?.metadata as any)?.malware;
    if (!scan || scan.status !== 'clean' || scan.policy !== 'clamav-bounded/1' || scan.commitment !== version?.commitment) throw conflict('Complete malware scanning and paid verification for this immutable version before publication.');
  }
  const jobs = await ctx.db.select({ id: schema.verificationJobs.id })
    .from(schema.verificationJobs)
    .where(and(eq(schema.verificationJobs.assetVersionId, versionId), eq(schema.verificationJobs.status, 'completed'), inArray(schema.verificationJobs.level, ['L2', 'L3'])));
  for (const job of jobs) {
    const [result] = await ctx.db.select().from(schema.verificationResults).where(eq(schema.verificationResults.jobId, job.id));
    if (result?.passed) return;
  }
  throw conflict('Complete paid verification and resolve any failing checks before publishing this version.');
}

/** Platform rate schedule, locked per delivery including agreed correction rounds. */
export function requestVerificationQuote(criteria: any, maxCorrections: number, cfg?: Config) {
  const items = criteria.kind === 'image_dataset' ? criteria.minImages : criteria.kind === 'tabular_dataset' ? criteria.minRows : 1;
  const quote = verificationQuote({ items, bytes: 0, level: criteria.minRelevanceBps !== undefined ? 'L3' : 'L2', modelBenchmark: criteria.kind === 'model' ? { computeSeconds: 60, gpu: false } : undefined });
  return { fee: (cfg ? processingAmount(cfg, quote.price) : quote.price) * BigInt(1 + maxCorrections), rounds: 1 + maxCorrections };
}

/**
 * Bump when the verification method changes (validator, prompts, thresholds). A result is reused across
 * purchases only for the same immutable version, the same check spec AND the same policy version.
 */
export const VERIFICATION_POLICY_VERSION = 'vp-2026-10-17';

/** Level the platform runs for a purchase/bounty order's acceptance criteria. */
export function orderLevel(criteria: { kind?: string; minRelevanceBps?: number } | null): 'L2' | 'L3' {
  return criteria?.kind === 'image_dataset' && criteria.minRelevanceBps !== undefined ? 'L3' : 'L2';
}
