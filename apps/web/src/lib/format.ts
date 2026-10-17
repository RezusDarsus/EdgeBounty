import { formatSol, formatUsdc, usdc } from '@edgebounty/pricing-engine';

export const CURRENCY = process.env.NEXT_PUBLIC_PAYMENT_CURRENCY === 'USDC' ? 'USDC' : 'SOL';
export const sol = (micro: string | bigint | number | null | undefined) => (micro === null || micro === undefined ? '—' : `${CURRENCY === 'USDC' ? formatUsdc(BigInt(micro)) : formatSol(BigInt(micro))} ${CURRENCY}`);
export const short = (s?: string | null, n = 4) => (s ? `${s.slice(0, n)}…${s.slice(-n)}` : '—');
export const bytes = (n?: number | null) => {
  if (n === null || n === undefined) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};
export const date = (d?: string | number | Date | null) => (d ? new Date(typeof d === 'number' ? d * 1000 : d).toLocaleString() : '—');
export const pct = (bps?: number | null) => (bps === null || bps === undefined ? '—' : `${(bps / 100).toFixed(1)}%`);
export const toMicro = (usd: string) => {
  if (CURRENCY === 'USDC') return usdc(usd.trim()).toString();
  if (!/^\d+(?:\.\d{0,9})?$/.test(usd.trim())) throw new Error('Enter a SOL amount with at most 9 decimals.');
  const [i, f = ''] = usd.trim().split('.');
  if (!/^\d+$/.test(i || '0') || !/^\d{0,9}$/.test(f)) throw new Error('invalid amount');
  return (BigInt(i || '0') * 1_000_000_000n + BigInt(f.padEnd(9, '0'))).toString();
};

export const STATE_LABEL: Record<string, string> = {
  draft: 'Draft (not on-chain)',
  created: 'Created',
  funded: 'Funded — open',
  assigned: 'In progress',
  submitted: 'Awaiting verification',
  under_review: 'Buyer review',
  approved: 'Approved — settling',
  disputed: 'Disputed',
  correction_required: 'Correction requested',
  settled: 'Settled',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
  mismatch: 'Integrity mismatch',
};
