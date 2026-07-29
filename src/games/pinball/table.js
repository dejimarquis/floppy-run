/**
 * Space Cadet: Nova — table construction.
 *
 * Builds the physics colliders and every piece of geometry from `layout.js`.
 * Physics and visuals share the same numbers so they can never drift.
 *
 * Space mapping: table (x, y, z) → three (x, z, -y), and the whole group is
 * rotated about X by the incline so the far end sits higher, exactly like a
 * real cabinet on levellers.
 */

import * as THREE from 'three';
import { Q, mkMat } from './quality.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { L } from './layout.js';
import { Segment, Arc, Circle, Zone, Flipper, Rail, MAT } from './physics.js';
import {
  makePlayfieldArt,
  makePlayfieldGI,
  makePlayfieldMaps,
  canvasTexture,
  makeSideArt,
  makeBackglass,
  makeApronArt,
  makePlasticArt,
  makeBumperCapArt,
  makeRampArt,
  makeTargetFace,
  makeInsertArt,
} from './art.js';
import { glassSmudge } from './materials.js';
import { buildHardware } from './hardware.js';

export const V = (x, y, z = 0) => new THREE.Vector3(x, z, -y);

const PF_Y = 0; // playfield surface height in local space

/* ------------------------------------------------------------------ */
/* geometry helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * ExtrudeGeometry emits UVs in *object* units, so a 90mm plastic samples a
 * 0.09x0.09 corner of its texture. Renormalise the top face onto 0..1 so
 * screen-printed art actually lands on the part.
 */
function smoothPolyline3(pts, n) {
  const curve = new THREE.CatmullRomCurve3(
    pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    false,
    'catmullrom',
    0.5
  );
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = curve.getPoint(i / (n - 1));
    out.push([v.x, v.y, v.z]);
  }
  return out;
}

function remapPlanarUV(geo) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const sx = 1 / Math.max(1e-6, bb.max.x - bb.min.x);
  const sz = 1 / Math.max(1e-6, bb.max.z - bb.min.z);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) - bb.min.x) * sx, (pos.getZ(i) - bb.min.z) * sz);
  }
  uv.needsUpdate = true;
}

function wallStrip(points, h, t, y0 = 0) {
  const geos = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0p] = points[i];
    const [x1, y1p] = points[i + 1];
    const dx = x1 - x0;
    const dy = y1p - y0p;
    const len = Math.hypot(dx, dy);
    if (len < 1e-5) continue;
    const g = new THREE.BoxGeometry(len + t, h, t);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dy, dx));
    m.compose(V((x0 + x1) / 2, (y0p + y1p) / 2, y0 + h / 2), q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    geos.push(g);
  }
  return geos.length ? mergeGeometries(geos) : null;
}

function arcPoints(cx, cy, r, a0, a1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

let _lensTex = null;
/** Soft rounded-rect lens falloff used by every playfield insert lamp. */
function insertLensTexture() {
  if (_lensTex) return _lensTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const u = (x / 127) * 2 - 1;
      const v = (y / 127) * 2 - 1;
      // rounded-rect signed distance -> lens core plus a wide soft bleed
      const bx = Math.max(Math.abs(u) - 0.42, 0);
      const by = Math.max(Math.abs(v) - 0.30, 0);
      const d = Math.hypot(bx, by);
      const core = Math.max(0, 1 - d / 0.10);
      const bleed = Math.max(0, 1 - d / 0.58);
      const a = Math.min(1, core * 0.8 + bleed * bleed * bleed * 0.28);
      const o = (y * 128 + x) * 4;
      img.data[o] = 255;
      img.data[o + 1] = 255;
      img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  _lensTex = new THREE.CanvasTexture(c);
  _lensTex.colorSpace = THREE.SRGBColorSpace;
  return _lensTex;
}

function tubeAlong(points3, radius, radial = 6, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points3.map((p) => V(p[0], p[1], p[2])), closed);
  const seg = Math.max(24, Math.min(220, Math.round(curve.getLength() / 0.008)));
  return new THREE.TubeGeometry(curve, seg, radius, radial, closed);
}

/* ------------------------------------------------------------------ */

export class Table {
  constructor(renderer, M, env, quality = 'ultra') {
    this.renderer = renderer;
    this.M = M;
    this.env = env;
    this.quality = quality;
    this.group = new THREE.Group();
    this.playfieldGroup = new THREE.Group();
    this.group.add(this.playfieldGroup);
    this.group.rotation.x = L.incline;
    this.lamps = {};
    this.parts = {};
    this.dynamic = [];
  }

  build(world, dmd) {
    this.world = world;
    this.buildPlayfield();
    this.buildWalls();
    this.buildLowerGuides();
    this.buildSlingshots();
    this.buildBumpers();
    this.buildTopLanes();
    this.buildDropTargets();
    this.buildStandups();
    this.buildSaucer();
    this.buildSpinner();
    this.buildCaptive();
    this.buildRamps();
    this.buildFlippers();
    this.buildPlunger();
    this.buildPlastics();
    this.buildLamps();
    this.buildApron();
    this.buildCabinet();
    this.buildBackbox(dmd);
    this.hardwareStats = buildHardware(this);
    this.buildGlass();
    return this;
  }

  /* ------------------------------------------------------------ */

  buildPlayfield() {
    const res = Q.artRes;
    const art = makePlayfieldArt(res);
    const maps = makePlayfieldMaps(art, Math.min(768, res / 2));
    this.art = art;

    const map = canvasTexture(art.canvas, { srgb: true, aniso: Q.aniso, renderer: this.renderer });
    const giMap = canvasTexture(makePlayfieldGI(art), { srgb: true, aniso: Q.aniso, renderer: this.renderer });
    const nrm = canvasTexture(maps.normal, { aniso: Q.aniso, renderer: this.renderer });
    const rgh = canvasTexture(maps.rough, { aniso: Q.aniso, renderer: this.renderer });

    const w = L.boardX1 - L.boardX0;
    const h = L.boardY1 - L.boardY0;
    const g = new THREE.PlaneGeometry(w, h, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate((L.boardX0 + L.boardX1) / 2, PF_Y, -(L.boardY0 + L.boardY1) / 2);

    const mat = mkMat(THREE, {
      map,
      // The print sits under glass in a dark room. It is lit almost entirely
      // by the machine's own hood lamp and the baked GI pools, so the albedo
      // is left untinted -- a grey multiplier here desaturated the whole
      // board to lavender and then the hood lamp blasted it back up as a
      // pastel wash, which is exactly the "printed mousepad" look.
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveMap: giMap,
      emissiveIntensity: 1.35,
      normalMap: nrm,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughnessMap: rgh,
      roughness: 1.0,
      metalness: 0.0,
      clearcoat: 1.0,
      // A real automotive-grade playfield coat is *sharp*: it mirrors the
      // individual lamps rather than smearing the whole room into a haze.
      // A broad lobe here plus a strong envMap was washing the printed art
      // to beige across the entire board.
      clearcoatRoughness: 0.085,
      clearcoatNormalMap: nrm,
      clearcoatNormalScale: new THREE.Vector2(0.32, 0.32),
      envMap: this.env,
      envMapIntensity: 0.15,
      reflectivity: 0.5,
    }, { keepCoat: true });
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.name = 'playfield';
    this.playfieldGroup.add(mesh);
    this.parts.playfield = mesh;

    // wooden underside/edge so the board reads as a physical slab
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.001, 0.026, h + 0.001),
      this.M.cabWood
    );
    edge.position.set((L.boardX0 + L.boardX1) / 2, -0.0135, -(L.boardY0 + L.boardY1) / 2);
    edge.receiveShadow = true;
    this.playfieldGroup.add(edge);
  }

  /* ------------------------------------------------------------ */

  addWall(points, opts = {}) {
    const mat = opts.mat || MAT.wood;
    for (let i = 0; i < points.length - 1; i++) {
      this.world.add(
        new Segment(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], {
          mat,
          tag: opts.tag,
          oneWay: opts.oneWay || 0,
        })
      );
    }
    if (opts.visual !== false) {
      const geo = wallStrip(points, opts.h ?? L.wallH, opts.t ?? L.wallT);
      if (geo) {
        const m = new THREE.Mesh(geo, opts.material || this.M.steelDark);
        m.castShadow = true;
        m.receiveShadow = true;
        this.playfieldGroup.add(m);
        return m;
      }
    }
    return null;
  }

  buildWalls() {
    const A = L.arcC;
    // --- outer boundary --------------------------------------------
    // left wall
    this.addWall(
      [
        [-L.half, 0.33],
        [-L.half, 0.8],
      ],
      { mat: MAT.metal, material: this.M.steel }
    );
    // top arc (concave — the ball orbits inside it)
    this.world.add(new Arc(A[0], A[1], L.arcR, 0, Math.PI, { concave: true, mat: MAT.metal, tag: 'orbitWall' }));
    const topPts = arcPoints(A[0], A[1], L.arcR, 0, Math.PI, 44);
    const topGeo = wallStrip(topPts, L.wallH, L.wallT);
    const topMesh = new THREE.Mesh(topGeo, this.M.steel);
    topMesh.castShadow = true;
    topMesh.receiveShadow = true;
    this.playfieldGroup.add(topMesh);

    // shooter lane
    this.addWall(
      [
        [L.laneOut, L.laneBottom],
        [L.laneOut, L.laneTop],
      ],
      { mat: MAT.metal, material: this.M.steel }
    );
    this.addWall(
      [
        [L.laneIn, L.laneBottom],
        [L.laneIn, L.laneTop],
      ],
      { mat: MAT.metal, material: this.M.steel }
    );
    this.addWall(
      [
        [L.laneIn - 0.001, L.laneBottom],
        [L.laneOut + 0.001, L.laneBottom],
      ],
      { mat: MAT.soft, visual: false }
    );

    // one-way gate at the top of the shooter lane
    const gate = new Segment(L.laneIn, L.gateY, L.laneOut, L.gateY, {
      mat: MAT.metal,
      tag: 'gate',
      oneWay: 1,
    });
    this.world.add(gate);
    const gateMesh = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const x = L.laneIn + 0.005 + i * 0.008;
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.0009, 0.0009, 0.019, 6), this.M.wire);
      w.position.copy(V(x, L.gateY, 0.0095));
      gateMesh.add(w);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.0013, 0.0013, 0.036, 8), this.M.wire);
    bar.rotation.z = Math.PI / 2;
    bar.position.copy(V((L.laneIn + L.laneOut) / 2, L.gateY, 0.019));
    gateMesh.add(bar);
    this.playfieldGroup.add(gateMesh);
    this.parts.gate = gateMesh;

    // orbit inner guide (left) — makes the return lane
    this.addWall(
      [
        [L.orbitGuideX, L.orbitGuideY0],
        [L.orbitGuideX, L.orbitGuideY1],
      ],
      { mat: MAT.metal, material: this.M.steel }
    );
    const capPts = arcPoints(L.orbitGuideX + 0.017, L.orbitGuideY1, 0.017, Math.PI, Math.PI * 1.62, 8);
    this.addWall(capPts, { mat: MAT.metal, material: this.M.steel });
    // rounded bottom end of the guide
    const post0 = this.post(L.orbitGuideX, L.orbitGuideY0, 0.006, 'rubberWhite');
    void post0;

    // lower field walls
    this.addWall(L.outerLowerL, { mat: MAT.wood, material: this.M.steelDark });
    this.addWall(L.outerLowerR, { mat: MAT.wood, material: this.M.steelDark });
    this.addWall(L.dividerL, { mat: MAT.wood, material: this.M.steelDark });
    this.addWall(L.dividerR, { mat: MAT.wood, material: this.M.steelDark });

    // right field boundary above the lower guides (below the lane top)
    this.addWall(
      [
        [L.laneIn, L.laneBottom],
        [L.laneIn, 0.33],
      ],
      { visual: false, mat: MAT.wood }
    );
  }

  buildLowerGuides() {
    // rubber-tipped posts at the mouth of the outlanes / by the flippers
    const posts = [
      [-0.214, 0.302],
      [0.18, 0.302],
      [-0.27, 0.33],
      [0.2245, 0.33],
    ];
    for (const [x, y] of posts) this.post(x, y, 0.0068, 'rubberWhite');

    // slingshot corner posts
    this.post(-0.192, 0.334, 0.0072, 'rubberRed');
    this.post(0.158, 0.334, 0.0072, 'rubberRed');

    // ---- left outlane kickback coil -------------------------------------
    // A real machine's kickback: a coil bolted under the apron with a chrome
    // plunger poking through a slot in the outlane wall. It fires the ball
    // back up the lane, which is why a modelled shaft that visibly punches
    // out is worth the twenty triangles.
    {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0058, 0.0058, 0.028, 14),
        this.M.blackMetal
      );
      body.rotation.x = Math.PI / 2;
      body.position.copy(V(-0.2620, 0.072, 0.011));
      body.castShadow = true;
      g.add(body);
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0072, 0.0072, 0.0035, 14),
        this.M.steel
      );
      collar.rotation.x = Math.PI / 2;
      collar.position.copy(V(-0.2585, 0.0995, 0.011));
      g.add(collar);
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0028, 0.0028, 0.030, 10),
        this.M.chrome
      );
      shaft.rotation.x = Math.PI / 2;
      shaft.castShadow = true;
      g.add(shaft);
      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0062, 0.0062, 0.0022, 16),
        mkMat(THREE, {
          color: 0xffb347,
          emissive: 0xff8a1e,
          emissiveIntensity: 0.7,
          roughness: 0.32,
          metalness: 0,
          transparent: true,
          opacity: 0.92,
        })
      );
      lens.rotation.x = Math.PI / 2;
      lens.position.copy(V(-0.2410, 0.1720, 0.0012));
      lens.rotation.z = 0;
      g.add(lens);
      this.playfieldGroup.add(g);
      this.parts.kickback = { g, shaft, lens, fire: 0, home: 0.112 };
      const home = this.parts.kickback.home;
      shaft.position.copy(V(-0.2560, home, 0.011));
      this.dynamic.push((dt) => {
        const k = this.parts.kickback;
        if (k.fire > 0) k.fire = Math.max(0, k.fire - dt * 7.5);
        const ext = k.fire > 0.5 ? (1 - k.fire) * 2 : k.fire * 2;
        k.shaft.position.copy(V(-0.2560, home + ext * 0.024, 0.011));
        k.lens.material.emissiveIntensity = 0.35 + ext * 1.6;
      });
    }
  }

  fireKickback() {
    if (this.parts.kickback) this.parts.kickback.fire = 1;
  }

  post(x, y, r, rubber = 'rubberWhite', h = 0.03) {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.62, h, 10), this.M.steel);
    shaft.position.copy(V(x, y, h / 2));
    shaft.castShadow = true;
    g.add(shaft);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.42, 8, 14), this.M[rubber]);
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(V(x, y, h * 0.55));
    ring.castShadow = true;
    g.add(ring);
    this.playfieldGroup.add(g);
    this.world.add(new Circle(x, y, r + 0.0008, { mat: MAT.post, tag: 'post' }));
    return g;
  }

  /* ------------------------------------------------------------ */

  buildSlingshots() {
    const make = (tri, tag) => {
      const [A, B, C] = tri;
      // kicking face A→B
      const kick = new Segment(A[0], A[1], B[0], B[1], {
        mat: MAT.rubber,
        tag,
        kick: 3.6,
        kickThreshold: 0.45,
      });
      this.world.add(kick);
      this.world.add(new Segment(B[0], B[1], C[0], C[1], { mat: MAT.plastic }));
      this.world.add(new Segment(C[0], C[1], A[0], A[1], { mat: MAT.plastic }));

      // ---- mounting plate: a low black bracket the assembly bolts to ----
      const shape = new THREE.Shape();
      shape.moveTo(A[0], -A[1]);
      shape.lineTo(B[0], -B[1]);
      shape.lineTo(C[0], -C[1]);
      shape.closePath();
      const plateGeo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.0055,
        bevelEnabled: true,
        bevelSize: 0.0012,
        bevelThickness: 0.001,
        bevelSegments: 1,
      });
      plateGeo.rotateX(Math.PI / 2);
      plateGeo.computeVertexNormals();
      const mesh = new THREE.Mesh(plateGeo, this.M.blackMetal);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.playfieldGroup.add(mesh);

      // ---- lit insert washing the plate from below --------------------
      const cen = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3];
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xff6a2c,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.036, 20), glowMat);
      glow.rotation.x = -Math.PI / 2;
      glow.position.copy(V(cen[0], cen[1], 0.0012));
      glow.renderOrder = 3;
      this.playfieldGroup.add(glow);

      // ---- raised screen-printed plastic canopy on standoffs ----------
      const capGeo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.0024,
        bevelEnabled: true,
        bevelSize: 0.0008,
        bevelThickness: 0.0006,
        bevelSegments: 1,
      });
      capGeo.rotateX(Math.PI / 2);
      capGeo.computeVertexNormals();
      remapPlanarUV(capGeo);
      const capTex = canvasTexture(makePlasticArt(0xff5a2a, 'SLING', 256), {
        srgb: true,
        aniso: Q.aniso,
        renderer: this.renderer,
      });
      const capMat = mkMat(THREE, {
        map: capTex,
        color: 0xffffff,
        metalness: 0.0,
        roughness: 0.09,
        transparent: true,
        opacity: 0.84,
        emissive: new THREE.Color(0xff5a2a),
        emissiveIntensity: 0.12,
        clearcoat: 1,
        clearcoatRoughness: 0.035,
        envMap: this.env,
        envMapIntensity: 0.75,
        side: THREE.DoubleSide,
      });
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.y = 0.0305;
      cap.castShadow = true;
      this.playfieldGroup.add(cap);

      // hex standoffs holding the canopy up off the plate
      const soGeo = new THREE.CylinderGeometry(0.0028, 0.0028, 0.0245, 6);
      for (const P of [A, B, C]) {
        const t = 0.72;
        const px = P[0] + (cen[0] - P[0]) * (1 - t);
        const py = P[1] + (cen[1] - P[1]) * (1 - t);
        const so = new THREE.Mesh(soGeo, this.M.steel);
        so.position.copy(V(px, py, 0.0182));
        so.castShadow = true;
        this.playfieldGroup.add(so);
      }

      // ---- rubber band stretched between the two face posts -----------
      const dx = B[0] - A[0];
      const dy = B[1] - A[1];
      const len = Math.hypot(dx, dy);
      const bandGeo = new THREE.CylinderGeometry(0.0022, 0.0022, len, 8);
      bandGeo.rotateZ(Math.PI / 2);
      const band = new THREE.Mesh(bandGeo, this.M.rubberRed);
      band.position.copy(V((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, 0.0152));
      band.rotation.y = Math.atan2(dy, dx);
      band.castShadow = true;
      this.playfieldGroup.add(band);

      // ---- chrome kicker arm poking through the face -------------------
      const nx = dy / len;
      const ny = -dx / len;
      // point the arm out of the triangle, away from the apex C
      const sgn = (C[0] - A[0]) * nx + (C[1] - A[1]) * ny > 0 ? -1 : 1;
      const armLen = 0.030;
      const kx = (A[0] + B[0]) / 2 + nx * sgn * 0.004;
      const ky = (A[1] + B[1]) / 2 + ny * sgn * 0.004;
      const armGeo = new THREE.BoxGeometry(0.010, 0.0042, armLen);
      const arm = new THREE.Mesh(armGeo, this.M.chrome);
      arm.position.copy(V(kx - nx * sgn * armLen * 0.42, ky - ny * sgn * armLen * 0.42, 0.0148));
      arm.rotation.y = Math.atan2(dy, dx) + Math.PI / 2;
      arm.castShadow = true;
      this.playfieldGroup.add(arm);
      const pivot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0044, 0.0044, 0.020, 10),
        this.M.steel
      );
      pivot.position.copy(V(kx - nx * sgn * armLen * 0.9, ky - ny * sgn * armLen * 0.9, 0.010));
      this.playfieldGroup.add(pivot);

      // flasher lamp on the apex bracket
      const flash = this.addFlasher(
        C[0] + (cen[0] - C[0]) * 0.35,
        C[1] + (cen[1] - C[1]) * 0.35,
        0.03,
        0xff5a2a,
        0.042
      );
      const rec = { kick, band, flash, tag, glowMat, capMat, level: 0 };
      this.dynamic.push((dt) => {
        rec.level = Math.max(0, rec.level - dt * 5.0);
        glowMat.opacity = 0.16 + rec.level * 0.75;
        capMat.emissiveIntensity = 0.12 + rec.level * 1.5;
      });
      return rec;
    };
    this.parts.slingL = make(L.slingL, 'slingL');
    this.parts.slingR = make(L.slingR, 'slingR');
  }

  addFlasher(x, y, r, color, h = 0.035) {
    const g = new THREE.Group();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      mkMat(THREE, {
        color,
        emissive: new THREE.Color(color),
        emissiveIntensity: 0.2,
        roughness: 0.15,
        transmission: 0.55,
        thickness: 0.004,
        transparent: true,
        opacity: 0.85,
        envMap: this.env,
      })
    );
    dome.position.copy(V(x, y, h));
    g.add(dome);
    const light = new THREE.PointLight(color, 0, 0.22, 2);
    if (!Q.practicalLights) light.visible = false;
    light.position.copy(V(x, y, h + 0.01));
    if (Q.eventLights) g.add(light);
    this.playfieldGroup.add(g);
    const rec = { dome, light, color: new THREE.Color(color), level: 0 };
    this.dynamic.push((dt) => {
      rec.level = Math.max(0, rec.level - dt * 4.2);
      dome.material.emissiveIntensity = 0.15 + rec.level * 5.5;
      light.intensity = rec.level * 0.55;
    });
    return rec;
  }

  /* ------------------------------------------------------------ */

  buildBumpers() {
    this.parts.bumpers = [];
    for (const b of L.bumpers) {
      this.world.add(
        new Circle(b.x, b.y, b.r, { mat: { e: 0.42, mu: 0.2 }, tag: b.id, kick: 3.15 })
      );
      const g = new THREE.Group();
      // base skirt
      const skirt = new THREE.Mesh(
        new THREE.CylinderGeometry(b.r * 1.02, b.r * 1.12, 0.006, 22),
        this.M.blackMetal
      );
      skirt.position.copy(V(b.x, b.y, 0.004));
      skirt.castShadow = true;
      g.add(skirt);
      // glowing ring collar
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(b.r * 0.98, b.r * 0.98, 0.012, 24),
        mkMat(THREE, {
          color: 0xffffff,
          emissive: new THREE.Color(0x59d8ff),
          emissiveIntensity: 0.7,
          roughness: 0.18,
          transmission: 0.6,
          thickness: 0.005,
          transparent: true,
          opacity: 0.92,
          envMap: this.env,
        })
      );
      collar.position.copy(V(b.x, b.y, 0.013));
      g.add(collar);
      // chrome lamp housing under the cap
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(b.r * 0.5, b.r * 0.8, 0.026, 22),
        this.M.chrome
      );
      body.position.copy(V(b.x, b.y, 0.032));
      body.castShadow = true;
      g.add(body);

      // Moulded pop-bumper cap. The lathe profile is the whole silhouette of
      // the part: a flared skirt, a shoulder where the screen print sits, and
      // a domed crown. A plain hemisphere reads as a gumball.
      const R = b.r;
      const prof = [
        [R * 1.02, 0.0],
        [R * 1.06, 0.0035],
        [R * 1.00, 0.008],
        [R * 0.94, 0.0135],
        [R * 0.86, 0.0175],
        [R * 0.72, 0.0208],
        [R * 0.52, 0.0232],
        [R * 0.28, 0.0246],
        [R * 0.10, 0.0252],
        [0.0, 0.0254],
      ].map(([r, h]) => new THREE.Vector2(r, h));
      const capGeo = new THREE.LatheGeometry(prof, 28);
      const capTex = canvasTexture(makeBumperCapArt(b.c || 0xff3c62, 512), {
        srgb: true,
        aniso: Q.aniso,
        renderer: this.renderer,
      });
      const cap = new THREE.Mesh(
        capGeo,
        mkMat(THREE, {
          map: capTex,
          color: 0xffffff,
          emissive: new THREE.Color(b.c || 0xff3c62),
          emissiveIntensity: 0.28,
          roughness: 0.07,
          metalness: 0.0,
          clearcoat: 1,
          clearcoatRoughness: 0.03,
          envMap: this.env,
          envMapIntensity: 1.1,
        })
      );
      cap.position.copy(V(b.x, b.y, 0.0432));
      cap.castShadow = true;
      g.add(cap);

      // chrome trim ring clamping the cap down onto the housing
      const trimRing = new THREE.Mesh(
        new THREE.TorusGeometry(R * 1.03, 0.0018, 6, 24),
        this.M.chrome
      );
      trimRing.rotation.x = Math.PI / 2;
      trimRing.position.copy(V(b.x, b.y, 0.0436));
      g.add(trimRing);

      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 0.05, 8), this.M.chrome);
      rod.position.copy(V(b.x, b.y, 0.025));
      g.add(rod);
      const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.0034, 0.0034, 0.003, 6), this.M.steel);
      nut.position.copy(V(b.x, b.y, 0.0700));
      g.add(nut);
      const light = new THREE.PointLight(0x66ddff, 0.12, 0.3, 2);
      if (!Q.practicalLights) light.visible = false;
      light.position.copy(V(b.x, b.y, 0.045));
      if (Q.eventLights) g.add(light);
      this.playfieldGroup.add(g);

      const rec = { id: b.id, x: b.x, y: b.y, r: b.r, group: g, collar, cap, light, skirt, level: 0, pulse: 0 };
      this.parts.bumpers.push(rec);
      this.dynamic.push((dt, t) => {
        rec.level = Math.max(0, rec.level - dt * 5.5);
        const idle = 0.5 + 0.5 * Math.sin(t * 2.4 + b.x * 30);
        collar.material.emissiveIntensity = 0.5 + idle * 0.4 + rec.level * 7;
        cap.material.emissiveIntensity = 0.22 + idle * 0.10 + rec.level * 3.2;
        light.intensity = 0.1 + rec.level * 1.4;
        const s = 1 + rec.level * 0.22;
        cap.position.y = 0.0432 - rec.level * 0.006;
        skirt.scale.set(s, 1, s);
      });
    }

    // bumper cage guides
    this.addWall(L.bumperGuideL, { mat: MAT.plastic, material: this.M.steel });
    this.addWall(L.bumperGuideR, { mat: MAT.plastic, material: this.M.steel });
  }

  /* ------------------------------------------------------------ */

  buildTopLanes() {
    const y0 = L.laneGuideY0;
    const y1 = L.laneGuideY1;
    for (let i = 0; i < L.laneGuideX.length; i++) {
      const x = L.laneGuideX[i];
      this.addWall(
        [
          [x, y0],
          [x, y1],
        ],
        { mat: MAT.plastic, material: this.M.steel, h: 0.026 }
      );
      this.post(x, y0, 0.005, 'rubberWhite', 0.026);
    }
    // rollover wires + zones
    this.parts.novaLanes = [];
    for (let i = 0; i < 4; i++) {
      const cx = (L.laneGuideX[i] + L.laneGuideX[i + 1]) / 2;
      const z = new Zone(cx, 0.9, 0.02, `nova${i}`);
      this.world.add(z);
      const wire = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0011, 6, 16, Math.PI), this.M.wire);
      wire.rotation.set(0, 0, 0);
      wire.position.copy(V(cx, 0.9, 0.0015));
      wire.rotation.x = 0;
      this.playfieldGroup.add(wire);
      this.parts.novaLanes.push({ zone: z, wire, idx: i });
    }
  }

  /* ------------------------------------------------------------ */

  buildDropTargets() {
    const b = L.dropBank;
    const dx = (b.to[0] - b.from[0]) / b.count;
    const dy = (b.to[1] - b.from[1]) / b.count;
    const ang = Math.atan2(dy, dx);
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    this.parts.drops = [];
    const cols = [0xff3c62, 0xffb02a, 0x74dfa8, 0x4cc4ff];
    const LABELS = ['N', 'O', 'V', 'A'];
    for (let i = 0; i < b.count; i++) {
      const x0 = b.from[0] + dx * (i + 0.08);
      const y0 = b.from[1] + dy * (i + 0.08);
      const x1 = b.from[0] + dx * (i + 0.92);
      const y1 = b.from[1] + dy * (i + 0.92);
      const seg = new Segment(x0, y0, x1, y1, { mat: MAT.target, tag: `drop${i}` });
      this.world.add(seg);
      const w = Math.hypot(x1 - x0, y1 - y0);
      const face = canvasTexture(makeTargetFace(cols[i], LABELS[i], 256), {
        srgb: true,
        aniso: Q.aniso,
        renderer: this.renderer,
      });
      const body = mkMat(THREE, {
        color: cols[i],
        emissive: new THREE.Color(cols[i]),
        emissiveIntensity: 0.32,
        roughness: 0.16,
        clearcoat: 1,
        clearcoatRoughness: 0.09,
        envMap: this.env,
        envMapIntensity: 0.9,
      });
      const printed = mkMat(THREE, {
        map: face,
        emissiveMap: face,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.22,
        roughness: 0.14,
        clearcoat: 1,
        clearcoatRoughness: 0.07,
        envMap: this.env,
        envMapIntensity: 1.0,
      });
      // BoxGeometry material order: +x -x +y -y +z -z; the printed face is -z
      // (down-table, i.e. the side the ball strikes).
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.024, 0.005),
        [body, body, body, body, body, printed]
      );
      mesh.position.copy(V((x0 + x1) / 2 + nx * 0.001, (y0 + y1) / 2 + ny * 0.001, 0.012));
      mesh.rotation.y = ang;
      mesh.castShadow = true;
      this.playfieldGroup.add(mesh);
      // slot in the wood
      const slot = new THREE.Mesh(new THREE.BoxGeometry(w * 1.1, 0.001, 0.008), this.M.blackMetal);
      slot.position.copy(V((x0 + x1) / 2, (y0 + y1) / 2, 0.0006));
      slot.rotation.y = ang;
      this.playfieldGroup.add(slot);
      // chrome mounting plate + acorn nuts so the bank reads as a mechanism
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.86, 0.0018, 0.0125),
        this.M.chrome
      );
      plate.position.copy(V(
        (x0 + x1) / 2 - nx * 0.0125,
        (y0 + y1) / 2 - ny * 0.0125,
        0.0026
      ));
      plate.rotation.y = ang;
      plate.castShadow = true;
      this.playfieldGroup.add(plate);
      for (const sgn of [-1, 1]) {
        const nut = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0021, 0.0024, 0.0026, 6),
          this.M.steelDark
        );
        nut.position.copy(V(
          (x0 + x1) / 2 + Math.cos(ang) * w * 0.36 * sgn - nx * 0.0125,
          (y0 + y1) / 2 + Math.sin(ang) * w * 0.36 * sgn - ny * 0.0125,
          0.0044
        ));
        this.playfieldGroup.add(nut);
      }
      this.parts.drops.push({ seg, mesh, down: false, anim: 0, idx: i });
    }
    this.dynamic.push((dt) => {
      for (const d of this.parts.drops) {
        const target = d.down ? 1 : 0;
        d.anim += (target - d.anim) * Math.min(1, dt * 16);
        d.mesh.position.y = 0.012 - d.anim * 0.026;
        d.mesh.material[5].emissiveIntensity = 0.22 * (1 - d.anim) + 0.03;
        d.mesh.material[0].emissiveIntensity = 0.32 * (1 - d.anim) + 0.03;
        d.seg.enabled = d.anim < 0.4;
      }
    });
  }

  buildStandups() {
    this.parts.standups = [];
    for (const s of L.standups) {
      const w = 0.026;
      const x0 = s.x - Math.cos(s.a) * w * 0.5;
      const y0 = s.y - Math.sin(s.a) * w * 0.5;
      const x1 = s.x + Math.cos(s.a) * w * 0.5;
      const y1 = s.y + Math.sin(s.a) * w * 0.5;
      const seg = new Segment(x0, y0, x1, y1, { mat: MAT.target, tag: s.id });
      this.world.add(seg);
      const sf = canvasTexture(makeTargetFace(0xffd23c, 'BONUS', 256), {
        srgb: true,
        aniso: Q.aniso,
        renderer: this.renderer,
      });
      const sBody = mkMat(THREE, {
        color: 0xffd23c,
        emissive: new THREE.Color(0xffd23c),
        emissiveIntensity: 0.28,
        roughness: 0.14,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        envMap: this.env,
      });
      const sFace = mkMat(THREE, {
        map: sf,
        emissiveMap: sf,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.2,
        roughness: 0.13,
        clearcoat: 1,
        clearcoatRoughness: 0.07,
        envMap: this.env,
      });
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.02, 0.006),
        [sBody, sBody, sBody, sBody, sBody, sFace]
      );
      mesh.position.copy(V(s.x, s.y, 0.011));
      mesh.rotation.y = s.a;
      mesh.castShadow = true;
      this.playfieldGroup.add(mesh);
      // L-bracket + two screws at the base
      const brk = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.18, 0.0016, 0.011),
        this.M.steelDark
      );
      brk.position.copy(V(
        s.x - Math.sin(s.a) * 0.0055,
        s.y + Math.cos(s.a) * 0.0055,
        0.0022
      ));
      brk.rotation.y = s.a;
      brk.castShadow = true;
      this.playfieldGroup.add(brk);
      this.parts.standups.push({ seg, mesh, lit: false, hit: 0, id: s.id });
    }
    this.dynamic.push((dt) => {
      for (const s of this.parts.standups) {
        s.hit = Math.max(0, s.hit - dt * 5);
        const e = (s.lit ? 0.85 : 0.22) + s.hit * 2.4;
        s.mesh.material[0].emissiveIntensity = e;
        s.mesh.material[5].emissiveIntensity = e * 0.8;
        s.mesh.position.y = 0.011 - s.hit * 0.003;
      }
    });
  }

  /* ------------------------------------------------------------ */

  buildSaucer() {
    const s = L.saucer;
    this.world.add(new Zone(s.x, s.y, s.r * 0.75, 'saucer'));
    const g = new THREE.Group();
    const hole = new THREE.Mesh(
      new THREE.CylinderGeometry(s.r, s.r * 0.82, 0.03, 26, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 0.7, metalness: 0.3, side: THREE.BackSide })
    );
    hole.position.copy(V(s.x, s.y, -0.015));
    g.add(hole);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(s.r * 0.85, 24),
      new THREE.MeshStandardMaterial({
        color: 0x1a0a30,
        emissive: new THREE.Color(0x9a3cff),
        emissiveIntensity: 1.2,
        roughness: 0.4,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.copy(V(s.x, s.y, -0.028));
    g.add(floor);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(s.r * 1.02, 0.0022, 8, 30), this.M.chrome);
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(V(s.x, s.y, 0.001));
    g.add(ring);
    const light = new THREE.PointLight(0xa64cff, 0.35, 0.2, 2);
    if (!Q.practicalLights) light.visible = false;
    light.position.copy(V(s.x, s.y, 0.02));
    if (Q.eventLights) g.add(light);
    this.playfieldGroup.add(g);
    this.parts.saucer = { group: g, floor, light, level: 0 };
    this.dynamic.push((dt, t) => {
      const p = this.parts.saucer;
      p.level = Math.max(0, p.level - dt * 2);
      floor.material.emissiveIntensity = 0.9 + Math.sin(t * 4) * 0.35 + p.level * 6;
      light.intensity = 0.3 + p.level * 2.4 + Math.sin(t * 4) * 0.12;
    });
  }

  buildSpinner() {
    const s = L.spinner;
    this.world.add(new Zone(s.x, s.y, 0.018, 'spinner'));
    const g = new THREE.Group();
    const frameH = 0.03;
    for (const d of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, frameH, 8), this.M.steel);
      p.position.copy(V(s.x + d * s.w * 0.5, s.y, frameH / 2));
      g.add(p);
    }
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(s.w * 0.9, 0.024, 0.0012),
      mkMat(THREE, {
        color: 0xdfe8f5,
        metalness: 1,
        roughness: 0.12,
        envMap: this.env,
        envMapIntensity: 1.6,
        side: THREE.DoubleSide,
      })
    );
    const pivot = new THREE.Group();
    pivot.position.copy(V(s.x, s.y, 0.018));
    pivot.add(blade);
    g.add(pivot);
    this.playfieldGroup.add(g);
    this.parts.spinner = { pivot, omega: 0 };
    this.dynamic.push((dt) => {
      const sp = this.parts.spinner;
      sp.omega *= Math.max(0, 1 - dt * 1.4);
      pivot.rotation.x += sp.omega * dt;
    });
  }

  buildCaptive() {
    const c = L.captive;
    // channel walls
    this.addWall(
      [
        [c.x - 0.019, c.y - 0.035],
        [c.x - 0.019, c.y + 0.05],
      ],
      { mat: MAT.metal, material: this.M.steel, h: 0.028 }
    );
    this.addWall(
      [
        [c.x + 0.019, c.y - 0.035],
        [c.x + 0.019, c.y + 0.05],
      ],
      { mat: MAT.metal, material: this.M.steel, h: 0.028 }
    );
    this.addWall(
      [
        [c.x - 0.019, c.y + 0.05],
        [c.x + 0.019, c.y + 0.05],
      ],
      { mat: MAT.metal, material: this.M.steel, h: 0.028 }
    );
    const col = new Circle(c.x, c.y, c.r, { mat: { e: 0.62, mu: 0.1 }, tag: 'captive' });
    this.world.add(col);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(c.r, 24, 18), this.M.chrome);
    mesh.position.copy(V(c.x, c.y, c.r));
    mesh.castShadow = true;
    this.playfieldGroup.add(mesh);
    this.parts.captive = { col, mesh, offset: 0, vel: 0, home: c.y };
    this.dynamic.push((dt) => {
      const p = this.parts.captive;
      p.vel += (-p.offset * 90 - p.vel * 6) * dt;
      p.offset += p.vel * dt;
      p.offset = Math.min(c.travel, Math.max(0, p.offset));
      p.col.cy = p.home + p.offset;
      p.col.by0 = p.col.cy - p.col.r;
      p.col.by1 = p.col.cy + p.col.r;
      p.mesh.position.copy(V(c.x, p.col.cy, c.r));
    });
  }

  /* ------------------------------------------------------------ */

  buildRamps() {
    this.parts.rails = {};
    const mk = (id, rawPts, color, entryTag, label) => {
      // The authored control points are only 7-8 samples, which reads as a
      // chunky faceted polyline in 3D and gives the ball a stepped ride.
      // Resample through a Catmull-Rom so both the mesh and the rail physics
      // run on a genuinely smooth curve.
      const pts = smoothPolyline3(rawPts, 40);
      const rail = new Rail(id, pts, { minSpeed: 2.0, friction: 0.7, entryTag });
      this.world.addRail(rail);
      // entrance trigger
      this.world.add(new Zone(pts[0][0], pts[0][1], 0.024, entryTag));

      const g = new THREE.Group();

      // ---- solid ramp bed: a swept metal ribbon the ball runs on --------
      const off = 0.0235;
      const norm = pts.map((p, i) => {
        const nxt = pts[Math.min(i + 1, pts.length - 1)];
        const prv = pts[Math.max(i - 1, 0)];
        let tx = nxt[0] - prv[0];
        let ty = nxt[1] - prv[1];
        const l = Math.hypot(tx, ty) || 1;
        return [-ty / l, tx / l];
      });
      const N = pts.length;
      const pos = [];
      const uv = [];
      const idx = [];
      for (let i = 0; i < N; i++) {
        const p = pts[i];
        const n = norm[i];
        for (let k = 0; k < 2; k++) {
          const d = k === 0 ? -1 : 1;
          const w = V(p[0] + n[0] * off * d, p[1] + n[1] * off * d, p[2] - 0.0035);
          pos.push(w.x, w.y, w.z);
          uv.push(k, i / (N - 1));
        }
        if (i < N - 1) {
          const a = i * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const bedGeo = new THREE.BufferGeometry();
      bedGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      bedGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      bedGeo.setIndex(idx);
      bedGeo.computeVertexNormals();
      // Tinted polycarbonate runway. A bare metal bed at this width reads as
      // one huge white ribbon under the key light and swallows the table;
      // real modern ramps are moulded clear/tinted plastic you see through.
      const bedTex = canvasTexture(makeRampArt(color, label || 'RAMP', 256), {
        srgb: true,
        aniso: Q.aniso,
        renderer: this.renderer,
      });
      bedTex.wrapT = THREE.RepeatWrapping;
      bedTex.repeat.set(1, 4);
      const bedMat = mkMat(THREE, {
        color: 0xffffff,
        map: bedTex,
        metalness: 0.0,
        roughness: 0.22,
        transparent: true,
        opacity: 0.88,
        side: THREE.DoubleSide,
        depthWrite: true,
        emissive: 0xffffff,
        emissiveMap: bedTex,
        emissiveIntensity: 0.34,
        envMap: this.env,
        envMapIntensity: 0.45,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
      });
      const bed = new THREE.Mesh(bedGeo, bedMat);
      bed.castShadow = true;
      bed.receiveShadow = true;
      g.add(bed);

      // ---- side walls + top rails ---------------------------------------
      // Solid translucent walls make the run read as a *ramp*, not floating
      // wire; the chrome tube caps it the way a real Stern/Williams ramp does.
      const WALL_H = 0.023;
      const wallMat = mkMat(THREE, {
        // Moulded polycarbonate ramp wall: tinted, translucent, and *not*
        // near-mirror — a low roughness here sweeps a white specular band
        // along the whole curve and the ramp reads as painted foam board.
        color: new THREE.Color(color).lerp(new THREE.Color(0x0a1020), 0.06).getHex(),
        metalness: 0.0,
        roughness: 0.27,
        transparent: true,
        opacity: 0.46,
        side: THREE.DoubleSide,
        depthWrite: true,
        emissive: new THREE.Color(color).multiplyScalar(0.30).getHex(),
        emissiveIntensity: 1,
        envMap: this.env,
        envMapIntensity: 0.5,
      });
      for (const d of [-1, 1]) {
        const side = pts.map((p, i) => [
          p[0] + norm[i][0] * off * d,
          p[1] + norm[i][1] * off * d,
          p[2] + WALL_H,
        ]);
        // extruded wall ribbon
        const wp = [];
        const wi = [];
        for (let i = 0; i < N; i++) {
          const lo = V(side[i][0], side[i][1], pts[i][2] - 0.004);
          const hi = V(side[i][0], side[i][1], pts[i][2] + WALL_H);
          wp.push(lo.x, lo.y, lo.z, hi.x, hi.y, hi.z);
          if (i < N - 1) {
            const a = i * 2;
            wi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          }
        }
        const wg = new THREE.BufferGeometry();
        wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
        wg.setIndex(wi);
        wg.computeVertexNormals();
        const wall = new THREE.Mesh(wg, wallMat);
        wall.renderOrder = 6;
        g.add(wall);

        const tube = new THREE.Mesh(tubeAlong(side, 0.0033, 8), this.M.wire);
        tube.castShadow = true;
        g.add(tube);
        // cross-ties + hex-based support posts down to the playfield
        const upG = [];
        for (let i = 3; i < N - 1; i += 8) {
          const h = Math.max(0.012, pts[i][2] + WALL_H + 0.004);
          const geo = new THREE.CylinderGeometry(0.0016, 0.0016, h, 6);
          const w = V(side[i][0], side[i][1], (pts[i][2] + WALL_H) - h / 2);
          geo.translate(w.x, w.y, w.z);
          upG.push(geo);
          const base = new THREE.CylinderGeometry(0.0052, 0.0058, 0.0026, 6);
          const bw = V(side[i][0], side[i][1], 0.0013);
          base.translate(bw.x, bw.y, bw.z);
          upG.push(base);
        }
        if (upG.length) {
          const m = new THREE.Mesh(mergeGeometries(upG), this.M.steelDark);
          m.castShadow = true;
          g.add(m);
        }
      }
      // cross-ties spanning the two side rails every ~5 samples
      {
        const tie = [];
        for (let i = 4; i < N - 1; i += 7) {
          const a = V(pts[i][0] + norm[i][0] * off, pts[i][1] + norm[i][1] * off, pts[i][2] + WALL_H);
          const b = V(pts[i][0] - norm[i][0] * off, pts[i][1] - norm[i][1] * off, pts[i][2] + WALL_H);
          const len = a.distanceTo(b);
          const geo = new THREE.CylinderGeometry(0.0014, 0.0014, len, 6);
          const mid = a.clone().add(b).multiplyScalar(0.5);
          const q = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            b.clone().sub(a).normalize()
          );
          geo.applyQuaternion(q);
          geo.translate(mid.x, mid.y, mid.z);
          tie.push(geo);
        }
        if (tie.length) g.add(new THREE.Mesh(mergeGeometries(tie), this.M.wire));
      }

      // glowing LED strip that runs along the outside of the bed
      const ledPts = pts.map((p, i) => [p[0] + norm[i][0] * (off - 0.004), p[1] + norm[i][1] * (off - 0.004), p[2] - 0.0068]);
      const led = new THREE.Mesh(
        tubeAlong(ledPts, 0.0022, 5),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.62) })
      );
      g.add(led);

      // entrance flap
      const ex = pts[0];
      const e2 = pts[1];
      const ang = Math.atan2(e2[1] - ex[1], e2[0] - ex[0]);
      const flap = new THREE.Mesh(
        new THREE.BoxGeometry(0.042, 0.0025, 0.05),
        mkMat(THREE, { color: 0xd8e2f0, metalness: 1, roughness: 0.2, envMap: this.env, envMapIntensity: 1.5 })
      );
      flap.position.copy(V(ex[0] + Math.cos(ang) * 0.018, ex[1] + Math.sin(ang) * 0.018, 0.008));
      flap.rotation.y = ang - Math.PI / 2;
      flap.rotation.x = -0.22;
      flap.castShadow = true;
      g.add(flap);

      // exit: chrome wireform lip + a modelled mounting bracket so the run
      // terminates in hardware instead of stopping in mid air.
      {
        const q0 = pts[N - 2];
        const q1 = pts[N - 1];
        const a2 = Math.atan2(q1[1] - q0[1], q1[0] - q0[0]);
        const nx = -Math.sin(a2);
        const ny = Math.cos(a2);
        for (const d of [-1, 1]) {
          const lip = [];
          for (let s = 0; s <= 6; s++) {
            const u = s / 6;
            lip.push([
              q1[0] + Math.cos(a2) * u * 0.032 + nx * off * d * (1 - u * 0.35),
              q1[1] + Math.sin(a2) * u * 0.032 + ny * off * d * (1 - u * 0.35),
              Math.max(0.008, q1[2] + 0.018 - u * u * 0.02),
            ]);
          }
          g.add(new THREE.Mesh(tubeAlong(lip, 0.0022, 6), this.M.wire));
        }
        const br = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.0024, 0.019), this.M.steelDark);
        br.position.copy(V(q1[0], q1[1], Math.max(0.007, q1[2] + 0.009)));
        br.rotation.y = a2 - Math.PI / 2;
        br.castShadow = true;
        g.add(br);
      }

      this.playfieldGroup.add(g);
      this.parts.rails[id] = { rail, group: g, led, color: new THREE.Color(color), level: 0 };
      this.dynamic.push((dt, t) => {
        const r = this.parts.rails[id];
        r.level = Math.max(0, r.level - dt * 1.6);
        const pulse = 0.55 + 0.45 * Math.sin(t * 3 + (id === 'left' ? 0 : 2));
        led.material.color.copy(r.color).multiplyScalar(Math.min(0.85, 0.1 + pulse * 0.1 + r.level * 0.6));
      });
      return rail;
    };
    this.railLeft = mk('left', L.rampLeft, 0xff5a2a, 'rampLeftEntry', 'FUEL');
    this.railRight = mk('right', L.rampRight, 0x2fd8ff, 'rampRightEntry', 'ORBIT');
  }

  /* ------------------------------------------------------------ */

  buildFlippers() {
    const mk = (cfg, tag) => {
      const f = new Flipper({ ...cfg, tag, restAngle: cfg.rest, upAngle: cfg.up, length: cfg.len, r0: 0.0125, r1: 0.0072 });
      this.world.addFlipper(f);

      const g = new THREE.Group();
      // tapered bat
      const shape = new THREE.Shape();
      const r0 = 0.0125;
      const r1 = 0.0072;
      const len = cfg.len;
      shape.absarc(0, 0, r0, Math.PI / 2, -Math.PI / 2, true);
      shape.absarc(len, 0, r1, -Math.PI / 2, Math.PI / 2, true);
      shape.closePath();
      const bat = new THREE.ExtrudeGeometry(shape, { depth: 0.019, bevelEnabled: true, bevelSize: 0.0012, bevelThickness: 0.001, bevelSegments: 2, curveSegments: 14 });
      bat.rotateX(-Math.PI / 2);
      const batMesh = new THREE.Mesh(bat, this.M.flipperBat);
      batMesh.position.y = 0.004;
      batMesh.castShadow = true;
      batMesh.receiveShadow = true;
      g.add(batMesh);

      // red rubber band
      const bandShape = new THREE.Shape();
      bandShape.absarc(0, 0, r0 + 0.0040, Math.PI / 2, -Math.PI / 2, true);
      bandShape.absarc(len, 0, r1 + 0.0040, -Math.PI / 2, Math.PI / 2, true);
      bandShape.closePath();
      const hole = new THREE.Path();
      hole.absarc(0, 0, r0, Math.PI / 2, -Math.PI / 2, true);
      hole.absarc(len, 0, r1, -Math.PI / 2, Math.PI / 2, true);
      hole.closePath();
      bandShape.holes.push(hole);
      const bandGeo = new THREE.ExtrudeGeometry(bandShape, { depth: 0.0165, bevelEnabled: true, bevelSize: 0.0009, bevelThickness: 0.0008, bevelSegments: 2, curveSegments: 16 });
      bandGeo.rotateX(-Math.PI / 2);
      const band = new THREE.Mesh(bandGeo, this.M.rubberRed);
      band.position.y = 0.0055;
      band.castShadow = true;
      g.add(band);

      // dark shoe under the bat: separates the pearl-white moulding from the
      // playfield print so the flipper reads as a manufactured part, not a
      // floating slab, and grounds its contact shadow.
      const shoeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.0032, bevelEnabled: false, curveSegments: 14 });
      shoeGeo.rotateX(-Math.PI / 2);
      const shoe = new THREE.Mesh(shoeGeo, this.M.blackMetal);
      shoe.position.y = 0.0016;
      g.add(shoe);

      // pivot assembly: brass bushing, chrome shaft, capped with an acorn nut
      const bush = new THREE.Mesh(
        new THREE.CylinderGeometry(r0 * 0.78, r0 * 0.86, 0.0045, 18),
        mkMat(THREE, { color: 0xc9a24a, metalness: 1, roughness: 0.3, envMap: this.env, envMapIntensity: 1.1 })
      );
      bush.position.y = 0.0022;
      g.add(bush);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(r0 * 0.42, r0 * 0.46, 0.027, 18), this.M.chrome);
      hub.position.y = 0.0135;
      hub.castShadow = true;
      g.add(hub);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r0 * 0.46, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.M.chrome);
      cap.position.y = 0.027;
      g.add(cap);

      g.position.copy(V(cfg.x, cfg.y, 0));
      this.playfieldGroup.add(g);
      return { f, g };
    };
    this.parts.flipL = mk(L.flipL, 'flipperL');
    this.parts.flipR = mk(L.flipR, 'flipperR');
    this.parts.flipU = mk(L.flipU, 'flipperU');
    this.flipperL = this.parts.flipL.f;
    this.flipperR = this.parts.flipR.f;
    this.flipperU = this.parts.flipU.f;
  }

  /* ------------------------------------------------------------ */

  buildPlunger() {
    const p = L.plunger;
    const g = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.1, 12), this.M.chrome);
    rod.rotation.x = Math.PI / 2;
    rod.position.copy(V(p.x, p.y - 0.05, 0.012));
    g.add(rod);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.012, 18), this.M.blackMetal);
    tip.rotation.x = Math.PI / 2;
    tip.position.copy(V(p.x, p.y, 0.012));
    g.add(tip);
    // spring
    const springPts = [];
    for (let i = 0; i <= 70; i++) {
      const t = i / 70;
      const yy = p.y - 0.012 - t * 0.07;
      springPts.push(new THREE.Vector3(p.x + Math.cos(t * 34) * 0.0075, 0.012 + Math.sin(t * 34) * 0.0075, -yy));
    }
    const spring = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(springPts), 90, 0.0011, 5),
      this.M.steel
    );
    g.add(spring);
    this.playfieldGroup.add(g);

    // the plunger face as a physics segment that moves
    const seg = new Segment(L.laneIn + 0.001, p.y, L.laneOut - 0.001, p.y, { mat: { e: 0.15, mu: 0.3 }, tag: 'plunger' });
    this.world.add(seg);
    this.parts.plunger = { group: g, seg, rod, tip, spring, pull: 0, home: p.y };
  }

  setPlunger(pull) {
    const p = this.parts.plunger;
    p.pull = pull;
    const dy = -pull * 0.055;
    p.seg.move(L.laneIn + 0.001, p.home + dy, L.laneOut - 0.001, p.home + dy);
    p.tip.position.copy(V(L.plunger.x, p.home + dy, 0.012));
    p.rod.position.copy(V(L.plunger.x, p.home + dy - 0.05, 0.012));
    p.spring.scale.set(1, 1, 1 - pull * 0.5);
  }

  /* ------------------------------------------------------------ */

  buildPlastics() {
    // translucent plastic canopies over the bumper cluster, on posts
    const specs = [
      { pts: [[-0.152, 0.63], [-0.075, 0.615], [0.014, 0.632], [0.086, 0.662], [0.086, 0.706], [-0.152, 0.706]], mat: 'plasticBlue', z: 0.055, c: 0x2f9dff, label: 'ORBIT' },
      { pts: [[-0.158, 0.758], [-0.06, 0.738], [0.056, 0.748], [0.108, 0.778], [0.086, 0.822], [-0.14, 0.818]], mat: 'plasticPurple', z: 0.058, c: 0x9a5cff, label: 'NOVA' },
      { pts: [[0.132, 0.42], [0.208, 0.4], [0.236, 0.46], [0.2, 0.5], [0.14, 0.48]], mat: 'plasticCyan', z: 0.05, c: 0x2fe0ff, label: 'FUEL' },
      { pts: [[-0.236, 0.4], [-0.15, 0.38], [-0.12, 0.43], [-0.19, 0.47], [-0.236, 0.45]], mat: 'plasticAmber', z: 0.05, c: 0xffb02a, label: 'BURN' },
    ];
    for (const s of specs) {
      const shape = new THREE.Shape();
      shape.moveTo(s.pts[0][0], -s.pts[0][1]);
      for (let i = 1; i < s.pts.length; i++) shape.lineTo(s.pts[i][0], -s.pts[i][1]);
      shape.closePath();
      // shape is authored with y negated, so this rotation (not -PI/2) is what
      // puts the canopy over the playfield instead of mirroring it out in front
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.0026,
        bevelEnabled: true,
        bevelSize: 0.00045,
        bevelThickness: 0.00045,
        bevelSegments: 1,
      });
      geo.rotateX(Math.PI / 2);
      geo.computeVertexNormals();
      // planar UVs from the canopy bounds so the screen print lands on it
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const pos = geo.attributes.position;
      const uvA = new Float32Array(pos.count * 2);
      const sx = 1 / Math.max(1e-6, bb.max.x - bb.min.x);
      const sz = 1 / Math.max(1e-6, bb.max.z - bb.min.z);
      for (let i = 0; i < pos.count; i++) {
        uvA[i * 2] = (pos.getX(i) - bb.min.x) * sx;
        uvA[i * 2 + 1] = (pos.getZ(i) - bb.min.z) * sz;
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uvA, 2));
      const printed = this.M[s.mat].clone();
      printed.map = canvasTexture(makePlasticArt(s.c, s.label, 512), {
        srgb: true,
        aniso: Q.aniso,
        renderer: this.renderer,
      });
      printed.color = new THREE.Color(0xffffff);
      printed.transparent = true;
      printed.opacity = Math.min(printed.opacity ?? 1, 0.72);
      printed.emissive = new THREE.Color(s.c);
      printed.emissiveIntensity = 0.10;
      const m = new THREE.Mesh(geo, printed);
      m.position.y = s.z;
      m.castShadow = true;
      m.receiveShadow = true;
      this.playfieldGroup.add(m);

      // Polished edge light-pipe. A cut acrylic plastic sitting over GI bulbs
      // fires light out of its sawn edge — that bright rim is the single most
      // recognisable thing about a lit pinball plastic and it costs one tube.
      const loop = s.pts.map((q) => [q[0], q[1], 0]);
      loop.push([s.pts[0][0], s.pts[0][1], 0]);
      const rim = new THREE.Mesh(
        tubeAlong(loop, 0.0011, 5),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(s.c).lerp(new THREE.Color(0xffffff), 0.45),
          transparent: true,
          opacity: 0.9,
        })
      );
      rim.position.y = s.z + 0.0013;
      rim.renderOrder = 4;
      this.playfieldGroup.add(rim);

      // support posts: chrome tube, fibre washer at the foot, acorn nut on top
      for (let i = 0; i < s.pts.length; i += 2) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.0026, 0.0030, s.z, 8), this.M.steel);
        post.position.copy(V(s.pts[i][0], s.pts[i][1], s.z / 2));
        post.castShadow = true;
        this.playfieldGroup.add(post);
        const foot = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0052, 0.0058, 0.0022, 8),
          this.M.blackMetal
        );
        foot.position.copy(V(s.pts[i][0], s.pts[i][1], 0.0011));
        this.playfieldGroup.add(foot);
        const cap = new THREE.Mesh(
          new THREE.SphereGeometry(0.0032, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.62),
          this.M.chrome
        );
        cap.position.copy(V(s.pts[i][0], s.pts[i][1], s.z + 0.0032));
        this.playfieldGroup.add(cap);
      }
      // under-plastic GI strip
      if (Q.giLights) {
        const gi = new THREE.PointLight(0x88bbff, 0.16, 0.16, 2);
        gi.position.copy(V(s.pts[0][0] + 0.03, s.pts[0][1] + 0.02, s.z - 0.012));
        this.playfieldGroup.add(gi);
      }
    }
  }

  /* ------------------------------------------------------------ */

  /**
   * Baked general-illumination wash. On software GL the real GI point lights
   * are culled, so the playfield would otherwise be lit only by the key light
   * and read flat. This additive card puts the under-plastic bulb glow back.
   */
  buildGIWash() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#000';
    x.fillRect(0, 0, 256, 512);
    const blobs = [
      [0.30, 0.86, 0.26, 'rgba(150,180,255,0.30)'],
      [0.74, 0.72, 0.24, 'rgba(140,186,255,0.30)'],
      [0.24, 0.55, 0.22, 'rgba(255,120,175,0.22)'],
      [0.78, 0.40, 0.24, 'rgba(130,230,255,0.28)'],
      [0.48, 0.24, 0.26, 'rgba(170,140,255,0.26)'],
      [0.50, 0.08, 0.20, 'rgba(255,190,120,0.20)'],
    ];
    for (const [bx, by, br, col] of blobs) {
      const g = x.createRadialGradient(bx * 256, by * 512, 0, bx * 256, by * 512, br * 380);
      g.addColorStop(0, col);
      g.addColorStop(0.55, col.replace(/[\d.]+\)$/, '0.14)'));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, 256, 512);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const w = L.boardX1 - L.boardX0;
    const h = L.boardY1 - L.boardY0;
    const geo = new THREE.PlaneGeometry(w, h);
    geo.rotateX(-Math.PI / 2);
    geo.translate((L.boardX0 + L.boardX1) / 2, 0.0022, -(L.boardY0 + L.boardY1) / 2);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.46,
      })
    );
    mesh.renderOrder = 3;
    this.playfieldGroup.add(mesh);
    this.parts.giWash = mesh;
  }

  buildLamps() {
    this.buildGIWash();
    const defs = [
      { id: 'jackpot', x: -0.017, y: 0.44, w: 0.088, h: 0.024, c: 0xff2e6a, t: 'JACKPOT' },
      { id: 'multiball', x: -0.017, y: 0.404, w: 0.088, h: 0.02, c: 0x6fd9a0, t: 'MULTIBALL' },
      { id: 'bonusx', x: -0.098, y: 0.212, w: 0.05, h: 0.018, c: 0x5ad7ff, rot: -0.28, t: 'BONUS X' },
      { id: 'extraball', x: 0.064, y: 0.212, w: 0.05, h: 0.018, c: 0xffb03c, rot: 0.28, t: 'EXTRA\nBALL' },
      { id: 'reentry', x: -0.132, y: 0.318, w: 0.036, h: 0.05, c: 0xff5a2a, t: 'RE\nENTRY' },
      { id: 'fuel', x: 0.126, y: 0.338, w: 0.036, h: 0.05, c: 0x39d7ff, t: 'FUEL\nLOAD' },
      { id: 'outlaneL', x: -0.238, y: 0.18, w: 0.05, h: 0.017, c: 0xff3c6e, rot: -0.28, t: 'SPECIAL' },
      { id: 'inlaneL', x: -0.152, y: 0.19, w: 0.05, h: 0.017, c: 0x2f8f60, rot: -0.28, t: 'COMBO' },
      { id: 'outlaneR', x: 0.204, y: 0.18, w: 0.05, h: 0.017, c: 0xff3c6e, rot: 0.28, t: 'SPECIAL' },
      { id: 'inlaneR', x: 0.118, y: 0.19, w: 0.05, h: 0.017, c: 0x2f8f60, rot: 0.28, t: 'COMBO' },
    ];
    for (let i = 0; i < 4; i++) {
      const cx = (L.laneGuideX[i] + L.laneGuideX[i + 1]) / 2;
      defs.push({ id: `nova${i}`, x: cx, y: 0.9, w: 0.03, h: 0.03, c: 0xffd23c, t: 'NOVA'[i] });
    }

    // Lower-playfield insert field. A real machine never has a dark half; the
    // bonus ladder, lane arrows and award inserts fill the space between the
    // slingshots and the bumper cluster and are most of what the player
    // actually looks at. Purely cosmetic lamps, driven by the attract chase.
    const BONUS = [2, 3, 4, 5, 6, 8, 10];
    BONUS.forEach((n, i) => {
      defs.push({
        id: `bladder${i}`,
        x: -0.262 + (i % 2) * 0.016,
        y: 0.245 + i * 0.036,
        w: 0.026,
        h: 0.014,
        c: i >= 5 ? 0xff8a2a : 0x5ad7ff,
        rot: -0.32,
        t: String(n) + 'X',
      });
    });
    BONUS.forEach((n, i) => {
      defs.push({
        id: `bladderR${i}`,
        x: 0.228 - (i % 2) * 0.016,
        y: 0.245 + i * 0.036,
        w: 0.026,
        h: 0.014,
        c: i >= 5 ? 0xff8a2a : 0x5ad7ff,
        rot: 0.32,
        t: String(n) + 'X',
      });
    });
    // award row across the centre, above the drop-target bank
    [
      ['awdCombo', -0.108, 0.30, 0x9a6cff, 'COMBO'],
      ['awdSuper', -0.017, 0.30, 0xffd23c, 'SUPER JET'],
      ['awdLoop', 0.074, 0.30, 0x39d7ff, 'LOOP'],
    ].forEach(([id, x, y, c, t]) =>
      defs.push({ id, x, y, w: 0.062, h: 0.016, c, t })
    );
    // lane arrows feeding the flippers
    [
      ['arrL', -0.196, 0.256, 0x2fe08a, -0.34],
      ['arrR', 0.162, 0.256, 0x2fe08a, 0.34],
      ['arrCL', -0.078, 0.372, 0xff5a2a, -0.18],
      ['arrCR', 0.044, 0.372, 0xff5a2a, 0.18],
    ].forEach(([id, x, y, c, rot]) =>
      defs.push({ id, x, y, w: 0.026, h: 0.03, c, rot, shape: 'arrow' })
    );
    // shoot-again / tilt pair just above the drain
    defs.push({ id: 'shootAgain', x: -0.017, y: 0.118, w: 0.086, h: 0.019, c: 0xffffff, t: 'SHOOT AGAIN' });
    defs.push({ id: 'tiltLamp', x: -0.017, y: 0.086, w: 0.05, h: 0.015, c: 0xff2a2a, t: 'TILT' });
    const lensTex = insertLensTexture();
    // Every insert is a real part: a milled pocket, a coloured acrylic lens
    // sitting in it, a black bezel, and only then the additive glow on top.
    const bezelMat = mkMat(THREE, {
      color: 0x0a0c11,
      metalness: 0.2,
      roughness: 0.62,
      envMap: this.env,
      envMapIntensity: 0.2,
    });
    const arrowShape = () => {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0.62);
      sh.lineTo(0.5, -0.06);
      sh.lineTo(0.2, -0.06);
      sh.lineTo(0.2, -0.62);
      sh.lineTo(-0.2, -0.62);
      sh.lineTo(-0.2, -0.06);
      sh.lineTo(-0.5, -0.06);
      sh.closePath();
      return sh;
    };
    const flatShape = (d, sx, sy) => {
      const g2 =
        d.shape === 'arrow'
          ? new THREE.ShapeGeometry(arrowShape())
          : new THREE.PlaneGeometry(1, 1);
      g2.scale(d.w * sx, d.h * sy, 1);
      g2.rotateX(-Math.PI / 2);
      return g2;
    };

    for (const d of defs) {
      const art = d.t
        ? makeInsertArt(
            d.c,
            d.t,
            d.shape === 'arrow' ? d.w / d.h : Math.max(0.35, d.w / d.h),
            d.shape || 'rect'
          )
        : null;
      const lensPrint = art
        ? canvasTexture(art.lens, { srgb: true, aniso: Q.aniso, renderer: this.renderer })
        : null;
      const glowTex = art
        ? canvasTexture(art.glow, { srgb: true, aniso: Q.aniso, renderer: this.renderer })
        : lensTex;
      const geo = flatShape(d, art ? 1.16 : 1.35, art ? 1.34 : 1.7);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(d.c),
        map: glowTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(V(d.x, d.y, 0.0012));
      m.rotation.y = d.rot || 0;
      m.renderOrder = 2;
      this.playfieldGroup.add(m);

      const bezGeo =
        d.shape === 'arrow'
          ? (() => {
              const gg = new THREE.ExtrudeGeometry(arrowShape(), {
                depth: 0.0016,
                bevelEnabled: false,
              });
              gg.scale(d.w * 1.18, d.h * 1.18, 1);
              gg.rotateX(Math.PI / 2);
              return gg;
            })()
          : new THREE.BoxGeometry(d.w + 0.0055, 0.0016, d.h + 0.0055);
      const bez = new THREE.Mesh(bezGeo, bezelMat);
      bez.position.copy(V(d.x, d.y, -0.0002));
      bez.rotation.y = d.rot || 0;
      bez.receiveShadow = true;
      this.playfieldGroup.add(bez);

      const lensGeo =
        d.shape === 'arrow'
          ? (() => {
              const gg = new THREE.ExtrudeGeometry(arrowShape(), {
                depth: 0.0011,
                bevelEnabled: false,
              });
              gg.scale(d.w, d.h, 1);
              gg.rotateX(Math.PI / 2);
              return gg;
            })()
          : new THREE.BoxGeometry(d.w, 0.0011, d.h);
      // BoxGeometry face order is +x -x +y -y +z -z; only the +y face (the one
      // flush with the wood) carries the print, the rim stays raw acrylic.
      const rimMat = mkMat(THREE, {
        color: new THREE.Color(d.c).clone().multiplyScalar(0.16),
        metalness: 0,
        roughness: 0.12,
        envMap: this.env,
        envMapIntensity: 0.5,
        emissive: new THREE.Color(d.c),
        emissiveIntensity: 0.03,
      });
      const faceMat = lensPrint
        ? mkMat(THREE, {
            map: lensPrint,
            emissiveMap: lensPrint,
            color: 0xffffff,
            emissive: 0xffffff,
            emissiveIntensity: 0.05,
            metalness: 0,
            roughness: 0.09,
            clearcoat: 1,
            clearcoatRoughness: 0.05,
            envMap: this.env,
            envMapIntensity: 0.5,
          })
        : mkMat(THREE, {
            color: new THREE.Color(d.c).clone().multiplyScalar(0.13),
            metalness: 0,
            roughness: 0.10,
            envMap: this.env,
            envMapIntensity: 0.55,
            transparent: true,
            opacity: 0.62,
            emissive: new THREE.Color(d.c),
            emissiveIntensity: 0.03,
          });
      const lens = new THREE.Mesh(
        lensGeo,
        d.shape === 'arrow' || !lensPrint
          ? faceMat
          : [rimMat, rimMat, faceMat, rimMat, rimMat, rimMat]
      );
      lens.position.copy(V(d.x, d.y, 0.0006));
      lens.rotation.y = d.rot || 0;
      this.playfieldGroup.add(lens);
      this.lampLens = this.lampLens || {};
      this.lampLens[d.id] = lens;
      this.lamps[d.id] = { mesh: m, mat, on: false, blink: 0, level: 0, color: new THREE.Color(d.c) };
    }
    this.lampOrder = defs.map((d) => d.id);
    this.dynamic.push((dt, t) => {
      const order = this.lampOrder;
      for (let i = 0; i < order.length; i++) {
        const k = order[i];
        const lp = this.lamps[k];
        let target = 0;
        if (lp.on) target = 1;
        if (lp.blink) target = Math.sin(t * lp.blink * 6.283) > 0 ? 1 : 0.06;
        // Idle shimmer: a real machine never has a dark insert field. Any
        // lamp the ruleset is not driving still breathes on a slow chase so
        // the board sparkles in attract and between shots.
        if (!lp.on) {
          const phase = t * 0.85 - i * 0.42;
          target = Math.max(target, 0.16 + 0.24 * Math.max(0, Math.sin(phase)) ** 3);
        }
        lp.level += (target - lp.level) * Math.min(1, dt * 22);
        lp.mat.opacity = lp.level * 0.52;
        const ln = this.lampLens && this.lampLens[k];
        if (ln) {
          const e = 0.05 + lp.level * 1.25;
          if (Array.isArray(ln.material)) {
            ln.material[2].emissiveIntensity = e;
            ln.material[0].emissiveIntensity = e * 0.55;
          } else ln.material.emissiveIntensity = e;
        }
      }
    });
  }

  setLamp(id, on, blink = 0) {
    const l = this.lamps[id];
    if (!l) return;
    l.on = on;
    l.blink = on ? blink : 0;
  }

  /* ------------------------------------------------------------ */

  buildApron() {
    const g = new THREE.Group();
    const apronTex = canvasTexture(makeApronArt(1024), {
      srgb: true,
      aniso: Q.aniso,
      renderer: this.renderer,
    });
    const apronSide = mkMat(THREE, {
      color: 0x11151d,
      metalness: 0.75,
      roughness: 0.42,
      envMap: this.env,
      envMapIntensity: 0.5,
    });
    const apronTop = mkMat(THREE, {
      map: apronTex,
      // Black anodised aluminium. No clearcoat: a coat on a panel this large
      // and this close to horizontal throws one flat white lobe straight at
      // the 3/4 camera and the apron reads as a sheet of paper.
      metalness: 0.9,
      roughness: 0.44,
      envMap: this.env,
      envMapIntensity: 0.30,
    });
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z -> art on the top face
    const apron = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.006, 0.09), [
      apronSide,
      apronSide,
      apronTop,
      apronSide,
      apronSide,
      apronSide,
    ]);
    apron.position.copy(V(0, -0.005, 0.016));
    apron.rotation.x = -0.16;
    apron.castShadow = true;
    g.add(apron);
    // drain trough lip
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.02, 0.008), this.M.blackMetal);
    lip.position.copy(V(0, 0.028, 0.008));
    g.add(lip);
    this.playfieldGroup.add(g);
  }

  buildCabinet() {
    const g = new THREE.Group();
    const w = 0.63;
    const len = 1.25;
    const bodyH = 0.34;
    const cz = -(L.boardY0 + L.boardY1) / 2;

    // side rails (mitred, lacquered)
    for (const d of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.052, len), this.M.railWood);
      rail.position.set(d * (w / 2 - 0.014), 0.014, cz);
      rail.castShadow = true;
      rail.receiveShadow = true;
      g.add(rail);
      // stainless side rail capping the wood, with a rounded outer bead
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.007, len), this.M.chrome);
      trim.position.set(d * (w / 2 - 0.014), 0.0425, cz);
      trim.castShadow = true;
      g.add(trim);
      const bead = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0035, 0.0035, len, 8),
        this.M.chrome
      );
      bead.rotation.x = Math.PI / 2;
      bead.position.set(d * (w / 2 - 0.0005), 0.042, cz);
      g.add(bead);
    }
    // front/back rails
    const front = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.03), this.M.railWood);
    front.position.set(0, 0.014, -L.boardY0 + 0.015);
    front.castShadow = true;
    g.add(front);
    const lockdown = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.022, 0.038),
      mkMat(THREE, { color: 0x6b7280, metalness: 1.0, roughness: 0.26, envMap: this.env, envMapIntensity: 0.38 })
    );
    lockdown.position.set(0, 0.043, -L.boardY0 + 0.012);
    lockdown.castShadow = true;
    g.add(lockdown);

    // body box
    const sideArt = new THREE.CanvasTexture(makeSideArt(1024));
    sideArt.colorSpace = THREE.SRGBColorSpace;
    const sideMat = mkMat(THREE, {
      map: sideArt,
      roughness: 0.28,
      metalness: 0.0,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
      envMap: this.env,
      envMapIntensity: 0.8,
    });
    const plainMat = mkMat(THREE, { color: 0x0a0b12, roughness: 0.5, metalness: 0.1, envMap: this.env, envMapIntensity: 0.4 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, bodyH, len), [
      sideMat, sideMat, plainMat, plainMat, plainMat, plainMat,
    ]);
    body.position.set(0, -bodyH / 2 - 0.026, cz);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // legs — square chrome tube, mounting plate at the top, leveller foot at
    // the bottom. Bare boxes read as scaffolding; the plate and foot are what
    // make them read as machine legs.
    const legMat = this.M.chrome;
    const plateMat = this.M.steelDark;
    const lz = [-L.boardY0 - 0.06, -L.boardY1 + 0.09];
    for (const d of [-1, 1]) {
      for (const z of lz) {
        const lx = d * (w / 2 - 0.03);
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.68, 0.05), legMat);
        leg.position.set(lx, -bodyH - 0.36, z);
        leg.castShadow = true;
        g.add(leg);

        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.11, 0.062), plateMat);
        plate.position.set(lx, -bodyH + 0.03, z);
        plate.castShadow = true;
        g.add(plate);

        for (const by of [-bodyH - 0.015, -bodyH - 0.075]) {
          const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.066, 8), this.M.chrome);
          bolt.rotation.z = Math.PI / 2;
          bolt.position.set(lx, by, z);
          g.add(bolt);
        }

        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.022, 14), plateMat);
        foot.position.set(lx, -bodyH - 0.712, z);
        foot.castShadow = true;
        g.add(foot);
      }
    }

    // coin door
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.012), this.M.steelDark);
    door.position.set(0, -0.14, -L.boardY0 + 0.03);
    g.add(door);
    for (const d of [-1, 1]) {
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.05, 0.01), this.M.chrome);
      slot.position.set(d * 0.09, -0.12, -L.boardY0 + 0.037);
      g.add(slot);
    }

    this.group.add(g);
    this.parts.cabinet = g;
  }

  buildBackbox(dmd) {
    const g = new THREE.Group();
    const w = 0.63;
    const h = 0.52;
    const t = 0.13;
    const z = -L.boardY1 - 0.02;

    const box = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, t),
      mkMat(THREE, { color: 0x0a0c14, roughness: 0.45, metalness: 0.12, envMap: this.env, envMapIntensity: 0.5 })
    );
    box.position.set(0, h / 2 - 0.02, z - t / 2);
    box.castShadow = true;
    box.receiveShadow = true;
    g.add(box);

    // backglass
    const bgTex = new THREE.CanvasTexture(makeBackglass(1024));
    bgTex.colorSpace = THREE.SRGBColorSpace;
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(w - 0.05, h * 0.6),
      new THREE.MeshStandardMaterial({
        map: bgTex,
        emissiveMap: bgTex,
        emissive: 0xffffff,
        emissiveIntensity: 0.85,
        roughness: 0.28,
        metalness: 0,
        envMap: this.env,
        envMapIntensity: 0.4,
      })
    );
    bg.position.set(0, h * 0.64 - 0.02, z + 0.002);
    g.add(bg);

    // glass over the backglass
    const bgGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(w - 0.04, h * 0.62),
      mkMat(THREE, {
        color: 0xffffff,
        roughness: 0.03,
        metalness: 0,
        transparent: true,
        opacity: 0.07,
        envMap: this.env,
        envMapIntensity: 2.0,
        depthWrite: false,
      })
    );
    bgGlass.position.set(0, h * 0.64 - 0.02, z + 0.007);
    g.add(bgGlass);

    // DMD panel
    const dmdTex = new THREE.CanvasTexture(dmd.canvas);
    dmdTex.colorSpace = THREE.SRGBColorSpace;
    dmdTex.minFilter = THREE.LinearFilter;
    dmdTex.magFilter = THREE.LinearFilter;
    this.dmdTexture = dmdTex;
    const DMD_Y = h * 0.155;
    const dmdW = w * 0.52;
    // full-width speaker/insert panel the DMD is recessed into
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(w - 0.02, h * 0.30, 0.014),
      mkMat(THREE, { color: 0x07080d, roughness: 0.6, metalness: 0.25, envMap: this.env, envMapIntensity: 0.4 })
    );
    panel.position.set(0, DMD_Y, z - 0.004);
    g.add(panel);
    const dmdMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(dmdW, dmdW * 0.25),
      new THREE.MeshBasicMaterial({ map: dmdTex, toneMapped: true })
    );
    dmdMesh.position.set(0, DMD_Y, z + 0.006);
    g.add(dmdMesh);
    // DMD bezel: recessed chrome-lipped window
    const bez = new THREE.Mesh(
      new THREE.BoxGeometry(dmdW + 0.018, dmdW * 0.25 + 0.018, 0.008),
      this.M.blackMetal
    );
    bez.position.set(0, DMD_Y, z + 0.001);
    g.add(bez);
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(dmdW + 0.026, dmdW * 0.25 + 0.026, 0.004),
      this.M.chrome
    );
    lip.position.set(0, DMD_Y, z - 0.001);
    g.add(lip);
    const dmdLight = new THREE.PointLight(0xffa030, 0.9, 1.1, 2);
    dmdLight.position.set(0, DMD_Y, z + 0.12);
    g.add(dmdLight);
    this.parts.dmdLight = dmdLight;

    // speaker grilles — perforated plate, clear of the DMD window
    for (const d of [-1, 1]) {
      const sx = d * 0.243;
      const cone = new THREE.Mesh(
        new THREE.CylinderGeometry(0.049, 0.032, 0.016, 20, 1, true),
        mkMat(THREE, { color: 0x11131a, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide })
      );
      cone.rotation.x = Math.PI / 2;
      cone.position.set(sx, DMD_Y, z - 0.006);
      g.add(cone);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8), this.M.chrome);
      dome.position.set(sx, DMD_Y, z - 0.001);
      g.add(dome);
      // perforated grille: instanced holes over a dark plate
      const plate = new THREE.Mesh(
        new THREE.CircleGeometry(0.052, 28),
        mkMat(THREE, { color: 0x1a1d26, roughness: 0.55, metalness: 0.55, envMap: this.env, envMapIntensity: 0.6 })
      );
      plate.position.set(sx, DMD_Y, z + 0.005);
      g.add(plate);
      const holeGeo = new THREE.CircleGeometry(0.0022, 6);
      const holes = [];
      for (let ry = -7; ry <= 7; ry++) {
        for (let rx = -7; rx <= 7; rx++) {
          const ox = rx * 0.0066 + (ry & 1 ? 0.0033 : 0);
          const oy = ry * 0.0058;
          if (Math.hypot(ox, oy) > 0.046) continue;
          const gg = holeGeo.clone();
          gg.translate(sx + ox, DMD_Y + oy, z + 0.0056);
          holes.push(gg);
        }
      }
      if (holes.length) {
        g.add(new THREE.Mesh(mergeGeometries(holes), mkMat(THREE, { color: 0x000000, roughness: 1, metalness: 0 })));
      }
      // chrome trim ring
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.053, 0.0022, 6, 26), this.M.chrome);
      ring.position.set(sx, DMD_Y, z + 0.005);
      g.add(ring);
    }

    // chrome trim frame around the backglass
    {
      const fw = w - 0.036;
      const fh = h * 0.615;
      const fy = h * 0.64 - 0.02;
      const bars = [
        [fw, 0.009, 0, fh / 2],
        [fw, 0.009, 0, -fh / 2],
        [0.009, fh, -fw / 2, 0],
        [0.009, fh, fw / 2, 0],
      ];
      for (const [bw, bh, bx, by] of bars) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.009), this.M.chrome);
        m.position.set(bx, fy + by, z + 0.006);
        g.add(m);
      }
    }

    // top light bar
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.9, 0.014, 0.02),
      new THREE.MeshBasicMaterial({ color: 0x66ccff })
    );
    bar.position.set(0, h - 0.03, z + 0.005);
    g.add(bar);
    const barLight = new THREE.PointLight(0x66ccff, 0.7, 1.4, 2);
    if (!Q.practicalLights) barLight.visible = false;
    barLight.position.set(0, h - 0.03, z + 0.2);
    if (Q.eventLights) g.add(barLight);
    this.parts.barLight = barLight;

    // backglass wash light onto the playfield
    if (Q.washSpot) {
      const wash = new THREE.SpotLight(0xbfd8ff, 0.34, 3.4, 0.86, 0.98, 2.0);
      wash.position.set(-0.42, h * 1.30, z + 0.30);
      wash.target.position.set(0.06, 0, -0.62);
      g.add(wash);
      g.add(wash.target);
      this.parts.wash = wash;
    }

    this.group.add(g);
    this.parts.backbox = g;
  }

  buildGlass() {
    const w = L.boardX1 - L.boardX0;
    const h = L.boardY1 - L.boardY0;
    const geo = new THREE.PlaneGeometry(w - 0.008, h - 0.004, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate((L.boardX0 + L.boardX1) / 2, 0.093, -(L.boardY0 + L.boardY1) / 2);
    const smudge = glassSmudge(512);
    smudge.colorSpace = THREE.NoColorSpace;
    const mat = this.M.glass.clone();
    mat.roughnessMap = smudge;
    mat.roughness = 0.06;
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 20;
    this.playfieldGroup.add(m);
    this.parts.glass = m;

    // a swept specular highlight streak across the glass — the classic tell
    const streakGeo = new THREE.PlaneGeometry(w, h * 0.42);
    streakGeo.rotateX(-Math.PI / 2);
    const streakMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `
        varying vec2 vUv; uniform float uT;
        void main(){
          float d = vUv.x*0.7 + vUv.y*0.7;
          float s = smoothstep(0.42,0.5,d)*(1.0-smoothstep(0.5,0.62,d));
          float s2 = smoothstep(0.60,0.64,d)*(1.0-smoothstep(0.64,0.72,d));
          float a = (s*0.75 + s2*0.3) * (0.55 + 0.45*sin(uT*0.35));
          gl_FragColor = vec4(vec3(0.34,0.42,0.6)*a, a*0.06);
        }`,
    });
    const streak = new THREE.Mesh(streakGeo, streakMat);
    streak.position.set((L.boardX0 + L.boardX1) / 2, 0.0945, -(L.boardY0 + L.boardY1) / 2 - 0.16);
    streak.renderOrder = 21;
    this.playfieldGroup.add(streak);
    this.parts.streak = streakMat;
  }

  /* ------------------------------------------------------------ */

  /**
   * Event lamp show. Runs entirely off a wall-clock timeline so it plays even
   * when there is no ball in play (the screenshot harness relies on this).
   */
  startShow(kind) {
    this.show = { kind, t: 0 };
  }

  runShow(dt) {
    const s = this.show;
    if (!s) return 0;
    s.t += dt;
    const t = s.t;
    const dur = s.kind === 'tilt' ? 2.4 : 3.2;
    if (t > dur) {
      this.show = null;
      return 0;
    }
    const keys = Object.keys(this.lamps);
    const chase = Math.floor(t * 12);
    const palette = {
      multiball: [0x6fd9ff, 0xffffff, 0xb8ecff],
      jackpot: [0xff2e6a, 0xffd23c, 0xffffff],
      bumper: [0x8fd8ff, 0xffffff, 0x5ad7ff],
      launch: [0xffb03c, 0xffffff, 0xff5a2a],
      tilt: [0xff3020, 0x400000, 0xff3020],
    }[s.kind] || [0xffffff];
    keys.forEach((k, i) => {
      const lp = this.lamps[k];
      let lit;
      if (s.kind === 'tilt') lit = Math.floor(t * 6) % 2 === 0;
      else if (s.kind === 'multiball') lit = (i + chase) % 3 !== 0;
      else lit = (i + chase) % 2 === 0;
      lp.level = lit ? 1 : 0.05;
      lp.mat.opacity = lp.level * 0.26;
      lp.mat.color.setHex(palette[(i + chase) % palette.length]);
      const ln = this.lampLens && this.lampLens[k];
      if (ln) ln.material.emissiveIntensity = 0.03 + lp.level * 0.8;
    });
    const fl = this.parts.flashers || [];
    fl.forEach((f, i) => {
      const hit = s.kind === 'tilt' ? Math.floor(t * 6) % 2 === 0 : (i + Math.floor(t * 9)) % fl.length < 2;
      if (hit) f.level = 1;
    });
    if (this.parts.barLight) this.parts.barLight.intensity = 0.7 + (chase % 2) * 1.2;
    // exposure punch curve: hard hit, quick decay, gentle tail
    return Math.max(0, Math.exp(-t * 1.6) * (0.55 + 0.45 * Math.sin(t * 26)));
  }

  update(dt, t) {
    for (const fn of this.dynamic) fn(dt, t);
    // flipper visuals follow physics
    this.parts.flipL.g.rotation.y = -this.flipperL.angle;
    this.parts.flipR.g.rotation.y = -this.flipperR.angle;
    this.parts.flipU.g.rotation.y = -this.flipperU.angle;
    if (this.parts.streak) this.parts.streak.uniforms.uT.value = t;
    if (this.dmdTexture) this.dmdTexture.needsUpdate = true;
  }
}
