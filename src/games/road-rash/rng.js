// Deterministic RNG + noise toolkit for Asphalt Fury.
// Everything procedural in the game pulls from here so `seed(n)` reproduces a world exactly.

export function mulberry32(a) {
  a = a >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed = 1337) {
    this.reseed(seed);
  }
  reseed(seed) {
    this.seedValue = seed >>> 0;
    this._r = mulberry32(this.seedValue);
    return this;
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
  chance(p) {
    return this._r() < p;
  }
  // Gaussian-ish via sum of uniforms (cheap, plenty good).
  gauss(mean = 0, sd = 1) {
    const u = this._r() + this._r() + this._r() + this._r() + this._r() + this._r();
    return mean + (u - 3) * sd * 0.7071;
  }
}

// ---------------------------------------------------------------------------
// Hash / value noise
// ---------------------------------------------------------------------------

export function hash2(x, y, seed = 0) {
  let h = x * 374761393 + y * 668265263 + seed * 1274126177;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function hash3(x, y, z, seed = 0) {
  let h = x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1274126177;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export function valueNoise2(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = smooth(xf);
  const v = smooth(yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

// Tileable value noise over a `period` grid — vital so textures don't seam.
export function tileNoise2(x, y, period, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = smooth(xf);
  const v = smooth(yf);
  const w = (n) => ((n % period) + period) % period;
  const x0 = w(xi);
  const x1 = w(xi + 1);
  const y0 = w(yi);
  const y1 = w(yi + 1);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export function fbmTile(x, y, period, octaves = 5, seed = 0, gain = 0.5, lac = 2) {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let p = period;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * tileNoise2(x * f, y * f, p * f, seed + i * 977);
    norm += amp;
    amp *= gain;
    f *= lac;
  }
  return sum / norm;
}

export function fbm2(x, y, octaves = 5, seed = 0, gain = 0.5, lac = 2) {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * f, y * f, seed + i * 977);
    norm += amp;
    amp *= gain;
    f *= lac;
  }
  return sum / norm;
}

export function ridged(x, y, octaves = 5, seed = 0) {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise2(x * f, y * f, seed + i * 331) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

// Tileable worley / cellular — used for asphalt aggregate and cracked concrete.
export function worleyTile(x, y, period, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let d1 = 1e9;
  let d2 = 1e9;
  const w = (n) => ((n % period) + period) % period;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox;
      const cy = yi + oy;
      const px = cx + hash2(w(cx), w(cy), seed);
      const py = cy + hash2(w(cx), w(cy), seed + 7919);
      const dx = px - x;
      const dy = py - y;
      const d = dx * dx + dy * dy;
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return { f1: Math.sqrt(d1), f2: Math.sqrt(d2) };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;
