// VFX: velocity-stretched sparks, smoke/dust points, skid ribbons, shockwave
// rings, contact shadows and wind streaks. All pooled, all instanced.
import * as THREE from 'three';
import { clamp, lerp } from './rng.js';

const V = new THREE.Vector3();
const V2 = new THREE.Vector3();
const V3 = new THREE.Vector3();
const M = new THREE.Matrix4();
const _M2 = new THREE.Matrix4();
const _camBasis = new THREE.Matrix4();
const _ringAlign = new THREE.Matrix4().makeRotationX(Math.PI / 2);
const Q = new THREE.Quaternion();

// ---------------------------------------------------------------- streaks
export class StreakSystem {
  constructor(scene, tex, max = 420) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    const colors = new Float32Array(max * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.grav = new Float32Array(max);
    this.n = 0;
  }
  emit(pos, dir, count, opts = {}) {
    const spread = opts.spread ?? 0.7;
    const speed = opts.speed ?? 14;
    const life = opts.life ?? 0.45;
    const size = opts.size ?? 0.06;
    const c = opts.color ?? [1.0, 0.72, 0.28];
    const grav = opts.gravity ?? 22;
    for (let k = 0; k < count; k++) {
      if (this.n >= this.max) this.n = 0;
      const i = this.n++;
      this.p[i * 3] = pos.x;
      this.p[i * 3 + 1] = pos.y;
      this.p[i * 3 + 2] = pos.z;
      const sp = speed * (0.35 + Math.random() * 1.0);
      this.v[i * 3] = (dir.x + (Math.random() - 0.5) * spread) * sp;
      this.v[i * 3 + 1] = (dir.y + (Math.random() - 0.5) * spread + 0.35) * sp;
      this.v[i * 3 + 2] = (dir.z + (Math.random() - 0.5) * spread) * sp;
      this.life[i] = this.maxLife[i] = life * (0.5 + Math.random());
      this.size[i] = size * (0.6 + Math.random() * 0.9);
      this.col[i * 3] = c[0];
      this.col[i * 3 + 1] = c[1];
      this.col[i * 3 + 2] = c[2];
      this.grav[i] = grav;
    }
  }
  update(dt, camPos) {
    let live = 0;
    const im = this.mesh.instanceMatrix.array;
    const ic = this.mesh.instanceColor.array;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      this.v[i * 3 + 1] -= this.grav[i] * dt;
      this.v[i * 3] *= 1 - dt * 1.2;
      this.v[i * 3 + 2] *= 1 - dt * 1.2;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      if (this.p[i * 3 + 1] < 0.02) {
        this.p[i * 3 + 1] = 0.02;
        this.v[i * 3 + 1] *= -0.32;
        this.v[i * 3] *= 0.6;
        this.v[i * 3 + 2] *= 0.6;
      }
      V.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
      V2.set(this.v[i * 3], this.v[i * 3 + 1], this.v[i * 3 + 2]);
      const sp = V2.length() || 1;
      V2.multiplyScalar(1 / sp);
      V3.copy(camPos).sub(V).normalize();
      const x = new THREE.Vector3().crossVectors(V2, V3);
      if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
      x.normalize();
      const z = new THREE.Vector3().crossVectors(x, V2);
      const t = this.life[i] / this.maxLife[i];
      const len = clamp(sp * 0.035, 0.08, 1.6) * (0.4 + t * 0.8);
      // A spark is a THIN streak. Letting an impact's requested size drive the
      // width unclamped turns a 0.30 m spark into a round blob at 2:1 aspect -
      // 24 of those stack into a mound of grey balls over the bike. Width is
      // therefore capped to a quarter of the stretched length.
      const wid = Math.min(this.size[i] * (0.35 + t * 0.9), len * 0.26);
      M.makeBasis(x.multiplyScalar(wid), V2.clone().multiplyScalar(len), z.normalize());
      M.setPosition(V);
      M.toArray(im, live * 16);
      const f = t * t;
      ic[live * 3] = this.col[i * 3] * (1.6 + f);
      ic[live * 3 + 1] = this.col[i * 3 + 1] * (0.9 + f * 1.4);
      ic[live * 3 + 2] = this.col[i * 3 + 2] * (0.5 + f * 1.6);
      live++;
      if (live >= this.max) break;
    }
    this.mesh.count = live;
    this.mesh.visible = live > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// ------------------------------------------------------------ soft points
const puffVert = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute float aRot;
varying float vAlpha;
varying float vRot;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vRot = aRot;
  vColor = color;
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min( 260.0, aSize * ( 320.0 / max( 1.2, -mv.z ) ) );
}`;
const puffFrag = /* glsl */ `
uniform sampler2D uMap;
uniform float uAdditive;
varying float vAlpha;
varying float vRot;
varying vec3 vColor;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float c = cos( vRot ), s = sin( vRot );
  uv = vec2( c * uv.x - s * uv.y, s * uv.x + c * uv.y ) + 0.5;
  vec4 t = texture2D( uMap, uv );
  float a = t.a * vAlpha;
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( vColor * t.rgb, a );
}`;

export class PuffSystem {
  constructor(scene, tex, max = 380, additive = false) {
    this.max = max;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.colA = new Float32Array(max * 3);
    this.sizeA = new Float32Array(max);
    this.alphaA = new Float32Array(max);
    this.rotA = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colA, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizeA, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaA, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aRot', new THREE.BufferAttribute(this.rotA, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex }, uAdditive: { value: additive ? 1 : 0 } },
      vertexShader: puffVert,
      fragmentShader: puffFrag,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
    this.geo = geo;
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.spin = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.n = 0;
  }
  emit(pos, vel, count, opts = {}) {
    const life = opts.life ?? 1.2;
    const size = opts.size ?? 0.8;
    const grow = opts.grow ?? 2.2;
    const jitter = opts.jitter ?? 0.6;
    const c0 = opts.color0 ?? [0.8, 0.8, 0.82];
    const c1 = opts.color1 ?? [0.35, 0.35, 0.38];
    const alpha = opts.alpha ?? 0.55;
    const spread = opts.spread ?? 0.4;
    for (let k = 0; k < count; k++) {
      if (this.n >= this.max) this.n = 0;
      const i = this.n++;
      this.pos[i * 3] = pos.x + (Math.random() - 0.5) * jitter;
      this.pos[i * 3 + 1] = pos.y + (Math.random() - 0.5) * jitter * 0.5;
      this.pos[i * 3 + 2] = pos.z + (Math.random() - 0.5) * jitter;
      this.v[i * 3] = vel.x + (Math.random() - 0.5) * spread * 6;
      this.v[i * 3 + 1] = vel.y + Math.random() * spread * 4;
      this.v[i * 3 + 2] = vel.z + (Math.random() - 0.5) * spread * 6;
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.8);
      this.baseSize[i] = size * (0.6 + Math.random() * 0.8);
      this.grow[i] = grow;
      this.a0[i] = alpha * (0.7 + Math.random() * 0.6);
      this.spin[i] = (Math.random() - 0.5) * 1.6;
      this.rotA[i] = Math.random() * 6.28;
      for (let j = 0; j < 3; j++) {
        this.c0[i * 3 + j] = c0[j];
        this.c1[i * 3 + j] = c1[j];
      }
    }
  }
  update(dt) {
    let count = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alphaA[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = clamp(this.life[i] / this.maxLife[i], 0, 1);
      if (this.life[i] <= 0) {
        this.alphaA[i] = 0;
        continue;
      }
      this.v[i * 3] *= 1 - dt * 1.4;
      this.v[i * 3 + 1] = this.v[i * 3 + 1] * (1 - dt * 0.7) + dt * 1.3;
      this.v[i * 3 + 2] *= 1 - dt * 1.4;
      this.pos[i * 3] += this.v[i * 3] * dt;
      this.pos[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      const age = 1 - t;
      this.sizeA[i] = this.baseSize[i] * (0.5 + age * this.grow[i]);
      this.alphaA[i] = this.a0[i] * Math.pow(t, 0.75) * clamp(age * 6, 0, 1);
      this.rotA[i] += this.spin[i] * dt;
      for (let j = 0; j < 3; j++) this.colA[i * 3 + j] = lerp(this.c1[i * 3 + j], this.c0[i * 3 + j], t);
      count = Math.max(count, i + 1);
    }
    this.geo.setDrawRange(0, count);
    this.points.visible = count > 0;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aRot.needsUpdate = true;
  }
}

// ------------------------------------------------------------ skid ribbons
export class SkidRibbon {
  constructor(scene, mat, segments = 90) {
    this.segments = segments;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array((segments + 1) * 2 * 3);
    this.uv = new Float32Array((segments + 1) * 2 * 2);
    this.alpha = new Float32Array((segments + 1) * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.geo = g;
    this.head = 0;
    this.count = 0;
    this.lastPos = null;
  }
  reset() {
    this.head = 0;
    this.count = 0;
    this.lastPos = null;
    this.geo.setDrawRange(0, 0);
  }
  push(center, right, width, v) {
    if (this.lastPos && center.distanceTo(this.lastPos) < 0.45) return;
    this.lastPos = center.clone();
    // The buffer is a SCROLLING strip, not a ring. A ring buffer wraps the
    // write head back to row 0 while the linear index list still stitches row
    // N to row 0, which produces one triangle spanning the entire world - a
    // full-width translucent band across the frame. Shift instead: 90 rows is
    // 1080 floats, which is nothing next to the bug it removes.
    if (this.head > this.segments) {
      this.pos.copyWithin(0, 6);
      this.uv.copyWithin(0, 4);
      this.head = this.segments;
    }
    const i = this.head;
    const o = i * 6;
    this.pos[o] = center.x - right.x * width + v.x * 0.02;
    this.pos[o + 1] = center.y + 0.02;
    this.pos[o + 2] = center.z - right.z * width;
    this.pos[o + 3] = center.x + right.x * width;
    this.pos[o + 4] = center.y + 0.02;
    this.pos[o + 5] = center.z + right.z * width;
    const u = (this.uHead = (this.uHead || 0) + 1) * 0.18;
    this.uv[i * 4] = 0;
    this.uv[i * 4 + 1] = u;
    this.uv[i * 4 + 2] = 1;
    this.uv[i * 4 + 3] = u;
    this.head++;
    this.count = Math.min(this.count + 1, this.segments + 1);
    if (!this.geo.boundingSphere) this.geo.boundingSphere = new THREE.Sphere();
    this.geo.boundingSphere.center.copy(center);
    this.geo.boundingSphere.radius = 200;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    const range = Math.max(0, (this.count - 1) * 6);
    this.geo.setDrawRange(0, range);
    this.mesh.visible = range > 0;
  }
}

// ------------------------------------------------------------ shock rings
export class RingBurst {
  constructor(scene, max = 10) {
    const geo = new THREE.RingGeometry(0.88, 1.0, 48, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    scene.add(this.mesh);
    this.max = max;
    this.pool = [];
    for (let i = 0; i < max; i++) this.pool.push({ t: -1, life: 0.6, p: new THREE.Vector3(), col: new THREE.Color(1, 1, 1), sc: 6 });
  }
  burst(p, color = 0xffd6a0, scale = 6, life = 0.55) {
    const slot = this.pool.find((s) => s.t < 0) || this.pool[0];
    slot.t = 0;
    slot.life = life;
    slot.p.copy(p);
    slot.col.set(color);
    slot.sc = scale;
  }
  update(dt, camPos) {
    let n = 0;
    const im = this.mesh.instanceMatrix.array;
    const ic = this.mesh.instanceColor.array;
    for (const s of this.pool) {
      if (s.t < 0) continue;
      if (camPos) {
        V.copy(camPos).sub(s.p);
        if (V.lengthSq() < 1e-6) V.set(0, 0, 1);
        V.normalize();
        V2.set(0, 1, 0);
        if (Math.abs(V.y) > 0.98) V2.set(1, 0, 0);
        V3.crossVectors(V2, V).normalize();
        V2.crossVectors(V, V3).normalize();
        _camBasis.makeBasis(V3, V2, V);
      }
      s.t += dt;
      if (s.t > s.life) {
        s.t = -1;
        continue;
      }
      const f = s.t / s.life;
      const r = s.sc * (0.2 + f * 1.0);
      // Billboard the ring at the camera. A ground-plane ring reads as a road
      // marking painted round the bikes, not as a shockwave.
      M.makeScale(r, r, r);
      M.multiply(_ringAlign);
      Q.setFromRotationMatrix(_camBasis);
      M.premultiply(_M2.makeRotationFromQuaternion(Q));
      M.setPosition(s.p);
      M.toArray(im, n * 16);
      const a = Math.pow(1 - f, 2.4) * 0.85;
      ic[n * 3] = s.col.r * a;
      ic[n * 3 + 1] = s.col.g * a;
      ic[n * 3 + 2] = s.col.b * a;
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// --------------------------------------------------------- contact shadows
// Multiply-blended radial decals projected on the road. This is what Forza and
// Ride both do ON TOP of their shadow cascades: a cascade texel is 6-15 mm and
// can never resolve the 20 mm dark core where a tyre meets tarmac. Per-instance
// colour drives strength (white = no darkening, black = full).
export class ContactShadows {
  constructor(scene, max = 40) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    // stored as a LINEAR multiplier (no sRGB decode), 0 = black core, 1 = no-op
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 63);
    g.addColorStop(0.00, 'rgb(18,18,20)');
    g.addColorStop(0.34, 'rgb(58,59,64)');
    g.addColorStop(0.64, 'rgb(150,152,158)');
    g.addColorStop(0.87, 'rgb(232,233,236)');
    g.addColorStop(1.00, 'rgb(255,255,255)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.NoColorSpace;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this._strength = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    geo.setAttribute('aStrength', this._strength);
    // Hand-written multiply shader: MeshBasicMaterial + instanceColor cannot
    // express "lerp toward no-op", it can only scale, which turns a 100%
    // strength decal into a solid black square.
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex } },
      vertexShader: /* glsl */ `
        attribute float aStrength;
        varying vec2 vUv;
        varying float vS;
        void main() {
          vUv = uv;
          vS = aStrength;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec2 vUv;
        varying float vS;
        void main() {
          float d = texture2D( map, vUv ).r;
          gl_FragColor = vec4( mix( vec3( 1.0 ), vec3( d ), vS ), 1.0 );
        }`,
      transparent: true,
      depthWrite: false,
      // MultiplyBlending expressed as explicit factors: three logs a spurious
      // premultipliedAlpha warning every frame for the named constant.
      blending: THREE.CustomBlending,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      blendEquation: THREE.AddEquation,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.n = 0;
    this.max = max;
    this._up = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._f = new THREE.Vector3();
  }
  begin() {
    this.n = 0;
  }
  // strength 1 = full dark core, 0 = invisible.
  add(pos, right, fwd, sx, sz, strength = 1) {
    if (this.n >= this.max) return;
    const up = this._up.crossVectors(right, fwd).normalize();
    this._r.copy(right).multiplyScalar(sx);
    this._f.copy(fwd).multiplyScalar(sz);
    M.makeBasis(this._r, up, this._f);
    M.setPosition(pos);
    M.toArray(this.mesh.instanceMatrix.array, this.n * 16);
    this._strength.array[this.n] = Math.max(0, Math.min(1, strength));
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this._strength.needsUpdate = true;
  }
}

// ------------------------------------------------------------ wind streaks
export class WindStreaks {
  constructor(scene, max = 90) {
    const geo = new THREE.PlaneGeometry(0.02, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xcfe4ff,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.max = max;
    this.p = [];
    for (let i = 0; i < max; i++) this.p.push({ pos: new THREE.Vector3(), life: -1, len: 1 });
  }
  update(dt, camPos, camDir, speed, intensity) {
    const target = Math.floor(clamp((speed - 34) / 32, 0, 1) * this.max * intensity);
    let n = 0;
    for (const s of this.p) {
      if (s.life < 0) {
        if (n < target) {
          const a = Math.random() * Math.PI * 2;
          const r = 3.4 + Math.random() * 4.2;
          const cr = V3.set(0, 1, 0).cross(camDir).normalize();
          const cu = new THREE.Vector3().crossVectors(camDir, cr).normalize();
          s.pos
            .copy(camPos)
            .addScaledVector(camDir, 7 + Math.random() * 16)
            .addScaledVector(cr, Math.cos(a) * r)
            .addScaledVector(cu, Math.sin(a) * r * 0.62);
          // These are meant to read as air tearing past the bike. Distributed
          // evenly around the camera axis, a good third of them ended up above
          // eye level, which at this camera pitch means above the horizon —
          // bright dashes hanging in the blue sky. Keep them under the eye
          // line so they always sit against the road.
          if (s.pos.y > camPos.y - 0.2) s.pos.y = camPos.y - 0.2 - Math.random() * r * 0.5;
          s.life = 0.2 + Math.random() * 0.14;
          s.len = 1.6 + Math.random() * 3.4;
        } else continue;
      }
      s.life -= dt;
      if (s.life <= 0) {
        s.life = -1;
        continue;
      }
      s.pos.addScaledVector(camDir, -speed * dt * 1.35);
      const dir = camDir.clone().multiplyScalar(-1);
      const toCam = V3.copy(camPos).sub(s.pos).normalize();
      const x = new THREE.Vector3().crossVectors(dir, toCam).normalize();
      const z = new THREE.Vector3().crossVectors(x, dir).normalize();
      M.makeBasis(x, dir.multiplyScalar(s.len * (0.35 + speed / 130)), z);
      M.setPosition(s.pos);
      M.toArray(this.mesh.instanceMatrix.array, n * 16);
      n++;
      if (n >= this.max) break;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.material.opacity = 0.05 + 0.3 * clamp((speed - 34) / 40, 0, 1);
  }
}

export class VFX {
  constructor(scene, T, quality = 'ultra') {
    const scale = quality === 'low' ? 0.35 : quality === 'med' ? 0.6 : 1;
    this.sparks = new StreakSystem(scene, T.spark, Math.floor(460 * scale));
    this.smoke = new PuffSystem(scene, T.smoke, Math.floor(300 * scale), false);
    this.glow = new PuffSystem(scene, T.glow, Math.floor(140 * scale), true);
    this.rings = new RingBurst(scene, 10);
    this.shadows = new ContactShadows(scene, 56);
    this.wind = new WindStreaks(scene, Math.floor(90 * scale));
    this.quality = quality;
  }
  update(dt, camPos, camDir, speed, windIntensity = 1) {
    this.sparks.update(dt, camPos);
    this.smoke.update(dt);
    this.glow.update(dt);
    this.rings.update(dt, camPos);
    this.wind.update(dt, camPos, camDir, speed, windIntensity);
  }
  // A 60 ms white core followed by a 160 ms warm afterglow. Without this a
  // melee connect has no single bright pixel and reads as nothing happening.
  impactFlash(pos, size = 1.1) {
    // A white core big enough to hide the fist is a worse frame than no flash
    // at all: keep the hot centre small and put the energy in the ring.
    this.glow.emit(pos, _ZERO, 1, {
      life: 0.07, size: size * 0.42, grow: 1.15, alpha: 1.0, jitter: 0, spread: 0,
      color0: [1.0, 1.0, 1.0], color1: [1.0, 0.96, 0.88],
    });
    this.glow.emit(pos, _ZERO, 3, {
      life: 0.17, size: size * 0.78, grow: 2.4, alpha: 0.55, jitter: 0.30, spread: 0.16,
      color0: [1.0, 0.69, 0.25], color1: [1.0, 0.34, 0.08],
    });
  }
  // Asphalt scrub: pale dust that expands and dies. Bound to a sliding contact.
  dustPuff(pos, count = 6, size = 0.5) {
    this.smoke.emit(pos, _ZERO, count, {
      life: 1.1, size, grow: 5.2, alpha: 0.42, jitter: 0.5, spread: 0.35,
      color0: [0.553, 0.514, 0.471], color1: [0.36, 0.34, 0.31],
    });
  }
}
const _ZERO = new THREE.Vector3();

export { V as _v };
