/** Live staged demo: wallet sign-in -> R2 upload -> paid verification -> USDC sale -> Worker ranges. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { EdgeBountyClient } from '@edgebounty/blockchain-client';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
const API = process.env.INTEGRATION_API ?? 'https://api.preview.13-61-207-211.sslip.io';
if (!API.includes('api.preview.13-61-207-211.sslip.io')) throw new Error('Only the isolated mock-USDC preview is supported');
const body = Buffer.from('category,value\nalpha,1\nbeta,2\n');
const digest = createHash('sha256').update(body).digest('hex');
const level = process.env.INTEGRATION_LEVEL === 'L3' ? 'L3' : 'L2';
const hex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));
const request = async (method: string, path: string, token?: string, payload?: unknown) => {
  const r = await fetch(API + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(payload === undefined ? {} : { 'content-type': 'application/json' }) }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal: AbortSignal.timeout(60_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path.split('/download/')[0]} failed (${r.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text);
};
const cfg = await request('GET', '/config');
assert.equal(cfg.currency, 'USDC'); assert.equal(cfg.feeBps, 600); assert.equal(cfg.paymentReady, true);
const client = new EdgeBountyClient(new Connection('https://rpc.preview.13-61-207-211.sslip.io', 'confirmed'), new PublicKey(cfg.programId));
const actor = async () => {
  const kp = Keypair.generate(), wallet = kp.publicKey.toBase58();
  const ch = await request('POST', '/auth/challenge', undefined, { wallet });
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey));
  const auth = await request('POST', '/auth/verify', undefined, { wallet, nonce: ch.nonce, signature });
  const funds = await request('POST', '/dev/faucet', auth.token, { wallet });
  assert.equal(funds.mockUsdc, 1000);
  return { kp, token: auth.token };
};
const { readFile, writeFile, mkdir } = await import('node:fs/promises');
const user = await actor();
const genesis = await client.connection.getGenesisHash();
if (genesis === '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('Mainnet prohibited');
const results = [];
for (const name of ['good', 'bad', 'corrupt']) {
 const bytes = await readFile(`.data/ai-image-demo/${name}.png`);
 const {version} = await request('POST','/assets',user.token,{kind:'dataset',name:`Synthetic ${name} image test`,purpose:'verification'});
 const up = await request('POST',`/versions/${version.id}/uploads`,user.token,{path:`${name}.png`,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mediaType:'image/png'});
 const signed = await request('POST',`/uploads/${up.uploadId}/parts/1/url`,user.token,{md5:createHash('md5').update(bytes).digest('base64')});
 assert.equal((await fetch(signed.url,{method:'PUT',headers:signed.headers,body:bytes})).status,200);
 await request('POST',`/uploads/${up.uploadId}/complete`,user.token,{});
 await request('POST',`/versions/${version.id}/finalize`,user.token,{});
 const job = await request('POST','/verification/jobs',user.token,{assetVersionId:version.id,level:'L3',criteria:{kind:'image_dataset',minImages:1,minWidth:64,minHeight:64,minReadableBps:10000,minRelevanceBps:1000,relevancePrompt:'The image must depict a blue filled square on a white background. Red circles are irrelevant and must be rejected.'}});
 let signature = null, fee = null;
 if(job.invoice){
  signature = await client.send(await client.payService(user.kp.publicKey,hex(job.invoice.reference),job.invoice.serviceKind,BigInt(job.invoice.amountMicro)),[user.kp]);
  await request('POST',`/invoices/${job.invoice.id}/confirm`,user.token,{});
  fee = (await client.connection.getTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:0}))?.meta?.fee;
 }
 const deadline=Date.now()+360000;
 for(;;){
  const report=await request('GET',`/verification/jobs/${job.job.id}`,user.token);
  if(report.status==='completed'){
   const result={name,versionId:version.id,jobId:job.job.id,invoiceAmount:job.invoice?.amountMicro??'0',paymentSignature:signature,networkFeeLamports:fee,...report.result};
   results.push(result); console.log(JSON.stringify({name,passed:result.passed,relevance:result.report.datasetMetrics?.relevance,findings:result.report.findings,limitations:result.report.limitations}));break;
  }
  if(report.status==='failed'||Date.now()>deadline) throw new Error(`Image check ${name}: ${report.status} ${report.error??''}`);
  await new Promise(r=>setTimeout(r,2000));
 }
}
await mkdir('.data/ai-image-demo',{recursive:true});
await writeFile('.data/ai-image-demo/results.json',JSON.stringify({genesis,wallet:user.kp.publicKey.toBase58(),currency:'mock USDC',results},null,2));
console.log('Saved complete reports and test-chain payment receipts');
