// Traffic: instanced civilian vehicles that cruise along the route until you
// hit them, at which point they become full rigid bodies and go flying.
import * as THREE from 'three';
import { Body } from './physics.js';
import { clamp } from './rng.js';
import { ROAD_HALF } from './track.js';
import { Deformer } from './deform.js';

const WRECK_SLOTS = 6;

const _bc = new THREE.Vector3();
const _bd = new THREE.Vector3();

/**
 * Rounded box (Minkowski sum of a box and a sphere). Real vehicles have no
 * hard 90-degree edges; a chamfered silhouette is the single cheapest thing
 * that stops instanced traffic reading as a stack of cuboids.
 */
function box(w, h, d, x, y, z, color, bevel = 0.09, seg = 3) {
  const b = Math.min(bevel, w * 0.32, h * 0.32, d * 0.32);
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = g.attributes.position;
  const hx = w / 2 - b, hy = h / 2 - b, hz = d / 2 - b;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    _bc.set(clamp(px, -hx, hx), clamp(py, -hy, hy), clamp(pz, -hz, hz));
    _bd.set(px - _bc.x, py - _bc.y, pz - _bc.z);
    const len = _bd.length();
    if (len > 1e-6) _bd.multiplyScalar(b / len);
    pos.setXYZ(i, _bc.x + _bd.x, _bc.y + _bd.y, _bc.z + _bd.z);
  }
  g.computeVertexNormals();
  g.translate(x, y, z);
  return { g, color };
}
function cyl(r, len, x, y, z, color, axis = 'x') {
  const g = new THREE.CylinderGeometry(r, r, len, 12);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return { g, color };
}

/**
 * Longest-edge bisection up to a triangle budget. A merged box hull has far
 * too few vertices to buckle; the deformer needs a dense shell or it just
 * pulls single corners into spikes.
 */
function tessellate(geo, maxEdge, budget) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const attrs = ['position', 'normal', 'color', 'uv'].filter((a) => src.getAttribute(a));
  const dims = {};
  let tris = [];
  for (const a of attrs) dims[a] = src.getAttribute(a).itemSize;
  const arrs = {};
  for (const a of attrs) arrs[a] = src.getAttribute(a).array;
  const nTri = src.getAttribute('position').count / 3;
  const vert = (i) => { const v = {}; for (const a of attrs) { const d = dims[a]; v[a] = Array.from(arrs[a].slice(i * d, i * d + d)); } return v; };
  for (let t = 0; t < nTri; t++) tris.push([vert(t * 3), vert(t * 3 + 1), vert(t * 3 + 2)]);

  const elen = (a, b) => {
    const dx = a.position[0] - b.position[0], dy = a.position[1] - b.position[1], dz = a.position[2] - b.position[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  const mid = (a, b) => { const v = {}; for (const at of attrs) v[at] = a[at].map((x, i) => (x + b[at][i]) * 0.5); return v; };

  let guard = 0;
  while (tris.length < budget && guard++ < 12) {
    const out = [];
    let split = false;
    for (const tr of tris) {
      const e = [elen(tr[1], tr[2]), elen(tr[2], tr[0]), elen(tr[0], tr[1])];
      let k = 0; if (e[1] > e[k]) k = 1; if (e[2] > e[k]) k = 2;
      if (e[k] <= maxEdge || out.length + tris.length > budget * 2) { out.push(tr); continue; }
      split = true;
      const a = tr[k], b = tr[(k + 1) % 3], c = tr[(k + 2) % 3];   // longest edge is b-c
      const m = mid(b, c);
      out.push([a, b, m], [a, m, c]);
    }
    tris = out;
    if (!split) break;
  }

  const n = tris.length * 3;
  const g = new THREE.BufferGeometry();
  for (const a of attrs) {
    const d = dims[a];
    const arr = new Float32Array(n * d);
    let o = 0;
    for (const tr of tris) for (const v of tr) { for (let i = 0; i < d; i++) arr[o + i] = v[a][i]; o += d; }
    g.setAttribute(a, new THREE.BufferAttribute(arr, d));
  }
  g.computeVertexNormals();
  return g;
}

function mergeColored(parts) {
  const geos = parts.map((p) => {
    const g = p.g.index ? p.g.toNonIndexed() : p.g;
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = p.color[0]; col[i * 3 + 1] = p.color[1]; col[i * 3 + 2] = p.color[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  let vc = 0;
  for (const g of geos) vc += g.attributes.position.count;
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), col = new Float32Array(vc * 3), uv = new Float32Array(vc * 2);
  let o = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += n;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

const DARK = [0.05, 0.055, 0.07];
const TYRE = [0.035, 0.035, 0.04];
const CHROME = [0.62, 0.66, 0.72];

function archetypes() {
  const A = {};

  const wheels = (halfW, r, fz, rz, y) => {
    const out = [];
    for (const z of [fz, rz]) {
      for (const sx of [-1, 1]) {
        out.push(cyl(r, 0.26, sx * halfW, y, z, TYRE));
        out.push(cyl(r * 0.62, 0.10, sx * (halfW + 0.10), y, z, CHROME));
      }
    }
    return out;
  };

  // ---- sedan
  A.sedan = {
    size: [1.86, 1.44, 4.62], mass: 1500,
    body: mergeColored([
      box(1.86, 0.62, 4.62, 0, 0.62, 0, [1, 1, 1]),
      box(1.70, 0.52, 2.45, 0, 1.16, -0.15, [1, 1, 1]),
      box(1.72, 0.40, 2.30, 0, 1.19, -0.15, DARK),
      box(1.80, 0.14, 0.30, 0, 0.55, 2.30, DARK),
      box(1.80, 0.14, 0.30, 0, 0.55, -2.30, DARK),
      ...wheels(0.90, 0.33, 1.42, -1.42, 0.35),
    ]),
    lights: mergeColored([
      box(1.36, 0.13, 0.06, 0, 0.86, -2.33, [1, 0.08, 0.03]),
      box(0.42, 0.14, 0.06, -0.62, 0.82, 2.33, [1, 0.94, 0.82]),
      box(0.42, 0.14, 0.06, 0.62, 0.82, 2.33, [1, 0.94, 0.82]),
    ]),
  };

  // ---- taxi
  A.taxi = {
    size: [1.9, 1.6, 4.7], mass: 1600, forceColor: [1.0, 0.72, 0.05],
    body: mergeColored([
      box(1.90, 0.66, 4.70, 0, 0.64, 0, [1, 1, 1]),
      box(1.76, 0.66, 2.60, 0, 1.28, -0.2, [1, 1, 1]),
      box(1.78, 0.48, 2.44, 0, 1.32, -0.2, DARK),
      box(0.9, 0.2, 0.34, 0, 1.70, 0.4, [1, 1, 1]),
      ...wheels(0.92, 0.34, 1.46, -1.46, 0.36),
    ]),
    lights: mergeColored([
      box(1.4, 0.13, 0.06, 0, 0.9, -2.37, [1, 0.08, 0.03]),
      box(0.44, 0.14, 0.06, -0.64, 0.84, 2.37, [1, 0.94, 0.82]),
      box(0.44, 0.14, 0.06, 0.64, 0.84, 2.37, [1, 0.94, 0.82]),
      box(0.86, 0.17, 0.3, 0, 1.71, 0.4, [1.0, 0.75, 0.12]),
    ]),
  };

  // ---- van
  A.van = {
    size: [2.06, 2.28, 5.4], mass: 2300,
    body: mergeColored([
      box(2.06, 1.66, 5.10, 0, 1.28, -0.2, [1, 1, 1]),
      box(2.00, 0.70, 1.20, 0, 1.10, 2.20, [1, 1, 1]),
      box(1.94, 0.52, 0.12, 0, 1.66, 2.30, DARK),
      box(2.02, 0.46, 1.0, 0, 1.62, 1.5, DARK),
      ...wheels(1.00, 0.38, 1.62, -1.62, 0.4),
    ]),
    lights: mergeColored([
      box(0.22, 0.5, 0.06, -0.86, 1.1, -2.78, [1, 0.08, 0.03]),
      box(0.22, 0.5, 0.06, 0.86, 1.1, -2.78, [1, 0.08, 0.03]),
      box(0.4, 0.16, 0.06, -0.7, 0.86, 2.80, [1, 0.94, 0.82]),
      box(0.4, 0.16, 0.06, 0.7, 0.86, 2.80, [1, 0.94, 0.82]),
    ]),
  };

  // ---- bus
  A.bus = {
    size: [2.56, 3.2, 11.0], mass: 9000,
    body: mergeColored([
      box(2.56, 2.30, 11.0, 0, 1.66, 0, [1, 1, 1]),
      box(2.58, 0.80, 9.4, 0, 2.28, -0.2, DARK),
      box(2.40, 0.30, 10.6, 0, 2.86, 0, [0.7, 0.72, 0.75]),
      box(2.50, 1.0, 0.14, 0, 1.9, 5.48, DARK),
      ...wheels(1.24, 0.5, 3.7, -3.5, 0.52),
      cyl(0.5, 0.3, -1.24, 0.52, -2.6, TYRE), cyl(0.5, 0.3, 1.24, 0.52, -2.6, TYRE),
    ]),
    lights: mergeColored([
      box(0.3, 0.24, 0.06, -0.95, 1.0, -5.52, [1, 0.08, 0.03]),
      box(0.3, 0.24, 0.06, 0.95, 1.0, -5.52, [1, 0.08, 0.03]),
      box(0.5, 0.2, 0.06, -0.86, 0.9, 5.52, [1, 0.94, 0.82]),
      box(0.5, 0.2, 0.06, 0.86, 0.9, 5.52, [1, 0.94, 0.82]),
    ]),
  };

  // ---- articulated truck
  A.truck = {
    size: [2.55, 3.6, 12.5], mass: 14000,
    body: mergeColored([
      box(2.55, 2.20, 3.2, 0, 1.75, 4.6, [1, 1, 1]),
      box(2.40, 0.86, 0.16, 0, 2.30, 6.15, DARK),
      box(2.55, 3.10, 8.6, 0, 2.20, -1.6, [0.86, 0.87, 0.9]),
      box(2.58, 0.2, 8.4, 0, 0.66, -1.6, DARK),
      box(0.26, 1.2, 0.26, -1.26, 2.6, 3.1, CHROME),
      box(0.26, 1.2, 0.26, 1.26, 2.6, 3.1, CHROME),
      ...wheels(1.22, 0.52, 4.6, -4.4, 0.54),
      cyl(0.52, 0.36, -1.22, 0.54, -3.1, TYRE), cyl(0.52, 0.36, 1.22, 0.54, -3.1, TYRE),
      cyl(0.52, 0.36, -1.22, 0.54, 3.4, TYRE), cyl(0.52, 0.36, 1.22, 0.54, 3.4, TYRE),
    ]),
    lights: mergeColored([
      box(0.34, 0.24, 0.06, -1.0, 1.0, -5.92, [1, 0.08, 0.03]),
      box(0.34, 0.24, 0.06, 1.0, 1.0, -5.92, [1, 0.08, 0.03]),
      box(0.5, 0.2, 0.06, -0.9, 1.0, 6.22, [1, 0.94, 0.82]),
      box(0.5, 0.2, 0.06, 0.9, 1.0, 6.22, [1, 0.94, 0.82]),
      box(2.2, 0.08, 0.08, 0, 3.72, -1.6, [1.0, 0.55, 0.1]),
    ]),
  };

  // ---- hatchback
  A.hatch = {
    size: [1.74, 1.5, 3.94], mass: 1180,
    body: mergeColored([
      box(1.74, 0.60, 3.94, 0, 0.60, 0, [1, 1, 1]),
      box(1.62, 0.62, 2.10, 0, 1.16, -0.28, [1, 1, 1]),
      box(1.64, 0.46, 1.96, 0, 1.20, -0.28, DARK),
      ...wheels(0.84, 0.30, 1.24, -1.24, 0.32),
    ]),
    lights: mergeColored([
      box(1.1, 0.16, 0.06, 0, 0.86, -1.99, [1, 0.08, 0.03]),
      box(0.38, 0.13, 0.06, -0.55, 0.78, 1.99, [1, 0.94, 0.82]),
      box(0.38, 0.13, 0.06, 0.55, 0.78, 1.99, [1, 0.94, 0.82]),
    ]),
  };

  return A;
}

// No entry goes above ~0.58 sRGB: a near-white body panel under the sun key
// clips straight through the bloom threshold and reads as a blank white box.
const PALETTE = [
  0x6a7079, 0x22262c, 0x767b83, 0x1d3a63, 0x5c1119, 0x24402d,
  0x8a8e94, 0x3c3f46, 0x5f3a17, 0x11526f, 0x6e6a7c, 0x6f1926,
];

export class Traffic {
  constructor(game, count = 28) {
    this.game = game;
    this.track = game.track;
    this.rng = game.rng;
    this.arch = archetypes();
    this.keys = Object.keys(this.arch);
    this.meshes = {};
    this.items = [];
    const scene = game.scene;

    const bodyMat = new THREE.MeshStandardMaterial({
      // Car paint is a dielectric. At metalness 0.55 with envMapIntensity 1.25
      // every traffic vehicle became a mirror of a bright sky PMREM, i.e. a
      // white box. Low metalness + a restrained env keeps the body colour.
      vertexColors: true, roughness: 0.42, metalness: 0.14, envMapIntensity: 0.40,
    });
    this.bodyMat = bodyMat;
    const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

    const perArch = Math.ceil(count / this.keys.length) + 3;
    for (const k of this.keys) {
      const a = this.arch[k];
      const bi = new THREE.InstancedMesh(a.body, bodyMat, perArch);
      bi.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(perArch * 3), 3);
      bi.geometry = a.body;
      bi.castShadow = true; bi.receiveShadow = true;
      bi.frustumCulled = false;
      bi.count = 0;
      const li = new THREE.InstancedMesh(a.lights, lightMat, perArch);
      li.frustumCulled = false; li.count = 0;
      scene.add(bi, li);
      this.meshes[k] = { body: bi, lights: li, n: 0 };
    }

    // ---- deformable wreck slots -------------------------------------------
    // Instanced meshes cannot be deformed per instance, so a vehicle that gets
    // hit is promoted out of its InstancedMesh into a unique dense mesh with a
    // real Deformer attached. Six concurrent slots is enough for a pile-up and
    // costs at most six extra draw calls.
    this.wreckMats = [];
    this.slotsByArch = {};
    for (const k of this.keys) {
      const hi = tessellate(this.arch[k].body, 0.34, 2200);
      this.arch[k].bodyHi = hi;
      this.slotsByArch[k] = [];
      for (let i = 0; i < 2; i++) {
        const geo = hi.clone();
        const mat = new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: 0.52, metalness: 0.14, envMapIntensity: 0.36,
        });
        this.wreckMats.push(mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.visible = false;
        mesh.matrixAutoUpdate = false;
        scene.add(mesh);
        this.slotsByArch[k].push({ mesh, mat, deformer: new Deformer(mesh, { maxDisp: 0.30 }), item: null });
      }
    }
    this.liveSlots = 0;

    for (let i = 0; i < count; i++) this.items.push(this.makeItem());
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._v = new THREE.Vector3();
  }

  makeItem() {
    const k = this.keys[this.rng.int(0, this.keys.length - 1)];
    const a = this.arch[k];
    const it = {
      arch: k,
      cfg: { size: a.size },
      body: new Body({ mass: a.mass, size: a.size }),
      mode: 'cruise',
      s: 0, u: 0, dir: 1, speed: 20,
      color: new THREE.Color(a.forceColor ? new THREE.Color().setRGB(...a.forceColor) : PALETTE[this.rng.int(0, PALETTE.length - 1)]),
      damage: 0,
      damageStage: 0,
      slot: null,
      wrecked: false,
      hint: -1,
      life: 0,
      active: false,
      isTraffic: true,
    };
    return it;
  }

  /** Scatter every vehicle around the given arc-length. */
  reset(playerS) {
    for (const it of this.items) {
      it.active = false;
      it.mode = 'cruise';
      this.respawn(it, playerS);
    }
  }

  /** Alias used by scripted events: snap an item to its cruise pose. */
  placeCruise(it) {
    it.mode = 'cruise';
    it.wrecked = false;
    it.damage = 0;
    it.damageStage = 0;
    this.releaseSlot(it);
    it.active = true;
    this.syncCruise(it, 0);
  }

  respawn(it, playerS, ahead = true) {
    const a = this.arch[it.arch];
    const t = this.track;
    const oncoming = this.rng.next() < 0.42;
    it.dir = oncoming ? -1 : 1;
    const dist = ahead ? this.rng.range(120, 460) : -this.rng.range(140, 320);
    it.s = t.wrapS(playerS + dist);
    const laneW = 4.1;
    if (oncoming) it.u = -laneW * (0.55 + this.rng.int(0, 2)) - 1.0;
    else it.u = laneW * (0.55 + this.rng.int(0, 2)) + 1.0;
    it.u = clamp(it.u, -ROAD_HALF + 2.2, ROAD_HALF - 2.2);
    const base = a.mass > 5000 ? 18 : 24;
    it.speed = base + this.rng.range(-4, 10);
    it.mode = 'cruise';
    it.wrecked = false;
    it.damage = 0;
    it.damageStage = 0;
    this.releaseSlot(it);
    it.hint = -1;
    it.active = true;
    it.life = 0;
    it.body.vel.set(0, 0, 0);
    it.body.ang.set(0, 0, 0);
    it.lastHitBy = null;
    this.syncCruise(it, 0);
  }

  syncCruise(it, dt) {
    const t = this.track;
    it.s = t.wrapS(it.s + it.speed * it.dir * dt);
    const f = t.frameAt(it.s, _f);
    const p = it.body.pos;
    p.copy(f.pos).addScaledVector(f.right, it.u).addScaledVector(f.up, it.cfg.size[1] * 0.02);
    const fwd = _fwd.copy(f.tan).multiplyScalar(it.dir);
    const right = _right.copy(f.right).multiplyScalar(it.dir);
    _mm.makeBasis(right, f.up, fwd);
    it.body.quat.setFromRotationMatrix(_mm);
    it.body.vel.copy(fwd).multiplyScalar(it.speed);
    it.hint = t.idxFromS(it.s);
  }

  /** Turn a cruising car into a physics wreck. */
  activatePhysics(it) {
    if (it.mode === 'physics') return;
    it.mode = 'physics';
    it.wrecked = true;
    it.life = 0;
    this.acquireSlot(it);
  }

  acquireSlot(it) {
    if (it.slot) return it.slot;
    if (this.liveSlots >= WRECK_SLOTS) return null;
    const pool = this.slotsByArch[it.arch];
    const slot = pool.find((s) => !s.item);
    if (!slot) return null;
    slot.item = it;
    slot.deformer.reset();
    slot.mat.color.copy(it.color);
    slot.mesh.visible = true;
    it.slot = slot;
    it.damageStage = 0;
    this.liveSlots++;
    return slot;
  }

  releaseSlot(it) {
    if (!it.slot) return;
    it.slot.item = null;
    it.slot.mesh.visible = false;
    it.slot = null;
    this.liveSlots--;
  }

  /**
   * Progressive damage: an accumulating dent at the contact point plus three
   * discrete crumple stages so a repeatedly-hit vehicle keeps getting worse
   * instead of saturating after the first impact.
   */
  applyDamage(it, point, normal, e) {
    it.damage = clamp((it.damage || 0) + e * 0.65 + 0.1, 0, 1);
    const slot = it.slot || this.acquireSlot(it);
    if (!slot) return;
    const inv = _q2.copy(it.body.quat).invert();
    const lp = _lp.copy(point).sub(it.body.pos).applyQuaternion(inv);
    const ln = _ln.copy(normal).applyQuaternion(inv).normalize();
    const half = Math.max(it.cfg.size[0], it.cfg.size[2]) * 0.5;
    slot.deformer.impact(lp, ln, half * (0.55 + e * 0.55), 0.55 + e * 1.35);
    const stage = it.damage < 0.34 ? 1 : (it.damage < 0.7 ? 2 : 3);
    while ((it.damageStage || 0) < stage) {
      it.damageStage = (it.damageStage || 0) + 1;
      slot.deformer.crush(0.16 + it.damageStage * 0.12);
    }
  }

  hit(it, point, normal, energy, by) {
    this.activatePhysics(it);
    it.lastHitBy = by;
    it.lastHitTime = this.game.time;
    const g = this.game;
    const e = clamp(energy, 0, 1);
    this.applyDamage(it, point, normal, e);

    g.vfx.sparkBurst(point, Math.floor(16 + e * 60), normal, 1.2, 14 + e * 22);
    g.vfx.glassBurst(point, Math.floor(8 + e * 20), it.body.vel);
    g.vfx.debrisBurst(point, Math.floor(3 + e * 12), it.body.vel);
    g.vfx.smokePuff(point, 3, it.body.vel, 1.1, 0.2, 1.3);
    g.vfx.flashAt(point, 0.85 + e * 1.25, 0.10, [2.0, 1.2, 0.5]);
    // Screen-space shockwave only for hits the player actually caused; a rival
    // clipping traffic off camera used to warp the whole frame.
    if (by === g.player) g.shockAt(point, 0.4 + e * 0.5);
    g.audio.crunch(e, point, false);
    if (e > 0.55) {
      g.vfx.explosion(it.body.pos, it.body.vel, 0.8, [it.color.r, it.color.g, it.color.b]);
      g.audio.explosion(it.body.pos);
    }
  }

  update(dt, playerS) {
    const t = this.track;
    for (const k of this.keys) this.meshes[k].n = 0;
    for (const it of this.items) {
      if (!it.active) { this.respawn(it, playerS); continue; }
      it.life += dt;
      if (it.mode === 'cruise') {
        this.syncCruise(it, dt);
      } else {
        const b = it.body;
        b.applyCentralForce(_v3.set(0, -19.5 * b.mass, 0));
        // ground contact (single-point, plenty for debris cars)
        const surf = t.surface(b.pos.x, b.pos.z, it.hint);
        it.hint = surf.i;
        const halfH = it.cfg.size[1] * 0.5;
        const groundY = surf.y + halfH * 0.55;
        if (b.pos.y < groundY) {
          const pen = groundY - b.pos.y;
          b.pos.y = groundY;
          if (b.vel.y < 0) {
            const vy = b.vel.y;
            b.vel.y = -vy * 0.30;
            b.ang.x += (Math.random() - 0.5) * Math.abs(vy) * 0.4;
            b.ang.z += (Math.random() - 0.5) * Math.abs(vy) * 0.4;
            if (Math.abs(vy) > 6) {
              this.game.vfx.sparkBurst(b.pos, 12, null, 1.3, 10);
              this.game.audio.crunch(clamp(Math.abs(vy) / 30, 0, 0.6), b.pos, true);
            }
          }
          b.vel.x *= Math.exp(-2.6 * dt);
          b.vel.z *= Math.exp(-2.6 * dt);
          b.ang.multiplyScalar(Math.exp(-1.6 * dt));
          void pen;
        }
        b.vel.multiplyScalar(Math.exp(-0.22 * dt));
        b.integrate(dt);
        // keep wrecks on the road
        const pr = t.project(b.pos.x, b.pos.z, it.hint);
        const lim = ROAD_HALF + 1.4;
        if (Math.abs(pr.u) > lim) {
          const f = t.frameAt(pr.s, _f);
          const side = Math.sign(pr.u);
          b.pos.addScaledVector(f.right, -side * (Math.abs(pr.u) - lim));
          const vn = b.vel.dot(_v3.copy(f.right).multiplyScalar(side));
          if (vn > 0) {
            b.vel.addScaledVector(f.right, -side * vn * 1.5);
            if (vn > 5) {
              this.game.vfx.sparkBurst(b.pos, 16, null, 1.4, 14);
              this.game.audio.crunch(clamp(vn / 40, 0, 0.7), b.pos, true);
            }
          }
        }
        it.s = pr.s;
        // smoke / fire from wrecks
        if (it.wrecked && it.life < 5 && Math.random() < 0.35) {
          _v3.copy(b.pos).add(_v4.set(0, 0.6, 0));
          this.game.vfx.smokePuff(_v3, 1, b.vel, 1.4, 0.12, 2.2);
          if (it.life < 1.6 && Math.random() < 0.5) this.game.vfx.fireBurst(_v3, 2, 0.8);
        }
      }

      // recycle
      const d = t.deltaS(it.s, playerS);
      if (d < -260 || d > 620 || (it.mode === 'physics' && it.life > 22)) {
        this.respawn(it, playerS);
      }

      // draw
      if (it.slot) {
        this._m.compose(it.body.pos, it.body.quat, _one);
        it.slot.mesh.matrix.copy(this._m);
        it.slot.mesh.matrixWorldNeedsUpdate = true;
        continue;
      }
      const mm = this.meshes[it.arch];
      const idx = mm.n++;
      if (idx < mm.body.instanceMatrix.count) {
        this._m.compose(it.body.pos, it.body.quat, _one);
        mm.body.setMatrixAt(idx, this._m);
        mm.body.setColorAt(idx, it.color);
        mm.lights.setMatrixAt(idx, this._m);
      }
    }
    for (const k of this.keys) {
      const mm = this.meshes[k];
      mm.body.count = mm.n;
      mm.lights.count = mm.n;
      mm.body.instanceMatrix.needsUpdate = true;
      mm.lights.instanceMatrix.needsUpdate = true;
      if (mm.body.instanceColor) mm.body.instanceColor.needsUpdate = true;
    }
  }

  setEnvironment(env) {
    this.bodyMat.envMap = env; this.bodyMat.needsUpdate = true;
    for (const m of this.wreckMats) { m.envMap = env; m.needsUpdate = true; }
  }
}

const _f = {
  pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(),
  up: new THREE.Vector3(), curv: 0, bank: 0, kind: 'open',
};
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3();
const _mm = new THREE.Matrix4();
const _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q2 = new THREE.Quaternion(), _ln = new THREE.Vector3();
const _lp = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
