import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
await page.goto('http://localhost:5173/play/burnout/', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) { if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break; await page.waitForTimeout(100); }
await page.evaluate(() => {
  const g = window.__CRASHOUT__;
  g.hud.hideTitle();
  const m = g.post.gradeMat;
  m.fragmentShader = `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb / 4.0, 1.0); }`;
  m.needsUpdate = true;
  window.__samp = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const cv = g.renderer.domElement;
    const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height;
    const ctx = c2.getContext('2d'); ctx.drawImage(cv, 0, 0);
    const s = (fx, fy) => { const d = ctx.getImageData(Math.floor(cv.width*fx), Math.floor(cv.height*fy), 1, 1).data; return +(d[1]/255*4).toFixed(3); };
    res({ road: s(0.3, 0.82), roadFar: s(0.5, 0.56), sky: s(0.2, 0.1) });
  })));
});
await page.waitForTimeout(1200);
const steps = [
  ['base', () => {}],
  ['heroLightOff', () => { const g = window.__CRASHOUT__; g.heroLight.intensity = 0; g.__lockHero = 1; }],
  ['poolOff', () => { const g = window.__CRASHOUT__; g.scene.traverse(o => { if (o.isMesh && o.material && o.material.blending === 2) o.visible = false; }); }],
  ['sunOff', () => { const g = window.__CRASHOUT__; g.sun.intensity = 0; }],
  ['hemiOff', () => { const g = window.__CRASHOUT__; g.hemi.intensity = 0; }],
  ['envOff', () => { const g = window.__CRASHOUT__; g.scene.environmentIntensity = 0; }],
  ['spotOff', () => { const g = window.__CRASHOUT__; if (g.player.spot) g.player.spot.intensity = 0; }],
];
for (const [name, fn] of steps) {
  await page.evaluate(`(${fn.toString()})()`);
  // freeze the light overrides against the game's own updates
  await page.evaluate(() => { const g = window.__CRASHOUT__; if (!g.__froze) { g.__froze = 1; g.updateLighting = () => {}; } });
  await page.waitForTimeout(450);
  console.log(name.padEnd(14), JSON.stringify(await page.evaluate(() => window.__samp())));
}
await browser.close();
