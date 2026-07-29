#!/usr/bin/env node
/**
 * Screenshot harness for floppy.run games.
 *
 * Usage:
 *   node tools/shot.mjs --url http://localhost:5173/play/burnout/ --out shots/burnout \
 *        --wait 3000 --frames 4 --interval 1200 --keys "ArrowUp:hold,Shift:hold" --size 1600x900
 *
 * Conventions a game should follow so shots are useful:
 *   - set window.__READY__ = true once the first frame has rendered
 *   - (optional) expose window.__GAME__ = { seed(n), setCamera(name), pause(), step(dt) }
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]?.startsWith('--') ? 'true' : arr[i + 1]]);
    return acc;
  }, [])
);

const url = args.url || 'http://localhost:5173/';
const out = args.out || 'shots/frame';
const wait = parseInt(args.wait ?? '3000', 10);
const frames = parseInt(args.frames ?? '1', 10);
const interval = parseInt(args.interval ?? '1000', 10);
const [w, h] = (args.size || '1600x900').split('x').map(Number);
const keys = (args.keys || '').split(',').map((s) => s.trim()).filter(Boolean);
const fullPage = args.fullPage === 'true';

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--enable-webgl',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

// NOTE: page.waitForFunction runs in an isolated world in Playwright 1.62,
// where page-script globals such as window.__READY__ are NOT visible.
// Poll with evaluate (main world) instead.
async function waitForReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await page.evaluate(() => window.__READY__ === true).catch(() => false);
    if (ok) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

const ready = await waitForReady(Math.max(wait, 20000));
if (!ready) console.error('! window.__READY__ never became true (continuing anyway)');

await page.waitForTimeout(wait);

// dismiss any start overlay + focus canvas
await page.mouse.click(w / 2, h / 2).catch(() => {});
await page.waitForTimeout(400);

for (const k of keys) {
  const [key, mode] = k.split(':');
  if (mode === 'hold') await page.keyboard.down(key);
  else await page.keyboard.press(key);
}

// Capture via CDP rather than page.screenshot(): page.screenshot needs
// `animations: 'disabled'` to resolve under SwiftShader, and that freezes
// CSS-animated HUD elements at their initial state (opacity: 0), which
// silently erased every combat callout from round-1 evidence.
// CDP Page.captureScreenshot has no such stability wait.
const cdp = await page.context().newCDPSession(page);

async function captureStable(path) {
  const MIN_BYTES = 25000;
  let buf = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    buf = Buffer.from(data, 'base64');
    if (buf.length >= MIN_BYTES) break;
    console.error(`  ! blank frame (${buf.length}B) on attempt ${attempt}, retrying…`);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
    await page.waitForTimeout(500);
  }
  if (buf.length < MIN_BYTES) console.error(`  ! STILL BLANK after 6 attempts: ${path}`);
  writeFileSync(path, buf);
  return buf.length;
}

for (let i = 0; i < frames; i++) {
  if (i > 0) await page.waitForTimeout(interval);
  const path = frames === 1 ? `${out}.png` : `${out}-${String(i + 1).padStart(2, '0')}.png`;
  const bytes = await captureStable(path);
  console.log(`saved ${path} (${bytes}B)`);
}

for (const k of keys) {
  const [key, mode] = k.split(':');
  if (mode === 'hold') await page.keyboard.up(key).catch(() => {});
}

const perf = await page
  .evaluate(() => (window.__STATS__ ? window.__STATS__() : null))
  .catch(() => null);
if (perf) console.log('stats:', JSON.stringify(perf));

if (errors.length) {
  console.error(`\n${errors.length} page error(s):`);
  for (const e of errors.slice(0, 25)) console.error('  ' + e);
}

await browser.close();
