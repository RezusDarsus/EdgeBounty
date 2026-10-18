import { afterAll, beforeAll, afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { loadConfig } from '../../apps/api/src/config.js';
import { createDb, schema } from '../../apps/api/src/db/index.js';
import { ChainService } from '../../apps/api/src/chain.js';
import { LocalStorage } from '../../apps/api/src/storage/index.js';
import { buildApp } from '../../apps/api/src/app.js';
import { issueSession } from '../../apps/api/src/auth/siws.js';
import type { AppContext } from '../../apps/api/src/context.js';
let ctx: AppContext, app: Awaited<ReturnType<typeof buildApp>>, close:()=>Promise<void>;
beforeAll(async()=>{
 const cfg=loadConfig({NODE_ENV:'test',WORKERS:'off',SOLANA_RPC_URL:'http://127.0.0.1:1',ANALYTICS_INGEST_SECRET:'s'.repeat(32)});
 const database=await createDb({memory:true});close=database.close;
 ctx={cfg,db:database.db,chain:new ChainService(cfg),storage:new LocalStorage('.data/test-analytics'),events:{}};
 app=await buildApp(ctx);
});
afterEach(()=>vi.unstubAllGlobals());afterAll(async()=>{await app.close();await close();});
it('derives registered identity from the session and rejects forged account fields',async()=>{
 const send=vi.fn().mockResolvedValue(new Response(null,{status:204}));vi.stubGlobal('fetch',send);
 const [account]=await ctx.db.insert(schema.accounts).values({wallet:Keypair.generate().publicKey.toBase58(),alias:'analytics-test'}).returning();
 const jwt=await issueSession(ctx.cfg.JWT_SECRET,{accountId:account.id,wallet:account.wallet,roles:[]});
 const payload={visitorId:randomUUID(),page:'home',pageView:true};
 expect((await app.inject({method:'POST',url:'/analytics/heartbeat',payload})).statusCode).toBe(202);
 expect(JSON.parse(send.mock.calls[0][1].body).accountId).toBeNull();
 expect((await app.inject({method:'POST',url:'/analytics/heartbeat',headers:{authorization:`Bearer ${jwt}`},payload})).statusCode).toBe(202);
 expect(JSON.parse(send.mock.calls[1][1].body).accountId).toBe(account.id);
 expect((await app.inject({method:'POST',url:'/analytics/heartbeat',payload:{...payload,accountId:randomUUID()}})).statusCode).toBe(400);
});
it('records fixed route templates, excluding telemetry and health traffic',async()=>{
 const send=vi.fn().mockResolvedValue(new Response(null,{status:204}));vi.stubGlobal('fetch',send);
 await app.inject({url:'/agents/capabilities'});
 const request=send.mock.calls.map(c=>JSON.parse(c[1].body)).find(e=>e.kind==='request');
 expect(request).toMatchObject({route:'/agents/capabilities',method:'GET'});
 expect(request).not.toHaveProperty('wallet');expect(request).not.toHaveProperty('ip');
});
it('does not fail heartbeat responses when the independent service is unavailable',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
 expect((await app.inject({method:'POST',url:'/analytics/heartbeat',payload:{visitorId:randomUUID(),page:'home',pageView:false}})).statusCode).toBe(202);
});
