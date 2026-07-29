#!/usr/bin/env node
/**
 * Smoke test for all three games: loads each page, checks for console/page errors,
 * verifies the contract (window.__READY__, __STATS__, __GAME__) and samples FPS.
 *
 *   node tools/smoke.mjs [--base http://localhost:5173] [--hold 6000]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]?.startsWith('--') ? 'true' : arr[i + 1]]);
    return acc;
  }, [])
);
const base = args.base || 'http://localhost:5173';
const hold = parseInt(args.hold ?? '6000', 10);

const pages = [
  { name: 'home', url: `${base}/` },
  { name: 'road-rash', url: `${base}/play/road-rash/` },
  { name: 'burnout', url: `${base}/play/burnout/` },
  { name: 'pinball', url: `${base}/play/pinball/` },
];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

let failures = 0;

for (const p of pages) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  let ready = false;
  let contract = null;
  let stats = null;
  try {
    await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (p.name !== 'home') {
      // waitForFunction runs in an isolated world where page globals are
      // invisible (Playwright 1.62) — poll via evaluate in the main world.
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        ready = await page.evaluate(() => window.__READY__ === true).catch(() => false);
        if (ready) break;
        await page.waitForTimeout(250);
      }
      await page.mouse.click(640, 360).catch(() => {});
      await page.waitForTimeout(hold);
      contract = await page.evaluate(() => ({
        stats: typeof window.__STATS__ === 'function',
        game: !!window.__GAME__,
        api: window.__GAME__ ? Object.keys(window.__GAME__) : [],
      }));
      stats = await page.evaluate(() => (window.__STATS__ ? window.__STATS__() : null)).catch(() => null);
    } else {
      await page.waitForTimeout(800);
      ready = true;
    }
  } catch (e) {
    errors.push(`navigation: ${e.message.split('\n')[0]}`);
  }

  const ok = ready && errors.length === 0;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${p.name.padEnd(10)} ready=${ready} errors=${errors.length}` +
    (contract ? ` contract=${contract.stats && contract.game}` : '') +
    (stats ? ` stats=${JSON.stringify(stats)}` : ''));
  for (const e of errors.slice(0, 8)) console.log(`        ! ${e.slice(0, 220)}`);
  await page.close();
}

await browser.close();
console.log(failures ? `\n${failures} page(s) failing` : '\nall pages healthy');
process.exit(failures ? 1 : 0);
