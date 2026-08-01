#!/usr/bin/env node
// scratch diagnostic: dump renderer program cache keys for burnout
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
await page.goto('http://localhost:5173/play/burnout/', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 30000) {
  if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break;
  await page.waitForTimeout(200);
}
await page.waitForTimeout(1500);
const out = await page.evaluate(() => {
  const g = window.__CRASHOUT__;
  const r = g.renderer;
  const progs = r.info.programs.map((p) => p.cacheKey);
  // material census
  const counts = {};
  const byType = {};
  g.scene.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      byType[m.type] = (byType[m.type] || 0) + 1;
      counts[m.uuid] = m;
    }
  });
  return { n: progs.length, progs, byType, uniqueMats: Object.keys(counts).length };
});
console.log('programs:', out.n, 'uniqueMats:', out.uniqueMats);
console.log('byType:', JSON.stringify(out.byType, null, 1));
// group cache keys by a normalized signature
const sig = {};
for (const k of out.progs) {
  const parts = k.split(',');
  const s = parts.slice(0, 1).join('|');
  sig[s] = (sig[s] || 0) + 1;
}
console.log(JSON.stringify(sig, null, 1));
import fs from 'node:fs';
fs.writeFileSync(new URL('./progdump.txt', import.meta.url), out.progs.join('\n'));
await browser.close();
