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
await page.waitForTimeout(1000);
// FREEZE the sim: stop stepping, keep rendering
await page.evaluate(() => {
  const g = window.__CRASHOUT__;
  g.step = () => {};
  g.updateCamera = () => {};
  g.updateLighting = () => {};
  g.world.update = () => {};
  g.hud.update = () => {};
});
await page.waitForTimeout(600);
const steps = [
  ['base', () => {}],
  ['roadBLACK', () => { const w = window.__CRASHOUT__.world; w.roadMat.color.set(0x000000); w.roadMat.map = null; w.roadMat.needsUpdate = true; }],
  ['groundBLACK', () => { const w = window.__CRASHOUT__.world; w.groundMat.color.set(0x000000); w.groundMat.map = null; w.groundMat.needsUpdate = true; }],
  ['additiveOff', () => { window.__CRASHOUT__.scene.traverse(o => { if (o.isMesh && o.material && o.material.blending === 2) o.visible = false; }); }],
  ['sunOff', () => { window.__CRASHOUT__.sun.intensity = 0; }],
  ['envOff', () => { window.__CRASHOUT__.scene.environmentIntensity = 0; window.__CRASHOUT__.scene.environment = null; window.__CRASHOUT__.scene.traverse(o=>{ if(o.material) o.material.needsUpdate = true; }); }],
  ['hemiOff', () => { window.__CRASHOUT__.hemi.intensity = 0; }],
  ['pointsOff', () => { const g = window.__CRASHOUT__; g.scene.traverse(o => { if (o.isLight && !o.isDirectionalLight && !o.isHemisphereLight) o.intensity = 0; }); }],
];
for (const [name, fn] of steps) {
  await page.evaluate(`(${fn.toString()})()`);
  await page.waitForTimeout(350);
  console.log(name.padEnd(14), JSON.stringify(await page.evaluate(() => window.__samp())));
}
await page.screenshot({ path: '.scratch-burnout/px3-final.png' });
await browser.close();
