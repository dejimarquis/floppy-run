// Procedural race circuit: closed spline with banking, elevation and tagged
// sections (city / tunnel / bridge / canyon / open highway).
import * as THREE from 'three';
import { clamp } from './rng.js';

export const ROAD_HALF = 13.0;      // carriageway half-width (metres)
export const VERGE = 2.6;           // shoulder width outside the carriageway
export const BARRIER_U = ROAD_HALF + VERGE - 0.35;
export const ROAD_SEG_LEN = 40;     // metres per road-texture V repeat

const SECTIONS = [
  { a: 0.000, b: 0.115, kind: 'open' },
  { a: 0.115, b: 0.300, kind: 'city' },
  { a: 0.300, b: 0.372, kind: 'tunnel' },
  { a: 0.372, b: 0.500, kind: 'open' },
  { a: 0.500, b: 0.578, kind: 'bridge' },
  { a: 0.578, b: 0.716, kind: 'canyon' },
  { a: 0.716, b: 0.782, kind: 'tunnel' },
  { a: 0.782, b: 1.000, kind: 'city' },
];

export class Track {
  constructor(seed = 1) {
    this.build(seed);
  }

  build(seed) {
    const R = 640;
    const NC = 2048;
    const raw = [];
    // deterministic phase offsets from the seed
    const ph = (k) => ((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1 * Math.PI * 2;
    const p1 = ph(1), p2 = ph(2), p3 = ph(3), p4 = ph(4), p5 = ph(5), p6 = ph(6);
    for (let i = 0; i < NC; i++) {
      const th = (i / NC) * Math.PI * 2;
      const r =
        R * (1 + 0.30 * Math.sin(3 * th + p1) + 0.13 * Math.sin(5 * th + p2) + 0.06 * Math.sin(8 * th + p3));
      const y =
        24 * Math.sin(2 * th + p4) + 10 * Math.sin(5 * th + p5) + 4.5 * Math.sin(11 * th + p6);
      raw.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
    }

    // arc-length parameterise
    let total = 0;
    const cum = [0];
    for (let i = 1; i <= NC; i++) {
      total += raw[i % NC].distanceTo(raw[i - 1]);
      cum.push(total);
    }
    this.length = total;

    const step = 2.5;
    const N = Math.floor(total / step);
    this.N = N;
    this.step = total / N;

    const pos = new Float32Array(N * 3);
    let ci = 0;
    for (let i = 0; i < N; i++) {
      const target = i * this.step;
      while (ci < NC && cum[ci + 1] < target) ci++;
      const t = (target - cum[ci]) / Math.max(1e-6, cum[ci + 1] - cum[ci]);
      const a = raw[ci % NC], b = raw[(ci + 1) % NC];
      pos[i * 3] = a.x + (b.x - a.x) * t;
      pos[i * 3 + 1] = a.y + (b.y - a.y) * t;
      pos[i * 3 + 2] = a.z + (b.z - a.z) * t;
    }

    // tangents / frames
    const tan = new Float32Array(N * 3);
    const right = new Float32Array(N * 3);
    const up = new Float32Array(N * 3);
    const curv = new Float32Array(N);
    const bank = new Float32Array(N);

    const va = new THREE.Vector3(), vb = new THREE.Vector3(), t3 = new THREE.Vector3();
    const r3 = new THREE.Vector3(), u3 = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);

    const P = (i, v) => v.set(pos[((i % N) + N) % N * 3], pos[((i % N) + N) % N * 3 + 1], pos[((i % N) + N) % N * 3 + 2]);

    for (let i = 0; i < N; i++) {
      P(i + 1, va); P(i - 1, vb);
      t3.subVectors(va, vb).normalize();
      tan[i * 3] = t3.x; tan[i * 3 + 1] = t3.y; tan[i * 3 + 2] = t3.z;
    }
    // curvature = signed rate of turn in the horizontal plane
    for (let i = 0; i < N; i++) {
      const i0 = ((i - 2) + N) % N, i1 = (i + 2) % N;
      const ax = tan[i0 * 3], az = tan[i0 * 3 + 2];
      const bx = tan[i1 * 3], bz = tan[i1 * 3 + 2];
      const cross = ax * bz - az * bx;
      curv[i] = cross / (4 * this.step);
    }
    // smooth curvature -> smooth banking
    const cs = new Float32Array(N);
    const K = 12;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -K; k <= K; k++) s += curv[((i + k) % N + N) % N];
      cs[i] = s / (2 * K + 1);
    }
    for (let i = 0; i < N; i++) {
      // Positive curvature turns toward the frame's +right, so the road must
      // roll the +right (inside) edge DOWN: a positive bank angle. The old
      // negated form banked every corner outward and slid cars off the road.
      // Positive curvature turns toward the frame's +right, so the inside edge
      // is +right and must roll DOWN -> positive bank. Kept shallow: the arcade
      // tyre model treats camber as a straight lateral bias, so deep banking
      // just slides cars sideways.
      bank[i] = clamp(cs[i] * 110, -0.075, 0.075);
      t3.set(tan[i * 3], tan[i * 3 + 1], tan[i * 3 + 2]);
      r3.crossVectors(t3, Y).normalize();
      u3.crossVectors(r3, t3).normalize();
      // rotate frame about the tangent by the bank angle
      const q = new THREE.Quaternion().setFromAxisAngle(t3, bank[i]);
      r3.applyQuaternion(q); u3.applyQuaternion(q);
      right[i * 3] = r3.x; right[i * 3 + 1] = r3.y; right[i * 3 + 2] = r3.z;
      up[i * 3] = u3.x; up[i * 3 + 1] = u3.y; up[i * 3 + 2] = u3.z;
    }

    this.pos = pos; this.tan = tan; this.right = right; this.up = up;
    this.curv = cs; this.bank = bank;

    // section lookup per sample
    this.section = new Array(N);
    for (let i = 0; i < N; i++) {
      const t = i / N;
      let kind = 'open';
      for (const s of SECTIONS) if (t >= s.a && t < s.b) { kind = s.kind; break; }
      this.section[i] = kind;
    }
    this.sections = SECTIONS.map((s) => ({
      kind: s.kind,
      i0: Math.floor(s.a * N),
      i1: Math.floor(s.b * N),
      s0: s.a * total,
      s1: s.b * total,
    }));

    // angular index for fast nearest lookup (route is star-shaped about origin)
    this.angleIndex = new Int32Array(4096);
    for (let i = 0; i < N; i++) {
      const a = Math.atan2(pos[i * 3 + 2], pos[i * 3]);
      const bucket = Math.floor(((a / (Math.PI * 2)) + 1) % 1 * 4096) % 4096;
      this.angleIndex[bucket] = i;
    }
    // fill gaps
    let last = 0;
    for (let b = 0; b < 4096; b++) if (this.angleIndex[b] === 0 && b > 0) this.angleIndex[b] = last; else last = this.angleIndex[b];
  }

  idxFromS(s) {
    const N = this.N;
    let i = Math.floor((((s % this.length) + this.length) % this.length) / this.step);
    return ((i % N) + N) % N;
  }

  wrapS(s) { return ((s % this.length) + this.length) % this.length; }

  /** Shortest signed difference a-b along the loop. */
  deltaS(a, b) {
    let d = this.wrapS(a) - this.wrapS(b);
    if (d > this.length / 2) d -= this.length;
    if (d < -this.length / 2) d += this.length;
    return d;
  }

  sample(i, out) {
    const N = this.N;
    const k = ((i % N) + N) % N;
    out.pos.set(this.pos[k * 3], this.pos[k * 3 + 1], this.pos[k * 3 + 2]);
    out.tan.set(this.tan[k * 3], this.tan[k * 3 + 1], this.tan[k * 3 + 2]);
    out.right.set(this.right[k * 3], this.right[k * 3 + 1], this.right[k * 3 + 2]);
    out.up.set(this.up[k * 3], this.up[k * 3 + 1], this.up[k * 3 + 2]);
    out.curv = this.curv[k];
    out.bank = this.bank[k];
    out.kind = this.section[k];
    return out;
  }

  /** Interpolated frame at arc length s. */
  frameAt(s, out) {
    const f = this.wrapS(s) / this.step;
    const i = Math.floor(f);
    const t = f - i;
    this.sample(i, out);
    const b = _tmpFrame;
    this.sample(i + 1, b);
    out.pos.lerp(b.pos, t);
    out.tan.lerp(b.tan, t).normalize();
    out.right.lerp(b.right, t).normalize();
    out.up.lerp(b.up, t).normalize();
    out.curv = out.curv + (b.curv - out.curv) * t;
    out.bank = out.bank + (b.bank - out.bank) * t;
    return out;
  }

  /** World position for (s, lateral offset u, height above surface). */
  posAt(s, u, h, out) {
    const f = this.frameAt(s, _tmpFrame2);
    out.copy(f.pos).addScaledVector(f.right, u);
    if (h) out.addScaledVector(f.up, h);
    return out;
  }

  /** Nearest track coordinate for a world point. `hint` = previous sample index. */
  project(x, z, hint = -1) {
    const N = this.N;
    let base;
    if (hint >= 0) base = ((hint % N) + N) % N;
    else {
      const a = Math.atan2(z, x);
      base = this.angleIndex[Math.floor(((a / (Math.PI * 2)) + 1) % 1 * 4096) % 4096];
    }
    let bestI = base, bestD = Infinity;
    const W = hint >= 0 ? 18 : 120;
    for (let k = -W; k <= W; k++) {
      const i = ((base + k) % N + N) % N;
      const dx = x - this.pos[i * 3], dz = z - this.pos[i * 3 + 2];
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; bestI = i; }
    }
    const i = bestI;
    const dx = x - this.pos[i * 3], dz = z - this.pos[i * 3 + 2];
    // along-track refinement
    const tx = this.tan[i * 3], tz = this.tan[i * 3 + 2];
    const tl = Math.hypot(tx, tz) || 1;
    const along = (dx * tx + dz * tz) / tl;
    // lateral in the horizontal plane
    const rx = this.right[i * 3], rz = this.right[i * 3 + 2];
    const rl = Math.hypot(rx, rz) || 1;
    const u = (dx * rx + dz * rz) / rl;
    const s = this.wrapS(i * this.step + along);
    // surface height along the banked frame
    const ry = this.right[i * 3 + 1] / rl;
    const ty = this.tan[i * 3 + 1] / tl;
    const y = this.pos[i * 3 + 1] + ry * u + ty * along;
    return { i, s, u, y, along };
  }

  surface(x, z, hint = -1, out = _surf) {
    const p = this.project(x, z, hint);
    out.i = p.i; out.s = p.s; out.u = p.u; out.y = p.y;
    out.nx = this.up[p.i * 3]; out.ny = this.up[p.i * 3 + 1]; out.nz = this.up[p.i * 3 + 2];
    out.kind = this.section[p.i];
    return out;
  }

  /** Heading (yaw) of the road at sample index i. */
  headingAt(i) {
    const N = this.N;
    const k = ((i % N) + N) % N;
    return Math.atan2(this.tan[k * 3], this.tan[k * 3 + 2]);
  }
}

export function makeFrame() {
  return {
    pos: new THREE.Vector3(), tan: new THREE.Vector3(),
    right: new THREE.Vector3(), up: new THREE.Vector3(),
    curv: 0, bank: 0, kind: 'open',
  };
}
const _tmpFrame = makeFrame();
const _tmpFrame2 = makeFrame();
const _surf = { i: 0, s: 0, u: 0, y: 0, nx: 0, ny: 1, nz: 0, kind: 'open' };
