import fs from 'node:fs';
const origin = process.env.LOAD_ORIGIN ?? 'https://api.preview.13-61-207-211.sslip.io';
if (origin !== 'https://api.preview.13-61-207-211.sslip.io') throw new Error('This probe is restricted to the test deployment');
const concurrency = 5, requests = 50;
const samples = []; let failures = 0, next = 0;
const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next++ < requests) {
    const t = performance.now();
    try {
      const r = await fetch(origin + '/health/ready', { signal: AbortSignal.timeout(10_000) });
      const body = await r.json();
      if (!r.ok || !body.ok) failures++;
    } catch { failures++; }
    samples.push(performance.now() - t);
  }
}));
samples.sort((a,b) => a-b);
const report = { origin, requests: samples.length, concurrency, failures, elapsedMs: Math.round(performance.now()-started), p50Ms: Math.round(samples[Math.floor(samples.length*.5)]), p95Ms: Math.round(samples[Math.floor(samples.length*.95)]), limitations: 'Readiness endpoint only; not a marketplace write-load or production-capacity certification.' };
fs.mkdirSync('.data/operations', { recursive: true });
fs.writeFileSync('.data/operations/load-readiness.json', JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if (failures) process.exitCode = 1;
