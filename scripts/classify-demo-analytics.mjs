/** Explicit evidence-backed labels only. No name or wallet heuristics. */
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {AnalyticsStore} from '../services/analytics/store.mjs';
process.loadEnvFile('services/analytics/.env');
const evidence=JSON.parse(await readFile(process.argv[2]??'apps/web/public/hackathon-evidence.json','utf8'));
if(evidence.schema!=='edgebounty.hackathon-evidence/1'||!evidence.disclosure.includes('operator-created demo identities'))throw Error('Explicit fixture disclosure required');
const ids=[...new Set(evidence.progress.contributors.map(c=>c.userId))];
if(ids.some(id=>!/^[-a-f0-9]{36}$/.test(id)))throw Error('Invalid fixture identity');
const pool=new pg.Pool({connectionString:process.env.ANALYTICS_DATABASE_URL});
const store=new AnalyticsStore(process.env.ANALYTICS_DB_PATH??'.data/analytics/activity.sqlite',process.env.ANALYTICS_INGEST_SECRET);
try{const {rows}=await pool.query('SELECT id FROM analytics_operator_accounts WHERE id=ANY($1::uuid[])', [ids]);let marked=0;for(const row of rows){const token=store.hash('account:'+row.id);if(!store.db.prepare('SELECT 1 FROM account_labels WHERE account=?').get(token)){store.classify(token,'test');marked++;}}console.log(JSON.stringify({evidenceBackedDemoLabels:marked,existingLabelsPreserved:true}));}finally{store.close();await pool.end();}
