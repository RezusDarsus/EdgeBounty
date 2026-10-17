import { delistUnfundedListings } from './lib/billing.js';
import { purgeAgentCache } from './services/assistant.js';
import { STORAGE } from '@edgebounty/pricing-engine';
import { initializeSemanticIndex } from './services/semantic.js';
import { stopSandboxes } from './services/sandbox.js';
import { operationRecorder, retentionNoticeTick } from './services/operations.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { paymentMint } from './lib/payments.js';
import { getMint } from '@solana/spl-token';
import { bindDeployment } from './lib/deployment-identity.js';

const envFile = join(import.meta.dirname, '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { loadConfig } = await import('./config.js');
import { createDb } from './db/index.js';
import { createStorage } from './storage/index.js';
import { ChainService } from './chain.js';
import { buildApp } from './app.js';
import { seed } from './seed.js';
import { startOrchestrator } from './services/jobs.js';
import { startIndexer } from './services/indexer.js';
import { purgeExpiredUploads } from './routes/assets.js';
import { storageExpiryTick } from './routes/storage.js';
import type { AppContext } from './context.js';

const cfg = loadConfig();
const chain = new ChainService(cfg);
const platform = await chain.client.config();
if (platform && !platform.paymentMint.equals(paymentMint(cfg))) {
  throw new Error('Payment mint mismatch. Preserve the existing ledger and database and configure the matching currency or initialize a separate deployment.');
}
const { db, close } = await createDb({ databaseUrl: cfg.DATABASE_URL, dataDir: cfg.DATA_DIR });
if (platform && cfg.PAYMENT_CURRENCY === 'USDC') {
  if ((await getMint(chain.connection, platform.paymentMint)).decimals !== 6 || platform.feeBps !== 600) throw new Error('USDC deployment requires six decimals and a 6% platform fee');
}
await bindDeployment(db, cfg, await chain.connection.getGenesisHash(), chain.client.programId.toBase58());
await seed(db);
await initializeSemanticIndex(db, cfg);
const ctx: AppContext = { cfg, db, storage: createStorage(cfg, operationRecorder(db, cfg.STORAGE_DRIVER)), chain, events: {} };
const app = await buildApp(ctx, { logger: true });

const stops: (() => void)[] = [];
if (cfg.WORKERS === 'on' && platform?.paymentMint.equals(paymentMint(cfg))) {
  void retentionNoticeTick(ctx).catch(e => app.log.error(e));
  if (cfg.VERIFICATION_EXECUTOR === 'api') stops.push(startOrchestrator(ctx));
  stops.push(startIndexer(ctx, cfg.INDEXER_INTERVAL_MS));
  const hk = setInterval(() => {
    purgeAgentCache(ctx).catch((e) => app.log.error(e));
    purgeExpiredUploads(ctx).catch((e) => app.log.error(e));
    storageExpiryTick(ctx).catch((e) => app.log.error(e));
    retentionNoticeTick(ctx).catch((e) => app.log.error(e));
    delistUnfundedListings(ctx, STORAGE.graceDays).catch((e) => app.log.error(e));
  }, 60 * 60 * 1000);
  stops.push(() => clearInterval(hk));
}

await app.listen({ port: cfg.PORT, host: cfg.HOST });
const shutdown = async () => {
  stops.forEach((s) => s());
  await stopSandboxes();
  await app.close();
  await close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
