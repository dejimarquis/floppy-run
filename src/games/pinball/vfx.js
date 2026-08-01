/**
 * VFX: GPU particle pool (sparks, scoring pops, bumper bursts, multiball light
 * show), ball motion trails, soft contact shadows and lamp bleed flashes.
 */

import * as THREE from 'three';
import { V } from './table.js';
import { random } from './rng.js';

const MAX_P = 900;
const RING_N = 16;
const BLACK = new THREE.Color(0, 0, 0);
const TMPC = new THREE.Color();

export class VFX {
  constructor(parent, env) {
    this.env = env;
    this.group = new THREE.Group();
    parent.add(this.group);

    /* ---- particle pool ---- */
    const pos = new Float32Array(MAX_P * 3);
    const col = new Float32Array(MAX_P * 3);
    const siz = new Float32Array(MAX_P);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
    geo.setDrawRange(0, MAX_P);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 500 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize;
        varying vec3 vCol; varying float vA;
        uniform float uScale;
        void main(){
          vCol = aColor; vA = step(0.0001, aSize);
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = max(1.0, aSize * uScale / max(0.001,-mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol; varying float vA;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if(r > 0.5) discard;
          float a = pow(1.0 - r*2.0, 1.7);
          gl_FragColor = vec4(vCol * a * 2.2, a * vA);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.group.add(this.points);
    this.pGeo = geo;
    this.pool = [];
    for (let i = 0; i < MAX_P; i++) this.pool.push({ i, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0, s0: 0, c: new THREE.Color(), drag: 2, grav: 1 });
    this.head = 0;

    /* ---- contact shadow sprite ---- */
    const sc = document.createElement('canvas');
    sc.width = sc.height = 128;
    const g2 = sc.getContext('2d');
    const grd = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,0.85)');
    grd.addColorStop(0.42, 'rgba(0,0,0,0.45)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g2.fillStyle = grd;
    g2.fillRect(0, 0, 128, 128);
    this.shadowTex = new THREE.CanvasTexture(sc);

    /* ---- shared trail texture ---- */
    const tc = document.createElement('canvas');
    tc.width = 64;
    tc.height = 8;
    const g3 = tc.getContext('2d');
    const lg = g3.createLinearGradient(0, 0, 64, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(1, 'rgba(255,255,255,1)');
    g3.fillStyle = lg;
    g3.fillRect(0, 0, 64, 8);
    this.trailTex = new THREE.CanvasTexture(tc);

    /* ---- shockwave rings -------------------------------------------
     * The single most readable "you hit that" signal there is: a hard bright
     * ring that snaps outward from the impact point in ~250ms. Sixteen of
     * them live in one InstancedMesh, so the whole system is one draw call
     * whether nothing is happening or the table is being pounded.
     * ---------------------------------------------------------------- */
    const rc = document.createElement('canvas');
    rc.width = rc.height = 128;
    const g4 = rc.getContext('2d');
    const rg2 = g4.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg2.addColorStop(0.00, 'rgba(255,255,255,0)');
    rg2.addColorStop(0.62, 'rgba(255,255,255,0)');
    rg2.addColorStop(0.80, 'rgba(255,255,255,1)');
    rg2.addColorStop(0.92, 'rgba(255,255,255,0.45)');
    rg2.addColorStop(1.00, 'rgba(255,255,255,0)');
    g4.fillStyle = rg2;
    g4.fillRect(0, 0, 128, 128);
    this.ringTex = new THREE.CanvasTexture(rc);

    const ringGeo = new THREE.PlaneGeometry(1, 1);
    ringGeo.rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        map: this.ringTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      RING_N
    );
    this.rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 8;
    this.rings.count = RING_N;
    this.ringState = [];
    for (let i = 0; i < RING_N; i++) this.ringState.push({ t: 0, dur: 1, x: 0, y: 0, z: 0, r0: 0, r1: 1, c: new THREE.Color() });
    this.ringHead = 0;
    this._m4 = new THREE.Matrix4();
    this.group.add(this.rings);
    this._hideRings();
  }

  _hideRings() {
    const m = this._m4.makeScale(0, 0, 0);
    for (let i = 0; i < RING_N; i++) {
      this.rings.setMatrixAt(i, m);
      this.rings.setColorAt(i, BLACK);
    }
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }

  /** Snap a bright ring outward from (x,y). This is the hit confirmation. */
  shockwave(x, y, color, r1 = 0.09, dur = 0.34, z = 0.006) {
    const s = this.ringState[this.ringHead++ % RING_N];
    s.t = 0;
    s.dur = dur;
    s.x = x;
    s.y = y;
    s.z = z;
    s.r0 = r1 * 0.16;
    s.r1 = r1;
    s.c.set(color);
  }

  _updateRings(dt) {
    let live = false;
    for (let i = 0; i < RING_N; i++) {
      const s = this.ringState[i];
      if (s.t >= s.dur) {
        this.rings.setMatrixAt(i, this._m4.makeScale(0, 0, 0));
        continue;
      }
      s.t += dt;
      live = true;
      const f = Math.min(1, s.t / s.dur);
      // fast out, hard stop: ease-out cubic reads as an impact, linear does not
      const e = 1 - (1 - f) ** 3;
      const r = s.r0 + (s.r1 - s.r0) * e;
      const a = (1 - f) ** 1.6;
      this._m4.makeScale(r * 2, 1, r * 2);
      this._m4.setPosition(s.x, s.z, -s.y);
      this.rings.setMatrixAt(i, this._m4);
      TMPC.copy(s.c).multiplyScalar(a * 2.4);
      this.rings.setColorAt(i, TMPC);
    }
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    return live;
  }

  spawn(x, y, z, opts) {
    const p = this.pool[this.head++ % MAX_P];
    p.life = opts.life;
    p.maxLife = opts.life;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = opts.vx;
    p.vy = opts.vy;
    p.vz = opts.vz;
    p.s0 = opts.size;
    p.s = opts.size;
    p.drag = opts.drag ?? 2.4;
    p.grav = opts.grav ?? 1;
    p.c.set(opts.color);
    return p;
  }

  burst(x, y, color, n = 22, power = 1, z = 0.02) {
    for (let i = 0; i < n; i++) {
      const a = random() * Math.PI * 2;
      const s = (0.25 + random() * 1.0) * power;
      this.spawn(x, y, z, {
        life: 0.28 + random() * 0.5,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        vz: random() * 0.55 * power,
        size: 0.0035 + random() * 0.007,
        color,
        drag: 3.0,
        grav: 1.4,
      });
    }
  }

  sparks(x, y, nx, ny, color, n = 10, power = 1) {
    for (let i = 0; i < n; i++) {
      const spread = (random() - 0.5) * 1.5;
      const c = Math.cos(spread);
      const s = Math.sin(spread);
      const dx = nx * c - ny * s;
      const dy = nx * s + ny * c;
      const sp = (0.5 + random() * 1.6) * power;
      this.spawn(x, y, 0.012, {
        life: 0.12 + random() * 0.25,
        vx: dx * sp,
        vy: dy * sp,
        vz: random() * 0.4,
        size: 0.0018 + random() * 0.0035,
        color,
        drag: 4.5,
        grav: 2.2,
      });
    }
  }

  scorePop(x, y, color) {
    for (let i = 0; i < 14; i++) {
      const a = random() * Math.PI * 2;
      this.spawn(x, y, 0.02, {
        life: 0.45 + random() * 0.4,
        vx: Math.cos(a) * 0.22,
        vy: Math.sin(a) * 0.22 + 0.3,
        vz: 0.25 + random() * 0.4,
        size: 0.004 + random() * 0.006,
        color,
        drag: 1.6,
        grav: 0.4,
      });
    }
  }

  lightShow(n = 60) {
    for (let i = 0; i < n; i++) {
      const x = -0.26 + random() * 0.5;
      const y = 0.05 + random() * 1.0;
      const hue = random();
      const c = new THREE.Color().setHSL(hue, 1, 0.6);
      this.spawn(x, y, 0.02 + random() * 0.05, {
        life: 0.6 + random() * 0.8,
        vx: (random() - 0.5) * 0.2,
        vy: (random() - 0.5) * 0.2,
        vz: 0.15 + random() * 0.5,
        size: 0.005 + random() * 0.01,
        color: c,
        drag: 1.2,
        grav: 0.2,
      });
    }
  }

  update(dt) {
    this._updateRings(dt);
    const pos = this.pGeo.attributes.position.array;
    const col = this.pGeo.attributes.aColor.array;
    const siz = this.pGeo.attributes.aSize.array;
    for (const p of this.pool) {
      const i3 = p.i * 3;
      if (p.life <= 0) {
        siz[p.i] = 0;
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) {
        siz[p.i] = 0;
        continue;
      }
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.vz = p.vz * k - p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.z < 0.004) {
        p.z = 0.004;
        p.vz *= -0.35;
      }
      const f = p.life / p.maxLife;
      pos[i3] = p.x;
      pos[i3 + 1] = p.z;
      pos[i3 + 2] = -p.y;
      col[i3] = p.c.r * f;
      col[i3 + 1] = p.c.g * f;
      col[i3 + 2] = p.c.b * f;
      siz[p.i] = p.s0 * (0.35 + f * 0.65);
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.aColor.needsUpdate = true;
    this.pGeo.attributes.aSize.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* Ball visual: chrome sphere + contact shadow + speed streak           */
/* ------------------------------------------------------------------ */

const TRAIL_N = 14;

export class BallView {
  constructor(vfx, parent, mat, r) {
    this.r = r;
    this.group = new THREE.Group();
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.group.add(this.mesh);

    // specular hotspot — a tiny additive billboard that keeps the highlight
    // alive even when the env map is dim
    this.hot = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: vfx.shadowTex,
        color: 0xffffff,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.0,
      })
    );
    this.hot.scale.setScalar(r * 0.66);
    this.hot.position.set(r * 0.34, r * 0.62, r * 0.30);
    this.group.add(this.hot);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 5.0, r * 5.0),
      new THREE.MeshBasicMaterial({
        map: vfx.shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.55,
        color: 0x000000,
      })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
    parent.add(this.shadow);

    // motion streak
    const g = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(TRAIL_N * 2 * 3);
    this.trailUv = new Float32Array(TRAIL_N * 2 * 2);
    const idx = [];
    for (let i = 0; i < TRAIL_N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    for (let i = 0; i < TRAIL_N; i++) {
      this.trailUv[i * 4] = i / (TRAIL_N - 1);
      this.trailUv[i * 4 + 1] = 0;
      this.trailUv[i * 4 + 2] = i / (TRAIL_N - 1);
      this.trailUv[i * 4 + 3] = 1;
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.trailUv, 2));
    g.setIndex(idx);
    this.trail = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        map: vfx.trailTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: 0xbfe4ff,
        opacity: 0.0,
        side: THREE.DoubleSide,
      })
    );
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 3;
    parent.add(this.trail);

    parent.add(this.group);
    this.hist = [];
    this.quat = new THREE.Quaternion();
  }

  update(ball, dt, camera) {
    const p = V(ball.x, ball.y, ball.z + this.r);
    this.group.position.copy(p);
    this.shadow.position.set(ball.x, 0.0015 + ball.z * 0.2, -ball.y);
    const lift = 1 + ball.z * 6;
    this.shadow.scale.setScalar(lift);
    this.shadow.material.opacity = 0.6 / lift;

    // roll orientation: spin about the axis perpendicular to velocity
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > 0.01 && !ball.rail) {
      const axis = new THREE.Vector3(-ball.vy, 0, -ball.vx).normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(axis, (sp / this.r) * dt);
      this.quat.premultiply(q);
    }
    if (Math.abs(ball.spin) > 0.01) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ball.spin * dt);
      this.quat.premultiply(q);
    }
    this.mesh.quaternion.copy(this.quat);

    // hotspot faces camera and brightens with speed. Its world size is floored
    // against camera distance so the glint keeps a roughly constant *screen*
    // size: at the wide 3/4 framing the ball is only a handful of pixels
    // across, and without this the hero object simply disappears.
    if (camera) {
      this.hot.material.opacity = 0.9 + Math.min(0.75, sp * 0.09);
      const d = camera.position.distanceTo(this.group.position);
      this.hot.scale.setScalar(Math.max(this.r * 1.05, d * 0.019));
    }

    // trail
    this.hist.unshift([p.x, p.y, p.z]);
    if (this.hist.length > TRAIL_N) this.hist.length = TRAIL_N;
    const speed = ball.rail ? Math.abs(ball.railV || 0) : sp;
    // The ball is the hero object, so the streak starts early and reads hard.
    const vis = Math.max(0, Math.min(1, (speed - 0.55) / 2.4));
    this.trail.material.opacity = vis * 1.0;
    if (vis > 0.01 && this.hist.length > 2) {
      const arr = this.trailPos;
      for (let i = 0; i < TRAIL_N; i++) {
        const h = this.hist[Math.min(i, this.hist.length - 1)];
        const hn = this.hist[Math.min(i + 1, this.hist.length - 1)];
        let dx = hn[0] - h[0];
        let dz = hn[2] - h[2];
        const l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l;
        const nz = dx / l;
        const w = this.r * (0.7 + vis * 0.95) * (1 - i / TRAIL_N);
        arr[i * 6] = h[0] + nx * w;
        arr[i * 6 + 1] = h[1];
        arr[i * 6 + 2] = h[2] + nz * w;
        arr[i * 6 + 3] = h[0] - nx * w;
        arr[i * 6 + 4] = h[1];
        arr[i * 6 + 5] = h[2] - nz * w;
      }
      this.trail.geometry.attributes.position.needsUpdate = true;
    }
  }

  dispose(parent) {
    parent.remove(this.group);
    parent.remove(this.shadow);
    parent.remove(this.trail);
    this.mesh.geometry.dispose();
    this.trail.geometry.dispose();
  }
}
