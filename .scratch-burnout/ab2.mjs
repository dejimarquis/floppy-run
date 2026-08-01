import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
page.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
await page.goto('http://localhost:5173/play/burnout/', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) { if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break; await page.waitForTimeout(100); }
await page.mouse.click(450, 260);
await page.waitForTimeout(5000);
// force exposure override every frame
await page.evaluate(() => { const g = window.__CRASHOUT__; window.__EXP = null;
  const f = g.frame.bind(g); g.frame = (t) => { f(t); if (window.__EXP != null) g.post.u.uExposure.value = window.__EXP; }; });
await page.screenshot({ path: '.scratch-burnout/c-0.png' });
await page.evaluate(() => { window.__EXP = 0.01; });
await page.waitForTimeout(1200);
await page.screenshot({ path: '.scratch-burnout/c-1-exp001.png' });
await page.evaluate(() => { window.__EXP = 1.2; });
await page.waitForTimeout(1200);
await page.screenshot({ path: '.scratch-burnout/c-2-exp12.png' });
await browser.close();
