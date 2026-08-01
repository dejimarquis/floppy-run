import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 460 } });
page.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
await page.goto('http://localhost:5173/play/burnout/', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) { if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break; await page.waitForTimeout(100); }
await page.mouse.click(400, 230);
await page.waitForTimeout(5000);
const steps = [
  ['0-base', () => {}],
  ['1-nocc', () => { const m = window.__CRASHOUT__.world.roadMat; m.clearcoat = 0; m.needsUpdate = true; }],
  ['2-nowet', () => { window.__CRASHOUT__.world.roadMat.userData.uniforms.uWet.value = 0; }],
  ['3-noenv', () => { const m = window.__CRASHOUT__.world.roadMat; m.envMapIntensity = 0; m.envMap = null; m.needsUpdate = true; }],
  ['4-noobc', () => { const m = window.__CRASHOUT__.world.roadMat; m.onBeforeCompile = () => {}; m.customProgramCacheKey = () => 'plain'; m.needsUpdate = true; }],
  ['5-nonormal', () => { const m = window.__CRASHOUT__.world.roadMat; m.normalMap = null; m.roughnessMap = null; m.needsUpdate = true; }],
  ['6-black', () => { const m = window.__CRASHOUT__.world.roadMat; m.map = null; m.color.set(0x000000); m.needsUpdate = true; }],
];
for (const [name, fn] of steps) {
  await page.evaluate(fn);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `.scratch-burnout/d-${name}.png` });
}
await browser.close();
