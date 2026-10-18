const $=id=>document.getElementById(id);
const count=value=>value===null||value===undefined?'—':BigInt(value).toLocaleString();
const words=value=>String(value).replaceAll('_',' ');
function money(value,currency){if(value===undefined||value===null)return '—';const n=BigInt(value),decimals=currency==='SOL'?9:6,scale=10n**BigInt(decimals);return `${(n/scale).toLocaleString()}.${(n%scale).toString().padStart(decimals,'0')} ${currency}`;}
function rows(id,values,width,empty='No activity recorded in this window.'){
 const body=$(id);body.replaceChildren();
 if(!values.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=width;td.className='empty';td.textContent=empty;tr.append(td);body.append(tr);return;}
 for(const value of values){const tr=document.createElement('tr');for(const cell of value){const td=document.createElement('td');td.textContent=String(cell);tr.append(td);}body.append(tr);}
}
let busy=false;
async function refresh(){
 if(busy)return;busy=true;$('refresh').disabled=true;
 try{
  const response=await fetch(`/api/overview?days=${$('days').value}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`Dashboard request failed (${response.status}).`);
  const data=await response.json(),t=data.telemetry,m=data.marketplace;
  $('network').textContent=data.network;
  $('active-guests').textContent=count(t.active.guests);$('active-registered').textContent=count(t.active.registered);
  $('visitor-total').textContent=`${count(t.visitors.browsers)} distinct browsers`;
  $('tracking-start').textContent=`Tracking began ${new Date(t.startedAt).toLocaleString()}. Historical traffic is not backfilled. Activity dates below use UTC.`;
  rows('daily',t.daily.map(d=>[d.day,count(d.browsers),count(d.registered)]),3);
  rows('pages',t.pages.map(p=>[words(p.page),count(p.views)]),2);
  rows('usage',t.usage.map(u=>[u.route,u.method,count(u.requests),count(u.errors)]),4);
  $('registered').textContent=count(m?.accounts.registered);$('registered-today').textContent=count(m?.accounts.registered_today);
  $('marketplace-error').hidden=!data.marketplaceError;$('marketplace-error').textContent=data.marketplaceError??'';
  if(m){
   $('account-note').textContent=`${count(m.accounts.ever_registered)} accounts created in total · ${count(m.accounts.deleted)} deleted · ${count(m.accounts.signed_in_24h)} signed in during the last 24 hours. Includes operator/demo accounts. Browser counts estimate activity, not verified people.`;
   $('volume').textContent=money(m.finance.settled_volume,data.currency);$('commission').textContent=money(m.finance.commission,data.currency);$('seller').textContent=money(m.finance.seller_proceeds,data.currency);
   $('settlement-note').textContent=`${count(m.finance.settled_orders)} settled orders; ${count(m.finance.unknown_splits)} missing fee splits excluded from monetary totals. Derived from indexed chain snapshots, not live wallet balances or net profit.`;
   rows('invoices',m.invoices.map(i=>[`${words(i.purpose)} · ${i.kind}`,count(i.paid_invoices),money(i.receipts,data.currency)]),3,'No paid service invoices recorded.');
   rows('orders',m.orders.map(o=>[words(o.state),count(o.n)]),2,'No orders recorded.');
   rows('ai',m.ai.map(a=>[words(a.status),count(a.n)]),2,'No AI attempts in the last 24 hours.');
   $('download-note').textContent=`${count(m.downloads.accounted_bytes)} cumulative download bytes accounted. Reservations are not proof that every browser completed its transfer.`;
  }else{
   for(const id of ['volume','commission','seller'])$(id).textContent='—';
   for(const [id,width] of [['invoices',3],['orders',2],['ai',2]])rows(id,[],width,'Marketplace data unavailable.');
   $('account-note').textContent='Registration totals are temporarily unavailable.';$('settlement-note').textContent='Accounting data unavailable.';$('download-note').textContent='Download accounting unavailable.';
  }
  $('error').hidden=true;$('status-dot').classList.add('live');$('status').textContent=`Updated ${new Date(data.at).toLocaleTimeString()}`;
 }catch(error){$('error').hidden=false;$('error').textContent=`${error.message} Previously shown values may be stale.`;$('status-dot').classList.remove('live');$('status').textContent='Update unavailable';}
 finally{busy=false;$('refresh').disabled=false;}
}
$('refresh').addEventListener('click',refresh);$('days').addEventListener('change',refresh);
setInterval(()=>{if(document.visibilityState==='visible')void refresh();},30000);void refresh();
