import { it,expect } from 'vitest';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createDb } from '../../apps/api/src/db/index.js';
import { loadConfig } from '../../apps/api/src/config.js';
import { collaborationFixture } from '../fixtures/collaboration.js';

it('runs the real image validator and detects identical photos across sellers',async()=>{
  const cfg=loadConfig(),dir=await mkdtemp(join(tmpdir(),'edgebounty-collaboration-')),store=await createDb({memory:true});
  try{
    // Valid PNG generated and decoded with the existing Pillow runtime, then copied byte for byte.
    const a=join(dir,'a'),b=join(dir,'b');await mkdir(a);await mkdir(b);
    const generated=spawnSync(cfg.pythonBin,['-c',"from PIL import Image; import sys; im=Image.new('RGB',(32,32)); im.putdata([(x*7%256,x*11%256,x*17%256) for x in range(1024)]); im.save(sys.argv[1])",join(a,'cat.png')],{encoding:'utf8'});
    expect(generated.status,generated.stderr).toBe(0);
    const bytes=await readFile(join(a,'cat.png'));await writeFile(join(b,'copy.png'),bytes);
    const validate=async(input:string,name:string)=>{
      const output=join(dir,`${name}.json`);
      const run=spawnSync(cfg.pythonBin,[join(cfg.repoRoot,'services/dataset-validator/validate.py'),'--input',input,'--output',output,'--level','L2'],{encoding:'utf8'});
      expect(run.status,run.stderr).toBe(0);
      return JSON.parse(await readFile(output,'utf8'));
    };
    const first=await validate(a,'first'),second=await validate(b,'second');
    expect(first.collaborationItems).toHaveLength(1);
    expect(first.collaborationItems[0].sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(first.collaborationItems[0].dhash).toMatch(/^[0-9a-f]{16}$/);
    expect(first.metrics).not.toHaveProperty('_collaborationItems');
    const f=await collaborationFixture(store.db,10),sa=await f.submission(f.giorgi),sb=await f.submission(f.nika);
    await f.service.applyEvidence(f.id,sa.id,first.collaborationItems,'real-validator/1',false);
    await f.service.applyEvidence(f.id,sb.id,second.collaborationItems,'real-validator/1',false);
    const p=(await f.service.snapshot(f.id,f.buyer.id)).progress;
    expect(p.accepted).toBe(0);expect(p.pending).toBe(1);expect(p.duplicates).toBe(1);
  }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});
