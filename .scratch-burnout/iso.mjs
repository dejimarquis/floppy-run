import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
await page.goto('http://localhost:5173/play/burnout/', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) { if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break; await page.waitForTimeout(100); }
await page.evaluate(() => { window.__CRASHOUT__.hud.hideTitle(); });
await page.waitForTimeout(900);
const steps = {
  fogoff: () => { window.__CRASHOUT__.scene.fog = null; },
  envoff: () => { window.__CRASHOUT__.scene.environment = null; window.__CRASHOUT__.scene.background = null; },
  shadowoff: () => { window.__CRASHOUT__.renderer.shadowMap.enabled = false; window.__CRASHOUT__.scene.traverse(o=>{o.material&&(o.material.needsUpdate=true)}); },
  obcoff: () => { const w = window.__CRASHOUT__.world; for (const m of [w.roadMat, w.groundMat]) { if (m) { m.onBeforeCompile = () => {}; m.customProgramCacheKey = () => 'plain'; m.needsUpdate = true; } } },
  sunoff: () => { window.__CRASHOUT__.sun.intensity = 0; window.__CRASHOUT__.hemi.intensity = 0; window.__CRASHOUT__.__nolight = 1; },
};
for (const [name, fn] of Object.entries(steps)) {
  await page.evaluate(`(${fn.toString()})()`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `.scratch-burnout/iso-${name}.png` });
  console.log('shot', name);
}
await browser.close();
