import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
await page.goto('http://localhost:5173/play/burnout/', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) { if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break; await page.waitForTimeout(100); }
await page.mouse.click(450, 260);
await page.waitForTimeout(5000);
console.log(JSON.stringify(await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('body *').forEach((el) => {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (r.width < 200 || r.height < 100) return;
    if (cs.opacity === '0' || cs.display === 'none' || cs.visibility === 'hidden') return;
    out.push({ tag: el.tagName, id: el.id, cls: el.className && String(el.className).slice(0,40), op: cs.opacity,
      bg: cs.backgroundColor, bgImg: cs.backgroundImage.slice(0, 60), z: cs.zIndex,
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
  });
  return out;
}), null, 1));
await browser.close();
