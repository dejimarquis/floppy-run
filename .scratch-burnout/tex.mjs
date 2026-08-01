import { chromium } from 'playwright';
import fs from 'fs';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
await page.goto('http://localhost:5173/play/burnout/', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) { if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break; await page.waitForTimeout(100); }
const d = await page.evaluate(() => {
  const w = window.__CRASHOUT__.world;
  const img = w.roadMat.map.image;
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, 512, 512);
  const px = x.getImageData(0, 0, 512, 512).data;
  let sum = 0, mn = 255, mx = 0;
  for (let i = 0; i < px.length; i += 4) { sum += px[i]; mn = Math.min(mn, px[i]); mx = Math.max(mx, px[i]); }
  return { url: c.toDataURL(), mean: (sum / (px.length / 4)).toFixed(1), mn, mx, w: img.width, h: img.height };
});
console.log('road tex', d.w + 'x' + d.h, 'mean', d.mean, 'min', d.mn, 'max', d.mx);
fs.writeFileSync('.scratch-burnout/roadtex.png', Buffer.from(d.url.split(',')[1], 'base64'));
await browser.close();
