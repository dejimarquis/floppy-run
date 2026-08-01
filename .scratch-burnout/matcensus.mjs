#!/usr/bin/env node
// scratch diagnostic: census of material permutations in burnout
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
await page.goto('http://localhost:5173/play/burnout/', { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 30000) {
  if (await page.evaluate(() => window.__READY__ === true).catch(() => false)) break;
  await page.waitForTimeout(200);
}
await page.waitForTimeout(1500);
const out = await page.evaluate(() => {
  const g = window.__CRASHOUT__;
  const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'displacementMap', 'alphaMap', 'envMap', 'lightMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap', 'specularIntensityMap', 'iridescenceMap', 'transmissionMap', 'thicknessMap', 'anisotropyMap'];
  const seen = new Map();
  const sigCount = new Map();
  const nameBySig = new Map();
  g.scene.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      if (seen.has(m.uuid)) { seen.get(m.uuid).n++; continue; }
      const maps = MAPS.filter((k) => m[k]);
      const flags = [];
      if (m.vertexColors) flags.push('vcol');
      if (m.transparent) flags.push('transp');
      if (m.clearcoat > 0) flags.push('cc');
      if (m.transmission > 0) flags.push('transmission');
      if (m.iridescence > 0) flags.push('irid');
      if (m.sheen > 0) flags.push('sheen');
      if (m.anisotropy > 0) flags.push('aniso');
      if (m.flatShading) flags.push('flat');
      if (m.onBeforeCompile && m.onBeforeCompile.toString().length > 40) flags.push('obc');
      if (m.side !== 0) flags.push('side' + m.side);
      if (m.alphaTest > 0) flags.push('atest');
      if (m.fog === false) flags.push('nofog');
      if (m.toneMapped === false) flags.push('notm');
      if (m.defines && Object.keys(m.defines).length) flags.push('def:' + Object.keys(m.defines).join('+'));
      const sig = m.type + ' | ' + maps.join('+') + ' | ' + flags.join('+');
      seen.set(m.uuid, { sig, n: 1 });
      sigCount.set(sig, (sigCount.get(sig) || 0) + 1);
      const nm = m.name || o.name || o.type;
      const arr = nameBySig.get(sig) || [];
      if (arr.length < 6) arr.push(nm);
      nameBySig.set(sig, arr);
    }
  });
  const rows = [...sigCount.entries()].sort((a, b) => b[1] - a[1]).map(([s, c]) => ({ sig: s, mats: c, names: nameBySig.get(s) }));
  return { rows, programs: g.renderer.info.programs.length };
});
const THREE_NOOP = null;
console.log('programs:', out.programs);
for (const r of out.rows) console.log(String(r.mats).padStart(4), r.sig, '   //', r.names.join(','));
await browser.close();
