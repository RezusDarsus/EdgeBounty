/** Idempotent read-only view upgrade. Use an ephemeral administrator connection if required. */
import {readFile} from 'node:fs/promises';
import pg from 'pg';
process.loadEnvFile('apps/api/.env');
const pool=new pg.Pool({connectionString:process.env.ANALYTICS_PROVISION_DATABASE_URL??process.env.DATABASE_URL});
const c=await pool.connect();
try{await c.query('BEGIN');await c.query(await readFile('services/analytics/operator-views.sql','utf8'));await c.query('COMMIT');console.log('Operator read-only views upgraded; base-table privileges unchanged');}
catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await pool.end();}
