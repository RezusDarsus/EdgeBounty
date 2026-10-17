// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright package (no download required).
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = resolve(process.argv[2] || 'docs/evidence/ui-2026-10-18');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
// Exercise a real wallet challenge against the disposable API; no financial transaction.
const { Keypair } = require('@solana/web3.js');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default;
const kp = Keypair.generate();
const wallet = kp.publicKey.toBase58();
const post = async (path, body) => {
  const r = await fetch(`http://127.0.0.1:4000${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Local auth failed: ${r.status}`);
  return r.json();
};
const challenge = await post('/auth/challenge', { wallet });
const auth = await post('/auth/verify', { wallet, nonce: challenge.nonce, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), kp.secretKey)) });
const results = [];
try {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    for (const route of ['/', '/datasets', '/bounties/new', '/design-system']) {
      const page = await context.newPage();
      if (route === '/bounties/new') await page.addInitScript(token => localStorage.setItem('eb_token', token), auth.token);
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const response = await page.goto(`http://localhost:3000${route}`, { waitUntil: 'networkidle', timeout: 120000 });
      if (route === '/') {
        await page.getByRole('textbox', { name: 'Dataset subject' }).fill('Georgian speech');
        await page.getByRole('button', { name: 'Find listings' }).click();
        await page.getByText('No matching public listings.').waitFor();
      }
      if (route === '/bounties/new') {
        await page.getByText('Draft requirements with AI').click();
        await page.getByText('AI drafting is currently unavailable.').waitFor();
      }
      const measurements = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        h1: document.querySelector('h1')?.textContent,
        theme: document.documentElement.dataset.theme || 'light',
        brokenImages: [...document.images].filter(i => i.complete && !i.naturalWidth).length,
      }));
      const file = `${name}-${route === '/' ? 'home' : route.slice(1).replaceAll('/', '-')}.png`;
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: resolve(out, file), fullPage: true });
      results.push({ name, route, status: response.status(), ...measurements, errors, screenshot: file });
      await page.close();
    }
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(resolve(out, 'report.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
if (results.some(r => r.status !== 200 || r.overflow > 0 || r.errors.length || r.brokenImages || !r.h1)) process.exitCode = 1;
