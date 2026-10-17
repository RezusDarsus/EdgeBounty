import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import type { Config } from '../config.js';
import { paymentMint } from './payments.js';

/** A database is permanently bound to a currency, mint, genesis hash and program. */
export async function bindDeployment(db: Db, cfg: Config, genesis: string, programId: string) {
  // Operator explicitly prohibited mainnet activation. Check chain identity, not an RPC URL label.
  if (genesis === '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('Mainnet activation is disabled by operator instruction. Obtain explicit approval and a reviewed deployment before enabling mainnet.');
  const fingerprint = JSON.stringify({ currency: cfg.PAYMENT_CURRENCY, mint: paymentMint(cfg).toBase58(), genesis, programId });
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('deployment-identity', 0))`);
    await tx.execute(sql`create table if not exists deployment_identity (id integer primary key, fingerprint text not null)`);
    const result = await tx.execute(sql`select fingerprint from deployment_identity where id = 1`);
    const rows = (result as any).rows ?? result;
    if (rows[0]) {
      if (rows[0].fingerprint !== fingerprint) throw new Error('Database deployment identity mismatch. Use the original chain/currency or a separate database.');
      return;
    }
    const count = await tx.execute(sql`select (select count(*) from orders) + (select count(*) from invoices) + (select count(*) from listings) as n`);
    const countRows = (count as any).rows ?? count;
    if (cfg.PAYMENT_CURRENCY === 'USDC' && BigInt(countRows[0].n) > 0n) throw new Error('Unbound existing financial data cannot be relabelled USDC. Use a new database.');
    await tx.execute(sql`insert into deployment_identity(id, fingerprint) values (1, ${fingerprint})`);
  });
}
