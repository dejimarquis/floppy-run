// Deterministic RNG + noise utilities for Crashout.

export function mulberry32(a) {
  let t = a >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), 1 | x);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed = 1337) {
    this.reseed(seed);
  }
  reseed(seed) {
    this.seed = seed >>> 0;
    this._r = mulberry32(this.seed);
  }
  next() {
    return this._r();
  }
  range(a, b) {
    return a + (b - a) * this._r();
  }
  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }
  pick(arr) {
    return arr[Math.floor(this._r() * arr.length) % arr.length];
  }
  sign() {
    return this._r() < 0.5 ? -1 : 1;
  }
  gauss(mean = 0, sd = 1) {
    let u = 0, v = 0;
    while (u === 0) u = this._r();
    while (v === 0) v = this._r();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

export const rng = new RNG(20260728);

// ---------------------------------------------------------------- value noise
const PERM = new Uint8Array(512);
export function buildPerm(seed = 9871) {
  const r = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
buildPerm();

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + (b - a) * t; }

function grad2(hash, x, y) {
  switch (hash & 7) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    case 3: return -x - y;
    case 4: return x;
    case 5: return -x;
    case 6: return y;
    default: return -y;
  }
}

/** Perlin-ish gradient noise, tileable over `period` when provided. */
export function noise2(x, y, period = 0) {
  let X = Math.floor(x), Y = Math.floor(y);
  const xf = x - X, yf = y - Y;
  if (period > 0) { X = ((X % period) + period) % period; Y = ((Y % period) + period) % period; }
  const X1 = period > 0 ? (X + 1) % period : X + 1;
  const Y1 = period > 0 ? (Y + 1) % period : Y + 1;
  const u = fade(xf), v = fade(yf);
  const aa = PERM[(PERM[X & 255] + Y) & 255];
  const ab = PERM[(PERM[X & 255] + Y1) & 255];
  const ba = PERM[(PERM[X1 & 255] + Y) & 255];
  const bb = PERM[(PERM[X1 & 255] + Y1) & 255];
  const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
  const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
  return lerp(x1, x2, v); // ~[-1,1]
}

export function fbm(x, y, octaves = 5, lacunarity = 2, gain = 0.5, period = 0) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq, period ? period * freq : 0);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function ridged(x, y, octaves = 4, period = 0) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(x * freq, y * freq, period ? period * freq : 0));
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Tileable worley / cellular noise -> distance to nearest feature point (0..1). */
export function worley(x, y, cells = 8, seed = 17) {
  const r = mulberry32(seed);
  // cheap deterministic hash instead of storing a point grid
  const hash = (i, j) => {
    let h = (i * 374761393 + j * 668265263 + seed * 2246822519) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    return h;
  };
  const fx = x * cells, fy = y * cells;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  let best = 1e9, best2 = 1e9;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const cx = ix + di, cy = iy + dj;
      const wx = ((cx % cells) + cells) % cells;
      const wy = ((cy % cells) + cells) % cells;
      const h = hash(wx, wy);
      const px = cx + ((h & 1023) / 1023);
      const py = cy + (((h >>> 10) & 1023) / 1023);
      const dx = px - fx, dy = py - fy;
      const d = dx * dx + dy * dy;
      if (d < best) { best2 = best; best = d; } else if (d < best2) best2 = d;
    }
  }
  void r;
  return { f1: Math.sqrt(best), f2: Math.sqrt(best2) };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const lerpF = lerp;
