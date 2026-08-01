// World construction: road surface, verges, barriers, tunnels, bridge, canyon,
// downtown, street furniture, skyline, rain. Everything instanced or merged.
import * as THREE from 'three';
import { ROAD_HALF, VERGE, BARRIER_U, ROAD_SEG_LEN, makeFrame } from './track.js';
import { fbm, clamp, smoothstep } from './rng.js';
import * as TX from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function mergeAttrs(list) {
  // list: [{ pos:Float32Array, nor, uv, idx:Uint32Array }]
  let vc = 0, ic = 0;
  for (const g of list) { vc += g.pos.length / 3; ic += g.idx.length; }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2);
  const idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.pos, vo * 3); nor.set(g.nor, vo * 3); uv.set(g.uv, vo * 2);
    for (let i = 0; i < g.idx.length; i++) idx[io + i] = g.idx[i] + vo;
    vo += g.pos.length / 3; io += g.idx.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

/** Build a swept strip along the track between sample i0..i1 given a lateral profile. */
function sweep(track, i0, i1, profile, opts = {}) {
  const { uvScaleV = 1 / ROAD_SEG_LEN, closed = false, flip = false, heightFn = null } = opts;
  const n = i1 - i0 + 1;
  const m = profile.length;
  const pos = new Float32Array(n * m * 3);
  const nor = new Float32Array(n * m * 3);
  const uv = new Float32Array(n * m * 2);
  const quads = (m - (closed ? 0 : 1)) * (n - 1);
  const idx = new Uint32Array(quads * 6);
  const f = makeFrame();
  const p = new THREE.Vector3();
  let ii = 0;
  for (let a = 0; a < n; a++) {
    const si = i0 + a;
    track.sample(si, f);
    const sArc = si * track.step;
    for (let b = 0; b < m; b++) {
      const [u, h, tu] = profile[b];
      const hh = heightFn ? heightFn(si, b, u, h) : h;
      p.copy(f.pos).addScaledVector(f.right, u).addScaledVector(f.up, hh);
      const o = (a * m + b) * 3;
      pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z;
      uv[(a * m + b) * 2] = tu;
      uv[(a * m + b) * 2 + 1] = sArc * uvScaleV;
    }
  }
  for (let a = 0; a < n - 1; a++) {
    for (let b = 0; b < m - (closed ? 0 : 1); b++) {
      const b1 = (b + 1) % m;
      const v00 = a * m + b, v01 = a * m + b1;
      const v10 = (a + 1) * m + b, v11 = (a + 1) * m + b1;
      if (!flip) {
        idx[ii++] = v00; idx[ii++] = v10; idx[ii++] = v11;
        idx[ii++] = v00; idx[ii++] = v11; idx[ii++] = v01;
      } else {
        idx[ii++] = v00; idx[ii++] = v11; idx[ii++] = v10;
        idx[ii++] = v00; idx[ii++] = v01; idx[ii++] = v11;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  void nor;
  return geo;
}

export class World {
  constructor(scene, track, opts) {
    this.scene = scene;
    this.track = track;
    this.quality = opts.quality;
    this.rng = opts.rng;
    this.renderer = opts.renderer;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.dynLights = [];
    this.time = 0;
    this.build();
  }

  build() {
    const M = (n) => performance.mark('w:' + n);
    this.makeMaterials(); M('materials');
    this.makeRoad(); M('road');
    this.makeBarriers(); M('barriers');
    this.makeTunnels(); M('tunnels');
    this.makeCanyon(); M('canyon');
    this.makeBridge(); M('bridge');
    this.makeTerrain(); M('terrain');
    this.makeCity(); M('city');
    this.makeStreetFurniture(); M('furniture');
    this.makeSkyline(); M('skyline');
    this.makeRain(); M('rain');
    this.mergeStaticProps(); M('merge');
  }

  /**
   * Static props are authored per track section, which is readable but costs a
   * draw call each. Anything that never moves and shares a material gets welded
   * into batches of 12 so the frame stays inside the draw-call budget; the road
   * and tunnel shells are excluded because they are large and benefit from
   * frustum culling far more than from batching.
   */
  mergeStaticProps() {
    const skip = new Set([this.roadMat, this.tunnelMat, this.groundMat].filter(Boolean));
    const buckets = new Map();
    this.group.updateMatrixWorld(true);
    for (const o of this.group.children.slice()) {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) continue;
      if (Array.isArray(o.material)) continue;
      if (skip.has(o.material) || o.userData.noMerge) continue;
      if (!o.geometry || !o.geometry.attributes.position) continue;
      if (o.geometry.attributes.position.count > 8000) continue;
      const key = o.material.uuid;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(o);
    }
    for (const [, list] of buckets) {
      if (list.length < 4) continue;
      for (let i = 0; i < list.length; i += 20) {
        const part = list.slice(i, i + 20);
        if (part.length < 2) continue;
        const geos = part.map((m) => {
          const g = m.geometry.clone();
          g.applyMatrix4(m.matrixWorld);
          return g;
        });
        const merged = mergeSimple(geos);
        geos.forEach((g) => g.dispose());
        const mesh = new THREE.Mesh(merged, part[0].material);
        mesh.castShadow = part.some((m) => m.castShadow);
        mesh.receiveShadow = part.some((m) => m.receiveShadow);
        mesh.matrixAutoUpdate = false;
        for (const m of part) { this.group.remove(m); m.geometry.dispose(); }
        this.group.add(mesh);
      }
    }
  }

  // ------------------------------------------------------------- materials
  makeMaterials() {
    const q = this.quality;
    const roadSize = q.tier === 'ultra' ? 2048 : q.tier === 'high' ? 1536 : 1024;
    const road = TX.makeRoadSurface({ width: roadSize, height: roadSize, roadWidth: ROAD_HALF * 2, segLen: ROAD_SEG_LEN });
    const detail = TX.makeAsphaltDetail(q.tier === 'low' ? 256 : 512);
    const puddle = TX.makePuddleMask(512);
    this.tex = { road, detail, puddle };

    // Standard, not Physical: the old clearcoat layer blew the whole road to
    // white at grazing angles and cost an extra shader permutation.
    const roadMat = new THREE.MeshStandardMaterial({
      map: road.map,
      normalMap: road.normalMap,
      roughnessMap: road.roughnessMap,
      roughness: 1.0,
      metalness: 0.0,
      normalScale: new THREE.Vector2(0.5, 0.5),
      envMapIntensity: 0.18,
      dithering: true,
    });
    const uni = {
      uDetail: { value: detail.map },
      uDetailN: { value: detail.normalMap },
      uPuddle: { value: puddle },
      uWet: { value: 0.34 },
      uDetailRep: { value: new THREE.Vector2(34.0, 20.0) },
    };
    roadMat.userData.uniforms = uni;
    roadMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vRoadUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvRoadUv = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec2 vRoadUv;
          uniform sampler2D uDetail; uniform sampler2D uDetailN; uniform sampler2D uPuddle;
          uniform float uWet; uniform vec2 uDetailRep;
          float roadWet;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec2 dUv = vRoadUv * uDetailRep;
          // paint mask is taken from the untouched albedo so grime/wet passes can
          // never swallow the lane markings
          float paintMask = smoothstep(0.16, 0.45, dot(diffuseColor.rgb, vec3(0.3333)));
          vec3 det = clamp(texture2D(uDetail, dUv).rgb * 12.0, 0.80, 1.16);
          vec3 det2 = clamp(texture2D(uDetail, vRoadUv * uDetailRep * 0.31 + vec2(0.37, 0.11)).rgb * 12.0, 0.86, 1.10);
          diffuseColor.rgb *= mix(vec3(1.0), det * 0.6 + det2 * 0.4, 0.30 * (1.0 - paintMask));
          roadWet = texture2D(uPuddle, vec2(vRoadUv.x * 0.85, vRoadUv.y * 0.33)).r * uWet;
          float wetDark = mix(mix(1.0, 0.80, roadWet) * mix(1.0, 0.94, uWet * 0.6), 1.0, paintMask);
          diffuseColor.rgb *= wetDark;
          diffuseColor.rgb += paintMask * 0.05;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.34, roadWet * 0.8);
          roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.86, uWet * 0.5);`)
        .replace('#include <normal_fragment_maps>', `
          vec3 dN = texture2D(uDetailN, vRoadUv * uDetailRep).xyz * 2.0 - 1.0;
          vec3 bN = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
          vec3 mapN = normalize(vec3(bN.xy * normalScale + dN.xy * 0.16 * (1.0 - roadWet), bN.z));
          normal = normalize(tbn * mapN);`);
    };
    this.roadMat = roadMat;

    const conc = TX.makeConcrete(512, 0.36);
    this.concreteMat = new THREE.MeshStandardMaterial({
      color: 0x6e7278, map: conc.map, normalMap: conc.normalMap, roughnessMap: conc.roughnessMap,
      roughness: 1.0, metalness: 0.0, envMapIntensity: 0.35,
    });
    conc.map.repeat.set(1, 1);

    const tun = TX.makeTunnelTile(512);
    this.tunnelMat = new THREE.MeshStandardMaterial({
      map: tun.map, normalMap: tun.normalMap, roughnessMap: tun.roughnessMap,
      roughness: 1.0, metalness: 0.05, envMapIntensity: 0.35, side: THREE.DoubleSide,
    });

    const dirt = TX.makeDirtGround(512);
    this.groundMat = new THREE.MeshStandardMaterial({
      color: 0x6f7466, map: dirt.map, normalMap: dirt.normalMap, roughness: 0.98,
      metalness: 0.0, envMapIntensity: 0.30,
    });
    dirt.map.repeat.set(30, 30); dirt.normalMap.repeat.set(30, 30);
    // Big tiled ground surfaces average out to flat grey at distance. A low
    // frequency macro map re-introduces metre-to-hundred-metre variation and
    // blends a dry-grass tint over the dirt so embankments read as terrain.
    const macro = TX.makeMacroVariation(256);
    const gu = { uMacro: { value: macro }, uMacroRep: { value: new THREE.Vector2(0.9, 0.22) } };
    this.groundMat.userData.uniforms = gu;
    this.groundMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, gu);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvGUv = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec2 vGUv;
          uniform sampler2D uMacro; uniform vec2 uMacroRep;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec3 mac = texture2D(uMacro, vGUv * uMacroRep).rgb;
          vec3 grass = vec3(0.026, 0.036, 0.019);
          vec3 dry   = vec3(0.054, 0.047, 0.028);
          vec3 rock  = vec3(0.040, 0.039, 0.038);
          vec3 gcol = mix(grass, dry, mac.g);
          gcol = mix(gcol, rock, smoothstep(0.45, 0.85, mac.b));
          diffuseColor.rgb = mix(diffuseColor.rgb * (0.32 + mac.r * 0.46), gcol, 0.84);
          diffuseColor.rgb *= 0.68 + mac.r * 0.34;`);
    };

    this.rockMat = new THREE.MeshStandardMaterial({
      color: 0x2a2620, roughness: 0.95, metalness: 0.0, flatShading: true, envMapIntensity: 0.6,
    });

    this.steelMat = new THREE.MeshStandardMaterial({ color: 0x585f68, roughness: 0.45, metalness: 0.9, envMapIntensity: 1.0 });
    this.darkMetal = new THREE.MeshStandardMaterial({ color: 0x1d2027, roughness: 0.6, metalness: 0.8, envMapIntensity: 0.8 });

    this.glowTex = TX.makeSpriteGlow(128, 2.0);
    this.streakTex = TX.makeStreakSprite(256, 64);
    this.poolTex = TX.makeSpriteGlow(256, 1.35);
  }

  // ----------------------------------------------------------------- road
  makeRoad() {
    const t = this.track;
    const N = t.N;
    const CHUNKS = 14;
    const per = Math.ceil(N / CHUNKS);
    const profile = [];
    const lanes = 9;
    for (let k = 0; k < lanes; k++) {
      const u = -ROAD_HALF + (2 * ROAD_HALF * k) / (lanes - 1);
      profile.push([u, 0.02 + 0.06 * (1 - Math.abs(u) / ROAD_HALF), (u + ROAD_HALF) / (2 * ROAD_HALF)]);
    }
    this.roadChunks = [];
    for (let c = 0; c < CHUNKS; c++) {
      const i0 = c * per;
      const i1 = Math.min(N, i0 + per) + (c === CHUNKS - 1 ? 0 : 1);
      const geo = sweep(t, i0, Math.min(i1, N), profile, { uvScaleV: 1 / ROAD_SEG_LEN, flip: true });
      const m = new THREE.Mesh(geo, this.roadMat);
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      this.group.add(m);
      this.roadChunks.push(m);
    }

    // shoulders / verge (concrete), both sides in one sweep per chunk
    const vergeL = [
      [-ROAD_HALF - VERGE, 0.16, 0],
      [-ROAD_HALF - VERGE + 0.5, 0.19, 0.1],
      [-ROAD_HALF - 0.2, 0.05, 0.9],
      [-ROAD_HALF + 0.05, 0.02, 1.0],
    ];
    const vergeR = vergeL.map(([u, h, tu]) => [-u, h, tu]).reverse();
    for (let c = 0; c < CHUNKS; c++) {
      const i0 = c * per;
      const i1 = Math.min(N, i0 + per) + (c === CHUNKS - 1 ? 0 : 1);
      const gL = sweep(t, i0, Math.min(i1, N), vergeL, { uvScaleV: 1 / 8, flip: true });
      const gR = sweep(t, i0, Math.min(i1, N), vergeR, { uvScaleV: 1 / 8 });
      const mL = new THREE.Mesh(gL, this.concreteMat);
      const mR = new THREE.Mesh(gR, this.concreteMat);
      mL.receiveShadow = mR.receiveShadow = true;
      mL.matrixAutoUpdate = mR.matrixAutoUpdate = false;
      this.group.add(mL, mR);
    }
  }

  makeBarriers() {
    const t = this.track;
    const N = t.N;
    const CHUNKS = 10;
    const per = Math.ceil(N / CHUNKS);
    const prof = (side) => {
      const b = BARRIER_U * side;
      const o = 0.34 * side;
      return [
        [b - o, 0.1, 0.0],
        [b - o * 0.72, 0.42, 0.22],
        [b - o * 0.34, 1.02, 0.62],
        [b + o * 0.34, 1.02, 0.78],
        [b + o * 0.72, 0.42, 0.9],
        [b + o, 0.1, 1.0],
      ];
    };
    for (let c = 0; c < CHUNKS; c++) {
      const i0 = c * per;
      const i1 = Math.min(N, i0 + per) + (c === CHUNKS - 1 ? 0 : 1);
      for (const side of [-1, 1]) {
        const g = sweep(t, i0, Math.min(i1, N), prof(side), { uvScaleV: 1 / 4, flip: side < 0 });
        const m = new THREE.Mesh(g, this.concreteMat);
        m.castShadow = true; m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        this.group.add(m);
      }
    }

    // reflective barrier delineators (instanced emissive chips)
    const count = Math.floor(N / 6) * 2;
    const chip = new THREE.PlaneGeometry(0.22, 0.14);
    const chipMat = new THREE.MeshBasicMaterial({
      color: 0xffcc55, toneMapped: false, side: THREE.DoubleSide,
    });
    const inst = new THREE.InstancedMesh(chip, chipMat, count);
    const f = makeFrame();
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const scl = new THREE.Vector3(1, 1, 1);
    let n = 0;
    const mm = new THREE.Matrix4();
    for (let i = 0; i < N; i += 6) {
      this.track.sample(i, f);
      for (const side of [-1, 1]) {
        p.copy(f.pos).addScaledVector(f.right, BARRIER_U * side - 0.3 * side).addScaledVector(f.up, 0.75);
        mm.makeBasis(
          f.tan.clone(),
          f.up.clone(),
          f.right.clone().multiplyScalar(-side)
        );
        q.setFromRotationMatrix(mm);
        mtx.compose(p, q, scl);
        inst.setMatrixAt(n++, mtx);
      }
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    this.group.add(inst);
  }

  // --------------------------------------------------------------- tunnels
  makeTunnels() {
    const t = this.track;
    const prof = [];
    const W = ROAD_HALF + VERGE + 1.6;
    const H = 5.2, ARCH = 3.0;
    const STEPS = 16;
    prof.push([-W, -0.4, 0]);
    prof.push([-W, H * 0.55, 0.28]);
    for (let k = 0; k <= STEPS; k++) {
      const a = Math.PI * (1 - k / STEPS);
      prof.push([Math.cos(a) * W, H + Math.sin(a) * ARCH, 0.3 + 0.4 * (k / STEPS)]);
    }
    prof.push([W, H * 0.55, 0.72]);
    prof.push([W, -0.4, 1.0]);

    this.tunnelSpans = [];
    for (const sec of t.sections) {
      if (sec.kind !== 'tunnel') continue;
      const g = sweep(t, sec.i0, sec.i1, prof, { uvScaleV: 1 / 6, flip: true });
      const m = new THREE.Mesh(g, this.tunnelMat);
      m.receiveShadow = true; m.castShadow = false;
      m.matrixAutoUpdate = false;
      this.group.add(m);
      this.tunnelSpans.push([sec.s0, sec.s1]);

      // ceiling light strips (emissive geometry -> bloom)
      const stripProf = [[-4.2, H + ARCH - 0.35, 0], [4.2, H + ARCH - 0.35, 1]];
      const sg = sweep(t, sec.i0, sec.i1, stripProf, { uvScaleV: 1 / 30, flip: true });
      const sm = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0xfff0d0, toneMapped: false }));
      sm.matrixAutoUpdate = false;
      this.group.add(sm);

      // orange sodium wall strips both sides
      for (const side of [-1, 1]) {
        const wp = [[side * (W - 0.05), 3.0, 0], [side * (W - 0.05), 3.3, 1]];
        const wg = sweep(t, sec.i0, sec.i1, wp, { uvScaleV: 1 / 30, flip: side < 0 });
        const wm = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ color: 0xff8a2a, toneMapped: false }));
        wm.matrixAutoUpdate = false;
        this.group.add(wm);
      }
      // light pools on the road below the strips
      this.addLightPools(sec.i0, sec.i1, 10, 0xffd8a0, 1.15, 16, 22);
    }
  }

  /** Additive elongated glow quads lying on the road: fake wet-road light pooling. */
  addLightPools(i0, i1, everyN, color, intensity, w, l) {
    const t = this.track;
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: this.poolTex, color: new THREE.Color(color).multiplyScalar(intensity),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      toneMapped: false, opacity: 1,
    });
    const count = Math.max(1, Math.floor((i1 - i0) / everyN));
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const f = makeFrame();
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    let n = 0;
    for (let i = i0; i < i1 && n < count; i += everyN) {
      t.sample(i, f);
      p.copy(f.pos).addScaledVector(f.up, 0.06);
      basis.makeBasis(f.right.clone(), f.tan.clone(), f.up.clone());
      q.setFromRotationMatrix(basis);
      mtx.compose(p, q, new THREE.Vector3(w, l, 1));
      inst.setMatrixAt(n++, mtx);
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    inst.renderOrder = 2;
    this.group.add(inst);
    return inst;
  }

  // ---------------------------------------------------------------- canyon
  makeCanyon() {
    const t = this.track;
    for (const sec of t.sections) {
      if (sec.kind !== 'canyon') continue;
      for (const side of [-1, 1]) {
        const base = (ROAD_HALF + VERGE + 1.0) * side;
        const prof = [];
        const layers = 7;
        for (let k = 0; k < layers; k++) {
          const f = k / (layers - 1);
          prof.push([base + side * f * 42, 0, f]);
        }
        const g = sweep(t, sec.i0, sec.i1, prof, {
          uvScaleV: 1 / 20, flip: side > 0,
          heightFn: (si, b, u) => {
            const f = b / (layers - 1);
            const n = fbm(si * 0.045, b * 0.7 + side * 10, 4, 2, 0.55) * 0.5 + 0.5;
            return Math.pow(f, 0.75) * (26 + n * 34) + n * 3;
          },
        });
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, this.rockMat);
        m.receiveShadow = true; m.castShadow = true;
        m.matrixAutoUpdate = false;
        this.group.add(m);
      }
    }
  }

  // ---------------------------------------------------------------- bridge
  makeBridge() {
    const t = this.track;
    const f = makeFrame();
    for (const sec of t.sections) {
      if (sec.kind !== 'bridge') continue;
      // deck underside
      const prof = [
        [-(ROAD_HALF + VERGE), -0.1, 0], [-(ROAD_HALF + VERGE) * 0.6, -2.2, 0.25],
        [(ROAD_HALF + VERGE) * 0.6, -2.2, 0.75], [(ROAD_HALF + VERGE), -0.1, 1],
      ];
      const g = sweep(t, sec.i0, sec.i1, prof, { uvScaleV: 1 / 10, flip: true });
      const m = new THREE.Mesh(g, this.concreteMat);
      m.matrixAutoUpdate = false;
      this.group.add(m);

      // pylons + cables
      const towerGeo = new THREE.BoxGeometry(3, 1, 3);
      const cableGeo = new THREE.CylinderGeometry(0.12, 0.12, 1, 6);
      const warnMat = new THREE.MeshBasicMaterial({ color: 0xff2222, toneMapped: false });
      const warnGeo = new THREE.SphereGeometry(0.5, 8, 6);
      const towers = [];
      const nT = 3;
      for (let k = 1; k <= nT; k++) {
        const i = Math.floor(sec.i0 + ((sec.i1 - sec.i0) * k) / (nT + 1));
        t.sample(i, f);
        for (const side of [-1, 1]) {
          const h = 52;
          const p = f.pos.clone().addScaledVector(f.right, (ROAD_HALF + VERGE + 2.2) * side).addScaledVector(f.up, h / 2 - 6);
          const tm = new THREE.Mesh(towerGeo, this.concreteMat);
          tm.position.copy(p);
          tm.scale.set(1, h, 1);
          tm.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.right.clone(), f.up.clone(), f.tan.clone().negate()));
          tm.castShadow = true;
          this.group.add(tm);
          towers.push({ i, side, top: p.clone().addScaledVector(f.up, h / 2 - 2) });
          // aircraft warning light
          const wl = new THREE.Mesh(warnGeo, warnMat);
          wl.position.copy(p).addScaledVector(f.up, h / 2 + 0.5);
          this.group.add(wl);
        }
      }
      // suspension cables — one InstancedMesh for the whole span
      const cables = [];
      for (const tw of towers) {
        for (let k = -14; k <= 14; k += 2) {
          const i = tw.i + k * 3;
          if (i < sec.i0 || i > sec.i1) continue;
          t.sample(i, f);
          const foot = f.pos.clone().addScaledVector(f.right, (ROAD_HALF + VERGE + 2.2) * tw.side).addScaledVector(f.up, 1.4);
          const mid = foot.clone().add(tw.top).multiplyScalar(0.5);
          const dir = tw.top.clone().sub(foot);
          const len = dir.length();
          cables.push({ mid, len, q: new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.normalize()) });
        }
      }
      if (cables.length) {
        const ci = new THREE.InstancedMesh(cableGeo, this.darkMetal, cables.length);
        const cm = new THREE.Matrix4(), cs = new THREE.Vector3();
        cables.forEach((c, k) => {
          cs.set(1, c.len, 1);
          cm.compose(c.mid, c.q, cs);
          ci.setMatrixAt(k, cm);
        });
        ci.instanceMatrix.needsUpdate = true;
        ci.castShadow = true;
        this.group.add(ci);
      }
    }
  }

  // --------------------------------------------------------------- terrain
  makeTerrain() {
    const t = this.track;
    const N = t.N;
    const layers = 14;
    const prof = [];
    for (let k = 0; k < layers; k++) {
      const fr = k / (layers - 1);
      prof.push([0, 0, fr]);
    }
    const CHUNKS = 8;
    const per = Math.ceil(N / CHUNKS);
    for (const side of [-1, 1]) {
      for (let c = 0; c < CHUNKS; c++) {
        const i0 = c * per;
        const i1 = Math.min(N, i0 + per) + (c === CHUNKS - 1 ? 0 : 1);
        const p2 = prof.map(([_, __, fr]) => {
          const dist = ROAD_HALF + VERGE + 0.4 + Math.pow(fr, 1.9) * 240;
          return [dist * side, 0, fr * 6];
        });
        const g = sweep(t, i0, Math.min(i1, N), p2, {
          uvScaleV: 1 / 22, flip: side > 0,
          heightFn: (si, b, u) => {
            const fr = b / (layers - 1);
            if (fr < 0.02) return -0.5;
            const kind = t.section[((si % N) + N) % N];
            const flat = kind === 'city' ? 0.14 : 1.0;
            // keep a shallow drainage cut beside the carriageway so the
            // embankment never walls off the view, then let it climb away
            const rise = Math.pow(Math.max(0, fr - 0.10) / 0.90, 1.35);
            const n = fbm(si * 0.028, b * 0.9 + side * 7, 4, 2, 0.5) * 0.5 + 0.5;
            const n2 = fbm(si * 0.13 + 11, b * 3.1 + side * 3, 3, 2, 0.5);
            return -1.9 - fr * 2.2 + (n * 26 + n2 * 5.5) * rise * flat;
          },
        });
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, this.groundMat);
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        this.group.add(m);
      }
    }
    this.makeScatter();
    // distant base plane so the horizon never shows through
    const plane = new THREE.Mesh(new THREE.CircleGeometry(2600, 48), this.groundMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -34;
    plane.receiveShadow = false;
    this.group.add(plane);
  }

  // Height of the embankment surface, in track-frame "up" units, at a given
  // station index and lateral distance from the road centre. Mirrors the
  // heightFn used by makeTerrain so props sit on the ground rather than in it.
  terrainHeight(si, absU, side) {
    const edge = ROAD_HALF + VERGE + 0.4;
    if (absU <= edge) return -0.5;
    let fr = Math.pow(Math.min(1, (absU - edge) / 240), 1 / 1.9);
    const N = this.track.N;
    const kind = this.track.section[((si % N) + N) % N];
    const flat = kind === 'city' ? 0.14 : 1.0;
    const b = fr * 13;
    const rise = Math.pow(Math.max(0, fr - 0.10) / 0.90, 1.35);
    const n = fbm(si * 0.028, b * 0.9 + side * 7, 4, 2, 0.5) * 0.5 + 0.5;
    const n2 = fbm(si * 0.13 + 11, b * 3.1 + side * 3, 3, 2, 0.5);
    return -1.9 - fr * 2.2 + (n * 26 + n2 * 5.5) * rise * flat;
  }

  // ----------------------------------------------------------- scatter props
  // Rocks, boulders and low scrub break up the embankment silhouette so it
  // never reads as a bare grey ramp. All instanced, three draw calls total.
  makeScatter() {
    const t = this.track;
    const N = t.N;
    const rng = this.rng;
    const f = makeFrame();
    const mtx = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler();
    const col = new THREE.Color();
    const budget = this.quality.tier === 'low' ? 0.35 : this.quality.tier === 'med' ? 0.6 : 1;

    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    rockGeo.scale(1, 0.62, 0.88);
    const rockMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: 0xffffff, roughness: 0.95, metalness: 0.0, flatShading: true, envMapIntensity: 0.5,
    });

    const bushParts = [];
    for (const [bx, by, bz, br] of [[0, 0.55, 0, 0.85], [0.62, 0.36, 0.22, 0.6], [-0.5, 0.42, -0.35, 0.66]]) {
      const g = new THREE.IcosahedronGeometry(br, 0);
      g.scale(1, 0.78, 1);
      g.translate(bx, by, bz);
      bushParts.push(g);
    }
    const bushGeo = mergeSimple(bushParts);
    const bushMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: 0xffffff, roughness: 0.96, metalness: 0.0, flatShading: true, envMapIntensity: 0.45,
    });

    const rocks = [], bushes = [];
    for (let i = 0; i < N; i += 2) {
      const kind = t.section[i];
      if (kind === 'tunnel' || kind === 'bridge') continue;
      const density = kind === 'city' ? 0.10 : kind === 'canyon' ? 0.85 : 0.5;
      const tries = Math.round(3 * density * budget);
      for (let k = 0; k < tries; k++) {
        if (rng.next() > 0.55) continue;
        t.sample(i, f);
        const side = rng.sign();
        const absU = rng.range(ROAD_HALF + VERGE + 1.5, ROAD_HALF + 110);
        const h = this.terrainHeight(i, absU, side);
        const p = f.pos.clone().addScaledVector(f.right, absU * side).addScaledVector(f.up, h);
        const near = absU < ROAD_HALF + 26;
        if (rng.next() < (near ? 0.45 : 0.62)) {
          rocks.push({ p, s: rng.range(0.5, near ? 1.5 : 3.6), r: rng.range(0, 6.28), t: rng.next() });
        } else {
          bushes.push({ p, s: rng.range(0.7, near ? 1.6 : 2.8), r: rng.range(0, 6.28), t: rng.next() });
        }
      }
    }

    const ri = new THREE.InstancedMesh(rockGeo, rockMat, Math.max(1, rocks.length));
    rocks.forEach((o, k) => {
      e.set(rng.range(-0.25, 0.25), o.r, rng.range(-0.25, 0.25)); qq.setFromEuler(e);
      mtx.compose(o.p, qq, new THREE.Vector3(o.s * rng.range(0.8, 1.4), o.s * rng.range(0.5, 0.9), o.s));
      ri.setMatrixAt(k, mtx);
      col.setHSL(0.09, 0.06 + o.t * 0.06, 0.11 + o.t * 0.08);
      ri.setColorAt(k, col);
    });
    if (ri.instanceColor) ri.instanceColor.needsUpdate = true;
    ri.instanceMatrix.needsUpdate = true; ri.frustumCulled = false;
    ri.castShadow = true; ri.receiveShadow = true;
    this.group.add(ri);

    const bi = new THREE.InstancedMesh(bushGeo, bushMat, Math.max(1, bushes.length));
    bushes.forEach((o, k) => {
      e.set(0, o.r, 0); qq.setFromEuler(e);
      mtx.compose(o.p, qq, new THREE.Vector3(o.s * rng.range(0.85, 1.3), o.s * rng.range(0.7, 1.2), o.s));
      bi.setMatrixAt(k, mtx);
      col.setHSL(0.22 + o.t * 0.06, 0.24 + o.t * 0.16, 0.07 + o.t * 0.05);
      bi.setColorAt(k, col);
    });
    if (bi.instanceColor) bi.instanceColor.needsUpdate = true;
    bi.instanceMatrix.needsUpdate = true; bi.frustumCulled = false; bi.castShadow = true;
    this.group.add(bi);
  }

  // ------------------------------------------------------------------ city
  makeCity() {
    const t = this.track;
    const rng = this.rng;
    const q = this.quality;
    const variants = q.tier === 'low' ? 3 : 4;
    const facades = [];
    for (let i = 0; i < variants; i++) facades.push(TX.makeFacade(i + 1, q.tier === 'low' ? 256 : 512));

    const box = new THREE.BoxGeometry(1, 1, 1);
    // per-face uv already 0..1; we scale it per instance
    const perVariant = [];
    for (let i = 0; i < variants; i++) {
      const mat = new THREE.MeshStandardMaterial({
        map: facades[i].map,
        emissiveMap: facades[i].emissiveMap,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 2.2,
        roughness: 0.62, metalness: 0.15, envMapIntensity: 0.9,
      });
      mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;
      mat.emissiveMap.wrapS = mat.emissiveMap.wrapT = THREE.RepeatWrapping;
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec2 aUvScale;\nvarying vec2 vUvS;')
          .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvUvS = uv * aUvScale;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vUvS;')
          .replace('vec4 sampledDiffuseColor = texture2D( map, vMapUv );', 'vec4 sampledDiffuseColor = texture2D( map, vUvS );')
          .replace('vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );', 'vec4 emissiveColor = texture2D( emissiveMap, vUvS );');
      };
      perVariant.push({ mat, list: [] });
    }

    const f = makeFrame();
    const N = t.N;
    for (const sec of t.sections) {
      if (sec.kind !== 'city') continue;
      for (let i = sec.i0; i < sec.i1; i += 5) {
        t.sample(i, f);
        for (const side of [-1, 1]) {
          const rows = 3;
          for (let r = 0; r < rows; r++) {
            if (rng.next() > (r === 0 ? 0.72 : 0.42)) continue;
            const dist = 30 + r * 46 + rng.range(-8, 8);
            const w = rng.range(16, 34);
            const d = rng.range(16, 34);
            const h = rng.range(26, 74) * (r === 0 ? 0.85 : 1.25) * (1 + r * 0.25);
            const p = f.pos.clone()
              .addScaledVector(f.right, dist * side + rng.range(-4, 4))
              .addScaledVector(f.tan, rng.range(-8, 8));
            p.y = f.pos.y - 2 + rng.range(-1.5, 1.5) + h / 2;
            const yaw = Math.atan2(f.tan.x, f.tan.z) + rng.range(-0.15, 0.15);
            const vi = rng.int(0, variants - 1);
            perVariant[vi].list.push({ p, w, d, h, yaw });
          }
        }
      }
    }

    this.buildings = [];
    for (let i = 0; i < variants; i++) {
      const list = perVariant[i].list;
      if (!list.length) continue;
      const inst = new THREE.InstancedMesh(box, perVariant[i].mat, list.length);
      const uvScale = new Float32Array(list.length * 2);
      const mtx = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler();
      list.forEach((b, k) => {
        e.set(0, b.yaw, 0);
        qq.setFromEuler(e);
        mtx.compose(b.p, qq, new THREE.Vector3(b.w, b.h, b.d));
        inst.setMatrixAt(k, mtx);
        uvScale[k * 2] = Math.max(1, Math.round(b.w / 9));
        uvScale[k * 2 + 1] = Math.max(1, Math.round(b.h / 11));
      });
      inst.geometry = box.clone();
      inst.geometry.setAttribute('aUvScale', new THREE.InstancedBufferAttribute(uvScale, 2));
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      this.group.add(inst);
      this.buildings.push(inst);
    }

    this.makeNeonSigns();
  }

  makeNeonSigns() {
    const t = this.track;
    const rng = this.rng;
    const nTex = 8;
    const texes = [];
    for (let i = 0; i < nTex; i++) texes.push(TX.makeBillboard(i));
    const geo = new THREE.PlaneGeometry(1, 1);
    const f = makeFrame();
    const signs = [];
    for (const sec of t.sections) {
      if (sec.kind !== 'city') continue;
      for (let i = sec.i0; i < sec.i1; i += 14) {
        t.sample(i, f);
        for (const side of [-1, 1]) {
          if (rng.next() > 0.62) continue;
          const dist = 26 + rng.range(0, 12);
          const h = rng.range(8, 42);
          const w = rng.range(10, 22);
          const p = f.pos.clone().addScaledVector(f.right, dist * side).addScaledVector(f.up, h);
          signs.push({ p, w, hh: w * 0.5, side, tex: rng.int(0, nTex - 1), f: { tan: f.tan.clone(), right: f.right.clone(), up: f.up.clone(), pos: f.pos.clone() } });
        }
      }
    }
    // group by texture for instancing
    this.neonSigns = [];
    for (let ti = 0; ti < nTex; ti++) {
      const list = signs.filter((s) => s.tex === ti);
      if (!list.length) continue;
      const mat = new THREE.MeshBasicMaterial({ map: texes[ti], toneMapped: false, side: THREE.DoubleSide });
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      const mtx = new THREE.Matrix4(), qq = new THREE.Quaternion();
      const basis = new THREE.Matrix4();
      list.forEach((s, k) => {
        const right = s.f.right.clone().multiplyScalar(-s.side);
        const up = s.f.up.clone();
        const fwd = new THREE.Vector3().crossVectors(right, up).normalize();
        basis.makeBasis(right, up, fwd);
        qq.setFromRotationMatrix(basis);
        mtx.compose(s.p, qq, new THREE.Vector3(s.w, s.hh, 1));
        inst.setMatrixAt(k, mtx);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;
      this.group.add(inst);
      this.neonSigns.push(inst);
    }

    // wet-road neon streak reflections beneath the city
    for (const sec of t.sections) {
      if (sec.kind !== 'city') continue;
      this.addNeonReflections(sec.i0, sec.i1);
    }
  }

  addNeonReflections(i0, i1) {
    const t = this.track;
    const rng = this.rng;
    const geo = new THREE.PlaneGeometry(1, 1);
    const cols = [0xff2d6f, 0x22e6ff, 0xffb020, 0xb14bff, 0x3cff8e, 0xff2ec4];
    const groups = new Map();
    const f = makeFrame();
    for (let i = i0; i < i1; i += 7) {
      t.sample(i, f);
      for (const side of [-1, 1]) {
        if (rng.next() > 0.55) continue;
        const c = cols[rng.int(0, cols.length - 1)];
        if (!groups.has(c)) groups.set(c, []);
        const u = side * rng.range(4, 12.2);
        const p = f.pos.clone().addScaledVector(f.right, u).addScaledVector(f.up, 0.045);
        groups.get(c).push({ p, right: f.right.clone(), tan: f.tan.clone(), up: f.up.clone(), w: rng.range(1.6, 4.2), l: rng.range(18, 46) });
      }
    }
    for (const [c, list] of groups) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.poolTex, color: new THREE.Color(c).multiplyScalar(0.85),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      });
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      const mtx = new THREE.Matrix4(), qq = new THREE.Quaternion(), basis = new THREE.Matrix4();
      list.forEach((s, k) => {
        basis.makeBasis(s.right, s.tan, s.up);
        qq.setFromRotationMatrix(basis);
        mtx.compose(s.p, qq, new THREE.Vector3(s.w, s.l, 1));
        inst.setMatrixAt(k, mtx);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;
      inst.renderOrder = 2;
      this.group.add(inst);
    }
  }

  // ------------------------------------------------------- street furniture
  makeStreetFurniture() {
    const t = this.track;
    const N = t.N;
    const f = makeFrame();

    // ---- street lights: merged pole + arm geometry, instanced
    const poleGeo = new THREE.CylinderGeometry(0.14, 0.2, 9, 6);
    poleGeo.translate(0, 4.5, 0);
    const armGeo = new THREE.CylinderGeometry(0.1, 0.1, 3.4, 5);
    armGeo.rotateZ(Math.PI / 2 - 0.25);
    armGeo.translate(1.6, 8.7, 0);
    const headGeo = new THREE.BoxGeometry(1.5, 0.24, 0.6);
    headGeo.translate(3.1, 8.35, 0);
    const lampGeo = poleGeo.clone();
    const merged = mergeSimple([poleGeo, armGeo, headGeo]);
    void lampGeo;

    const positions = [];
    for (let i = 0; i < N; i += 20) {
      t.sample(i, f);
      const kind = t.section[i];
      if (kind === 'tunnel') continue;
      for (const side of [-1, 1]) {
        positions.push({
          p: f.pos.clone().addScaledVector(f.right, (ROAD_HALF + VERGE + 0.9) * side).addScaledVector(f.up, 0),
          right: f.right.clone().multiplyScalar(-side), up: f.up.clone(), tan: f.tan.clone().multiplyScalar(side),
          side, i,
        });
      }
    }
    const lampInst = new THREE.InstancedMesh(merged, this.darkMetal, positions.length);
    const mtx = new THREE.Matrix4(), qq = new THREE.Quaternion(), basis = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    positions.forEach((s, k) => {
      basis.makeBasis(s.right, s.up, new THREE.Vector3().crossVectors(s.right, s.up).normalize());
      qq.setFromRotationMatrix(basis);
      mtx.compose(s.p, qq, one);
      lampInst.setMatrixAt(k, mtx);
    });
    lampInst.instanceMatrix.needsUpdate = true;
    lampInst.castShadow = true;
    lampInst.frustumCulled = false;
    this.group.add(lampInst);

    // emissive lamp heads
    const bulbGeo = new THREE.PlaneGeometry(1.3, 0.5);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false, side: THREE.DoubleSide });
    const bulbInst = new THREE.InstancedMesh(bulbGeo, bulbMat, positions.length);
    positions.forEach((s, k) => {
      const p = s.p.clone().addScaledVector(s.right, 3.1).addScaledVector(s.up, 8.2);
      basis.makeBasis(s.right, new THREE.Vector3().crossVectors(s.right, s.up).normalize().negate(), s.up);
      qq.setFromRotationMatrix(basis);
      mtx.compose(p, qq, one);
      bulbInst.setMatrixAt(k, mtx);
    });
    bulbInst.instanceMatrix.needsUpdate = true;
    bulbInst.frustumCulled = false;
    this.group.add(bulbInst);

    // glow sprites at each lamp
    const glowGeo = new THREE.PlaneGeometry(3.0, 3.0);
    const glowMat = new THREE.MeshBasicMaterial({
      map: this.glowTex, color: 0xffc477, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.22,
    });
    const glowInst = new THREE.InstancedMesh(glowGeo, glowMat, positions.length);
    this.lampGlowData = positions.map((s) => s.p.clone().addScaledVector(s.right, 3.1).addScaledVector(s.up, 8.2));
    this.lampGlow = glowInst;
    glowInst.frustumCulled = false;
    glowInst.renderOrder = 3;
    this.group.add(glowInst);
    this.updateLampGlow(new THREE.Vector3());

    // light pools on the road under lamps
    const poolGeo = new THREE.PlaneGeometry(1, 1);
    const poolMat = new THREE.MeshBasicMaterial({
      map: this.poolTex, color: new THREE.Color(0xffbb70).multiplyScalar(0.032), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const poolInst = new THREE.InstancedMesh(poolGeo, poolMat, positions.length);
    positions.forEach((s, k) => {
      const p = s.p.clone().addScaledVector(s.right, 6.0).addScaledVector(s.up, 0.05);
      basis.makeBasis(s.right, new THREE.Vector3().crossVectors(s.right, s.up).normalize(), s.up);
      qq.setFromRotationMatrix(basis);
      mtx.compose(p, qq, new THREE.Vector3(9, 14, 1));
      poolInst.setMatrixAt(k, mtx);
    });
    poolInst.instanceMatrix.needsUpdate = true;
    poolInst.frustumCulled = false;
    poolInst.renderOrder = 2;
    this.group.add(poolInst);

    // ---- overhead gantries with signs
    this.makeGantries();
    // ---- cones + roadside clutter
    this.makeClutter();
    // ---- overpasses crossing above the route
    this.makeOverpasses();
  }

  makeGantries() {
    const t = this.track;
    const N = t.N;
    const f = makeFrame();
    const signTexes = [0, 1, 2, 3].map((i) => TX.makeRoadSign(i));
    const beam = new THREE.BoxGeometry(1, 0.7, 0.7);
    const leg = new THREE.BoxGeometry(0.5, 1, 0.5);
    const beams = [], legs = [], signs = [];
    for (let i = 0; i < N; i += 260) {
      t.sample(i, f);
      if (t.section[i] === 'tunnel') continue;
      beams.push({ f: cloneFrame(f) });
      legs.push({ f: cloneFrame(f), side: -1 });
      legs.push({ f: cloneFrame(f), side: 1 });
      signs.push({ f: cloneFrame(f), tex: (i / 260) | 0 });
    }
    const mtx = new THREE.Matrix4(), qq = new THREE.Quaternion(), basis = new THREE.Matrix4();
    const bi = new THREE.InstancedMesh(beam, this.darkMetal, beams.length);
    beams.forEach((b, k) => {
      const p = b.f.pos.clone().addScaledVector(b.f.up, 7.6);
      basis.makeBasis(b.f.right, b.f.up, b.f.tan);
      qq.setFromRotationMatrix(basis);
      mtx.compose(p, qq, new THREE.Vector3((ROAD_HALF + VERGE) * 2 + 2, 1, 1));
      bi.setMatrixAt(k, mtx);
    });
    bi.instanceMatrix.needsUpdate = true; bi.frustumCulled = false; bi.castShadow = true;
    this.group.add(bi);

    const li = new THREE.InstancedMesh(leg, this.darkMetal, legs.length);
    legs.forEach((b, k) => {
      const p = b.f.pos.clone().addScaledVector(b.f.right, (ROAD_HALF + VERGE + 0.5) * b.side).addScaledVector(b.f.up, 3.9);
      basis.makeBasis(b.f.right, b.f.up, b.f.tan);
      qq.setFromRotationMatrix(basis);
      mtx.compose(p, qq, new THREE.Vector3(1, 8, 1));
      li.setMatrixAt(k, mtx);
    });
    li.instanceMatrix.needsUpdate = true; li.frustumCulled = false; li.castShadow = true;
    this.group.add(li);

    const sgeo = new THREE.PlaneGeometry(9, 4.5);
    for (let ti = 0; ti < 4; ti++) {
      const list = signs.filter((s) => s.tex % 4 === ti);
      if (!list.length) continue;
      const mat = new THREE.MeshStandardMaterial({
        map: signTexes[ti], emissive: 0xffffff, emissiveMap: signTexes[ti],
        emissiveIntensity: 0.25, roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide,
      });
      const inst = new THREE.InstancedMesh(sgeo, mat, list.length);
      list.forEach((s, k) => {
        const p = s.f.pos.clone().addScaledVector(s.f.up, 5.4).addScaledVector(s.f.right, 6);
        const nrm = s.f.tan.clone().negate();
        basis.makeBasis(s.f.right.clone().negate(), s.f.up, nrm);
        qq.setFromRotationMatrix(basis);
        mtx.compose(p, qq, new THREE.Vector3(1, 1, 1));
        inst.setMatrixAt(k, mtx);
      });
      inst.instanceMatrix.needsUpdate = true; inst.frustumCulled = false;
      this.group.add(inst);
    }
  }

  makeClutter() {
    const t = this.track;
    const N = t.N;
    const rng = this.rng;
    const f = makeFrame();
    const coneGeo = new THREE.ConeGeometry(0.32, 0.85, 8);
    coneGeo.translate(0, 0.42, 0);
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff5a1e, roughness: 0.75, metalness: 0.0, emissive: 0x2a0a00, emissiveIntensity: 1 });
    const cones = [];
    for (let i = 0; i < N; i += 3) {
      if (rng.next() > 0.055) continue;
      t.sample(i, f);
      const side = rng.sign();
      const u = side * rng.range(11.2, 14.5);
      cones.push(f.pos.clone().addScaledVector(f.right, u).addScaledVector(f.up, 0.03));
    }
    const ci = new THREE.InstancedMesh(coneGeo, coneMat, cones.length);
    const mtx = new THREE.Matrix4(), qq = new THREE.Quaternion();
    cones.forEach((p, k) => { mtx.compose(p, qq, new THREE.Vector3(1, 1, 1)); ci.setMatrixAt(k, mtx); });
    ci.instanceMatrix.needsUpdate = true; ci.frustumCulled = false; ci.castShadow = true;
    this.group.add(ci);

    // roadside trees / poles in open + canyon sections
    const trunk = new THREE.CylinderGeometry(0.16, 0.30, 5.4, 6);
    trunk.translate(0, 2.7, 0);
    const canopyParts = [trunk];
    // three offset, squashed spheres read as a real canopy silhouette instead of
    // a single floating polyhedron
    const blobs = [
      [0.0, 6.5, 0.0, 2.55, 0.80],
      [1.35, 5.5, 0.55, 1.85, 0.86],
      [-1.10, 5.9, -0.85, 1.70, 0.82],
      [0.35, 7.9, -0.30, 1.55, 0.78],
    ];
    for (const [bx, by, bz, br, sq] of blobs) {
      const g = new THREE.IcosahedronGeometry(br, 1);
      g.scale(1, sq, 1);
      g.translate(bx, by, bz);
      canopyParts.push(g);
    }
    const treeGeo = mergeSimple(canopyParts);
    const treeMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: 0xffffff, roughness: 0.92, metalness: 0.0, flatShading: true, envMapIntensity: 0.55,
    });
    const trees = [];
    for (let i = 0; i < N; i += 4) {
      const kind = t.section[i];
      if (kind === 'tunnel' || kind === 'bridge' || kind === 'city') continue;
      if (rng.next() > 0.30) continue;
      t.sample(i, f);
      const side = rng.sign();
      const u = rng.range(19, 90);
      const p = f.pos.clone().addScaledVector(f.right, u * side)
        .addScaledVector(f.up, this.terrainHeight(i, u, side) - 0.4);
      trees.push({ p, s: rng.range(0.7, 1.5), r: rng.range(0, 6.28) });
    }
    const ti2 = new THREE.InstancedMesh(treeGeo, treeMat, trees.length);
    const e = new THREE.Euler();
    const tc = new THREE.Color();
    trees.forEach((tr, k) => {
      e.set(0, tr.r, 0); qq.setFromEuler(e);
      mtx.compose(tr.p, qq, new THREE.Vector3(tr.s, tr.s * 1.15, tr.s));
      ti2.setMatrixAt(k, mtx);
      tc.setHSL(0.24 + rng.range(-0.045, 0.05), 0.30 + rng.range(0, 0.16), 0.10 + rng.range(0, 0.055));
      ti2.setColorAt(k, tc);
    });
    if (ti2.instanceColor) ti2.instanceColor.needsUpdate = true;
    ti2.instanceMatrix.needsUpdate = true; ti2.frustumCulled = false; ti2.castShadow = true;
    this.group.add(ti2);
  }

  makeOverpasses() {
    const t = this.track;
    const N = t.N;
    const f = makeFrame();
    const deck = new THREE.BoxGeometry(1, 1, 1);
    const items = [];
    for (let i = 120; i < N; i += 210) {
      if (t.section[i] === 'tunnel' || t.section[i] === 'bridge') continue;
      t.sample(i, f);
      items.push(cloneFrame(f));
    }
    const mtx = new THREE.Matrix4(), qq = new THREE.Quaternion(), basis = new THREE.Matrix4();
    const di = new THREE.InstancedMesh(deck, this.concreteMat, items.length * 3);
    let n = 0;
    for (const fr of items) {
      const p = fr.pos.clone().addScaledVector(fr.up, 10.5);
      basis.makeBasis(fr.right, fr.up, fr.tan);
      qq.setFromRotationMatrix(basis);
      mtx.compose(p, qq, new THREE.Vector3(150, 1.6, 13));
      di.setMatrixAt(n++, mtx);
      for (const side of [-1, 1]) {
        const pp = fr.pos.clone().addScaledVector(fr.right, (ROAD_HALF + VERGE + 3) * side).addScaledVector(fr.up, 5);
        mtx.compose(pp, qq, new THREE.Vector3(4, 11, 12));
        di.setMatrixAt(n++, mtx);
      }
    }
    di.count = n;
    di.instanceMatrix.needsUpdate = true;
    di.frustumCulled = false;
    di.castShadow = true; di.receiveShadow = true;
    this.group.add(di);
  }

  // -------------------------------------------------------------- skyline
  makeSkyline() {
    const far = TX.makeSkylineSprite(2048, 512, 3);
    const near = TX.makeSkylineSprite(2048, 384, 9);
    const mk = (t, radius, h, y, rep, op) => {
      t.repeat.set(rep, 1);
      const g = new THREE.CylinderGeometry(radius, radius, h, 64, 1, true);
      const m = new THREE.MeshBasicMaterial({
        map: t, transparent: true, side: THREE.BackSide, depthWrite: false,
        opacity: op, fog: false, color: 0x5e7ea8,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.y = y;
      mesh.renderOrder = -1;
      return mesh;
    };
    this.skylineFar = mk(far, 2100, 420, 120, 8, 0.62);
    this.skylineNear = mk(near, 1450, 300, 80, 6, 0.88);
    this.group.add(this.skylineFar, this.skylineNear);
  }

  // ----------------------------------------------------------------- rain
  makeRain() {
    const q = this.quality;
    const count = q.rain;
    if (!count) { this.rain = null; return; }
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const spd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 90;
      pos[i * 3 + 1] = Math.random() * 45;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 90;
      spd[i] = 0.7 + Math.random() * 0.6;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uOrigin: { value: new THREE.Vector3() },
        uVel: { value: new THREE.Vector3() }, uTint: { value: new THREE.Color(0x9fb6d8) },
      },
      vertexShader: `
        attribute float aSpeed;
        uniform float uTime; uniform vec3 uOrigin; uniform vec3 uVel;
        varying float vA;
        void main(){
          vec3 p = position;
          p.y = mod(p.y - uTime * 26.0 * aSpeed, 45.0);
          vec3 w = p + uOrigin - vec3(0.0, 4.0, 0.0);
          w.xz -= uVel.xz * 0.03 * (45.0 - p.y) * 0.02;
          vec4 mv = modelViewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(34.0 / -mv.z, 1.0, 2.3) * (1.0 + aSpeed);
          vA = smoothstep(6.0, 15.0, -mv.z) * (1.0 - smoothstep(22.0, 52.0, -mv.z));
        }`,
      fragmentShader: `
        uniform vec3 uTint; varying float vA;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(vec2(d.x * 3.0, d.y)));
          gl_FragColor = vec4(uTint * 0.8, a * vA * 0.16);
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.rain = pts;
    this.scene.add(pts);
  }

  updateLampGlow(camPos) {
    if (!this.lampGlow) return;
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const data = this.lampGlowData;
    let n = 0;
    const dir = new THREE.Vector3();
    for (let i = 0; i < data.length; i++) {
      const p = data[i];
      const d = p.distanceTo(camPos);
      if (d > 420) continue;
      dir.subVectors(camPos, p).normalize();
      q.setFromUnitVectors(_Z, dir);
      // fade in with distance so a lamp we drive past does not smear a huge
      // orange disc across the screen
      const near = clamp((d - 9) / 22, 0, 1);
      const k = clamp(1.05 - d / 360, 0.28, 1.05) * near;
      if (k < 0.02) continue;
      s.set(k, k, k);
      mtx.compose(p, q, s);
      this.lampGlow.setMatrixAt(n++, mtx);
      if (n >= data.length) break;
    }
    this.lampGlow.count = n;
    this.lampGlow.instanceMatrix.needsUpdate = true;
  }

  inTunnel(s) {
    if (!this.tunnelSpans) return false;
    for (const [a, b] of this.tunnelSpans) if (s > a && s < b) return true;
    return false;
  }

  update(dt, camPos, camVel) {
    this.time += dt;
    if (this.rain) {
      this.rain.material.uniforms.uTime.value = this.time;
      this.rain.material.uniforms.uOrigin.value.copy(camPos);
      this.rain.material.uniforms.uVel.value.copy(camVel);
      this.rain.position.set(0, 0, 0);
    }
    if (this.skylineFar) {
      this.skylineFar.position.x = camPos.x; this.skylineFar.position.z = camPos.z;
      this.skylineNear.position.x = camPos.x * 0.98; this.skylineNear.position.z = camPos.z * 0.98;
    }
    this._glowTick = (this._glowTick || 0) + 1;
    if (this._glowTick % 6 === 0) this.updateLampGlow(camPos);
  }

  setEnvironment(env) {
    this.roadMat.envMap = env;
    this.group.traverse((o) => {
      if (o.material && o.material.isMeshStandardMaterial) o.material.envMap = env;
    });
  }
}

const _Z = new THREE.Vector3(0, 0, 1);

function cloneFrame(f) {
  return { pos: f.pos.clone(), tan: f.tan.clone(), right: f.right.clone(), up: f.up.clone(), curv: f.curv, bank: f.bank, kind: f.kind };
}

/** Minimal geometry merge for non-indexed/indexed position+normal+uv geometries. */
export function mergeSimple(geos) {
  const list = geos.map((g) => {
    const gg = g.index ? g.toNonIndexed() : g;
    const pos = gg.attributes.position.array;
    const nor = gg.attributes.normal ? gg.attributes.normal.array : new Float32Array(pos.length);
    const uvA = gg.attributes.uv ? gg.attributes.uv.array : new Float32Array((pos.length / 3) * 2);
    const idx = new Uint32Array(pos.length / 3);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
    return { pos, nor, uv: uvA, idx };
  });
  const geo = mergeAttrs(list);
  geo.computeVertexNormals();
  return geo;
}

export { sweep, smoothstep };
