import { eq } from 'drizzle-orm';
import { loadConfig } from '../apps/api/src/config.js';
import { createDb, schema } from '../apps/api/src/db/index.js';
import { notify } from '../apps/api/src/services/operations.js';
process.loadEnvFile('apps/api/.env');
const cfg = loadConfig();
if (cfg.NODE_ENV !== 'development' || new URL(cfg.SOLANA_RPC_URL).hostname !== '127.0.0.1') throw new Error('Test validator only');
const { db, close } = await createDb({ databaseUrl: cfg.DATABASE_URL });
try {
  const [account] = await db.select().from(schema.accounts).where(eq(schema.accounts.wallet, process.argv[2] ?? ''));
  if (!account) throw new Error('Test account not found');
  await notify(db, account.id, 'smoke-test:dashboard-notice-v1', 'Deployment check complete (test notice)', 'This is a disposable interface test. Database, isolated verification worker and backup recovery checks passed.', '/dashboard');
  console.log('Test notice created for the supplied test wallet');
} finally { await close(); }
