import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { join } from 'node:path';
import { loadConfig } from '../apps/api/src/config.js';
import { createStorage } from '../apps/api/src/storage/index.js';

process.loadEnvFile('apps/api/.env');
const cfg = loadConfig();
const dir = join(cfg.DATA_DIR, 'operations');
await mkdir(dir, { recursive: true, mode: 0o700 });
const keyFile = join(dir, 'backup-encryption.key');
if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' });
const key = readFileSync(keyFile);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = join(dir, `postgres-${stamp}.dump.gz.enc`);
const iv = randomBytes(12);
writeFileSync(file, Buffer.concat([Buffer.from('EBDB01'), iv]), { mode: 0o600, flag: 'wx' });
const cipher = createCipheriv('aes-256-gcm', key, iv);
const dump = spawn('sudo', ['-n', 'docker', 'exec', 'edgebounty-postgres', 'pg_dump', '-U', 'edgebounty', '-d', 'edgebounty_usdc', '-Fc', '--no-owner', '--no-acl'], { stdio: ['ignore', 'pipe', 'pipe'] });
const completion = new Promise<void>((resolve, reject) => {
  dump.on('error', reject);
  dump.on('close', code => code === 0 ? resolve() : reject(new Error(`pg_dump failed (${code})`)));
});
dump.stderr.resume();
await Promise.all([pipeline(dump.stdout, createGzip(), cipher, createWriteStream(file, { flags: 'a' })), completion]);
writeFileSync(file, cipher.getAuthTag(), { flag: 'a' });
const objectKey = `${cfg.STORAGE_DRIVER === 'r2' ? 'r2/' : ''}operations/backups/postgres-${stamp}.dump.gz.enc`;
const storage = createStorage(cfg);
await storage.put(objectKey, createReadStream(file));
console.log(JSON.stringify({ backup: objectKey, encryptedBytes: statSync(file).size, keyStoredSeparately: true }));

if (process.argv.includes('--restore-drill')) {
  // Verify the stored object, not merely the local pre-upload copy.
  const fetched = `${file}.downloaded`;
  await storage.materialize(objectKey, fetched);
  const size = statSync(fetched).size;
  const { open } = await import('node:fs/promises');
  const handle = await open(fetched, 'r');
  const header = Buffer.alloc(18);
  await handle.read(header, 0, 18, 0);
  if (header.subarray(0, 6).toString() !== 'EBDB01') throw new Error('Invalid backup envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(6));
  const tag = Buffer.alloc(16);
  await handle.read(tag, 0, 16, size - 16);
  await handle.close();
  decipher.setAuthTag(tag);
  const drillDb = `edgebounty_restore_${Date.now()}`;
  const docker = (args: string[]) => execFileSync('sudo', ['-n', 'docker', 'exec', 'edgebounty-postgres', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  docker(['createdb', '-U', 'edgebounty', drillDb]);
  try {
    const restore = spawn('sudo', ['-n', 'docker', 'exec', '-i', 'edgebounty-postgres', 'pg_restore', '-U', 'edgebounty', '-d', drillDb, '--no-owner', '--no-acl', '--exit-on-error'], { stdio: ['pipe', 'ignore', 'pipe'] });
    restore.stderr.resume();
    const restored = new Promise<void>((resolve, reject) => {
      restore.on('error', reject);
      restore.on('close', code => code === 0 ? resolve() : reject(new Error(`pg_restore failed (${code})`)));
    });
    await Promise.all([pipeline(createReadStream(fetched, { start: 18, end: size - 17 }), decipher, createGunzip(), restore.stdin), restored]);
    const query = `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
    const tables = docker(['psql', '-U', 'edgebounty', '-d', drillDb, '-Atc', query]).trim().split('\n');
    for (const table of tables) {
      if (!/^[a-z_]+$/.test(table)) throw new Error('Unexpected table name');
      const sql = `SELECT count(*) FROM public."${table}"`;
      const restoredCount = docker(['psql', '-U', 'edgebounty', '-d', drillDb, '-Atc', sql]);
      const liveCount = docker(['psql', '-U', 'edgebounty', '-d', 'edgebounty_usdc', '-Atc', sql]);
      if (restoredCount !== liveCount) throw new Error(`Restore count differs for ${table}; concurrent writes may require a new drill`);
    }
    console.log(`Restore drill passed: authenticated decryption, pg_restore, ${tables.length} table counts verified`);
  } finally {
    docker(['dropdb', '-U', 'edgebounty', drillDb]);
    await rm(fetched, { force: true });
  }
}
// Keep a bounded local encrypted copy; durable backups remain in private object storage.
await rm(file, { force: true });
