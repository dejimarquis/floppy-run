#!/usr/bin/env node
// scratch: for each distinct compiled program, show the salient material config
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
await page.goto('http://localhost:5173/play/burnout/', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) {
  if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break;
  await page.waitForTimeout(200);
}
await page.waitForTimeout(2500);
const out = await page.evaluate(() => {
  const g = window.__CRASHOUT__;
  const r = g.renderer;
  const props = r.properties;
  const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'displacementMap', 'alphaMap', 'envMap', 'lightMap', 'specularMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap', 'sheenRoughnessMap', 'specularIntensityMap', 'specularColorMap', 'iridescenceMap', 'iridescenceThicknessMap', 'transmissionMap', 'thicknessMap', 'anisotropyMap', 'gradientMap'];
  const desc = (m) => {
    const a = [m.type.replace('Mesh', '').replace('Material', '')];
    a.push('[' + MAPS.filter((k) => m[k]).join(',') + ']');
    if (m.vertexColors) a.push('vcol');
    if (m.flatShading) a.push('flat');
    if (m.transparent) a.push('transp');
    if (m.alphaTest > 0) a.push('atest');
    if (m.side !== 0) a.push('side' + m.side);
    if (m.fog === false) a.push('nofog');
    if (m.toneMapped === false) a.push('notm');
    if (m.dithering) a.push('dither');
    if (m.premultipliedAlpha) a.push('pma');
    if (m.emissive && m.emissive.getHex() !== 0) a.push('emis');
    if (m.clearcoat > 0) a.push('cc' + m.clearcoat.toFixed(2));
    if (m.transmission > 0) a.push('trans');
    if (m.iridescence > 0) a.push('irid');
    if (m.sheen > 0) a.push('sheen');
    if (m.anisotropy > 0) a.push('aniso');
    if (m.envMap) a.push('env');
    if (m.envMapIntensity !== 1) a.push('envI');
    if (m.defines) a.push('D{' + Object.keys(m.defines).join(',') + '}');
    if (m.onBeforeCompile && m.onBeforeCompile.toString().length > 30) a.push('OBC' + m.onBeforeCompile.toString().length);
    if (m.type === 'ShaderMaterial') a.push('SRC' + (m.vertexShader.length + m.fragmentShader.length));
    return a.join(' ');
  };
  const byKey = new Map();
  const seen = new Set();
  g.scene.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      if (seen.has(m.uuid)) continue; seen.add(m.uuid);
      const mp = props.get(m);
      if (!mp || !mp.programs) continue;
      for (const k of mp.programs.keys()) {
        if (!byKey.has(k)) byKey.set(k, { d: desc(m), n: 0, geo: o.geometry ? (o.geometry.attributes.instanceMatrix ? 'inst' : '') : '' });
        byKey.get(k).n++;
      }
    }
  });
  const groups = new Map();
  for (const [k, v] of byKey) {
    const key = v.d;
    if (!groups.has(key)) groups.set(key, 0);
    groups.set(key, groups.get(key) + 1);
  }
  return { total: r.info.programs.length, distinct: byKey.size, groups: [...groups.entries()].sort((a, b) => b[1] - a[1]) };
});
console.log('total programs:', out.total, ' material-derived distinct:', out.distinct);
console.log('--- programs per material-descriptor (descriptor collisions = hidden axis) ---');
for (const [d, c] of out.groups) console.log(String(c).padStart(4), d);
await browser.close();
