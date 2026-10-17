import { randomBytes, createHash } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { SignJWT, jwtVerify } from 'jose';
import { PublicKey } from '@solana/web3.js';

export const NONCE_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_SECS = 12 * 60 * 60;

export function isWallet(s: string): boolean {
  try {
    return PublicKey.isOnCurve(new PublicKey(s).toBytes()) || new PublicKey(s).toBase58() === s;
  } catch {
    return false;
  }
}

/** Sign-In-With-Solana style message (CAIP-122 layout), bound to domain, nonce and expiry. */
export function buildSignInMessage(p: { domain: string; wallet: string; nonce: string; issuedAt: Date; expiresAt: Date; chainId: string }): string {
  return [
    `${p.domain} wants you to sign in with your Solana account:`,
    p.wallet,
    '',
    'Sign in to EdgeBounty. This request will not trigger a blockchain transaction or cost any fees.',
    '',
    `URI: https://${p.domain}`,
    'Version: 1',
    `Chain ID: ${p.chainId}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt.toISOString()}`,
    `Expiration Time: ${p.expiresAt.toISOString()}`,
  ].join('\n');
}

export function newNonce(): string {
  return randomBytes(16).toString('hex');
}

export function verifyWalletSignature(message: string, signatureB58: string, wallet: string): boolean {
  try {
    const sig = bs58.decode(signatureB58);
    if (sig.length !== 64) return false;
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, new PublicKey(wallet).toBytes());
  } catch {
    return false;
  }
}

export interface Session {
  accountId: string;
  wallet: string;
  roles: string[];
  /** present only for API-key sessions */
  scopes?: string[];
}

export async function issueSession(secret: string, s: Session): Promise<string> {
  return new SignJWT({ wallet: s.wallet, roles: s.roles })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(s.accountId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECS}s`)
    .setIssuer('edgebounty')
    .sign(new TextEncoder().encode(secret));
}

export async function verifySession(secret: string, token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { issuer: 'edgebounty', algorithms: ['HS256'] });
    return { accountId: payload.sub!, wallet: payload.wallet as string, roles: (payload.roles as string[]) ?? [] };
  } catch {
    return null;
  }
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

const ADJ = ['amber', 'brisk', 'calm', 'deft', 'eager', 'fuzzy', 'gentle', 'hidden', 'ivory', 'jolly', 'keen', 'lunar', 'mellow', 'nimble', 'opal', 'quiet', 'rapid', 'silent', 'tidal', 'vivid'];
const NOUN = ['falcon', 'otter', 'lynx', 'heron', 'badger', 'panda', 'raven', 'tiger', 'koala', 'marten', 'orca', 'puffin', 'quokka', 'gecko', 'ibis', 'yak', 'wombat', 'newt', 'stoat', 'vole'];
/** Deterministic pseudonymous alias derived from the wallet. */
export function aliasFor(wallet: string): string {
  const h = createHash('sha256').update(wallet).digest();
  return `${ADJ[h[0] % ADJ.length]}-${NOUN[h[1] % NOUN.length]}-${h.readUInt16BE(2) % 1000}`;
}
