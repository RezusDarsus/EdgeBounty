import { and, eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { specFor } from '../services/jobs.js';
import { VERIFICATION_POLICY_VERSION, orderLevel } from './verification-policy.js';
import type { createCheckout } from './billing.js';

const str = (o: Record<string, bigint>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.toString()]));

export function checkoutView(c: Awaited<ReturnType<typeof createCheckout>>) {
  return {
    id: c.row.id,
    status: c.row.status,
    months: c.row.months,
    pricingVersion: c.quote.pricingVersion,
    solUsdMicro: c.row.solUsdMicro.toString(),
    accessStartsAt: c.row.accessStartsAt,
    accessEndsAt: c.row.accessEndsAt,
    allowanceBytes: c.quote.allowanceBytes.toString(),
    hostingGapSecs: c.quote.hostingGaps.reduce((n, g) => n + (g.end - g.start), 0n).toString(),
    usdMicro: str(c.quote.usd),
    lamports: str(c.quote.lamports),
    invoice: c.invoice,
  };
}

/** True when the platform verifier already holds a persisted result for exactly this version + spec + policy. */
export async function platformResultReusable(ctx: AppContext, versionId: string, verifierWallet: string, criteria: unknown) {
  if (ctx.chain.platformVerifier?.publicKey.toBase58() !== verifierWallet) return false;
  const { specHash } = specFor(orderLevel(criteria as any), criteria, (criteria as any)?.kind === 'model' ? (criteria as any).benchmarkId : null, ctx.cfg);
  const [run] = await ctx.db
    .select()
    .from(schema.verificationRuns)
    .where(and(eq(schema.verificationRuns.assetVersionId, versionId), eq(schema.verificationRuns.specHash, specHash), eq(schema.verificationRuns.policyVersion, VERIFICATION_POLICY_VERSION), eq(schema.verificationRuns.status, 'completed')));
  return !!run;
}
