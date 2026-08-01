#!/usr/bin/env node
// scratch: grab a few screenshots
import { chromium } from 'playwright';
const shots = process.argv[2] || 'a';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
await page.goto('http://localhost:5173/play/burnout/', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) {
  if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break;
  await page.waitForTimeout(100);
}
await page.mouse.click(550, 320);
await page.waitForTimeout(2500);
await page.screenshot({ path: `.scratch-burnout/shot-${shots}-drive.png` });
await page.evaluate(() => window.__CRASHOUT__.forceEvent('boost'));
await page.waitForTimeout(900);
await page.screenshot({ path: `.scratch-burnout/shot-${shots}-boost.png` });
await page.evaluate(() => window.__CRASHOUT__.forceEvent('takedown'));
await page.waitForTimeout(900);
await page.screenshot({ path: `.scratch-burnout/shot-${shots}-takedown.png` });
await page.waitForTimeout(1400);
await page.screenshot({ path: `.scratch-burnout/shot-${shots}-takedown2.png` });
console.log('progs', await page.evaluate(() => window.__CRASHOUT__.renderer.info.programs.length));
console.log('stats', JSON.stringify(await page.evaluate(() => window.__STATS__())));
await browser.close();
