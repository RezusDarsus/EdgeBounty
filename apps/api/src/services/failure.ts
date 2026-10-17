import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { PublicKey } from '@solana/web3.js';
import { DOMAIN, bytesToHex, hashDocument } from '@edgebounty/verification-schemas';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { runSandboxed } from './sandbox.js';

export interface FailureSpec {
  kind: 'image_classification_failure' | 'manual';
  classes?: string[];
  preprocessing?: { size: [number, number]; scale: number; mean: number[]; std: number[]; layout: 'NCHW' | 'NHWC' };
  failureDefinition: string;
  inputType: string;
  environment: string;
  duplicationRules: string;
  licenseRequired: string;
}

/**
 * Reproducible failure check: the contributed example ships images + labels.csv (expected
 * labels). The target model is re-run in the sandbox; the example is a verified failure when
 * the model's top-1 prediction is wrong on at least one contributed input.
 */
export async function evaluateFailureExample(ctx: AppContext, bounty: typeof schema.failureBounties.$inferSelect, example: typeof schema.failureExamples.$inferSelect) {
  const spec = bounty.spec as FailureSpec;
  if (spec.kind !== 'image_classification_failure' || !bounty.modelAssetVersionId || !spec.classes || !spec.preprocessing) return null;
  const work = join(ctx.cfg.DATA_DIR, 'work', `failure-${example.id}`);
  const inDir = join(work, 'in');
  const outDir = join(work, 'out');
  try {
    await rm(work, { recursive: true, force: true });
    await mkdir(inDir, { recursive: true });
    await mkdir(join(outDir, 'bench', 'images'), { recursive: true });
    for (const f of await ctx.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.versionId, bounty.modelAssetVersionId))) {
      await ctx.storage.materialize(f.objectKey, join(inDir, ...f.path.split('/')));
    }
    const files = await ctx.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.versionId, example.assetVersionId));
    const labelsFile = files.find((f) => f.path.endsWith('labels.csv'));
    if (!labelsFile) return { passed: false, report: { error: 'example must include labels.csv (filename,label)' } };
    for (const f of files) {
      const name = f.path.split('/').pop()!;
      await ctx.storage.materialize(f.objectKey, join(outDir, 'bench', name === 'labels.csv' ? 'labels.csv' : join('images', name)));
    }
    await writeFile(join(outDir, 'bench', 'classes.txt'), spec.classes.join('\n'));
    await writeFile(join(outDir, 'bench', 'benchmark.json'), JSON.stringify({ id: `failure-${bounty.id}`, version: 1, task: 'image_classification', ...spec.preprocessing }));
    const r = await runSandboxed(ctx.cfg, {
      script: 'model-validator/validate_model.py',
      args: ['--input', '{in}', '--output', '{out}/result.json', '--benchmark', '{out}/bench', '--max-items', '50', '--max-seconds', '120'],
      inputDir: inDir,
      outputDir: outDir,
      timeoutMs: 180_000,
    });
    if (r.code !== 0) return { passed: false, report: { error: r.stderr.slice(-1000) } };
    const doc = JSON.parse(await readFile(join(outDir, 'result.json'), 'utf8'));
    const acc = doc.metrics?.benchmark?.metrics?.accuracy;
    const report = { schema: 'edgebounty.failure-report/1', bounty: bounty.onchainAddress, example: example.onchainAddress, modelCommitment: bounty.modelCommitment, accuracy: acc ?? null, samples: doc.metrics?.benchmark?.samples ?? 0, failureDefinition: spec.failureDefinition, tools: doc.tools };
    return { passed: typeof acc === 'number' && acc < 1, report };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/** Platform verifier evaluates pending examples of bounties it is assigned to. */
export async function failureVerifierTick(ctx: AppContext) {
  const key = ctx.chain.platformVerifier;
  if (!key) return 0;
  const me = key.publicKey.toBase58();
  let n = 0;
  const bounties = await ctx.db.select().from(schema.failureBounties).where(and(eq(schema.failureBounties.verifierWallet, me), eq(schema.failureBounties.chainState, 'open')));
  for (const b of bounties) {
    const pending = await ctx.db.select().from(schema.failureExamples).where(and(eq(schema.failureExamples.bountyId, b.id), eq(schema.failureExamples.status, 'pending')));
    for (const e of pending) {
      const res = await evaluateFailureExample(ctx, b, e);
      if (!res) continue;
      const resultHash = hashDocument(DOMAIN.report, res.report);
      try {
        const ixs = await ctx.chain.client.verifyFailureExample(key.publicKey, new PublicKey(b.onchainAddress), new PublicKey(e.onchainAddress), res.passed, resultHash);
        await ctx.chain.send(ixs, key, 'failure verifier');
        await ctx.db.update(schema.failureExamples).set({ status: res.passed ? 'accepted' : 'rejected', report: { ...res.report, resultHash: bytesToHex(resultHash) } }).where(eq(schema.failureExamples.id, e.id));
        n++;
      } catch (err) {
        console.warn('[failure-verifier]', (err as Error).message);
      }
    }
  }
  return n;
}

