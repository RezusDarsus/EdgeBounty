/** Offline, lossless logical migration. Stop API and workers before invoking. */
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createDb } from '../apps/api/src/db/index.js';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Client } = require('pg');
const sourcePath = process.argv[2];
if (!sourcePath || !process.env.DATABASE_URL) throw new Error('Usage: DATABASE_URL=... tsx scripts/migrate-pglite-to-postgres.ts SOURCE_DIRECTORY');
const migrated = await createDb({ databaseUrl: process.env.DATABASE_URL });
await migrated.close();
const source = new PGlite(sourcePath);
const target = new Client({ connectionString: process.env.DATABASE_URL });
await target.connect();
const ident = (s: string) => `"${s.replaceAll('"', '""')}"`;
const digest = (rows: { row_json: string }[]) => createHash('sha256').update(rows.map(r => r.row_json).sort().join('\n')).digest('hex');
try {
  await target.query('BEGIN');
  await target.query('CREATE TABLE IF NOT EXISTS deployment_identity (id integer PRIMARY KEY, fingerprint text NOT NULL)');
  const tables = (await source.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name")).rows.map(r => r.table_name);
  const dependencies = (await source.query<{ child: string; parent: string }>(`SELECT c.relname AS child, p.relname AS parent FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_class p ON p.oid=f.confrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE f.contype='f' AND n.nspname='public' AND c.oid<>p.oid`)).rows;
  const ordered: string[] = [];
  const pending = new Set(tables);
  while (pending.size) {
    const ready = [...pending].filter(t => dependencies.filter(d => d.child === t).every(d => !pending.has(d.parent)));
    if (!ready.length) throw new Error('Cyclic foreign keys require an explicit migration strategy');
    for (const t of ready) { ordered.push(t); pending.delete(t); }
  }
  for (const table of ordered) {
    const q = ident(table);
    if ((await target.query(`SELECT count(*) AS n FROM ${q}`)).rows[0].n !== '0') throw new Error(`Target table ${table} is not empty; refusing to overwrite`);
    // Keep JSON as text: bigint monetary values never round through JavaScript numbers.
    const rows = (await source.query<{ row_json: string }>(`SELECT to_jsonb(t)::text AS row_json FROM ${q} t`)).rows;
    for (const row of rows) await target.query(`INSERT INTO ${q} SELECT * FROM jsonb_populate_record(NULL::${q}, $1::jsonb)`, [row.row_json]);
    const copied = (await target.query(`SELECT to_jsonb(t)::text AS row_json FROM ${q} t`)).rows;
    if (copied.length !== rows.length || digest(copied) !== digest(rows)) throw new Error(`Verification failed for ${table}`);
    console.log(`${table}: ${rows.length} rows, SHA-256 verified`);
  }
  await target.query('COMMIT');
  console.log('Migration committed; all public table contents verified. Source preserved.');
} catch (e) { await target.query('ROLLBACK'); throw e; }
finally { await source.close(); await target.end(); }
