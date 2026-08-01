import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
await page.goto('http://localhost:5173/play/burnout/', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) { if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break; await page.waitForTimeout(100); }
await page.evaluate(() => { window.__CRASHOUT__.hud.hideTitle(); });
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const g = window.__CRASHOUT__;
  const m = g.post.gradeMat;
  m.fragmentShader = `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = max(max(c.r,c.g),c.b);
      // false colour: blue<0.5 green<2 red<20 white>=20
      vec3 o = vec3(0.0,0.0,1.0);
      if (l > 0.5) o = vec3(0.0,1.0,0.0);
      if (l > 2.0) o = vec3(1.0,0.6,0.0);
      if (l > 20.0) o = vec3(1.0,0.0,0.0);
      if (!(l < 1e20)) o = vec3(1.0,1.0,1.0); // NaN / inf
      gl_FragColor = vec4(o, 1.0);
    }`;
  m.needsUpdate = true;
  return 1;
});
await page.waitForTimeout(900);
await page.screenshot({ path: '.scratch-burnout/dbg-falsecolour.png' });
console.log('done', r);
await browser.close();
