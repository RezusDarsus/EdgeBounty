const $=id=>document.getElementById(id);

const sections={overview:['Operator overview','Activity, obligations and the systems behind each exchange.'],visitors:['Visitors & users','Browser estimates, authenticated activity and explicit account classification.'],product:['Product analytics','Observed actions within a consistent account cohort.'],marketplace:['Marketplace','Datasets, models, requests, submissions and verifiers.'],solana:['Solana & escrow','Indexed accounting alongside independent finalized-chain checks.'],revenue:['Revenue & costs','Separate token receipts, service obligations and USD expenses.'],ai:['AI operations','Assistant attempts, verification outcomes and provider evidence.'],storage:['Storage & downloads','Recorded assets, paid coverage and transfer accounting.'],infrastructure:['Infrastructure','Current host and dependency probes.'],security:['Security & audit','Operator access, protected actions and evidence gaps.']};

const state={overview:null,operations:null,infrastructure:null,busy:false,costDraft:{},unsaved:false};

let zone=localStorage.getItem('operator_timezone')??'Asia/Tbilisi';if(!['UTC','Asia/Tbilisi'].includes(zone))zone='UTC';$('timezone').value=zone;

const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};

const append=(n,...children)=>{n.append(...children.filter(Boolean));return n;};

const count=v=>v===null||v===undefined?'Unavailable':BigInt(v).toLocaleString();

const human=v=>String(v??'Unavailable').replaceAll('_',' ');

const date=v=>v?new Intl.DateTimeFormat('en-GB',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(v)):'Unavailable';

const money=(v,currency=state.overview?.currency??'USDC')=>{if(v===undefined||v===null)return 'Unavailable';const n=BigInt(v),scale=currency==='SOL'?1000000000n:1000000n;return `${(n/scale).toLocaleString()}.${(n%scale).toString().padStart(scale===1000000000n?9:6,'0')} ${currency}`;};

const bytes=v=>v===null||v===undefined?'Unavailable':`${(Number(v)/1073741824).toLocaleString(undefined,{maximumFractionDigits:4})} GiB`;

const duration=v=>v===null||v===undefined?'Unavailable':`${(Number(v)/1000).toFixed(2)} s`;

const sum=(rows,key)=>rows.reduce((n,r)=>n+BigInt(r[key]??0),0n);

function button(label,action,cls){const n=el('button',label,cls);n.type='button';n.onclick=action;return n;}

function note(text,kind='footnote'){return el('p',text,kind);}

function block(title,description){const n=el('section');append(n,el('h2',title),description?note(description):null);return n;}

function metricList(items){const dl=el('dl',undefined,'metric-list');for(const [label,value,detail,action] of items){const n=el('div');append(n,el('dt',label),append(el('dd'),action?button(value,action,'metric-link'):el('span',value)),note(detail));dl.append(n);}return dl;}

function go(section){location.hash=section;}

function exportCsv(title,headers,rows){const quote=v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};const blob=new Blob(['\ufeff'+[headers,...rows].map(r=>r.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=`edgebounty-${title}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

function table(title,columns,data,{empty='No records in this window.',pageSize=10,actions=null}={}) {

 const box=el('div',undefined,'data-table'),head=el('div',undefined,'table-head');let page=0,sorted=[...data],direction=1;

 const flattened=()=>sorted.map(row=>columns.map(c=>c.value(row)));

 append(head,el('h3',title),button('Export CSV',()=>exportCsv(title,columns.map(c=>c.name),flattened()),'quiet'));box.append(head);

 const scroll=el('div',undefined,'table-scroll'),t=el('table'),thead=el('thead'),tr=el('tr'),body=el('tbody'),pager=el('div',undefined,'pager');

 columns.forEach(c=>{const th=el('th');th.scope='col';const b=button(c.name,()=>{direction*=-1;sorted.sort((a,b)=>{const x=c.sort?c.sort(a):c.value(a),y=c.sort?c.sort(b):c.value(b);return (typeof x==='bigint'&&typeof y==='bigint'?(x<y?-1:x>y?1:0):typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),undefined,{numeric:true}))*direction;});page=0;draw();},'sort');th.append(b);tr.append(th);});if(actions)tr.append(el('th','Actions'));thead.append(tr);append(t,thead,body);scroll.append(t);append(box,scroll,pager);

 function draw(){body.replaceChildren();pager.replaceChildren();const subset=sorted.slice(page*pageSize,(page+1)*pageSize);if(!subset.length){const td=el('td',empty,'empty');td.colSpan=columns.length+(actions?1:0);body.append(append(el('tr'),td));}

 for(const row of subset){const r=el('tr');for(const c of columns)r.append(el('td',c.value(row)));if(actions){const td=el('td');td.append(actions(row));r.append(td);}body.append(r);}

 const prev=button('Previous',()=>{page--;draw();}),next=button('Next',()=>{page++;draw();});prev.disabled=page===0;next.disabled=(page+1)*pageSize>=sorted.length;append(pager,note(`${count(sorted.length)} records · page ${page+1} / ${Math.max(1,Math.ceil(sorted.length/pageSize))}`),prev,next);}

 draw();return box;

}

const col=(name,key,format=human)=>({name,value:r=>format(r[key]),sort:r=>/^\d+$/.test(String(r[key]))?BigInt(r[key]):r[key]??''});

async function request(path,body){const r=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(20000),...(body?{method:'POST',headers:{'content-type':'application/json','x-operator-action':'1'},body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.message??data.error??`Request failed (${r.status})`);return data;}

function showError(error){$('error').hidden=false;$('error').textContent=`${error.message}. Previously displayed metrics may be stale.`;}

async function records(type,page=1,sort='desc',id){try{const data=await request(`/api/records?type=${type}&page=${page}&days=${$('days').value}&sort=${sort}${id?'&id='+encodeURIComponent(id):''}`);$('detail-title').textContent=`${human(type)} records`;const body=$('detail-body');body.replaceChildren(note(`UTC window: ${$('days').value} days · ${count(data.total)} records. CSV exports the loaded page. Detail lookup by ID includes older records.`));

 if(data.rows.length){const keys=Object.keys(data.rows[0]).filter(k=>!['chain','providerCosts'].includes(k));body.append(table(type,keys.slice(0,8).map(k=>col(human(k),k,k.includes('_at')?date:human)),data.rows,{pageSize:50,actions:r=>button('Inspect',()=>inspect(type,r))}));}else body.append(note('No records in this window.'));

 const controls=el('div',undefined,'controls');const prev=button('Previous 50',()=>void records(type,page-1,sort,id)),next=button('Next 50',()=>void records(type,page+1,sort,id));prev.disabled=page<=1;next.disabled=page*50>=Number(data.total);append(controls,prev,note(`Page ${page}`),next,button(sort==='desc'?'Oldest first':'Newest first',()=>void records(type,1,sort==='desc'?'asc':'desc',id)));body.append(controls);if(!$('details').open)$('details').showModal();}catch(e){showError(e);}}

function inspect(type,r){const body=$('detail-body');body.replaceChildren();$('detail-title').textContent=`${human(type)} · ${r.id??r.signature}`;

 body.append(note('Measured: persisted record. Indexed chain fields require the separate live check for current finality.'));

 const values=Object.entries(r).map(([key,value])=>({key:human(key),value:typeof value==='object'?JSON.stringify(value,null,2):String(value??'Unavailable')}));body.append(table('record-details',[col('Field','key'),col('Value','value')],values,{pageSize:50}));

 if(type==='orders'){const c=r.chain??{},n=String(c.sellerBps??''),fee=String(c.feeBps??'');if(r.chain_state==='settled'&&/^\d+$/.test(n)&&/^\d+$/.test(fee)&&Number(n)<=10000&&Number(fee)<=10000){const principal=BigInt(r.amount_micro),gross=principal*BigInt(n)/10000n,commission=gross*BigInt(fee)/10000n;body.append(metricList([['Seller allocation',money(gross),'Derived · indexed split'],['Platform commission',money(commission),'Derived · rounded down per contract'],['Seller net',money(gross-commission),'Derived · indexed split']]));}body.append(note(`Contributor group: ${r.group_id??'not grouped'}. Chain program and finalized vault status are available from Solana & escrow. Indexed lifecycle fields are not transaction-level evidence.`));}

 if(type==='jobs'){const timeline=[['Submitted',r.created_at],['Worker lock',r.locked_at],['Completed',r.completed_at]].filter(v=>v[1]);body.append(table('Job timeline',[col('Event','event'),col('Observed at','at',date)],timeline.map(v=>({event:v[0],at:v[1]}))));body.append(note('Payment authorization, provider call timing and full/sample coverage are not retained in this view. An absent stage is unknown, not skipped.'));}

 if(type==='transactions')body.append(button('Check live finality',async()=>{try{const f=await request('/api/finality?signature='+encodeURIComponent(r.signature));body.append(note(`Finalized check: ${f.confirmationStatus}; slot ${f.slot??'unknown'}; failed: ${f.failed??'unknown'} · ${date(f.checkedAt)}`));}catch(e){showError(e);}}));

 body.append(button('Back to records',()=>void records(type)));}

function chart(daily){const box=block('Daily browser activity','Estimated · one point per UTC day. Missing dates are not reconstructed traffic.');if(!daily.length){box.append(note('No browser activity collected yet.'));return box;}

 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 800 180');svg.setAttribute('role','img');svg.setAttribute('aria-label','Daily distinct browser counts; exact values in the following table');svg.classList.add('chart');

 const max=Math.max(1,...daily.map(d=>d.browsers));const points=daily.map((d,i)=>`${40+i*720/Math.max(1,daily.length-1)},${145-d.browsers*115/max}`).join(' ');const line=document.createElementNS(ns,'polyline');line.setAttribute('points',points);line.setAttribute('fill','none');line.setAttribute('stroke','currentColor');line.setAttribute('stroke-width','2');svg.append(line);

 daily.forEach((d,i)=>{const c=document.createElementNS(ns,'circle');c.setAttribute('cx',String(40+i*720/Math.max(1,daily.length-1)));c.setAttribute('cy',String(145-d.browsers*115/max));c.setAttribute('r','3');c.setAttribute('fill','currentColor');svg.append(c);});box.append(svg,table('Daily visitors',[col('UTC date','day'),col('Browsers','browsers',count),col('Signed-in accounts','registered',count)],daily));return box;}

function alerts(){const out=[],o=state.operations?.marketplace,t=state.operations?.activity;if(o){if(Number(o.stuck.n))out.push(`${o.stuck.n} verification jobs have held a worker lock for more than 10 minutes. Investigate before retrying.`);const attempts=o.agents.reduce((n,a)=>n+Number(a.n),0),failed=o.agents.filter(a=>a.status==='failed').reduce((n,a)=>n+Number(a.n),0);if(attempts>=20&&failed/attempts>.2)out.push(`Assistant failure rate ${(100*failed/attempts).toFixed(1)}% across ${attempts} attempts exceeds the 20% threshold (minimum 20 attempts).`);if(Number(o.hosting.expiring_7d))out.push(`${o.hosting.expiring_7d} asset versions have coverage intervals ending within 7 days; overlapping renewals need review.`);}

 if(t){const n=t.performance.reduce((n,r)=>n+r.requests,0),e=t.performance.reduce((n,r)=>n+r.server_errors,0);if(n>=100&&e/n>.05)out.push(`API 5xx rate ${(e/n*100).toFixed(1)}% across ${n} measured requests exceeds 5% (minimum 100 requests).`);}

 return out;}

function overview(v,t,m,o,a){append(v,metricList([['Active guests',count(t.active.guests),'Estimated · visible browsers, last 5 minutes',()=>go('visitors')],['Active accounts',count(t.active.registered),'Estimated · distinct signed-in accounts',()=>go('visitors')],['Registered accounts',count(m?.accounts.registered),'Measured · all current accounts, including demos',()=>go('visitors')],['Settled principal',money(m?.finance.settled_volume),'Derived · seller allocation before commission',()=>go('solana')],['Platform commission',money(m?.finance.commission),'Derived · mock token commission, all time',()=>go('revenue')],['AI assistant attempts',o?count(sum(o.agents,'n')):'Unavailable',`Measured · selected ${$('days').value}-day window`,()=>go('ai')]]));

 const issues=alerts(),b=block('Operator attention','Threshold alerts use minimum sample sizes. This is a current snapshot, not a background notification service.');if(issues.length){const ul=el('ul',undefined,'alerts');issues.forEach(s=>ul.append(el('li',s)));b.append(ul);}else b.append(note('No configured threshold alert in the available measurements. Unmeasured dependencies may still have problems.'));v.append(b);

 const comparison=block('Period comparison','Completed UTC calendar days; the current partial day is excluded. Financial lifetime totals above do not use the activity window.');if(a?.comparison)comparison.append(table('Comparison',[col('Metric','metric'),col('Current','current',count),col('Previous','previous',count),col('Change','change')],['browsers','accounts','views'].map(k=>{const c=a.comparison.current[k]??0,p=a.comparison.previous[k]??0;return {metric:k+' · daily totals',current:c,previous:p,change:p?((c-p)/p*100).toFixed(1)+'%':'No comparison data'};})));else comparison.append(note('No comparison data. Collection has not covered two complete equivalent windows.'));append(v,comparison,chart(t.daily));}

function visitors(v,t,m,o,a){v.append(note(`Tracking began ${date(t.startedAt)}. Opted-out browsers are excluded. Session duration is the observed heartbeat span, and may include idle gaps.`));if(a){v.append(metricList([1,7,30].map(n=>{const w=a.activeWindows[n];return [`${n===1?'DAU':n===7?'WAU':'MAU'} · classified production`,count(w.production),`${w.production+w.unclassified+w.test} all · ${w.test} test · ${w.unclassified} unclassified`,null];})));

 v.append(table('Live sessions',[col('Page category','page'),col('Session account token','account'),col('Classification','classification'),col('Observed duration','durationSeconds',s=>s+' s'),col('Last heartbeat','lastSeen',date)],a.sessions));}

 v.append(table('Page views',[col('Section','page'),col('Views','views',count)],t.pages));

 if(o){v.append(table('Daily registrations · UTC',[col('UTC date','day'),col('Registrations','registrations',count)],o.daily));const form=el('form',undefined,'controls'),input=el('input');input.placeholder='Marketplace account UUID';input.setAttribute('aria-label','Marketplace account UUID');input.required=true;const submit=el('button','Find account token');submit.type='submit';const result=note('');form.append(input,submit,result);form.onsubmit=async e=>{e.preventDefault();try{const data=await request('/api/account-token?id='+encodeURIComponent(input.value));result.textContent='Account token: '+data.account.slice(0,12);}catch(e){showError(e);}};v.append(form);v.append(note(`Classification is explicit and auditable. Unclassified accounts are never silently treated as genuine users. Loaded ${o.accounts.length} of ${o.totals.accounts} current accounts. Telemetry uses a separate keyed account token; wallets are not exposed.`));v.append(table('Account classifications',[col('Account token','account',s=>s.slice(0,12)),col('Registered','created_at',date),col('Classification','classification'),{name:'Roles observed',value:r=>[r.buyer?'buyer':null,r.seller?'seller':null,r.verifier?'verifier':null].filter(Boolean).join(', ')||'none recorded'}],o.accounts,{actions:r=>{const s=el('select');s.setAttribute('aria-label',`Classify account ${r.account.slice(0,12)}`);for(const c of ['unclassified','test','production']){const option=el('option',c);option.value=c;s.append(option);}s.value=r.classification;s.onchange=async()=>{try{await request('/api/classify',{account:r.account,classification:s.value});await refresh();}catch(e){s.value=r.classification;showError(e);}};return s;}}));}

 v.append(note('Country, device, browser, acquisition, new/returning visitors and guest-to-signup conversion: not collected. A browser identifier does not establish a person or a successful registration.'));

}

function product(v,t,m,o,a){v.append(note('Each workflow uses distinct authenticated account tokens with the first observed stage inside the selected UTC window. Subsequent successful stages must be ordered inside the same window; returning accounts count once. Events begin with this upgrade. Prepared/confirmed API requests are not proof of escrow settlement. Unauthenticated browsing is excluded.'));

 for(const f of a?.funnels??[]){const b=block(human(f.name)+' workflow');b.append(table(f.name+' stages',[col('Stage','step'),col('Accounts','accounts',count)],f.steps,{actions:r=>button('Inspect aggregate failures',()=>{const d=block(human(r.step)+' · drop-off evidence','HTTP failures are aggregate context, not proven causes for an individual abandonment.');d.append(table('API failures',[col('Route','route'),col('Client','client'),col('4xx','client_errors',count),col('5xx','server_errors',count)],(a?.performance??[]).filter(x=>x.client_errors||x.server_errors)));$('detail-title').textContent='Workflow evidence';$('detail-body').replaceChildren(d);$('details').showModal();})}));v.append(b);}

 v.append(table('Feature requests',[col('Route','route'),col('Method','method'),col('Requests','requests',count),col('HTTP errors','errors',count)],t.usage));v.append(note('Search query text is never stored. Zero-result rate and search-to-listing attribution are unavailable until response-level search instrumentation exists. Buyer funding/settlement funnels require indexed lifecycle event timestamps.'));

}

function marketplace(v,t,m,o){if(!o)return;append(v,table('Listing inventory',[col('Kind','kind'),col('State','status'),col('Listings','n',count),col('Recorded sales','sales',count)],o.listings),table('Orders and funded requests',[col('Kind','kind'),col('State','state'),col('Count','n',count),col('Principal','principal',money)],o.orders),button('Open order ledger',()=>void records('orders')),table('Submissions',[col('State','status'),col('Count','n',count)],o.submissions),table('Verifiers',[col('Approved','approved',v=>v?'yes':'no'),col('Providers','n',count),col('Recorded jobs completed','completed',count)],o.providers),table('Failure bounties',[col('State','status'),col('Count','n',count)],o.failureBounties));}

function solana(v,t,m,o){if(!m)return;const f=m.finance;append(v,metricList([['Settled seller allocation',money(f.settled_volume),'Derived · indexed snapshots'],['Seller proceeds',money(f.seller_proceeds),'Derived · allocation minus commission'],['Commission',money(f.commission),'Derived · recorded per-order fee basis points']]));const matched=BigInt(f.settled_volume)===BigInt(f.seller_proceeds)+BigInt(f.commission);v.append(note(`Arithmetic split: ${matched?'reconciled':'MISMATCH'}. ${f.unknown_splits} settled orders have unknown splits and are excluded. This equality does not verify current vault balances.`));

 if(o){const live=o.orders.filter(r=>!['draft','created','settled','refunded','cancelled','mismatch'].includes(r.state));append(v,metricList([['Indexed open escrow principal',money(sum(live,'principal')),'Derived · nonterminal indexed orders'],['Verifier fee obligations',money(sum(live,'verifier_fees')),'Derived · nonterminal orders; verify live before payout']]));v.append(table('Settlements by chain close date · UTC',[col('UTC date','day'),col('Settled orders','orders',count),col('Seller allocation','gross',money),col('Commission','commission',money)],o.settlements));v.append(table('Transaction index',[col('Status','status'),col('Count','n',count)],o.transactions));}

 append(v,button('Inspect settlements and contributor escrows',()=>void records('orders')),button('Inspect transaction ledger',()=>void records('transactions')),button('Check finalized vault balances',async()=>{try{const r=await request('/api/reconciliation'),b=block('Live vault reconciliation',`${r.basis} Finalized slot: ${r.finalizedSlot}. Checked ${date(r.at)}. ${r.truncated?'Only the first 100 open vaults were checked.':''}`);b.append(table('Vaults',[col('Order','id'),col('Indexed state','chain_state'),col('Expected','expected',money),col('Finalized balance','actual',money),col('Result','status'),col('Last indexed','synced_at',date)],r.rows));v.append(b);}catch(e){showError(e);}}),note('Child contributor escrows appear as individual orders with group IDs. No parent amount is added to a child payout. Finalized signature status is available from each transaction detail. The index has no durable last-indexed-slot marker.'));

}

function revenue(v,t,m,o,a){if(!m)return;const b=block('Token receipts and obligations','Mock USDC · no monetary value. Cash received, earned service revenue and profit are different measurements.');append(b,table('Paid service receipts',[col('Purpose','purpose'),col('Kind','kind'),col('Invoices','paid_invoices',count),col('Receipts','receipts',money)],m.invoices),button('Inspect service invoices',()=>void records('invoices')));v.append(b);

 if(o){v.append(table('Invoice states',[col('Kind','kind'),col('Purpose','purpose'),col('State','status'),col('Invoices','n',count),col('Amount','amount',money)],o.receipts));v.append(metricList([['Paid hosting allocations',money(o.hosting.receipts),'Derived · coverage records; may overlap invoices'],['Elapsed hosting allocation',money(o.hosting.delivered_service_allocation),'Estimated · linear elapsed portion, not a formal earned-revenue posting']]));v.append(table('Recorded provider cost events',[col('Provider','provider'),col('Service','category'),col('Unit','unit'),col('Quantity','quantity',count),col('USD cost','usd_micro',v=>money(v,'USD')),col('Evidence','estimated',v=>v?'configured estimate':'recorded actual')],o.costs));}

 if(o)v.append(table('Monthly provider cost history · UTC',[col('Month','month'),col('Provider','provider'),col('Evidence','estimated',v=>v?'estimate':'recorded actual'),col('USD cost','usd_micro',v=>money(v,'USD'))],o.monthlyCosts));
 v.append(note('Earned verification/download revenue, unused monetary credits, refundable balances and pending payouts require explicit recognition/allocation entries. They are not inferred from invoice receipts. Gross margin and operating profit remain unavailable: mock tokens cannot be subtracted from USD invoices. Zero configured provider cost does not prove free usage.'));

 const imports=block('USD expense evidence','Operator-entered invoice evidence; source verification remains your responsibility. Invoice totals can include prepayments. This independent ledger does not change marketplace balances or duplicate imports with the same evidence ID.');if(a)imports.append(table('Imported expenses',[col('Day','day'),col('Provider','provider'),col('Service','category'),col('USD amount','usd_micro',v=>money(v,'USD')),col('Evidence reference','evidence')],a.importedCosts));

 const form=el('form',undefined,'cost-form'),fields={};for(const [key,label,type] of [['id','Unique evidence ID','text'],['day','Invoice date','date'],['provider','Provider','select'],['category','Service category','select'],['usdMicro','Invoice amount · USD (e.g. 12.50)','text'],['evidence','Private invoice reference','text']]){const l=el('label',label),input=el(type==='select'?'select':'input');input.name=key;input.required=true;if(type!=='select')input.type=type;if(key==='day')input.value=new Date().toISOString().slice(0,10);if(type==='select')for(const value of key==='provider'?['aws','r2','nvidia','gemini','rpc','email','other']:['storage','compute','verification','bandwidth','other']){const op=el('option',value);op.value=value;input.append(op);}if(state.costDraft[key]!==undefined)input.value=state.costDraft[key];input.addEventListener('input',()=>{state.costDraft[key]=input.value;state.unsaved=true;});fields[key]=input;l.append(input);form.append(l);}const submit=el('button','Record invoice evidence');submit.type='submit';form.append(submit);form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{await request('/api/costs',Object.fromEntries(Object.entries(fields).map(([k,n])=>{if(k!=='usdMicro')return [k,n.value];if(!/^\d{1,9}(\.\d{1,6})?$/.test(n.value))throw Error('Enter a USD amount with at most six decimal places');const [whole,fraction='']=n.value.split('.');return [k,(BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'))).toString()];})));state.costDraft={};state.unsaved=false;await refresh();}catch(e){showError(e);submit.disabled=false;}};imports.append(form);v.append(imports);

}

function ai(v,t,m,o){if(!o)return;const n=Number(sum(o.agents,'n')),failed=o.agents.filter(r=>r.status==='failed').reduce((n,r)=>n+Number(r.n),0);v.append(note(`Assistant: ${n} attempts, ${failed} failures${n?`, ${(failed/n*100).toFixed(1)}% of all attempts`:''}. Erased/running attempts are separate. Old failures without evidence remain unclassified. Provider: NVIDIA; historical per-attempt model identities were not retained.`));

 append(v,table('Assistant attempts',[col('Task','mode'),col('Model','model'),col('State','status'),col('Failure category','reason'),col('Attempts','n',count),col('Input tokens','input_tokens',count),col('Output tokens','output_tokens',count),col('Mean latency','avg_ms',duration),col('p95 latency','p95_ms',duration)],o.agents),button('Inspect assistant attempts',()=>void records('agents')),table('Verification jobs',[col('Level','level'),col('State','status'),col('Jobs','n',count),col('Quoted','quoted',money),col('Service charged','service_charge',money),col('Reused reports','cached',count),col('Quality passed','passed',count),col('Quality failed','failed_quality',count),col('Mean queue-to-result','avg_ms',duration),col('p50','p50_ms',duration),col('p95','p95_ms',duration),col('p99','p99_ms',duration)],o.jobs),table('Verification failure reasons',[col('Category','reason'),col('Jobs','n',count)],o.failures),button('Inspect verification jobs, timeline and cost evidence',()=>void records('jobs')));

 v.append(note('Queue-to-result latency includes waiting time and differs from inference latency. L1 jobs may make no AI call. Quality pass/fail is separate from job execution success. Provider cost events carry explicit estimate flags; service charges are not provider invoices. Assistant cache-hit rate and sampled-file coverage are unavailable without additional outcome events.'));

}

function storage(v,t,m,o){if(!o)return;append(v,metricList([['Recorded finalized bytes',bytes(sum(o.storage,'bytes')),'Measured · manifests, not a bucket inventory scan'],['Active covered versions',count(o.hosting.active_versions),'Derived · at least one active interval'],['Accounted download bytes',bytes(o.delivery.accounted_bytes),'Measured · reservations and adjustments; not browser receipt'],['Remaining download capacity',bytes(o.delivery.remaining_metered_bytes),'Derived · unrevoked metered entitlements; may include expired access']]));

 append(v,table('Assets by purpose',[col('Purpose','purpose'),col('Kind','kind'),col('Versions','versions',count),col('Files','files',count),col('Size','bytes',bytes)],o.storage),table('Uploads',[col('State','status'),col('Uploads','n',count),col('Declared bytes','bytes',bytes),col('Older than 24 h','older_24h',count)],o.uploads),table('Transfer observations',[col('Event','kind'),col('Events','n',count),col('Recorded bytes','bytes',bytes)],o.transfers),note(`${o.hosting.expiring_7d} versions have a coverage interval ending within 7 days; overlapping renewals may exist. Manifest size is not Cloudflare R2 utilization. Bucket operations, orphan objects/multipart uploads, complete download proofs and storage margins need provider inventory/billing evidence. No objects are deleted by this console.`));}

function infrastructureView(v,t,m,o,a){const h=state.infrastructure;if(!h){v.append(note('Dependency probe unavailable. Refresh to retry.'));return;}const b=h.backend;append(v,table('Dependency probes',[col('Component','name'),col('Current observation','status')],[{name:'API',status:b?.ok?'ready':'unavailable'},{name:'PostgreSQL',status:h.database?'read connection succeeded':'unavailable'},{name:'Worker',status:b?.worker===true?'heartbeat healthy':b?'heartbeat unhealthy':'unavailable'},{name:'Solana',status:h.finalizedSlot!==null?'finalized slot '+h.finalizedSlot:'unavailable'}]),note(`Checked ${date(h.at)} in ${h.checkMs} ms. ${h.scope}`));if(h.host)v.append(table('Host resources',[col('Signal','signal'),col('Value','value')],[{signal:'1-minute load / CPU count',value:`${h.host.load1.toFixed(2)} / ${h.host.cpuCount}`},{signal:'Available / total RAM',value:`${bytes(h.host.memoryAvailable)} / ${bytes(h.host.memoryTotal)}`},{signal:'Available / total disk',value:`${bytes(h.host.diskAvailable)} / ${bytes(h.host.diskTotal)}`},{signal:'Host uptime',value:Math.floor(h.host.uptimeSeconds/3600)+' hours'}]));if(a)append(v,note(`API p95 latency bucket upper bound: ${a.p95UpperMs===86400000?'> 120 seconds':duration(a.p95UpperMs)}. Collection began with this upgrade. The final overflow bucket is not a useful latency estimate.`),table('API performance',[col('Route','route'),col('Client class','client'),col('Requests','requests',count),col('4xx','client_errors',count),col('5xx','server_errors',count)],a.performance));v.append(note('An authenticated session can be automated; API-key traffic is separate. Unauthenticated traffic cannot reliably be separated into people, bots or internal clients. Not connected: '+(h.unavailable??[]).join('; ')+'.'));}

function security(v,t,m,o,a){const b=block('Access boundary','A separate HTTPS hostname with a long operator password, server-side authorization and a restricted read-only marketplace database role.');append(b,note('All data and assets require operator credentials. Marketplace wallet tokens and API keys grant no access. Ingestion uses a separate secret. Writes require a same-origin custom-header request and append an audit event. The marketplace database role cannot write financial data.'),note('The console records no IPs, raw search text, prompts, wallets, private file paths or object keys. Session account tokens expire from browsing telemetry after 30 days; daily aggregates retain no browser/account identifiers. Explicit account labels and operator audit records are retained separately.'));

 v.append(b);if(a)v.append(table('Operator audit',[col('Time','at',v=>date(new Date(v))),col('Action','action'),col('Subject token / section','subject')],a.audit));v.append(note('Current authentication: shared operator credential. Per-operator identities, MFA, suspicious-IP detection, role-scoped administrative mutations and verified backup/certificate alerts are not configured. No claim of MFA or individual attribution is made. Administrative actions here are limited to account labels and independent USD evidence entries.'));

}

const renderers={overview,visitors,product,marketplace,solana,revenue,ai,storage,infrastructure:infrastructureView,security};

function render(){const key=sections[location.hash.slice(1)]?location.hash.slice(1):'overview';$('title').textContent=sections[key][0];$('subtitle').textContent=sections[key][1];for(const link of $('navigation').children)link.setAttribute('aria-current',link.hash==='#'+key?'page':'false');const v=$('view');v.replaceChildren();if(!state.overview){v.append(note('Loading private operator metrics…'));return;}const t=state.overview.telemetry,m=state.overview.marketplace,o=state.operations?.marketplace,a=state.operations?.activity;if(state.overview.marketplaceError)v.append(note(state.overview.marketplaceError,'warning'));if(state.operations?.marketplaceError)v.append(note(state.operations.marketplaceError,'warning'));renderers[key](v,t,m,o,a);v.setAttribute('aria-busy','false');}

async function refresh(){if(state.busy)return;state.busy=true;$('refresh').disabled=true;$('view').setAttribute('aria-busy','true');try{const days=$('days').value,results=await Promise.allSettled([request('/api/overview?days='+days),request('/api/operations?days='+days),request('/api/infrastructure')]);if(results[0].status==='rejected')throw results[0].reason;state.overview=results[0].value;state.operations=results[1].status==='fulfilled'?results[1].value:null;state.infrastructure=results[2].status==='fulfilled'?results[2].value:null;$('network').textContent=state.overview.network;$('status').textContent='Updated '+date(state.overview.at);$('error').hidden=true;if(results[1].status==='rejected')showError(results[1].reason);render();}catch(e){showError(e);$('status').textContent='Refresh unavailable';}finally{state.busy=false;$('refresh').disabled=false;$('view').setAttribute('aria-busy','false');}}

for(const [key,[label]] of Object.entries(sections)){const a=el('a',label);a.href='#'+key;$('navigation').append(a);}

$('refresh').onclick=()=>void refresh();$('days').onchange=()=>void refresh();$('timezone').onchange=()=>{zone=$('timezone').value;localStorage.setItem('operator_timezone',zone);render();if(state.overview)$('status').textContent='Updated '+date(state.overview.at);};$('close-details').onclick=()=>$('details').close();window.addEventListener('hashchange',render);setInterval(()=>{if(document.visibilityState==='visible'&&!$('details').open&&!state.unsaved&&!document.querySelector('form:focus-within'))void refresh();},30000);render();void refresh();
