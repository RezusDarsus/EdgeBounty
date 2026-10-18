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
    this.db.exec('INSERT OR IGNORE INTO daily_accounts SELECT day,account FROM daily_visitors WHERE account IS NOT NULL');
    this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('startedAt',new Date(this.now()).toISOString());
  }
  hash(value) { return createHmac('sha256',this.secret).update(value).digest('hex'); }
  ingest(event) {
    const now=this.now(), day=new Date(now).toISOString().slice(0,10);
    if(event.kind==='heartbeat') {
      if(!/^[0-9a-f-]{36}$/i.test(event.visitorId??'') || !pages.has(event.page) || (event.accountId!==null && !/^[0-9a-f-]{36}$/i.test(event.accountId??''))) throw Error('Invalid heartbeat');
      const visitor=this.hash('visitor:'+event.visitorId), account=event.accountId ? this.hash('account:'+event.accountId):null;
      this.db.prepare('INSERT INTO presence VALUES (?,?,?,?) ON CONFLICT(visitor) DO UPDATE SET account=excluded.account,last_seen=excluded.last_seen,page=excluded.page').run(visitor,account,now,event.page);
      this.db.prepare('INSERT INTO daily_visitors VALUES (?,?,?) ON CONFLICT(day,visitor) DO UPDATE SET account=coalesce(excluded.account,daily_visitors.account)').run(day,visitor,account);
      if(account)this.db.prepare('INSERT OR IGNORE INTO daily_accounts VALUES (?,?)').run(day,account);
      if(event.pageView===true) this.db.prepare('INSERT INTO pageviews VALUES (?,?,1) ON CONFLICT(day,page) DO UPDATE SET n=n+1').run(day,event.page);
    } else if(event.kind==='request') {
      if(!/^\/[a-zA-Z0-9/_.:-]{0,140}$/.test(event.route??'') || !['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(event.method) || !Number.isInteger(event.status) || event.status<100 || event.status>599) throw Error('Invalid request metric');
      this.db.prepare('INSERT INTO usage VALUES (?,?,?,?,1) ON CONFLICT(day,route,method,status) DO UPDATE SET n=n+1').run(day,event.route,event.method,event.status);
    } else throw Error('Invalid event');
  }
  prune() {
    const cutoff=new Date(this.now()-29*86400_000).toISOString().slice(0,10);
    this.db.prepare('DELETE FROM presence WHERE last_seen<?').run(this.now()-86400_000);
    for(const table of ['daily_visitors','daily_accounts','usage','pageviews']) this.db.prepare(`DELETE FROM ${table} WHERE day<?`).run(cutoff);
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
  close() { this.db.close(); }
}
