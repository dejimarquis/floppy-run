#!/usr/bin/env node
// scratch: boot phase timing
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
page.on('console', (m) => { const t = m.text(); if (t.startsWith('[boot]') || t.startsWith('#')) console.log(t); });
const t0 = Date.now();
await page.goto('http://localhost:5173/play/burnout/', { waitUntil: 'domcontentloaded' });
while (Date.now() - t0 < 40000) {
  if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break;
  await page.waitForTimeout(50);
}
console.log('READY at', Date.now() - t0, 'ms');
console.log(JSON.stringify(await page.evaluate(() => window.__BOOT__)));
console.log(JSON.stringify(await page.evaluate(() => ({
  nav: performance.getEntriesByType('navigation').map((e) => ({ dcl: Math.round(e.domContentLoadedEventEnd), load: Math.round(e.loadEventEnd) })),
  marks: performance.getEntriesByType('mark').map((m) => [m.name, Math.round(m.startTime)]),
  progs: window.__CRASHOUT__.renderer.info.programs.length,
}))));
await browser.close();
