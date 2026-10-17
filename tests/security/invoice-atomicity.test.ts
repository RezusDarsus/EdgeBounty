import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { eq, sql } from 'drizzle-orm';
import { loadConfig } from '../../apps/api/src/config.js';
import { createDb, schema } from '../../apps/api/src/db/index.js';
import { ChainService } from '../../apps/api/src/chain.js';
import { LocalStorage } from '../../apps/api/src/storage/index.js';
import { confirmInvoice, confirmPaidInvoices } from '../../apps/api/src/services/indexer.js';
import type { AppContext } from '../../apps/api/src/context.js';
let ctx: AppContext, close: () => Promise<void>;
beforeAll(async () => { const d = await createDb({ memory: true }); close = d.close; const cfg = loadConfig({ NODE_ENV: 'test', WORKERS: 'off', SOLANA_RPC_URL: 'http://127.0.0.1:1' }); ctx = { cfg, db: d.db, chain: new ChainService(cfg), storage: new LocalStorage('.data/test-invoice'), events: {} }; });
afterAll(async () => { await close?.(); });
async function invoice(status: 'open' | 'expired' = 'open') {
  const wallet = Keypair.generate().publicKey.toBase58();
  const [a] = await ctx.db.insert(schema.accounts).values({ wallet, alias: wallet }).returning();
  const [inv] = await ctx.db.insert(schema.invoices).values({ accountId: a.id, kind: 'other', reference: randomBytes(32).toString('hex'), amountMicro: 10n, status, expiresAt: new Date(Date.now() - 1000), metadata: { credits: true } }).returning();
  vi.spyOn(ctx.chain.client, 'receipt').mockResolvedValue({ payer: wallet, amount: 10n, paidAt: Math.floor(Date.now() / 1000), address: Keypair.generate().publicKey.toBase58() } as any);
  return inv;
}
it('rolls back the paid transition when fulfillment fails, then retries exactly once', async () => {
  const inv = await invoice();
  await ctx.db.execute(sql`CREATE FUNCTION reject_credit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected fulfillment failure'; END; $$ LANGUAGE plpgsql`);
  await ctx.db.execute(sql`CREATE TRIGGER reject_credit BEFORE INSERT ON credits FOR EACH ROW EXECUTE FUNCTION reject_credit()`);
  await expect(confirmInvoice(ctx, inv)).rejects.toThrow();
  expect((await ctx.db.select().from(schema.invoices).where(eq(schema.invoices.id, inv.id)))[0].status).toBe('open');
  await ctx.db.execute(sql`DROP TRIGGER reject_credit ON credits`);
  expect(await confirmInvoice(ctx, inv)).toBe(true);
  expect(await confirmInvoice(ctx, inv)).toBe(true);
  expect(await ctx.db.select().from(schema.credits).where(eq(schema.credits.accountId, inv.accountId))).toHaveLength(1);
});
it('fulfills a chain-confirmed expired invoice rather than reporting paid without persisted benefits', async () => {
  const inv = await invoice('expired'); expect(await confirmInvoice(ctx, inv)).toBe(true);
  expect((await ctx.db.select().from(schema.invoices).where(eq(schema.invoices.id, inv.id)))[0].status).toBe('paid');
  expect(await ctx.db.select().from(schema.credits).where(eq(schema.credits.accountId, inv.accountId))).toHaveLength(1);
});
it('automatically discovers a delayed expired-invoice receipt with bounded polling and no duplicate grant', async () => {
  const inv = await invoice('expired');
  const receipt = vi.mocked(ctx.chain.client.receipt); const before = receipt.mock.calls.length;
  await confirmPaidInvoices(ctx); await confirmPaidInvoices(ctx);
  expect((await ctx.db.select().from(schema.invoices).where(eq(schema.invoices.id, inv.id)))[0].status).toBe('paid');
  expect(await ctx.db.select().from(schema.credits).where(eq(schema.credits.accountId, inv.accountId))).toHaveLength(1);
  expect(receipt.mock.calls.length - before).toBe(1);
});
