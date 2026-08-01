import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
await page.goto('http://localhost:5173/play/burnout/', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) { if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break; await page.waitForTimeout(100); }
await page.mouse.click(550, 320);
await page.waitForTimeout(5000);
console.log(JSON.stringify(await page.evaluate(() => {
  const g = window.__CRASHOUT__, w = g.world;
  const desc = (m) => m && ({ type: m.type, color: m.color && m.color.getHexString(), rough: m.roughness, metal: m.metalness,
    emissive: m.emissive && m.emissive.getHexString(), emissiveIntensity: m.emissiveIntensity, map: !!m.map, mapCS: m.map && m.map.colorSpace,
    env: m.envMapIntensity, cc: m.clearcoat, toneMapped: m.toneMapped, lightMap: !!m.lightMap, ao: !!m.aoMap });
  // what mesh is under the centre-bottom pixel?
  const ray = new window.__THREE__.Raycaster();
  ray.setFromCamera(new window.__THREE__.Vector2(-0.4, -0.64), g.camera);
  const hits = ray.intersectObjects(g.scene.children, true).slice(0, 3).map(h => ({
    name: h.object.name || h.object.type, dist: +h.distance.toFixed(1),
    mat: h.object.material && (h.object.material.name || h.object.material.uuid.slice(0, 6)),
    matType: h.object.material && h.object.material.type,
    col: h.object.material && h.object.material.color && h.object.material.color.getHexString(),
    hasMap: !!(h.object.material && h.object.material.map),
  }));
  return { road: desc(w.roadMat), ground: desc(w.groundMat), hits,
    sun: g.sun.intensity, hemi: g.hemi.intensity, envI: g.scene.environmentIntensity, bgI: g.scene.backgroundIntensity,
    fog: g.scene.fog && { c: g.scene.fog.color.getHexString(), d: g.scene.fog.density } };
})));
await browser.close();
