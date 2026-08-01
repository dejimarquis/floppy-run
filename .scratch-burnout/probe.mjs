#!/usr/bin/env node
// scratch: probe what is blowing out the road
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
await page.goto('http://localhost:5173/play/burnout/', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) {
  if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break;
  await page.waitForTimeout(100);
}
await page.evaluate(() => { window.__CRASHOUT__.hud.hideTitle(); });
await page.waitForTimeout(1200);
await page.screenshot({ path: '.scratch-burnout/probe-0-base.png' });

// read back the HDR value under the road by rendering the sceneRT raw
const info = await page.evaluate(() => {
  const g = window.__CRASHOUT__;
  const r = g.renderer;
  const rt = g.post.sceneRT;
  // read a pixel from the scene RT (below centre = road)
  const w = rt.width, h = rt.height;
  const buf = new Float32Array(4);
  const out = {};
  try {
    r.readRenderTargetPixels(rt, Math.floor(w * 0.5), Math.floor(h * 0.30), 1, 1, buf);
    out.roadHDR = [...buf];
  } catch (e) { out.err = e.message; }
  out.exposure = g.post.u.uExposure.value;
  out.bloom = g.post.u.uBloom.value;
  return out;
});
console.log(JSON.stringify(info));

// hide the light pools and re-shoot
await page.evaluate(() => {
  const g = window.__CRASHOUT__;
  window.__hidden = [];
  g.scene.traverse((o) => {
    if (o.isMesh && o.material && o.material.blending === 2 /* Additive */ && o.visible) {
      window.__hidden.push(o); o.visible = false;
    }
  });
  return window.__hidden.length;
});
await page.waitForTimeout(500);
await page.screenshot({ path: '.scratch-burnout/probe-1-noadditive.png' });

await page.evaluate(() => { window.__CRASHOUT__.post.u.uBloom.value = 0; });
await page.waitForTimeout(400);
await page.screenshot({ path: '.scratch-burnout/probe-2-nobloom.png' });
await browser.close();
