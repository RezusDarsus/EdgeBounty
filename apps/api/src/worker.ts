import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { createDb } from './db/index.js';
import { createStorage } from './storage/index.js';
import { ChainService } from './chain.js';
import { startOrchestrator } from './services/jobs.js';
import { bindDeployment } from './lib/deployment-identity.js';
import { heartbeat, operationRecorder } from './services/operations.js';
import { initializeSemanticIndex } from './services/semantic.js';
import { stopSandboxes } from './services/sandbox.js';

const envFile = join(import.meta.dirname, '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const cfg = loadConfig();
if (!cfg.DATABASE_URL || cfg.VERIFICATION_EXECUTOR !== 'worker') throw new Error('Dedicated worker requires PostgreSQL and VERIFICATION_EXECUTOR=worker');
const chain = new ChainService(cfg);
const { db, close } = await createDb({ databaseUrl: cfg.DATABASE_URL });
await bindDeployment(db, cfg, await chain.connection.getGenesisHash(), chain.client.programId.toBase58());
await initializeSemanticIndex(db, cfg);
const stop = startOrchestrator({ cfg, db, chain, storage: createStorage(cfg, operationRecorder(db, cfg.STORAGE_DRIVER)), events: {} });
await heartbeat(db);
const pulse = setInterval(() => heartbeat(db).catch(e => console.error('Worker heartbeat failed', e)), 30_000);
console.log('Dedicated verification worker ready');
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stop();
  clearInterval(pulse);
  await stopSandboxes();
  // The orchestrator persists leases; interrupted jobs can be reclaimed after expiry.
  await close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
