import { createServer } from 'node:http';

import { readFile } from 'node:fs/promises';

import { mkdirSync } from 'node:fs';

import { dirname } from 'node:path';

import { createHash, timingSafeEqual } from 'node:crypto';

import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { AnalyticsStore } from './store.mjs';

import { marketplaceMetrics } from './metrics.mjs';

import { operatorMetrics,operatorRecords } from './operator-metrics.mjs';

import { infrastructure,reconcileVaults,transactionFinality } from './operations.mjs';



const digest = value => createHash('sha256').update(value).digest();

const equal = (a,b) => timingSafeEqual(digest(a),digest(b));

export function buildAnalytics({ store, username, password, ingestSecret, metrics, operator=null, currency='USDC', network='Private validator · mock USDC · no monetary value' }) {

  if(!username || typeof password!=='string' || password.length<24 || typeof ingestSecret!=='string' || ingestSecret.length<32) throw Error('Strong dashboard and ingestion credentials are required');

  const attempts=new Map();

  return createServer(async (req,res) => {

    const headers={'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer',

      'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};

    const send=(status,body,type='application/json')=>{res.writeHead(status,{...headers,'content-type':type});res.end(type==='application/json'?JSON.stringify(body):body);};

    try {

      const url=new URL(req.url,'http://localhost');

      if(req.method==='GET'&&url.pathname==='/health') return send(200,{ok:true});

      if(req.method==='POST'&&url.pathname==='/internal/ingest') {

        if(!equal(String(req.headers['x-analytics-secret']??''),ingestSecret)) return send(401,{error:'unauthorized'});

        let body=''; for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>2048)return send(413,{error:'too_large'});}

        try {store.ingest(JSON.parse(body));}catch{return send(400,{error:'invalid_event'});}

        return send(200,{ok:true});

      }

      const ip=req.socket.remoteAddress??'local', now=Date.now();

      if(attempts.size>1000) attempts.clear();

      const attempt=attempts.get(ip);

      if(attempt&&attempt.until>now&&attempt.n>=20)return send(429,{error:'Too many login attempts. Retry in one minute.'});

      let supplied='';

      if(req.headers.authorization?.startsWith('Basic ')) supplied=Buffer.from(req.headers.authorization.slice(6),'base64').toString('utf8');

      if(!equal(supplied,`${username}:${password}`)) {

        attempts.set(ip,{n:attempt&&attempt.until>now?attempt.n+1:1,until:attempt&&attempt.until>now?attempt.until:now+60_000});

        store.audit('login_failed');

        res.setHeader('www-authenticate','Basic realm="EdgeBounty developer analytics", charset="UTF-8"');

        return send(401,{error:'Developer dashboard authentication required'});

      }

      attempts.delete(ip);

      if(req.method==='POST'&&['/api/classify','/api/costs'].includes(url.pathname)) {

        // Custom header forces a preflight for cross-site requests; no CORS permission is provided.

        if(req.headers['x-operator-action']!=='1'||(req.headers.origin&&req.headers.origin!==`https://${req.headers.host}`&&req.headers.origin!==`http://${req.headers.host}`))return send(403,{error:'same_origin_required'});

        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)return send(413,{error:'too_large'});}

        try{const body=JSON.parse(raw);if(url.pathname==='/api/classify')store.classify(body.account,body.classification);else store.importCost(body);return send(200,{ok:true});}catch{return send(400,{error:'Invalid operator record, evidence or duplicate import ID.'});}

      }

      if(req.method!=='GET') return send(405,{error:'method_not_allowed'});

      const days=Number(url.searchParams.get('days')??7);

      if(url.pathname.startsWith('/api/')&&![1,7,30].includes(days))return send(400,{error:'days must be 1, 7 or 30'});

      if(url.pathname==='/api/operations') {

        let marketplace=null,marketplaceError=null;

        try{marketplace=operator?await operator.metrics(days):null;}catch{marketplaceError='Operator views unavailable. Check the read-only view upgrade.';}

        const activity=store.operations(days);

        if(marketplace)marketplace.accounts=marketplace.accounts.map(a=>{const account=store.hash('account:'+a.id);const {id,...safe}=a;return {...safe,account,classification:activity.labels[account]??'unclassified'};});

        delete activity.labels;

        return send(200,{at:new Date().toISOString(),days,activity,marketplace,marketplaceError});

      }

      if(url.pathname==='/api/records') {

        if(!operator)return send(503,{error:'Operator views unavailable'});

        const type=url.searchParams.get('type')??'orders',page=Number(url.searchParams.get('page')??1),sort=url.searchParams.get('sort')??'desc',id=url.searchParams.get('id')??undefined;

        if((type==='transactions'&&id)||!['orders','jobs','transactions','invoices','agents'].includes(type)||!Number.isInteger(page)||page<1||page>10000||!['asc','desc'].includes(sort)||(id&&!/^[a-f0-9-]{36}$/i.test(id)))return send(400,{error:'invalid_records_request'});

        store.audit('view_records',type);

        return send(200,await operator.records({type,page,days,sort,id}));

      }

      if(url.pathname==='/api/account-token') {const id=url.searchParams.get('id');if(!/^[a-f0-9-]{36}$/i.test(id??''))return send(400,{error:'invalid_account_id'});store.audit('lookup_account_token');return send(200,{account:store.hash('account:'+id)});}

      if(url.pathname==='/api/infrastructure')return send(200,operator?await operator.infrastructure():{unavailable:true});

      if(url.pathname==='/api/reconciliation') {if(!operator)return send(503,{error:'Unavailable'});store.audit('reconcile_vaults');try{return send(200,await operator.reconcile());}catch{return send(503,{error:'Live vault verification unavailable; no balances have been changed.'});}}

      if(url.pathname==='/api/finality') {if(!operator)return send(503,{error:'Unavailable'});const signature=url.searchParams.get('signature');if(!signature||!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature))return send(400,{error:'invalid_signature'});return send(200,await operator.finality(signature));}



      if(url.pathname==='/api/overview') {

        const days=Number(url.searchParams.get('days')??7);

        if(![1,7,30].includes(days))return send(400,{error:'days must be 1, 7 or 30'});

        let marketplace=null,marketplaceError=null;

        try{marketplace=await metrics();}catch{marketplaceError='Marketplace accounting is temporarily unavailable. Activity tracking remains independent.';}

        return send(200,{at:new Date().toISOString(),revision:process.env.RELEASE_GIT_SHA??'development',days,currency,network,telemetry:store.snapshot(days),marketplace,marketplaceError});

      }

      const assets={'/':['index.html','text/html; charset=utf-8'],'/dashboard.css':['dashboard.css','text/css; charset=utf-8'],'/dashboard.js':['dashboard.js','text/javascript; charset=utf-8']};

      const asset=assets[url.pathname];

      if(!asset)return send(404,{error:'not_found'});

      if(url.pathname==='/')store.audit('view_console');

      return send(200,await readFile(new URL(`./public/${asset[0]}`,import.meta.url),'utf8'),asset[1]);

    }catch{if(!res.headersSent)send(500,{error:'Analytics request failed'});else res.destroy();}

  });

}



if(process.argv[1]===fileURLToPath(import.meta.url)) {

  const path=process.env.ANALYTICS_DB_PATH??'.data/analytics/activity.sqlite';

  mkdirSync(dirname(path),{recursive:true,mode:0o700});

  const store=new AnalyticsStore(path,process.env.ANALYTICS_INGEST_SECRET??'');

  store.prune();

  const pruneTimer=setInterval(()=>store.prune(),60000);pruneTimer.unref();

  const pool=new pg.Pool({connectionString:process.env.ANALYTICS_DATABASE_URL,max:2,connectionTimeoutMillis:3000,options:'-c default_transaction_read_only=on'});

  let cache=null, cachedAt=0;

  pool.on('error',()=>{cache=null;console.warn('Analytics database connection unavailable');});

  const server=buildAnalytics({store,username:process.env.ANALYTICS_USERNAME,password:process.env.ANALYTICS_PASSWORD,ingestSecret:process.env.ANALYTICS_INGEST_SECRET,

    currency:process.env.PAYMENT_CURRENCY??'USDC',network:process.env.ANALYTICS_NETWORK_LABEL,

    operator:{metrics:days=>operatorMetrics(pool,days),records:query=>operatorRecords(pool,query),infrastructure:()=>infrastructure(pool),reconcile:()=>reconcileVaults(pool),finality:transactionFinality},

    metrics:async()=>{if(cache&&Date.now()-cachedAt<15000)return cache;const value=await marketplaceMetrics(pool);cache=value;cachedAt=Date.now();return value;}});

  server.requestTimeout=15000;server.headersTimeout=10000;

  server.listen(Number(process.env.ANALYTICS_PORT??4020),'127.0.0.1',()=>console.log('Developer analytics listening on loopback'));

  const stop=()=>server.close(async()=>{clearInterval(pruneTimer);store.close();await pool.end();process.exit(0);});

  process.on('SIGINT',stop);process.on('SIGTERM',stop);

}
