// World construction: chunked road ribbon, terrain, guardrails, roadside props,
// vegetation, tunnels, bridges, distant mountains and a city skyline.
// Chunks are toggled by distance along the track so draw calls stay bounded.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RNG, fbm2, clamp, lerp, smoothstep, ridged } from './rng.js';
import { ROAD_HALF_WIDTH as HW, SHOULDER as SH } from './track.js';

const TMP = new THREE.Vector3();

function makeGeom(pos, norm, uv, idx, col) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function gridIndices(rows, cols, offset = 0, flip = false) {
  const idx = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = offset + r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      if (flip) idx.push(a, d, b, b, d, e);
      else idx.push(a, b, d, b, e, d);
    }
  }
  return idx;
}

// Extrude a closed 2D profile (lateral, height) along the track.
function extrudeAlong(track, s0, s1, step, profile, sideX, uvScale = 0.25) {
  const stations = Math.max(2, Math.ceil((s1 - s0) / step) + 1);
  const P = profile.length;
  const pos = [];
  const norm = [];
  const uv = [];
  const sm = {};
  // profile perimeter for U
  const peri = [0];
  for (let i = 1; i <= P; i++) {
    const a = profile[i - 1];
    const b = profile[i % P];
    peri.push(peri[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  for (let i = 0; i < stations; i++) {
    const s = s0 + ((s1 - s0) * i) / (stations - 1);
    track.sample(s, sm);
    for (let k = 0; k <= P; k++) {
      const p = profile[k % P];
      TMP.copy(sm.pos)
        .addScaledVector(sm.right, sideX + p[0])
        .addScaledVector(sm.up, p[1]);
      pos.push(TMP.x, TMP.y, TMP.z);
      // outward normal from profile edge direction
      const pn = profile[(k + 1) % P];
      const pp = profile[(k - 1 + P) % P];
      let dx = pn[0] - pp[0];
      let dy = pn[1] - pp[1];
      const l = Math.hypot(dx, dy) || 1;
      const nlat = dy / l;
      const nup = -dx / l;
      TMP.set(0, 0, 0).addScaledVector(sm.right, nlat).addScaledVector(sm.up, nup);
      norm.push(TMP.x, TMP.y, TMP.z);
      uv.push(peri[k] * 2.0, s * uvScale);
    }
  }
  const idx = gridIndices(stations, P + 1, 0, true);
  return makeGeom(pos, norm, uv, idx);
}

function windowTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, size, size);
  const cols = 12;
  const rows = 24;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = Math.random();
      if (lit < 0.42) continue;
      const warm = Math.random();
      const col =
        warm > 0.75 ? `rgba(180,215,255,${0.5 + Math.random() * 0.5})` : `rgba(255,205,130,${0.45 + Math.random() * 0.55})`;
      ctx.fillStyle = col;
      const w = (size / cols) * 0.55;
      const h = (size / rows) * 0.45;
      ctx.fillRect((x + 0.22) * (size / cols), (y + 0.28) * (size / rows), w, h);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class World {
  constructor(scene, track, mats, T, opts = {}) {
    this.lampsOn = opts.lampsOn ?? 0;
    this.cloudTint = opts.cloudTint ?? 0xffffff;
    this.cloudOp = opts.cloudOp ?? 1;
    this.scene = scene;
    this.track = track;
    this.mats = mats;
    this.T = T;
    this.seed = opts.seed ?? 7;
    this.quality = opts.quality ?? 'ultra';
    this.root = new THREE.Group();
    this.root.name = 'world';
    scene.add(this.root);
    this.chunks = [];
    this.tuning = {
      ultra: { grass: 380, trees: 30, rocks: 16, roadStep: 2.6, terrStep: 6, grassR: 32 },
      high: { grass: 200, trees: 20, rocks: 10, roadStep: 3.5, terrStep: 8, grassR: 24 },
      med: { grass: 90, trees: 13, rocks: 6, roadStep: 4.5, terrStep: 11, grassR: 18 },
      low: { grass: 0, trees: 2, rocks: 1, roadStep: 18, terrStep: 56, grassR: 0 },
    }[this.quality];
    this.build();
  }

  // -------------------------------------------------------------- terrain h
  hillHeight(wx, wz, ax) {
    const far = smoothstep(16, 120, ax);
    const big = (fbm2(wx * 0.0022, wz * 0.0022, 5, 3) - 0.45) * 190;
    const med = (fbm2(wx * 0.011, wz * 0.011, 4, 9) - 0.5) * 26;
    const fine = (fbm2(wx * 0.06, wz * 0.06, 3, 21) - 0.5) * 2.2;
    return far * (big + med) + smoothstep(9, 40, ax) * fine;
  }

  build() {
    const t = this.track;
    const n = t.chunkCount;
    for (let c = 0; c < n; c++) this.chunks.push(this.buildChunk(c));
    this.buildTunnels();
    this.buildBridges();
    this.buildMountains();
    this.buildClouds();
    this.buildCity();
    this.buildStartGantry();
  }

  buildChunk(ci) {
    const t = this.track;
    const mats = this.mats;
    const rng = new RNG(this.seed * 7919 + ci * 131 + 17);
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    const s0 = ci * t.chunkLen;
    const s1 = s0 + t.chunkLen;
    g.userData.s0 = s0;
    g.userData.s1 = s1;
    // populated by addVegetation(); consumed by the per-chunk detail LOD
    g.userData.detail = { far: false, small: [], extraTrees: [] };
    const tun = t.inTunnel((s0 + s1) / 2);
    const brg = t.inBridge((s0 + s1) / 2);
    this.root.add(g);

    // ---------------- road ribbon ----------------
    {
      const step = this.tuning.roadStep;
      const rows = Math.ceil(t.chunkLen / step) + 1;
      const cols = 7;
      const pos = [];
      const norm = [];
      const uv = [];
      const sm = {};
      for (let r = 0; r < rows; r++) {
        const s = s0 + (t.chunkLen * r) / (rows - 1);
        t.sample(s, sm);
        for (let c = 0; c < cols; c++) {
          const u = c / (cols - 1);
          const x = (u * 2 - 1) * HW;
          const crown = 0.13 * (1 - (u * 2 - 1) * (u * 2 - 1));
          TMP.copy(sm.pos).addScaledVector(sm.right, x).addScaledVector(sm.up, crown);
          pos.push(TMP.x, TMP.y, TMP.z);
          norm.push(sm.up.x, sm.up.y, sm.up.z);
          uv.push(u, s / 16);
        }
      }
      const geo = makeGeom(pos, norm, uv, gridIndices(rows, cols));
      const m = new THREE.Mesh(geo, mats.road);
      m.receiveShadow = true;
      m.castShadow = false;
      g.add(m);
    }

    // ---------------- terrain skirts ----------------
    if (!tun) {
      const step = this.tuning.terrStep;
      const rows = Math.ceil(t.chunkLen / step) + 1;
      const lat = [HW, HW + 1.1, HW + SH, HW + 7, HW + 15, HW + 30, HW + 58, HW + 105, HW + 175];
      const pos = [];
      const norm = [];
      const uv = [];
      const col = [];
      const idx = [];
      const sm = {};
      const cols = lat.length;
      for (const sideSign of [-1, 1]) {
        const base = pos.length / 3;
        for (let r = 0; r < rows; r++) {
          const s = s0 + (t.chunkLen * r) / (rows - 1);
          t.sample(s, sm);
          for (let c = 0; c < cols; c++) {
            const x = lat[c] * sideSign;
            const ax = Math.abs(x);
            TMP.copy(sm.pos).addScaledVector(sm.right, x);
            const prof = t.terrainProfile(s, x);
            const hill = brg ? 0 : this.hillHeight(TMP.x, TMP.z, ax);
            const y = TMP.y + prof + hill;
            pos.push(TMP.x, y, TMP.z);
            norm.push(0, 1, 0);
            uv.push(x * 0.11, s * 0.11);
            // gravel shoulder -> grass -> hazy distance
            const gravel = 1 - smoothstep(HW + 0.6, HW + SH + 1.4, ax);
            const dist = smoothstep(45, 175, ax);
            const r0 = lerp(1.0, 1.28, gravel);
            const g0 = lerp(1.0, 1.2, gravel);
            const b0 = lerp(1.0, 1.1, gravel);
            const tint = 1 - dist * 0.25;
            col.push(r0 * tint, g0 * tint, b0 * tint);
          }
        }
        idx.push(...gridIndices(rows, cols, base, sideSign < 0));
      }
      const geo = makeGeom(pos, norm, uv, idx, col);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mats.terrain);
      m.receiveShadow = true;
      g.add(m);
    }

    // ---------------- metal: guardrail + poles ----------------
    const railGeos = [];
    const darkGeos = [];
    const emitGeos = [];
    // True W-beam section: two corrugations either side of a central rib,
    // rolled edges top and bottom, and a shallow back pan. The flat top face
    // of the old profile mirrored the sky as an unmotivated blue stripe.
    const railProfile = [
      [-0.02, 0.44],
      [0.075, 0.50],
      [0.115, 0.575],
      [0.075, 0.645],
      [0.020, 0.700],
      [0.075, 0.755],
      [0.115, 0.825],
      [0.075, 0.900],
      [-0.02, 0.960],
      [-0.065, 0.945],
      [-0.065, 0.455],
    ];
    if (!tun) {
      for (const side of [-1, 1]) {
        const sx = side * (HW + 2.4);
        const prof = side > 0 ? railProfile : railProfile.map(([a, b]) => [-a, b]);
        railGeos.push(extrudeAlong(t, s0, s1, 6, prof, sx));
        // posts
        const sm = {};
        for (let s = s0 + 2; s < s1; s += 4.5) {
          t.sample(s, sm);
          // The post must actually reach the dirt. The verge falls away from
          // the carriageway, so a fixed-length post leaves the whole run
          // hovering; sample the terrain profile at the post's own offset and
          // grow the section down into it, plus 12cm of embedment.
          const drop = t.terrainProfile(s, sx) + this.hillHeight(
            sm.pos.x + sm.right.x * sx,
            sm.pos.z + sm.right.z * sx,
            Math.abs(sx)
          );
          const hgt = Math.max(0.9, 1.05 - drop + 0.12);
          const post = new THREE.BoxGeometry(0.1, hgt, 0.15);
          post.translate(0, 0.95 - hgt * 0.5, 0.02);
          // C-section stiffening flanges: a flat slab has no readable form
          const flA = new THREE.BoxGeometry(0.028, hgt, 0.05);
          flA.translate(-0.06, 0.95 - hgt * 0.5, -0.05);
          const flB = flA.clone();
          flB.translate(0.12, 0, 0);
          const boltA = new THREE.BoxGeometry(0.055, 0.055, 0.05);
          boltA.translate(0, 0.575, -0.1);
          const boltB = new THREE.BoxGeometry(0.055, 0.055, 0.05);
          boltB.translate(0, 0.825, -0.1);
          // splice bolts through the beam itself, on the road-facing side
          const spA = new THREE.CylinderGeometry(0.022, 0.022, 0.04, 6);
          spA.rotateX(Math.PI / 2);
          spA.translate(0, 0.575, 0.13);
          const spB = spA.clone();
          spB.translate(0, 0.25, 0);
          const p = mergeGeometries([post, flA, flB, boltA, boltB, spA, spB], false);
          const mtx = new THREE.Matrix4();
          const q = new THREE.Quaternion();
          const mm = new THREE.Matrix4().makeBasis(sm.right, sm.up, TMP.copy(sm.fwd).negate());
          q.setFromRotationMatrix(mm);
          const wp = new THREE.Vector3().copy(sm.pos).addScaledVector(sm.right, sx).addScaledVector(sm.up, -0.1);
          mtx.compose(wp, q, new THREE.Vector3(1, 1, 1));
          p.applyMatrix4(mtx);
          railGeos.push(p);
        }
      }
      // reflector delineators
      const sm2 = {};
      for (let s = s0 + 6; s < s1; s += 9) {
        for (const side of [-1, 1]) {
          t.sample(s, sm2);
          const r = new THREE.BoxGeometry(0.11, 0.15, 0.045);
          const rq = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(sm2.right, sm2.up, TMP.copy(sm2.fwd).negate())
          );
          r.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(rq));
          const wp = new THREE.Vector3()
            .copy(sm2.pos)
            .addScaledVector(sm2.right, side * (HW + 2.4) - side * 0.13)
            .addScaledVector(sm2.up, 1.0);
          r.translate(wp.x, wp.y, wp.z);
          // Reflectors are retro-reflective, not light sources: in daylight
          // they belong in the dark batch or they read as fairy lights.
          (this.lampsOn > 0.05 ? emitGeos : darkGeos).push(r);
        }
      }
    }

    // streetlights every ~55 m, alternating sides in the city, else one side
    {
      const sm = {};
      const start = Math.ceil(s0 / 55) * 55;
      for (let s = start; s < s1; s += 55) {
        if (t.inTunnel(s)) continue;
        const side = ((s / 55) | 0) % 2 === 0 ? 1 : -1;
        t.sample(s, sm);
        const base = new THREE.Vector3().copy(sm.pos).addScaledVector(sm.right, side * (HW + 3.4));
        const q = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(sm.right, sm.up, TMP.copy(sm.fwd).negate())
        );
        const pole = new THREE.CylinderGeometry(0.11, 0.16, 9.2, 8, 1, true);
        pole.translate(0, 4.6, 0);
        const arm = new THREE.CylinderGeometry(0.075, 0.085, 3.1, 6);
        arm.rotateZ(-side * Math.PI * 0.46);
        arm.translate(-side * 1.5, 9.25, 0);
        const head = new THREE.BoxGeometry(0.95, 0.22, 0.42);
        head.translate(-side * 2.95, 9.0, 0);
        const dg = mergeGeometries([pole, arm, head], false);
        const mtx = new THREE.Matrix4().compose(base, q, new THREE.Vector3(1, 1, 1));
        dg.applyMatrix4(mtx);
        darkGeos.push(dg);
        const lens = new THREE.BoxGeometry(0.8, 0.06, 0.34);
        lens.translate(-side * 2.95, 8.87, 0);
        lens.applyMatrix4(mtx);
        // In daylight a streetlamp lens is a dull grey plastic box, not a
        // glowing bar; only feed it to the emissive batch after dusk.
        if (this.lampsOn > 0.05) emitGeos.push(lens);
        else darkGeos.push(lens);
        g.userData.lampPositions = g.userData.lampPositions || [];
        const lp = new THREE.Vector3(-side * 2.95, 8.8, 0).applyMatrix4(mtx);
        g.userData.lampPositions.push({ p: lp, side });
      }
    }

    // telephone poles + catenary wires on the opposite side
    if (!tun && !brg) {
      const sm = {};
      const start = Math.ceil(s0 / 62) * 62;
      const wirePts = [];
      for (let s = start; s < s1 + 62; s += 62) {
        t.sample(s, sm);
        const side = -1;
        const base = new THREE.Vector3().copy(sm.pos).addScaledVector(sm.right, side * (HW + 9.5));
        base.y += this.hillHeight(base.x, base.z, HW + 9.5) + t.terrainProfile(s, side * (HW + 9.5));
        if (s < s1) {
          const q = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(sm.right, sm.up, TMP.copy(sm.fwd).negate())
          );
          const pole = new THREE.CylinderGeometry(0.16, 0.24, 11, 7);
          pole.translate(0, 5.5, 0);
          const cross = new THREE.BoxGeometry(2.6, 0.16, 0.16);
          cross.translate(0, 10.1, 0);
          const cross2 = new THREE.BoxGeometry(1.9, 0.14, 0.14);
          cross2.translate(0, 9.3, 0);
          const dg = mergeGeometries([pole, cross, cross2], false);
          dg.applyMatrix4(new THREE.Matrix4().compose(base, q, new THREE.Vector3(1, 1, 1)));
          darkGeos.push(dg);
        }
        wirePts.push(base.clone().add(new THREE.Vector3(0, 10.1, 0)));
      }
      if (wirePts.length > 1) {
        const segs = [];
        for (let i = 0; i < wirePts.length - 1; i++) {
          const a = wirePts[i];
          const b = wirePts[i + 1];
          const STEPS = 6;
          for (let k = 0; k < STEPS; k++) {
            const f0 = k / STEPS;
            const f1 = (k + 1) / STEPS;
            const sag = (f) => -Math.sin(f * Math.PI) * 1.1;
            for (const off of [-0.9, 0, 0.9]) {
              const p0 = a.clone().lerp(b, f0);
              const p1 = a.clone().lerp(b, f1);
              p0.y += sag(f0);
              p1.y += sag(f1);
              segs.push(p0.x + off * 0.0, p0.y + off * 0.35, p0.z, p1.x, p1.y + off * 0.35, p1.z);
            }
          }
        }
        const wg = new THREE.BufferGeometry();
        wg.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
        const wires = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x14161a, transparent: true, opacity: 0.85 }));
        g.add(wires);
      }
    }

    // corner chevrons + occasional signs
    {
      const sm = {};
      for (let s = s0 + 20; s < s1; s += 20) {
        t.sample(s, sm);
        const k = sm.curv;
        if (Math.abs(k) > 0.0035) {
          const side = k > 0 ? -1 : 1;
          const pl = new THREE.PlaneGeometry(1.1, 1.1);
          const base = new THREE.Vector3().copy(sm.pos).addScaledVector(sm.right, side * (HW + 4.2)).addScaledVector(sm.up, 1.5);
          const q = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(sm.right, sm.up, TMP.copy(sm.fwd).negate())
          );
          const geo = pl.clone();
          if (side > 0) geo.rotateY(Math.PI);
          geo.applyMatrix4(new THREE.Matrix4().compose(base, q, new THREE.Vector3(1, 1, 1)));
          const mesh = new THREE.Mesh(geo, mats.signMats.chevron);
          mesh.castShadow = false;
          g.add(mesh);
          const post = new THREE.CylinderGeometry(0.05, 0.05, 1.5, 5);
          post.translate(0, 0.75, 0);
          post.applyMatrix4(
            new THREE.Matrix4().compose(
              new THREE.Vector3().copy(sm.pos).addScaledVector(sm.right, side * (HW + 4.2)),
              q,
              new THREE.Vector3(1, 1, 1)
            )
          );
          darkGeos.push(post);
        }
      }
      // one signpost per chunk
      if (rng.chance(0.55) && !tun) {
        const s = rng.range(s0 + 20, s1 - 20);
        t.sample(s, sm);
        const side = rng.sign();
        const kind = rng.pick(['speed', 'warn', 'exit']);
        const size = kind === 'exit' ? [4.4, 2.2] : [1.5, 1.5];
        const hgt = kind === 'exit' ? 5.4 : 2.6;
        const q = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(sm.right, sm.up, TMP.copy(sm.fwd).negate())
        );
        const base = new THREE.Vector3().copy(sm.pos).addScaledVector(sm.right, side * (HW + 5.0));
        const pl = new THREE.PlaneGeometry(size[0], size[1]);
        pl.translate(0, hgt, 0);
        if (side > 0) pl.rotateY(Math.PI);
        pl.applyMatrix4(new THREE.Matrix4().compose(base, q, new THREE.Vector3(1, 1, 1)));
        const signMesh = new THREE.Mesh(pl, mats.signMats[kind]);
        signMesh.castShadow = false;
        g.add(signMesh);
        const post = new THREE.CylinderGeometry(0.08, 0.08, hgt, 6);
        post.translate(0, hgt / 2, 0);
        post.applyMatrix4(new THREE.Matrix4().compose(base, q, new THREE.Vector3(1, 1, 1)));
        darkGeos.push(post);
      }
      // billboard every few chunks
      if (ci % 3 === 1 && !tun && !brg) {
        const s = s0 + t.chunkLen * 0.5;
        t.sample(s, sm);
        const side = ci % 6 === 1 ? 1 : -1;
        const q = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(sm.right, sm.up, TMP.copy(sm.fwd).negate())
        );
        const base = new THREE.Vector3().copy(sm.pos).addScaledVector(sm.right, side * (HW + 15));
        base.y += this.hillHeight(base.x, base.z, HW + 15) * 0.9;
        const board = new THREE.PlaneGeometry(12.5, 6.2);
        board.translate(0, 9.4, 0);
        // Both sides must face oncoming traffic. The `Math.PI` branch turned
        // every billboard on the +right side of the road through 180 deg, so
        // its FrontSide plane was culled and all the player saw was the dark
        // support frame behind it: a solid black rectangle beside the road.
        // The only per-side difference should be the sign of the toe-in.
        board.rotateY(-side * 0.28);
        board.applyMatrix4(new THREE.Matrix4().compose(base, q, new THREE.Vector3(1, 1, 1)));
        const bm = new THREE.Mesh(board, mats.billboardMats[(ci / 3) % mats.billboardMats.length | 0]);
        bm.castShadow = false;
        g.add(bm);
        const frame = new THREE.BoxGeometry(13.1, 6.8, 0.3);
        frame.translate(0, 9.4, -0.25);
        frame.rotateY(-side * 0.28);
        const legA = new THREE.BoxGeometry(0.3, 9.4, 0.3);
        legA.translate(-3.6, 4.7, 0);
        const legB = new THREE.BoxGeometry(0.3, 9.4, 0.3);
        legB.translate(3.6, 4.7, 0);
        const fg = mergeGeometries([frame, legA, legB], false);
        fg.applyMatrix4(new THREE.Matrix4().compose(base, q, new THREE.Vector3(1, 1, 1)));
        darkGeos.push(fg);
      }
    }

    if (railGeos.length) {
      const m = new THREE.Mesh(mergeGeometries(railGeos, false), mats.rail);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    if (darkGeos.length) {
      const m = new THREE.Mesh(mergeGeometries(darkGeos, false), mats.darkMetal);
      m.castShadow = true;
      g.add(m);
    }
    if (emitGeos.length) g.add(new THREE.Mesh(mergeGeometries(emitGeos, false), mats.emissiveWhite));

    // ---------------- vegetation ----------------
    if (!tun && !brg) this.addVegetation(g, ci, rng, s0, s1);

    g.visible = false;
    return g;
  }

  // Six tree species. Each is a merged alpha-cut canopy with baked vertical AO
  // in vertex colour; they share two materials so the whole forest is seven
  // draw calls. Silhouette, not texture, is what separates them at distance.
  buildTreeSpecies() {
    const mats = this.mats;
    const trunk = new THREE.CylinderGeometry(0.13, 0.42, 5.0, 6);
    trunk.translate(0, 2.5, 0);
    trunk.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(new Float32Array(trunk.attributes.position.count * 3).fill(1), 3)
    );
    this._trunkGeo = trunk;

    const bakeAO = (geo, y0, y1, floor = 0.38) => {
      const p = geo.attributes.position;
      const c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const ao = floor + (1 - floor) * smoothstep(y0, y1, p.getY(i));
        c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = ao;
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      return geo;
    };

    // --- conifers: stacked alpha skirts ------------------------------------
    const conifer = (layers, baseR, falloff, y0, span, layerH, twist, tipH) => {
      const parts = [];
      for (let i = 0; i < layers; i++) {
        const f = layers === 1 ? 0 : i / (layers - 1);
        const r = baseR * Math.pow(1 - f, falloff) + 0.3;
        const h = layerH - f * layerH * 0.4;
        const c = new THREE.ConeGeometry(r, h, 8, 2, true);
        c.rotateY(i * twist);
        c.translate(0, y0 + f * span + h * 0.22, 0);
        if (i % 2) c.scale(1.0, 0.92, 0.88);
        const uv = c.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (2.2 + r * 1.15), uv.getY(k) * 1.6);
        parts.push(c);
      }
      const tip = new THREE.ConeGeometry(0.4, tipH, 6, 1, true);
      tip.translate(0, y0 + span + tipH * 0.35, 0);
      parts.push(tip);
      return bakeAO(mergeGeometries(parts, false), y0 - 0.4, y0 + span * 0.85);
    };

    // --- broadleaf: crossed cards in a shaped canopy volume -----------------
    const broadleaf = (cards, rx, ry, y0, cardW, cardH, tilt) => {
      const parts = [];
      for (let i = 0; i < cards; i++) {
        const q = new THREE.PlaneGeometry(cardW, cardH, 1, 1);
        const ang = i * 2.399;
        const t01 = (i + 0.4) / cards;
        const rad = rx * Math.sqrt(t01);
        const yy = y0 + Math.sin(i * 1.7) * ry * 0.45 + ry * 0.5;
        const m = new THREE.Matrix4();
        m.makeRotationY(ang);
        q.applyMatrix4(m);
        m.makeRotationX((Math.sin(i * 2.3) - 0.1) * tilt);
        q.applyMatrix4(m);
        q.translate(Math.cos(ang) * rad, yy, Math.sin(ang) * rad);
        const uv = q.attributes.uv;
        const ou = (i * 0.37) % 1;
        const ov = (i * 0.61) % 1;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 1.35 + ou, uv.getY(k) * 1.35 + ov);
        parts.push(q);
      }
      return bakeAO(mergeGeometries(parts, false), y0 - 0.6, y0 + ry * 1.2, 0.5);
    };

    const V3 = THREE.Vector3;
    this._treeVariants = [
      // 0 spruce: tall, narrow, dense
      {
        geo: conifer(11, 2.95, 0.62, 1.9, 7.4, 3.0, 0.53, 1.5),
        mat: mats.canopy,
        conifer: true,
        share: 0.2,
        trunk: new V3(1, 1, 1),
        hue: 0.29,
        sat: [0.3, 0.55],
        lum: [0.16, 0.3],
      },
      // 1 fir: shorter, much broader skirts
      {
        geo: conifer(9, 3.95, 0.48, 1.15, 5.4, 3.4, 0.81, 1.1),
        mat: mats.canopy,
        conifer: true,
        share: 0.16,
        trunk: new V3(1.15, 0.5, 1.15),
        hue: 0.26,
        sat: [0.26, 0.46],
        lum: [0.19, 0.33],
      },
      // 2 pine: bare lower trunk, small tuft high up
      {
        geo: conifer(8, 3.35, 0.40, 4.3, 5.2, 3.1, 1.27, 1.0),
        mat: mats.canopy,
        conifer: true,
        share: 0.14,
        trunk: new V3(0.86, 1.05, 0.86),
        hue: 0.24,
        sat: [0.24, 0.42],
        lum: [0.2, 0.34],
      },
      // 3 oak: round, heavy
      {
        geo: broadleaf(12, 1.45, 3.4, 4.2, 5.2, 4.0, 0.55),
        mat: mats.canopyLeaf,
        conifer: false,
        share: 0.2,
        trunk: new V3(1.5, 1.05, 1.5),
        hue: 0.24,
        sat: [0.3, 0.6],
        lum: [0.18, 0.36],
      },
      // 4 poplar: columnar, tall and thin
      {
        geo: broadleaf(14, 0.85, 7.2, 2.8, 3.1, 3.8, 0.22),
        mat: mats.canopyLeaf,
        conifer: false,
        share: 0.15,
        trunk: new V3(0.72, 1.15, 0.72),
        hue: 0.2,
        sat: [0.34, 0.62],
        lum: [0.22, 0.4],
      },
      // 5 maple: wide, low, spreading
      {
        geo: broadleaf(13, 2.5, 2.4, 3.0, 6.0, 3.4, 0.86),
        mat: mats.canopyLeaf,
        conifer: false,
        share: 0.15,
        trunk: new V3(1.6, 0.78, 1.6),
        hue: 0.16,
        sat: [0.36, 0.66],
        lum: [0.2, 0.38],
      },
    ];
  }

  addVegetation(g, ci, rng, s0, s1) {
    const t = this.track;
    const mats = this.mats;
    const tune = this.tuning;
    const sm = {};

    // --- trees: six species, three conifer + three broadleaf ---------------
    const treeCount = tune.trees;
    if (treeCount > 0) {
      if (!this._treeVariants) this.buildTreeSpecies();
      // Six species exist, but a real stand is locally homogeneous: pick three
      // per chunk (always at least one conifer and one broadleaf so the
      // silhouette mix stays varied) and the forest reads as six species along
      // the lap while costing three instanced meshes per chunk instead of six.
      const ALL = this._treeVariants;
      const pickR = new RNG(this.seed * 331 + ci * 37 + 5);
      const cone = [0, 1, 2];
      const leaf = [3, 4, 5];
      const idxs = [cone[pickR.int(0, 2)], leaf[pickR.int(0, 2)]];
      const spare = [0, 1, 2, 3, 4, 5].filter((k) => !idxs.includes(k));
      idxs.push(spare[pickR.int(0, spare.length - 1)]);
      const V = idxs.map((k) => ALL[k]);
      // one instanced mesh per species + a single shared trunk mesh: seven
      // draw calls for six readable silhouettes.
      const per = V.map(() => new THREE.InstancedMesh(null, null, 0));
      V.forEach((v, i) => { per[i] = new THREE.InstancedMesh(v.geo, v.mat, Math.ceil(treeCount * 0.5) + 4); });
      per.forEach((m, i) => {
        m.castShadow = V[i].conifer;
        m.receiveShadow = false;
        m.frustumCulled = true;
      });
      const trunks = new THREE.InstancedMesh(this._trunkGeo, mats.bark, treeCount);
      trunks.castShadow = false;
      const counts = new Array(V.length).fill(0);
      let tPlaced = 0;
      const mtx = new THREE.Matrix4();
      const tmtx = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const col = new THREE.Color();
      const scl = new THREE.Vector3();
      const YAX = new THREE.Vector3(0, 1, 0);
      // trees come in clumps, never evenly scattered; a clump is mostly one
      // species with a couple of strays, which is how real stands look
      let clumpS = 0;
      let clumpX = 0;
      let clumpSide = 1;
      let clumpV = 0;
      for (let i = 0; i < treeCount; i++) {
        if (i % 5 === 0) {
          clumpS = rng.range(s0, s1);
          clumpSide = rng.sign();
          clumpX = rng.range(19, 122);
          clumpV = rng.int(0, V.length - 1);
        }
        const vi = rng.next() < 0.72 ? clumpV : rng.int(0, V.length - 1);
        const v = V[vi];
        if (counts[vi] >= per[vi].instanceMatrix.count) continue;
        const s = clumpS + rng.range(-16, 16);
        const x = clumpSide * Math.max(17, clumpX + rng.range(-13, 13));
        t.sample(s, sm);
        const p = new THREE.Vector3().copy(sm.pos).addScaledVector(sm.right, x);
        p.y += t.terrainProfile(s, x) + this.hillHeight(p.x, p.z, Math.abs(x)) - 0.3;
        const sc = rng.range(0.8, 1.38);
        q.setFromAxisAngle(YAX, rng.range(0, 6.28));
        scl.set(sc * rng.range(0.85, 1.15), sc, sc * rng.range(0.85, 1.15));
        mtx.compose(p, q, scl);
        per[vi].setMatrixAt(counts[vi], mtx);
        col.setHSL(
          v.hue + rng.range(-0.035, 0.035),
          rng.range(v.sat[0], v.sat[1]),
          rng.range(v.lum[0], v.lum[1])
        );
        per[vi].setColorAt(counts[vi], col);
        counts[vi]++;
        tmtx.compose(p, q, scl.clone().multiply(v.trunk));
        trunks.setMatrixAt(tPlaced, tmtx);
        col.setHSL(0.08, 0.24, rng.range(0.07, 0.14));
        trunks.setColorAt(tPlaced, col);
        tPlaced++;
      }
      per.forEach((m, i) => {
        m.count = counts[i];
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        if (counts[i] > 0) {
          g.add(m);
          if (i > 0) g.userData.detail.extraTrees.push(m);
        }
      });
      trunks.count = tPlaced;
      trunks.instanceMatrix.needsUpdate = true;
      if (trunks.instanceColor) trunks.instanceColor.needsUpdate = true;
      g.add(trunks);
    }

    // --- rocks / bushes ---
    if (tune.rocks > 0) {
      if (!this._rockGeo) {
        const geo = new THREE.IcosahedronGeometry(1, 1);
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const f = 0.7 + Math.random() * 0.6;
          p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.7, p.getZ(i) * f);
        }
        geo.computeVertexNormals();
        this._rockGeo = geo;
      }
      const rocks = new THREE.InstancedMesh(this._rockGeo, mats.rock, tune.rocks);
      rocks.castShadow = false;
      rocks.receiveShadow = true;
      const mtx = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      for (let i = 0; i < tune.rocks; i++) {
        const s = rng.range(s0, s1);
        const side = rng.sign();
        const x = side * rng.range(HW + 6, 70);
        t.sample(s, sm);
        const p = new THREE.Vector3().copy(sm.pos).addScaledVector(sm.right, x);
        p.y += t.terrainProfile(s, x) + this.hillHeight(p.x, p.z, Math.abs(x));
        const sc = rng.range(0.45, 1.75);
        q.setFromEuler(new THREE.Euler(rng.range(0, 0.4), rng.range(0, 6.28), rng.range(0, 0.4)));
        p.y -= sc * 0.42;
        mtx.compose(p, q, new THREE.Vector3(sc, sc * rng.range(0.5, 0.95), sc));
        rocks.setMatrixAt(i, mtx);
      }
      rocks.instanceMatrix.needsUpdate = true;
      g.add(rocks);
      g.userData.detail.small.push(rocks);
    }

    // --- grass tufts hugging the shoulder ---
    if (tune.grass > 0) {
      if (!this._grassGeo) {
        const a = new THREE.PlaneGeometry(1.15, 0.72);
        a.translate(0, 0.5, 0);
        const b = a.clone();
        b.rotateY(Math.PI / 2);
        const c = a.clone();
        c.rotateY(Math.PI / 4);
        this._grassGeo = mergeGeometries([a, b, c], false);
      }
      const cnt = tune.grass;
      const grass = new THREE.InstancedMesh(this._grassGeo, mats.grass, cnt);
      grass.castShadow = false;
      grass.receiveShadow = true;
      const mtx = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      for (let i = 0; i < cnt; i++) {
        const s = rng.range(s0, s1);
        const side = rng.sign();
        const x = side * rng.range(HW + 2.0, HW + tune.grassR);
        t.sample(s, sm);
        const p = new THREE.Vector3().copy(sm.pos).addScaledVector(sm.right, x);
        p.y += t.terrainProfile(s, x) + this.hillHeight(p.x, p.z, Math.abs(x)) - 0.08;
        const sc = rng.range(0.5, 1.5);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, 6.28));
        mtx.compose(p, q, new THREE.Vector3(sc, sc * rng.range(0.7, 1.4), sc));
        grass.setMatrixAt(i, mtx);
      }
      grass.instanceMatrix.needsUpdate = true;
      g.add(grass);
      g.userData.detail.small.push(grass);
    }
  }

  // -------------------------------------------------------------- tunnels
  buildTunnels() {
    const t = this.track;
    const mats = this.mats;
    this.tunnelGroups = [];
    for (const tun of t.tunnels) {
      const g = new THREE.Group();
      const sm = {};
      const step = 6;
      const stations = Math.ceil((tun.s1 - tun.s0) / step) + 1;
      const SEG = 14;
      const pos = [];
      const norm = [];
      const uv = [];
      for (let i = 0; i < stations; i++) {
        const s = tun.s0 + ((tun.s1 - tun.s0) * i) / (stations - 1);
        t.sample(s, sm);
        for (let k = 0; k <= SEG; k++) {
          const a = Math.PI * (k / SEG);
          const rx = Math.cos(a) * (HW + 3.6);
          const ry = Math.sin(a) * 7.6;
          TMP.copy(sm.pos).addScaledVector(sm.right, rx).addScaledVector(sm.up, ry - 0.3);
          pos.push(TMP.x, TMP.y, TMP.z);
          TMP.set(0, 0, 0).addScaledVector(sm.right, -Math.cos(a)).addScaledVector(sm.up, -Math.sin(a));
          norm.push(TMP.x, TMP.y, TMP.z);
          uv.push((k / SEG) * 6, s * 0.09);
        }
      }
      const shell = new THREE.Mesh(makeGeom(pos, norm, uv, gridIndices(stations, SEG + 1)), mats.concrete);
      shell.receiveShadow = true;
      g.add(shell);

      // portal rings
      for (const s of [tun.s0, tun.s1]) {
        t.sample(s, sm);
        const ring = new THREE.TorusGeometry(HW + 4.4, 0.7, 6, 22, Math.PI);
        const q = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(sm.right, sm.up, TMP.copy(sm.fwd).negate())
        );
        ring.applyMatrix4(
          new THREE.Matrix4().compose(new THREE.Vector3().copy(sm.pos).addScaledVector(sm.up, -0.3), q, new THREE.Vector3(1, 1, 1))
        );
        const m = new THREE.Mesh(ring, mats.concrete);
        m.castShadow = true;
        g.add(m);
      }

      // ceiling light strips
      const strips = [];
      for (let s = tun.s0 + 8; s < tun.s1 - 4; s += 16) {
        t.sample(s, sm);
        const q = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(sm.right, sm.up, TMP.copy(sm.fwd).negate())
        );
        const box = new THREE.BoxGeometry(2.6, 0.18, 0.5);
        box.applyMatrix4(
          new THREE.Matrix4().compose(new THREE.Vector3().copy(sm.pos).addScaledVector(sm.up, 6.6), q, new THREE.Vector3(1, 1, 1))
        );
        strips.push(box);
      }
      if (strips.length) g.add(new THREE.Mesh(mergeGeometries(strips, false), mats.tunnelLight));

      // wall service lights (warm bands)
      const bands = [];
      for (let s = tun.s0 + 4; s < tun.s1 - 2; s += 32) {
        for (const side of [-1, 1]) {
          t.sample(s, sm);
          const q = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(sm.right, sm.up, TMP.copy(sm.fwd).negate())
          );
          const box = new THREE.BoxGeometry(0.28, 0.5, 0.4);
          box.applyMatrix4(
            new THREE.Matrix4().compose(
              new THREE.Vector3().copy(sm.pos).addScaledVector(sm.right, side * (HW + 3.2)).addScaledVector(sm.up, 3.0),
              q,
              new THREE.Vector3(1, 1, 1)
            )
          );
          bands.push(box);
        }
      }
      if (bands.length) g.add(new THREE.Mesh(mergeGeometries(bands, false), mats.emissiveAmber));

      g.userData.range = tun;
      g.visible = false;
      this.root.add(g);
      this.tunnelGroups.push(g);
    }
  }

  // -------------------------------------------------------------- bridges
  buildBridges() {
    const t = this.track;
    const mats = this.mats;
    this.bridgeGroups = [];
    for (const br of t.bridges) {
      const g = new THREE.Group();
      const sm = {};
      const concreteGeos = [];
      // deck underside + edge beams
      const step = 6;
      const stations = Math.ceil((br.s1 - br.s0) / step) + 1;
      const profile = [
        [-(HW + 1.6), -0.2],
        [HW + 1.6, -0.2],
        [HW + 1.6, -1.9],
        [-(HW + 1.6), -1.9],
      ];
      concreteGeos.push(extrudeAlong(t, br.s0, br.s1, step, profile, 0, 0.12));
      // parapets
      for (const side of [-1, 1]) {
        const pf = [
          [-0.25, -0.2],
          [0.25, -0.2],
          [0.25, 1.15],
          [-0.25, 1.15],
        ];
        concreteGeos.push(extrudeAlong(t, br.s0, br.s1, step, pf, side * (HW + 1.35), 0.2));
      }
      // pillars
      for (let i = 1; i < stations - 1; i += 4) {
        const s = br.s0 + ((br.s1 - br.s0) * i) / (stations - 1);
        t.sample(s, sm);
        const q = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(sm.right, sm.up, TMP.copy(sm.fwd).negate())
        );
        for (const side of [-1, 1]) {
          const h = 58;
          const col = new THREE.CylinderGeometry(1.5, 2.4, h, 10);
          col.translate(side * 4.5, -h / 2 - 1.9, 0);
          col.applyMatrix4(new THREE.Matrix4().compose(sm.pos.clone(), q, new THREE.Vector3(1, 1, 1)));
          concreteGeos.push(col);
        }
        const cross = new THREE.BoxGeometry(12, 1.2, 1.6);
        cross.translate(0, -3.4, 0);
        cross.applyMatrix4(new THREE.Matrix4().compose(sm.pos.clone(), q, new THREE.Vector3(1, 1, 1)));
        concreteGeos.push(cross);
      }
      const m = new THREE.Mesh(mergeGeometries(concreteGeos, false), mats.concrete);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      g.userData.range = br;
      g.visible = false;
      this.root.add(g);
      this.bridgeGroups.push(g);
    }
  }

  // ----------------------------------------------------------------- clouds
  // Two counter-drifting cumulus decks on huge horizontal planes. Without
  // these the sky is a flat vertical ramp and the whole upper half of every
  // frame is dead space; with them the horizon gets a readable scale cue.
  buildClouds() {
    const map = this.mats.T.clouds;
    this.cloudLayers = [];
    const decks = [
      { y: 540, size: 9000, rep: 4.6, op: 0.9, drift: 5.5, tint: 0xffffff },
      { y: 920, size: 15000, rep: 2.6, op: 0.55, drift: -3.0, tint: 0xd6e0ee },
    ];
    for (const dk of decks) {
      const m = map.clone();
      m.needsUpdate = true;
      m.wrapS = m.wrapT = THREE.RepeatWrapping;
      m.repeat.set(dk.rep, dk.rep);
      const mat = new THREE.MeshBasicMaterial({
        map: m,
        color: new THREE.Color(dk.tint).multiply(new THREE.Color(this.cloudTint)),
        transparent: true,
        opacity: dk.op * this.cloudOp,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(dk.size, dk.size, 1, 1), mat);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.y = dk.y;
      mesh.renderOrder = -5;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.root.add(mesh);
      this.cloudLayers.push({ mesh, m, drift: dk.drift });
    }
  }

  // -------------------------------------------------------------- mountains
  buildMountains() {
    const rng = new RNG(this.seed * 31 + 5);
    const pos = [];
    const norm = [];
    const uv = [];
    const col = [];
    const idx = [];
    const SEG = 260;
    const rings = [
      { r: 2600, h: 480, c: 0x4a5a72, jag: 1.0 },
      { r: 3900, h: 760, c: 0x5d6b83, jag: 0.7 },
    ];
    let base = 0;
    for (const ring of rings) {
      const c3 = new THREE.Color(ring.c);
      for (let i = 0; i <= SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        const rr = ring.r * (0.85 + 0.3 * ridged(Math.cos(a) * 2.2, Math.sin(a) * 2.2, 3, 12));
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;
        const peak =
          ring.h *
          (0.25 +
            0.75 *
              Math.pow(ridged(Math.cos(a) * 6 + 11, Math.sin(a) * 6, 5, 3), 1.3) *
              (0.6 + 0.4 * Math.sin(a * 9 + ring.jag)));
        pos.push(x, -40, z);
        norm.push(0, 1, 0);
        uv.push(i * 0.5, 0);
        col.push(c3.r * 0.55, c3.g * 0.58, c3.b * 0.65);
        pos.push(x, peak, z);
        norm.push(0, 1, 0);
        uv.push(i * 0.5, 1);
        const snow = smoothstep(ring.h * 0.55, ring.h * 0.95, peak);
        col.push(lerp(c3.r, 1.15, snow), lerp(c3.g, 1.18, snow), lerp(c3.b, 1.25, snow));
      }
      for (let i = 0; i < SEG; i++) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      base = pos.length / 3;
    }
    const geo = makeGeom(pos, norm, uv, idx, col);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.mats.distant);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    this.mountains = mesh;
    this.root.add(mesh);
    void rng;
  }

  // -------------------------------------------------------------- city
  buildCity() {
    const t = this.track;
    const rng = new RNG(this.seed * 977 + 3);
    const winTex = windowTexture(this.quality === 'low' ? 128 : 256);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4a5563,
      roughness: 0.8,
      metalness: 0.18,
      map: winTex,
      emissiveMap: winTex,
      emissive: 0xffffff,
      emissiveIntensity: 0.16,
      envMapIntensity: 1.0,
      vertexColors: true,
    });
    const count = this.quality === 'low' ? 30 : 104;
    const sm = {};
    const s0 = t.city.s0;
    const span = t.city.s1 - t.city.s0;
    // One tight downtown cluster rather than buildings scattered along the
    // whole city stretch: scattered towers read as a row of tombstones on the
    // horizon, a clustered core with a height falloff reads as a skyline.
    const coreS = t.wrap(s0 + span * 0.55);
    const coreX = 1180;
    t.sample(coreS, sm);
    const core = new THREE.Vector3().copy(sm.pos).addScaledVector(sm.right, coreX);
    const coreFwd = sm.fwd.clone();
    const coreRight = sm.right.clone();

    // Five archetypes. A skyline made of one primitive is a bar chart; the
    // silhouette is the only thing readable at 1.2km, so the variation has to
    // live in the outline, not in the texture.
    //   0 slab      - flat-topped curtain wall tower
    //   1 setback   - stepped art-deco style, three diminishing stages
    //   2 spire     - tower with a tapered crown and a mast
    //   3 podium    - wide low-rise block with a rooftop plant room
    //   4 cylinder  - round tower with a banded crown
    const box = (w, h, d, y) => {
      const gg = new THREE.BoxGeometry(w, h, d);
      gg.translate(0, y + h / 2, 0);
      return gg;
    };
    const archetype = (kind, w, h, d, r) => {
      const parts = [];
      if (kind === 0) {
        parts.push(box(w, h, d, 0));
        parts.push(box(w * 0.34, h * 0.05, d * 0.34, h));
      } else if (kind === 1) {
        parts.push(box(w, h * 0.5, d, 0));
        parts.push(box(w * 0.76, h * 0.31, d * 0.76, h * 0.5));
        parts.push(box(w * 0.5, h * 0.19, d * 0.5, h * 0.81));
        parts.push(box(w * 0.14, h * 0.06, d * 0.14, h));
      } else if (kind === 2) {
        parts.push(box(w, h * 0.86, d, 0));
        const crown = new THREE.CylinderGeometry(w * 0.05, w * 0.42, h * 0.14, 6);
        crown.translate(0, h * 0.86 + h * 0.07, 0);
        parts.push(crown);
        const mast = new THREE.CylinderGeometry(w * 0.012, w * 0.02, h * 0.17, 4);
        mast.translate(0, h * 1.0 + h * 0.085, 0);
        parts.push(mast);
      } else if (kind === 3) {
        parts.push(box(w * 1.55, h, d * 1.35, 0));
        parts.push(box(w * 0.42, h * 0.16, d * 0.34, h));
        parts.push(box(w * 0.2, h * 0.09, d * 0.2, h * 1.16));
      } else {
        const cyl = new THREE.CylinderGeometry(w * 0.5, w * 0.54, h * 0.92, 12, 1);
        cyl.translate(0, h * 0.46, 0);
        parts.push(cyl);
        const band = new THREE.CylinderGeometry(w * 0.58, w * 0.58, h * 0.045, 12);
        band.translate(0, h * 0.92 + h * 0.022, 0);
        parts.push(band);
        parts.push(box(w * 0.22, h * 0.06, d * 0.22, h * 0.965));
      }
      const m = mergeGeometries(parts, false);
      // vertical UV cadence: floors must be the same height on every archetype
      const uv = m.attributes.uv;
      const pos = m.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 14), pos.getY(i) / 3.6);
      // baked atmospheric fade: the base of a distant tower is seen through
      // more air than its crown, so it washes out first. Fog alone applies
      // this uniformly per-object and loses the vertical gradient entirely.
      const cA = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const hz = clamp(1 - pos.getY(i) / (h * 1.1), 0, 1);
        const f = lerp(1.0, 0.62, hz * hz) * lerp(1.0, 0.66, r);
        cA[i * 3] = f * 0.98;
        cA[i * 3 + 1] = f;
        cA[i * 3 + 2] = f * 1.06;
      }
      m.setAttribute('color', new THREE.Float32BufferAttribute(cA, 3));
      return m;
    };

    const all = [];
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const r = Math.pow(rng.next(), 0.65);
      const ang = rng.range(0, Math.PI * 2);
      const du = Math.cos(ang) * r * 900;
      const dv = Math.sin(ang) * r * 620;
      const p = new THREE.Vector3()
        .copy(core)
        .addScaledVector(coreFwd, du)
        .addScaledVector(coreRight, dv);
      const h = (58 + 300 * Math.pow(1 - r, 1.7)) * rng.range(0.62, 1.35);
      // Bury the base far below grade. The distant hill ring is a separate mesh
      // with its own height field, so anything that merely "sits on"
      // hillHeight() ends up as a slab visibly floating over the skyline.
      p.y += this.hillHeight(p.x, p.z, coreX) - 190;
      const w = rng.range(30, 58) * (0.7 + 0.5 * r);
      const d = rng.range(30, 58) * (0.7 + 0.5 * r);
      // tall cores get spires and setbacks; the fringe gets podiums
      const kind = r < 0.34 ? rng.pick([0, 1, 2, 2, 4]) : rng.pick([0, 3, 3, 4, 1]);
      const geo = archetype(kind, w, h, d, r);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, 6.28));
      mtx.compose(p, q, new THREE.Vector3(1, 1, 1));
      geo.applyMatrix4(mtx);
      all.push(geo);
    }
    // Static and 1.2km away: merging the whole downtown into one buffer keeps
    // the skyline at a single draw call despite five distinct silhouettes.
    const mesh = new THREE.Mesh(mergeGeometries(all, false), mat);
    all.forEach((g) => g.dispose());
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.range = { s0: t.wrap(t.city.s0 - 900), s1: t.wrap(t.city.s1 + 900) };
    mesh.frustumCulled = true;
    this.city = mesh;
    this.root.add(mesh);
  }

  // -------------------------------------------------------------- start line
  bannerTexture(text, hue) {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 128;
    const ctx = c.getContext('2d');
    const grd = ctx.createLinearGradient(0, 0, 1024, 0);
    grd.addColorStop(0, hue[0]);
    grd.addColorStop(0.5, hue[1]);
    grd.addColorStop(1, hue[0]);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 1024, 128);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000';
    for (let i = -8; i < 40; i++) {
      ctx.save();
      ctx.translate(i * 32, 0);
      ctx.transform(1, 0, -0.35, 1, 0, 0);
      ctx.fillRect(0, 0, 14, 128);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 108, 1024, 20);
    ctx.fillRect(0, 0, 1024, 8);
    ctx.fillStyle = '#fff';
    ctx.font = '900 74px Impact, "Arial Black", system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, 62);
    const bt = new THREE.CanvasTexture(c);
    bt.colorSpace = THREE.SRGBColorSpace;
    bt.anisotropy = this.T.maxAniso || 8;
    return bt;
  }

  // A gantry straddling the road. `sPos` is the arc position; the banner is
  // built on a plane whose +Z normal is mapped to the basis third axis, so the
  // basis must use +fwd (not -fwd) or the text renders mirrored on the back
  // face and DoubleSide happily shows you the reversed side.
  buildGantry(sPos, text, hue, tall) {
    const t = this.track;
    const sm = t.sample(sPos, {});
    const g = new THREE.Group();
    // structure basis (-fwd) keeps box props oriented as before
    const qs = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(sm.right, sm.up, TMP.copy(sm.fwd).negate())
    );
    const H = tall ? 9.5 : 7.4;
    const geos = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.BoxGeometry(0.62, H, 0.62);
      leg.translate(side * (HW + 1.6), H / 2, 0);
      geos.push(leg);
      // lattice bracing
      for (let i = 0; i < 4; i++) {
        const br = new THREE.BoxGeometry(0.16, 1.9, 0.16);
        br.rotateX(i % 2 ? 0.62 : -0.62);
        br.translate(side * (HW + 1.6), 1.4 + i * 1.6, 0.42);
        geos.push(br);
      }
      const foot = new THREE.BoxGeometry(1.2, 0.35, 1.2);
      foot.translate(side * (HW + 1.6), 0.17, 0);
      geos.push(foot);
    }
    const beam = new THREE.BoxGeometry((HW + 2) * 2, 1.15, 0.8);
    beam.translate(0, H + 0.9, 0);
    geos.push(beam);
    const truss = new THREE.BoxGeometry((HW + 2) * 2, 0.22, 0.22);
    truss.translate(0, H + 0.05, 0);
    geos.push(truss);
    const merged = mergeGeometries(geos, false);
    merged.applyMatrix4(new THREE.Matrix4().compose(sm.pos.clone(), qs, new THREE.Vector3(1, 1, 1)));
    const m = new THREE.Mesh(merged, this.mats.darkMetal);
    m.castShadow = true;
    g.add(m);

    const bt = this.bannerTexture(text, hue);
    const qb = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(sm.right, sm.up, TMP.copy(sm.fwd))
    );
    const banner = new THREE.PlaneGeometry((HW + 2) * 2, 2.3);
    banner.translate(0, H - 1.1, 0.5);
    banner.applyMatrix4(new THREE.Matrix4().compose(sm.pos.clone(), qb, new THREE.Vector3(1, 1, 1)));
    g.add(
      new THREE.Mesh(
        banner,
        new THREE.MeshStandardMaterial({
          map: bt,
          roughness: 0.62,
          metalness: 0.0,
          side: THREE.FrontSide,
        })
      )
    );
    g.userData.s = sPos;
    g.visible = false;
    this.root.add(g);
    return g;
  }

  buildStartGantry() {
    const L = this.track.length;
    this.gantries = [
      this.buildGantry(0, 'ASPHALT FURY  \u2022  CANYON CIRCUIT', ['#a8121a', '#f0562a'], true),
      this.buildGantry(L * 0.22, 'SECTOR 2  \u2022  KEEP IT PINNED', ['#12324a', '#2f9ec4'], false),
      this.buildGantry(L * 0.47, 'HALFWAY  \u2022  NO PRISONERS', ['#3a2410', '#d09022'], false),
      this.buildGantry(L * 0.72, 'FINAL SECTOR  \u2022  RIDE OR DIE', ['#2a0d2e', '#a83ec8'], false),
    ];
    this.gantry = this.gantries[0];
  }

  // -------------------------------------------------------------- streaming
  inRange(s, playerS, back, fwd) {
    const d = this.track.delta(s, playerS);
    return d > -back && d < fwd;
  }

  update(playerS, viewFwd = 900, viewBack = 320, camPos = null, elapsed = 0) {
    const t = this.track;
    if (this.cloudLayers) {
      for (const cl of this.cloudLayers) {
        if (camPos) {
          cl.mesh.position.x = camPos.x;
          cl.mesh.position.z = camPos.z;
        }
        cl.m.offset.x = (elapsed * cl.drift) / 9000;
      }
    }
    for (const g of this.chunks) {
      const mid = (g.userData.s0 + g.userData.s1) / 2;
      const d = t.delta(mid, playerS);
      g.visible = d > -viewBack - t.chunkLen && d < viewFwd;
      // Per-chunk detail LOD. Shoulder grass tufts are 0.7 m tall and rocks are
      // under 2 m: past ~130 m both are sub-pixel, but each is still a live
      // draw call in the beauty pass and the cascade. Dropping them, and
      // collapsing to a single tree species, is invisible and buys back the
      // headroom the wide cinematic cameras need.
      if (g.visible) {
        const far = d > 130 || d < -110;
        const detail = g.userData.detail;
        if (detail && detail.far !== far) {
          detail.far = far;
          for (const m of detail.small) m.visible = !far;
          for (const m of detail.extraTrees) m.visible = !far;
        }
      }
    }
    for (const g of [...(this.tunnelGroups || []), ...(this.bridgeGroups || [])]) {
      const r = g.userData.range;
      const d0 = t.delta(r.s0, playerS);
      const d1 = t.delta(r.s1, playerS);
      g.visible = (d1 > -viewBack && d0 < viewFwd) || (d0 < 0 && d1 > 0);
    }
    if (this.gantries) {
      for (const gg of this.gantries) {
        const d = t.delta(gg.userData.s, playerS);
        gg.visible = d > -260 && d < viewFwd;
      }
    }
    if (this.city) {
      const d = t.delta(t.city.s0 + 300, playerS);
      this.city.visible = d > -1800 && d < 3000;
    }
  }
}
