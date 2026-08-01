// Particle & effect systems: sparks, smoke, fire, glass, debris, skid marks,
// shockwaves, speed lines, tyre spray.
import * as THREE from 'three';
import { clamp } from './rng.js';
import * as TX from './textures.js';

const BILLBOARD_VS = `
  attribute vec3 aPos;
  attribute vec4 aData;   // x = width, y = height, z = rotation, w = alpha
  attribute vec3 aColor;
  #ifdef STRETCH
  attribute vec3 aVel;
  #endif
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vUv = uv;
    vColor = aColor;
    vAlpha = aData.w;
    vec3 world;
    #ifdef STRETCH
      float L = length(aVel);
      vec3 dir = L > 0.0001 ? aVel / L : vec3(0.0, 1.0, 0.0);
      vec3 toCam = normalize(cameraPosition - aPos);
      vec3 side = normalize(cross(dir, toCam));
      world = aPos + dir * (position.y * aData.y) + side * (position.x * aData.x);
    #else
      vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      float c = cos(aData.z), s = sin(aData.z);
      vec2 rp = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
      world = aPos + camRight * rp.x * aData.x + camUp * rp.y * aData.y;
    #endif
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const BILLBOARD_FS = `
  uniform sampler2D uMap;
  uniform float uIntensity;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float a = t.a * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor * uIntensity * t.rgb, a);
  }
`;

// A cheap chamfered box: bevelled edges catch a highlight so a tumbling chunk
// reads as sheet metal rather than a flat card.
function bevelBox(w, h, d, bev = 0.24) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  const pos = g.attributes.position;
  const hx = w * 0.5, hy = h * 0.5, hz = d * 0.5;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    pos.setXYZ(i, x * (1 - bev * 0.35), y, z * (1 - bev * 0.35));
  }
  const g2 = g.toNonIndexed();
  g2.computeVertexNormals();
  g.dispose();
  return g2;
}

const _v1 = new THREE.Vector3();
const _p1 = new THREE.Vector3();

class BillboardPool {
  constructor(scene, { count, map, blending, stretch = false, intensity = 1, depthWrite = false, renderOrder = 5 }) {
    this.count = count;
    this.alive = 0;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aData', this.aData);
    geo.setAttribute('aColor', this.aColor);
    if (stretch) {
      this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
      geo.setAttribute('aVel', this.aVel);
    }
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uIntensity: { value: intensity } },
      vertexShader: BILLBOARD_VS,
      fragmentShader: BILLBOARD_FS,
      defines: stretch ? { STRETCH: '' } : {},
      transparent: true,
      blending,
      depthWrite,
      depthTest: true,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
    this.geo = geo;
    // CPU state
    this.px = new Float32Array(count); this.py = new Float32Array(count); this.pz = new Float32Array(count);
    this.vx = new Float32Array(count); this.vy = new Float32Array(count); this.vz = new Float32Array(count);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.size0 = new Float32Array(count);
    this.size1 = new Float32Array(count);
    this.rot = new Float32Array(count);
    this.rotV = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.grav = new Float32Array(count);
    this.cr = new Float32Array(count); this.cg = new Float32Array(count); this.cb = new Float32Array(count);
    this.cr1 = new Float32Array(count); this.cg1 = new Float32Array(count); this.cb1 = new Float32Array(count);
    this.a0 = new Float32Array(count);
    this.cursor = 0;
    this.stretch = stretch;
    this.stretchScale = 0.05;
  }

  spawn(o) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.px[i] = o.x; this.py[i] = o.y; this.pz[i] = o.z;
    this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0; this.vz[i] = o.vz || 0;
    this.life[i] = o.life; this.maxLife[i] = o.life;
    this.size0[i] = o.size0; this.size1[i] = o.size1 ?? o.size0;
    this.rot[i] = o.rot ?? Math.random() * 6.28;
    this.rotV[i] = o.rotV ?? 0;
    this.drag[i] = o.drag ?? 0.6;
    this.grav[i] = o.grav ?? 0;
    this.cr[i] = o.r; this.cg[i] = o.g; this.cb[i] = o.b;
    this.cr1[i] = o.r1 ?? o.r; this.cg1[i] = o.g1 ?? o.g; this.cb1[i] = o.b1 ?? o.b;
    this.a0[i] = o.alpha ?? 1;
    return i;
  }

  update(dt) {
    const n = this.count;
    const pa = this.aPos.array, da = this.aData.array, ca = this.aColor.array;
    const va = this.aVel ? this.aVel.array : null;
    let live = 0;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= dr; this.vz[i] *= dr;
      this.vy[i] = this.vy[i] * dr + this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.rotV[i] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const size = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      const alpha = this.a0[i] * Math.pow(1 - t, 1.1) * clamp(t * 8, 0, 1);
      const o3 = live * 3, o4 = live * 4;
      pa[o3] = this.px[i]; pa[o3 + 1] = this.py[i]; pa[o3 + 2] = this.pz[i];
      da[o4] = size;
      da[o4 + 1] = this.stretch
        ? Math.max(size, Math.hypot(this.vx[i], this.vy[i], this.vz[i]) * this.stretchScale)
        : size;
      da[o4 + 2] = this.rot[i];
      da[o4 + 3] = alpha;
      ca[o3] = this.cr[i] + (this.cr1[i] - this.cr[i]) * t;
      ca[o3 + 1] = this.cg[i] + (this.cg1[i] - this.cg[i]) * t;
      ca[o3 + 2] = this.cb[i] + (this.cb1[i] - this.cb[i]) * t;
      if (va) { va[o3] = this.vx[i]; va[o3 + 1] = this.vy[i]; va[o3 + 2] = this.vz[i]; }
      live++;
    }
    this.alive = live;
    this.geo.instanceCount = live;
    this.aPos.needsUpdate = true;
    this.aData.needsUpdate = true;
    this.aColor.needsUpdate = true;
    if (this.aVel) this.aVel.needsUpdate = true;
  }
}

// -------------------------------------------------------------- debris
class DebrisSystem {
  constructor(scene, count, geo, mat) {
    this.count = count;
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
    scene.add(this.mesh);
    this.items = [];
    for (let i = 0; i < count; i++) {
      this.items.push({
        alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(),
        q: new THREE.Quaternion(), w: new THREE.Vector3(), life: 0, s: 1, ground: 0,
        sx: 1, sy: 1, sz: 1,
      });
    }
    this.cursor = 0;
    this._m = new THREE.Matrix4();
    this._s = new THREE.Vector3();
    this._dq = new THREE.Quaternion();
  }
  spawn(p, v, s, life, spin = 12, col = null) {
    const idx = this.cursor;
    const it = this.items[idx];
    this.cursor = (this.cursor + 1) % this.count;
    it.alive = true;
    it.p.copy(p); it.v.copy(v);
    it.q.set(Math.random(), Math.random(), Math.random(), Math.random()).normalize();
    it.w.set((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin);
    it.life = life; it.maxLife = life; it.s = s;
    it.sx = 0.80 + Math.random() * 0.5;
    it.sy = 0.80 + Math.random() * 0.5;
    it.sz = 0.80 + Math.random() * 0.5;
    it.col = col;
    return it;
  }
  update(dt, groundFn, camPos) {
    this.camPos = camPos;
    let n = 0;
    const m = this._m, s = this._s, dq = this._dq;
    for (const it of this.items) {
      if (!it.alive) continue;
      it.life -= dt;
      if (it.life <= 0) { it.alive = false; continue; }
      it.v.y -= 22 * dt;
      it.v.multiplyScalar(Math.exp(-0.35 * dt));
      it.p.addScaledVector(it.v, dt);
      const gy = groundFn ? groundFn(it.p.x, it.p.z) : 0;
      if (it.p.y < gy + it.s * 0.3) {
        it.p.y = gy + it.s * 0.3;
        if (it.v.y < 0) it.v.y = -it.v.y * 0.32;
        it.v.x *= 0.72; it.v.z *= 0.72;
        it.w.multiplyScalar(0.8);
      }
      dq.set(it.w.x * dt * 0.5, it.w.y * dt * 0.5, it.w.z * dt * 0.5, 0).multiply(it.q);
      it.q.x += dq.x; it.q.y += dq.y; it.q.z += dq.z; it.q.w += dq.w;
      it.q.normalize();
      const fade = clamp(it.life / Math.min(1.2, it.maxLife), 0, 1);
      let k = it.s * (0.42 + 0.58 * fade);
      if (this.camPos) {
        // near-field cull: chunks tumbling through the lens read as screen junk
        const cd = it.p.distanceTo(this.camPos);
        if (cd < 2.2) k *= clamp((cd - 0.9) / 1.3, 0, 1);
      }
      s.set(it.sx * k, it.sy * k, it.sz * k);
      m.compose(it.p, it.q, s);
      if (it.col) this.mesh.instanceColor.setXYZ(n, it.col[0], it.col[1], it.col[2]);
      else this.mesh.instanceColor.setXYZ(n, 1, 1, 1);
      this.mesh.setMatrixAt(n++, m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// -------------------------------------------------------------- skid marks
class SkidTrails {
  constructor(scene, maxQuads = 900) {
    this.max = maxQuads;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(maxQuads * 4 * 3);
    this.alpha = new Float32Array(maxQuads * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array(maxQuads * 6);
    for (let i = 0; i < maxQuads; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      uniforms: {},
      vertexShader: `attribute float aAlpha; varying float vA;
        void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA;
        void main(){ if (vA <= 0.002) discard; gl_FragColor = vec4(0.015,0.014,0.016, vA * 0.82); }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.geo = geo;
    this.head = 0;
    this.used = 0;
    this.last = new Map();
  }
  /** Add a quad segment between the previous and current contact point. */
  add(key, p, right, width, strength) {
    const prev = this.last.get(key);
    if (prev && prev.distanceToSquared(p) > 0.02 && prev.distanceToSquared(p) < 25) {
      const i = this.head;
      const o = i * 12;
      const a = this.pos;
      a[o] = prev.x - right.x * width; a[o + 1] = prev.y - right.y * width + 0.012; a[o + 2] = prev.z - right.z * width;
      a[o + 3] = prev.x + right.x * width; a[o + 4] = prev.y + right.y * width + 0.012; a[o + 5] = prev.z + right.z * width;
      a[o + 6] = p.x + right.x * width; a[o + 7] = p.y + right.y * width + 0.012; a[o + 8] = p.z + right.z * width;
      a[o + 9] = p.x - right.x * width; a[o + 10] = p.y - right.y * width + 0.012; a[o + 11] = p.z - right.z * width;
      const s = clamp(strength, 0, 1);
      for (let k = 0; k < 4; k++) this.alpha[i * 4 + k] = s;
      this.head = (this.head + 1) % this.max;
      this.used = Math.min(this.max, this.used + 1);
      this.geo.setDrawRange(0, this.used * 6);
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
      this.last.set(key, p.clone());
    } else if (!prev || prev.distanceToSquared(p) >= 25) {
      this.last.set(key, p.clone());
    }
  }
  stop(key) { this.last.delete(key); }
  fade(dt) {
    // slow global fade so marks persist but the buffer stays readable
    const a = this.alpha;
    const k = 1 - dt * 0.035;
    for (let i = 0; i < this.used * 4; i++) a[i] *= k;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

export class VFX {
  constructor(scene, quality) {
    this.scene = scene;
    this.q = quality;
    const glow = TX.makeSpriteGlow(64, 1.4);
    const smokeT = TX.makeSmokeSprite(quality.tier === 'low' ? 128 : 256);
    const streak = TX.makeStreakSprite(256, 64);
    this.tex = { glow, smokeT, streak };

    const s = quality.particleScale;
    this.sparks = new BillboardPool(scene, {
      count: Math.floor(900 * s), map: streak, blending: THREE.AdditiveBlending,
      stretch: true, intensity: 1.35, renderOrder: 7,
    });
    this.sparks.stretchScale = 0.018;
    this.smoke = new BillboardPool(scene, {
      count: Math.floor(420 * s), map: smokeT, blending: THREE.NormalBlending,
      intensity: 1.0, renderOrder: 4,
    });
    this.fire = new BillboardPool(scene, {
      count: Math.floor(260 * s), map: smokeT, blending: THREE.AdditiveBlending,
      intensity: 1.35, renderOrder: 6,
    });
    this.flash = new BillboardPool(scene, {
      count: Math.floor(120 * s), map: glow, blending: THREE.AdditiveBlending,
      intensity: 1.9, renderOrder: 8,
    });
    this.spray = new BillboardPool(scene, {
      count: Math.floor(320 * s), map: smokeT, blending: THREE.NormalBlending,
      intensity: 1.0, renderOrder: 4,
    });

    // Shards must read as glass grit, not floating windscreens. At radius
    // 0.16 with a 1.6x spawn scale these were 0.8m slabs that dominated the
    // frame and read as white paper.
    const glassGeo = new THREE.TetrahedronGeometry(0.062, 0);
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xa8ccea, vertexColors: true, metalness: 0.0, roughness: 0.06, transparent: true,
      opacity: 0.62, envMapIntensity: 0.30, clearcoat: 1, clearcoatRoughness: 0.05,
      side: THREE.DoubleSide, depthWrite: false,
    });
    this.glass = new DebrisSystem(scene, 620, glassGeo, glassMat);

    // Three distinct chunk silhouettes: a torn body panel, a mid chunk and a
    // small shard. Painted panels take the victim's body colour per instance.
    // Metalness stays low -- a 0.85-metal chunk under a bright sky PMREM is
    // just a mirror of the sky, i.e. a white paper square.
    const panelGeo = bevelBox(0.90, 0.05, 0.62);
    const chunkGeo = bevelBox(0.30, 0.13, 0.36);
    const shardGeo = bevelBox(0.11, 0.045, 0.15);
    const mkMat = (c, r) => new THREE.MeshStandardMaterial({
      color: c, vertexColors: true, metalness: 0.26, roughness: r, envMapIntensity: 0.95,
    });
    this.debrisPanel = new DebrisSystem(scene, 170, panelGeo, mkMat(0xffffff, 0.52));
    this.debrisChunk = new DebrisSystem(scene, 170, chunkGeo, mkMat(0xffffff, 0.70));
    this.debrisShard = new DebrisSystem(scene, 170, shardGeo, mkMat(0xffffff, 0.76));
    this.debrisAll = [this.debrisPanel, this.debrisChunk, this.debrisShard];
    this.debris = this.debrisChunk; // legacy alias

    this.skids = new SkidTrails(scene, quality.tier === 'low' ? 400 : 1100);
  }

  setEnvironment(env) {
    this.glass.mesh.material.envMap = env;
    for (const d of this.debrisAll) d.mesh.material.envMap = env;
  }

  // ------------------------------------------------------------ emitters
  sparkBurst(p, n, dir, spread = 1.0, speed = 14, tint = null) {
    const c = tint || [1.0, 0.72, 0.28];
    for (let i = 0; i < n; i++) {
      const vx = (Math.random() - 0.5) * spread * speed + (dir ? dir.x * speed * 0.8 : 0);
      const vy = Math.random() * speed * 0.55 + 1.5 + (dir ? dir.y * speed * 0.4 : 0);
      const vz = (Math.random() - 0.5) * spread * speed + (dir ? dir.z * speed * 0.8 : 0);
      this.sparks.spawn({
        x: p.x, y: p.y, z: p.z, vx, vy, vz,
        life: 0.25 + Math.random() * 0.6,
        size0: 0.035 + Math.random() * 0.05, size1: 0.012,
        drag: 1.1, grav: -16,
        r: c[0] * 2.6, g: c[1] * 1.7, b: c[2] * 0.7,
        r1: 1.3, g1: 0.20, b1: 0.04,
        alpha: 1,
      });
    }
  }

  smokePuff(p, n, vel, size = 1.4, dark = 0.35, life = 1.6) {
    for (let i = 0; i < n; i++) {
      this.smoke.spawn({
        x: p.x + (Math.random() - 0.5) * 0.6,
        y: p.y + Math.random() * 0.4,
        z: p.z + (Math.random() - 0.5) * 0.6,
        vx: (vel ? vel.x : 0) + (Math.random() - 0.5) * 2.4,
        vy: (vel ? vel.y : 0) + 0.8 + Math.random() * 1.6,
        vz: (vel ? vel.z : 0) + (Math.random() - 0.5) * 2.4,
        life: life * (0.7 + Math.random() * 0.7),
        size0: size * (0.6 + Math.random() * 0.5),
        size1: size * (2.6 + Math.random() * 1.6),
        drag: 0.85, grav: 0.5,
        rotV: (Math.random() - 0.5) * 1.4,
        r: dark, g: dark, b: dark * 1.06,
        r1: dark * 0.5, g1: dark * 0.5, b1: dark * 0.55,
        alpha: 0.55,
      });
    }
  }

  tyreSmoke(p, n, vel, strength) {
    for (let i = 0; i < n; i++) {
      this.smoke.spawn({
        x: p.x + (Math.random() - 0.5) * 0.5, y: p.y + 0.1, z: p.z + (Math.random() - 0.5) * 0.5,
        vx: (vel ? vel.x * 0.25 : 0) + (Math.random() - 0.5) * 2,
        vy: 1.2 + Math.random() * 1.4,
        vz: (vel ? vel.z * 0.25 : 0) + (Math.random() - 0.5) * 2,
        life: 0.9 + Math.random() * 0.9,
        size0: 0.6, size1: 2.4 + Math.random() * 1.4,
        drag: 1.0, grav: 0.6, rotV: (Math.random() - 0.5) * 1.2,
        r: 0.52, g: 0.52, b: 0.55, r1: 0.24, g1: 0.24, b1: 0.27,
        alpha: 0.20 * strength,
      });
    }
  }

  waterSpray(p, n, vel) {
    for (let i = 0; i < n; i++) {
      this.spray.spawn({
        x: p.x + (Math.random() - 0.5) * 0.7, y: p.y + 0.05, z: p.z + (Math.random() - 0.5) * 0.7,
        vx: -vel.x * 0.18 + (Math.random() - 0.5) * 3,
        vy: 1.6 + Math.random() * 2.4,
        vz: -vel.z * 0.18 + (Math.random() - 0.5) * 3,
        life: 0.3 + Math.random() * 0.3,
        size0: 0.12, size1: 0.95,
        drag: 2.4, grav: -3,
        r: 0.34, g: 0.39, b: 0.5, r1: 0.14, g1: 0.17, b1: 0.24,
        alpha: 0.12,
      });
    }
  }

  fireBurst(p, n, scale = 1) {
    for (let i = 0; i < n; i++) {
      this.fire.spawn({
        x: p.x + (Math.random() - 0.5) * 0.7 * scale,
        y: p.y + Math.random() * 0.5 * scale,
        z: p.z + (Math.random() - 0.5) * 0.7 * scale,
        vx: (Math.random() - 0.5) * 5 * scale,
        vy: 3 + Math.random() * 6 * scale,
        vz: (Math.random() - 0.5) * 5 * scale,
        life: 0.35 + Math.random() * 0.5,
        size0: 0.9 * scale, size1: 2.6 * scale,
        drag: 1.2, grav: 3.5,
        rotV: (Math.random() - 0.5) * 3,
        r: 1.45, g: 0.62, b: 0.15, r1: 0.55, g1: 0.08, b1: 0.015,
        alpha: 0.65,
      });
    }
  }

  flashAt(p, size = 6, life = 0.22, color = [1.8, 1.3, 0.7]) {
    this.flash.spawn({
      x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0,
      life, size0: size, size1: size * 1.9, drag: 0, grav: 0,
      r: color[0], g: color[1], b: color[2], alpha: 1,
    });
  }

  glassBurst(p, n, vel) {
    const v = _v1;
    for (let i = 0; i < n; i++) {
      v.set(
        (vel ? vel.x * 0.4 : 0) + (Math.random() - 0.5) * 13,
        2.5 + Math.random() * 9,
        (vel ? vel.z * 0.4 : 0) + (Math.random() - 0.5) * 13
      );
      _p1.set(p.x + (Math.random() - 0.5) * 1.4, p.y + Math.random() * 1.0, p.z + (Math.random() - 0.5) * 1.4);
      this.glass.spawn(_p1, v, 0.55 + Math.random() * 0.8, 2.6 + Math.random() * 2.0, 26);
    }
  }

  // n chunks distributed across the three debris geometries. `col` is the
  // victim's paint colour, applied to the torn panels only.
  debrisBurst(p, n, vel, col = null) {
    const v = _v1;
    // Torn panels keep a hint of the body colour but are pulled hard toward
    // bare, grimy metal -- a full-brightness body colour reads as white paper.
    // Every system gets an explicit instance colour: leaving instanceColor at
    // the material default (white) is exactly how debris became paper squares.
    const pc = col
      ? [0.24 + col[0] * 0.32, 0.245 + col[1] * 0.32, 0.262 + col[2] * 0.32]
      : [0.22, 0.222, 0.238];
    const mix = [
      [this.debrisPanel, 0.22, 1.0, pc],
      [this.debrisChunk, 0.46, 1.0, [0.300, 0.306, 0.325]],
      [this.debrisShard, 0.32, 1.35, [0.255, 0.262, 0.284]],
    ];
    let placed = 0;
    for (let m = 0; m < mix.length; m++) {
      const [sys, frac, speedK, c0] = mix[m];
      const cnt = m === mix.length - 1 ? Math.max(1, n - placed) : Math.max(1, Math.round(n * frac));
      placed += cnt;
      for (let i = 0; i < cnt; i++) {
        const sp = speedK;
        // per-piece tonal scatter so a burst never reads as one flat colour
        const k = 0.62 + Math.random() * 0.85;
        const c = [c0[0] * k, c0[1] * k, c0[2] * k];
        v.set(
          (vel ? vel.x * 0.5 : 0) + (Math.random() - 0.5) * 15 * sp,
          1.5 + Math.random() * 10 * sp,
          (vel ? vel.z * 0.5 : 0) + (Math.random() - 0.5) * 15 * sp
        );
        _p1.set(p.x + (Math.random() - 0.5) * 1.6, p.y + Math.random() * 1.2, p.z + (Math.random() - 0.5) * 1.6);
        sys.spawn(_p1, v, 0.30 + Math.random() * 0.46, 4.0 + Math.random() * 3.0, 18, c);
      }
    }
  }

  // A tall, slow, dark column that reads from a distance -- the silhouette
  // that tells you at a glance that something is wrecked over there.
  smokeColumn(p, n, height = 6) {
    for (let i = 0; i < n; i++) {
      const f = i / n;
      this.smoke.spawn({
        x: p.x + (Math.random() - 0.5) * (0.7 + f * 1.3),
        y: p.y + 0.3 + f * height * 0.8 + Math.random() * 0.4,
        z: p.z + (Math.random() - 0.5) * (0.7 + f * 1.3),
        vx: (Math.random() - 0.5) * 1.1,
        vy: 4.2 + Math.random() * 3.0 + f * 3.0,
        vz: (Math.random() - 0.5) * 1.1,
        life: 2.8 + Math.random() * 2.2,
        size0: 0.8 + Math.random() * 0.6, size1: 2.6 + Math.random() * 2.0,
        drag: 0.24, grav: 1.4,
        rotV: (Math.random() - 0.5) * 1.0,
        r: 0.12, g: 0.115, b: 0.12, r1: 0.05, g1: 0.05, b1: 0.06,
        alpha: 0.34,
      });
    }
  }

  explosion(p, vel, scale = 1, col = null) {
    const k = Math.max(1, scale);
    this.fireBurst(p, Math.round(34 * k), 1.2 * k);
    this.smokePuff(p, Math.round(26 * k), vel, 2.4 * k, 0.14, 2.8);
    this.smokeColumn(p, Math.round(34 * k), 7.5);
    this.sparkBurst(p, Math.round(230 * k), null, 1.5, 24);
    this.debrisBurst(p, Math.round(74 * k), vel, col);
    this.glassBurst(p, Math.round(96 * k), vel);
    this.flashAt(p, 1.35 * k, 0.11, [1.9, 1.15, 0.48]);
  }

  update(dt, groundFn, camPos) {
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.fire.update(dt);
    this.flash.update(dt);
    this.spray.update(dt);
    this.glass.update(dt, groundFn, camPos);
    for (const d of this.debrisAll) d.update(dt, groundFn, camPos);
    this.skids.fade(dt);
  }

  stats() {
    return this.sparks.alive + this.smoke.alive + this.fire.alive + this.spray.alive;
  }
}

export { BillboardPool, DebrisSystem, SkidTrails };
