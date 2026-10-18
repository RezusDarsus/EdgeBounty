import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {migrate} from 'drizzle-orm/pglite/migrator';
import {operatorMetrics,operatorRecords} from './operator-metrics.mjs';
import {AnalyticsStore} from './store.mjs';
import {buildAnalytics} from './server.mjs';
import {reconcileVaults} from './operations.mjs';
import {Keypair} from '@solana/web3.js';

test('restricted views and operator queries work against the real marketplace migrations',async()=>{
 const db=new PGlite();
 try{
  await migrate(drizzle(db),{migrationsFolder:'apps/api/drizzle'});
  const sql=await readFile('services/analytics/operator-views.sql','utf8');
  await db.exec(sql.slice(0,sql.indexOf('GRANT SELECT')));
  const pool={connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
  await db.query("INSERT INTO accounts(wallet,alias) VALUES ('public-test-wallet','test')");
  await db.query("INSERT INTO agent_requests(account_id,request_hash,mode,status,response) SELECT id,'test','bounty','failed',$1 FROM accounts",[JSON.stringify({failureReason:'ai_provider_busy',latencyMs:123,providerModel:'test-model'})]);
  await db.query("INSERT INTO verification_jobs(kind,asset_version_id,requester_id,level,spec_hash,status,budget,error,completed_at) SELECT 'listing',gen_random_uuid(),id,'L3','test','failed','{}','503 secret provider body',now() FROM accounts");
  const data=await operatorMetrics(pool,7);
  assert.equal(data.totals.accounts,'1');assert.equal(data.agents[0].reason,'ai_provider_busy');assert.equal(data.agents[0].model,'test-model');assert.equal(data.failures[0].reason,'provider_unavailable');
  assert.ok(!JSON.stringify(data).includes('secret provider body'));assert.ok(!JSON.stringify(data).includes('public-test-wallet'));
  const records=await operatorRecords(pool,{type:'jobs',page:1,days:7});assert.equal(records.total,'1');assert.equal(records.rows[0].providerCosts.length,0);
  await assert.rejects(()=>operatorRecords(pool,{type:'accounts; DROP TABLE accounts',days:7}));
  assert.ok(sql.includes('analytics_operator_orders'));
 }finally{await db.close();}
});

test('anonymous rollups survive identifier pruning and incomplete comparisons remain absent',()=>{
 let now=Date.parse('2026-10-18T12:00:00Z');const store=new AnalyticsStore(':memory:','s'.repeat(32),()=>now),visitor=randomUUID(),account=randomUUID();
 try{
  store.ingest({kind:'heartbeat',visitorId:visitor,accountId:account,page:'home',pageView:true});
  assert.equal(store.operations(7).comparison,null);
  store.classify(store.hash('account:'+account),'test');assert.equal(store.operations(7).activeWindows[1].test,1);
  now+=31*86400000;store.prune();assert.equal(store.db.prepare('SELECT count(*) AS n FROM daily_accounts').get().n,0);
  assert.equal(store.operations(30).daily[0].browsers,1);
  assert.ok(!JSON.stringify(store.operations(30).daily).includes(account));
 }finally{store.close();}
});
test('ordered account workflows never combine different accounts and latency separates 4xx/5xx',()=>{
 let now=Date.now();const store=new AnalyticsStore(':memory:','s'.repeat(32),()=>now),a=randomUUID(),b=randomUUID();
 const emit=(route,accountId,status=200)=>{now++;store.ingest({kind:'request',route,accountId,method:'POST',status,durationMs:420,client:'api_key'});};
 try{
  emit('/listings/:id/purchase',a);emit('/orders/:id/confirm',b);emit('/orders/:id/confirm',a,503);emit('/orders/:id/confirm',a,402);
  let result=store.operations(7);assert.deepEqual(result.funnels.find(f=>f.name==='buyer').steps.map(s=>s.accounts),[1,0,0]);
  emit('/orders/:id/confirm',a);result=store.operations(7);assert.deepEqual(result.funnels.find(f=>f.name==='buyer').steps.map(s=>s.accounts),[1,1,0]);
  assert.equal(result.p95UpperMs,500);const errors=result.performance.find(p=>p.route==='/orders/:id/confirm');assert.equal(errors.server_errors,1);assert.equal(errors.client_errors,1);
 }finally{store.close();}
});
test('operator writes require authentication and a same-origin custom header; costs deduplicate evidence',async()=>{
 const store=new AnalyticsStore(':memory:','s'.repeat(32)),server=buildAnalytics({store,username:'developer',password:'p'.repeat(32),ingestSecret:'s'.repeat(32),metrics:async()=>({})});server.listen(0,'127.0.0.1');await once(server,'listening');
 const root=`http://127.0.0.1:${server.address().port}`,auth={authorization:'Basic '+Buffer.from('developer:'+ 'p'.repeat(32)).toString('base64')};
 try{
  const body=JSON.stringify({account:'a'.repeat(64),classification:'test'});
  assert.equal((await fetch(root+'/api/classify',{method:'POST',headers:{'x-api-key':'ordinary-key'},body})).status,401);
  assert.equal((await fetch(root+'/api/classify',{method:'POST',headers:auth,body})).status,403);
  assert.equal((await fetch(root+'/api/classify',{method:'POST',headers:{...auth,'x-operator-action':'1',origin:'https://evil.example'},body})).status,403);
  assert.equal((await fetch(root+'/api/classify',{method:'POST',headers:{...auth,'x-operator-action':'1'},body})).status,200);
  const cost={id:'invoice-123',day:'2026-10-18',provider:'aws',category:'compute',usdMicro:'123456',evidence:'Invoice reference ABC'};
  for(const expected of [200,400])assert.equal((await fetch(root+'/api/costs',{method:'POST',headers:{...auth,'x-operator-action':'1'},body:JSON.stringify(cost)})).status,expected);
  assert.equal(store.operations(7).importedCosts.length,1);assert.ok(store.operations(7).audit.some(e=>e.action==='import_cost'));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));store.close();}
});

test('live reconciliation validates the vault authority and mint at finalized commitment',async()=>{
 const original=globalThis.fetch,program=Keypair.generate().publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58(),address=Keypair.generate().publicKey.toBase58();let authority=address,amount='101';
 globalThis.fetch=async(url,options)=>{
  if(String(url).endsWith('/config'))return Response.json({programId:program,paymentMint:mint});
  const rpc=JSON.parse(options.body);assert.equal(rpc.method,'getMultipleAccounts');assert.equal(rpc.params[1].commitment,'finalized');
  return Response.json({result:{context:{slot:42},value:[{owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',data:{parsed:{info:{mint,owner:authority,tokenAmount:{amount}}}}}]}});
 };
 const pool={query:async()=>({rows:[{id:randomUUID(),onchain_address:address,chain_state:'funded',amount_micro:'100',verifier_fee_micro:'1'}]})};
 try{
  const matched=await reconcileVaults(pool);assert.equal(matched.rows[0].status,'matched');assert.equal(matched.finalizedSlot,42);
  authority=program;assert.equal((await reconcileVaults(pool)).rows[0].status,'unavailable');
  authority=address;amount='100';assert.equal((await reconcileVaults(pool)).rows[0].status,'mismatch');
 }finally{globalThis.fetch=original;}
});
