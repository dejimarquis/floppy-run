// Spline highway generator: a closed circuit with sweeping curves, elevation
// change, crests, banking, tunnels and bridges. Everything downstream (road
// mesh, scenery, physics, AI, minimap) works in track space (s = arc length
// along the centreline, x = lateral offset in metres) and converts to world
// space through `sample()`.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU } from './rng.js';

export const ROAD_HALF_WIDTH = 7.0; // 14 m carriageway
export const SHOULDER = 3.2;
export const CHUNK_LEN = 240;

const _v = new THREE.Vector3();

export class Track {
  constructor(seed = 1) {
    this.seed = seed;
    this.build();
  }

  shape(t, out) {
    const a = t * TAU;
    const R = 1180;
    const x =
      R * (Math.sin(a) + 0.44 * Math.sin(3 * a + 1.12) + 0.17 * Math.sin(5 * a + 2.31) + 0.07 * Math.sin(7 * a + 0.44));
    const z =
      R * (Math.cos(a) + 0.36 * Math.cos(2 * a + 0.61) + 0.21 * Math.cos(4 * a + 1.93) + 0.06 * Math.cos(6 * a + 2.77));
    const y =
      34 * Math.sin(a + 0.4) +
      19 * Math.sin(2 * a + 1.7) +
      9.5 * Math.sin(5 * a + 2.2) +
      5.0 * Math.sin(9 * a + 0.9) +
      2.4 * Math.sin(17 * a + 1.4);
    return out.set(x, y, z);
  }

  build() {
    // 1) dense parametric sampling -> arc-length table
    const M = 12000;
    const pts = new Float32Array(M * 3);
    const cum = new Float32Array(M + 1);
    const p = new THREE.Vector3();
    const prev = new THREE.Vector3();
    this.shape(0, prev);
    pts[0] = prev.x;
    pts[1] = prev.y;
    pts[2] = prev.z;
    for (let i = 1; i < M; i++) {
      this.shape(i / M, p);
      pts[i * 3] = p.x;
      pts[i * 3 + 1] = p.y;
      pts[i * 3 + 2] = p.z;
      cum[i] = cum[i - 1] + p.distanceTo(prev);
      prev.copy(p);
    }
    this.shape(0, p);
    cum[M] = cum[M - 1] + p.distanceTo(prev);
    const total = cum[M];

    // 2) uniform arc-length resample
    const step = 2.5;
    const N = Math.round(total / step);
    this.N = N;
    this.step = total / N;
    this.length = total;

    const pos = new Float32Array(N * 3);
    let j = 0;
    for (let i = 0; i < N; i++) {
      const target = (i * total) / N;
      while (j < M && cum[j + 1] < target) j++;
      const t0 = cum[j];
      const t1 = cum[j + 1];
      const f = t1 > t0 ? (target - t0) / (t1 - t0) : 0;
      const i0 = j % M;
      const i1 = (j + 1) % M;
      pos[i * 3] = lerp(pts[i0 * 3], pts[i1 * 3], f);
      pos[i * 3 + 1] = lerp(pts[i0 * 3 + 1], pts[i1 * 3 + 1], f);
      pos[i * 3 + 2] = lerp(pts[i0 * 3 + 2], pts[i1 * 3 + 2], f);
    }
    this.pos = pos;

    // 3) tangents, signed curvature, banking, frames
    const fwd = new Float32Array(N * 3);
    const curv = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = ((i - 1) + N) % N;
      const b = (i + 1) % N;
      let dx = pos[b * 3] - pos[a * 3];
      let dy = pos[b * 3 + 1] - pos[a * 3 + 1];
      let dz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const l = Math.hypot(dx, dy, dz) || 1;
      fwd[i * 3] = dx / l;
      fwd[i * 3 + 1] = dy / l;
      fwd[i * 3 + 2] = dz / l;
    }
    for (let i = 0; i < N; i++) {
      const b = (i + 1) % N;
      const ax = fwd[i * 3];
      const az = fwd[i * 3 + 2];
      const bx = fwd[b * 3];
      const bz = fwd[b * 3 + 2];
      curv[i] = (ax * bz - az * bx) / this.step;
    }
    // smooth curvature (banking should not chatter)
    const sm = new Float32Array(N);
    const K = 14;
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let k = -K; k <= K; k++) acc += curv[(i + k + N * 2) % N];
      sm[i] = acc / (2 * K + 1);
    }
    this.curv = sm;

    const bank = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      bank[i] = clamp(sm[i] * 780, -0.20, 0.20);
    }
    // smooth bank again
    const bank2 = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let k = -8; k <= 8; k++) acc += bank[(i + k + N * 2) % N];
      bank2[i] = acc / 17;
    }
    this.bank = bank2;

    const right = new Float32Array(N * 3);
    const up = new Float32Array(N * 3);
    const F = new THREE.Vector3();
    const R = new THREE.Vector3();
    const U = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const WUP = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < N; i++) {
      F.set(fwd[i * 3], fwd[i * 3 + 1], fwd[i * 3 + 2]);
      R.crossVectors(F, WUP).normalize();
      U.crossVectors(R, F).normalize();
      q.setFromAxisAngle(F, bank2[i]);
      R.applyQuaternion(q);
      U.applyQuaternion(q);
      right[i * 3] = R.x;
      right[i * 3 + 1] = R.y;
      right[i * 3 + 2] = R.z;
      up[i * 3] = U.x;
      up[i * 3 + 1] = U.y;
      up[i * 3 + 2] = U.z;
    }
    this.fwd = fwd;
    this.right = right;
    this.up = up;

    this.chunkCount = Math.max(1, Math.round(total / CHUNK_LEN));
    this.chunkLen = total / this.chunkCount;

    // 4) features placed at fractions of the lap
    this.tunnels = [
      { s0: 0.155 * total, s1: 0.155 * total + 300 },
      { s0: 0.615 * total, s1: 0.615 * total + 420 },
    ];
    this.bridges = [
      { s0: 0.335 * total, s1: 0.335 * total + 260 },
      { s0: 0.795 * total, s1: 0.795 * total + 210 },
    ];
    this.city = { s0: 0.87 * total, s1: 1.02 * total };
    this.startS = 0;
  }

  wrap(s) {
    const L = this.length;
    s %= L;
    return s < 0 ? s + L : s;
  }

  // shortest signed difference a - b on the loop
  delta(a, b) {
    const L = this.length;
    let d = (a - b) % L;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  index(s) {
    return this.wrap(s) / this.step;
  }

  sample(s, out = {}) {
    const fi = this.index(s);
    const i0 = Math.floor(fi) % this.N;
    const i1 = (i0 + 1) % this.N;
    const f = fi - Math.floor(fi);
    out.pos = out.pos || new THREE.Vector3();
    out.fwd = out.fwd || new THREE.Vector3();
    out.right = out.right || new THREE.Vector3();
    out.up = out.up || new THREE.Vector3();
    const P = this.pos;
    const F = this.fwd;
    const R = this.right;
    const U = this.up;
    out.pos.set(
      lerp(P[i0 * 3], P[i1 * 3], f),
      lerp(P[i0 * 3 + 1], P[i1 * 3 + 1], f),
      lerp(P[i0 * 3 + 2], P[i1 * 3 + 2], f)
    );
    out.fwd.set(lerp(F[i0 * 3], F[i1 * 3], f), lerp(F[i0 * 3 + 1], F[i1 * 3 + 1], f), lerp(F[i0 * 3 + 2], F[i1 * 3 + 2], f)).normalize();
    out.right
      .set(lerp(R[i0 * 3], R[i1 * 3], f), lerp(R[i0 * 3 + 1], R[i1 * 3 + 1], f), lerp(R[i0 * 3 + 2], R[i1 * 3 + 2], f))
      .normalize();
    out.up.set(lerp(U[i0 * 3], U[i1 * 3], f), lerp(U[i0 * 3 + 1], U[i1 * 3 + 1], f), lerp(U[i0 * 3 + 2], U[i1 * 3 + 2], f)).normalize();
    out.bank = lerp(this.bank[i0], this.bank[i1], f);
    out.curv = lerp(this.curv[i0], this.curv[i1], f);
    return out;
  }

  // world position for track coords
  toWorld(s, x, h = 0, out = new THREE.Vector3()) {
    const sm = this.sample(s, this._tmp || (this._tmp = {}));
    out.copy(sm.pos).addScaledVector(sm.right, x).addScaledVector(sm.up, h);
    return out;
  }

  slope(s) {
    const sm = this.sample(s, this._tmp2 || (this._tmp2 = {}));
    return sm.fwd.y;
  }

  // rate of change of slope — used to launch bikes off crests
  crest(s) {
    const d = 12;
    return (this.slope(s + d) - this.slope(s - d)) / (2 * d);
  }

  inTunnel(s) {
    const w = this.wrap(s);
    for (const t of this.tunnels) if (w >= t.s0 && w <= t.s1) return t;
    return null;
  }
  nearTunnel(s, pad = 60) {
    const w = this.wrap(s);
    for (const t of this.tunnels) if (w >= t.s0 - pad && w <= t.s1 + pad) return t;
    return null;
  }
  inBridge(s) {
    const w = this.wrap(s);
    for (const b of this.bridges) if (w >= b.s0 && w <= b.s1) return b;
    return null;
  }
  inCity(s) {
    const w = this.wrap(s);
    return w >= this.city.s0 % this.length || w <= this.city.s1 % this.length;
  }

  // terrain height offset relative to the road plane at lateral distance x
  terrainProfile(s, x) {
    const ax = Math.abs(x);
    if (this.inBridge(s)) {
      // deep gorge under the bridge
      const d = smoothstep(ROAD_HALF_WIDTH + 4, ROAD_HALF_WIDTH + 26, ax);
      return -d * 62;
    }
    const t = smoothstep(ROAD_HALF_WIDTH, ROAD_HALF_WIDTH + SHOULDER, ax);
    const ditch = -1.35 * t * (1 - smoothstep(ROAD_HALF_WIDTH + SHOULDER, ROAD_HALF_WIDTH + SHOULDER + 9, ax));
    return ditch;
  }

  // minimap polyline (normalised 0..1 box)
  minimapPath(samples = 220) {
    const out = [];
    let minX = 1e9;
    let maxX = -1e9;
    let minZ = 1e9;
    let maxZ = -1e9;
    for (let i = 0; i < samples; i++) {
      const s = (i / samples) * this.length;
      const idx = Math.floor(this.index(s)) % this.N;
      const x = this.pos[idx * 3];
      const z = this.pos[idx * 3 + 2];
      out.push([x, z]);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const sx = maxX - minX || 1;
    const sz = maxZ - minZ || 1;
    const sc = Math.max(sx, sz);
    return {
      points: out.map(([x, z]) => [(x - minX) / sc, (z - minZ) / sc]),
      project: (x, z) => [(x - minX) / sc, (z - minZ) / sc],
      bounds: { minX, minZ, sc },
    };
  }
}

export function worldUpAt(track, s) {
  return track.sample(s, {}).up.clone();
}

export { _v };
