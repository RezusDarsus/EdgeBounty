/** Run on the deployment host. Never print credentials; secrets stay in mode-0600 files. */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import pg from 'pg';
process.loadEnvFile('apps/api/.env');
const target='services/analytics/.env';
if(existsSync(target)) { console.log('Analytics already provisioned; preserving credentials');process.exit(0); }
const apiEnv=readFileSync('apps/api/.env','utf8');
if(/^ANALYTICS_INGEST_SECRET=/m.test(apiEnv))throw Error('Existing analytics ingestion configuration requires manual reconciliation');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const client=await pool.connect();
const role='edgebounty_analytics_reader';
const dbPassword=randomBytes(32).toString('hex'), password=randomBytes(24).toString('base64url'), secret=randomBytes(32).toString('hex');
let createdEnv=false,changedApi=false,createdAccess=false;
try {
  await client.query('BEGIN');
  if((await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)throw Error('Analytics role already exists without its environment file; restore credentials before provisioning');
  await client.query(`CREATE ROLE ${role} LOGIN PASSWORD '${dbPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 3`);
  await client.query(`ALTER ROLE ${role} SET default_transaction_read_only=on`);
  await client.query(`ALTER ROLE ${role} SET statement_timeout='5s'`);
  await client.query(`CREATE OR REPLACE VIEW analytics_accounts AS SELECT created_at,last_login_at,deleted_at FROM accounts;
    CREATE OR REPLACE VIEW analytics_orders AS SELECT amount_micro,chain_state,jsonb_build_object('feeBps',chain->'feeBps','sellerBps',chain->'sellerBps') AS chain FROM orders;
    CREATE OR REPLACE VIEW analytics_invoices AS SELECT kind,status,amount_micro,jsonb_build_object('purpose',metadata->'purpose','credits',metadata->'credits') AS metadata FROM invoices;
    CREATE OR REPLACE VIEW analytics_agent_requests AS SELECT status,created_at FROM agent_requests;
    CREATE OR REPLACE VIEW analytics_delivery_entitlements AS SELECT bytes_served FROM delivery_entitlements;
    GRANT USAGE ON SCHEMA public TO ${role};
    GRANT SELECT ON analytics_accounts,analytics_orders,analytics_invoices,analytics_agent_requests,analytics_delivery_entitlements TO ${role};`);
  const connection=new URL(process.env.DATABASE_URL);connection.username=role;connection.password=dbPassword;
  mkdirSync('services/analytics',{recursive:true});mkdirSync('.data',{recursive:true,mode:0o700});
  writeFileSync(target,`ANALYTICS_DATABASE_URL=${connection.href}\nANALYTICS_USERNAME=developer\nANALYTICS_PASSWORD=${password}\nANALYTICS_INGEST_SECRET=${secret}\nANALYTICS_DB_PATH=.data/analytics/activity.sqlite\nANALYTICS_PORT=4020\nPAYMENT_CURRENCY=${process.env.PAYMENT_CURRENCY??'USDC'}\n`,{mode:0o600,flag:'wx'});
  createdEnv=true;changedApi=true;
  writeFileSync('apps/api/.env',apiEnv.trimEnd()+`\nANALYTICS_INGEST_SECRET=${secret}\nANALYTICS_INTERNAL_URL=http://127.0.0.1:4020\n`,{mode:0o600});
  writeFileSync('.data/developer-analytics-access.txt',`EdgeBounty developer analytics\nURL: https://stats.13-61-207-211.sslip.io/\nUsername: developer\nPassword: ${password}\nKeep this file private. This password is separate from marketplace wallets.\n`,{mode:0o600,flag:'wx'});
  createdAccess=true;
  await client.query('COMMIT');
  console.log('Analytics provisioned: read-only views and private credentials created');
}catch(error){await client.query('ROLLBACK');if(changedApi)writeFileSync('apps/api/.env',apiEnv,{mode:0o600});if(createdEnv)unlinkSync(target);if(createdAccess)unlinkSync('.data/developer-analytics-access.txt');throw error;}
finally{client.release();await pool.end();}
