import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
await page.goto('http://localhost:5173/play/burnout/', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) { if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break; await page.waitForTimeout(100); }
await page.evaluate(() => { window.__CRASHOUT__.hud.hideTitle(); window.__CRASHOUT__.paused = false; });
await page.waitForTimeout(800);
for (const e of [0.30, 0.08, 0.02, 0.004]) {
  await page.evaluate((v) => {
    const g = window.__CRASHOUT__;
    g.__lockExp = v;
    if (!g.__patched) { g.__patched = 1; const f = g.frame.bind(g); g.frame = (dt) => { f(dt); g.post.u.uExposure.value = g.__lockExp; }; }
  }, e);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `.scratch-burnout/expo-${e}.png` });
}
await browser.close();
