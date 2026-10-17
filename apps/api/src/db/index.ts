import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema.js';

export type Db = PgliteDatabase<typeof schema>;
export { schema };

const MIGRATIONS = join(import.meta.dirname, '..', '..', 'drizzle');

/**
 * Embedded PGlite for dev/test (`memory://` or a directory), node-postgres for production.
 * Both expose the same Drizzle query API.
 */
export async function createDb(opts: { databaseUrl?: string; dataDir?: string; memory?: boolean }): Promise<{ db: Db; close: () => Promise<void> }> {
  if (opts.databaseUrl) {
    const pg = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.default.Pool({ connectionString: opts.databaseUrl, max: 20 });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return { db: db as unknown as Db, close: () => pool.end() };
  }
  let client: PGlite;
  if (opts.memory) {
    client = new PGlite();
  } else {
    const dir = join(opts.dataDir ?? '.data', 'db');
    mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
  }
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => client.close() };
}
