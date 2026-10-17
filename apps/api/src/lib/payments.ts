import { NATIVE_MINT } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { ceilDiv, type Quote } from '@edgebounty/pricing-engine';
import type { Config } from '../config.js';

export function paymentMint(cfg: Config): PublicKey {
  return cfg.PAYMENT_CURRENCY === 'USDC' ? new PublicKey(cfg.PAYMENT_MINT!) : NATIVE_MINT;
}

/** Legacy quote fields are named lamports: this rate converts USD into the configured token base units. */
export function paymentQuoteRate(cfg: Config): bigint {
  return cfg.PAYMENT_CURRENCY === 'USDC' ? 1_000_000_000n : cfg.SOL_USD_MICRO;
}

/** Legacy processing rates are SOL amounts; lock their USD value before producing a USDC invoice. */
export function processingAmount(cfg: Config, legacyLamports: bigint): bigint {
  return cfg.PAYMENT_CURRENCY === 'USDC' ? ceilDiv(legacyLamports * cfg.SOL_USD_MICRO, 1_000_000_000n) : legacyLamports;
}

export function processingQuote(cfg: Config, q: Quote): Quote {
  const lines = q.lines.map((l) => ({ ...l, amount: processingAmount(cfg, l.amount) }));
  const price = lines.reduce((sum, l) => sum + l.amount, 0n);
  return { ...q, price, lines, budget: { ...q.budget, maxSpend: price } };
}
