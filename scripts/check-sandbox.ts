import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { loadConfig } from '../apps/api/src/config.js';
import { runSandboxed, stopSandboxes } from '../apps/api/src/services/sandbox.js';
process.loadEnvFile('apps/api/.env');
const cfg = loadConfig();
assert.equal(cfg.SANDBOX, 'docker');
const root = await mkdtemp(join(cfg.DATA_DIR, 'sandbox-probe-'));
const input = join(root, 'in'), output = join(root, 'out');
await mkdir(input); await mkdir(output);
try {
  execFileSync(cfg.pythonBin, ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("rows.csv","category,value\\nalpha,1\\nbeta,2\\n"); z.close()', join(input, 'dataset.zip')]);
  const original = await readFile(join(input, 'dataset.zip'));
  const run = await runSandboxed(cfg, { script: 'dataset-validator/validate.py', args: ['--input', '{in}', '--output', '{out}/report.json', '--level', 'L2'], inputDir: input, outputDir: output, timeoutMs: 30_000 });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(JSON.parse(await readFile(join(output, 'report.json'), 'utf8')).metrics.rows, 2);
  assert.deepEqual(await readFile(join(input, 'dataset.zip')), original);
  const timed = await runSandboxed(cfg, { script: 'dataset-validator/validate.py', args: ['--input', '{in}', '--output', '{out}/timeout.json'], inputDir: input, outputDir: output, timeoutMs: 1 });
  assert.equal(timed.timedOut, true);
  await stopSandboxes();
  console.log('Docker read-only archive input, writable isolated scratch, output permissions and timeout checks passed');
} finally { await rm(root, { recursive: true, force: true }); }
