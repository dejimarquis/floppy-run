#!/usr/bin/env node
// scratch: map each scene material -> its compiled program cacheKey, group by owner
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
await page.goto('http://localhost:5173/play/burnout/', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) {
  if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break;
  await page.waitForTimeout(200);
}
await page.waitForTimeout(2500);
const out = await page.evaluate(() => {
  const g = window.__CRASHOUT__;
  const r = g.renderer;
  const props = r.properties;
  const rows = [];
  const seen = new Set();
  const path = (o) => { const a = []; let c = o; while (c && a.length < 8) { a.unshift(c.name || c.type); c = c.parent; } return a.join('/'); };
  g.scene.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      if (seen.has(m.uuid)) continue; seen.add(m.uuid);
      const mp = props.get(m);
      const keys = [];
      if (mp && mp.programs) for (const k of mp.programs.keys()) keys.push(k);
      rows.push({ owner: path(o), type: m.type, name: m.name || '', keys });
    }
  });
  return { rows, total: r.info.programs.length };
});
console.log('total programs:', out.total);
// group: cacheKey -> owners
const byKey = new Map();
for (const r of out.rows) for (const k of r.keys) {
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(r.owner + ' [' + r.type + (r.name ? ':' + r.name : '') + ']');
}
console.log('distinct material-derived keys:', byKey.size);
// summarise owners
const ownerCount = new Map();
for (const [k, owners] of byKey) {
  const tag = owners[0].replace(/[0-9]+/g, '#');
  ownerCount.set(tag, (ownerCount.get(tag) || 0) + 1);
}
[...ownerCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).forEach(([t, c]) => console.log(String(c).padStart(4), t));
await browser.close();
