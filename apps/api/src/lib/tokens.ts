import { createHmac, timingSafeEqual } from 'node:crypto';

export interface DownloadClaims {
  /** scope: delivery (buyer), eval (verifier), review (dispute reviewer) */
  s: 'delivery' | 'eval' | 'review' | 'collaboration_review';
  /** grant id: entitlement / job / dispute */
  g: string;
  /** file id */
  f: string;
  /** wallet the token was issued to */
  w: string;
  /** expiry, unix seconds */
  x: number;
}

export const DOWNLOAD_TTL_SECS = 10 * 60;

export function signDownloadToken(secret: string, c: DownloadClaims): string {
  const body = Buffer.from(JSON.stringify(c)).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyDownloadToken(secret: string, token: string): DownloadClaims | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expect = createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString()) as DownloadClaims;
    if (typeof c.x !== 'number' || c.x < Math.floor(Date.now() / 1000)) return null;
    return c;
  } catch {
    return null;
  }
}
