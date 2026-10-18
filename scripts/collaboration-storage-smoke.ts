import {randomUUID,createHash} from 'node:crypto';
import {loadConfig} from '../apps/api/src/config.js';
import {createStorage} from '../apps/api/src/storage/index.js';
if(process.env.COLLABORATION_STORAGE_SMOKE!=='1')throw Error('Set COLLABORATION_STORAGE_SMOKE=1 for an explicitly authorized isolated storage probe');
const cfg=loadConfig();
if(cfg.STORAGE_DRIVER!=='r2')throw Error('This probe verifies the existing private R2 configuration');
const storage=createStorage(cfg),key=`r2/tenants/${randomUUID()}/workflow/collaboration-smoke/${randomUUID()}`;
const body=Buffer.from(`EdgeBounty private collaboration storage probe ${randomUUID()}`);
let upload:string|undefined;
try{
  await storage.put(key,body);
  const stat=await storage.stat(key);if(stat?.size!==body.length)throw Error('Stored size mismatch');
  const read=await storage.read(key);if(!read.equals(body))throw Error('Stored content mismatch');
  const range=await storage.getRange(key,0,9);const chunks=[];for await(const chunk of range)chunks.push(chunk);if(!Buffer.concat(chunks).equals(body.subarray(0,10)))throw Error('Range mismatch');
  upload=await storage.initMultipart(`${key}-interrupted`);
  await storage.putPart(`${key}-interrupted`,upload,1,body);
  await storage.abortMultipart(`${key}-interrupted`,upload);upload=undefined;
  console.log(JSON.stringify({privateR2:true,put:true,stat:true,read:true,range:true,interruptedMultipartAborted:true,sha256:createHash('sha256').update(body).digest('hex'),bytes:body.length}));
}finally{
  if(upload)await storage.abortMultipart(`${key}-interrupted`,upload);
  await storage.delete(key);
  if(await storage.stat(key))throw Error('Probe object cleanup failed');
}
