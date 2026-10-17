import type { Config } from '../config.js';

/**
 * Provider-measured R2 and Worker usage from Cloudflare's GraphQL Analytics API, priced with the published
 * rates after monthly free allowances. Usage counts come from Cloudflare; the dollar figures are still an
 * estimate of the invoice (plan discounts, taxes and rounding are not visible through analytics).
 */

// https://developers.cloudflare.com/r2/pricing/ (October 2026)
const CLASS_A = new Set(['ListBuckets', 'PutBucket', 'ListObjects', 'PutObject', 'CopyObject', 'CompleteMultipartUpload', 'CreateMultipartUpload', 'LifecycleStorageTierTransition', 'ListMultipartUploads', 'UploadPart', 'UploadPartCopy', 'ListParts', 'PutBucketEncryption', 'PutBucketCors', 'PutBucketLifecycleConfiguration']);
const CLASS_B = new Set(['HeadBucket', 'HeadObject', 'GetObject', 'UsageSummary', 'GetBucketEncryption', 'GetBucketLocation', 'GetBucketCors', 'GetBucketLifecycleConfiguration']);
const FREE = new Set(['DeleteObject', 'DeleteBucket', 'AbortMultipartUpload']);
export const R2_RATES = { classAMicroPerMillion: 4_500_000n, classBMicroPerMillion: 360_000n, storageMicroPerGbMonth: 15_000n, freeClassA: 1_000_000n, freeClassB: 10_000_000n, freeGbMonth: 10 };
// https://developers.cloudflare.com/workers/platform/pricing/ — paid plan: $5 base incl. 10M requests, then $0.30/M
export const WORKER_RATES = { paidBaseMicro: 5_000_000n, paidIncludedRequests: 10_000_000n, paidMicroPerMillion: 300_000n, freeRequestsPerDay: 100_000 };

export const opClass = (action: string): 'A' | 'B' | 'free' | 'unknown' => (CLASS_A.has(action) ? 'A' : CLASS_B.has(action) ? 'B' : FREE.has(action) ? 'free' : 'unknown');

export interface CloudflareUsage {
  period: { from: string; to: string };
  r2: { byAction: { action: string; status: string; class: string; requests: number }[]; classA: number; classB: number; free: number; unknown: number; storageBytes: number; objectCount: number; gbMonthToDate: number };
  worker: { script: string; requests: number; errors: number; cpuTimeP50Us: number | null };
  estimate: { classAMicro: string; classBMicro: string; storageMicro: string; workerMicro: string; totalMicro: string; plan: string; basis: string };
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export function accountIdFromEndpoint(endpoint?: string) {
  if (!endpoint) return null;
  const host = new URL(endpoint).hostname;
  return /^[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/.test(host) ? host.split('.')[0] : null;
}

export async function fetchCloudflareUsage(cfg: Config, now = new Date(), fetcher: typeof fetch = fetch): Promise<CloudflareUsage> {
  const account = cfg.CLOUDFLARE_ACCOUNT_ID ?? accountIdFromEndpoint(cfg.S3_ENDPOINT);
  if (!cfg.CLOUDFLARE_ANALYTICS_TOKEN || !account || !cfg.S3_BUCKET) throw new Error('Cloudflare reconciliation needs CLOUDFLARE_ANALYTICS_TOKEN (Account Analytics: Read), an R2 endpoint or CLOUDFLARE_ACCOUNT_ID, and S3_BUCKET');
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const query = `query($a: string!, $s: Time!, $e: Time!, $b: string!, $w: string!) { viewer { accounts(filter: {accountTag: $a}) {
    ops: r2OperationsAdaptiveGroups(limit: 200, filter: {datetime_geq: $s, datetime_leq: $e, bucketName: $b}) { sum { requests } dimensions { actionType actionStatus } }
    storage: r2StorageAdaptiveGroups(limit: 1, filter: {datetime_geq: $s, datetime_leq: $e, bucketName: $b}, orderBy: [datetime_DESC]) { max { objectCount payloadSize metadataSize } dimensions { datetime } }
    workers: workersInvocationsAdaptive(limit: 10, filter: {datetime_geq: $s, datetime_leq: $e, scriptName: $w}) { sum { requests errors } quantiles { cpuTimeP50 } }
  } } }`;
  const response = await fetcher('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST', signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${cfg.CLOUDFLARE_ANALYTICS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { a: account, s: from.toISOString(), e: now.toISOString(), b: cfg.S3_BUCKET, w: cfg.CLOUDFLARE_WORKER_NAME } }),
  });
  const doc = (await response.json().catch(() => null)) as any;
  if (!response.ok || doc?.errors?.length || !doc?.data?.viewer?.accounts?.[0]) throw new Error(`Cloudflare analytics request failed (${response.status}${doc?.errors?.[0]?.message ? `: ${String(doc.errors[0].message).slice(0, 200)}` : ''})`);
  const acc = doc.data.viewer.accounts[0];

  const byAction = (acc.ops as any[]).map((o) => ({ action: o.dimensions.actionType as string, status: o.dimensions.actionStatus as string, class: opClass(o.dimensions.actionType), requests: Number(o.sum.requests) })).sort((a, b) => b.requests - a.requests);
  const count = (c: string) => byAction.filter((o) => o.class === c).reduce((n, o) => n + o.requests, 0);
  const st = acc.storage?.[0]?.max ?? { payloadSize: 0, metadataSize: 0, objectCount: 0 };
  const storageBytes = Number(st.payloadSize) + Number(st.metadataSize);
  // month-to-date GB-months, assuming the latest stored size held since the start of the month (conservative upper bound)
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsedDays = (now.getTime() - from.getTime()) / 86_400_000;
  const gbMonthToDate = (storageBytes / 1024 ** 3) * (elapsedDays / daysInMonth);
  const w = (acc.workers as any[])[0];
  const workerRequests = Number(w?.sum?.requests ?? 0);

  const billable = (used: number, free: bigint) => (BigInt(used) > free ? BigInt(used) - free : 0n);
  const classAMicro = ceilDiv(billable(count('A'), R2_RATES.freeClassA) * R2_RATES.classAMicroPerMillion, 1_000_000n);
  const classBMicro = ceilDiv(billable(count('B'), R2_RATES.freeClassB) * R2_RATES.classBMicroPerMillion, 1_000_000n);
  const storageMicro = BigInt(Math.ceil(Math.max(0, gbMonthToDate - R2_RATES.freeGbMonth) * Number(R2_RATES.storageMicroPerGbMonth)));
  const workerMicro = cfg.CLOUDFLARE_WORKERS_PLAN === 'paid'
    ? WORKER_RATES.paidBaseMicro + ceilDiv(billable(workerRequests, WORKER_RATES.paidIncludedRequests) * WORKER_RATES.paidMicroPerMillion, 1_000_000n)
    : 0n;
  return {
    period: { from: from.toISOString(), to: now.toISOString() },
    r2: { byAction, classA: count('A'), classB: count('B'), free: count('free'), unknown: count('unknown'), storageBytes, objectCount: Number(st.objectCount), gbMonthToDate },
    worker: { script: cfg.CLOUDFLARE_WORKER_NAME, requests: workerRequests, errors: Number(w?.sum?.errors ?? 0), cpuTimeP50Us: w?.quantiles?.cpuTimeP50 ?? null },
    estimate: {
      classAMicro: classAMicro.toString(), classBMicro: classBMicro.toString(), storageMicro: storageMicro.toString(), workerMicro: workerMicro.toString(),
      totalMicro: (classAMicro + classBMicro + storageMicro + workerMicro).toString(),
      plan: cfg.CLOUDFLARE_WORKERS_PLAN,
      basis: 'Cloudflare-measured month-to-date usage x published rates after monthly free allowances; storage assumes the latest size held all month. Not an invoice.',
    },
  };
}

/** Our SDK counters use `PutObjectCommand`-style names and are cumulative since the counters were created. */
export function compareWithObserved(usage: CloudflareUsage, counters: { key: string; count: bigint }[], provider: string) {
  const observed = new Map<string, number>();
  for (const c of counters) {
    const [p, op, status] = c.key.split(':');
    if (p !== provider || status !== 'ok') continue;
    observed.set(op.replace(/Command$/, ''), Number(c.count));
  }
  const measured = new Map<string, number>();
  for (const o of usage.r2.byAction) if (o.status === 'success') measured.set(o.action, (measured.get(o.action) ?? 0) + o.requests);
  const actions = [...new Set([...measured.keys(), ...observed.keys()])].sort();
  return actions.map((action) => ({
    action, class: opClass(action), cloudflareMonthToDate: measured.get(action) ?? 0, apiObservedAllTime: observed.get(action) ?? 0,
    note: ['UploadPart', 'GetObject'].includes(action) ? 'Browsers upload parts and the Worker reads objects directly; the API does not see these calls.' : undefined,
  }));
}
