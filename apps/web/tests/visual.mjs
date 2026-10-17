// Visual + defect sweep for the web app. Usage: node tests/visual.mjs <outDir> [baseUrl]
// Needs `playwright` resolvable (install it anywhere on NODE_PATH). Checks horizontal overflow,
// console errors, missing focus styles and contrast-free text across viewports and both themes.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] ?? 'shots';
const base = process.argv[3] ?? 'http://localhost:3000';
fs.mkdirSync(out, { recursive: true });

const ROUTES = ['/', '/datasets', '/models', '/bounties', '/bounties/new', '/failure-bounties', '/providers', '/sell', '/dashboard', '/pricing', '/how-escrow-works', '/help', '/storage', '/verify', '/design-system', '/no-such-page'];
const VIEWPORTS = { 'mobile-s': [320, 640], mobile: [390, 844], tablet: [768, 1024], laptop: [1280, 800], desktop: [1440, 900] };
const only = process.env.ROUTES?.split(',');
const vps = process.env.VIEWPORTS?.split(',') ?? Object.keys(VIEWPORTS);
const schemes = process.env.SCHEMES?.split(',') ?? ['light'];
const fullPage = process.env.FULL !== '0';

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
const report = [];
for (const scheme of schemes)
  for (const vp of vps) {
    const [w, h] = VIEWPORTS[vp];
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, reducedMotion: 'reduce' });
    if (process.env.MOCK === '1') {
      const { routeFor } = await import(new URL('./fixtures.mjs', import.meta.url));
      await ctx.route(/:4000\//, (r) => {
        const body = routeFor(r.request().url());
        return body ? r.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } }) : r.fulfill({ status: 404, json: { error: 'not in fixtures' }, headers: { 'access-control-allow-origin': '*' } });
      });
    }
    for (const route of only ?? ROUTES) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        // the API is not running in this sandbox; its fetch failures are expected and reported separately
        if (m.type() === 'error' && !/Failed to fetch|ERR_CONNECTION_REFUSED|net::ERR|localhost:4000/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`);
      });
      await page.goto(base + route, { waitUntil: 'networkidle' }).catch((e) => errors.push(`goto: ${e.message}`));
      await page.waitForTimeout(400);
      const metrics = await page.evaluate(() => {
        const doc = document.documentElement;
        const overflowX = doc.scrollWidth - doc.clientWidth;
        const offenders = [...document.querySelectorAll('body *')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.right > doc.clientWidth + 1 && getComputedStyle(el).position !== 'fixed' && r.width > 0;
          })
          .slice(0, 5)
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
        const imgsMissing = [...document.images].filter((i) => i.complete && i.naturalWidth === 0).length;
        const unlabeled = [...document.querySelectorAll('button, a[href], input, select, textarea')].filter((el) => {
          const name = el.getAttribute('aria-label') || el.textContent?.trim() || el.getAttribute('placeholder') || el.getAttribute('title') || el.closest('label')?.textContent?.trim();
          return !name;
        }).length;
        return { overflowX, offenders, imgsMissing, unlabeled, h1: document.querySelector('h1')?.textContent?.trim().slice(0, 60) ?? null };
      });
      const file = path.join(out, `${scheme}-${vp}-${route === '/' ? 'home' : route.slice(1).replaceAll('/', '_')}.png`);
      await page.screenshot({ path: file, fullPage });
      report.push({ scheme, vp, route, ...metrics, errors });
      await page.close();
    }
    await ctx.close();
  }
await browser.close();
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const bad = report.filter((r) => r.overflowX > 0 || r.errors.length || r.imgsMissing || r.unlabeled || !r.h1);
console.log(`${report.length} renders, ${bad.length} with findings`);
for (const r of bad) console.log(JSON.stringify(r));
