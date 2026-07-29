// Real-time crash deformation.
//
// The naive version of this -- push every vertex inside a radius along the
// impact direction -- tears a low-poly hull into spikes, because a handful of
// vertices get dragged out while their neighbours stay put. This implementation
// is topology aware:
//
//   * vertices are welded by position so coincident duplicates move together
//     and the shell stays closed;
//   * per-vertex displacement is clamped to 0.55x that vertex's mean incident
//     edge length, so no vertex can ever out-run its neighbours;
//   * two Laplacian relaxation passes run over the touched ring after every
//     impact, which turns a spike into a buckle;
//   * the crumple read comes from high-frequency noise, not from amplitude.
import * as THREE from 'three';
import { clamp, noise2 } from './rng.js';

const QUANT = 1e4;

function buildTopology(geo) {
  const pos = geo.attributes.position;
  const n = pos.count;
  const arr = pos.array;
  // ---- weld by quantised position
  const map = new Map();
  const weld = new Int32Array(n);
  const groups = [];
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const key = `${Math.round(arr[o] * QUANT)},${Math.round(arr[o + 1] * QUANT)},${Math.round(arr[o + 2] * QUANT)}`;
    let g = map.get(key);
    if (g === undefined) { g = groups.length; map.set(key, g); groups.push([]); }
    weld[i] = g;
    groups[g].push(i);
  }
  const gn = groups.length;

  // ---- adjacency from triangles
  const idx = geo.index ? geo.index.array : null;
  const triCount = idx ? idx.length : n;
  const adjSet = new Array(gn);
  for (let i = 0; i < gn; i++) adjSet[i] = new Set();
  const link = (a, b) => { if (a !== b) { adjSet[a].add(b); adjSet[b].add(a); } };
  for (let t = 0; t + 2 < triCount; t += 3) {
    const a = weld[idx ? idx[t] : t];
    const b = weld[idx ? idx[t + 1] : t + 1];
    const c = weld[idx ? idx[t + 2] : t + 2];
    link(a, b); link(b, c); link(c, a);
  }

  // ---- flatten adjacency + mean incident edge length per welded vertex
  const start = new Int32Array(gn + 1);
  let total = 0;
  for (let i = 0; i < gn; i++) { start[i] = total; total += adjSet[i].size; }
  start[gn] = total;
  const adj = new Int32Array(total);
  const meanEdge = new Float32Array(gn);
  const gpos = new Float32Array(gn * 3);
  for (let i = 0; i < gn; i++) {
    const rep = groups[i][0] * 3;
    gpos[i * 3] = arr[rep]; gpos[i * 3 + 1] = arr[rep + 1]; gpos[i * 3 + 2] = arr[rep + 2];
  }
  let k = 0;
  for (let i = 0; i < gn; i++) {
    let sum = 0, cnt = 0;
    for (const j of adjSet[i]) {
      adj[k++] = j;
      const dx = gpos[i * 3] - gpos[j * 3];
      const dy = gpos[i * 3 + 1] - gpos[j * 3 + 1];
      const dz = gpos[i * 3 + 2] - gpos[j * 3 + 2];
      sum += Math.sqrt(dx * dx + dy * dy + dz * dz); cnt++;
    }
    meanEdge[i] = cnt ? sum / cnt : 0.05;
  }
  // Per-vertex distance from the shell centroid. Total displacement is capped
  // against this so a car that takes six impacts buckles instead of collapsing
  // into a flat sheet -- which is what "unbounded accumulation" actually looks
  // like on screen, and it reads as a rendering bug, not as damage.
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < gn; i++) { cx += gpos[i * 3]; cy += gpos[i * 3 + 1]; cz += gpos[i * 3 + 2]; }
  cx /= gn; cy /= gn; cz /= gn;
  const radial = new Float32Array(gn);
  for (let i = 0; i < gn; i++) {
    radial[i] = Math.hypot(gpos[i * 3] - cx, gpos[i * 3 + 1] - cy, gpos[i * 3 + 2] - cz);
  }
  return { weld, gn, start, adj, meanEdge, gpos, radial, center: [cx, cy, cz] };
}

const _topoCache = new WeakMap();

export class Deformer {
  constructor(mesh, opts = {}) {
    this.mesh = mesh;
    this.geo = mesh.geometry;
    const attr = this.geo.attributes.position;
    this.base = new Float32Array(attr.array.length);
    this.base.set(attr.array);
    this.cur = attr.array;
    this.count = attr.count;
    this.maxDisp = opts.maxDisp ?? 0.22;
    this.damage = 0;
    this.dirty = false;

    let topo = _topoCache.get(this.geo);
    if (!topo) { topo = buildTopology(this.geo); _topoCache.set(this.geo, topo); }
    this.topo = topo;
    // displacement lives on the WELDED vertex set
    this.disp = new Float32Array(topo.gn * 3);
    this._scratch = new Float32Array(topo.gn * 3);
    this._ring = new Int32Array(topo.gn);
  }

  /**
   * @param {THREE.Vector3} lp local-space impact point
   * @param {THREE.Vector3} ldir local-space impact direction (unit, into the car)
   * @param {number} energy 0..1 severity
   * @param {number} radius metres
   */
  impact(lp, ldir, energy, radius = 0.95) {
    const T = this.topo;
    const gp = T.gpos, dsp = this.disp, ring = this._ring;
    const e = clamp(energy, 0, 1);
    const depth = e * this.maxDisp;
    const r2 = radius * radius * 2.6;
    let nRing = 0;

    for (let g = 0; g < T.gn; g++) {
      const o = g * 3;
      const cx = gp[o] + dsp[o], cy = gp[o + 1] + dsp[o + 1], cz = gp[o + 2] + dsp[o + 2];
      const dx = cx - lp.x, dy = cy - lp.y, dz = cz - lp.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2);
      const fall = Math.pow(clamp(1 - d / (radius * 1.6), 0, 1), 1.6);
      if (fall <= 0.001) continue;

      // High-frequency crumple: the buckle read comes from FREQUENCY, so the
      // amplitude can stay inside the edge-length budget.
      const n = noise2(gp[o] * 18.0 + gp[o + 2] * 7.4, gp[o + 1] * 16.5 - gp[o + 2] * 5.1);
      const n2 = noise2(gp[o] * 41.0 - gp[o + 1] * 12.0, gp[o + 2] * 37.0);
      const wob = 1 + n * 0.85 + n2 * 0.30;
      const amt = depth * fall * wob;
      const inv = 1 / (d + 1e-3);
      dsp[o] += ldir.x * amt + dx * inv * -amt * 0.28;
      dsp[o + 1] += ldir.y * amt + dy * inv * -amt * 0.28;
      dsp[o + 2] += ldir.z * amt + dz * inv * -amt * 0.28;
      ring[nRing++] = g;
    }
    if (!nRing) return 0;

    // ---- per-vertex clamp against local edge length, then relax
    this._clampToEdges(ring, nRing);
    this._relax(ring, nRing, 2);
    this._clampToEdges(ring, nRing);
    this._writeBack();

    this.damage = clamp(this.damage + e * 0.32, 0, 1);
    this.dirty = true;
    return nRing;
  }

  _clampToEdges(ring, nRing) {
    const T = this.topo, dsp = this.disp;
    for (let k = 0; k < nRing; k++) {
      const g = ring[k], o = g * 3;
      // Never let a vertex travel more than 42% of its distance to the shell
      // centroid: the silhouette can crumple hard but can never invert or
      // pancake.
      const hard = Math.min(this.maxDisp * 2.0, T.radial[g] * 0.42);
      // A vertex may never sit further than 0.55x its mean incident edge length
      // away from the average of its neighbours: that is exactly the condition
      // that turns a spike into a crease.
      const lim = T.meanEdge[g] * 0.55;
      let nx = 0, ny = 0, nz = 0, cnt = 0;
      for (let a = T.start[g]; a < T.start[g + 1]; a++) {
        const j = T.adj[a] * 3;
        nx += dsp[j]; ny += dsp[j + 1]; nz += dsp[j + 2]; cnt++;
      }
      if (cnt) { nx /= cnt; ny /= cnt; nz /= cnt; }
      const vx = dsp[o] - nx, vy = dsp[o + 1] - ny, vz = dsp[o + 2] - nz;
      const l = Math.hypot(vx, vy, vz);
      if (l > lim) {
        const s = lim / l;
        dsp[o] = nx + vx * s; dsp[o + 1] = ny + vy * s; dsp[o + 2] = nz + vz * s;
      }
      const tl = Math.hypot(dsp[o], dsp[o + 1], dsp[o + 2]);
      if (tl > hard) {
        const s = hard / tl;
        dsp[o] *= s; dsp[o + 1] *= s; dsp[o + 2] *= s;
      }
    }
  }

  _relax(ring, nRing, passes) {
    const T = this.topo, dsp = this.disp, tmp = this._scratch;
    for (let p = 0; p < passes; p++) {
      for (let k = 0; k < nRing; k++) {
        const g = ring[k], o = g * 3;
        let nx = 0, ny = 0, nz = 0, cnt = 0;
        for (let a = T.start[g]; a < T.start[g + 1]; a++) {
          const j = T.adj[a] * 3;
          nx += dsp[j]; ny += dsp[j + 1]; nz += dsp[j + 2]; cnt++;
        }
        if (!cnt) { tmp[o] = dsp[o]; tmp[o + 1] = dsp[o + 1]; tmp[o + 2] = dsp[o + 2]; continue; }
        const w = 0.55;
        tmp[o] = dsp[o] * (1 - w) + (nx / cnt) * w;
        tmp[o + 1] = dsp[o + 1] * (1 - w) + (ny / cnt) * w;
        tmp[o + 2] = dsp[o + 2] * (1 - w) + (nz / cnt) * w;
      }
      for (let k = 0; k < nRing; k++) {
        const o = ring[k] * 3;
        dsp[o] = tmp[o]; dsp[o + 1] = tmp[o + 1]; dsp[o + 2] = tmp[o + 2];
      }
    }
  }

  _writeBack() {
    const T = this.topo, b = this.base, c = this.cur, dsp = this.disp;
    for (let i = 0; i < this.count; i++) {
      const o = i * 3, g = T.weld[i] * 3;
      c[o] = b[o] + dsp[g];
      c[o + 1] = b[o + 1] + dsp[g + 1];
      c[o + 2] = b[o + 2] + dsp[g + 2];
    }
  }

  /** Global crush -- used for spectacular pile-ups and total wrecks. */
  crush(amount) {
    const T = this.topo, gp = T.gpos, dsp = this.disp;
    const a = clamp(amount, 0, 1);
    for (let g = 0; g < T.gn; g++) {
      const o = g * 3;
      const n = noise2(gp[o] * 12.0, gp[o + 2] * 11.0);
      const n2 = noise2(gp[o + 1] * 26.0, gp[o + 2] * 24.0);
      const w = 0.6 + n * 0.5 + n2 * 0.25;
      dsp[o] += -gp[o] * 0.13 * a * w;
      dsp[o + 1] += -(gp[o + 1] - 0.45) * 0.15 * a * w;
      dsp[o + 2] += -gp[o + 2] * 0.05 * a * w;
    }
    const all = this._ring;
    for (let g = 0; g < T.gn; g++) all[g] = g;
    this._clampToEdges(all, T.gn);
    this._relax(all, T.gn, 2);
    this._writeBack();
    this.damage = clamp(this.damage + a * 0.5, 0, 1);
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    this.dirty = false;
  }

  reset() {
    this.cur.set(this.base);
    this.disp.fill(0);
    this.damage = 0;
    this.dirty = true;
    this.flush();
  }
}

/** Convert an impact in world space into the local space of a body. */
export function worldImpactToLocal(body, worldPoint, worldDir, outP, outD) {
  const inv = _invQ.copy(body.quat).invert();
  outP.copy(worldPoint).sub(body.pos).applyQuaternion(inv);
  outD.copy(worldDir).applyQuaternion(inv).normalize();
  return outP;
}
const _invQ = new THREE.Quaternion();
