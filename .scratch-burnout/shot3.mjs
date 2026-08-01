import { chromium } from 'playwright';
const tag = process.argv[2] || 'x';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
await page.goto('http://localhost:5173/play/burnout/', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) { if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break; await page.waitForTimeout(100); }
await page.mouse.click(550, 320);
await page.waitForTimeout(6000);
await page.locator('canvas').first().screenshot({ path: `.scratch-burnout/s3-${tag}-drive.png` });
await page.evaluate(() => window.__CRASHOUT__.forceEvent('boost'));
await page.waitForTimeout(800);
await page.locator('canvas').first().screenshot({ path: `.scratch-burnout/s3-${tag}-boost.png` });
await page.waitForTimeout(2500);
await page.locator('canvas').first().screenshot({ path: `.scratch-burnout/s3-${tag}-drive2.png` });
console.log('progs', await page.evaluate(() => window.__CRASHOUT__.renderer.info.programs.length));
console.log('stats', JSON.stringify(await page.evaluate(() => window.__STATS__())));
await browser.close();
