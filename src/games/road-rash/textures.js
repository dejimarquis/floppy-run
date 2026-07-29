// Procedural texture factory. Everything is generated on a <canvas> at boot —
// no binary assets, no network. Layered fbm / worley / gradients so surfaces read
// as real materials rather than tiled noise.
import * as THREE from 'three';
import { fbmTile, worleyTile, tileNoise2, clamp, lerp, smoothstep, hash2 } from './rng.js';

const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tex(c, { repeat = [1, 1], srgb = false, aniso = 16, wrap = THREE.RepeatWrapping } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = wrap;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// Convert a Float32Array height field to a tangent-space normal map texture.
function heightToNormal(height, w, h, strength = 2.0) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const at = (x, y) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
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

function grayCanvas(data, w, h) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = clamp(data[i], 0, 1) * 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------------------
// ROAD  — u spans the full carriageway width, v tiles every ROAD_TEX_METERS
// ---------------------------------------------------------------------------
export const ROAD_TEX_METERS = 16;

function roadSurface(S) {
  const w = S;
  const h = S;
  const albedo = canvas(w, h);
  const actx = albedo.getContext('2d');
  const img = actx.createImageData(w, h);
  const d = img.data;
  const height = new Float32Array(w * h);
  const rough = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const i = y * w + x;

      // aggregate stones
      const wx = u * 230;
      const wy = v * 230;
      const cell = worleyTile(wx, wy, 230, 11);
      const stone = smoothstep(0.015, 0.20, cell.f2 - cell.f1);
      const grain = fbmTile(u * 150, v * 150, 150, 4, 33);
      const fine = tileNoise2(u * 300, v * 300, 300, 77);
      // repaving patches & tar seams
      const macro = fbmTile(u * 3.1, v * 3.1, 4, 4, 5);
      const patch = smoothstep(0.52, 0.60, macro) * 0.5;
      // longitudinal tar seam near the crown
      const seam = smoothstep(0.006, 0.0, Math.abs(u - 0.5) - 0.004) * 0.8;
      // polished wheel tracks (4 of them, 2 per direction)
      let polish = 0;
      for (const c of [0.155, 0.345, 0.655, 0.845]) {
        polish = Math.max(polish, smoothstep(0.075, 0.012, Math.abs(u - c)));
      }
      polish *= 0.55 + 0.45 * fbmTile(u * 6, v * 2.2, 8, 3, 91);

      // cracks
      const cr = worleyTile(u * 34 + 3, v * 34, 34, 41);
      const crack = smoothstep(0.018, 0.0, cr.f2 - cr.f1) * smoothstep(0.5, 0.78, fbmTile(u * 2, v * 2, 2, 3, 12));

      let lum = 0.062 + stone * 0.058 + grain * 0.058 + fine * 0.02;
      lum += patch * 0.03;
      lum -= polish * 0.022;
      lum -= crack * 0.035;
      lum -= seam * 0.03;
      lum = clamp(lum, 0.01, 0.35);

      // slightly blue-cool asphalt, warmer where worn
      const r = lum * (1.0 + polish * 0.06 + patch * 0.05);
      const g = lum * 1.005;
      const b = lum * (1.06 - polish * 0.05);

      const o = i * 4;
      d[o] = clamp(r, 0, 1) * 255;
      d[o + 1] = clamp(g, 0, 1) * 255;
      d[o + 2] = clamp(b, 0, 1) * 255;
      d[o + 3] = 255;

      height[i] = stone * 0.13 + grain * 0.16 + fine * 0.10 - crack * 0.7 - seam * 0.3;
      rough[i] = clamp(0.93 - polish * 0.34 - patch * 0.07 + (grain - 0.5) * 0.16 + crack * 0.05, 0.2, 1);
    }
  }
  actx.putImageData(img, 0, 0);

  // ---- lane markings, drawn crisply on top -------------------------------
  const markCtx = actx;
  markCtx.save();
  const paint = (x0, x1, y0, y1, color, alpha) => {
    markCtx.globalAlpha = alpha;
    markCtx.fillStyle = color;
    markCtx.fillRect(x0 * w, y0 * h, (x1 - x0) * w, (y1 - y0) * h);
  };
  // edge lines
  const wearRow = (u0, u1, y0, y1, color) => {
    const px0 = Math.floor(u0 * w);
    const px1 = Math.ceil(u1 * w);
    const py0 = Math.floor(y0 * h);
    const py1 = Math.ceil(y1 * h);
    const ii = markCtx.getImageData(px0, py0, Math.max(1, px1 - px0), Math.max(1, py1 - py0));
    const dd = ii.data;
    const iw = px1 - px0;
    for (let y = 0; y < py1 - py0; y++) {
      for (let x = 0; x < iw; x++) {
        const gx = (px0 + x) / w;
        const gy = (py0 + y) / h;
        const wear = clamp(fbmTile(gx * 40, gy * 40, 40, 4, 210) * 1.5 - 0.18, 0, 1);
        const scuff = fbmTile(gx * 130, gy * 130, 130, 3, 55);
        const a = clamp(wear * (0.55 + scuff * 0.7), 0, 1);
        const o = (y * iw + x) * 4;
        dd[o] = lerp(dd[o], color[0] * (0.8 + scuff * 0.35), a);
        dd[o + 1] = lerp(dd[o + 1], color[1] * (0.8 + scuff * 0.35), a);
        dd[o + 2] = lerp(dd[o + 2], color[2] * (0.8 + scuff * 0.35), a);
        // markings are smoother + brighter
        const gi = (py0 + y) * w + (px0 + x);
        rough[gi] = lerp(rough[gi], 0.42, a);
        height[gi] += a * 0.10;
      }
    }
    markCtx.putImageData(ii, px0, py0);
  };
  const WHITE = [242, 244, 238];
  const YELLOW = [232, 176, 42];
  wearRow(0.038, 0.056, 0, 1, WHITE);
  wearRow(0.944, 0.962, 0, 1, WHITE);
  wearRow(0.4855, 0.4985, 0, 1, YELLOW);
  wearRow(0.5015, 0.5145, 0, 1, YELLOW);
  // dashed lane dividers: one 4 m dash per 16 m tile
  wearRow(0.2455, 0.2585, 0.03, 0.28, WHITE);
  wearRow(0.2455, 0.2585, 0.53, 0.78, WHITE);
  wearRow(0.7415, 0.7545, 0.03, 0.28, WHITE);
  wearRow(0.7415, 0.7545, 0.53, 0.78, WHITE);
  markCtx.restore();
  void paint;

  return {
    map: tex(albedo, { srgb: true }),
    normalMap: tex(heightToNormal(height, w, h, 0.55)),
    roughnessMap: tex(grayCanvas(rough, w, h)),
  };
}

// Small tileable detail sheet multiplied over the road at a different scale so
// the 16 m tile never reads as a repeat.
function detailSheet(S) {
  const d = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const n = fbmTile(u * 14, v * 14, 14, 5, 303);
      const c = worleyTile(u * 34, v * 34, 34, 909);
      d[y * S + x] = clamp(0.5 + (n - 0.5) * 0.9 + (c.f2 - c.f1 - 0.2) * 0.35, 0, 1);
    }
  }
  return tex(grayCanvas(d, S, S));
}

function macroSheet(S) {
  const d = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const n = fbmTile(u * 3, v * 3, 3, 5, 71);
      d[y * S + x] = clamp(0.5 + (n - 0.5) * 1.6, 0, 1);
    }
  }
  return tex(grayCanvas(d, S, S));
}

// ---------------------------------------------------------------------------
// TERRAIN
// ---------------------------------------------------------------------------
function terrainSheet(S) {
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const i = y * S + x;
      const blades = fbmTile(u * 150, v * 150, 150, 3, 8);
      const clump = fbmTile(u * 11, v * 11, 11, 5, 22);
      const patch = fbmTile(u * 2.3, v * 2.3, 3, 4, 61);
      const dirt = smoothstep(0.44, 0.66, fbmTile(u * 5, v * 5, 5, 4, 88));
      const dry = smoothstep(0.36, 0.78, clump * 0.62 + patch * 0.38);
      // Olive/khaki scrub, not saturated lawn green. Anything with a blue
      // component above ~0.09 goes purple once the sky IBL lands on it.
      let r = lerp(0.105, 0.315, dry);
      let g = lerp(0.132, 0.288, dry);
      let b = lerp(0.058, 0.128, dry);
      r = lerp(r, 0.255, dirt);
      g = lerp(g, 0.196, dirt);
      b = lerp(b, 0.128, dirt);
      // Low-frequency tonal drift so the sheet does not read as one flat hue
      const drift = 0.86 + patch * 0.30;
      r *= drift;
      g *= drift;
      b *= drift * 0.96;
      const shade = 0.86 + blades * 0.26;
      const o = i * 4;
      d[o] = clamp(r * shade, 0, 1) * 255;
      d[o + 1] = clamp(g * shade, 0, 1) * 255;
      d[o + 2] = clamp(b * shade, 0, 1) * 255;
      d[o + 3] = 255;
      height[i] = blades * 0.7 + clump * 0.3;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: tex(c, { srgb: true }), normalMap: tex(heightToNormal(height, S, S, 1.1)) };
}

// ---------------------------------------------------------------------------
// SKY
// ---------------------------------------------------------------------------
// Cumulus deck for the overhead cloud plane. Two fbm octave sets are combined:
// a low-frequency mass that decides where clouds exist at all, and a
// high-frequency erosion pass that eats the edges so they cauliflower instead
// of blobbing. Alpha only - the plane is lit by a flat emissive tint.
function cloudSheet(S) {
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const mass = fbmTile(u * 3, v * 3, 3, 5, 91);
      const erode = fbmTile(u * 13, v * 13, 13, 4, 17);
      const detail = fbmTile(u * 31, v * 31, 31, 3, 55);
      let a = smoothstep(0.50, 0.69, mass) * 1.25 - erode * 0.38 - detail * 0.12;
      a = clamp(a, 0, 1);
      a = Math.pow(a, 1.15);
      // vertical shading: bright tops, grey shadowed bases
      const lit = clamp(0.30 + (mass - erode * 0.62) * 1.35, 0, 1);
      const o = (y * S + x) * 4;
      d[o] = 255 * (0.50 + lit * 0.50);
      d[o + 1] = 255 * (0.53 + lit * 0.47);
      d[o + 2] = 255 * (0.60 + lit * 0.40);
      d[o + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { srgb: true });
}

// ---------------------------------------------------------------------------
// METAL / CONCRETE
// ---------------------------------------------------------------------------
function guardrailSheet(S) {
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const i = y * S + x;
      const brush = tileNoise2(u * 400, v * 6, 400, 3);
      const grime = fbmTile(u * 9, v * 9, 9, 4, 44);
      const rust = clamp(smoothstep(0.70, 0.93, fbmTile(u * 13 + 2, v * 13, 13, 5, 131)) * (0.25 + grime * 0.6), 0, 1) * 0.55;
      const scratch = smoothstep(0.86, 1.0, tileNoise2(u * 60, v * 800, 60, 17));
      let r = lerp(0.46, 0.36, grime);
      let g = lerp(0.48, 0.38, grime);
      let b = lerp(0.50, 0.40, grime);
      r = lerp(r, 0.27, rust);
      g = lerp(g, 0.18, rust);
      b = lerp(b, 0.12, rust);
      const sh = 0.85 + brush * 0.3 + scratch * 0.35;
      const o = i * 4;
      d[o] = clamp(r * sh, 0, 1) * 255;
      d[o + 1] = clamp(g * sh, 0, 1) * 255;
      d[o + 2] = clamp(b * sh, 0, 1) * 255;
      d[o + 3] = 255;
      height[i] = brush * 0.25 + rust * 0.3 + scratch * 0.4;
      rough[i] = clamp(0.58 + rust * 0.35 + grime * 0.18 - scratch * 0.10, 0.44, 1);
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    map: tex(c, { srgb: true }),
    normalMap: tex(heightToNormal(height, S, S, 1.0)),
    roughnessMap: tex(grayCanvas(rough, S, S)),
  };
}

function concreteSheet(S) {
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const i = y * S + x;
      const n = fbmTile(u * 20, v * 20, 20, 5, 5);
      const pores = worleyTile(u * 55, v * 55, 55, 61);
      const pore = smoothstep(0.16, 0.0, pores.f1) * 0.7;
      const stain = smoothstep(0.5, 0.85, fbmTile(u * 3, v * 8, 4, 4, 210));
      const formLine = smoothstep(0.985, 1.0, Math.abs(Math.sin(v * Math.PI * 4)));
      let lum = 0.30 + n * 0.16 - pore * 0.12 - stain * 0.14 - formLine * 0.05;
      const o = i * 4;
      d[o] = clamp(lum * 1.02, 0, 1) * 255;
      d[o + 1] = clamp(lum * 1.0, 0, 1) * 255;
      d[o + 2] = clamp(lum * 0.96, 0, 1) * 255;
      d[o + 3] = 255;
      height[i] = n * 0.5 - pore * 0.8 - formLine * 0.6;
      rough[i] = clamp(0.78 + n * 0.18 + stain * 0.1, 0.3, 1);
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    map: tex(c, { srgb: true }),
    normalMap: tex(heightToNormal(height, S, S, 1.2)),
    roughnessMap: tex(grayCanvas(rough, S, S)),
  };
}

function rockSheet(S) {
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const i = y * S + x;
      const n = fbmTile(u * 10, v * 10, 10, 6, 900);
      const strata = 0.5 + 0.5 * Math.sin((v * 9 + n * 1.8) * Math.PI * 2);
      const w2 = worleyTile(u * 16, v * 16, 16, 300);
      const cracks = smoothstep(0.06, 0.0, w2.f2 - w2.f1);
      let r = lerp(0.20, 0.30, strata) - cracks * 0.1;
      let g = lerp(0.185, 0.265, strata) - cracks * 0.1;
      let b = lerp(0.175, 0.235, strata) - cracks * 0.09;
      const sh = 0.75 + n * 0.5;
      const o = i * 4;
      d[o] = clamp(r * sh, 0, 1) * 255;
      d[o + 1] = clamp(g * sh, 0, 1) * 255;
      d[o + 2] = clamp(b * sh, 0, 1) * 255;
      d[o + 3] = 255;
      height[i] = n * 0.8 + strata * 0.2 - cracks;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: tex(c, { srgb: true }), normalMap: tex(heightToNormal(height, S, S, 1.8)) };
}

// ---------------------------------------------------------------------------
// SPRITES
// ---------------------------------------------------------------------------
function radialSprite(S, stops) {
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  for (const [p, col] of stops) g.addColorStop(p, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return tex(c, { wrap: THREE.ClampToEdgeWrapping });
}

function smokeSprite(S) {
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * 2 - 1;
      const v = (y / S) * 2 - 1;
      const r = Math.hypot(u, v);
      const n = fbmTile((x / S) * 6, (y / S) * 6, 6, 5, 404);
      let a = smoothstep(1.0, 0.15, r) * (0.35 + n * 0.9);
      a = clamp(a, 0, 1);
      const o = (y * S + x) * 4;
      d[o] = 255;
      d[o + 1] = 255;
      d[o + 2] = 255;
      d[o + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { wrap: THREE.ClampToEdgeWrapping });
}

function grassBladeSprite(S) {
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {
    const x = (i / 26) * S + Math.random() * 6;
    const w = S * (0.012 + Math.random() * 0.016);
    const hgt = S * (0.45 + Math.random() * 0.5);
    const bend = (Math.random() - 0.5) * S * 0.22;
    const g = ctx.createLinearGradient(0, S, 0, S - hgt);
    const dry = Math.random() < 0.45;
    const hue = dry ? 44 + Math.random() * 14 : 82 + Math.random() * 28;
    g.addColorStop(0, `hsl(${hue},${dry ? 34 : 42}%,10%)`);
    g.addColorStop(0.6, `hsl(${hue},${dry ? 38 : 44}%,24%)`);
    g.addColorStop(1, `hsl(${hue + 10},${dry ? 44 : 46}%,38%)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - w, S);
    ctx.quadraticCurveTo(x - w + bend * 0.5, S - hgt * 0.6, x + bend, S - hgt);
    ctx.quadraticCurveTo(x + w + bend * 0.5, S - hgt * 0.6, x + w, S);
    ctx.closePath();
    ctx.fill();
  }
  return tex(c, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

function needleSheet(S) {
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  // tileable sprays of conifer needles: draw each spray 9x so it wraps
  const sprays = 46;
  const draw = (cx, cy, ang, len, hue, lum) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.strokeStyle = `hsl(${hue},${38 + Math.random() * 22}%,${lum}%)`;
    ctx.lineWidth = Math.max(1, S * 0.006);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -len);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, S * 0.0042);
    const n = 9;
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const y = -len * f;
      const nl = len * 0.42 * (1 - f * 0.72);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(-nl * 0.85, y + nl * 0.55);
      ctx.moveTo(0, y);
      ctx.lineTo(nl * 0.85, y + nl * 0.55);
      ctx.stroke();
    }
    ctx.restore();
  };
  for (let i = 0; i < sprays; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const ang = (Math.random() - 0.5) * 1.5 + Math.PI;
    const len = S * (0.14 + Math.random() * 0.16);
    const hue = 88 + Math.random() * 42;
    const lum = 11 + Math.random() * 17;
    for (let ox = -1; ox <= 1; ox++)
      for (let oy = -1; oy <= 1; oy++) draw(x + ox * S, y + oy * S, ang, len, hue, lum);
  }
  return tex(c, { srgb: true });
}

function leafSheet(S) {
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  for (let i = 0; i < 340; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = S * (0.018 + Math.random() * 0.032);
    const hue = 74 + Math.random() * 46;
    const lum = 9 + Math.random() * 20;
    for (let ox = -1; ox <= 1; ox++)
      for (let oy = -1; oy <= 1; oy++) {
        ctx.fillStyle = `hsl(${hue},${40 + Math.random() * 24}%,${lum}%)`;
        ctx.beginPath();
        ctx.ellipse(x + ox * S, y + oy * S, r, r * (0.55 + Math.random() * 0.5), Math.random() * 3.14, 0, 6.283);
        ctx.fill();
      }
  }
  return tex(c, { srgb: true });
}

function foliageSprite(S) {
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  for (let i = 0; i < 130; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.pow(Math.random(), 0.55) * S * 0.44;
    const x = S / 2 + Math.cos(a) * rr;
    const y = S / 2 + Math.sin(a) * rr * 0.9;
    const s = S * (0.05 + Math.random() * 0.09);
    const l = 14 + Math.random() * 26 - (rr / S) * 12;
    ctx.fillStyle = `hsla(${95 + Math.random() * 34},${45 + Math.random() * 25}%,${l}%,0.95)`;
    ctx.beginPath();
    ctx.ellipse(x, y, s, s * (0.6 + Math.random() * 0.5), Math.random() * 3.14, 0, 6.283);
    ctx.fill();
  }
  return tex(c, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

// ---------------------------------------------------------------------------
// SIGNAGE — original artwork, drawn with canvas 2D
// ---------------------------------------------------------------------------
function billboardSheet(index, S) {
  const c = canvas(S, Math.floor(S / 2));
  const w = c.width;
  const h = c.height;
  const ctx = c.getContext('2d');
  const designs = [
    { bg: ['#12212e', '#0b1119'], accent: '#ff3b2f', head: 'FURY', sub: 'HIGH OCTANE FUEL', tag: 'RIDE ANGRY' },
    { bg: ['#2a1030', '#120616'], accent: '#ffb020', head: 'TORQUE', sub: 'SYNTHETIC MOTO OIL', tag: 'ZERO MERCY' },
    { bg: ['#07201f', '#02100f'], accent: '#25e6c0', head: 'VELO', sub: 'CARBON HELMETS', tag: 'KEEP YOUR HEAD' },
    { bg: ['#2b0f0f', '#140505'], accent: '#ff6a1f', head: 'RASHER', sub: 'LEATHERS & BOOTS', tag: 'ROAD TESTED' },
    { bg: ['#101a2c', '#050a12'], accent: '#4aa8ff', head: 'NITRO', sub: 'RACE ENERGY', tag: 'DRINK FAST' },
    { bg: ['#1c1c1c', '#0a0a0a'], accent: '#e8e8e8', head: 'EXIT 9', sub: 'CANYON PASS', tag: 'NEXT 2 KM' },
  ];
  const dz = designs[index % designs.length];
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, dz.bg[0]);
  g.addColorStop(1, dz.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // diagonal accent stripes
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = dz.accent;
  for (let i = -h; i < w; i += 46) {
    ctx.beginPath();
    ctx.moveTo(i, h);
    ctx.lineTo(i + 22, h);
    ctx.lineTo(i + 22 + h * 0.5, 0);
    ctx.lineTo(i + h * 0.5, 0);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = dz.accent;
  ctx.fillRect(0, h - 14, w, 14);
  ctx.fillRect(0, 0, w, 8);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  ctx.font = `900 ${Math.floor(h * 0.42)}px Impact, "Arial Black", system-ui, sans-serif`;
  ctx.fillText(dz.head, w * 0.06, h * 0.5);
  ctx.fillStyle = dz.accent;
  ctx.font = `700 ${Math.floor(h * 0.14)}px "Arial Black", system-ui, sans-serif`;
  ctx.fillText(dz.sub, w * 0.065, h * 0.66);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `600 ${Math.floor(h * 0.11)}px system-ui, sans-serif`;
  ctx.fillText(dz.tag, w * 0.065, h * 0.82);
  // weathering
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbmTile((x / w) * 8, (y / h) * 8, 8, 4, 606);
      const f = 0.82 + n * 0.32;
      const o = (y * w + x) * 4;
      d[o] *= f;
      d[o + 1] *= f;
      d[o + 2] *= f;
    }
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

function roadSignSheet(kind, S) {
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  if (kind === 'chevron') {
    ctx.fillStyle = '#f5d112';
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(S * 0.24, S * 0.16);
    ctx.lineTo(S * 0.72, S * 0.5);
    ctx.lineTo(S * 0.24, S * 0.84);
    ctx.lineTo(S * 0.24, S * 0.62);
    ctx.lineTo(S * 0.44, S * 0.5);
    ctx.lineTo(S * 0.24, S * 0.38);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'speed') {
    ctx.fillStyle = '#f2f2ee';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S * 0.46, 0, 6.283);
    ctx.fill();
    ctx.strokeStyle = '#c8202a';
    ctx.lineWidth = S * 0.09;
    ctx.stroke();
    ctx.fillStyle = '#15151a';
    ctx.font = `900 ${Math.floor(S * 0.44)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('120', S / 2, S / 2 + S * 0.02);
  } else if (kind === 'warn') {
    ctx.fillStyle = '#f5c518';
    ctx.beginPath();
    ctx.moveTo(S / 2, S * 0.06);
    ctx.lineTo(S * 0.94, S * 0.72);
    ctx.lineTo(S * 0.06, S * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = S * 0.035;
    ctx.stroke();
    ctx.fillStyle = '#1a1a1a';
    ctx.font = `900 ${Math.floor(S * 0.3)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('!', S / 2, S * 0.62);
  } else {
    // green highway shield
    ctx.fillStyle = '#0e5b3a';
    ctx.fillRect(S * 0.03, S * 0.2, S * 0.94, S * 0.6);
    ctx.strokeStyle = '#f0f0ea';
    ctx.lineWidth = S * 0.02;
    ctx.strokeRect(S * 0.06, S * 0.235, S * 0.88, S * 0.53);
    ctx.fillStyle = '#f0f0ea';
    ctx.font = `800 ${Math.floor(S * 0.17)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('CANYON PASS', S / 2, S * 0.45);
    ctx.font = `700 ${Math.floor(S * 0.12)}px system-ui, sans-serif`;
    ctx.fillText('NEXT EXIT  4 km', S / 2, S * 0.65);
  }
  return tex(c, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

function leatherSheet(S) {
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const i = y * S + x;
      const cell = worleyTile(u * 42, v * 42, 42, 55);
      const gr = smoothstep(0.0, 0.12, cell.f2 - cell.f1);
      const n = fbmTile(u * 90, v * 90, 90, 3, 12);
      const lum = 0.24 + gr * 0.1 + n * 0.08;
      const o = i * 4;
      d[o] = lum * 255;
      d[o + 1] = lum * 255;
      d[o + 2] = lum * 255;
      d[o + 3] = 255;
      height[i] = gr * 0.7 + n * 0.3;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: tex(c, { srgb: true }), normalMap: tex(heightToNormal(height, S, S, 1.0)) };
}

function tireSheet(S) {
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      // chevron tread pattern
      const z = Math.abs(((u * 6 + Math.abs(v - 0.5) * 5) % 1) - 0.5);
      const groove = smoothstep(0.16, 0.24, z);
      const shoulder = smoothstep(0.5, 0.32, Math.abs(v - 0.5));
      const n = fbmTile(u * 60, v * 60, 60, 3, 3);
      height[y * S + x] = groove * shoulder * 0.85 + n * 0.15;
    }
  }
  return tex(heightToNormal(height, S, S, 2.2));
}

function skidSprite(S) {
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const n = fbmTile(u * 12, v * 40, 12, 4, 808);
      const edge = smoothstep(0.5, 0.22, Math.abs(u - 0.5));
      const a = clamp(edge * (0.35 + n * 1.1) - 0.12, 0, 1);
      const o = (y * S + x) * 4;
      d[o] = 12;
      d[o + 1] = 11;
      d[o + 2] = 11;
      d[o + 3] = a * 235;
    }
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { wrap: THREE.ClampToEdgeWrapping });
}

function numberDecal(n, S) {
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(250,250,250,0.94)';
  ctx.beginPath();
  ctx.ellipse(S / 2, S / 2, S * 0.4, S * 0.44, 0, 0, 6.283);
  ctx.fill();
  ctx.fillStyle = '#14141a';
  ctx.font = `900 ${Math.floor(S * 0.6)}px Impact, "Arial Black", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), S / 2, S / 2 + S * 0.03);
  return tex(c, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

// ---------------------------------------------------------------------------
export function buildTextures(quality = 'ultra', maxAniso = 16) {
  const key = quality;
  if (cache.has(key)) return cache.get(key);

  const big = quality === 'ultra' ? 1024 : quality === 'high' ? 1024 : quality === 'med' ? 512 : 512;
  const mid = quality === 'low' ? 256 : 512;
  const small = quality === 'low' ? 128 : 256;

  const road = roadSurface(big);
  const terrain = terrainSheet(mid);
  const rail = guardrailSheet(mid);
  const conc = concreteSheet(mid);
  const rock = rockSheet(mid);
  const leather = leatherSheet(small);

  const T = {
    road,
    roadDetail: detailSheet(mid),
    roadMacro: macroSheet(small),
    terrain,
    rail,
    concrete: conc,
    rock,
    leather,
    tireNormal: tireSheet(small),
    clouds: cloudSheet(mid),
    grass: grassBladeSprite(mid),
    foliage: foliageSprite(mid),
    needles: needleSheet(mid),
    leaves: leafSheet(mid),
    glow: radialSprite(small, [
      [0, 'rgba(255,255,255,1)'],
      [0.18, 'rgba(255,244,214,0.85)'],
      [0.45, 'rgba(255,190,110,0.28)'],
      [1, 'rgba(255,150,60,0)'],
    ]),
    spark: radialSprite(small, [
      [0, 'rgba(255,255,255,1)'],
      [0.25, 'rgba(255,230,150,0.9)'],
      [0.6, 'rgba(255,140,40,0.25)'],
      [1, 'rgba(255,80,0,0)'],
    ]),
    smoke: smokeSprite(mid),
    skid: skidSprite(small),
    billboards: [0, 1, 2, 3, 4, 5].map((i) => billboardSheet(i, quality === 'low' ? 256 : 512)),
    signs: {
      chevron: roadSignSheet('chevron', small),
      speed: roadSignSheet('speed', small),
      warn: roadSignSheet('warn', small),
      exit: roadSignSheet('exit', mid),
    },
    numbers: [2, 5, 7, 9, 13, 21, 44].map((n) => numberDecal(n, small)),
  };

  // apply real anisotropy once we know the device max
  const applyAniso = (o) => {
    if (!o) return;
    if (o.isTexture) {
      o.anisotropy = maxAniso;
      o.needsUpdate = true;
    } else if (Array.isArray(o)) o.forEach(applyAniso);
    else if (typeof o === 'object') Object.values(o).forEach(applyAniso);
  };
  applyAniso(T);

  cache.set(key, T);
  return T;
}

export function disposeTextures() {
  cache.clear();
}
