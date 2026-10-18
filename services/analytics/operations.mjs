import { loadavg,totalmem,freemem,uptime,cpus } from 'node:os';
import { statfs } from 'node:fs/promises';
import { PublicKey } from '@solana/web3.js';
const api='http://127.0.0.1:4003';
async function json(url,options={}) {const r=await fetch(url,{...options,signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error('Dependency unavailable');return r.json();}
async function rpc(method,params=[]) {const body=await json(process.env.ANALYTICS_RPC_URL??'http://127.0.0.1:8901',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});if(body.error)throw Error('RPC request failed');return body.result;}
export async function infrastructure(pool) {
 const start=Date.now();const checks=await Promise.allSettled([json(api+'/health/ready'),rpc('getSlot',[{commitment:'finalized'}]),pool.query('SELECT 1'),statfs('.')]);
 const [backend,slot,db,disk]=checks,fs=disk.status==='fulfilled'?disk.value:null;
 return {at:new Date().toISOString(),checkMs:Date.now()-start,backend:backend.status==='fulfilled'?backend.value:null,finalizedSlot:slot.status==='fulfilled'?slot.value:null,database:db.status==='fulfilled',
 host:{cpuCount:cpus().length,load1:loadavg()[0],memoryTotal:totalmem(),memoryAvailable:freemem(),uptimeSeconds:uptime(),diskTotal:fs?fs.blocks*fs.bsize:null,diskAvailable:fs?fs.bavail*fs.bsize:null},
 unavailable:['R2 invoice and request telemetry','Email delivery and bounce telemetry','Backup verification and age','Certificate expiry','PostgreSQL slow-query traces'],
 scope:'Host samples and a current dependency probe, not an uptime history or availability SLA.'};
}
export async function reconcileVaults(pool) {
 const config=await json(api+'/config');if(!config.programId||!config.paymentMint)throw Error('Chain configuration unavailable');
 const result=await pool.query(`SELECT id,onchain_address,chain_state,amount_micro::text,verifier_fee_micro::text,synced_at FROM analytics_operator_orders WHERE chain_state NOT IN ('draft','created','settled','refunded','cancelled','mismatch') ORDER BY created_at DESC LIMIT 101`);
 const rows=result.rows.slice(0,100), program=new PublicKey(config.programId);
 const addresses=rows.map(o=>PublicKey.findProgramAddressSync([Buffer.from('vault'),new PublicKey(o.onchain_address).toBuffer()],program)[0].toBase58());
 const live=addresses.length?await rpc('getMultipleAccounts',[addresses,{encoding:'jsonParsed',commitment:'finalized'}]):{context:{slot:await rpc('getSlot',[{commitment:'finalized'}])},value:[]};
 return {at:new Date().toISOString(),programId:config.programId,paymentMint:config.paymentMint,finalizedSlot:live.context.slot,truncated:result.rows.length>100,
  basis:'Finalized token vault balances compared with indexed order principal + verifier fee. Order lifecycle snapshots can lag; investigate mismatches before treating them as losses.',
  rows:rows.map((o,i)=>{const a=live.value[i],info=a?.data?.parsed?.info;const tokenProgram='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';const verified=a?.owner===tokenProgram&&info?.mint===config.paymentMint&&/^\d+$/.test(info?.tokenAmount?.amount??'');const actual=verified?info.tokenAmount.amount:null;const expected=(BigInt(o.amount_micro)+BigInt(o.verifier_fee_micro)).toString();return {...o,vault:addresses[i],expected,actual,status:actual===null?'unavailable':BigInt(actual)===BigInt(expected)?'matched':'mismatch'};})};
}
export async function transactionFinality(signature) {
 if(!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature))throw Error('Invalid transaction signature');
 const r=await rpc('getSignatureStatuses',[[signature],{searchTransactionHistory:true}]);const value=r.value[0];return {signature,slot:value?.slot??null,confirmationStatus:value?.confirmationStatus??'not_found',failed:value?value.err!==null:null,checkedAt:new Date().toISOString()};
}
