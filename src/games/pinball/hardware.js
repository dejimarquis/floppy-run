/**
 * Manufactured hardware pass.
 *
 * A real machine is several hundred visible fasteners, posts, rubbers,
 * brackets and lamp fixtures. That density — not the art — is what makes a
 * playfield read as a built object rather than a 3D scene.
 *
 * Everything here is instanced: the whole pass is ~10 draw calls, and it is
 * purely cosmetic. Every post sits *on* an existing collider line, so nothing
 * in this file can change ball behaviour.
 */

import * as THREE from 'three';
import { Q, mkMat } from './quality.js';
import { L } from './layout.js';

const V = (x, y, z = 0) => new THREE.Vector3(x, z, -y);

/** Cross-section of a Williams-style star post: 10 lobes, slight taper. */
function starPostGeometry(r = 0.0068, h = 0.026) {
  const lobes = 8;
  const shape = new THREE.Shape();
  for (let i = 0; i <= lobes * 2; i++) {
    const a = (i / (lobes * 2)) * Math.PI * 2;
    const rr = i % 2 ? r * 0.80 : r;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: h,
    bevelEnabled: true,
    bevelThickness: 0.0008,
    bevelSize: 0.0006,
    bevelSegments: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, h, 0);
  g.computeVertexNormals();
  return g;
}

function place(mesh, i, pos, rotY = 0, scale = 1) {
  const m = new THREE.Matrix4();
  m.compose(
    pos,
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
    new THREE.Vector3(scale, scale, scale)
  );
  mesh.setMatrixAt(i, m);
}

/** Evenly spaced points along a polyline, in table space. */
function alongPolyline(pts, spacing, inset = 0) {
  const out = [];
  let carry = inset;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    let t = carry;
    while (t < len) {
      out.push([x0 + ((x1 - x0) * t) / len, y0 + ((y1 - y0) * t) / len]);
      t += spacing;
    }
    carry = t - len;
  }
  return out;
}

export function buildHardware(table) {
  const M = table.M;
  const env = table.env;
  const g = table.playfieldGroup;
  const parts = table.parts;

  /* ---------------------------------------------------------------- */
  /* materials                                                        */
  /* ---------------------------------------------------------------- */

  // moulded clear-plastic star post: glassy, tinted by whatever is behind it,
  // never a chalky white cylinder
  const postMat = mkMat(THREE, {
    color: 0x4d6ea6,
    metalness: 0.2,
    roughness: 0.06,
    envMap: env,
    envMapIntensity: 1.25,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    transparent: true,
    opacity: 0.68,
    depthWrite: true,
  });
  const rubberMat = mkMat(THREE, {
    color: 0xd8262f,
    metalness: 0.0,
    roughness: 0.62,
    envMap: env,
    envMapIntensity: 0.35,
    sheen: 0.5,
    sheenColor: new THREE.Color(0xff8080),
  });
  const rubberWhite = mkMat(THREE, {
    color: 0xe4e7ea,
    metalness: 0,
    roughness: 0.68,
    envMap: env,
    envMapIntensity: 0.3,
  });
  const nutMat = mkMat(THREE, {
    color: 0xd7dde6,
    metalness: 1,
    roughness: 0.19,
    envMap: env,
    envMapIntensity: 1.5,
  });
  const screwMat = mkMat(THREE, {
    color: 0xb9c2ce,
    metalness: 1,
    roughness: 0.3,
    envMap: env,
    envMapIntensity: 1.2,
  });

  /* ---------------------------------------------------------------- */
  /* post + rubber positions                                          */
  /* ---------------------------------------------------------------- */

  // Every entry sits on top of an existing guide/wall collider, so no new
  // collision surface is introduced.
  const postSpec = [];
  const addPost = (x, y, rubber = 'red', h = 0.026) => postSpec.push({ x, y, rubber, h });

  // slingshot corners — the classic rubber triangle apex posts
  for (const s of [L.slingL, L.slingR]) {
    addPost(s[0][0], s[0][1], 'red');
    addPost(s[1][0], s[1][1], 'red');
  }
  // inlane / outlane divider tips
  addPost(L.dividerL[0][0], L.dividerL[0][1], 'white');
  addPost(L.dividerR[0][0], L.dividerR[0][1], 'white');
  addPost(L.dividerL[1][0], L.dividerL[1][1], 'none', 0.022);
  addPost(L.dividerR[1][0], L.dividerR[1][1], 'none', 0.022);
  // outer lower guide bends
  addPost(L.outerLowerL[1][0], L.outerLowerL[1][1], 'white', 0.024);
  addPost(L.outerLowerR[1][0], L.outerLowerR[1][1], 'white', 0.024);
  addPost(L.outerLowerL[2][0], L.outerLowerL[2][1], 'none', 0.022);
  addPost(L.outerLowerR[2][0], L.outerLowerR[2][1], 'none', 0.022);
  // bumper cluster guards
  for (const p of [...L.bumperGuideL, ...L.bumperGuideR]) addPost(p[0], p[1], 'red', 0.028);
  // top lane dividers
  for (const x of L.laneGuideX) {
    addPost(x, L.laneGuideY0 + 0.004, 'none', 0.024);
    addPost(x, L.laneGuideY1 - 0.004, 'none', 0.024);
  }
  // ramp mouth guards
  addPost(L.rampLeft[0][0] - 0.026, L.rampLeft[0][1] - 0.01, 'red');
  addPost(L.rampRight[0][0] + 0.026, L.rampRight[0][1] - 0.01, 'red');
  // orbit lane
  addPost(L.orbitGuideX + 0.004, 0.44, 'white', 0.024);
  addPost(L.orbitGuideX + 0.004, 0.72, 'white', 0.024);
  // Outer-rail hardware row. These sit on the exposed wood *outside* the
  // lane-guide walls (walls at ±half, board edge at ±0.298), so they are
  // purely cosmetic and can never touch a ball — but from the 3/4 framing
  // they are the row of star posts that gives the board its manufactured
  // silhouette.
  for (let y = 0.16; y < 0.95; y += 0.118) {
    addPost(-0.2875, y, y % 0.236 < 0.118 ? 'white' : 'none', 0.024);
    addPost(0.2875, y, y % 0.236 < 0.118 ? 'none' : 'white', 0.024);
  }
  // top-arch guard posts, outside the arc
  for (let a = 0.30; a < Math.PI - 0.30; a += 0.36) {
    addPost(Math.cos(a) * -(L.arcR + 0.0165), L.arcC[1] + Math.sin(a) * (L.arcR + 0.0165), 'none', 0.022);
  }

  const postGeo = starPostGeometry(0.0056, 1);
  const posts = new THREE.InstancedMesh(postGeo, postMat, postSpec.length);
  posts.castShadow = true;
  posts.receiveShadow = true;
  posts.frustumCulled = false;

  const nutGeo = new THREE.CylinderGeometry(0.0034, 0.0052, 0.0044, 6);
  const nuts = new THREE.InstancedMesh(nutGeo, nutMat, postSpec.length);
  nuts.castShadow = true;
  nuts.frustumCulled = false;

  const ringGeo = new THREE.TorusGeometry(0.0082, 0.0021, 6, 14);
  ringGeo.rotateX(Math.PI / 2);
  const redRings = [];
  const whiteRings = [];
  postSpec.forEach((p, i) => {
    const pos = V(p.x, p.y, 0);
    const m = new THREE.Matrix4();
    m.compose(pos, new THREE.Quaternion(), new THREE.Vector3(1, p.h, 1));
    posts.setMatrixAt(i, m);
    place(nuts, i, V(p.x, p.y, p.h + 0.0016));
    if (p.rubber === 'red') redRings.push([p.x, p.y, p.h]);
    else whiteRings.push([p.x, p.y, p.h]);
  });
  posts.instanceMatrix.needsUpdate = true;
  nuts.instanceMatrix.needsUpdate = true;
  posts.renderOrder = 2;
  g.add(posts, nuts);

  // black fibre washer under every post, the way they are actually mounted
  const washGeo = new THREE.CylinderGeometry(0.0092, 0.0092, 0.0008, 12);
  const washers = new THREE.InstancedMesh(
    washGeo,
    mkMat(THREE, { color: 0x14161c, metalness: 0.1, roughness: 0.7, envMap: env, envMapIntensity: 0.3 }),
    postSpec.length
  );
  washers.frustumCulled = false;
  postSpec.forEach((p, i) => place(washers, i, V(p.x, p.y, 0.0005)));
  washers.instanceMatrix.needsUpdate = true;
  g.add(washers);

  const mkRings = (list, mat) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(ringGeo, mat, list.length);
    im.castShadow = true;
    im.frustumCulled = false;
    list.forEach(([x, y, h], i) => place(im, i, V(x, y, h * 0.58)));
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  };
  mkRings(redRings, rubberMat);
  mkRings(whiteRings, rubberWhite);

  /* ---------------------------------------------------------------- */
  /* fasteners — screw heads along every guide and under every plastic */
  /* ---------------------------------------------------------------- */

  const screwPts = [];
  const guides = [
    L.outerLowerL,
    L.outerLowerR,
    L.dividerL,
    L.dividerR,
    L.bumperGuideL,
    L.bumperGuideR,
  ];
  for (const gd of guides) for (const p of alongPolyline(gd, 0.028, 0.008)) screwPts.push(p);
  // ramp footings
  for (const r of [L.rampLeft, L.rampRight]) {
    for (const i of [0, r.length - 1]) screwPts.push([r[i][0], r[i][1]]);
  }
  // apron and shooter-lane rail
  for (let y = 0.075; y < 0.79; y += 0.048) screwPts.push([L.laneIn + 0.006, y]);
  // T-nut row down the exposed wood outside both lane guides, interleaved
  // with the outer star posts. Outside the walls, so never in a ball path.
  for (let y = 0.101; y < 1.0; y += 0.118) {
    screwPts.push([-0.2875, y]);
    screwPts.push([0.2875, y]);
  }
  // top-arch fasteners, outside the arc
  for (let a = 0.12; a < Math.PI - 0.12; a += 0.18) {
    screwPts.push([
      Math.cos(a) * -(L.arcR + 0.0165),
      L.arcC[1] + Math.sin(a) * (L.arcR + 0.0165),
    ]);
  }
  // plastics standoffs around the bumper canopy
  for (const [x, y] of [
    [-0.152, 0.63], [0.108, 0.66], [-0.16, 0.755], [0.09, 0.825],
    [0.208, 0.4], [-0.236, 0.4], [-0.12, 0.43], [0.2, 0.5],
    [-0.235, 0.26], [0.205, 0.26], [-0.235, 0.83], [0.205, 0.83],
    [-0.196, 0.52], [0.166, 0.585], [-0.064, 0.478], [0.052, 0.71],
    [-0.108, 0.895], [0.132, 0.9], [-0.198, 0.185], [0.168, 0.185],
  ]) screwPts.push([x, y]);
  // three-point fixing ring around every flasher base and pop bumper
  for (const [cx, cy, rr] of [
    [-0.243, 0.735, 0.024], [0.211, 0.735, 0.024], [-0.017, 0.9, 0.024],
    [0.212, 0.315, 0.024], [-0.246, 0.315, 0.024],
    ...L.bumpers.map((b) => [b[0], b[1], 0.042]),
  ]) {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5;
      screwPts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  }

  const screwGeo = new THREE.CylinderGeometry(0.0026, 0.0024, 0.0013, 8);
  const screws = new THREE.InstancedMesh(screwGeo, screwMat, screwPts.length);
  screws.frustumCulled = false;
  screwPts.forEach((p, i) => place(screws, i, V(p[0], p[1], 0.0007), (i * 2.399) % Math.PI));
  screws.instanceMatrix.needsUpdate = true;
  g.add(screws);

  // the dark cross slot, a hair above each head — reads at a glance
  const slotGeo = new THREE.BoxGeometry(0.0042, 0.0004, 0.0009);
  const slotMat = new THREE.MeshBasicMaterial({ color: 0x1a2030 });
  const slots = new THREE.InstancedMesh(slotGeo, slotMat, screwPts.length * 2);
  slots.frustumCulled = false;
  screwPts.forEach((p, i) => {
    const a = (i * 2.399) % Math.PI;
    place(slots, i * 2, V(p[0], p[1], 0.00145), a);
    place(slots, i * 2 + 1, V(p[0], p[1], 0.00145), a + Math.PI / 2);
  });
  slots.instanceMatrix.needsUpdate = true;
  g.add(slots);

  /* ---------------------------------------------------------------- */
  /* flasher domes — physical fixtures, not bare glow cards           */
  /* ---------------------------------------------------------------- */

  const domeSpec = [
    { x: -0.243, y: 0.735, c: 0xff4d2a },
    { x: 0.211, y: 0.735, c: 0x8fc4e8 },
    { x: -0.017, y: 0.9, c: 0xffc93c },
    { x: 0.212, y: 0.315, c: 0xd8402c },
    { x: -0.246, y: 0.315, c: 0x4fbf6e },
  ];
  const flashers = [];
  const domeGeo = new THREE.SphereGeometry(0.0135, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const baseGeo = new THREE.CylinderGeometry(0.0155, 0.0175, 0.0055, 14);
  const collarGeo = new THREE.TorusGeometry(0.0138, 0.0016, 6, 16);
  collarGeo.rotateX(Math.PI / 2);
  const bulbGeo = new THREE.SphereGeometry(0.0052, 10, 8);

  for (const d of domeSpec) {
    const grp = new THREE.Group();
    const base = new THREE.Mesh(baseGeo, M.blackMetal);
    base.position.copy(V(d.x, d.y, 0.0027));
    base.castShadow = true;
    grp.add(base);
    const collar = new THREE.Mesh(collarGeo, nutMat);
    collar.position.copy(V(d.x, d.y, 0.0056));
    grp.add(collar);

    const bulb = new THREE.Mesh(
      bulbGeo,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(d.c).multiplyScalar(0.08) })
    );
    bulb.position.copy(V(d.x, d.y, 0.0082));
    grp.add(bulb);

    const domeMat = mkMat(THREE, {
      color: d.c,
      metalness: 0,
      roughness: 0.14,
      envMap: env,
      envMapIntensity: 1.35,
      transparent: true,
      opacity: 0.42,
      emissive: new THREE.Color(d.c),
      emissiveIntensity: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      side: THREE.DoubleSide,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.copy(V(d.x, d.y, 0.0056));
    grp.add(dome);

    let light = null;
    if (Q.eventLights) {
      light = new THREE.PointLight(d.c, 0, 0.26, 2);
      if (!Q.practicalLights) light.visible = false;
      light.position.copy(V(d.x, d.y, 0.03));
      grp.add(light);
    }
    g.add(grp);
    flashers.push({ x: d.x, y: d.y, level: 0, dome, domeMat, bulb, light, color: new THREE.Color(d.c) });
  }
  parts.flashers = flashers;

  table.dynamic.push((dt) => {
    for (const f of flashers) {
      f.level = Math.max(0, f.level - dt * 3.4);
      const e = f.level * f.level;
      f.domeMat.emissiveIntensity = 0.05 + e * 0.95;
      f.domeMat.opacity = 0.42 + e * 0.45;
      f.bulb.material.color.copy(f.color).multiplyScalar(0.08 + e * 0.75);
      if (f.light) f.light.intensity = e * 1.5;
    }
  });

  /* ---------------------------------------------------------------- */
  /* mounting brackets where wireforms and ramps meet the wood        */
  /* ---------------------------------------------------------------- */

  const brkGeo = new THREE.BoxGeometry(0.019, 0.0022, 0.011);
  const brkPts = [
    [L.rampLeft[0][0], L.rampLeft[0][1]],
    [L.rampLeft[L.rampLeft.length - 1][0], L.rampLeft[L.rampLeft.length - 1][1]],
    [L.rampRight[0][0], L.rampRight[0][1]],
    [L.rampRight[L.rampRight.length - 1][0], L.rampRight[L.rampRight.length - 1][1]],
  ];
  const brackets = new THREE.InstancedMesh(brkGeo, M.steelDark, brkPts.length);
  brackets.castShadow = true;
  brackets.frustumCulled = false;
  brkPts.forEach((p, i) => place(brackets, i, V(p[0], p[1], 0.0012)));
  brackets.instanceMatrix.needsUpdate = true;
  g.add(brackets);

  return { posts: postSpec.length, screws: screwPts.length, flashers: flashers.length };
}
