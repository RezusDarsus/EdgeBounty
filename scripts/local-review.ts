/** Disposable local UI/API review. No credentials, persistent database, chain writes or external AI. */
import { loadConfig } from '../apps/api/src/config.js';
import { createDb } from '../apps/api/src/db/index.js';
import { LocalStorage } from '../apps/api/src/storage/index.js';
import { ChainService } from '../apps/api/src/chain.js';
import { buildApp } from '../apps/api/src/app.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cfg = loadConfig({ NODE_ENV: 'test', WORKERS: 'off', AI_DRAFTS_ENABLED: '0', SOLANA_RPC_URL: 'http://127.0.0.1:1', NVIDIA_API_KEY: '', STORAGE_DRIVER: 'local', PAYMENT_CURRENCY: 'SOL' });
const { db, close } = await createDb({ memory: true });
const app = await buildApp({ cfg, db, chain: new ChainService(cfg), storage: new LocalStorage(join(tmpdir(), 'edgebounty-local-review')), events: {} });
await app.listen({ port: 4000, host: '127.0.0.1' });
console.log('Disposable review API: http://127.0.0.1:4000. Empty catalog; chain-dependent routes fail closed.');
const stop = async () => { await app.close(); await close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
