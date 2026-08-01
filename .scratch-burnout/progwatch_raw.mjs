#!/usr/bin/env node
// scratch: watch program count grow over time + correlate with light counts
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
page.on('console', (m) => { if (m.text().startsWith('#PROG')) console.log(m.text()); });
await page.addInitScript(() => {
  window.__WATCH__ = () => {
    const g = window.__CRASHOUT__;
    if (!g) return;
    const r = g.renderer;
    let last = -1;
    const count = () => {
      const lights = { dir: 0, point: 0, spot: 0, hemi: 0, dirS: 0, pointS: 0, spotS: 0 };
      g.scene.traverse((o) => {
        if (!o.isLight || !o.visible) return;
        if (o.isDirectionalLight) { lights.dir++; if (o.castShadow) lights.dirS++; }
        else if (o.isPointLight) { lights.point++; if (o.castShadow) lights.pointS++; }
        else if (o.isSpotLight) { lights.spot++; if (o.castShadow) lights.spotS++; }
        else if (o.isHemisphereLight) lights.hemi++;
      });
      const n = r.info.programs.length;
      if (n !== last) {
        console.log('#PROG', performance.now().toFixed(0), 'progs=' + n, JSON.stringify(lights));
        last = n;
      }
      requestAnimationFrame(count);
    };
    count();
  };
});
await page.goto('http://localhost:5173/play/burnout/?post=raw', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) {
  if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break;
  await page.waitForTimeout(100);
}
await page.evaluate(() => window.__WATCH__());
await page.waitForTimeout(12000);
await browser.close();
