// Procedural texture factory for Crashout. Everything is generated on <canvas>
// at load time -- no binary assets.
import * as THREE from 'three';
import { fbm, noise2, worley, mulberry32, clamp, smoothstep } from './rng.js';

let ANISO = 8;
export function setAnisotropy(a) { ANISO = a; }
export function getAnisotropy() { return ANISO; }

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, { repeat = [1, 1], srgb = false, aniso = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso ? ANISO : 1;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Build a tangent-space normal map canvas from a height field (Float32Array w*h, tileable). */
function normalFromHeight(height, w, h, strength = 2.0) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const at = (x, y) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function grayCanvas(w, h, fn) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = clamp(fn(x, y), 0, 1) * 255;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function rgbCanvas(w, h, fn) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const out = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      fn(x, y, out);
      const i = (y * w + x) * 4;
      d[i] = clamp(out[0], 0, 1) * 255;
      d[i + 1] = clamp(out[1], 0, 1) * 255;
      d[i + 2] = clamp(out[2], 0, 1) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ----------------------------------------------------------------- asphalt
export function makeAsphaltDetail(size = 512) {
  const P = 8; // noise period in noise-space -> tileable
  const height = new Float32Array(size * size);
  const alb = rgbCanvas(size, size, (x, y, o) => {
    const u = x / size, v = y / size;
    const nx = u * P, ny = v * P;
    // aggregate grain: worley pebbles + fbm dirt
    const w1 = worley(u, v, 42, 3).f1;
    const w2 = worley(u, v, 120, 7).f1;
    const grain = 1 - clamp(w2 * 2.4, 0, 1);
    const pebble = 1 - clamp(w1 * 2.6, 0, 1);
    const dirt = fbm(nx * 1.6, ny * 1.6, 5, 2, 0.55, P * 1.6) * 0.5 + 0.5;
    let base = 0.052 + dirt * 0.045 + pebble * 0.035 + grain * 0.03;
    // occasional lighter aggregate speckles
    const sp = noise2(nx * 30, ny * 30, P * 30);
    if (sp > 0.62) base += 0.07 * (sp - 0.62) * 6;
    // tar seams
    const seam = Math.abs(fbm(nx * 0.7 + 11, ny * 0.7 - 4, 3, 2, 0.5, 0));
    if (seam < 0.02) base *= 0.55;
    const h = pebble * 0.6 + grain * 0.25 + dirt * 0.3 + (sp > 0.62 ? 0.3 : 0);
    height[y * size + x] = h;
    o[0] = base * 1.0;
    o[1] = base * 1.01;
    o[2] = base * 1.08;
  });
  const nrm = normalFromHeight(height, size, size, 2.6);
  const rough = grayCanvas(size, size, (x, y) => {
    const u = x / size, v = y / size;
    const w2 = worley(u, v, 120, 7).f1;
    return 0.62 + (1 - clamp(w2 * 2.4, 0, 1)) * 0.28 + fbm(u * 12, v * 12, 3, 2, 0.5, 12) * 0.08;
  });
  return {
    map: tex(alb, { srgb: true }),
    normalMap: tex(nrm),
    roughnessMap: tex(rough),
  };
}

/**
 * Full-width road surface. U spans the entire carriageway, V repeats along
 * the direction of travel. Lane markings drawn with the 2D API so they're crisp.
 */
export function makeRoadSurface({ width = 2048, height = 2048, roadWidth = 26, segLen = 40 } = {}) {
  const c = canvas(width, height);
  const ctx = c.getContext('2d');
  // base asphalt
  const img = ctx.createImageData(width, height);
  const d = img.data;
  const hf = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width, v = y / height;
      const w2 = worley(u, v, 90, 11).f1;
      const w1 = worley(u, v, 34, 5).f1;
      const grain = 1 - clamp(w2 * 2.3, 0, 1);
      const pebble = 1 - clamp(w1 * 2.6, 0, 1);
      const dirt = fbm(u * 10, v * 10, 5, 2, 0.55, 10) * 0.5 + 0.5;
      const patch = smoothstep(0.42, 0.6, fbm(u * 3.1 + 5, v * 3.1 - 2, 3, 2, 0.5, 3));
      // real asphalt sits around 0.28-0.36 in sRGB (~0.06-0.10 linear); anything
      // darker reads as a black void once tone-mapped
      let base = 0.238 + dirt * 0.082 + pebble * 0.062 + grain * 0.046;
      base = base * (1 - patch * 0.22) + patch * 0.155;
      // darker wheel-worn tracks (2 per lane direction)
      const lane = u * roadWidth - roadWidth / 2;
      const trackDark =
        Math.exp(-Math.pow((Math.abs(lane) % 4.2) - 1.1, 2) / 0.6) * 0.35;
      base *= 1 - trackDark * 0.30;
      hf[y * width + x] = pebble * 0.55 + grain * 0.3 + dirt * 0.25 - patch * 0.35;
      const i = (y * width + x) * 4;
      d[i] = base * 255 * 1.0;
      d[i + 1] = base * 255 * 1.02;
      d[i + 2] = base * 255 * 1.05;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // ---- lane markings (world units -> px)
  const px = width / roadWidth;      // px per metre across
  const pz = height / segLen;        // px per metre along
  const X = (m) => (m + roadWidth / 2) * px;
  ctx.save();
  // Paint is opaque, not additive: 'lighter' pushed the centre line's red and
  // green channels into the clamp together, so a 250/200/66 traffic yellow
  // came out as 240/240/131 lime and the grade's cool shadow tint finished the
  // job by rendering it green.
  const paint = (xm, wm, dash, color = 'rgba(238,241,244,1.0)') => {
    ctx.fillStyle = color;
    const w = wm * px;
    if (!dash) {
      ctx.fillRect(X(xm) - w / 2, 0, w, height);
    } else {
      const on = 3.0 * pz, off = 6.0 * pz;
      for (let y = 0; y < height; y += on + off) ctx.fillRect(X(xm) - w / 2, y, w, on);
    }
  };
  // outer solid edges
  paint(-12.35, 0.30, false);
  paint(12.35, 0.30, false);
  // centre double yellow
  paint(-0.42, 0.22, false, 'rgba(228,168,38,1.0)');
  paint(0.42, 0.22, false, 'rgba(228,168,38,1.0)');
  // lane dashes: forward lanes at +4.1, +8.2 ; oncoming at -4.1, -8.2
  paint(4.1, 0.22, true);
  paint(8.2, 0.22, true);
  paint(-4.1, 0.22, true);
  paint(-8.2, 0.22, true);
  ctx.restore();

  // grime + wear over the paint so it doesn't look like a decal
  const grime = ctx.getImageData(0, 0, width, height);
  const gd = grime.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width, v = y / height;
      const wear = 0.82 + 0.18 * (fbm(u * 26, v * 26, 4, 2, 0.5, 26) * 0.5 + 0.5);
      const i = (y * width + x) * 4;
      gd[i] *= wear; gd[i + 1] *= wear; gd[i + 2] *= wear;
    }
  }
  ctx.putImageData(grime, 0, 0);

  const nrm = normalFromHeight(hf, width, height, 1.6);

  const rough = grayCanvas(width, height, (x, y) => {
    const u = x / width, v = y / height;
    const w2 = worley(u, v, 90, 11).f1;
    const lane = u * roadWidth - roadWidth / 2;
    const track = Math.exp(-Math.pow((Math.abs(lane) % 4.2) - 1.1, 2) / 0.6);
    return 0.80 + (1 - clamp(w2 * 2.3, 0, 1)) * 0.15 - track * 0.10;
  });

  return {
    map: tex(c, { srgb: true, repeat: [1, 1] }),
    normalMap: tex(nrm),
    roughnessMap: tex(rough),
  };
}

/** Large-scale wetness / puddle mask that rides on top of the road. */
export function makePuddleMask(size = 512) {
  const c = grayCanvas(size, size, (x, y) => {
    const u = x / size, v = y / size;
    const n = fbm(u * 4, v * 4, 4, 2, 0.55, 4) * 0.5 + 0.5;
    const n2 = fbm(u * 11 + 3, v * 11 - 7, 3, 2, 0.5, 11) * 0.5 + 0.5;
    return smoothstep(0.44, 0.68, n * 0.75 + n2 * 0.25);
  });
  return tex(c);
}

// ----------------------------------------------------------------- concrete
export function makeConcrete(size = 512, tint = 0.34) {
  const hf = new Float32Array(size * size);
  const alb = rgbCanvas(size, size, (x, y, o) => {
    const u = x / size, v = y / size;
    const n = fbm(u * 8, v * 8, 5, 2, 0.55, 8) * 0.5 + 0.5;
    const pit = worley(u, v, 60, 23).f1;
    const stain = smoothstep(0.5, 0.85, fbm(u * 2.4 + 9, v * 6.0 - 3, 4, 2, 0.6, 0));
    let g = tint * (0.78 + n * 0.4) - stain * 0.12;
    // vertical streaks
    g *= 1 - smoothstep(0.35, 0.0, Math.abs(noise2(u * 30, v * 1.2, 30))) * 0.12;
    if (pit < 0.12) g *= 0.8;
    hf[y * size + x] = n * 0.5 + (pit < 0.12 ? -0.5 : 0);
    o[0] = g; o[1] = g * 0.995; o[2] = g * 0.97;
  });
  const rough = grayCanvas(size, size, (x, y) => {
    const u = x / size, v = y / size;
    return 0.72 + (fbm(u * 14, v * 14, 3, 2, 0.5, 14) * 0.5 + 0.5) * 0.2;
  });
  return {
    map: tex(alb, { srgb: true }),
    normalMap: tex(normalFromHeight(hf, size, size, 1.6)),
    roughnessMap: tex(rough),
  };
}

// ------------------------------------------------------------ tunnel tile
export function makeTunnelTile(size = 512) {
  const hf = new Float32Array(size * size);
  const tilesX = 8, tilesY = 8;
  const alb = rgbCanvas(size, size, (x, y, o) => {
    const u = x / size, v = y / size;
    const tx = (u * tilesX) % 1, ty = (v * tilesY) % 1;
    const gx = Math.min(tx, 1 - tx), gy = Math.min(ty, 1 - ty);
    const grout = smoothstep(0.0, 0.035, Math.min(gx, gy));
    const n = fbm(u * 20, v * 20, 4, 2, 0.55, 20) * 0.5 + 0.5;
    const ti = Math.floor(u * tilesX) * 31 + Math.floor(v * tilesY) * 17;
    const varr = ((Math.sin(ti * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const grimeY = smoothstep(0.15, 0.85, v); // dirtier at the bottom
    let g = (0.62 + varr * 0.1) * (0.9 + n * 0.2);
    g *= 1 - grimeY * 0.55;
    g = g * grout + (1 - grout) * 0.16;
    hf[y * size + x] = grout * 0.8 + n * 0.15;
    o[0] = g * 1.0; o[1] = g * 1.0; o[2] = g * 0.95;
  });
  const rough = grayCanvas(size, size, (x, y) => {
    const u = x / size, v = y / size;
    const tx = (u * tilesX) % 1, ty = (v * tilesY) % 1;
    const gx = Math.min(tx, 1 - tx), gy = Math.min(ty, 1 - ty);
    const grout = smoothstep(0.0, 0.035, Math.min(gx, gy));
    return 0.85 - grout * 0.55 + smoothstep(0.2, 0.9, v) * 0.2;
  });
  return {
    map: tex(alb, { srgb: true }),
    normalMap: tex(normalFromHeight(hf, size, size, 2.2)),
    roughnessMap: tex(rough),
  };
}

// -------------------------------------------------------- building facades
export function makeFacade(seedN = 1, size = 512) {
  const r = mulberry32(0xbeef + seedN * 7717);
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const em = canvas(size, size);
  const ectx = em.getContext('2d');

  const style = seedN % 4;
  const wallShades = ['#1b1e26', '#20222a', '#171a20', '#262a33'];
  ctx.fillStyle = wallShades[style];
  ctx.fillRect(0, 0, size, size);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, size, size);

  // concrete noise on the wall
  const nimg = ctx.getImageData(0, 0, size, size);
  const nd = nimg.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const n = fbm(u * 9, v * 9, 4, 2, 0.55, 9) * 0.5 + 0.5;
      const i = (y * size + x) * 4;
      const k = 0.75 + n * 0.5;
      nd[i] *= k; nd[i + 1] *= k; nd[i + 2] *= k;
    }
  }
  ctx.putImageData(nimg, 0, 0);

  const cols = [10, 14, 8, 16][style];
  const rows = [14, 18, 11, 20][style];
  const cw = size / cols, ch = size / rows;
  const winW = cw * (style === 2 ? 0.82 : 0.6);
  const winH = ch * (style === 2 ? 0.72 : 0.52);

  const lightCols = [
    [255, 214, 150], [255, 236, 200], [190, 220, 255], [255, 180, 120], [150, 255, 220],
  ];

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = i * cw + (cw - winW) / 2;
      const y = j * ch + (ch - winH) / 2;
      // frame
      ctx.fillStyle = 'rgba(8,9,12,1)';
      ctx.fillRect(x - 2, y - 2, winW + 4, winH + 4);
      const lit = r() < 0.42;
      if (lit) {
        const lc = lightCols[Math.floor(r() * lightCols.length)];
        const inten = 0.35 + r() * 0.65;
        ctx.fillStyle = `rgb(${lc[0] * inten | 0},${lc[1] * inten | 0},${lc[2] * inten | 0})`;
        ctx.fillRect(x, y, winW, winH);
        const g = ectx.createLinearGradient(x, y, x, y + winH);
        g.addColorStop(0, `rgba(${lc[0]},${lc[1]},${lc[2]},${inten})`);
        g.addColorStop(1, `rgba(${lc[0]},${lc[1]},${lc[2]},${inten * 0.55})`);
        ectx.fillStyle = g;
        ectx.fillRect(x, y, winW, winH);
        // occupant silhouette
        if (r() < 0.16) {
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(x + winW * (0.2 + r() * 0.5), y + winH * 0.35, winW * 0.16, winH * 0.65);
        }
      } else {
        ctx.fillStyle = `rgba(${12 + r() * 10 | 0},${14 + r() * 12 | 0},${20 + r() * 14 | 0},1)`;
        ctx.fillRect(x, y, winW, winH);
      }
      // mullion
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x + winW / 2 - 1, y, 2, winH);
    }
  }
  // floor bands
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let j = 0; j < rows; j++) ctx.fillRect(0, j * ch, size, 2);

  return {
    map: tex(c, { srgb: true }),
    emissiveMap: tex(em, { srgb: true }),
  };
}

// ---------------------------------------------------------------- billboards
const AD_WORDS = [
  ['NITRO', 'HIGH OCTANE', '#ff2d6f', '#12061c'],
  ['VOLTA', 'ELECTRIC CITY', '#22e6ff', '#04121a'],
  ['CRASHOUT', 'DRIVE ANGRY', '#ffb020', '#1a0d02'],
  ['NEON KO', 'FIGHT NIGHT', '#b14bff', '#100425'],
  ['DIABLO 8', 'V8 SUPERCHARGED', '#ff3b1f', '#1c0603'],
  ['SODA POP', 'ICE COLD', '#3cff8e', '#03180d'],
  ['TAKEDOWN', 'RADIO 104.5', '#ff2ec4', '#1b0418'],
  ['ASPHALT', 'TYRE CO.', '#ffffff', '#0a0c12'],
];

export function makeBillboard(i, w = 512, h = 256) {
  const [big, small, fg, bg] = AD_WORDS[i % AD_WORDS.length];
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // gradient wash
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, fg + '33');
  g.addColorStop(1, '#00000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // scanlines
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
  ctx.textAlign = 'center';
  ctx.fillStyle = fg;
  ctx.shadowColor = fg;
  ctx.shadowBlur = 26;
  ctx.font = `900 ${h * 0.42}px Impact, "Arial Black", system-ui, sans-serif`;
  ctx.fillText(big, w / 2, h * 0.52);
  ctx.shadowBlur = 8;
  ctx.font = `700 ${h * 0.13}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(small, w / 2, h * 0.76);
  // border
  ctx.shadowBlur = 0;
  ctx.strokeStyle = fg;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);
  const t = tex(c, { srgb: true });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// -------------------------------------------------------------- car details
/** Metal-flake normal map for car paint. */
export function makeFlakeNormal(size = 256) {
  const r = mulberry32(4242);
  const hf = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) hf[i] = r() > 0.93 ? r() : 0;
  return tex(normalFromHeight(hf, size, size, 0.5), { repeat: [40, 40] });
}

/** Grime/AO overlay for car bodies and traffic. */
export function makeCarGrime(size = 256) {
  const c = grayCanvas(size, size, (x, y) => {
    const u = x / size, v = y / size;
    const n = fbm(u * 5, v * 5, 4, 2, 0.6, 5) * 0.5 + 0.5;
    return 0.7 + n * 0.3;
  });
  return tex(c);
}

// ------------------------------------------------------------------ sprites
export function makeSpriteGlow(size = 128, hardness = 2.2) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const R = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - R) / R, dy = (y - R) / R;
      const r = Math.hypot(dx, dy);
      const a = Math.pow(clamp(1 - r, 0, 1), hardness);
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeSmokeSprite(size = 256) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const R = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - R) / R, dy = (y - R) / R;
      const r = Math.hypot(dx, dy);
      const n = fbm(x / size * 6, y / size * 6, 5, 2, 0.55, 6) * 0.5 + 0.5;
      const a = clamp((1 - r) * 1.35, 0, 1);
      const v = clamp(Math.pow(a, 1.6) * (0.45 + n * 0.9), 0, 1);
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = v * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeFlareTexture(size = 256) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const R = size / 2;
  const g = ctx.createRadialGradient(R, R, 0, R, R, R);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.14, 'rgba(255,240,210,0.85)');
  g.addColorStop(0.4, 'rgba(255,190,120,0.25)');
  g.addColorStop(1, 'rgba(255,140,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // streaks
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(255,235,210,0.35)';
  ctx.lineWidth = 2;
  for (const ang of [0, Math.PI / 2]) {
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(ang);
    const lg = ctx.createLinearGradient(-R, 0, R, 0);
    lg.addColorStop(0, 'rgba(255,220,190,0)');
    lg.addColorStop(0.5, 'rgba(255,240,220,0.55)');
    lg.addColorStop(1, 'rgba(255,220,190,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(-R, -1.5, size, 3);
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Long soft streak used for speed lines and spark trails. */
export function makeStreakSprite(w = 128, h = 32) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  for (let y = 0; y < h; y++) {
    const a = Math.pow(1 - Math.abs((y - h / 2) / (h / 2)), 1.8);
    ctx.globalAlpha = a;
    ctx.fillRect(0, y, w, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// -------------------------------------------------------------------- misc
export function makeDirtGround(size = 512) {
  const hf = new Float32Array(size * size);
  const alb = rgbCanvas(size, size, (x, y, o) => {
    const u = x / size, v = y / size;
    const n = fbm(u * 7, v * 7, 5, 2, 0.55, 7) * 0.5 + 0.5;
    const n2 = worley(u, v, 26, 3).f1;
    const g = 0.045 + n * 0.05;
    hf[y * size + x] = n * 0.6 + (1 - n2) * 0.2;
    o[0] = g * 1.1; o[1] = g * 1.0; o[2] = g * 0.86;
  });
  return {
    map: tex(alb, { srgb: true }),
    normalMap: tex(normalFromHeight(hf, size, size, 2.0)),
  };
}

export function makeSkylineSprite(w = 2048, h = 512, seedN = 5) {
  const r = mulberry32(1000 + seedN * 31);
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  let x = 0;
  while (x < w) {
    const bw = 24 + r() * 90;
    const bh = h * (0.25 + r() * 0.7);
    ctx.fillStyle = `rgba(${8 + r() * 8 | 0},${10 + r() * 10 | 0},${20 + r() * 14 | 0},1)`;
    ctx.fillRect(x, h - bh, bw, bh);
    // windows
    const cols = Math.max(1, Math.floor(bw / 9));
    const rows = Math.max(1, Math.floor(bh / 12));
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (r() < 0.3) {
          const cc = r();
          ctx.fillStyle = cc < 0.6 ? 'rgba(255,214,150,0.85)' : cc < 0.85 ? 'rgba(190,220,255,0.8)' : 'rgba(255,120,180,0.8)';
          ctx.fillRect(x + i * 9 + 2, h - bh + j * 12 + 3, 4, 6);
        }
      }
    }
    // antenna
    if (r() < 0.25) {
      ctx.fillStyle = 'rgba(12,14,22,1)';
      ctx.fillRect(x + bw / 2 - 1, h - bh - 30 * r() - 10, 2, 40);
    }
    x += bw + r() * 8;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Simple sign / arrow decals for gantries and road signs. */
export function makeRoadSign(kind = 0, w = 512, h = 256) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0a3d1f';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#e8eef2';
  ctx.lineWidth = 5;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = '#e8eef2';
  ctx.textAlign = 'center';
  const texts = [
    ['DOWNTOWN', '3 KM'],
    ['TUNNEL', 'LIGHTS ON'],
    ['HARBOUR BRIDGE', 'NEXT EXIT'],
    ['CANYON PASS', 'CAUTION'],
  ];
  const [a, b] = texts[kind % texts.length];
  ctx.font = `800 ${h * 0.28}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(a, w / 2, h * 0.45);
  ctx.font = `600 ${h * 0.18}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(b, w / 2, h * 0.75);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Equirectangular-ish cloud sheet used on a sky dome. Alpha carries the cloud
 * cover; RGB carries a cheap two-tone lit/shadowed cumulus shading so the dome
 * reads as volume rather than a flat decal. `sunU` is the sun azimuth in 0..1.
 */
export function makeCloudSheet({ w = 1024, h = 512, cover = 0.46, sunU = 0.5, lit = [1.0, 0.86, 0.72], dark = [0.36, 0.40, 0.50] } = {}) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    // v: 0 at horizon, 1 at zenith
    const v = y / h;
    // fade clouds out at the very top and squash them near the horizon
    const band = smoothstep(0.02, 0.30, v) * (1 - smoothstep(0.72, 1.0, v));
    for (let x = 0; x < w; x++) {
      const u = x / w;
      // stretch along u so bands read as long streaks near the horizon
      const sx = u * 7.0;
      const sy = Math.pow(v, 0.62) * 3.4;
      let n = fbm(sx, sy, 6, 2.05, 0.55, 7) * 0.5 + 0.5;
      const wisp = fbm(sx * 3.1 + 11, sy * 3.1 - 4, 4, 2, 0.5, 21) * 0.5 + 0.5;
      n = n * 0.78 + wisp * 0.22;
      let a = smoothstep(1.0 - cover, 1.0 - cover + 0.26, n) * band;
      // vertical density gradient inside each cloud -> lit tops, dark bases
      const dens = smoothstep(0.0, 0.34, a);
      // cheap directional shading: sample the field slightly toward the sun
      const nS = fbm(sx + (sunU - u) * 0.55, sy + 0.20, 5, 2.05, 0.55, 7) * 0.5 + 0.5;
      const shade = clamp((n - nS) * 3.2 + 0.5, 0, 1);
      const k = clamp(shade * 0.75 + dens * 0.35, 0, 1);
      const r = dark[0] + (lit[0] - dark[0]) * k;
      const g = dark[1] + (lit[1] - dark[1]) * k;
      const b = dark[2] + (lit[2] - dark[2]) * k;
      const i = (y * w + x) * 4;
      d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255;
      d[i + 3] = clamp(a, 0, 1) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  t.needsUpdate = true;
  return t;
}

/** Low-frequency macro variation map: breaks up big tiled ground surfaces. */
export function makeMacroVariation(size = 256) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const a = fbm(u * 3, v * 3, 5, 2, 0.55, 3) * 0.5 + 0.5;
      const b = fbm(u * 9 + 4, v * 9 - 2, 4, 2, 0.5, 9) * 0.5 + 0.5;
      const i = (y * size + x) * 4;
      d[i] = a * 255;
      d[i + 1] = b * 255;
      d[i + 2] = smoothstep(0.42, 0.62, a * 0.7 + b * 0.3) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}

export { tex as _tex, canvas as _canvas };

