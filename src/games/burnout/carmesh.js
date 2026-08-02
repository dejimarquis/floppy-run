// Procedurally generated car meshes. A lofted body shell (dense enough to
// deform), separate detachable panels, glass, lights and wheels.
// Local frame: +Z forward, +X right, +Y up. Origin at ground level, centre.
import * as THREE from 'three';
import { clamp, smoothstep } from './rng.js';
import * as TX from './textures.js';

// >=2500 verts on the body shell: deformation needs enough vertices in the
// falloff to buckle instead of spiking. Density is added along the LENGTH,
// not the ring -- the detachable panel index ranges in car.js are authored
// against RING = 32 and silently mis-size if the ring count changes.
const STATIONS = 80;
const RING = 32;

export const CAR_STYLES = {
  // Silhouette note: these read at CHASE-CAM distance, not in an orbit
  // inspection view. A low roof over a wide body collapses into a featureless
  // blob from behind -- the greenhouse has to sit clearly above the hood and
  // the wheels have to be visible under the arches, or it reads as a jellybean.
  sport: {
    len: 4.62, width: 1.94, wheelbase: 2.7, ride: 0.185,
    hood: 0.80, roof: 1.38, deck: 1.02, nose: 0.60, tail: 0.92,
    cabin: [-0.44, 0.30], roofT: [-0.20, 0.14], wsT: [0.14, 0.50], blT: [-0.50, -0.20], wsA: 0.62, rearC: -0.66,
    wheelR: 0.425, wheelW: 0.34, frontZ: 1.40, rearZ: -1.36,
    spoiler: 0.10, flareF: 0.095, flareR: 0.115,
  },
  muscle: {
    len: 5.02, width: 2.02, wheelbase: 2.95, ride: 0.225,
    hood: 0.92, roof: 1.50, deck: 1.12, nose: 0.76, tail: 1.02,
    cabin: [-0.52, 0.30], roofT: [-0.26, 0.10], wsT: [0.10, 0.46], blT: [-0.56, -0.26], wsA: 0.50, rearC: -0.72,
    wheelR: 0.450, wheelW: 0.38, frontZ: 1.50, rearZ: -1.48,
    spoiler: 0.22, flareF: 0.085, flareR: 0.125,
  },
  super: {
    len: 4.66, width: 2.02, wheelbase: 2.72, ride: 0.155,
    hood: 0.72, roof: 1.30, deck: 0.98, nose: 0.50, tail: 0.88,
    cabin: [-0.40, 0.32], roofT: [-0.16, 0.10], wsT: [0.10, 0.52], blT: [-0.44, -0.16], wsA: 0.52, rearC: -0.46,
    wheelR: 0.435, wheelW: 0.38, frontZ: 1.38, rearZ: -1.36,
    spoiler: 0.30, flareF: 0.105, flareR: 0.135,
  },
};

// Piecewise smooth interpolation through profile keypoints [t, value].
function curve(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  const n = keys.length;
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  for (let i = 0; i < n - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const f = (t - a[0]) / (b[0] - a[0]);
      const w = f * f * (3 - 2 * f);
      return a[1] + (b[1] - a[1]) * w;
    }
  }
  return keys[n - 1][1];
}

function gauss(x, s) { const q = x / s; return Math.exp(-q * q); }

let FLAKE = null;
function flakeMap() {
  if (!FLAKE) FLAKE = TX.makeFlakeNormal(256);
  return FLAKE;
}

/** Body silhouette functions for a style. Cab-backward supercar proportions. */
function silhouette(S) {
  const halfLen = S.len / 2;
  const [c0, c1] = S.cabin;
  const tf = S.frontZ / halfLen, tr = S.rearZ / halfLen;
  const R = S.roof, H = S.hood, D = S.deck, N = S.nose, T = S.tail;

  const [r0, r1] = S.roofT, [w0, w1] = S.wsT, [b0, b1] = S.blT;
  // Roofline: long low hood -> deeply raked screen -> short roof -> fastback.
  const topKeys = [
    [-1.00, T],
    [-0.88, T + 0.085],
    [-0.70, D * 0.99],
    [-0.55, D],
    [b0, D + (R - D) * 0.28],
    [b1, R * 0.985],
    [(r0 + r1) * 0.5, R],
    [r1, R * 0.995],
    [w1 - (w1 - w0) * 0.42, R - (R - H) * 0.34],
    [w1, H + (R - H) * 0.22],
    [w1 + 0.14, H + 0.028],
    [0.66, H],
    [0.88, H - (H - N) * 0.52],
    [1.00, N],
  ].sort((a, b) => a[0] - b[0]);

  // Sill / underbody: flat and low, splitter at the nose, diffuser at the tail.
  const botKeys = [
    [-1.00, S.ride + 0.20],
    [-0.86, S.ride + 0.085],
    [-0.42, S.ride],
    [0.34, S.ride],
    [0.82, S.ride + 0.045],
    [1.00, S.ride + 0.135],
  ];

  // Plan-view taper (widest across the axles).
  const widthKeys = [
    [-1.00, 0.70],
    [-0.86, 0.90],
    [tr, 1.00],
    [-0.25, 0.965],
    [0.25, 0.965],
    [tf, 1.00],
    [0.88, 0.90],
    [1.00, 0.70],
  ].sort((a, b) => a[0] - b[0]);

  return {
    halfLen,
    top(z) { return curve(topKeys, z / halfLen); },
    bottom(z) { return curve(botKeys, z / halfLen); },
    halfWidth(z) { return (S.width / 2) * curve(widthKeys, z / halfLen); },
    // Section width multiplier: tumblehome up top, blistered arches down low,
    // and a scalloped door waist in between.
    greenhouse(z, ey) {
      const t = z / halfLen;
      const inCab = smoothstep(c0 - 0.30, c0 + 0.12, t) * (1 - smoothstep(c1 - 0.12, c1 + 0.30, t));
      const up = smoothstep(0.02, 0.95, ey);
      const tumble = 1 - up * (0.36 * inCab + 0.22 * (1 - inCab));
      const low = gauss(ey + 0.28, 0.46);
      const flare = (S.flareF * gauss(t - tf, 0.20) + S.flareR * gauss(t - tr, 0.23)) * low;
      const waist = 0.055 * gauss(t - (c0 + c1) * 0.5, 0.22) * gauss(ey + 0.02, 0.26);
      return tumble * (1 + flare - waist);
    },
  };
}

function sectionPoint(sil, S, z, j, ringN) {
  const a = (j / ringN) * Math.PI * 2 - Math.PI / 2; // start at bottom
  const cx = Math.cos(a), cy = Math.sin(a);
  const n = 3.6;
  const ex = Math.sign(cx) * Math.pow(Math.abs(cx), 2 / n);
  const ey = Math.sign(cy) * Math.pow(Math.abs(cy), 2 / n);
  const hw = sil.halfWidth(z);
  const yt = sil.top(z), yb = sil.bottom(z);
  const yc = (yt + yb) / 2, ry = (yt - yb) / 2;
  let x = hw * ex * sil.greenhouse(z, ey);
  // shoulder / character line bulge
  x *= 1 + 0.022 * Math.exp(-Math.pow((ey + 0.10) / 0.20, 2));
  const y = yc + ry * ey;
  return { x, y, ey, ex };
}

/**
 * Builds the lofted body. Returns { geometry, meta } where meta describes
 * station z values so panels can be cut from the same surface.
 */
export function buildBody(styleName = 'sport') {
  const S = CAR_STYLES[styleName];
  const sil = silhouette(S);
  const K = STATIONS, M = RING;
  const pos = new Float32Array(K * M * 3);
  const uv = new Float32Array(K * M * 2);
  const zAt = new Float32Array(K);

  for (let i = 0; i < K; i++) {
    const f = i / (K - 1);
    // denser stations near the ends for crumple detail
    const z = -sil.halfLen + f * S.len;
    zAt[i] = z;
    for (let j = 0; j < M; j++) {
      const p = sectionPoint(sil, S, z, j, M);
      const o = (i * M + j) * 3;
      pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = z;
      uv[(i * M + j) * 2] = j / M;
      uv[(i * M + j) * 2 + 1] = f;
    }
  }

  // window mask -> quads that belong to the glass, not the body
  const [r0, r1] = S.roofT, [w0, w1] = S.wsT, [b0, b1] = S.blT;
  const mid = (b1 + w0) * 0.5;
  const isWindow = (i, j) => {
    const z = (zAt[i] + zAt[i + 1]) / 2;
    const t = z / sil.halfLen;
    if (t < b0 - 0.02 || t > w1 + 0.02) return false;
    const a = ((j + 0.5) / M) * Math.PI * 2 - Math.PI / 2;
    const ey = Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 2 / 3.6);
    const cxm = Math.abs(Math.cos(a));
    if (ey < 0.34 || ey > 0.96) return false;
    // solid roof panel
    if (t > r0 - 0.01 && t < r1 + 0.01 && ey > 0.55) return false;

    // windscreen / backlight are upper-surface glass: keep them off the flanks
    const windscreen = t > w0 && t < w1 - 0.03 && cxm < 0.88 && ey > 0.52;
    const backlight = t > b0 + 0.03 && t < b1 && cxm < 0.88 && ey > 0.52;
    const sideGlass = t > b1 - 0.06 && t < w0 + 0.06 && cxm > 0.34 && ey > 0.58 && ey < 0.88;
    if (!(windscreen || backlight || sideGlass)) return false;

    // A / B / C pillars
    if (Math.abs(t - b0) < 0.05) return false;
    if (Math.abs(t - w1) < 0.05) return false;
    if (cxm > 0.30 && Math.abs(t - mid) < 0.030) return false;
    if (cxm > 0.30 && Math.abs(t - w0) < 0.028) return false;
    if (cxm > 0.30 && Math.abs(t - b1) < 0.028) return false;
    return true;
  };

  const bodyIdx = [], glassIdx = [];
  for (let i = 0; i < K - 1; i++) {
    for (let j = 0; j < M; j++) {
      const j1 = (j + 1) % M;
      const v00 = i * M + j, v01 = i * M + j1;
      const v10 = (i + 1) * M + j, v11 = (i + 1) * M + j1;
      const target = isWindow(i, j) ? glassIdx : bodyIdx;
      // CCW as seen from OUTSIDE the hull. The opposite winding builds a shell
      // whose normals all point inward: with FrontSide culling the near wall
      // vanishes and the camera looks straight through the paint at the dark
      // interior shell, which is exactly how the car read for two passes.
      target.push(v00, v11, v10, v00, v01, v11);
    }
  }
  // caps (front + rear)
  const capFront = pos.length / 3;
  const extra = [];
  const addCap = (station, dir) => {
    const cz = zAt[station];
    let cy = 0;
    for (let j = 0; j < M; j++) cy += pos[(station * M + j) * 3 + 1];
    cy /= M;
    const ci = (pos.length / 3) + extra.length / 3;
    extra.push(0, cy, cz + dir * 0.02);
    return { ci, cz, cy, station };
  };
  const fc = addCap(K - 1, 0.0);
  const rc = addCap(0, 0.0);
  const capIdx = [];
  for (let j = 0; j < M; j++) {
    const j1 = (j + 1) % M;
    capIdx.push(fc.ci, (K - 1) * M + j, (K - 1) * M + j1);
    capIdx.push(rc.ci, j1, j);
  }
  void capFront;

  const totalV = K * M + extra.length / 3;
  const P = new Float32Array(totalV * 3);
  P.set(pos, 0);
  P.set(extra, K * M * 3);
  const UV = new Float32Array(totalV * 2);
  UV.set(uv, 0);
  for (let i = K * M; i < totalV; i++) { UV[i * 2] = 0.5; UV[i * 2 + 1] = i === K * M ? 1 : 0; }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  geo.setIndex([...bodyIdx, ...capIdx]);
  geo.computeVertexNormals();
  geo.userData = { K, M, zAt, style: S, halfLen: sil.halfLen };

  // glass geometry shares vertex layout but only window quads
  const gg = new THREE.BufferGeometry();
  const gp = new Float32Array(P.length);
  gp.set(P);
  // pull glass slightly inward so it doesn't z-fight the pillars
  for (let i = 0; i < K * M; i++) {
    gp[i * 3] *= 0.985;
    gp[i * 3 + 1] = gp[i * 3 + 1] * 0.995;
  }
  gg.setAttribute('position', new THREE.BufferAttribute(gp, 3));
  gg.setAttribute('uv', new THREE.BufferAttribute(UV.slice(), 2));
  gg.setIndex(glassIdx);
  gg.computeVertexNormals();

  return { body: geo, glass: gg, meta: { K, M, zAt, S, sil } };
}

/** Cut a panel plate (hood / door / boot) out of the body surface. */
function panelPlate(meta, zRange, jRange, offset = 0.004) {
  const { K, M, zAt, S, sil } = meta;
  const i0 = Math.max(0, Math.round(((zRange[0] + sil.halfLen) / S.len) * (K - 1)));
  const i1 = Math.min(K - 1, Math.round(((zRange[1] + sil.halfLen) / S.len) * (K - 1)));
  const j0 = jRange[0], j1 = jRange[1];
  const nI = i1 - i0 + 1, nJ = j1 - j0 + 1;
  if (nI < 2 || nJ < 2) return null;
  const pos = new Float32Array(nI * nJ * 3 * 2);
  const uv = new Float32Array(nI * nJ * 2 * 2);
  const idx = [];
  const nrm = new THREE.Vector3();
  for (let a = 0; a < nI; a++) {
    const z = zAt[i0 + a];
    for (let b = 0; b < nJ; b++) {
      const j = ((j0 + b) % M + M) % M;
      const p = sectionPoint(sil, S, z, j, M);
      const p2 = sectionPoint(sil, S, z, j + 0.5, M);
      const p3 = sectionPoint(sil, S, z, j - 0.5, M);
      nrm.set(p2.y - p3.y, -(p2.x - p3.x), 0).normalize();
      if (nrm.dot(new THREE.Vector3(p.x, p.y - (S.ride + 0.4), 0)) < 0) nrm.negate();
      const o = (a * nJ + b) * 3;
      pos[o] = p.x + nrm.x * offset;
      pos[o + 1] = p.y + nrm.y * offset;
      pos[o + 2] = z;
      // inner shell
      const o2 = (nI * nJ + a * nJ + b) * 3;
      pos[o2] = p.x - nrm.x * 0.022;
      pos[o2 + 1] = p.y - nrm.y * 0.022;
      pos[o2 + 2] = z;
      uv[(a * nJ + b) * 2] = b / nJ;
      uv[(a * nJ + b) * 2 + 1] = a / nI;
      uv[(nI * nJ + a * nJ + b) * 2] = b / nJ;
      uv[(nI * nJ + a * nJ + b) * 2 + 1] = a / nI;
    }
  }
  for (let a = 0; a < nI - 1; a++) {
    for (let b = 0; b < nJ - 1; b++) {
      const v00 = a * nJ + b, v01 = a * nJ + b + 1;
      const v10 = (a + 1) * nJ + b, v11 = (a + 1) * nJ + b + 1;
      idx.push(v00, v11, v10, v00, v01, v11);
      const w = nI * nJ;
      idx.push(w + v00, w + v10, w + v11, w + v00, w + v11, w + v01);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // centre pivot
  geo.computeBoundingBox();
  const c = new THREE.Vector3();
  geo.boundingBox.getCenter(c);
  geo.translate(-c.x, -c.y, -c.z);
  geo.userData = { pivot: c };
  return geo;
}

export function makePaintMaterial(color, opts = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    metalness: opts.metalness ?? 0.16,
    roughness: opts.roughness ?? 0.30,
    clearcoat: 0.85,
    clearcoatRoughness: 0.11,
    specularIntensity: 0.55,
    envMapIntensity: 0.17,
    normalMap: flakeMap(),
    normalScale: new THREE.Vector2(0.05, 0.05),
    ...(opts.extra || {}),
  });
  if (opts.plain) return m;

  // Livery: a twin centre stripe plus darkened sills and a lower accent band.
  // Purely shader-side so it costs nothing and survives vertex deformation.
  const stripe = new THREE.Color(opts.stripe ?? 0x101318);
  const accent = new THREE.Color(opts.accent ?? 0xf2f4f8);
  const uni = {
    uStripe: { value: stripe },
    uAccent: { value: accent },
    uLivery: { value: opts.livery ?? 0 },
  };
  m.userData.uniforms = uni;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    // aBody carries each vertex's position in *body* space. Detachable panels
    // and the spoiler are separate meshes with their own pivots, so using
    // `transformed` here would compute the livery in the wrong frame and the
    // stripes would not line up across the car.
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aBody;\nvarying vec3 vLocalPos;\nvarying vec3 vLocalNrm;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n\tvLocalNrm = objectNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvLocalPos = aBody;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLocalPos;
        varying vec3 vLocalNrm;
        uniform vec3 uStripe; uniform vec3 uAccent; uniform float uLivery;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // aBody is in authored car space: origin on the ground at the centre
          // of the car, so lp.y runs from the sill (~0.12) to the roof (~1.25)
          // and lp.z from the tail (negative) to the nose (positive).
          vec3 lp = vLocalPos;
          float ax = abs(lp.x);
          // top surfaces only: bonnet, roof, deck lid
          float upper = smoothstep(0.34, 0.62, lp.y) * (1.0 - smoothstep(0.58, 0.84, ax));
          // twin centre stripes running nose -> tail
          float s1 = 1.0 - smoothstep(0.085, 0.125, abs(ax - 0.20));
          // wide single stripe variant
          float s2 = 1.0 - smoothstep(0.30, 0.38, ax);
          // Weight by how upward-facing the surface is: without this the
          // stripe smears down the curved nose and fender flanks.
          float faceUp = smoothstep(0.35, 0.85, abs(normalize(vLocalNrm).y));
          // Detachable panels are re-pivoted meshes, so anything keyed off the
          // body-space X axis has to be driven from aBody, not the local
          // position -- otherwise a door lands mid-stripe and paints solid.
          float st = mix(s1, s2, step(0.5, uLivery)) * upper * faceUp;
          diffuseColor.rgb = mix(diffuseColor.rgb, uStripe, st * 0.55);
          // Dark lower valance. The old band faded out by y=0.30, which on the
          // current (taller) body was below the visible sill -- the car showed
          // as one unbroken slab of colour from the ground to the roof. This
          // grounds it: near-black under the sill, full colour by mid-door.
          diffuseColor.rgb *= mix(0.24, 1.0, smoothstep(0.14, 0.54, lp.y));
          // Shutline between the rear deck and the bumper, and between the
          // bonnet and the front clip. Two dark hairlines are all it takes to
          // stop the body reading as a single moulded lump.
          float cutR = 1.0 - smoothstep(0.0, 0.045, abs(lp.z + 1.16));
          float cutF = 1.0 - smoothstep(0.0, 0.040, abs(lp.z - 1.06));
          diffuseColor.rgb *= 1.0 - 0.55 * max(cutR, cutF) * smoothstep(0.30, 0.52, lp.y);
          // graduated deepening toward the roof reads as expensive paint
          diffuseColor.rgb *= mix(1.0, 0.86, smoothstep(0.48, 0.95, lp.y));
        }`);
  };
  return m;
}

export function makeGlassMaterial() {
  // Iridescence plus a 2.4x env turned every window into a magenta-white blob
  // that read as a rendering artefact rather than glass. It then swung too far
  // the other way: at 0.44 opacity the body colour showed straight through, so
  // a red car was one continuous red mass from nose to tail with no readable
  // greenhouse. Darker and more opaque gives the silhouette its glass band.
  return new THREE.MeshPhysicalMaterial({
    color: 0x0b1119,
    metalness: 0.0,
    roughness: 0.07,
    transparent: true,
    opacity: 0.74,
    envMapIntensity: 0.85,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

// ------------------------------------------------------------------ wheels
export function buildWheelGeometry(R = 0.36, W = 0.3) {
  // tyre: cylinder with rounded shoulders (lathe). The rim seat sits at 58% of
  // the radius so there is real sidewall to see -- at 0.66 the rim dominated
  // and the wheel read as a bare hub or a caster.
  const pts = [];
  const rimR = R * 0.58;
  pts.push(new THREE.Vector2(rimR, -W / 2));
  pts.push(new THREE.Vector2(R * 0.86, -W / 2 + 0.005));
  pts.push(new THREE.Vector2(R, -W / 2 + 0.055));
  pts.push(new THREE.Vector2(R, W / 2 - 0.055));
  pts.push(new THREE.Vector2(R * 0.86, W / 2 - 0.005));
  pts.push(new THREE.Vector2(rimR, W / 2));
  const tyre = new THREE.LatheGeometry(pts, 26);
  tyre.rotateZ(Math.PI / 2);

  // rim: dish + spokes
  const rimParts = [];
  const dish = new THREE.CylinderGeometry(rimR, rimR * 0.98, W * 0.92, 24, 1, true);
  dish.rotateZ(Math.PI / 2);
  rimParts.push(dish);
  const face = new THREE.CircleGeometry(rimR * 0.99, 24);
  face.rotateY(Math.PI / 2);
  face.translate(W / 2 * 0.94, 0, 0);
  rimParts.push(face);
  const spokeCount = 10;
  for (let i = 0; i < spokeCount; i++) {
    const a = (i / spokeCount) * Math.PI * 2;
    const s = new THREE.BoxGeometry(0.05, rimR * 0.86, 0.055);
    s.translate(0, rimR * 0.46, 0);
    s.rotateX(a);
    s.translate(W * 0.30, 0, 0);
    rimParts.push(s);
  }
  const hub = new THREE.CylinderGeometry(rimR * 0.22, rimR * 0.22, W * 0.3, 12);
  hub.rotateZ(Math.PI / 2);
  hub.translate(W * 0.36, 0, 0);
  rimParts.push(hub);

  const disc = new THREE.CylinderGeometry(rimR * 0.82, rimR * 0.82, 0.035, 20);
  disc.rotateZ(Math.PI / 2);

  const caliper = new THREE.BoxGeometry(0.07, 0.17, 0.09);
  caliper.translate(-0.055, rimR * 0.6, 0);

  return {
    tyre,
    rim: mergeGeos(rimParts),
    disc,
    caliper,
  };
}

function mergeGeos(list) {
  const nonIdx = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let vc = 0;
  for (const g of nonIdx) vc += g.attributes.position.count;
  const pos = new Float32Array(vc * 3);
  const nor = new Float32Array(vc * 3);
  const uv = new Float32Array(vc * 2);
  const anyCol = nonIdx.some((g) => g.attributes.color);
  const col = anyCol ? new Float32Array(vc * 3).fill(1) : null;
  let o = 0;
  for (const g of nonIdx) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    if (col && g.attributes.color) col.set(g.attributes.color.array, o * 3);
    o += n;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}


/**
 * Underbody / chassis. A wrecked car in this game spends most of its screen
 * time on its roof or its side, and a closed shell shows nothing but a smooth
 * dark slab from there. This adds the stuff you actually see under a rolling
 * car: floor pan with ribs, transmission tunnel, subframes, fuel tank,
 * differential, exhaust runs with tips, and lower control arms.
 *
 * Returns one merged, non-indexed geometry carrying a `color` attribute, so
 * the whole assembly is a single draw call on one vertex-coloured material.
 */
export function buildUnderbody(styleName = 'sport', yFloor = null) {
  const S = CAR_STYLES[styleName] || CAR_STYLES.sport;
  const hw = S.width * 0.5;
  // The body shell is authored in its own space and is NOT centred, so the
  // floor plane has to come from the shell's own bounds, not from a guess.
  const y0 = yFloor !== null ? yFloor : -(S.roof * 0.5) + S.ride * 0.9;
  const parts = [];

  const add = (geo, x, y, z, col, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Matrix4();
    const e = new THREE.Euler(rx, ry, rz);
    m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(m);
    const g = geo.toNonIndexed();
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const tube = (r, len, seg = 8) => new THREE.CylinderGeometry(r, r, len, seg);

  const PAN = [0.038, 0.040, 0.046];
  const RIB = [0.062, 0.064, 0.070];
  const BLK = [0.022, 0.023, 0.026];
  const STL = [0.20, 0.208, 0.222];
  // Tailpipe tips face the chase camera head-on. In bright STL they were the
  // lightest thing on the whole car -- two pale discs on a black valance --
  // and read as bare hubs or caster wheels rather than exhausts. Gunmetal.
  const TIP = [0.075, 0.078, 0.086];
  const RST = [0.145, 0.105, 0.072];

  // floor pan, tapered so it never breaks the body silhouette at nose or tail
  add(box(hw * 1.56, 0.05, S.len * 0.50), 0, y0, 0, PAN);
  add(box(hw * 1.20, 0.05, S.len * 0.22), 0, y0 + 0.02, S.len * 0.33, PAN);
  add(box(hw * 1.28, 0.05, S.len * 0.22), 0, y0 + 0.02, -S.len * 0.33, PAN);
  // transmission tunnel
  add(box(0.30, 0.17, S.len * 0.58), 0, y0 + 0.09, 0.05, RIB);
  // lateral ribs
  for (let i = -2; i <= 2; i++) {
    add(box(hw * 1.50, 0.030, 0.075), 0, y0 + 0.036, i * S.len * 0.115, RIB);
  }
  // sills
  add(box(0.11, 0.14, S.len * 0.68), -hw * 0.88, y0 + 0.05, 0, BLK);
  add(box(0.11, 0.14, S.len * 0.68), hw * 0.88, y0 + 0.05, 0, BLK);
  // front + rear subframes
  add(box(hw * 1.42, 0.11, 0.16), 0, y0 + 0.05, S.frontZ - 0.30, STL);
  add(box(hw * 1.42, 0.11, 0.16), 0, y0 + 0.05, S.rearZ + 0.30, STL);
  add(box(0.13, 0.10, 0.72), -hw * 0.52, y0 + 0.05, S.frontZ - 0.66, STL);
  add(box(0.13, 0.10, 0.72), hw * 0.52, y0 + 0.05, S.frontZ - 0.66, STL);
  // fuel tank + spare well
  add(box(hw * 1.00, 0.17, 0.56), 0, y0 + 0.06, S.rearZ + 0.72, BLK);
  // differential + driveshaft
  add(new THREE.SphereGeometry(0.135, 10, 8), 0, y0 + 0.11, S.rearZ + 0.22, STL);
  add(tube(0.048, S.len * 0.40), 0, y0 + 0.11, S.rearZ * 0.42, STL, Math.PI * 0.5);
  // half shafts
  add(tube(0.038, hw * 0.86), -hw * 0.45, y0 + 0.11, S.rearZ + 0.22, STL, 0, 0, Math.PI * 0.5);
  add(tube(0.038, hw * 0.86), hw * 0.45, y0 + 0.11, S.rearZ + 0.22, STL, 0, 0, Math.PI * 0.5);
  // exhaust: two runs from the bulkhead to the tips
  for (const sx of [-1, 1]) {
    add(tube(0.056, S.len * 0.52), sx * 0.26, y0 + 0.02, -0.05, RST, Math.PI * 0.5);
    // smaller and recessed 120mm further under the valance, so the tip reads as
    // a hole in shadow instead of a headlight-bright disc
    add(tube(0.052, 0.30), sx * 0.30, y0 + 0.03, S.rearZ + 0.12, TIP, Math.PI * 0.5);
    // mid silencer
    add(box(0.20, 0.11, 0.46), sx * 0.30, y0 + 0.02, S.rearZ + 0.60, RST);
  }
  // lower control arms at each corner
  for (const sx of [-1, 1]) {
    for (const z of [S.frontZ, S.rearZ]) {
      add(box(hw * 0.62, 0.055, 0.09), sx * hw * 0.56, y0 + 0.02, z, STL, 0, 0, sx * 0.10);
      add(box(0.09, 0.08, 0.30), sx * hw * 0.82, y0 + 0.08, z, BLK);
    }
  }
  // splitter + rear diffuser fins
  add(box(hw * 1.42, 0.032, 0.30), 0, y0 - 0.005, S.frontZ + 0.58, BLK);
  for (let i = -2; i <= 2; i++) {
    add(box(0.040, 0.11, 0.46), i * hw * 0.26, y0 + 0.04, S.rearZ - 0.36, BLK);
  }

  const merged = mergeGeos(parts);
  merged.computeVertexNormals();
  return merged;
}

export { mergeGeos, panelPlate, silhouette };
