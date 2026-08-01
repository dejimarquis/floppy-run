import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
await page.goto('http://localhost:5173/play/burnout/', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) { if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break; await page.waitForTimeout(100); }
await page.evaluate(() => { window.__CRASHOUT__.hud.hideTitle(); });
await page.waitForTimeout(1500);
const out = await page.evaluate(async () => {
  const g = window.__CRASHOUT__;
  const m = g.post.gradeMat;
  const SCALE = 4.0;
  m.fragmentShader = `uniform sampler2D tDiffuse; uniform sampler2D tBloom; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; vec3 b = texture2D(tBloom, vUv).rgb;
      gl_FragColor = vec4(vUv.x < 0.5 ? c / ${SCALE.toFixed(1)} : b / ${SCALE.toFixed(1)}, 1.0); }`;
  m.needsUpdate = true;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const cv = g.renderer.domElement;
  const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height;
  const ctx = c2.getContext('2d'); ctx.drawImage(cv, 0, 0);
  const sample = (fx, fy) => {
    const d = ctx.getImageData(Math.floor(cv.width * fx), Math.floor(cv.height * fy), 1, 1).data;
    return [d[0], d[1], d[2]].map((v) => +(v / 255 * SCALE).toFixed(3));
  };
  return {
    roadNear: sample(0.25, 0.80), roadMid: sample(0.25, 0.60), sky: sample(0.25, 0.12),
    bloomRoad: sample(0.75, 0.80), bloomSky: sample(0.75, 0.12),
    exposure: g.post.u.uExposure.value, bloomStrength: g.post.u.uBloom.value,
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
