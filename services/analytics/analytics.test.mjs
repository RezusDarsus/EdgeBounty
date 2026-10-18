import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { AnalyticsStore } from './store.mjs';
import { buildAnalytics } from './server.mjs';
import { marketplaceMetrics } from './metrics.mjs';

test('presence deduplicates browsers/accounts, expires after five minutes and stores no raw IDs',()=>{
 let now=Date.parse('2026-10-18T12:00:00Z');const store=new AnalyticsStore(':memory:','s'.repeat(32),()=>now);
 const first=randomUUID(),second=randomUUID(),account=randomUUID(),guest=randomUUID();
 store.ingest({kind:'heartbeat',visitorId:first,accountId:null,page:'home',pageView:true});
 store.ingest({kind:'heartbeat',visitorId:first,accountId:account,page:'home',pageView:false});
 store.ingest({kind:'heartbeat',visitorId:second,accountId:account,page:'orders',pageView:true});
 store.ingest({kind:'heartbeat',visitorId:guest,accountId:null,page:'home',pageView:true});
 store.ingest({kind:'request',route:'/orders/:id',method:'GET',status:402});
 const data=store.snapshot(7);assert.equal(data.active.guests,1);assert.equal(data.active.registered,1);assert.equal(data.visitors.browsers,3);assert.equal(data.visitors.registered,1);assert.equal(data.usage[0].errors,1);
 const persisted=JSON.stringify(store.db.prepare('SELECT * FROM presence').all());assert.ok(!persisted.includes(first));assert.ok(!persisted.includes(account));
 now+=300001;assert.equal(store.snapshot(7).active.registered,0);
 now+=31*86400_000;assert.equal(store.snapshot(30).daily.length,0);store.close();
});

test('dashboard and snapshots require credentials; ingestion requires a separate secret',async()=>{
 const store=new AnalyticsStore(':memory:','s'.repeat(32));const server=buildAnalytics({store,username:'developer',password:'p'.repeat(32),ingestSecret:'s'.repeat(32),metrics:async()=>({accounts:{registered:'3'}})});
 server.listen(0,'127.0.0.1');await once(server,'listening');const root=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(root)).status,401);assert.equal((await fetch(root+'/api/overview')).status,401);
  assert.equal((await fetch(root+'/internal/ingest',{method:'POST',body:'{}'})).status,401);
  const credentials={authorization:'Basic '+Buffer.from('developer:'+ 'p'.repeat(32)).toString('base64')};
  const page=await fetch(root,{headers:credentials});assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await fetch(root+'/internal/ingest',{method:'POST',headers:{'x-analytics-secret':'s'.repeat(32)},body:JSON.stringify({kind:'heartbeat',visitorId:randomUUID(),accountId:null,page:'home',pageView:true})})).status,200);
  const snapshot=await (await fetch(root+'/api/overview?days=7',{headers:credentials})).json();assert.equal(snapshot.telemetry.active.guests,1);assert.equal(snapshot.marketplace.accounts.registered,'3');
  assert.equal((await fetch(root+'/api/overview?days=999',{headers:credentials})).status,400);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();}
});

test('settled fees use recorded partial allocations; prepaid receipts stay separate',async()=>{
 const db=new PGlite();
 await db.exec(`CREATE TABLE analytics_accounts(created_at timestamptz,last_login_at timestamptz,deleted_at timestamptz);
 CREATE TABLE analytics_orders(amount_micro numeric,chain_state text,chain jsonb);
 CREATE TABLE analytics_invoices(kind text,status text,amount_micro numeric,metadata jsonb);
 CREATE TABLE analytics_agent_requests(status text,created_at timestamptz);
 CREATE TABLE analytics_delivery_entitlements(bytes_served bigint);
 INSERT INTO analytics_accounts VALUES(now(),now(),null),(now(),null,now());
 INSERT INTO analytics_orders VALUES(10000000,'settled','{"sellerBps":10000,"feeBps":600}'),(10000000,'settled','{"sellerBps":5000,"feeBps":600}'),(99000000,'funded','{}'),(1000000,'settled','{}');
 INSERT INTO analytics_invoices VALUES('other','paid',150000,'{"purpose":"download_credits"}'),('verification','paid',1000000,'{}'),('other','open',90000000,'{}');`);
 try{
  const data=await marketplaceMetrics({connect:async()=>({query:async(...args)=>db.query(...args),release(){}})});
  assert.equal(data.accounts.registered,'1');assert.equal(data.accounts.ever_registered,'2');
  assert.equal(BigInt(data.finance.settled_volume),15000000n);assert.equal(BigInt(data.finance.commission),900000n);assert.equal(BigInt(data.finance.seller_proceeds),14100000n);assert.equal(data.finance.unknown_splits,'1');
  assert.equal(data.invoices.find(i=>i.purpose==='download_credits').receipts,'150000');assert.equal(data.invoices.length,2);
 }finally{await db.close();}
});

test('a marketplace outage does not hide independent activity',async()=>{
 const store=new AnalyticsStore(':memory:','s'.repeat(32));const server=buildAnalytics({store,username:'developer',password:'p'.repeat(32),ingestSecret:'s'.repeat(32),metrics:async()=>{throw Error('offline');}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/overview`,{headers:{authorization:'Basic '+Buffer.from('developer:'+ 'p'.repeat(32)).toString('base64')}});const data=await response.json();assert.equal(response.status,200);assert.equal(data.marketplace,null);assert.ok(data.marketplaceError);assert.equal(data.telemetry.active.guests,0);}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();}
});
