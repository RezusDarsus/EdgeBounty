import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';

const pages = new Set(['home','datasets','models','listings','bounties','orders','assistant','sell','storage','provider','providers','failure-bounties','pricing','dashboard','other']);
export class AnalyticsStore {
  constructor(path, secret, now = () => Date.now()) {
    this.db = new DatabaseSync(path); this.secret = secret; this.now = now;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS presence(visitor TEXT PRIMARY KEY,account TEXT,last_seen INTEGER NOT NULL,page TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS daily_visitors(day TEXT NOT NULL,visitor TEXT NOT NULL,account TEXT,PRIMARY KEY(day,visitor));
      CREATE TABLE IF NOT EXISTS daily_accounts(day TEXT NOT NULL,account TEXT NOT NULL,PRIMARY KEY(day,account));
      CREATE TABLE IF NOT EXISTS usage(day TEXT NOT NULL,route TEXT NOT NULL,method TEXT NOT NULL,status INTEGER NOT NULL,n INTEGER NOT NULL,PRIMARY KEY(day,route,method,status));
      CREATE TABLE IF NOT EXISTS pageviews(day TEXT NOT NULL,page TEXT NOT NULL,n INTEGER NOT NULL,PRIMARY KEY(day,page));`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS request_metrics(day TEXT,route TEXT,client TEXT,status INTEGER,bucket INTEGER,n INTEGER NOT NULL,PRIMARY KEY(day,route,client,status,bucket));
      CREATE TABLE IF NOT EXISTS anonymous_daily(day TEXT PRIMARY KEY,browsers INTEGER,accounts INTEGER,views INTEGER);
      CREATE TABLE IF NOT EXISTS operator_audit(at INTEGER NOT NULL,action TEXT NOT NULL,subject TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS account_labels(account TEXT PRIMARY KEY,classification TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cost_imports(id TEXT PRIMARY KEY,day TEXT NOT NULL,provider TEXT NOT NULL,category TEXT NOT NULL,usd_micro TEXT NOT NULL,evidence TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS journeys(account TEXT NOT NULL,step TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(account,step,at));`);
    const columns=this.db.prepare('PRAGMA table_info(presence)').all();
    if(!columns.some(c=>c.name==='first_seen'))this.db.exec('ALTER TABLE presence ADD COLUMN first_seen INTEGER');
    this.db.exec('INSERT OR IGNORE INTO daily_accounts SELECT day,account FROM daily_visitors WHERE account IS NOT NULL');
    this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('startedAt',new Date(this.now()).toISOString());
  }
  hash(value) { return createHmac('sha256',this.secret).update(value).digest('hex'); }
  ingest(event) {
    const now=this.now(), day=new Date(now).toISOString().slice(0,10);
    if(event.kind==='heartbeat') {
      if(!/^[0-9a-f-]{36}$/i.test(event.visitorId??'') || !pages.has(event.page) || (event.accountId!==null && !/^[0-9a-f-]{36}$/i.test(event.accountId??''))) throw Error('Invalid heartbeat');
      const visitor=this.hash('visitor:'+event.visitorId), account=event.accountId ? this.hash('account:'+event.accountId):null;
      this.db.prepare('INSERT INTO presence(visitor,account,last_seen,page,first_seen) VALUES (?,?,?,?,?) ON CONFLICT(visitor) DO UPDATE SET account=excluded.account,last_seen=excluded.last_seen,page=excluded.page,first_seen=CASE WHEN presence.last_seen<excluded.last_seen-1800000 THEN excluded.last_seen ELSE coalesce(presence.first_seen,excluded.last_seen) END').run(visitor,account,now,event.page,now);
      this.db.prepare('INSERT INTO daily_visitors VALUES (?,?,?) ON CONFLICT(day,visitor) DO UPDATE SET account=coalesce(excluded.account,daily_visitors.account)').run(day,visitor,account);
      if(account)this.db.prepare('INSERT OR IGNORE INTO daily_accounts VALUES (?,?)').run(day,account);
      if(event.pageView===true) this.db.prepare('INSERT INTO pageviews VALUES (?,?,1) ON CONFLICT(day,page) DO UPDATE SET n=n+1').run(day,event.page);
    } else if(event.kind==='request') {
      if(!/^\/[a-zA-Z0-9/_.:-]{0,140}$/.test(event.route??'') || !['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(event.method) || !Number.isInteger(event.status) || event.status<100 || event.status>599) throw Error('Invalid request metric');
      const duration=event.durationMs;
      if(duration!==undefined&&(!Number.isFinite(duration)||duration<0||duration>86400000))throw Error('Invalid latency');
      const client=['browser_session','api_key','anonymous_or_automated'].includes(event.client)?event.client:'anonymous_or_automated';
      const bucket=[10,50,100,250,500,1000,2500,5000,15000,60000,120000,86400000].find(b=>duration<=b);
      if(duration!==undefined)this.db.prepare('INSERT INTO request_metrics VALUES (?,?,?,?,?,1) ON CONFLICT(day,route,client,status,bucket) DO UPDATE SET n=n+1').run(day,event.route,client,event.status,bucket);
      const steps={'POST /listings/:id/purchase':'purchase_prepared','POST /orders/:id/confirm':'order_confirm_requested','POST /verification/quote':'verification_quoted','POST /verification/jobs':'verification_created','POST /agents/chat':'assistant_answer','POST /assets':'asset_created','POST /versions/:id/finalize':'version_finalized','POST /listings':'listing_prepared','POST /listings/:id/confirm':'listing_confirm_requested','POST /bounties/verification-quote':'bounty_quoted','POST /bounties':'bounty_prepared','POST /orders/:id/submissions':'submission_prepared','GET /orders/:id/delivery':'download_links'};
      const step=steps[event.method+' '+event.route];
      if(step&&event.status<400&&/^[a-f0-9-]{36}$/i.test(event.accountId??''))this.db.prepare('INSERT OR IGNORE INTO journeys VALUES (?,?,?)').run(this.hash('account:'+event.accountId),step,now);
      this.db.prepare('INSERT INTO usage VALUES (?,?,?,?,1) ON CONFLICT(day,route,method,status) DO UPDATE SET n=n+1').run(day,event.route,event.method,event.status);
    } else throw Error('Invalid event');
  }
  prune() {
    const cutoff=new Date(this.now()-29*86400_000).toISOString().slice(0,10);
    this.db.prepare('DELETE FROM presence WHERE last_seen<?').run(this.now()-86400_000);
    this.db.prepare('DELETE FROM journeys WHERE at<?').run(this.now()-30*86400_000);
    // Preserve aggregate counts before deleting identifiers. No cross-day identifiers survive this rollup.
    this.db.exec(`INSERT OR REPLACE INTO anonymous_daily SELECT day,count(*),(SELECT count(*) FROM daily_accounts a WHERE a.day=daily_visitors.day),(SELECT coalesce(sum(n),0) FROM pageviews p WHERE p.day=daily_visitors.day) FROM daily_visitors GROUP BY day`);
    for(const table of ['request_metrics','daily_visitors','daily_accounts','usage','pageviews']) this.db.prepare(`DELETE FROM ${table} WHERE day<?`).run(cutoff);
  }
  snapshot(days) {
    this.prune();
    const cutoff=new Date(this.now()-(days-1)*86400_000).toISOString().slice(0,10);
    const active=this.db.prepare('SELECT count(*) FILTER (WHERE account IS NULL) AS guests,count(DISTINCT account) AS registered FROM presence WHERE last_seen>=?').get(this.now()-300_000);
    return { startedAt:this.db.prepare("SELECT value FROM meta WHERE key='startedAt'").get().value, active,
      visitors:{browsers:this.db.prepare('SELECT count(DISTINCT visitor) AS n FROM daily_visitors WHERE day>=?').get(cutoff).n,registered:this.db.prepare('SELECT count(DISTINCT account) AS n FROM daily_accounts WHERE day>=?').get(cutoff).n},
      daily:this.db.prepare('SELECT day,count(*) AS browsers,(SELECT count(*) FROM daily_accounts a WHERE a.day=daily_visitors.day) AS registered FROM daily_visitors WHERE day>=? GROUP BY day ORDER BY day').all(cutoff),
      pages:this.db.prepare('SELECT page,sum(n) AS views FROM pageviews WHERE day>=? GROUP BY page ORDER BY views DESC').all(cutoff),
      usage:this.db.prepare('SELECT route,method,sum(n) AS requests,sum(CASE WHEN status>=400 THEN n ELSE 0 END) AS errors FROM usage WHERE day>=? GROUP BY route,method ORDER BY requests DESC LIMIT 40').all(cutoff) };
  }
  audit(action,subject='console') { this.db.prepare('INSERT INTO operator_audit VALUES (?,?,?)').run(this.now(),action,String(subject).slice(0,100)); }
  classify(account,classification) {
    if(!/^[a-f0-9]{64}$/.test(account)||!['test','production','unclassified'].includes(classification))throw Error('Invalid classification');
    this.db.prepare('INSERT INTO account_labels VALUES (?,?) ON CONFLICT(account) DO UPDATE SET classification=excluded.classification').run(account,classification);this.audit('classify_account',account.slice(0,12));
  }
  importCost(record) {
    if(!/^[a-zA-Z0-9-]{4,80}$/.test(record.id??'')||!/^\d{4}-\d{2}-\d{2}$/.test(record.day??'')||(!Number.isFinite(Date.parse(record.day))||new Date(record.day).toISOString().slice(0,10)!==record.day)||!['aws','r2','nvidia','gemini','rpc','email','other'].includes(record.provider)||!['storage','compute','verification','bandwidth','other'].includes(record.category)||!/^\d{1,15}$/.test(record.usdMicro??'')||typeof record.evidence!=='string'||record.evidence.length<4||record.evidence.length>120||/[\r\n]/.test(record.evidence))throw Error('Invalid cost evidence');
    this.db.prepare('INSERT INTO cost_imports VALUES (?,?,?,?,?,?)').run(record.id,record.day,record.provider,record.category,record.usdMicro,record.evidence);this.audit('import_cost',record.id);
  }
  operations(days=7) {
    this.prune();
    const cutoff=new Date(this.now()-(days-1)*86400000).toISOString().slice(0,10), activeSince=this.now()-300000;
    const labels=Object.fromEntries(this.db.prepare('SELECT * FROM account_labels').all().map(r=>[r.account,r.classification]));
    const activeWindows=Object.fromEntries([1,7,30].map(n=>[n,this.db.prepare('SELECT DISTINCT account FROM daily_accounts WHERE day>=?').all(new Date(this.now()-(n-1)*86400000).toISOString().slice(0,10)).reduce((a,r)=>{a[labels[r.account]??'unclassified']++;return a;},{test:0,production:0,unclassified:0})]));
    const performance=this.db.prepare('SELECT route,client,sum(n) AS requests,sum(CASE WHEN status>=400 AND status<500 THEN n ELSE 0 END) AS client_errors,sum(CASE WHEN status>=500 THEN n ELSE 0 END) AS server_errors FROM request_metrics WHERE day>=? GROUP BY route,client ORDER BY requests DESC LIMIT 100').all(cutoff);
    const latency=this.db.prepare('SELECT bucket,sum(n) AS n FROM request_metrics WHERE day>=? GROUP BY bucket ORDER BY bucket').all(cutoff);
    const total=latency.reduce((n,r)=>n+r.n,0);let cumulative=0,p95=null;for(const r of latency){cumulative+=r.n;if(p95===null&&cumulative>=total*.95)p95=r.bucket;}
    const sessions=this.db.prepare('SELECT page,account,last_seen,first_seen FROM presence WHERE last_seen>=? ORDER BY last_seen DESC LIMIT 100').all(activeSince).map(r=>({page:r.page,account:r.account?.slice(0,12)??null,classification:r.account?(labels[r.account]??'unclassified'):'guest',lastSeen:new Date(r.last_seen).toISOString(),durationSeconds:Math.max(0,Math.floor((r.last_seen-(r.first_seen??r.last_seen))/1000))}));
    const currentStart=new Date(this.now());currentStart.setUTCHours(0,0,0,0);currentStart.setUTCDate(currentStart.getUTCDate()-days);
    const priorStart=new Date(currentStart.getTime()-days*86400000),end=new Date(currentStart.getTime()+days*86400000);
    const started=Date.parse(this.db.prepare("SELECT value FROM meta WHERE key='startedAt'").get().value);
    const sum=(from,to)=>this.db.prepare('SELECT sum(browsers) AS browsers,sum(accounts) AS accounts,sum(views) AS views FROM anonymous_daily WHERE day>=? AND day<?').get(from.toISOString().slice(0,10),to.toISOString().slice(0,10));
    const comparison=started<=priorStart.getTime()?{current:sum(currentStart,end),previous:sum(priorStart,currentStart),basis:'Completed UTC calendar days; daily browser/account totals are not cross-day unique counts.'}:null;
    const journeys=this.db.prepare('SELECT account,step,at FROM journeys WHERE at>=? ORDER BY at').all(Date.parse(cutoff));
    const definitions={buyer:['purchase_prepared','order_confirm_requested','download_links'],seller:['asset_created','version_finalized','listing_prepared','listing_confirm_requested'],verification:['verification_quoted','verification_created'],bounty:['bounty_quoted','bounty_prepared'],assistant:['assistant_answer'],downloads:['download_links']};
    const funnels=Object.entries(definitions).map(([name,steps])=>{const progress=new Map();for(const e of journeys){const n=progress.get(e.account)??0;if(e.step===steps[n])progress.set(e.account,n+1);}return {name,steps:steps.map((step,i)=>({step,accounts:[...progress.values()].filter(n=>n>i).length}))};});
    return {labels,activeWindows,sessions,performance,p95UpperMs:total?p95:null,comparison,funnels,
      daily:this.db.prepare('SELECT * FROM anonymous_daily ORDER BY day DESC LIMIT 365').all(),
      audit:this.db.prepare('SELECT * FROM operator_audit ORDER BY at DESC LIMIT 100').all(),
      importedCosts:this.db.prepare('SELECT * FROM cost_imports WHERE day>=? ORDER BY day DESC LIMIT 200').all(cutoff)};
  }
  close() { this.db.close(); }
}
