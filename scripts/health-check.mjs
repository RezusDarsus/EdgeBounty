import fs from 'node:fs';
let response, state;
try {
  response = await fetch('http://127.0.0.1:4003/health/ready', { signal: AbortSignal.timeout(15_000) });
  state = await response.json();
} catch {
  state = { ok: false, database: false, chain: false, worker: false, error: 'Readiness endpoint unavailable' };
}
const disk = fs.statfsSync('.');
const freeBytes = disk.bavail * disk.bsize;
const status = { checkedAt: new Date().toISOString(), ...state, freeBytes, diskWarning: freeBytes < 2 * 1024 ** 3 };
fs.mkdirSync('.data/operations', { recursive: true, mode: 0o700 });
fs.writeFileSync('.data/operations/health.json', JSON.stringify(status), { mode: 0o600 });
if (!response?.ok || !state.ok || freeBytes < 512 * 1024 ** 2) { console.error(JSON.stringify(status)); process.exitCode = 1; }
else console.log(JSON.stringify(status));
