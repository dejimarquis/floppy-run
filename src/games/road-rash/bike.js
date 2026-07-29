// Sport bike + rider, built entirely from primitives, lathes and extrusions.
// Geometry is merged by material so a whole bike+rider costs ~15 draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, lerp, damp } from './rng.js';

const V = new THREE.Vector3();

function taperExtrude(shape, depth, widthFn, opts = {}) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize: opts.bevelSize ?? 0.035,
    bevelThickness: opts.bevelThickness ?? 0.03,
    bevelSegments: opts.bevelSegments ?? 3,
    curveSegments: opts.curveSegments ?? 10,
    steps: 1,
  });
  geo.translate(0, 0, -depth / 2);
  // Extrude builds the profile in XY and pushes depth along +Z. We want the
  // profile in ZY (Z = along the bike) and the depth to become width along X.
  // rotateY(-90deg) maps  (x, y, z) -> (-z, y, x)  so shape-X lands on world
  // +Z unflipped. Using +90deg here mirrors every panel front-to-back.
  geo.rotateY(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    p.setX(i, x * widthFn(z, y));
  }
  geo.computeVertexNormals();
  return geo;
}

function rounded(geoList) {
  return mergeGeometries(geoList, false);
}

function capsule(r, len, seg = 8) {
  const g = new THREE.CapsuleGeometry(r, len, 3, seg);
  g.translate(0, -len / 2 - r * 0.0, 0);
  return g;
}

// A tapered limb segment spanning two explicit points. Building limbs from
// joint positions instead of stacked euler rotations is the only reliable way
// to get hands onto the bars and boots onto the pegs.
const _lA = new THREE.Vector3();
const _lB = new THREE.Vector3();
const _lD = new THREE.Vector3();
const _lQ = new THREE.Quaternion();
const _lUp = new THREE.Vector3(0, 1, 0);
function bone(a, b, r0, r1 = r0, seg = 9) {
  _lA.fromArray(a);
  _lB.fromArray(b);
  _lD.subVectors(_lB, _lA);
  const len = _lD.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
  g.translate(0, len / 2, 0);
  _lQ.setFromUnitVectors(_lUp, _lD.normalize());
  g.applyQuaternion(_lQ);
  g.translate(_lA.x, _lA.y, _lA.z);
  return g;
}
function joint(p, r, sx = 1, sy = 1, sz = 1) {
  const g = new THREE.SphereGeometry(r, 10, 8);
  g.scale(sx, sy, sz);
  g.translate(p[0], p[1], p[2]);
  return g;
}

// Loft a painted volume through a list of cross-sections taken along Z (the
// bike's long axis). Each section is a super-ellipse with independent top and
// bottom radii, which is enough to describe a whole sportbike upper: beak ->
// cowl -> tank -> seat dip -> upswept tail, as one continuous smooth surface.
// This is far more predictable than extruding a spline silhouette, which is
// prone to self-intersecting once the width function pinches.
// Global geometric detail scalar, set once per session from the quality tier.
// 1.0 = ultra/high, 0.5 = med, 0.28 = low. It drives loft ring resolution,
// tyre lug count and drilled-rotor holes, which together are most of the
// triangle budget of seven machines.
let DETAIL = 1;
export function setBikeDetail(d) {
  DETAIL = d;
}
const dq = (n, min = 3) => Math.max(min, Math.round(n * DETAIL));
const simple = () => DETAIL < 0.45;

function loft(sections, seg = 18) {
  seg = Math.max(8, Math.round(seg * (0.5 + 0.5 * DETAIL)));
  const rings = [];
  for (const s of sections) {
    const k = s.k ?? 0.72;
    const ring = [];
    for (let i = 0; i < seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      const c = Math.cos(t);
      const sn = Math.sin(t);
      const x = s.w * Math.sign(c) * Math.pow(Math.abs(c), k);
      const r = sn >= 0 ? s.hT : s.hB;
      const y = s.cy + r * Math.sign(sn) * Math.pow(Math.abs(sn), k);
      ring.push((s.cx ?? 0) + x, y, s.z);
    }
    rings.push(ring);
  }
  const n = rings.length;
  const pos = [];
  for (const r of rings) pos.push(...r);
  const idx = [];
  for (let r = 0; r < n - 1; r++) {
    const a = r * seg;
    const b = (r + 1) * seg;
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      // NOTE: winding matters. (a+i, b+i, b+j) yields an INWARD normal for a
      // ring wound CCW in XY and advancing along +Z, which turns every lofted
      // panel inside-out: backface culling then eats the near surface and the
      // camera looks straight through the bodywork into the frame.
      idx.push(a + i, b + j, b + i, a + i, a + j, b + j);
    }
  }
  // caps: fan to a centroid vertex at each end
  const capOf = (r, flip) => {
    let cx = 0;
    let cy = 0;
    const base = r * seg;
    for (let i = 0; i < seg; i++) {
      cx += pos[(base + i) * 3];
      cy += pos[(base + i) * 3 + 1];
    }
    const ci = pos.length / 3;
    pos.push(cx / seg, cy / seg, sections[r].z);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      if (flip) idx.push(ci, base + j, base + i);
      else idx.push(ci, base + i, base + j);
    }
  };
  capOf(0, true);
  capOf(n - 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv = [];
  for (let r = 0; r < n; r++) {
    for (let i = 0; i < seg; i++) uv.push(i / seg, r / (n - 1));
  }
  uv.push(0.5, 0, 0.5, 1);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Upper bodywork: beak, headlight cowl, tank the rider lies on, seat dip and
// the upswept tail blade — one continuous painted volume.
// The upper bodywork is deliberately built as THREE separate lofted panels
// with 35-45 mm gaps between them. Those gaps are the single biggest thing
// that separates a modelled motorcycle from a soap bar: the frame spar, the
// airbox and the subframe read through them and every panel gets its own
// specular break. Real shutline strips are inset into the gaps below.
function buildUpperNose() {
  return loft([
    { z: -1.045, cy: 0.930, hT: 0.030, hB: 0.045, w: 0.030, k: 0.85 },
    { z: -1.000, cy: 0.935, hT: 0.075, hB: 0.105, w: 0.098, k: 0.80 },
    { z: -0.930, cy: 0.955, hT: 0.130, hB: 0.185, w: 0.168, k: 0.72 },
    { z: -0.840, cy: 0.985, hT: 0.165, hB: 0.245, w: 0.212, k: 0.66 },
    { z: -0.700, cy: 1.000, hT: 0.170, hB: 0.292, w: 0.243, k: 0.50 },
    { z: -0.560, cy: 0.996, hT: 0.152, hB: 0.288, w: 0.240, k: 0.48 },
    { z: -0.430, cy: 0.992, hT: 0.128, hB: 0.262, w: 0.228, k: 0.50 },
    { z: -0.360, cy: 0.990, hT: 0.118, hB: 0.250, w: 0.220, k: 0.54 },
  ]);
}
function buildTankPanel() {
  return loft([
    { z: -0.322, cy: 0.990, hT: 0.110, hB: 0.238, w: 0.216, k: 0.65 },
    { z: -0.200, cy: 0.988, hT: 0.105, hB: 0.230, w: 0.230, k: 0.66 },
    { z: -0.040, cy: 0.972, hT: 0.092, hB: 0.205, w: 0.212, k: 0.68 },
    { z: 0.100, cy: 0.938, hT: 0.060, hB: 0.180, w: 0.166, k: 0.72 },
    { z: 0.196, cy: 0.922, hT: 0.044, hB: 0.150, w: 0.128, k: 0.77 },
  ]);
}
function buildTailPanel() {
  return loft([
    { z: 0.235, cy: 0.945, hT: 0.030, hB: 0.120, w: 0.128, k: 0.60 },
    { z: 0.360, cy: 0.982, hT: 0.046, hB: 0.148, w: 0.158, k: 0.46 },
    { z: 0.520, cy: 1.024, hT: 0.056, hB: 0.166, w: 0.166, k: 0.42 },
    { z: 0.680, cy: 1.062, hT: 0.056, hB: 0.164, w: 0.148, k: 0.42 },
    { z: 0.820, cy: 1.084, hT: 0.048, hB: 0.146, w: 0.098, k: 0.50 },
    { z: 0.900, cy: 1.078, hT: 0.028, hB: 0.090, w: 0.042, k: 0.74 },
  ]);
}
function buildUpperBody() {
  return rounded([buildUpperNose(), buildTankPanel(), buildTailPanel()]);
}
// Inset copy used as the machined inner surface visible through the panel
// gaps. Insetting has to happen in *section* space (shrink hT/hB/w about the
// section centreline), never as a mesh scale, or the panels shear apart.
function insetSections(secs, d) {
  return secs.map((v) => ({
    z: v.z,
    cy: v.cy,
    hT: Math.max(0.006, v.hT - d),
    hB: Math.max(0.006, v.hB - d),
    w: Math.max(0.006, v.w - d),
    k: v.k,
  }));
}
function buildInnerShell() {
  const D = 0.022;
  return rounded([
    loft(insetSections([
      { z: -1.020, cy: 0.930, hT: 0.030, hB: 0.045, w: 0.030, k: 0.85 },
      { z: -0.930, cy: 0.955, hT: 0.130, hB: 0.185, w: 0.168, k: 0.72 },
      { z: -0.700, cy: 1.000, hT: 0.170, hB: 0.292, w: 0.243, k: 0.62 },
      { z: -0.430, cy: 0.992, hT: 0.128, hB: 0.262, w: 0.228, k: 0.63 },
      { z: -0.310, cy: 0.990, hT: 0.116, hB: 0.244, w: 0.220, k: 0.64 },
    ], D), 14),
    loft(insetSections([
      { z: -0.335, cy: 0.990, hT: 0.110, hB: 0.238, w: 0.216, k: 0.65 },
      { z: -0.040, cy: 0.972, hT: 0.092, hB: 0.205, w: 0.212, k: 0.68 },
      { z: 0.210, cy: 0.920, hT: 0.044, hB: 0.148, w: 0.126, k: 0.77 },
    ], D), 14),
    loft(insetSections([
      { z: 0.225, cy: 0.945, hT: 0.030, hB: 0.120, w: 0.128, k: 0.60 },
      { z: 0.520, cy: 1.024, hT: 0.056, hB: 0.166, w: 0.166, k: 0.42 },
      { z: 0.820, cy: 1.084, hT: 0.048, hB: 0.146, w: 0.098, k: 0.50 },
      { z: 0.884, cy: 1.078, hT: 0.028, hB: 0.090, w: 0.042, k: 0.74 },
    ], D), 14),
  ]);
}

// Lower side pods / belly pan: wraps the engine, leaving the header pipes and
// the swingarm proud. Second livery colour.
function buildSidePods() {
  return loft([
    { z: -0.960, cy: 0.800, hT: 0.055, hB: 0.070, w: 0.070, k: 0.80 },
    { z: -0.860, cy: 0.762, hT: 0.105, hB: 0.130, w: 0.160, k: 0.70 },
    { z: -0.700, cy: 0.710, hT: 0.155, hB: 0.185, w: 0.238, k: 0.60 },
    { z: -0.480, cy: 0.660, hT: 0.170, hB: 0.215, w: 0.278, k: 0.55 },
    { z: -0.240, cy: 0.615, hT: 0.160, hB: 0.210, w: 0.288, k: 0.55 },
    { z: -0.020, cy: 0.570, hT: 0.135, hB: 0.180, w: 0.262, k: 0.58 },
    { z: 0.180, cy: 0.520, hT: 0.090, hB: 0.130, w: 0.196, k: 0.66 },
    { z: 0.320, cy: 0.480, hT: 0.050, hB: 0.075, w: 0.118, k: 0.76 },
  ], 16);
}

// --------------------------------------------------------------------------
function buildWheel(mats, { radius = 0.32, tube = 0.085, spokes = 5, discR = 0.19 } = {}) {
  const tire = new THREE.TorusGeometry(radius - tube, tube, dq(12, 6), dq(30, 14));
  tire.rotateY(Math.PI / 2);
  // squash the contact patch slightly for a loaded look
  const p = tire.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < -radius + tube * 1.2) p.setY(i, lerp(y, -radius + tube * 0.55, 0.35));
  }
  tire.computeVertexNormals();

  // ---- tread blocks: two staggered rows of chamfered lugs around the crown.
  // A tyre with a smooth crown reads as a rubber doughnut from 2 m away; the
  // lugs are what make it read as a tyre in a close orbit frame.
  const treadParts = [tire];
  const LUGS = dq(26, 0);
  for (let i = 0; i < LUGS; i++) {
    const a = (i / LUGS) * Math.PI * 2;
    for (const row of [-1, 1]) {
      const g = new THREE.BoxGeometry(tube * 0.62, 0.016, tube * 0.86);
      // chamfer the outer face so the lug catches a highlight edge
      const q = g.attributes.position;
      for (let k = 0; k < q.count; k++) {
        if (q.getY(k) > 0) {
          q.setX(k, q.getX(k) * 0.66);
          q.setZ(k, q.getZ(k) * 0.72);
        }
      }
      g.computeVertexNormals();
      g.translate(row * tube * 0.58, radius - 0.004, 0);
      g.rotateX(a + (row > 0 ? Math.PI / LUGS : 0));
      treadParts.push(g);
    }
    // centre groove ribs, offset half a pitch
    const gg = new THREE.BoxGeometry(tube * 0.30, 0.012, tube * 0.5);
    gg.translate(0, radius - 0.006, 0);
    gg.rotateX(a + Math.PI / (LUGS * 2));
    treadParts.push(gg);
  }
  const tireGeo = rounded(treadParts);

  // ---- alloy wheel: rim band, hub, and tapered Y-spokes with real gaps ----
  const alloyParts = [];
  const rimR = radius - tube * 1.05;
  const rim = new THREE.CylinderGeometry(rimR, rimR, tube * 1.75, 30, 1, true);
  rim.rotateZ(Math.PI / 2);
  alloyParts.push(rim);
  for (const sxx of [-1, 1]) {
    const lip = new THREE.TorusGeometry(rimR, tube * 0.2, 6, 26);
    lip.rotateY(Math.PI / 2);
    lip.translate(sxx * tube * 0.86, 0, 0);
    alloyParts.push(lip);
  }
  const hub = new THREE.CylinderGeometry(0.062, 0.062, tube * 2.5, 14);
  hub.rotateZ(Math.PI / 2);
  alloyParts.push(hub);
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const len = rimR - 0.05;
    const sp = new THREE.BoxGeometry(tube * 1.1, len, 0.045);
    sp.translate(0, len / 2 + 0.05, 0);
    // taper the spoke toward the rim
    const q = sp.attributes.position;
    for (let k = 0; k < q.count; k++) {
      const t = clamp((q.getY(k) - 0.05) / len, 0, 1);
      q.setX(k, q.getX(k) * lerp(1.0, 0.55, t));
      q.setZ(k, q.getZ(k) * lerp(1.0, 1.7, t));
    }
    sp.computeVertexNormals();
    sp.rotateX(a);
    alloyParts.push(sp);
  }

  // ---- brake rotors: dark steel, floating, drilled look via a thin inner carrier
  const rotorParts = [];
  for (const sxx of [-1, 1]) {
    const ring = new THREE.CylinderGeometry(discR, discR * 0.70, 0.008, 30, 1, true);
    ring.rotateZ(Math.PI / 2);
    ring.translate(sxx * tube * 1.55, 0, 0);
    rotorParts.push(ring);
    const face = new THREE.RingGeometry(discR * 0.70, discR, 30, 1);
    face.rotateY(Math.PI / 2);
    const f1 = face.clone();
    f1.translate(sxx * (tube * 1.55 + 0.004), 0, 0);
    rotorParts.push(f1);
    const f2 = face.clone();
    f2.rotateY(Math.PI);
    f2.translate(sxx * (tube * 1.55 - 0.004), 0, 0);
    rotorParts.push(f2);
    const carrier = new THREE.CylinderGeometry(discR * 0.70, discR * 0.70, 0.012, 18, 1, true);
    carrier.rotateZ(Math.PI / 2);
    carrier.translate(sxx * tube * 1.55, 0, 0);
    rotorParts.push(carrier);
  }

  // ---- drilled holes in the rotor face: a ring of recessed dark cylinders.
  // Reads as a floating drilled disc rather than a flat black washer.
  for (const sxx of [-1, 1]) {
    for (let i = 0; i < dq(12, 0); i++) {
      const a = (i / 12) * Math.PI * 2;
      const rr = discR * 0.86;
      const hole = new THREE.CylinderGeometry(0.0085, 0.0085, 0.013, 6);
      hole.rotateZ(Math.PI / 2);
      hole.translate(sxx * tube * 1.55, Math.sin(a) * rr, Math.cos(a) * rr);
      rotorParts.push(hole);
    }
    // 5-bolt carrier buttons
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const rr = discR * 0.66;
      const b = new THREE.CylinderGeometry(0.011, 0.011, 0.02, 6);
      b.rotateZ(Math.PI / 2);
      b.translate(sxx * tube * 1.55, Math.sin(a) * rr, Math.cos(a) * rr);
      rotorParts.push(b);
    }
  }

  return { tire: tireGeo, rim: rounded(alloyParts), rotor: rounded(rotorParts) };
}

function smoothShape(pts, sharp = null) {
  const shape = new THREE.Shape();
  const n = pts.length;
  const isSharp = (i) => (sharp ? !!sharp[((i % n) + n) % n] : false);
  const mid = (i) => {
    const a = pts[((i - 1) % n + n) % n];
    const b = pts[i % n];
    return isSharp(i) ? [b[0], b[1]] : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  const m0 = mid(0);
  shape.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const b = pts[i];
    const nx = mid(i + 1);
    if (isSharp(i)) {
      shape.lineTo(b[0], b[1]);
      shape.lineTo(nx[0], nx[1]);
    } else {
      shape.quadraticCurveTo(b[0], b[1], nx[0], nx[1]);
    }
  }
  shape.closePath();
  return shape;
}

const CSEG = 14;

// Upper fairing / nose cowl: pointed beak, sharp shoulder crease, swept back
// to meet the tank. Wraps the forks and carries the stacked headlights.
function buildNoseFairing(widthScale = 1) {
  const shape = smoothShape(
    [
      [-1.04, 0.86],  // beak tip
      [-1.02, 1.02],
      [-0.92, 1.13],  // brow
      [-0.74, 1.14],
      [-0.56, 1.06],
      [-0.46, 0.94],
      [-0.47, 0.80],
      [-0.62, 0.70],
      [-0.84, 0.70],
      [-0.99, 0.76],
    ],
    [1, 0, 1, 0, 0, 1, 0, 0, 0, 0]
  );
  const widthFn = (z, y) => {
    // widest just behind the beak, pinched at the very nose and at the top
    let w = 0.80 + 0.46 * Math.exp(-Math.pow((z + 0.70) / 0.26, 2));
    w *= lerp(1.0, 0.40, clamp((y - 1.02) / 0.14, 0, 1));
    w *= lerp(1.0, 0.60, clamp((0.80 - y) / 0.14, 0, 1));
    w *= lerp(1.0, 0.26, clamp((-z - 0.92) / 0.14, 0, 1));
    return w * widthScale;
  };
  return taperExtrude(shape, 0.44, widthFn, { bevelSize: 0.014, bevelThickness: 0.014, curveSegments: CSEG });
}

// Side fairing panel: a separate wing either side of the engine with a hard
// upper crease. Leaving a gap between this and the nose lets the frame spar,
// radiator and header pipes read as real hardware.
function buildSideFairing(sx) {
  const shape = smoothShape(
    [
      [-0.56, 0.84],
      [-0.30, 0.80],
      [-0.05, 0.70],
      [0.13, 0.54],
      [0.10, 0.40],
      [-0.16, 0.36],
      [-0.44, 0.42],
      [-0.58, 0.60],
    ],
    [0, 0, 1, 1, 1, 0, 0, 0]
  );
  const widthFn = (z, y) => {
    let w = 0.86 + 0.55 * Math.exp(-Math.pow((z + 0.22) / 0.30, 2));
    w *= lerp(1.0, 0.46, clamp((0.46 - y) / 0.12, 0, 1));
    return w;
  };
  const g = taperExtrude(shape, 0.30, widthFn, { bevelSize: 0.012, bevelThickness: 0.012, curveSegments: CSEG });
  g.translate(sx * 0.145, 0, 0);
  return g;
}

// Fuel tank — the mass the rider lies on. Knee recesses either side.
function buildTank(widthScale = 1) {
  const shape = smoothShape(
    [
      [-0.46, 0.90],
      [-0.40, 1.03],
      [-0.22, 1.085],
      [-0.02, 1.07],
      [0.11, 0.98],
      [0.13, 0.86],
      [-0.08, 0.79],
      [-0.34, 0.80],
    ],
    [0, 0, 0, 0, 1, 0, 0, 0]
  );
  const widthFn = (z, y) => {
    let w = 0.62 + 0.60 * Math.exp(-Math.pow((z + 0.18) / 0.26, 2));
    w *= lerp(1.0, 0.74, clamp((0.92 - y) / 0.12, 0, 1));
    w *= lerp(1.0, 0.44, clamp((y - 1.0) / 0.10, 0, 1));
    return w * widthScale;
  };
  return taperExtrude(shape, 0.48, widthFn, { bevelSize: 0.016, bevelThickness: 0.016, curveSegments: CSEG });
}

// Tail unit — narrow upswept subframe cowl that tapers to a blade.
function buildTail(widthScale = 1) {
  const shape = smoothShape(
    [
      [0.30, 0.905],
      [0.52, 0.975],
      [0.78, 1.035],
      [0.96, 1.045],
      [0.985, 0.995],
      [0.90, 0.945],
      [0.66, 0.885],
      [0.42, 0.845],
      [0.30, 0.835],
    ],
    [0, 0, 0, 1, 1, 0, 0, 0, 0]
  );
  const widthFn = (z, y) => {
    // whip-thin at the very back so the rear wheel and exhausts stay visible
    let w = 0.56 * lerp(1.0, 0.09, clamp((z - 0.32) / 0.60, 0, 1)) + 0.05;
    w *= lerp(1.0, 0.56, clamp((y - 0.985) / 0.06, 0, 1));
    return w * widthScale;
  };
  return taperExtrude(shape, 0.50, widthFn, { bevelSize: 0.012, bevelThickness: 0.012, curveSegments: CSEG });
}

// Front fender, painted to match, hugging the front tyre.
function buildFender() {
  const shape = smoothShape([
    [-0.30, 0.06],
    [0.0, 0.10],
    [0.30, 0.06],
    [0.28, -0.02],
    [0.0, 0.015],
    [-0.28, -0.02],
  ]);
  const widthFn = (z) => 1.0 - 0.35 * Math.min(1, Math.abs(z) / 0.32);
  const g = taperExtrude(shape, 0.20, widthFn, { bevelSize: 0.01, bevelThickness: 0.01, curveSegments: 10 });
  // bow it over the wheel
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    p.setY(i, p.getY(i) - (z * z) * 1.5);
  }
  g.computeVertexNormals();
  g.translate(0, 0.735, -0.70);
  return g;
}

// --------------------------------------------------------------------------
export function createBike(mats, opts = {}) {
  const paintColor = opts.paint ?? 0xd8262c;
  const accentColor = opts.accent ?? 0x101216;
  const leatherColor = opts.leather ?? 0x1c1f26;
  const numberTex = opts.numberTex ?? null;
  const detail = opts.detail ?? 'high';

  const paintMat = mats.paint(paintColor);
  const paint2Mat = mats.paint(opts.paint2 ?? 0x14161b, { roughness: 0.34, clearcoat: 0.85, env: 0.95 });
  const accentMat = new THREE.MeshPhysicalMaterial({
    color: accentColor,
    roughness: 0.36,
    metalness: 0.25,
    clearcoat: 0.85,
    clearcoatRoughness: 0.18,
    envMapIntensity: 0.85,
  });

  const group = new THREE.Group();
  const parts = {};

  // ---- wheels ----
  const wheelGeoF = buildWheel(mats, { radius: 0.325, tube: 0.072, spokes: 5, discR: 0.185 });
  const wheelGeoR = buildWheel(mats, { radius: 0.33, tube: 0.108, spokes: 5, discR: 0.145 });

  const mkWheel = (geo, z) => {
    const g = new THREE.Group();
    const tire = new THREE.Mesh(geo.tire, mats.rubber);
    const rim = new THREE.Mesh(geo.rim, mats.wheelAlloy);
    const rotor = new THREE.Mesh(geo.rotor, mats.rotor);
    tire.castShadow = true;
    rim.castShadow = true;
    g.add(tire, rim, rotor);
    g.position.set(0, 0.33, z);
    group.add(g);
    return { g, tire, rim };
  };
  const front = mkWheel(wheelGeoF, -0.70);
  const rear = mkWheel(wheelGeoR, 0.70);
  parts.frontWheel = front.g;
  parts.rearWheel = rear.g;

  // spinning blur discs
  if (detail === 'high') {
    const blurTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
      g.addColorStop(0, 'rgba(40,44,52,0)');
      g.addColorStop(0.5, 'rgba(46,50,58,0.34)');
      g.addColorStop(0.86, 'rgba(120,128,142,0.42)');
      g.addColorStop(0.97, 'rgba(150,158,172,0.28)');
      g.addColorStop(1, 'rgba(150,158,172,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    const blurMat = new THREE.MeshBasicMaterial({
      map: blurTex,
      transparent: true,
      depthWrite: false,
      opacity: 0,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    for (const [w, r] of [
      [front, 0.33],
      [rear, 0.34],
    ]) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 20), blurMat);
      disc.rotation.y = Math.PI / 2;
      w.g.add(disc);
    }
    parts.blurMat = blurMat;
  }

  // ---- bodywork: separate painted volumes with real gaps between them so the
  // frame spar, engine, radiator and header pipes all read as hardware ----
  const body = new THREE.Mesh(
    buildUpperBody(),
    paintMat
  );
  body.castShadow = true;
  group.add(body);
  parts.body = body;

  // secondary livery colour on the side pods + fender: two-tone bodywork reads
  // as a designed race livery instead of a single flat blob of colour
  const body2 = new THREE.Mesh(
    rounded([buildSidePods().toNonIndexed(), buildFender()]),
    paint2Mat
  );
  body2.castShadow = true;
  group.add(body2);
  parts.body2 = body2;

  // ---- dark plastic / accents ----
  const accentGeos = [];
  // rider seat: flat, low, sitting between tank and tail
  {
    const seat = new THREE.BoxGeometry(0.275, 0.075, 0.40);
    seat.translate(0, 0.972, 0.155);
    const p = seat.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i) - 0.155;
      const y = p.getY(i);
      if (y > 0.98) p.setX(i, p.getX(i) * (1 - 0.28 * Math.abs(z) / 0.2));
    }
    seat.computeVertexNormals();
    accentGeos.push(seat);
  }
  // pillion pad, narrow, up on the tail
  const pillion = new THREE.BoxGeometry(0.145, 0.035, 0.26);
  pillion.translate(0, 1.108, 0.600);
  accentGeos.push(pillion);
  // undertail / plate hanger
  const tailPanel = new THREE.BoxGeometry(0.02, 0.15, 0.16);
  tailPanel.rotateX(-0.4);
  tailPanel.translate(0, 0.900, 0.885);
  accentGeos.push(tailPanel);
  // rear hugger over the tyre
  const hug = new THREE.TorusGeometry(0.40, 0.045, 6, 14, Math.PI * 0.42);
  hug.rotateY(Math.PI / 2);
  hug.rotateX(Math.PI * 0.12);
  hug.translate(0, 0.33, 0.68);
  accentGeos.push(hug);
  // headlight housing behind the lenses
  const hh = new THREE.BoxGeometry(0.165, 0.15, 0.09);
  hh.translate(0, 0.895, -0.985);
  accentGeos.push(hh);
  // mirrors on stalks
  for (const sx of [-1, 1]) {
    const stalk = new THREE.CylinderGeometry(0.014, 0.014, 0.15, 6);
    stalk.rotateZ(-sx * 0.5);
    stalk.rotateX(-0.25);
    stalk.translate(sx * 0.255, 1.135, -0.80);
    accentGeos.push(stalk);
    const cup = new THREE.BoxGeometry(0.13, 0.075, 0.05);
    cup.rotateZ(-sx * 0.15);
    cup.rotateY(sx * 0.35);
    cup.translate(sx * 0.315, 1.198, -0.81);
    accentGeos.push(cup);
  }
  // instrument binnacle
  const dash = new THREE.BoxGeometry(0.16, 0.05, 0.10);
  dash.rotateX(0.45);
  dash.translate(0, 1.168, -0.575);
  accentGeos.push(dash);
  {
    // lit TFT face so the cockpit camera has a designed instrument, not a slab
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#05070c'; x.fillRect(0, 0, 256, 128);
    x.strokeStyle = '#1b2430'; x.lineWidth = 3;
    x.strokeRect(4, 4, 248, 120);
    for (let i = 0; i <= 22; i++) {
      const a = Math.PI * (0.80 + (i / 22) * 1.4);
      const r0 = i > 15 ? 40 : 44, r1 = 56;
      x.strokeStyle = i > 15 ? '#ff3a24' : '#7fe8ff';
      x.lineWidth = i % 4 === 0 ? 4 : 2;
      x.beginPath();
      x.moveTo(128 + Math.cos(a) * r0, 96 + Math.sin(a) * r0);
      x.lineTo(128 + Math.cos(a) * r1, 96 + Math.sin(a) * r1);
      x.stroke();
    }
    x.strokeStyle = '#ffb03a'; x.lineWidth = 5;
    const na = Math.PI * 1.62;
    x.beginPath(); x.moveTo(128, 96);
    x.lineTo(128 + Math.cos(na) * 50, 96 + Math.sin(na) * 50); x.stroke();
    x.fillStyle = '#dfe9f5';
    x.font = 'bold 34px monospace'; x.textAlign = 'center';
    x.fillText('146', 128, 44);
    x.font = 'bold 13px monospace'; x.fillStyle = '#5d7590';
    x.fillText('KM/H', 128, 60);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.145, 0.072),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: true })
    );
    face.rotation.x = -Math.PI / 2 + 0.45;
    face.position.set(0, 1.192, -0.585);
    group.add(face);
    parts.dashFace = face;
  }
  // ---- panel gaps, character crease and fasteners --------------------------
  // These are surface-conforming: every point is found by raycasting the
  // already-built bodywork, so a gap follows the real curvature of the fairing
  // instead of floating over a guessed position. Four gaps at 3 mm wide with a
  // 2 mm dark recess, one full-length crease bead, fourteen fasteners.
  const gapGeos = [];
  const studGeos = [];
  {
    group.updateMatrixWorld(true);
    const targets = [body, body2];
    const rc = new THREE.Raycaster();
    rc.far = 6;
    const _o = new THREE.Vector3();
    const _d = new THREE.Vector3();
    // cast inward along -sx at (y,z); returns { p, n } on the outer skin
    const skin = (sx, y, z) => {
      _o.set(sx * 1.6, y, z);
      _d.set(-sx, 0, 0);
      rc.set(_o, _d);
      const hit = rc.intersectObjects(targets, false)[0];
      if (!hit || !hit.face) return null;
      const n = hit.face.normal.clone();
      if (n.x * sx < 0) n.negate();
      return { p: hit.point.clone(), n };
    };
    // A surface-hugging ribbon through a list of (y,z) stations.
    const ribbon = (sx, stations, halfW, lift, out) => {
      const pts = [];
      for (const [y, z] of stations) {
        const h = skin(sx, y, z);
        if (h) pts.push(h);
      }
      if (pts.length < 2) return;
      const pos = [];
      const uv = [];
      const idx = [];
      const t = new THREE.Vector3();
      const b = new THREE.Vector3();
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)].p;
        const c = pts[Math.min(pts.length - 1, i + 1)].p;
        t.subVectors(c, a).normalize();
        b.crossVectors(pts[i].n, t).normalize().multiplyScalar(halfW);
        const o = pts[i].p.clone().addScaledVector(pts[i].n, lift);
        pos.push(o.x + b.x, o.y + b.y, o.z + b.z, o.x - b.x, o.y - b.y, o.z - b.z);
        uv.push(i / (pts.length - 1), 0, i / (pts.length - 1), 1);
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      out.push(g);
    };
    const zLine = (y, z0, z1, n) => {
      const a = [];
      for (let i = 0; i < n; i++) a.push([y, z0 + ((z1 - z0) * i) / (n - 1)]);
      return a;
    };
    for (const sx of [-1, 1]) {
      // gap 1: nose cowl -> side fairing, a long diagonal down the flank
      ribbon(sx, zLine(0.86, -0.90, -0.30, 9).map(([y, z], i) => [y - i * 0.018, z]), 0.0015, 0.0016, gapGeos);
      // gap 2: side fairing -> belly pan
      ribbon(sx, zLine(0.55, -0.52, 0.06, 8), 0.0015, 0.0016, gapGeos);
      // gap 3: tank -> seat unit shut line
      ribbon(sx, zLine(0.94, -0.05, 0.20, 6), 0.0015, 0.0016, gapGeos);
      // gap 4: tail unit upper seam
      ribbon(sx, zLine(0.98, 0.42, 0.86, 6), 0.0015, 0.0016, gapGeos);
      // character crease: one continuous line from the beak to the tail blade,
      // rising as it goes back. This is the single feature that stops a fairing
      // reading as a blob under a moving light.
      const crease = [];
      for (let i = 0; i < 16; i++) {
        const f = i / 15;
        crease.push([0.80 + f * 0.20, -0.96 + f * 1.72]);
      }
      ribbon(sx, crease, 0.0042, 0.0021, studGeos);
      // fasteners: 7 per side = 14 total
      const studAt = [
        [0.80, -0.72], [0.66, -0.44], [0.60, -0.14],
        [0.90, -0.86], [0.52, 0.02],
        [1.00, 0.52], [1.01, 0.72],
      ];
      for (const [y, z] of studAt) {
        const h = skin(sx, y, z);
        if (!h) continue;
        const s = new THREE.CylinderGeometry(0.0072, 0.0088, 0.0075, 8);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), h.n);
        s.applyQuaternion(q);
        s.translate(h.p.x + h.n.x * 0.0028, h.p.y + h.n.y * 0.0028, h.p.z + h.n.z * 0.0028);
        studGeos.push(s);
      }
    }
  }
  if (gapGeos.length) {
    // near-black, fully rough: a shut line is a slot you cannot see into
    const gapMat = new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide });
    const gaps = new THREE.Mesh(rounded(gapGeos), gapMat);
    gaps.castShadow = false;
    group.add(gaps);
    parts.panelGaps = gaps;
  }

  const accent = new THREE.Mesh(rounded(accentGeos), accentMat);
  accent.castShadow = true;
  group.add(accent);

  // ---- frame / engine / swingarm (dark satin metal) ----
  const darkGeos = [];
  // engine block with head + cases
  // Cylinder block, canted forward like an inline four, with a rounded lower
  // crankcase and separate covers instead of one grey shoebox.
  {
    const blk = new THREE.BoxGeometry(0.33, 0.26, 0.34);
    const bq = blk.attributes.position;
    for (let k = 0; k < bq.count; k++) {
      if (bq.getY(k) > 0) bq.setZ(k, bq.getZ(k) - 0.05);
      bq.setX(k, bq.getX(k) * (1 - 0.16 * Math.abs(bq.getY(k)) / 0.13));
    }
    blk.computeVertexNormals();
    blk.rotateX(-0.22);
    blk.translate(0, 0.585, 0.00);
    darkGeos.push(blk);
    // crankcase: a lathe-ish rounded sump
    const sump = new THREE.CylinderGeometry(0.155, 0.115, 0.20, 14, 1);
    sump.scale(1, 1, 1.55);
    sump.translate(0, 0.395, 0.05);
    darkGeos.push(sump);
    // cam cover
    const cam = new THREE.BoxGeometry(0.30, 0.055, 0.235);
    cam.rotateX(-0.22);
    cam.translate(0, 0.735, -0.075);
    darkGeos.push(cam);
    // cooling fins on the barrel
    for (let i = 0; i < 6; i++) {
      if (simple()) break;
      const fin = new THREE.BoxGeometry(0.345, 0.014, 0.30);
      fin.rotateX(-0.22);
      fin.translate(0, 0.545 + i * 0.038, 0.008 + i * 0.0085);
      darkGeos.push(fin);
    }
    // round clutch cover (right) and alternator cover (left)
    for (const sx of [-1, 1]) {
      const cov = new THREE.CylinderGeometry(0.098, 0.088, 0.055, 16);
      cov.rotateZ(Math.PI / 2);
      cov.translate(sx * 0.175, 0.425, sx > 0 ? 0.02 : -0.02);
      darkGeos.push(cov);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        if (simple()) break;
        const bolt = new THREE.CylinderGeometry(0.008, 0.008, 0.062, 5);
        bolt.rotateZ(Math.PI / 2);
        bolt.translate(sx * 0.178, 0.425 + Math.sin(a) * 0.078, (sx > 0 ? 0.02 : -0.02) + Math.cos(a) * 0.078);
        darkGeos.push(bolt);
      }
    }
  }
  // twin beam frame spars, visible in the gap between tank and side fairing
  for (const sx of [-1, 1]) {
    // The spar has to sit INSIDE the fairing width (tank panel half-width is
    // 0.23) or it reads as a plank bolted to the outside of the bike.
    const spar = new THREE.BoxGeometry(0.048, 0.115, 0.60);
    const sq = spar.attributes.position;
    for (let k = 0; k < sq.count; k++) {
      const t = clamp((sq.getZ(k) + 0.30) / 0.60, 0, 1);
      sq.setY(k, sq.getY(k) * lerp(0.72, 1.05, t));
    }
    spar.computeVertexNormals();
    spar.rotateX(-0.10);
    spar.translate(sx * 0.196, 0.792, -0.16);
    darkGeos.push(spar);
    // subframe rails, fully hidden under the tail unit
    const subf = new THREE.BoxGeometry(0.026, 0.040, 0.46);
    subf.rotateX(-0.20);
    subf.translate(sx * 0.078, 0.868, 0.40);
    darkGeos.push(subf);
  }
  // swingarm
  for (const sx of [-1, 1]) {
    const swing = new THREE.BoxGeometry(0.062, 0.145, 0.74);
    const wq = swing.attributes.position;
    for (let k = 0; k < wq.count; k++) {
      // deep at the pivot, slim at the axle, with a curved lower edge
      const t = clamp((wq.getZ(k) + 0.37) / 0.74, 0, 1);
      wq.setY(k, wq.getY(k) * lerp(1.0, 0.52, t) - Math.sin(t * Math.PI) * 0.028);
      wq.setX(k, wq.getX(k) * lerp(1.0, 0.78, t));
    }
    swing.computeVertexNormals();
    swing.rotateX(0.045);
    swing.translate(sx * 0.170, 0.412, 0.36);
    darkGeos.push(swing);
    // top brace
    const br = new THREE.BoxGeometry(0.05, 0.024, 0.30);
    br.rotateX(0.10);
    br.translate(sx * 0.12, 0.492, 0.24);
    darkGeos.push(br);
    // chain adjuster block at the axle
    const adj = new THREE.BoxGeometry(0.030, 0.075, 0.10);
    adj.translate(sx * 0.170, 0.345, 0.70);
    darkGeos.push(adj);
  }
  const shock = new THREE.CylinderGeometry(0.038, 0.03, 0.30, 8);
  shock.rotateX(0.45);
  shock.translate(0, 0.60, 0.36);
  darkGeos.push(shock);
  // ---- final drive: toothed rear sprocket, countershaft sprocket, and a real
  // chain run made of two straight ribbons plus wrap arcs. This is the detail
  // people subconsciously check for on a motorcycle.
  const SPX = -0.132;          // chain line, left of centre
  const RSR = 0.128;           // rear sprocket pitch radius
  const FSR = 0.048;           // countershaft sprocket radius
  const RSZ = 0.70;            // rear axle z
  const FSZ = 0.06;            // countershaft z
  const FSY = 0.455;
  {
    const carrier = new THREE.CylinderGeometry(RSR * 0.72, RSR * 0.72, 0.016, 16);
    carrier.rotateZ(Math.PI / 2);
    carrier.translate(SPX, 0.33, RSZ);
    darkGeos.push(carrier);
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      const t = new THREE.BoxGeometry(0.014, 0.030, 0.017);
      t.translate(0, RSR, 0);
      t.rotateX(a);
      t.translate(SPX, 0.33, RSZ);
      darkGeos.push(t);
    }
    // lightening holes in the sprocket carrier
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const h = new THREE.CylinderGeometry(0.019, 0.019, 0.022, 6);
      h.rotateZ(Math.PI / 2);
      h.translate(SPX, 0.33 + Math.sin(a) * RSR * 0.45, RSZ + Math.cos(a) * RSR * 0.45);
      darkGeos.push(h);
    }
    const fs = new THREE.CylinderGeometry(FSR, FSR, 0.016, 12);
    fs.rotateZ(Math.PI / 2);
    fs.translate(SPX, FSY, FSZ);
    darkGeos.push(fs);
    // chain runs: top run rides the sprocket tops, bottom run sags slightly
    const mkRun = (y0, z0, y1, z1, sag) => {
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const bulge = Math.sin(t * Math.PI) * sag;
        pts.push(new THREE.Vector3(SPX, lerp(y0, y1, t) - bulge, lerp(z0, z1, t)));
      }
      const cv = new THREE.CatmullRomCurve3(pts);
      const g = new THREE.TubeGeometry(cv, simple() ? 4 : 12, 0.011, simple() ? 3 : 4, false);
      g.scale(1.5, 1, 1);
      g.translate(-SPX * 0.5, 0, 0);
      return g;
    };
    darkGeos.push(mkRun(FSY + FSR, FSZ, 0.33 + RSR, RSZ, 0.0));
    darkGeos.push(mkRun(FSY - FSR, FSZ, 0.33 - RSR, RSZ, 0.014));
  }
  // rearsets + pegs
  for (const sx of [-1, 1]) {
    const hanger = new THREE.BoxGeometry(0.02, 0.11, 0.07);
    hanger.translate(sx * 0.225, 0.46, 0.28);
    darkGeos.push(hanger);
    const peg = new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6);
    peg.rotateZ(Math.PI / 2);
    peg.translate(sx * 0.28, 0.435, 0.28);
    darkGeos.push(peg);
  }
  // triple clamps
  const clampTop = new THREE.BoxGeometry(0.34, 0.045, 0.11);
  clampTop.rotateX(0.4);
  clampTop.translate(0, 1.045, -0.61);
  darkGeos.push(clampTop);
  const clampBot = new THREE.BoxGeometry(0.32, 0.05, 0.11);
  clampBot.rotateX(0.4);
  clampBot.translate(0, 0.90, -0.68);
  darkGeos.push(clampBot);
  // ---- brake calipers: radial-mount bodies with visible pistons and a
  // braided line running up the fork leg.
  for (const sx of [-1, 1]) {
    const cal = new THREE.BoxGeometry(0.050, 0.135, 0.078);
    cal.rotateX(0.40);
    cal.translate(sx * 0.098, 0.505, -0.808);
    darkGeos.push(cal);
    for (let i = 0; i < 2; i++) {
      const pist = new THREE.CylinderGeometry(0.017, 0.017, 0.056, 8);
      pist.rotateZ(Math.PI / 2);
      pist.translate(sx * 0.098, 0.545 - i * 0.052, -0.826 + i * 0.022);
      darkGeos.push(pist);
    }
    for (const bolt of [0.055, -0.055]) {
      const bo = new THREE.CylinderGeometry(0.010, 0.010, 0.07, 6);
      bo.rotateZ(Math.PI / 2);
      bo.translate(sx * 0.098, 0.505 + bolt * 0.9, -0.808 - bolt * 0.42);
      darkGeos.push(bo);
    }
    // brake line
    const bl = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sx * 0.118, 0.545, -0.836),
      new THREE.Vector3(sx * 0.150, 0.70, -0.80),
      new THREE.Vector3(sx * 0.168, 0.90, -0.66),
      new THREE.Vector3(sx * 0.20, 1.00, -0.58),
    ]);
    if (!simple()) darkGeos.push(new THREE.TubeGeometry(bl, 12, 0.0065, 5, false));
  }
  // rear caliper + hanger
  {
    const rc = new THREE.BoxGeometry(0.042, 0.075, 0.10);
    rc.translate(0.10, 0.365, 0.60);
    darkGeos.push(rc);
  }
  // ---- winglets: the modern sportbike signature silhouette cue
  for (const sx of [-1, 1]) {
    const wing = new THREE.BoxGeometry(0.115, 0.020, 0.145);
    const q = wing.attributes.position;
    for (let k = 0; k < q.count; k++) {
      const t = (q.getX(k) * sx + 0.0575) / 0.115;
      q.setZ(k, q.getZ(k) * lerp(1.0, 0.55, t));
    }
    wing.computeVertexNormals();
    wing.rotateZ(-sx * 0.16);
    wing.rotateY(sx * 0.10);
    wing.translate(sx * 0.268, 0.930, -0.795);
    darkGeos.push(wing);
    const endp = new THREE.BoxGeometry(0.012, 0.052, 0.115);
    endp.rotateY(sx * 0.10);
    endp.translate(sx * 0.322, 0.936, -0.80);
    darkGeos.push(endp);
  }
  // ---- inner shell: a slightly inset dark copy of the upper bodywork so the
  // 40 mm panel gaps show a machined inner surface instead of a hole.
  if (!simple()) darkGeos.push(buildInnerShell());
  const dark = new THREE.Mesh(rounded(darkGeos), mats.plastic);
  dark.castShadow = true;
  group.add(dark);


  // ---- chrome: fork tubes, bars, exhaust ----
  const chromeGeos = [];
  const RAKE = 0.40;
  for (const sx of [-1, 1]) {
    const forkUpper = new THREE.CylinderGeometry(0.036, 0.036, 0.34, 10);
    forkUpper.rotateX(RAKE);
    forkUpper.translate(sx * 0.148, 1.03, -0.55);
    chromeGeos.push(forkUpper);
  }
  // clip-on bars
  for (const sx of [-1, 1]) {
    const bar = new THREE.CylinderGeometry(0.019, 0.019, 0.26, 8);
    bar.rotateZ(Math.PI / 2 - sx * 0.10);
    bar.rotateX(0.14);
    bar.translate(sx * 0.28, 1.01, -0.55);
    chromeGeos.push(bar);
  }
  // headers: four pipes off the head, converging into a collector under the
  // engine and then into the link pipes. The exhaust has to START somewhere.
  const HDR_N = simple() ? 2 : 4;
  for (let i = 0; i < HDR_N; i++) {
    const f = HDR_N === 1 ? 0.5 : i / (HDR_N - 1);
    const px = (f - 0.5) * 0.245;         // spread across the cylinder head
    const seg = simple() ? 8 : 16;
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(px, 0.705, -0.20),                 // exhaust port
      new THREE.Vector3(px * 1.12, 0.60, -0.315),
      new THREE.Vector3(px * 0.95, 0.435, -0.31),
      new THREE.Vector3(px * 0.62, 0.335, -0.13),
      new THREE.Vector3(px * 0.24, 0.318, 0.10),
      new THREE.Vector3(0.02, 0.335, 0.25),                // into the collector
    ]);
    chromeGeos.push(new THREE.TubeGeometry(c, simple() ? 8 : 22, 0.0225, seg > 8 ? 8 : 5, false));
    // port flange with two studs
    const fl = new THREE.CylinderGeometry(0.032, 0.032, 0.012, 8);
    fl.rotateX(Math.PI / 2 - 0.5);
    fl.translate(px, 0.708, -0.196);
    chromeGeos.push(fl);
  }
  // collector box feeding the two link pipes
  {
    const col = new THREE.CylinderGeometry(0.055, 0.048, 0.20, 12);
    col.rotateX(Math.PI / 2 - 0.12);
    col.translate(0.01, 0.345, 0.33);
    chromeGeos.push(col);
  }
  chromeGeos.push(...studGeos);
  const chrome = new THREE.Mesh(rounded(chromeGeos), mats.chrome);
  chrome.castShadow = true;
  group.add(chrome);

  // ---- dark fork sliders + exhaust cans (brushed alloy) ----
  const alloyGeos = [];
  for (const sx of [-1, 1]) {
    const slider = new THREE.CylinderGeometry(0.046, 0.042, 0.44, 10);
    slider.rotateX(RAKE);
    slider.translate(sx * 0.148, 0.68, -0.69);
    alloyGeos.push(slider);
  }
  // upswept twin cans under the tail
  for (const sx of [-1, 1]) {
    const can = new THREE.CylinderGeometry(0.055, 0.062, 0.34, 12);
    can.rotateX(Math.PI / 2 - 0.16);
    can.translate(sx * 0.115, 0.575, 0.66);
    alloyGeos.push(can);
    const link = new THREE.CylinderGeometry(0.028, 0.028, 0.30, 8);
    link.rotateX(Math.PI / 2 - 0.30);
    link.translate(sx * 0.10, 0.44, 0.38);
    alloyGeos.push(link);
  }
  const alloy = new THREE.Mesh(rounded(alloyGeos), mats.titanium);
  alloy.castShadow = true;
  group.add(alloy);
  parts.exhaustTips = [
    new THREE.Vector3(-0.115, 0.549, 0.84),
    new THREE.Vector3(0.115, 0.549, 0.84),
  ];

  // ---- lights ----
  // stacked twin projectors set into the nose, angled slightly outward
  const emitGeos = [];
  for (const sx of [-1, 1]) {
    const lens = new THREE.SphereGeometry(0.062, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
    lens.rotateX(Math.PI * 0.62);
    lens.scale(1.15, 0.9, 0.75);
    lens.rotateY(sx * 0.16);
    lens.translate(sx * 0.062, 0.948, -1.000);
    emitGeos.push(lens);
    const lens2 = new THREE.SphereGeometry(0.046, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    lens2.rotateX(Math.PI * 0.62);
    lens2.scale(1.1, 0.85, 0.75);
    lens2.rotateY(sx * 0.16);
    lens2.translate(sx * 0.072, 0.862, -0.985);
    emitGeos.push(lens2);
  }
  const headLensMat = mats.emissiveWhite.clone();
  headLensMat.emissiveIntensity = 0.22;
  headLensMat.color = new THREE.Color(0xb9c4d2);
  const headMesh = new THREE.Mesh(rounded(emitGeos), headLensMat);
  group.add(headMesh);
  parts.headlight = headMesh;

  const tailGeos = [];
  const tailLensGeo = new THREE.BoxGeometry(0.115, 0.052, 0.03);
  tailLensGeo.translate(0, 1.072, 0.880);
  tailGeos.push(tailLensGeo);
  for (const sx of [-1, 1]) {
    const wing = new THREE.BoxGeometry(0.045, 0.04, 0.06);
    wing.rotateY(sx * 0.55);
    wing.translate(sx * 0.052, 1.016, 0.915);
    tailGeos.push(wing);
    // under-tail LED strip, visible from directly astern
    const led = new THREE.BoxGeometry(0.062, 0.028, 0.02);
    led.translate(sx * 0.048, 0.958, 0.922);
    tailGeos.push(led);
  }
  const tailMat = mats.emissiveRed.clone();
  // A tail lamp in direct sun is a dull red lens, not a lantern. At 1.15 the
  // bloom halo clipped all three channels and the light read as a white blob
  // stapled to the seat unit from the chase camera, which is the one camera
  // the game is played in. 0.62 keeps the core inside the red primary.
  tailMat.emissiveIntensity = 0.62;
  const tail = new THREE.Mesh(rounded(tailGeos), tailMat);
  group.add(tail);
  parts.tailLight = tail;

  // windscreen: a low double-bubble sitting proud of the cowl top
  {
    const ws = loft([
      { z: -0.940, cy: 1.092, hT: 0.010, hB: 0.030, w: 0.062, k: 0.85 },
      { z: -0.880, cy: 1.146, hT: 0.011, hB: 0.052, w: 0.094, k: 0.80 },
      { z: -0.800, cy: 1.192, hT: 0.012, hB: 0.062, w: 0.112, k: 0.76 },
      { z: -0.720, cy: 1.206, hT: 0.012, hB: 0.055, w: 0.116, k: 0.76 },
      { z: -0.648, cy: 1.186, hT: 0.011, hB: 0.038, w: 0.104, k: 0.82 },
    ], 14);
    const screen = new THREE.Mesh(ws, mats.glass);
    group.add(screen);
  }

  // number plate decal. Merging both sides into one geometry with FrontSide
  // shows the far quad's back face as a hard dark square from close range;
  // opaque + alphaTest + DoubleSide, one mesh per side, fixes it.
  if (numberTex) {
    const dm = new THREE.MeshStandardMaterial({
      map: numberTex,
      color: 0xc4c9d1,
      transparent: false,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      depthWrite: true,
      roughness: 0.42,
      metalness: 0,
      envMapIntensity: 0.7,
    });
    for (const sx of [-1, 1]) {
      const pl = new THREE.PlaneGeometry(0.26, 0.26);
      pl.rotateY(sx * Math.PI * 0.5);
      pl.rotateZ(-0.12);
      pl.translate(sx * 0.271, 0.690, -0.53);
      const m = new THREE.Mesh(pl, dm);
      m.castShadow = false;
      group.add(m);
    }
  }

  // ------------------------------------------------------------ rider
  const leatherMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(leatherColor),
    map: mats.T.leather.map,
    normalMap: mats.T.leather.normalMap,
    roughness: 0.58,
    metalness: 0.0,
    sheen: 0.45,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color(0x8a9cb4),
    clearcoat: 0.22,
    clearcoatRoughness: 0.42,
    envMapIntensity: 0.55,
  });
  const helmetMat = mats.paint(opts.helmet ?? paintColor, { roughness: 0.42, clearcoat: 0.55, env: 0.20 });

  const rider = new THREE.Group();
  rider.position.set(0, 0.0, 0.0);
  group.add(rider);
  parts.rider = rider;

  // Hip joint sits on the seat; the whole upper body pitches forward about it.
  // NOTE: +Z is toward the REAR of the bike, so a forward (racing) lean is a
  // NEGATIVE rotation about X. Getting this sign wrong sits the rider bolt
  // upright over the tail with their arms dangling behind the tank.
  const hips = new THREE.Group();
  hips.position.set(0, 0.985, 0.12);
  rider.add(hips);
  parts.hips = hips;

  const TORSO_PITCH = -0.60;
  const torsoPivot = new THREE.Group();
  torsoPivot.rotation.x = TORSO_PITCH;
  hips.add(torsoPivot);
  parts.torso = torsoPivot;

  // Torso: built along the spine in torso-local space (+Y = up the back).
  {
    const geos = [];
    const pelvis = joint([0, 0.045, 0.01], 0.145, 1.20, 0.85, 1.0);
    geos.push(pelvis);
    geos.push(bone([0, 0.05, 0.0], [0, 0.30, -0.03], 0.145, 0.168, 14));
    const chest = joint([0, 0.335, -0.035], 0.175, 1.22, 0.98, 0.90);
    geos.push(chest);
    // aero hump between the shoulder blades (torso-local +Z is the back)
    const hump = new THREE.SphereGeometry(0.10, 12, 9);
    hump.scale(1.25, 0.85, 1.75);
    hump.translate(0, 0.40, 0.085);
    geos.push(hump);
    const m = new THREE.Mesh(rounded(geos), leatherMat);
    m.castShadow = true;
    torsoPivot.add(m);
    parts.torsoMesh = m;

    // Colour-blocked shoulder yoke: from dead astern this is the entire read
    // of the rider, so it needs hard graphic separation from the dark leathers.
    const yokeGeos = [];
    const yoke = joint([0, 0.375, -0.02], 0.178, 1.20, 0.78, 1.02);
    yokeGeos.push(yoke);
    for (const sx of [-1, 1]) {
      yokeGeos.push(joint([sx * 0.205, 0.352, -0.02], 0.078, 1.0, 0.95, 1.05));
    }
    const yokeMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(opts.suit ?? opts.stripe ?? paintColor),
      roughness: 0.48,
      metalness: 0.0,
      sheen: 0.7,
      sheenRoughness: 0.45,
      sheenColor: new THREE.Color(0x9fb0c8),
      clearcoat: 0.4,
      clearcoatRoughness: 0.35,
      envMapIntensity: 0.5,
    });
    const ym = new THREE.Mesh(rounded(yokeGeos), yokeMat);
    ym.castShadow = true;
    torsoPivot.add(ym);
    parts.yokeMat = yokeMat;

    // trim: spine stripe running up the back + kidney belt
    const trimGeos = [];
    const spine = new THREE.BoxGeometry(0.075, 0.30, 0.06);
    spine.translate(0, 0.215, 0.115);
    trimGeos.push(spine);
    const belt = new THREE.BoxGeometry(0.30, 0.06, 0.235);
    belt.translate(0, 0.115, 0.0);
    trimGeos.push(belt);
    const trimMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(opts.trim ?? 0xe6e9ee),
      roughness: 0.45,
      metalness: 0.0,
      sheen: 0.6,
      sheenRoughness: 0.4,
      envMapIntensity: 0.35,
    });
    const tm2 = new THREE.Mesh(rounded(trimGeos), trimMat);
    tm2.castShadow = true;
    torsoPivot.add(tm2);
  }

  const neck = new THREE.Group();
  neck.position.set(0, 0.475, -0.045);
  torsoPivot.add(neck);
  parts.neck = neck;
  {
    // eyes-up: cancel most of the torso pitch so the helmet looks down the road
    neck.rotation.x = 0.44;
    const shell = new THREE.SphereGeometry(0.148, 14, 12);
    shell.scale(1.0, 1.06, 1.18);
    const back = new THREE.SphereGeometry(0.132, 10, 8);
    back.scale(1.0, 0.92, 0.72);
    back.translate(0, -0.02, 0.095);
    const chin = new THREE.BoxGeometry(0.175, 0.105, 0.125);
    chin.translate(0, -0.088, -0.125);
    const helmet = new THREE.Mesh(rounded([shell, back, chin]), helmetMat);
    helmet.castShadow = true;
    neck.add(helmet);
    const vis = new THREE.SphereGeometry(0.149, 14, 10, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.3, Math.PI * 0.36);
    vis.scale(1.02, 1.1, 1.2);
    vis.rotateY(Math.PI / 2);
    const visor = new THREE.Mesh(vis, mats.visor);
    neck.add(visor);
    // ---- helmet hardware: shell parting line, four vents, rear spoiler ----
    const hwGeos = [];
    // parting line: a shallow groove around the shell equator
    {
      const ring = new THREE.TorusGeometry(0.148, 0.0035, 5, 26);
      ring.rotateX(Math.PI / 2);
      ring.scale(1.02, 1.2, 1.08);
      ring.translate(0, -0.030, 0.006);
      hwGeos.push(ring);
    }
    // eyeport surround / visor gasket
    {
      const gk = new THREE.TorusGeometry(0.098, 0.0055, 5, 20, Math.PI * 1.25);
      gk.rotateY(Math.PI / 2);
      gk.rotateZ(Math.PI * 0.62);
      gk.scale(1.0, 1.1, 1.35);
      gk.translate(0, 0.006, -0.052);
      hwGeos.push(gk);
    }
    // brow vents (2) and chin vent (1) and top exhaust (1)
    for (const sx of [-1, 1]) {
      const v = new THREE.BoxGeometry(0.030, 0.009, 0.024);
      v.rotateX(-0.35);
      v.translate(sx * 0.058, 0.1055, -0.1015);
      hwGeos.push(v);
    }
    {
      const cv = new THREE.BoxGeometry(0.040, 0.012, 0.012);
      cv.translate(0, -0.101, -0.180);
      hwGeos.push(cv);
      const tv = new THREE.BoxGeometry(0.042, 0.009, 0.028);
      tv.rotateX(0.25);
      tv.translate(0, 0.1195, 0.052);
      hwGeos.push(tv);
    }
    // rear spoiler blade
    {
      const sp = new THREE.BoxGeometry(0.098, 0.010, 0.048);
      const q = sp.attributes.position;
      for (let k = 0; k < q.count; k++) q.setX(k, q.getX(k) * (q.getZ(k) > 0 ? 0.52 : 1.0));
      sp.computeVertexNormals();
      sp.rotateX(-0.42);
      sp.translate(0, 0.020, 0.156);
      hwGeos.push(sp);
      for (const sx of [-1, 1]) {
        const w = new THREE.BoxGeometry(0.009, 0.022, 0.042);
        w.rotateX(-0.42);
        w.translate(sx * 0.046, 0.003, 0.145);
        hwGeos.push(w);
      }
    }
    const hw = new THREE.Mesh(rounded(hwGeos), mats.rubber || accentMat);
    hw.castShadow = true;
    neck.add(hw);
    const stripeGeo = new THREE.SphereGeometry(0.152, 14, 12, Math.PI * 0.46, Math.PI * 0.08);
    stripeGeo.scale(1.0, 1.06, 1.18);
    const stripe = new THREE.Mesh(stripeGeo, mats.paint(opts.stripe ?? 0xf2f2f2, { roughness: 0.4, clearcoat: 0.5, env: 0.2 }));
    neck.add(stripe);
  }

  // One material for the whole limb, tinted per vertex. The arm was three
  // meshes across three materials, which is nine draw calls per rider once the
  // two shadow cascades are counted; the shoulder group is rigid (there is no
  // elbow joint - the whole chain is posed as a unit) so nothing is lost by
  // baking it into a single buffer. Albedo contrast is what makes a thrown
  // punch read, and albedo is exactly what a vertex colour can carry.
  const limbMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.52,
    metalness: 0.0,
    sheen: 0.5,
    sheenRoughness: 0.42,
    clearcoat: 0.22,
    clearcoatRoughness: 0.5,
    envMapIntensity: 0.38,
  });
  const tintGeo = (g, hex) => {
    const c = new THREE.Color(hex);
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      a[i * 3] = c.r;
      a[i * 3 + 1] = c.g;
      a[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3));
    return g;
  };

  // ---- arms: explicit shoulder -> elbow -> glove chain, aimed at the bars.
  // The clip-ons live at bike-space (+-0.26, 1.03, -0.62); the values below are
  // that point expressed in torso-local space for TORSO_PITCH.
  const HAND = [0.26, 0.452, -0.560];
  const SHOULDER = [0.215, 0.368, -0.03];
  const mkArm = (sx) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * SHOULDER[0], SHOULDER[1], SHOULDER[2]);
    torsoPivot.add(shoulder);
    const h = [sx * (HAND[0] - SHOULDER[0]), HAND[1] - SHOULDER[1], HAND[2] - SHOULDER[2]];
    // elbow bows down and outboard so the arm reads as bent, not a stick
    const e = [h[0] * 0.5 + sx * 0.075, h[1] * 0.5 - 0.105, h[2] * 0.5 + 0.015];
    // Split the limb across three tints. Against a near-black chassis a
    // mono-leather arm is invisible at any distance, and the punch is the one
    // read the whole genre is built on: the forearm gets the high-value sleeve
    // so an extended arm is a bright bar crossing a dark frame.
    const upper = [];
    upper.push(bone([0, 0, 0], e, 0.068, 0.055, 10));
    upper.push(joint(e, 0.058, 1.0, 1.0, 1.0));
    const gUpper = tintGeo(rounded(upper), opts.leather ?? 0x15171c);

    const fore = [];
    fore.push(bone(e, h, 0.056, 0.047, 10));
    const cuff = new THREE.TorusGeometry(0.058, 0.013, 6, 14);
    cuff.rotateX(Math.PI / 2);
    cuff.translate(h[0] * 0.62 + e[0] * 0.38, h[1] * 0.62 + e[1] * 0.38, h[2] * 0.62 + e[2] * 0.38);
    fore.push(cuff);
    const gFore = tintGeo(rounded(fore), opts.trim ?? 0x7c8695);

    // glove: palm + a knuckle bar, dark rubber so the hand reads as a hand and
    // not the end of the sleeve. The hood camera looks straight at these.
    const gg = [];
    const glove = new THREE.SphereGeometry(0.062, 10, 8);
    glove.scale(1.0, 0.92, 1.28);
    glove.translate(h[0], h[1], h[2]);
    gg.push(glove);
    const knuck = new THREE.BoxGeometry(0.052, 0.03, 0.062);
    knuck.translate(h[0] + sx * 0.03, h[1] + 0.026, h[2] - 0.03);
    gg.push(knuck);
    // three finger ridges so the glove has a readable form at 0.4 m
    for (let f = 0; f < 3; f++) {
      const fg = new THREE.CapsuleGeometry(0.0125, 0.036, 3, 6);
      fg.rotateX(Math.PI / 2);
      fg.translate(h[0] + sx * (0.022 - f * 0.021), h[1] + 0.03, h[2] - 0.055);
      gg.push(fg);
    }
    const gGlove = tintGeo(rounded(gg), 0x2b3037);

    const m = new THREE.Mesh(mergeGeometries([gUpper, gFore, gGlove], false), limbMat);
    m.castShadow = true;
    shoulder.add(m);
    gUpper.dispose();
    gFore.dispose();
    gGlove.dispose();
    return shoulder;
  };
  parts.armL = mkArm(-1);
  parts.armR = mkArm(1);

  // ---- legs: hip -> knee (tucked against the tank) -> boot (on the peg).
  // Positions are bike-space, converted to hip-group local below.
  const mkLeg = (sx) => {
    const hipWorld = [sx * 0.135, 1.005, 0.145];
    const hip = new THREE.Group();
    hip.position.set(hipWorld[0], hipWorld[1] - hips.position.y, hipWorld[2] - hips.position.z);
    hips.add(hip);
    const rel = (p) => [p[0] - hipWorld[0], p[1] - hipWorld[1], p[2] - hipWorld[2]];
    const knee = rel([sx * 0.245, 0.735, -0.19]);
    const ankle = rel([sx * 0.238, 0.485, 0.135]);
    const toe = rel([sx * 0.238, 0.452, -0.02]);
    const geos = [];
    geos.push(joint([0, 0, 0], 0.105, 1.0, 1.0, 1.15));
    geos.push(bone([0, 0, 0], knee, 0.105, 0.078, 10));
    geos.push(joint(knee, 0.082, 1.05, 1.0, 1.0));
    geos.push(bone(knee, ankle, 0.075, 0.056, 10));
    geos.push(bone(ankle, toe, 0.055, 0.045, 8));
    const heel = new THREE.BoxGeometry(0.095, 0.075, 0.10);
    heel.translate(ankle[0], ankle[1] - 0.01, ankle[2] + 0.02);
    geos.push(heel);
    const m = new THREE.Mesh(rounded(geos), leatherMat);
    hip.add(m);
    return hip;
  };
  parts.legL = mkLeg(-1);
  parts.legR = mkLeg(1);

  parts.paintMat = paintMat;
  parts.leatherMat = leatherMat;
  parts.helmetMat = helmetMat;

  // rest pose cache for animation blending
  const rest = {
    armL: parts.armL.rotation.clone(),
    armR: parts.armR.rotation.clone(),
    torso: torsoPivot.rotation.clone(),
    neck: parts.neck.rotation.clone(),
    legL: parts.legL.rotation.clone(),
    legR: parts.legR.rotation.clone(),
  };

  const state = {
    wheelSpin: 0,
    punchL: 0,
    punchR: 0,
    kick: 0,
    tuck: 0,
    lean: 0,
    crashT: -1,
    hold: false,
    hurt: 0,
    onConnect: null,
  };

  function update(dt, s) {
    const spin = s.speed / 0.33;
    state.wheelSpin += spin * dt;
    front.g.rotation.x = state.wheelSpin;
    rear.g.rotation.x = state.wheelSpin;
    if (parts.blurMat) parts.blurMat.opacity = clamp((s.speed - 24) / 60, 0, 0.55);

    // steering
    const steer = clamp(s.steer ?? 0, -1, 1);
    front.g.rotation.y = -steer * 0.16;

    // rider posture
    const tuck = clamp(s.tuck ?? 0, 0, 1);
    torsoPivot.rotation.x = damp(torsoPivot.rotation.x, rest.torso.x - tuck * 0.30, 8, dt);
    parts.neck.rotation.x = damp(parts.neck.rotation.x, rest.neck.x + tuck * 0.20, 8, dt);
    const lean = s.lean ?? 0;
    torsoPivot.rotation.z = damp(torsoPivot.rotation.z, -lean * 0.28, 7, dt);
    hips.position.x = damp(hips.position.x, lean * 0.06, 7, dt);
    parts.neck.rotation.z = damp(parts.neck.rotation.z, -lean * 0.25, 6, dt);

    // legs: knees out slightly when leaning hard
    parts.legL.rotation.z = damp(parts.legL.rotation.z, rest.legL.z + Math.max(0, lean) * 0.34, 6, dt);
    parts.legR.rotation.z = damp(parts.legR.rotation.z, rest.legR.z - Math.max(0, -lean) * 0.34, 6, dt);

    // Punches. The curve is FRONT-LOADED: `amt` counts down from 1, full
    // extension lands at amt=0.80 (77 ms after the call at the 2.6/s decay
    // rate) and then eases back over ~308 ms. Pass 2 used sin(amt*PI), which is
    // exactly 0 at amt=1 - the arm was at full rest on the connect frame.
    const doArm = (arm, restRot, amt, sx) => {
      if (amt <= 0) {
        arm.rotation.set(restRot.x, restRot.y, restRot.z);
        return 0;
      }
      const swing = amt > 0.80 ? (1 - amt) / 0.20 : Math.pow(amt / 0.80, 0.7);
      // recoil: overshoot the rest pose on the way back out
      const recoil = amt < 0.22 ? (1 - amt / 0.22) * 0.18 : 0;
      arm.rotation.x = lerp(restRot.x, restRot.x - 1.05, swing) + recoil;
      arm.rotation.z = lerp(restRot.z, restRot.z + sx * 0.55, swing);
      arm.rotation.y = lerp(restRot.y, restRot.y + sx * 0.95, swing);
      return swing;
    };
    const swL = doArm(parts.armL, rest.armL, state.punchL, -1);
    const swR = doArm(parts.armR, rest.armR, state.punchR, 1);
    // the whole body commits to the strike, not just the shoulder
    const commit = Math.max(swL, swR);
    if (commit > 0) {
      const dir = swR > swL ? 1 : -1;
      torsoPivot.rotation.x -= 0.22 * commit;
      torsoPivot.rotation.z += 0.14 * commit * dir;
      parts.neck.rotation.y = 0.30 * commit * dir;
    } else if (parts.neck.rotation.y !== 0) {
      parts.neck.rotation.y = damp(parts.neck.rotation.y, 0, 9, dt);
    }

    // kick
    if (state.kick > 0) {
      const k = Math.sin(state.kick * Math.PI);
      parts.legR.rotation.z = rest.legR.z - k * 1.15;
      parts.legR.rotation.x = rest.legR.x - k * 0.35;
    }

    // Taking a hit: torso rolls away, head snaps, near arm flails off the bar.
    // Without this the victim of a punch is a mannequin and the strike does not
    // read as having connected with anything.
    if (state.hurt > 0) {
      const h = state.hurt;
      torsoPivot.rotation.z += 0.42 * h;
      torsoPivot.rotation.x += 0.16 * h;
      parts.neck.rotation.z += 0.5 * h;
      parts.neck.rotation.y = -0.34 * h;
      parts.armL.rotation.z = rest.armL.z - 0.85 * h;
      parts.armL.rotation.x = rest.armL.x - 0.42 * h;
      if (!state.hold) state.hurt = Math.max(0, h - dt * 2.2);
    }

    // Damage, VFX and hitstop fire at the POSE PEAK, not at the call site.
    for (const key of ['punchL', 'punchR']) {
      if (state[key] <= 0) continue;
      const prev = state[key];
      if (!state.hold) state[key] = Math.max(0, prev - dt * 2.6);
      if (prev > 0.80 && state[key] <= 0.80 && state.onConnect) {
        const cb = state.onConnect;
        state.onConnect = null;
        cb();
      }
    }
    if (state.kick > 0) state.kick = Math.max(0, state.kick - dt * 1.9);
  }

  // side < 0 = left hook, side > 0 = right. onConnect fires on the frame the
  // fist actually reaches the target, which is what the impact VFX must match.
  function punch(side, onConnect) {
    if (side < 0) state.punchL = 1;
    else state.punchR = 1;
    state.onConnect = onConnect || null;
  }
  function kick() {
    state.kick = 1;
  }

  // ---- distance LOD -------------------------------------------------------
  // At range, the whole bike + rider collapses to one merged static proxy per
  // material family. 30 draw calls per machine becomes 4-6, which is the
  // difference between 470 and 250 draw calls with six rivals on screen.
  const lodFar = new THREE.Group();
  lodFar.visible = false;
  group.add(lodFar);
  const lodNear = [];
  {
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const byMat = new Map();
    for (const child of group.children) {
      if (child === lodFar) continue;
      lodNear.push(child);
      child.traverse((o) => {
        if (!o.isMesh || !o.geometry || !o.material) return;
        if (o.material.transparent && o.material.opacity < 0.98) return;
        // Drop hardware that is sub-pixel past the LOD switch distance: chain
        // links, caliper bolts, brake lines, fin edges. They are a third of the
        // machine's triangle count and none of it survives 24 m of perspective.
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        const dmax = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
        if (dmax < 0.17) return;
        const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
        const pos = geo.getAttribute('position');
        const nrm = geo.getAttribute('normal');
        const uv = geo.getAttribute('uv');
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', pos.clone());
        out.setAttribute('normal', nrm ? nrm.clone() : new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
        out.setAttribute('uv', uv ? uv.clone() : new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
        out.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
        if (!nrm) out.computeVertexNormals();
        const mt = o.material;
        const emissive = mt.emissive && mt.emissive.getHex() !== 0 && (mt.emissiveIntensity ?? 1) > 0.4;
        const key = emissive ? 'emit' : mt.metalness > 0.6 ? 'metal' : (mt.clearcoat ?? 0) > 0.3 ? 'paint' : 'dark';
        if (!byMat.has(key)) byMat.set(key, { mat: mt, list: [] });
        byMat.get(key).list.push(out);
      });
    }
    for (const [key, { mat, list }] of byMat.entries()) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) continue;
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = key === 'paint' || key === 'dark';
      lodFar.add(m);
      for (const g2 of list) if (g2 !== merged) g2.dispose();
    }
  }
  let lodLevel = 0;
  function setLOD(level) {
    if (level === lodLevel) return;
    lodLevel = level;
    lodFar.visible = level > 0;
    for (const c of lodNear) if (c.parent === group) c.visible = level === 0;
  }

  group.userData.state = state;
  // Every mesh that contributes to the silhouette casts. Pass 2 shipped 16 of
  // 33 casting, which meant the shadow was missing the tank, the seat unit,
  // the rider's arms and both mirrors - a shape nobody would read as a bike.
  //
  // But casting from *everything* is just as wrong in the other direction:
  // the machine is drawn once for the wide sun cascade and again for the tight
  // hero cascade, so every mesh costs three draw calls. Sub-decimetre hardware
  // (panel-gap inlays, badge inlays, brake discs, lamp lenses, belt trim) projects a
  // silhouette that lands entirely inside the shadow of the part it is bolted
  // to, so it is pure cost. Skipping it saved 22 draw calls with no measurable
  // change in the cast shape.
  let casters = 0;
  group.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    o.castShadow = false;
    const m = o.material;
    if (Array.isArray(m) ? m.some((x) => x.transparent && x.opacity < 0.9) : m.transparent && m.opacity < 0.9) return;
    const mm = Array.isArray(m) ? m[0] : m;
    // lamps and lit strips are emissive: their own shadow is never visible
    if (mm.emissive && mm.emissive.getHex() !== 0 && (mm.emissiveIntensity ?? 1) > 0.5) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    const dmax = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    if (dmax < 0.2) return;
    o.castShadow = true;
    casters++;
  });
  group.userData.casters = casters;

  return { group, parts, update, punch, kick, setLOD, state, materials: { paintMat, leatherMat, helmetMat } };
}

// A small detached bike used for crash debris (no rider, no animation).
export function createWreck(mats, paintColor) {
  const g = new THREE.Group();
  const paint = mats.paint(paintColor);
  const b = new THREE.Mesh(buildBodywork(0.9), paint);
  b.castShadow = true;
  g.add(b);
  const w = buildWheel(mats, { radius: 0.32, tube: 0.09, spokes: 5 });
  for (const z of [-0.7, 0.68]) {
    const t = new THREE.Mesh(w.tire, mats.rubber);
    const r = new THREE.Mesh(w.rim, mats.brushed);
    t.position.set(0, 0.33, z);
    r.position.set(0, 0.33, z);
    g.add(t, r);
  }
  return g;
}

export { V };
