import type { Config } from './config.js';
import type { Db } from './db/index.js';
import type { ObjectStorage } from './storage/index.js';
import type { ChainService } from './chain.js';

export interface AppContext {
  cfg: Config;
  db: Db;
  storage: ObjectStorage;
  chain: ChainService;
  /** Hooks other modules can call when chain state changes (set by the orchestrator). */
  events: {
    onOrderState?: (orderId: string, state: string) => Promise<void>;
  };
}
