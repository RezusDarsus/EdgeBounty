import { createDb } from '../apps/api/src/db/index.js';
import { runCatDemo,seedCatShortfall,evidence } from '../tests/fixtures/collaboration.js';
import Fastify from 'fastify';
import { collaborationRoutes } from '../apps/api/src/routes/collaboration.js';
import { loadConfig } from '../apps/api/src/config.js';
import { issueSession,verifySession } from '../apps/api/src/auth/siws.js';
import { HttpError } from '../apps/api/src/lib/http.js';
import type { AppContext } from '../apps/api/src/context.js';
import { sql } from 'drizzle-orm';
import { rows } from '../apps/api/src/services/collaboration.js';
const store=await createDb({memory:true});
if(process.argv.includes('--serve')) {
  const {f}=await seedCatShortfall(store.db);
  const cfg=loadConfig({COLLABORATIVE_BOUNTIES_ENABLED:'1',NODE_ENV:'test',PAYMENT_CURRENCY:'USDC',PAYMENT_MINT:'isolated-demo-has-no-chain-mint'});
  const app=Fastify();
  app.addHook('onRequest',async req=>{const h=req.headers.authorization;if(h?.startsWith('Bearer '))req.session=await verifySession(cfg.JWT_SECRET,h.slice(7))??undefined;});
  app.setErrorHandler((error,req,reply)=>{if(error instanceof HttpError)return reply.code(error.status).send({message:error.message});return reply.code(500).send({message:'Demo action failed'});});
  collaborationRoutes(app,{db:store.db,cfg} as AppContext);
  const actors=await Promise.all([f.buyer,f.giorgi,f.nika,f.mariam].map(async u=>({id:u.id,name:u.alias,token:await issueSession(cfg.JWT_SECRET,{accountId:u.id,wallet:u.wallet,roles:[]})})));
  let completion:Promise<unknown>|undefined;
  app.post('/demo/complete',async(req,reply)=>{
    if(req.session?.accountId!==f.mariam.id)return reply.code(403).send({message:'Select Mariam and approve her reservation first'});
    if(completion)return completion;
    completion=(async()=>{
    const [claim]=await rows(store.db,sql`select id from contribution_claims where bounty_id=${f.id} and user_id=${f.mariam.id} and status='active' and reserved_count-accepted_count>=300`);
    if(!claim)throw new HttpError(409,'claim_required','Approve Mariam’s 300-image proposal first');
    const submission=await f.submission(f.mariam);
    return f.service.applyEvidence(f.id,submission.id,evidence('demo-final',300),'demo/1',true);
    })();
    try{return await completion;}catch(error){completion=undefined;throw error;}
  });
  app.get('/',async(_req,reply)=>reply.type('text/html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EdgeBounty collaboration demo</title><style>body{margin:0;background:#0c0f17;color:#e8eaf0;font:16px system-ui}main{max-width:1080px;margin:40px auto;padding:0 20px}h1{font:36px Georgia}section{border-top:2px solid #b7bdcb;margin:32px 0;padding-top:18px}button,select{background:#232a3b;color:#e8eaf0;border:1px solid #8c93a5;padding:10px 14px;border-radius:6px;cursor:pointer;margin:4px}button:hover{background:#303a53}button:focus-visible,select:focus-visible{outline:3px solid #8a99ff}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px 8px;border-bottom:1px solid #232a3b;font-variant-numeric:tabular-nums}progress{width:100%;height:16px;accent-color:#8a99ff}.muted{color:#b7bdcb}#error{color:#f07a70;min-height:24px}.scroll{overflow-x:auto}li{margin:10px 0;overflow-wrap:anywhere}#manifest{overflow-wrap:anywhere;white-space:pre-wrap}@media(max-width:600px){h1{font-size:28px}main{margin:24px auto}td,th{padding:10px 5px;font-size:13px}}</style><main><h1>Cat Image Collection</h1><p class="muted">Isolated collaboration demonstration · Synthetic verification fixtures · No real escrow or payments</p><label for="actor">Act as</label> <select id="actor"></select><span id="connection" class="muted" role="status">Connecting</span><p id="error" role="alert"></p><section><h2 id="progress">Loading shared progress</h2><progress id="bar" max="10000" aria-label="Accepted unique images"></progress><p id="counts" class="muted"></p></section><section><h2>Contributors</h2><div class="scroll"><table><thead><tr><th>Seller / agent</th><th>Submitted</th><th>Accepted</th><th>Duplicates</th><th>Reserved</th></tr></thead><tbody id="sellers"></tbody></table></div></section><section><h2>Your agent’s work proposals</h2><div id="proposals"></div><button id="complete">Mariam: contribute 300 fixture images</button><p class="muted">Select Mariam, approve her 300-image reservation, then contribute. Select Buyer to freeze the final allocation.</p></section><section><h2>Agent collaboration</h2><ol id="events"></ol></section><section><h2>Contribution accounting</h2><button id="freeze">Buyer: approve and freeze manifest</button><pre id="manifest">Gross reward: 500 USDC. Confirmed payments: none.</pre></section></main><script>
const actors=${JSON.stringify(actors)},root='/bounties/${f.id}';let current=actors[0],abort;
const by=id=>document.getElementById(id);const actor=by('actor');
for(const a of actors){const option=document.createElement('option');option.value=a.id;option.textContent=a.name;actor.append(option);}
async function request(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+current.token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const value=await r.json();if(!r.ok)throw Error(value.message);return value;}
async function action(path,body){try{by('error').textContent='';await request(path,body);await refresh();}catch(e){by('error').textContent=e.message;}}
async function refresh(){const v=await request(root+'/collaboration');by('progress').textContent=v.progress.accepted.toLocaleString()+' / 10,000 accepted unique images · '+v.progress.percent.toFixed(1)+'%';by('bar').value=v.progress.accepted;by('counts').textContent=v.progress.remaining+' remaining · '+v.progress.duplicates+' confirmed duplicates · '+v.progress.pending+' pending';by('sellers').replaceChildren();for(const c of v.contributors){const tr=document.createElement('tr');for(const value of [c.name+' / '+c.agentStatus,c.submitted||0,c.accepted||0,c.duplicates||0,v.claims.filter(q=>q.userId===c.userId).reduce((n,q)=>n+q.reservedCount-q.acceptedCount,0)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}by('sellers').append(tr);}by('proposals').replaceChildren();for(const p of v.proposals.filter(p=>p.userId===current.id)){const row=document.createElement('p');row.textContent=p.type.replaceAll('_',' ')+' · '+p.count+' images ';const button=document.createElement('button');button.textContent='Approve reservation';button.onclick=()=>action(root+'/proposals/'+p.id+'/respond',{accept:true});row.append(button);by('proposals').append(row);}if(!by('proposals').children.length)by('proposals').textContent='No proposals for this actor.';by('events').replaceChildren();for(const e of v.events.slice(-12)){const li=document.createElement('li');li.textContent=(e.agentId?'Agent':'Coordinator / verification')+': '+e.type.replaceAll('_',' ')+' '+JSON.stringify(e.payload);by('events').append(li);}if(v.manifest)by('manifest').textContent=JSON.stringify(v.manifest,null,2);}
async function stream(){abort?.abort();abort=new AbortController();const signal=abort.signal;while(!signal.aborted){try{await refresh();const r=await fetch(root+'/events/stream',{headers:{authorization:'Bearer '+current.token},signal});if(!r.ok)throw Error('Live connection unavailable');by('connection').textContent='Live';const reader=r.body.getReader();while(!signal.aborted){const part=await reader.read();if(part.done)break;if(new TextDecoder().decode(part.value).includes('data:'))await refresh();}}catch(e){if(signal.aborted)return;by('connection').textContent='Reconnecting';}await new Promise(resolve=>setTimeout(resolve,1500));}}
actor.onchange=()=>{current=actors.find(a=>a.id===actor.value);void stream();};by('complete').onclick=()=>action('/demo/complete',{});by('freeze').onclick=()=>action(root+'/payout-manifest',{});void stream();
</script></html>`));
  await app.listen({host:'127.0.0.1',port:4010});
  console.log('Isolated live demo: http://127.0.0.1:4010 (Ctrl+C to stop; no real payments).');
  const shutdown=async()=>{await app.close();await store.close();process.exit(0);};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
} else {
try {
  const {before,after,manifest,fixture:f}=await runCatDemo(store.db);
  console.log('Isolated deterministic demonstration. No real files, RPC calls, payments, or funded escrow.');
  console.log('Initial progress:',before.progress);
  console.log('Final progress:',after.progress);
  console.table(manifest.allocations.map((a:any)=>({seller:[f.giorgi,f.nika,f.mariam].find(u=>u.id===a.userId)?.alias,accepted:a.count,grossUSDC:(BigInt(a.grossMicro)/1000000n).toString()})));
  console.log('Immutable manifest:',manifest.hash,manifest.settlementStatus);
}finally{await store.close();}
}
