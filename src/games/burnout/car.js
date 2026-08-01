// Car: visual assembly (deformable body, panels, glass, lights, wheels) bound
// to a Vehicle rigid body, plus damage / wreck behaviour.
import * as THREE from 'three';
import { Vehicle } from './physics.js';
import { Deformer, worldImpactToLocal } from './deform.js';
import {
  buildBody, buildUnderbody, panelPlate, makePaintMaterial, makeGlassMaterial,
  buildWheelGeometry, CAR_STYLES,
} from './carmesh.js';
import { clamp } from './rng.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';

const _wp = new THREE.Vector3(), _wd = new THREE.Vector3();
const _lp = new THREE.Vector3(), _ld = new THREE.Vector3();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
const _qs = new THREE.Quaternion(), _qsp = new THREE.Quaternion();
const _YAXIS = new THREE.Vector3(0, 1, 0), _XAXIS = new THREE.Vector3(1, 0, 0);

// Stamps a per-vertex body-space position so the livery shader lines up across
// the body shell and every detachable panel (each of which is re-pivoted).
function tagBody(geo, ox = 0, oy = 0, oz = 0) {
  const pos = geo.attributes.position;
  const a = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    a[i * 3] = pos.getX(i) + ox;
    a[i * 3 + 1] = pos.getY(i) + oy;
    a[i * 3 + 2] = pos.getZ(i) + oz;
  }
  geo.setAttribute('aBody', new THREE.BufferAttribute(a, 3));
  return geo;
}

let GLOW_TEX = null;
function glowTex() { if (!GLOW_TEX) GLOW_TEX = TX.makeSpriteGlow(128, 1.7); return GLOW_TEX; }

const BEAM_MAT = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  uniforms: { uColor: { value: new THREE.Color(0xcfe0ff) }, uIntensity: { value: 1.0 } },
  vertexShader: `
    varying vec2 vUv; varying vec3 vN; varying vec3 vView;
    void main(){
      vUv = uv; vN = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position,1.0);
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 uColor; uniform float uIntensity;
    varying vec2 vUv; varying vec3 vN; varying vec3 vView;
    void main(){
      float edge = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.4);
      // vUv.y == 1 at the lamp, 0 at the far end: bright at the source, gone at the tip
      float along = pow(clamp(vUv.y, 0.0, 1.0), 2.0) * smoothstep(0.0, 0.14, 1.0 - vUv.y);
      float a = edge * along * uIntensity;
      gl_FragColor = vec4(uColor * a * 0.85, a * 0.34);
    }`,
});

/** Reverse triangle winding and normals so a shell renders inside-out on FrontSide. */
function flipWinding(geo) {
  const nrm = geo.getAttribute('normal');
  if (nrm) { const a = nrm.array; for (let i = 0; i < a.length; i++) a[i] = -a[i]; nrm.needsUpdate = true; }
  if (geo.index) {
    const ix = geo.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    geo.index.needsUpdate = true;
  } else {
    for (const name of Object.keys(geo.attributes)) {
      const at = geo.attributes[name], n = at.itemSize, a = at.array;
      for (let i = 0; i < a.length; i += n * 3) {
        for (let k = 0; k < n; k++) { const t = a[i + n + k]; a[i + n + k] = a[i + n * 2 + k]; a[i + n * 2 + k] = t; }
      }
      at.needsUpdate = true;
    }
  }
  return geo;
}

export class Car {
  constructor(game, opts = {}) {
    this.game = game;
    this.isPlayer = !!opts.isPlayer;
    this.styleName = opts.style || 'sport';
    this.color = opts.color ?? 0xd21f28;
    this.name = opts.name || 'RIVAL';
    const S = CAR_STYLES[this.styleName];

    this.veh = new Vehicle({
      track: game.track,
      cfg: {
        mass: opts.mass ?? (this.styleName === 'muscle' ? 1580 : 1330),
        size: [S.width, S.roof, S.len],
        wheelBase: S.wheelbase,
        trackWidth: S.width * 0.80,
        wheelR: S.wheelR,
        enginePower: opts.power ?? 56000,
        topSpeed: opts.topSpeed ?? 86,
        boostSpeed: opts.boostSpeed ?? 118,
      },
    });
    this.veh.owner = this;
    this.veh.onWallHit = (impact, p, n) => this.onWall(impact, p, n);

    this.group = new THREE.Group();
    this.inner = new THREE.Group();
    this.inner.position.y = -this.veh.cfg.comHeight;
    this.group.add(this.inner);
    game.scene.add(this.group);

    this.buildVisual(opts);

    this.health = 1;
    this.wrecked = false;
    this.wreckTime = 0;
    this.brakeHeat = 0;
    this.boostActive = false;
    this.lastImpactTime = -10;
    this.lastHitBy = null;
    this.lastHitTime = -10;
    this.detached = [];
    this.flyingPanels = [];
    this.aiState = null;
    this.lapS = 0;
    this.totalS = 0;
    this.prevS = 0;
  }

  buildVisual(opts) {
    const S = CAR_STYLES[this.styleName];
    const { body, glass, meta } = buildBody(this.styleName);
    this.meta = meta;

    // Real car paint is a dielectric base under a clearcoat: high metalness
    // turns the body into a sky mirror and washes the colour out completely.
    this.paint = makePaintMaterial(this.color, {
      roughness: this.isPlayer ? 0.24 : 0.30,
      metalness: 0.10,
    });
    tagBody(body);
    this.bodyMesh = new THREE.Mesh(body, this.paint);
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.inner.add(this.bodyMesh);
    this.deformer = new Deformer(this.bodyMesh, { maxDisp: 0.30 });

    this.glassMat = makeGlassMaterial();
    this.glassMesh = new THREE.Mesh(glass, this.glassMat);
    this.glassMesh.castShadow = false;
    this.inner.add(this.glassMesh);

    // Dark inside-out shell so a rolling wreck never shows a lit interior of
    // painted livery through its own bodywork.
    // Winding is flipped rather than using side: BackSide -- a BackSide
    // variant is a whole extra shader program for one dark shell.
    const interior = flipWinding(body.clone());
    const intMat = new THREE.MeshStandardMaterial({
      color: 0x0a0b0e, roughness: 0.9, metalness: 0.1,
    });
    this.interiorMesh = new THREE.Mesh(interior, intMat);
    this.interiorMesh.scale.setScalar(0.965);
    this.interiorMesh.position.y = 0.02;
    this.inner.add(this.interiorMesh);

    // Chassis. A rolling wreck is on its roof or its flank for most of the
    // replay, and without this it reads as a featureless dark slab.
    body.computeBoundingBox();
    this.underMesh = new THREE.Mesh(buildUnderbody(this.styleName, body.boundingBox.min.y + 0.10), new THREE.MeshStandardMaterial({
      vertexColors: true, color: 0x3c3f45, roughness: 0.94, metalness: 0.28, envMapIntensity: 0.12,
    }));
    this.underMesh.castShadow = this.isPlayer;
    this.inner.add(this.underMesh);

    // ---------------- panels
    const M = meta.M, hl = meta.sil.halfLen;
    const mkPanel = (kind, zr, jr, mat) => {
      const g = panelPlate(meta, zr, jr, 0.005);
      if (!g) return null;
      const pv = g.userData.pivot;
      tagBody(g, pv.x, pv.y, pv.z);
      const mesh = new THREE.Mesh(g, mat || this.paint);
      mesh.castShadow = this.isPlayer;
      mesh.position.copy(pv);
      this.inner.add(mesh);
      const p = { kind, mesh, attached: true, base: g.userData.pivot.clone() };
      this.panels.push(p);
      return p;
    };
    this.panels = [];
    mkPanel('hood', [hl * 0.34, hl * 0.94], [Math.round(M * 0.5) - 5, Math.round(M * 0.5) + 5]);
    mkPanel('boot', [-hl * 0.92, -hl * 0.42], [Math.round(M * 0.5) - 5, Math.round(M * 0.5) + 5]);
    mkPanel('doorR', [-hl * 0.42, hl * 0.28], [Math.round(M * 0.25) - 4, Math.round(M * 0.25) + 4]);
    mkPanel('doorL', [-hl * 0.42, hl * 0.28], [Math.round(M * 0.75) - 4, Math.round(M * 0.75) + 4]);
    // Bumpers share the hull material outright. A dedicated `plain` variant
    // skipped the livery shader, and the livery shader is also what darkens
    // the sills and graduates the roof -- so the nose and tail rendered a
    // flat, brighter shade and read as two loose slabs bolted to the car.
    this.bumperMat = this.paint;
    mkPanel('bumperF', [hl * 0.80, hl * 0.995], [-Math.round(M * 0.26), Math.round(M * 0.26)], this.paint);
    mkPanel('bumperR', [-hl * 0.995, -hl * 0.80], [-Math.round(M * 0.26), Math.round(M * 0.26)], this.paint);

    // ---------------- spoiler
    const trimParts = [];
    if (S.spoiler > 0.05) {
      const wing = new THREE.BoxGeometry(S.width * 0.86, 0.055, 0.34);
      const wy = S.deck + S.spoiler + 0.10, wz = -hl * 0.86;
      tagBody(wing, 0, wy, wz);
      const wm = new THREE.Mesh(wing, this.paint);
      wm.position.set(0, wy, wz);
      wm.rotation.x = -0.12;
      wm.castShadow = this.isPlayer;
      this.inner.add(wm);
      const strut = new THREE.BoxGeometry(0.07, S.spoiler + 0.12, 0.2);
      for (const sx of [-1, 1]) {
        trimParts.push(strut.clone().translate(
          sx * S.width * 0.34, S.deck + S.spoiler * 0.5 + 0.04, -hl * 0.86));
      }
      strut.dispose();
      const p = { kind: 'spoiler', mesh: wm, attached: true, base: wm.position.clone() };
      this.panels.push(p);
    }

    // ---------------- splitter / diffuser / sills / arches / mirrors
    // All of these share one dark-trim material and never move relative to the
    // body, so they are merged into a single mesh (11 draw calls -> 1 per car).
    const trim = this.darkTrim();
    trimParts.push(new THREE.BoxGeometry(S.width * 0.96, 0.05, 0.42)
      .translate(0, S.ride - 0.02, hl * 0.93));
    trimParts.push(new THREE.BoxGeometry(S.width * 0.84, 0.16, 0.4)
      .translate(0, S.ride + 0.04, -hl * 0.92));
    for (const sx of [-1, 1]) {
      trimParts.push(new THREE.BoxGeometry(0.09, 0.11, S.len * 0.42)
        .translate(sx * S.width * 0.49, S.ride + 0.05, 0));
    }
    // wheel arch trim rings
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const arch = new THREE.TorusGeometry(S.wheelR * 1.16, 0.055, 6, 16, Math.PI);
      arch.rotateY(Math.PI / 2);
      arch.translate(sx * (S.width * 0.5 - 0.02), S.wheelR * 0.95, sz > 0 ? S.frontZ : S.rearZ);
      trimParts.push(arch);
    }
    // mirrors
    for (const sx of [-1, 1]) {
      trimParts.push(new THREE.BoxGeometry(0.20, 0.09, 0.11).translate(
        sx * (S.width * 0.54), S.hood + 0.16, S.cabin[1] * meta.sil.halfLen * 0.9));
    }
    const trimGeo = mergeGeometries(trimParts, false);
    for (const g of trimParts) g.dispose();
    const trimMesh = new THREE.Mesh(trimGeo, trim);
    trimMesh.castShadow = this.isPlayer;
    this.inner.add(trimMesh);
    // small details culled at distance (see updateDetailLOD)
    this.detailMeshes = [trimMesh, this.interiorMesh, this.underMesh];
    // exhaust tips
    this.exhausts = [];
    this.flameK = 0;
    const exParts = [];
    for (const sx of [-1, 1]) {
      const g = new THREE.CylinderGeometry(0.055, 0.065, 0.16, 10);
      g.rotateX(Math.PI / 2);
      g.translate(sx * 0.34, S.ride + 0.10, -meta.sil.halfLen - 0.02);
      exParts.push(g);
      this.exhausts.push(new THREE.Vector3(sx * 0.34, S.ride + 0.10, -meta.sil.halfLen - 0.02));
    }
    const exGeo = mergeGeometries(exParts, false);
    for (const g of exParts) g.dispose();
    const exMesh = new THREE.Mesh(exGeo, this.chromeMat());
    this.inner.add(exMesh);
    this.detailMeshes.push(exMesh);

    // ---- afterburner flames ------------------------------------------------
    // Additive cones with a baked white-hot -> orange -> transparent gradient
    // along their length. Boost has to be unmistakable in a still frame.
    this.flames = [];
    for (const e of this.exhausts) {
      const fg = new THREE.ConeGeometry(0.33, 1.95, 14, 5, true);
      fg.rotateX(-Math.PI / 2);
      fg.translate(0, 0, -1.00);
      const cnt = fg.attributes.position.count;
      const cols = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) {
        const z = fg.attributes.position.getZ(i);
        const t = clamp((-z - 0.05) / 1.65, 0, 1);            // 0 at the tip pipe
        const fade = (1 - t) * (1 - t);
        // hot blue-white core at the pipe, fading to deep orange at the tail
        cols[i * 3] = 0.55 + fade * 2.30;
        cols[i * 3 + 1] = 0.16 + fade * 1.45;
        cols[i * 3 + 2] = 0.04 + fade * fade * 1.55;
      }
      fg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      const fm = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        toneMapped: false,
      });
      const fmesh = new THREE.Mesh(fg, fm);
      fmesh.position.copy(e);
      fmesh.visible = false;
      fmesh.frustumCulled = false;
      this.inner.add(fmesh);
      this.flames.push(fmesh);
    }
    // Only the hero carries a real boost light. Every light that can appear or
    // disappear changes the scene's light counts, and three.js recompiles EVERY
    // material in the scene when that happens -- that alone was multiplying the
    // program count by 3-4x during play. This one is permanent and idles at
    // zero intensity.
    if (this.isPlayer) {
      this.boostLight = new THREE.PointLight(0xff7a24, 0, 14, 2);
      this.boostLight.position.set(0, S.ride + 0.14, -meta.sil.halfLen - 0.5);
      this.boostLight.visible = true;
      this.inner.add(this.boostLight);
    }
    // grille
    const grille = new THREE.Mesh(new THREE.BoxGeometry(S.width * 0.55, 0.16, 0.08), new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.5, metalness: 0.7 }));
    grille.position.set(0, S.nose * 0.72, hl * 0.985);
    this.inner.add(grille);
    this.detailMeshes.push(grille);

    // ---------------- lights
    this.buildLights(S, hl);
    // ---------------- wheels
    this.buildWheels(S);
  }

  darkTrim() {
    if (!this._trim) {
      this._trim = new THREE.MeshStandardMaterial({ color: 0x121317, roughness: 0.62, metalness: 0.22, envMapIntensity: 0.30 });
    }
    return this._trim;
  }
  chromeMat() {
    if (!this._chrome) {
      this._chrome = new THREE.MeshStandardMaterial({ color: 0x8f959d, roughness: 0.24, metalness: 0.95, envMapIntensity: 0.55 });
    }
    return this._chrome;
  }

  buildLights(S, hl) {
    // Bounded emissive (below the bloom threshold) instead of an unbounded
    // MeshBasicMaterial white orb -- only the small glow sprite is allowed to
    // exceed the bloom threshold.
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x08080a, emissive: 0xffe9c4, emissiveIntensity: 2.4,
      roughness: 0.25, metalness: 0.0, toneMapped: false,
    });
    const tailMat = new THREE.MeshStandardMaterial({
      color: 0x120202, emissive: 0xff1e12, emissiveIntensity: 3.4,
      roughness: 0.3, metalness: 0.0, toneMapped: false,
    });
    this.headMat = headMat; this.tailMat = tailMat;

    this.headlightPos = [];
    const headParts = [];
    for (const sx of [-1, 1]) {
      const g = new THREE.PlaneGeometry(0.42, 0.13);
      g.rotateY(sx * -0.12);
      g.translate(sx * S.width * 0.34, S.nose + 0.16, hl * 0.965);
      headParts.push(g);
      this.headlightPos.push(new THREE.Vector3(sx * S.width * 0.34, S.nose + 0.16, hl * 0.965));
    }
    const headGeo = mergeGeometries(headParts, false);
    for (const g of headParts) g.dispose();
    this.inner.add(new THREE.Mesh(headGeo, headMat));
    // tail light bar
    // The chase camera looks at this bar for the whole race, so it has to be
    // a readable light signature, not a 9cm hairline that vanishes past 6m.
    const tg = new THREE.PlaneGeometry(S.width * 0.86, 0.16);
    this.tailBar = new THREE.Mesh(tg, tailMat);
    this.tailBar.position.set(0, S.tail + 0.14, -hl * 0.975);
    this.tailBar.rotation.y = Math.PI;
    this.inner.add(this.tailBar);
    // brake light blocks
    this.brakeMat = new THREE.MeshStandardMaterial({
      color: 0x120202, emissive: 0xff2008, emissiveIntensity: 0.25,
      roughness: 0.3, metalness: 0.0, toneMapped: false,
    });
    const brakeParts = [];
    for (const sx of [-1, 1]) {
      const g = new THREE.PlaneGeometry(0.32, 0.11);
      g.rotateY(Math.PI);
      g.translate(sx * S.width * 0.32, S.tail + 0.02, -hl * 0.978);
      brakeParts.push(g);
    }
    const brakeGeo = mergeGeometries(brakeParts, false);
    for (const g of brakeParts) g.dispose();
    this.inner.add(new THREE.Mesh(brakeGeo, this.brakeMat));

    // additive glow sprites for the lamps
    const gg = new THREE.PlaneGeometry(1, 1);
    // One additive quad batch carries both lamp colours through instanceColor;
    // two separate InstancedMeshes were two draw calls per car for four quads.
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTex(), color: 0xffffff, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 1,
    });
    this.lampGlow = new THREE.InstancedMesh(gg, glowMat, 4);
    this.lampGlow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(12), 3);
    this.lampGlow.frustumCulled = false;
    this.lampGlow.renderOrder = 8;
    this.game.scene.add(this.lampGlow);
    // Proxies so the per-frame lamp update can keep addressing head/tail
    // independently while writing into one shared batch.
    const mkProxy = (base, r, g2, b, mul) => ({
      base, tint: [r, g2, b], mul, mesh: this.lampGlow,
      setMatrixAt: (i, m) => this.lampGlow.setMatrixAt(base + i, m),
      setOpacity: (i, o) => this.lampGlow.instanceColor.setXYZ(base + i, r * o * mul, g2 * o * mul, b * o * mul),
    });
    this.headGlow = mkProxy(0, 1.0, 0.94, 0.846, 0.13);
    this.tailGlow = mkProxy(2, 1.0, 0.165, 0.070, 0.22);
    this.tailGlowPos = [
      new THREE.Vector3(-S.width * 0.32, S.tail + 0.10, -hl * 0.99),
      new THREE.Vector3(S.width * 0.32, S.tail + 0.10, -hl * 0.99),
    ];

    // volumetric-ish head light beams
    if (this.isPlayer || this.game.quality.beams) {
      this.beams = [];
      for (const sx of [-1, 1]) {
        const len = 21, rad = 2.5;
        const cone = new THREE.ConeGeometry(rad, len, 18, 1, true);
        cone.translate(0, -len / 2, 0);
        cone.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(cone, BEAM_MAT());
        mesh.position.set(sx * S.width * 0.30, S.nose + 0.16, hl * 0.9 + len / 2);
        mesh.renderOrder = 7;
        mesh.frustumCulled = false;
        this.inner.add(mesh);
        this.beams.push(mesh);
      }
    }
    // real spotlights for the player only (PBR response on the wet road)
    if (this.isPlayer) {
      this.spot = new THREE.SpotLight(0xfff0dd, 62, 70, 0.44, 0.62, 1.7);
      this.spot.position.set(0, S.nose + 0.2, hl * 0.9);
      this.spot.target.position.set(0, -0.4, hl + 30);
      this.inner.add(this.spot, this.spot.target);
      this.spot.castShadow = false;
    }
    // ground pool of light in front of the car (wet road reflection)
    const poolMat = new THREE.MeshBasicMaterial({
      map: TX.makeSpriteGlow(256, 2.2), color: new THREE.Color(0xffeccc).multiplyScalar(0.055),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 12), poolMat);
    this.pool.renderOrder = 3;
    this.pool.frustumCulled = false;
    this.game.scene.add(this.pool);
  }

  buildWheels(S) {
    const parts = buildWheelGeometry(S.wheelR, S.wheelW);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x141519, roughness: 0.92, metalness: 0.0, envMapIntensity: 0.35 });
    // Rim, brake disc and caliper are one welded hub with per-vertex tinting.
    // Three separate InstancedMeshes cost three draw calls per car in both the
    // colour and the shadow pass, which is most of a six-car field's budget.
    const tint = (src, r, gr, b, hot) => {
      const g = src.index ? src.toNonIndexed() : src;
      if (!g.attributes.uv) {
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      }
      if (!g.attributes.normal) g.computeVertexNormals();
      const n = g.attributes.position.count;
      const c = new Float32Array(n * 3);
      const h = new Float32Array(n);
      for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gr; c[i * 3 + 2] = b; h[i] = hot; }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      g.setAttribute('aHot', new THREE.BufferAttribute(h, 1));
      return g;
    };
    const hubGeo = mergeGeometries([
      tint(parts.rim, 0.052, 0.058, 0.070, 0),
      tint(parts.disc, 0.020, 0.021, 0.024, 1),
      tint(parts.caliper, 0.176, 0.030, 0.014, 0),
    ], false);
    const hubMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.44, metalness: 0.62,
      envMapIntensity: 0.20, emissive: 0xff2200, emissiveIntensity: 0,
    });
    // Emissive is a material-wide uniform, so a welded hub would glow across
    // rim and caliper too. aHot masks the brake-heat glow to the disc faces.
    hubMat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute float aHot;\nvarying float vHot;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vHot = aHot;');
      sh.fragmentShader = 'varying float vHot;\n' + sh.fragmentShader
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vHot;');
    };
    this.discMat = hubMat;
    this.wheelMeshes = {
      tyre: new THREE.InstancedMesh(parts.tyre, tyreMat, 4),
      rim: new THREE.InstancedMesh(hubGeo, hubMat, 4),
    };
    const wsphere = new THREE.Sphere(new THREE.Vector3(0, 0.4, 0), S.wheelbase * 0.75 + 1.4);
    for (const k in this.wheelMeshes) {
      const m = this.wheelMeshes[k];
      m.geometry.boundingSphere = wsphere;
      m.frustumCulled = true;
      m.castShadow = k === 'tyre';
      // Parented to the car group (NOT the scene): as a scene child any
      // update-order mismatch shows up as wheels visibly detaching from the
      // arches. Matrices are still authored in car-local space.
      this.group.add(m);
    }
    this.wheelDetached = [false, false, false, false];
  }

  setEnvironment(env) {
    const apply = (m) => { if (m && m.isMeshStandardMaterial) { m.envMap = env; m.needsUpdate = true; } };
    this.inner.traverse((o) => { if (o.material) apply(o.material); });
    for (const k in this.wheelMeshes) apply(this.wheelMeshes[k].material);
  }

  // -------------------------------------------------------------- damage
  onWall(impact, point, normal) {
    const g = this.game;
    if (impact < 0) {
      // grinding along the wall
      if (Math.random() < 0.7) {
        g.vfx.sparkBurst(point, 3, _v.copy(normal).multiplyScalar(-1), 0.5, 9);
      }
      if (this.isPlayer) g.audio.scrape(clamp(this.veh.speed / 60, 0, 1));
      return;
    }
    const energy = clamp(impact / 26, 0, 1);
    this.applyImpact(point, _v.copy(normal).multiplyScalar(-1), energy * 1.15, impact, 'wall');
  }

  applyImpact(worldPoint, worldDir, energy, rawSpeed, source) {
    const g = this.game;
    const now = g.time;
    if (energy < 0.04) return;
    // Arcade rule: a barrier is something you scrape and keep going. Continuous
    // contact used to re-enter this function every frame, so holding a steering
    // key into a wall ticked damage, hit-stop and shake at 60Hz and killed the
    // run. Repeat wall contact inside the refractory window is free.
    const sinceHit = now - (this.lastImpactTime ?? -99);
    if (source === 'wall') {
      if (sinceHit < 0.30) return 0;
      energy *= 0.55;
    }
    worldImpactToLocal(this.veh.body, worldPoint, worldDir, _lp, _ld);
    _lp.y += this.veh.cfg.comHeight;
    const rad = 0.7 + energy * 1.1;
    this.deformer.impact(_lp, _ld, energy * 1.25, rad);
    // panels take damage and can rip off
    for (const p of this.panels) {
      if (!p.attached) continue;
      const d = p.base.distanceTo(_lp);
      if (d < rad * 1.5 + 0.5) {
        p.damage = (p.damage || 0) + energy * (1.2 - d / (rad * 2));
        // Cap it: a car that has shed every panel is a smooth featureless pod,
        // which reads as less damaged than one still wearing a buckled bonnet.
        if (p.damage > 0.55 + Math.random() * 0.35 && this.detached.length < 4) {
          this.detachPanel(p, worldDir, rawSpeed);
        }
      }
    }
    const dmg = source === 'wall'
      ? (this.isPlayer ? 0.055 : 0.24)
      : (this.isPlayer ? 0.19 : 0.42);
    this.health = clamp(this.health - energy * dmg, 0, 1);
    this.lastImpactTime = now;

    // vfx
    const n = Math.floor(10 + energy * 60);
    g.vfx.sparkBurst(worldPoint, n, worldDir, 1.1, 12 + energy * 26);
    g.vfx.flashAt(worldPoint, 0.7 + energy * 1.05, 0.09, [2.1, 1.25, 0.52]);
    if (energy > 0.25) {
      g.vfx.glassBurst(worldPoint, Math.floor(6 + energy * 22), this.veh.body.vel);
      g.vfx.debrisBurst(worldPoint, Math.floor(2 + energy * 10), this.veh.body.vel);
      g.vfx.smokePuff(worldPoint, 3, this.veh.body.vel, 1.0, 0.22, 1.1);
      g.shockAt(worldPoint, 0.35 + energy * 0.5);
    }
    g.audio.crunch(energy, worldPoint, source === 'wall');
    if (this.isPlayer) g.impactShake(energy);
    g.hitStop(clamp(energy * 0.075, 0, 0.11));

    if (this.health <= 0.02 && !this.wrecked) this.wreck(worldDir, energy);
    return energy;
  }

  detachPanel(p, dir, speed) {
    p.attached = false;
    const world = new THREE.Vector3();
    p.mesh.getWorldPosition(world);
    const q = new THREE.Quaternion();
    p.mesh.getWorldQuaternion(q);
    this.inner.remove(p.mesh);
    this.game.scene.add(p.mesh);
    p.mesh.position.copy(world);
    p.mesh.quaternion.copy(q);
    const v = this.veh.body.vel.clone().multiplyScalar(0.86);
    v.addScaledVector(dir || _v.set(0, 1, 0), 2 + Math.min(7, speed * 0.30));
    v.y += 2.5 + Math.random() * 3.5;
    this.flyingPanels.push({
      mesh: p.mesh, v,
      w: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
      life: 6.5,
    });
    this.game.vfx.sparkBurst(world, 14, null, 1.2, 12);
    this.detached.push(p);
  }

  /**
   * Rip a wheel off as an independent rigid body. The instanced wheel is
   * zero-scaled and replaced with a real merged tyre+rim mesh that tumbles,
   * bounces and rolls away on its own.
   */
  detachWheel(i, dir, speed = 14) {
    if (this.wheelDetached[i]) return;
    this.wheelDetached[i] = true;
    const w = this.veh.wheels[i];
    const world = new THREE.Vector3();
    this.veh.body.localToWorld(_v.copy(w.local), world);
    const mesh = new THREE.Mesh(this._looseWheelGeo(), this.wheelMeshes.tyre.material);
    mesh.castShadow = true;
    mesh.position.copy(world);
    mesh.quaternion.copy(this.veh.body.quat);
    this.game.scene.add(mesh);
    const v = this.veh.body.vel.clone().multiplyScalar(0.7);
    v.addScaledVector(dir || _v2.set(0, 1, 0), 2 + Math.min(10, speed * 0.3));
    v.y += 4 + Math.random() * 5;
    this.flyingPanels.push({
      mesh, v,
      w: new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 20),
      life: 8,
    });
    this.detached.push({ wheel: i });
  }

  _looseWheelGeo() {
    if (!this._wheelLooseGeo) {
      // tyre + rim can carry different attribute sets; normalise before merging
      const parts = [];
      for (const k of ['tyre', 'rim']) {
        const src = this.wheelMeshes[k].geometry;
        const g = new THREE.BufferGeometry();
        for (const a of ['position', 'normal', 'uv']) {
          if (src.getAttribute(a)) g.setAttribute(a, src.getAttribute(a).clone());
        }
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        if (!g.getAttribute('uv')) {
          const n = g.getAttribute('position').count;
          g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
        }
        parts.push(src.index ? g.setIndex(src.index.clone()) : g.toNonIndexed());
      }
      const nonIdx = parts.map((g) => (g.index ? g.toNonIndexed() : g));
      this._wheelLooseGeo = mergeGeometries(nonIdx, false) || nonIdx[0];
    }
    return this._wheelLooseGeo;
  }

  wreck(dir, energy = 1) {
    if (this.wrecked) return;
    this.wrecked = true;
    this.veh.wrecked = true;
    this.wreckTime = this.game.time;
    this.deformer.crush(0.44);
    const p = this.veh.body.pos;
    const c = this.paint.color;
    this.game.vfx.explosion(p, this.veh.body.vel, 1.0, [c.r, c.g, c.b]);
    this.game.audio.explosion(p);
    // launch it
    const b = this.veh.body;
    // Burnout barrel-rolls cars along the tarmac; it does not fire them 6m
    // straight up. Keep the launch low and put the energy into roll instead.
    b.vel.y += 3.4 + energy * 2.2;
    b.ang.add(_v.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 6, 7 + Math.random() * 7));
    // Shed panels for real: at least two body panels and one wheel always come
    // off, so a wreck is unmistakably a wreck from any camera angle.
    // Shed panels for real, but keep the car legible: Burnout throws a bonnet
    // and a bumper, it does not disassemble the car into coloured planks.
    const order = ['hood', 'bumperF', 'boot', 'bumperR', 'doorR', 'doorL'];
    const shed = this.panels.filter(p => p.attached)
      .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    const nShed = Math.max(0, Math.min(energy > 0.8 ? 3 : 2, 4 - this.detached.length));
    for (let i = 0; i < Math.min(nShed, shed.length); i++) {
      this.detachPanel(shed[i], dir || _v2.set(0, 1, 0), 11);
    }
    const wi = Math.floor(Math.random() * 4);
    this.detachWheel(wi, dir || _v2.set(0, 1, 0), 18);
    this.glassMesh.visible = false;
    this.game.vfx.glassBurst(p, 34, b.vel);
    this.game.onCarWrecked(this);
  }

  repair() {
    if (this.game.releaseWreckLight) this.game.releaseWreckLight(this);
    for (let i = 0; i < 4; i++) this.wheelDetached[i] = false;
    this.detached.length = 0;
    this.deformer.reset();
    this.health = 1;
    this.wrecked = false;
    this.veh.wrecked = false;
    this.glassMesh.visible = true;
    for (const p of this.panels) {
      if (!p.attached) {
        const idx = this.flyingPanels.findIndex((f) => f.mesh === p.mesh);
        if (idx >= 0) this.flyingPanels.splice(idx, 1);
        this.game.scene.remove(p.mesh);
        this.inner.add(p.mesh);
        p.mesh.position.copy(p.base);
        p.mesh.quaternion.identity();
        p.attached = true;
        p.damage = 0;
      }
    }
  }

  // -------------------------------------------------------------- update
  update(dt) {
    const veh = this.veh;
    const b = veh.body;
    this.group.position.copy(b.pos);
    this.group.quaternion.copy(b.quat);
    this.deformer.flush();

    // wheels
    const S = CAR_STYLES[this.styleName];
    const up = veh.up.clone();
    for (let i = 0; i < 4; i++) {
      const w = veh.wheels[i];
      const t = w.contact ? (veh.cfg.restLen + veh.cfg.wheelR - w.compression) : veh.cfg.restLen + veh.cfg.wheelR;
      // Wheel matrices are authored in CAR-LOCAL space; the InstancedMeshes are
      // children of this.group so they inherit the body transform for free and
      // can never lag behind it by a frame.
      _v.copy(w.local);
      _v.y -= (t - veh.cfg.wheelR);
      const steer = w.front ? veh.steerAngle : 0;
      _qs.setFromAxisAngle(_YAXIS, steer);
      _qsp.setFromAxisAngle(_XAXIS, -w.spin);
      _q.copy(_qs).multiply(_qsp);
      const side = (i % 2 === 0) ? -1 : 1;
      _s.set(side, 1, 1);
      _m.compose(_v, _q, _s);
      if (this.wheelDetached[i]) _m.makeScale(0, 0, 0);
      this.wheelMeshes.tyre.setMatrixAt(i, _m);
      this.wheelMeshes.rim.setMatrixAt(i, _m);

      // skid marks + tyre smoke
      if (w.contact && w.skid > 0.18 && !this.wrecked) {
        const cp = w.contactPoint;
        const rr = veh.right;
        this.game.vfx.skids.add(`${this.id}_${i}`, cp, rr, 0.17, clamp(w.skid * 1.1, 0, 0.9));
        if (Math.random() < w.skid * 0.55) {
          this.game.vfx.tyreSmoke(cp, 1, b.vel, clamp(w.skid, 0, 1));
        }
      } else {
        this.game.vfx.skids.stop(`${this.id}_${i}`);
      }
      if (w.contact && this.game.wetness > 0.3 && veh.speed > 14 && Math.random() < 0.35) {
        this.game.vfx.waterSpray(w.contactPoint, 1, b.vel);
      }
    }
    for (const k in this.wheelMeshes) this.wheelMeshes[k].instanceMatrix.needsUpdate = true;

    // brake glow
    const braking = veh.input.brake > 0.1 || veh.input.handbrake > 0.1;
    this.brakeHeat = clamp(this.brakeHeat + (braking && veh.speed > 12 ? dt * 1.4 : -dt * 0.45), 0, 1);
    this.discMat.emissiveIntensity = Math.pow(this.brakeHeat, 1.6) * 3.2;
    this.brakeMat.emissiveIntensity = braking ? 3.4 : 0.22;
    this.tailMat.color.setRGB(braking ? 3.0 : 1.05, braking ? 0.07 : 0.045, 0.035);

    // light glows
    const camPos = this.game.camera.position;
    let n = 0;
    for (const lp of this.headlightPos) {
      _v.copy(lp).applyMatrix4(this.inner.matrixWorld);
      _v2.subVectors(camPos, _v).normalize();
      _q.setFromUnitVectors(_ZAXIS, _v2);
      const sc = clamp(0.20 + veh.speed * 0.0009, 0.18, 0.40);
      _s.set(sc, sc, sc);
      _m.compose(_v, _q, _s);
      this.headGlow.setMatrixAt(n, _m);
      this.headGlow.setOpacity(n, this.beamsOn === false ? 0.25 : 1);
      n++;
    }
    n = 0;
    for (const lp of this.tailGlowPos) {
      _v.copy(lp).applyMatrix4(this.inner.matrixWorld);
      _v2.subVectors(camPos, _v).normalize();
      _q.setFromUnitVectors(_ZAXIS, _v2);
      const sc = braking ? 0.62 : 0.34;
      _s.set(sc, sc, sc);
      _m.compose(_v, _q, _s);
      this.tailGlow.setMatrixAt(n, _m);
      this.tailGlow.setOpacity(n, braking ? 2.7 : 1.0);
      n++;
    }
    this.lampGlow.instanceMatrix.needsUpdate = true;
    this.lampGlow.instanceColor.needsUpdate = true;

    // detail LOD: trim, interior, exhausts and grille are sub-pixel past ~55 m,
    // so drop four draw calls per distant car.
    if (this.detailMeshes) {
      const near = this.isPlayer || b.pos.distanceToSquared(camPos) < 55 * 55;
      if (near !== this._detailOn) {
        this._detailOn = near;
        for (const m of this.detailMeshes) if (m) m.visible = near;
      }
    }
    // headlight beams: kill them when the camera is in front of the car (crash
    // cam / cinematic) so the cone does not wash the whole frame out
    if (this.beams) {
      _v.subVectors(camPos, b.pos).normalize();
      const facing = _v.dot(veh.forward);
      const vis = clamp(1.0 - Math.max(0, facing - 0.05) * 2.4, 0, 1);
      // A visible light cone in full daylight reads as a bug, not as lighting:
      // it only opens up inside tunnels and under the crash-cam grade.
      const dark = this.game.world.inTunnel(veh.trackS) ? 1.0 : 0.16;
      for (const bm of this.beams) {
        bm.visible = vis > 0.03 && !this.wrecked && this.beamsAllowed !== false && dark > 0.2;
        bm.material.uniforms.uIntensity.value = vis * dark;
      }
    }

    // headlight ground pool
    if (this.pool) {
      // align the pool with the road plane (not world-flat) so it never slices
      // through banked or climbing sections and shows a hard rectangular edge
      const fr = this.game.track.frameAt(veh.trackS + 8.5, _poolFrame);
      _v.copy(fr.pos).addScaledVector(fr.right, veh.trackU * 0.85).addScaledVector(fr.up, 0.09);
      this.pool.position.copy(_v);
      _basis.makeBasis(fr.right, _v2.crossVectors(fr.up, fr.right).normalize(), fr.up);
      this.pool.quaternion.setFromRotationMatrix(_basis);
      // The ground light pool is a tunnel/night-only cheat. In daylight it was
      // painting a hard white blob over the whole front of the car.
      const tun = this.game.world.inTunnel(veh.trackS);
      this.pool.visible = !this.wrecked && tun;
      this.pool.material.opacity = tun ? 1 : 0;
    }

    // engine damage smoke / fire. Emission is rate-based, not per-frame: at
    // 1-2 fps a `Math.random() < 0.7` gate emits once a second and a burning
    // wreck has no fire in it at all.
    this._emitAcc = (this._emitAcc || 0) + dt;
    const emit = (rate) => {
      const n = rate * dt;
      return Math.floor(n) + (Math.random() < (n % 1) ? 1 : 0);
    };
    if (this.health < 0.55 && !this.wrecked) {
      const k = emit((0.55 - this.health) * 26);
      if (k) {
        _v.copy(b.pos).addScaledVector(veh.forward, S.len * 0.34).addScaledVector(veh.up, 0.4);
        this.game.vfx.smokePuff(_v, k, b.vel, 0.7, 0.09, 1.3);
        if (this.health < 0.25) this.game.vfx.fireBurst(_v, emit(9), 0.5);
      }
    }
    if (this.wrecked) {
      const age = this.game.time - this.wreckTime;
      _v.copy(b.pos).addScaledVector(veh.up, 0.5);
      // A burning wreck has to light itself, otherwise a takedown is a dark
      // slab on a dark road no matter how good the particles are. The light is
      // borrowed from a fixed game-wide pool: adding one per wreck changed the
      // scene light count and forced a full material recompile mid-crash.
      const wl = this.game.claimWreckLight(this, age);
      if (wl) {
        wl.position.copy(b.pos); wl.position.y += 0.9;
        const flick = 0.72 + Math.sin(this.game.time * 27.3) * 0.16 + Math.sin(this.game.time * 11.1) * 0.12;
        wl.intensity = (age < 4.5 ? 260 : 90) * flick;
      }
      if (age < 4.5) {
        this.game.vfx.fireBurst(_v, emit(34), 0.95);
        this.game.vfx.smokePuff(_v, emit(20), b.vel, 1.7, 0.10, 2.6);
        if (age < 2.4) this.game.vfx.sparkBurst(_v, emit(40), null, 1.0, 9);
      } else {
        this.game.vfx.smokePuff(_v, emit(11), b.vel, 1.5, 0.13, 2.8);
        this.game.vfx.fireBurst(_v, emit(5), 0.6);
      }
    }

    // boost flames from the exhausts
    if (this.boostActive && !this.wrecked) {
      for (const e of this.exhausts) {
        _v.copy(e).applyMatrix4(this.inner.matrixWorld);
        if (Math.random() < 0.55) this.game.vfx.fireBurst(_v, 1, 0.50);
        if (Math.random() < 0.5) this.game.vfx.sparkBurst(_v, 4, _v2.copy(veh.forward).negate(), 0.35, 18, [1.0, 0.66, 0.24]);
        if (Math.random() < 0.35) this.game.vfx.smokePuff(_v, 1, veh.body.vel, 0.7, 0.10, 0.55);
      }
    }

    if (this.spot) {
      // intensity, never `visible`: hiding a light changes the scene light
      // counts and forces three.js to recompile every material.
      this.spot.intensity = this.wrecked ? 0 : (this.game.world.inTunnel(veh.trackS) ? 170 : 26);
    }

    // afterburner cones -- the readable, silhouette-level boost tell
    if (this.flames) {
      const want = (this.boostActive && !this.wrecked) ? 1 : 0;
      this.flameK += (want - this.flameK) * Math.min(1, dt * (want ? 16 : 7));
      const k = this.flameK;
      const on = k > 0.02;
      for (let i = 0; i < this.flames.length; i++) {
        const f = this.flames[i];
        f.visible = on;
        if (!on) continue;
        const flick = 0.82 + Math.sin(this.game.realTime * (44 + i * 9)) * 0.18 + Math.random() * 0.20;
        f.scale.set(k * flick * 1.15, k * flick * 1.15, k * flick * (1.7 + this.game.boost * 1.6));
        f.material.opacity = 0.72 + k * 0.28;
      }
      if (this.boostLight) {
        this.boostLight.intensity = k * 70;
      }
    }

    // flying panels
    for (let i = this.flyingPanels.length - 1; i >= 0; i--) {
      const f = this.flyingPanels[i];
      f.life -= dt;
      if (f.life <= 0) { this.game.scene.remove(f.mesh); this.flyingPanels.splice(i, 1); continue; }
      f.v.y -= 21 * dt;
      f.v.multiplyScalar(Math.exp(-0.5 * dt));
      f.mesh.position.addScaledVector(f.v, dt);
      const surf = this.game.track.surface(f.mesh.position.x, f.mesh.position.z, veh.hint);
      if (f.mesh.position.y < surf.y + 0.12) {
        f.mesh.position.y = surf.y + 0.12;
        if (f.v.y < 0) {
          f.v.y = -f.v.y * 0.34;
          if (Math.abs(f.v.y) > 2) this.game.vfx.sparkBurst(f.mesh.position, 5, null, 1, 6);
        }
        f.v.x *= 0.86; f.v.z *= 0.86;
        f.w.multiplyScalar(0.86);
      }
      _q.set(f.w.x * dt * 0.5, f.w.y * dt * 0.5, f.w.z * dt * 0.5, 0).multiply(f.mesh.quaternion);
      f.mesh.quaternion.x += _q.x; f.mesh.quaternion.y += _q.y;
      f.mesh.quaternion.z += _q.z; f.mesh.quaternion.w += _q.w;
      f.mesh.quaternion.normalize();
      // A car-sized panel tumbling 1m from the lens blacks out the whole
      // replay. Shrink it away as it approaches the near field instead.
      const cd = f.mesh.position.distanceTo(this.game.camera.position);
      if (cd < 3.4) {
        const k = clamp((cd - 1.5) / 1.9, 0, 1);
        f.mesh.scale.setScalar(k);
        f.mesh.visible = k > 0.03;
      } else if (f.mesh.scale.x !== 1) {
        f.mesh.scale.setScalar(1);
        f.mesh.visible = true;
      }
    }

    // paint dulls with damage
    this.paint.roughness = 0.20 + (1 - this.health) * 0.42;
    this.paint.clearcoat = 1 - (1 - this.health) * 0.7;
  }

  dispose() {
    this.game.scene.remove(this.group, this.lampGlow, this.pool);

  }
}

const _ZAXIS = new THREE.Vector3(0, 0, 1);
const _basis = new THREE.Matrix4();
const _poolFrame = {
  pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(),
  up: new THREE.Vector3(), curv: 0, bank: 0, kind: 'open',
};
