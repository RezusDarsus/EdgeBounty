import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import type { AppContext } from '../context.js';
import { forbidden, parse, zWallet } from '../lib/http.js';
import { fundTestUsdc } from '@edgebounty/blockchain-client';

/**
 * Localnet-only faucet: test SOL for demo payments and fees. Refuses to register unless NODE_ENV=development,
 * a faucet key is configured, and the RPC is a local validator.
 */
export function devRoutes(app: FastifyInstance, ctx: AppContext) {
  const rpc = new URL(ctx.cfg.SOLANA_RPC_URL);
  const local = ['http:', 'https:'].includes(rpc.protocol) && ['127.0.0.1', 'localhost'].includes(rpc.hostname);
  if (ctx.cfg.NODE_ENV !== 'development' || !process.env.DEV_FAUCET_KEY || !local) return;
  const faucet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.DEV_FAUCET_KEY)));
  app.post('/dev/faucet', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { wallet } = parse(z.object({ wallet: zWallet }), req.body);
    const cfg = await ctx.chain.client.config();
    if (!cfg) throw forbidden('platform not initialized');
    const to = new PublicKey(wallet);
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: faucet.publicKey, toPubkey: to, lamports: 2 * LAMPORTS_PER_SOL }));
    await sendAndConfirmTransaction(ctx.chain.connection, tx, [faucet], { commitment: 'confirmed' });
    if (ctx.cfg.PAYMENT_CURRENCY === 'USDC') await fundTestUsdc(ctx.chain.connection, faucet, cfg.paymentMint, to, 1_000_000_000n);
    return { ok: true, sol: 2, mockUsdc: ctx.cfg.PAYMENT_CURRENCY === 'USDC' ? 1000 : 0 };
  });
}
