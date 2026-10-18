/** Creates explicitly labelled hackathon examples through the real test-network APIs.
 * Private actor keys stay under ignored .data; only the allowlisted evidence is published.
 * Run: npx tsx scripts/hackathon-demo.ts (requires .data/hackathon source files).
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {Connection,Keypair,PublicKey} from '@solana/web3.js';
import {EdgeBountyClient} from '@edgebounty/blockchain-client';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

const dir='.data/hackathon',API='https://api.13-61-207-211.sslip.io';
await mkdir(dir,{recursive:true});
let state:any={actors:{},steps:{}};
try{state=JSON.parse(await readFile(`${dir}/private-state.json`,'utf8'));}catch(e:any){if(e.code!=='ENOENT')throw e;}
const save=()=>writeFile(`${dir}/private-state.json`,JSON.stringify(state,null,2),{mode:0o600});
async function once<T>(key:string,run:()=>Promise<T>):Promise<T>{if(state.steps[key])return state.steps[key];const v=await run();state.steps[key]=v;await save();console.log('Completed:',key);return v;}
async function api(method:string,path:string,who?:any,body?:unknown):Promise<any>{
 const r=await fetch(API+path,{method,headers:{...(who?{authorization:`Bearer ${who.token}`} :{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(180000)});
 const t=await r.text();if(!r.ok)throw Error(`${method} ${path}: ${r.status} ${t.slice(0,500)}`);return JSON.parse(t);
}
const cfg=await api('GET','/config');assert.equal(cfg.currency,'USDC');assert.equal(cfg.paymentReady,true);
const client=new EdgeBountyClient(new Connection('https://rpc.13-61-207-211.sslip.io','confirmed'),new PublicKey(cfg.programId));
const genesis=await client.connection.getGenesisHash();
assert(!['5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d','EtWTRABZaYq6iMfeYKouRu166VU2xqa1'].includes(genesis),'Private demo validator required');
const hex=(s:string)=>new Uint8Array(Buffer.from(s,'hex'));
const send=(who:any,ixs:any)=>client.send(ixs,[who.kp]);
async function actor(name:string){
 const stored=state.actors[name];const kp=stored?Keypair.fromSecretKey(new Uint8Array(stored.key)):Keypair.generate();
 if(!stored){state.actors[name]={key:Array.from(kp.secretKey)};await save();}
 const ch=await api('POST','/auth/challenge',undefined,{wallet:kp.publicKey.toBase58()});
 const auth=await api('POST','/auth/verify',undefined,{wallet:kp.publicKey.toBase58(),nonce:ch.nonce,signature:bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message),kp.secretKey))});
 const who={kp,token:auth.token,name};
 await once(`fund-${name}`,()=>api('POST','/dev/faucet',who,{wallet:kp.publicKey.toBase58()}));
 await api('PATCH','/me',who,{alias:`hackathon-${name.toLowerCase()}`,mode:'public',displayName:`${name} · Hackathon demo`,organization:name==='Orbital'?'Orbital Vision Lab (demo company)':null,bio:'Operator-created demonstration account for the EdgeBounty hackathon. Not an independent customer or real contributor.'});
 return who;
}
async function pay(who:any,invoice:any){if(!invoice)return;await once(`invoice-${invoice.id}`,async()=>{const signature=await send(who,await client.payService(who.kp.publicKey,hex(invoice.reference),invoice.serviceKind,BigInt(invoice.amountMicro)));await api('POST',`/invoices/${invoice.id}/confirm`,who,{});return {signature,amountMicro:invoice.amountMicro};});}
async function upload(key:string,who:any,kind:string,purpose:string,name:string,files:{path:string,data:Buffer,mediaType:string}[]){
 if(purpose==='listing')await once(`capacity-${who.name}`,async()=>{const plan=await api('POST','/storage/allocations',who,{gb:10,termDays:30});await pay(who,plan.invoice);return {paid:true};});
 const created=await once(`${key}-asset`,()=>api('POST','/assets',who,{kind,purpose,name,category:kind==='model'?'image_classification':'space_photography'}));
 for(const f of files)await once(`${key}-file-${f.path}`,async()=>{
  const up=await api('POST',`/versions/${created.version.id}/uploads`,who,{path:f.path,size:f.data.length,sha256:createHash('sha256').update(f.data).digest('hex'),mediaType:f.mediaType});
  for(let i=0;i<up.partsTotal;i++){const chunk=f.data.subarray(i*up.partSize,(i+1)*up.partSize);const signed=await api('POST',`/uploads/${up.uploadId}/parts/${i+1}/url`,who,{md5:createHash('md5').update(chunk).digest('base64')});const r=await fetch(signed.url,{method:'PUT',headers:signed.headers,body:chunk});assert.equal(r.status,200);}
  await api('POST',`/uploads/${up.uploadId}/complete`,who,{});return {uploaded:true};
 });
 await once(`${key}-finalized`,()=>api('POST',`/versions/${created.version.id}/finalize`,who,{}));return created.version.id;
}
async function verify(key:string,who:any,versionId:string,level='L2',criteria?:any){
 const job=await once(`${key}-job`,()=>api('POST','/verification/jobs',who,{assetVersionId:versionId,level,...(criteria?{criteria}:{})}));await pay(who,job.invoice);
 return once(`${key}-result`,async()=>{const end=Date.now()+600000;for(;;){const j=await api('GET',`/verification/jobs/${job.job.id}`,who);if(j.status==='completed'){assert.equal(j.result.report.passed,true,JSON.stringify(j.result.report));return j;}if(j.status==='failed'||j.status==='needs_authorization'||Date.now()>end)throw Error(`Verification ${key}: ${j.status} ${j.error??''}`);await new Promise(r=>setTimeout(r,2500));}});
}
async function publish(key:string,who:any,versionId:string,title:string,description:string,formats:string[],licenseId='cc-by-4.0'){
 await once(`${key}-hosting`,async()=>{const h=await api('POST',`/versions/${versionId}/hosting`,who,{months:1});await pay(who,h.invoice);return {paid:true};});
 const l=await once(`${key}-listing`,()=>api('POST','/listings',who,{assetVersionId:versionId,title,description,category:formats.includes('onnx')?'image_classification':'space_photography',formats,licenseId,priceMicro:'10000000',details:{demo:true,disclosure:'Operator-created hackathon example; private test network and mock USDC.'}}));
 await once(`${key}-published`,async()=>{const p=l.onchain;const tx=await client.createListing(who.kp.publicKey,BigInt(p.listingId),formats.includes('onnx')?'model':'dataset',{assetCommitment:hex(p.assetCommitment),termsHash:hex(p.termsHash),licenseHash:hex(p.licenseHash),price:BigInt(p.price)});const signature=await send(who,tx.ixs);await api('POST',`/listings/${l.listing.id}/confirm`,who,{});return {signature};});return l.listing.id;
}
const buyer=await actor('Orbital'),sellers=[];for(const n of ['Giorgi','Nika','Mariam','Ana','Luka'])sellers.push(await actor(n));
const sources=JSON.parse(await readFile(`${dir}/sources.json`,'utf8'));
const photos=await Promise.all(sources.map(async(s:any)=>({path:s.file,data:await readFile(`${dir}/${s.file}`),mediaType:'image/jpeg'})));
const criteria={kind:'image_dataset',minImages:1,minWidth:64,minHeight:64};
const bounty=await once('company-bounty',()=>api('POST','/bounties',buyer,{title:'Hackathon demo · Orbital Vision Lab · 5 space photographs',description:'Demonstration company collecting five unique NASA space-program photographs from five operator-created demo sellers. Real uploaded bytes and paid verification; no real customers, funds or independent contributors. NASA source credit accompanies every image. Buyer reviews relevance and licensing separately.',deliverables:['Five unique, readable NASA space-program photographs, at least 64 × 64 pixels.','NASA source references and attribution declarations.'],criteria,licenseId:'cc-by-4.0',budgetMicro:'500000000',deadline:new Date(Date.now()+7*86400000).toISOString(),maxCorrections:0,collaborationTarget:5}));
const root=`/bounties/${bounty.order.id}`;
await once('bounty-funded',async()=>{const a=bounty.onchain;const tx=await client.createAndFundBounty(buyer.kp.publicKey,BigInt(a.orderId),{amount:BigInt(a.amount),verifier:new PublicKey(a.verifier),verifierFee:BigInt(a.verifierFee),verifierCapability:1,termsHash:hex(a.termsHash),criteriaHash:hex(a.criteriaHash),licenseHash:hex(a.licenseHash),deadline:a.deadline,maxCorrections:0,designatedSeller:new PublicKey(a.designatedSeller)});const signature=await send(buyer,tx.ixs);await api('POST',`/orders/${bounty.order.id}/sync`,buyer,{});return {signature};});
await once('bounty-enabled',()=>api('POST',`${root}/collaboration/enable`,buyer,{target:5}));
for(const s of sellers)await once(`join-${s.name}`,()=>api('POST',`${root}/collaborators/join`,s,{}));

for(const s of sellers){await once(`claim-${s.name}`,()=>api('POST',`${root}/work-claims`,s,{count:1,idempotencyKey:`hackathon-v1-${s.name}`}));}
async function contribute(s:any,index:number,key:string){const versionId=await upload(key,s,'dataset','submission',`Hackathon demo · ${s.name} · ${sources[index].title}`,[photos[index]]);const job=await verify(key,s,versionId,'L2',criteria);await once(`${key}-submitted`,()=>api('POST',`${root}/contributions`,s,{assetVersionId:versionId,verificationJobId:job.id,licenseDeclaration:`Hackathon demo: NASA source photograph ${sources[index].source}. Credit: NASA / ${sources[index].credit}. Public NASA media supplied for demonstration with source attribution; I do not claim authorship or exclusive rights. Buyer inspection is authorized.`,reviewAccessGranted:true}));return {seller:s.name,versionId,jobId:job.id,report:job.result.report,reportHash:job.result.reportHash,source:sources[index]};}
const contributions=[];
contributions.push(await contribute(sellers[0],0,'contribution-giorgi'));
const duplicate=await contribute(sellers[1],0,'contribution-nika-duplicate');
// Wait for durable worker evidence before asking Nika's actual NVIDIA-backed agent to explain the duplicate.
await once('duplicate-observed',async()=>{for(let i=0;i<60;i++){const v=await api('GET',`${root}/collaboration`,buyer);if(v.progress.duplicates>=1)return {progress:v.progress};await new Promise(r=>setTimeout(r,2000));}throw Error('Duplicate not observed');});
const own=await api('GET',`${root}/collaboration`,sellers[1]);
const me=await api('GET','/me',sellers[1]);const agent=own.contributors.find((c:any)=>c.userId===me.account.id);assert(agent);
try { await once('nika-provider-proposal',()=>api('POST',`${root}/agents/${agent.agentId}/propose`,sellers[1],{consent:true})); } catch(e) { console.log('Provider enrichment unavailable; deterministic agent events remain authoritative.'); }
let assistant=await once('live-assistant',()=>api('POST','/agents/chat',buyer,{mode:'bounty',message:'For the hackathon demo company Orbital Vision Lab, explain how five demo contributors can provide five unique NASA space photographs. Explain duplicate replacement, buyer review, and human approval before payments. Respond with fewer than 120 words for judges. Do not imply these are real customers or real money.',consent:true}));
contributions.push(await contribute(sellers[1],1,'contribution-nika-replacement'));
for(let i=2;i<5;i++)contributions.push(await contribute(sellers[i],i,`contribution-${sellers[i].name.toLowerCase()}`));
await once('buyer-reviewed',async()=>{for(let i=0;i<60;i++){const items=await api('GET',`${root}/review-items`,buyer);for(const item of items.filter((x:any)=>x.status==='review')){const r=await fetch(API+`${root}/review-items/${item.id}/content`,{headers:{authorization:`Bearer ${buyer.token}`},redirect:'follow'});assert.equal(r.status,200);assert((await r.arrayBuffer()).byteLength>100);await api('POST',`${root}/review-items/${item.id}/respond`,buyer,{accept:true,reason:'Demo operator reviewed the NASA source photograph, readability, distinct image content and source-credit declaration.'});}const p=await api('GET',`${root}/progress`,buyer);if(p.accepted===5)return p;await new Promise(r=>setTimeout(r,2000));}throw Error('Buyer review did not reach 5');});
const snapshot=await api('GET',`${root}/collaboration`,buyer);
const manifest=await once('manifest',()=>api('POST',`${root}/payout-manifest`,buyer,{}));
const attribution=Buffer.from(sources.map((s:any)=>`${s.file}: ${s.title}\nCredit: NASA / ${s.credit}\nSource: ${s.source}\nNASA media usage: https://www.nasa.gov/nasa-brand-center/images-and-media/\nNo NASA endorsement. No authorship or exclusive rights claimed.\n`).join('\n'));
const datasetVersion=await upload('catalog-dataset',sellers[0],'dataset','listing','Hackathon demo · NASA space photography · 5 real images',[...photos,{path:'ATTRIBUTION.txt',data:attribution,mediaType:'text/plain'}]);
const datasetReport=await verify('catalog-dataset',sellers[0],datasetVersion,'L3',{kind:'image_dataset',minImages:5,minWidth:64,minHeight:64,minRelevanceBps:1000,relevancePrompt:'The images should be genuine photographs related to the NASA space program, including space shuttle launches, spacecraft, astronauts or spacecraft landings.'});
const datasetListing=await publish('catalog-dataset',sellers[0],datasetVersion,'Hackathon demo · NASA space photography','Five real NASA photographs with source credits. Operator-created hackathon example, not a proprietary or exclusive dataset. L3 report checks the exact uploaded version; sampled AI relevance is an estimate and does not establish provenance or rights. No NASA endorsement.',['jpg','txt']);
const models=[];
for(const [key,name] of [['red-blue','Red / blue ONNX classifier'],['color-baseline','Color dominance ONNX baseline']]){
 const bytes=await readFile(`${dir}/fixtures/model/${key==='red-blue'?'red_blue':'color_baseline'}.onnx`);
 const versionId=await upload(`model-${key}`,sellers[4],'model','listing',`Hackathon demo · ${name}`,[{path:`${key}.onnx`,data:bytes,mediaType:'application/octet-stream'}]);
 const report=await verify(`model-${key}`,sellers[4],versionId);
 const listingId=await publish(`model-${key}`,sellers[4],versionId,`Hackathon demo · ${name}`,'Small deterministic ONNX demonstration model. It classifies synthetic red-versus-blue color dominance; it is not a space-image classifier. Structural verification does not establish real-world accuracy. Operator-created hackathon listing, mock USDC only.',['onnx'],'mit');
 models.push({name,versionId,listingId,jobId:report.id,report:report.result.report,reportHash:report.result.reportHash});
}
const evidence={schema:'edgebounty.hackathon-evidence/1',createdAt:new Date().toISOString(),network:'Private validator · mock USDC',disclosure:'All six accounts are operator-created demo identities, not independent people or real customers. Uploaded NASA photos are real images. Verification reports and NVIDIA responses below were produced by the live services. No seller payments are claimed.',company:'Orbital Vision Lab (demo company)',bountyId:bounty.order.id,bountyFundingSignature:state.steps['bounty-funded'].signature,progress:snapshot.progress,contributors:snapshot.contributors.map((c:any)=>({name:c.name,agentId:c.agentId,submitted:c.submitted,accepted:c.accepted,duplicates:c.duplicates,agentStatus:c.agentStatus})),events:snapshot.events,manifest:{hash:manifest.hash,allocations:manifest.allocations,settlementStatus:manifest.settlementStatus},assistant:{answer:assistant.answer,provider:assistant.provider,model:assistant.model,cached:assistant.cached,limitations:assistant.limitations},contributions,duplicate:{seller:duplicate.seller,jobId:duplicate.jobId},dataset:{versionId:datasetVersion,listingId:datasetListing,jobId:datasetReport.id,report:datasetReport.result.report,reportHash:datasetReport.result.reportHash},models,sources};
await writeFile(`${dir}/evidence.json`,JSON.stringify(evidence,null,2));
assert.equal(evidence.progress.accepted,5);assert.equal(evidence.progress.duplicates,1);
assert.equal(evidence.contributors.length,5);assert.equal(evidence.models.length,2);
const publicJson=JSON.stringify(evidence,null,2)+'\n';
assert(!/eyJ[A-Za-z0-9_-]{25,}\.|"(?:token|secretKey|authorization|objectKey|privateKey)"\s*:|X-Amz-Signature|nvapi-/i.test(publicJson),'Sensitive data must not enter published evidence');
if(process.argv.includes('--publish'))for(const target of ['apps/web/src/data','apps/web/public']){await mkdir(target,{recursive:true});await writeFile(`${target}/hackathon-evidence.json`,publicJson);}
console.log(JSON.stringify({completed:true,bountyId:evidence.bountyId,datasetListing,models:models.map(m=>m.listingId),progress:evidence.progress,evidence:`${dir}/evidence.json`}));
