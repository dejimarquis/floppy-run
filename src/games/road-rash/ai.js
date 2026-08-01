// Rival / cop AI and oncoming traffic.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RNG, clamp, lerp, damp } from './rng.js';
import { ROAD_HALF_WIDTH as HW } from './track.js';

const LANES = [0.9, 3.0, 5.2, -2.4];

export class RivalAI {
  constructor(racer, opts = {}) {
    this.r = racer;
    this.rng = new RNG(opts.seed ?? 99);
    this.targetX = racer.x;
    this.laneTimer = this.rng.range(0.5, 3);
    this.aggression = opts.aggression ?? 0.55;
    this.skill = opts.skill ?? 0.7;
    this.baseSpeed = opts.baseSpeed ?? 66;
    this.attackTimer = 0;
    this.dodge = 0;
    this.grudge = null;
  }

  update(dt, ctx) {
    const r = this.r;
    if (r.crashed) return;
    const { track, player, racers, traffic } = ctx;

    // ---------------- lane selection ----------------
    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      this.laneTimer = this.rng.range(1.4, 4.2);
      let lane = this.rng.pick(LANES);
      // block the player when just ahead of them
      const gapToPlayer = track.delta(r.s, player.s);
      if (!player.crashed && gapToPlayer > 2 && gapToPlayer < 26 && this.rng.chance(this.aggression)) {
        lane = clamp(player.x + this.rng.range(-0.7, 0.7), -HW + 1.4, HW - 1.4);
      }
      this.targetX = clamp(lane, -HW + 1.3, HW - 1.3);
    }

    // avoid whatever is directly ahead
    let avoid = 0;
    for (const o of racers) {
      if (o === r || o.crashed) continue;
      const ds = track.delta(o.s, r.s);
      if (ds > 1 && ds < 26) {
        const dx = o.x - r.x;
        if (Math.abs(dx) < 2.4) avoid -= Math.sign(dx || 1) * (2.6 - Math.abs(dx)) * 1.1;
      }
    }
    for (const c of traffic.active) {
      const ds = track.delta(c.s, r.s);
      const closing = c.dir < 0 ? ds > -6 && ds < 90 : ds > 1 && ds < 40;
      if (closing) {
        const dx = c.x - r.x;
        if (Math.abs(dx) < 3.4) avoid -= Math.sign(dx || 1) * (3.6 - Math.abs(dx)) * 2.2;
      }
    }
    const wantX = clamp(this.targetX + avoid, -HW + 1.2, HW - 1.2);

    // ---------------- speed ----------------
    const look = clamp(r.v * 1.1, 25, 90);
    let maxCurv = 0;
    for (let d = 10; d < look; d += 12) maxCurv = Math.max(maxCurv, Math.abs(track.sample(r.s + d, {}).curv));
    const corner = maxCurv > 1e-5 ? Math.sqrt(clamp(10.5 * this.skill, 4, 12) / maxCurv) : 999;
    const gap = track.delta(player.s, r.s); // + => player ahead of me
    const rubber = clamp(gap / 190, -1, 1);
    const target = clamp(this.baseSpeed + rubber * 11 + (player.crashed ? -6 : 0), 22, 82);
    const desired = Math.min(target, corner);

    if (r.v < desired - 1.2) {
      r.input.throttle = 1;
      r.input.brake = 0;
    } else if (r.v > desired + 2.5) {
      r.input.throttle = 0;
      r.input.brake = clamp((r.v - desired) / 14, 0, 1);
    } else {
      r.input.throttle = 0.55;
      r.input.brake = 0;
    }
    r.input.boost = gap > 60 && r.boost > 0.5;

    // ---------------- steering ----------------
    const err = wantX - r.x;
    r.input.steer = clamp(err * 0.20 - r.vx * 0.17 + this.dodge, -1, 1);
    this.dodge = damp(this.dodge, 0, 5, dt);

    // ---------------- combat ----------------
    this.attackTimer -= dt;
    if (this.attackTimer <= 0) {
      const targets = [player, ...racers.filter((o) => o !== r)];
      for (const o of targets) {
        if (o === r || o.crashed) continue;
        const ds = track.delta(o.s, r.s);
        const dx = o.x - r.x;
        if (Math.abs(ds) < 2.6 && Math.abs(dx) > 0.7 && Math.abs(dx) < 3.1 && r.stamina > 0.22) {
          if (this.rng.chance(this.aggression * 0.75)) {
            ctx.attack(r, o, dx > 0 ? 1 : -1);
            this.attackTimer = this.rng.range(0.75, 1.7);
          } else {
            this.attackTimer = this.rng.range(0.4, 0.9);
          }
          break;
        }
      }
    }
  }
}

export class CopAI extends RivalAI {
  constructor(racer, opts = {}) {
    super(racer, opts);
    this.bustProgress = 0;
    this.baseSpeed = 72;
    this.aggression = 0.8;
  }
  update(dt, ctx) {
    const r = this.r;
    if (r.crashed) return;
    const { track, player } = ctx;
    const gap = track.delta(player.s, r.s);
    // pursue: sit alongside the player
    this.targetX = clamp(player.x + (r.x > player.x ? 1.8 : -1.8), -HW + 1.2, HW - 1.2);
    const desired = clamp(player.v + clamp(gap * 0.35, -8, 16), 26, 84);
    r.input.throttle = r.v < desired ? 1 : 0.3;
    r.input.brake = r.v > desired + 5 ? 0.4 : 0;
    r.input.steer = clamp((this.targetX - r.x) * 0.2 - r.vx * 0.17, -1, 1);
    r.input.boost = gap > 30;

    const ds = Math.abs(track.delta(player.s, r.s));
    const dx = Math.abs(player.x - r.x);
    if (ds < 4 && dx < 3.4 && !player.crashed) {
      this.bustProgress += dt;
      if (this.bustProgress > 2.2) {
        this.bustProgress = -3;
        ctx.bust(r);
      }
    } else this.bustProgress = Math.max(0, this.bustProgress - dt * 0.6);

    this.attackTimer -= dt;
    if (this.attackTimer <= 0 && ds < 2.6 && dx > 0.8 && dx < 3.2) {
      ctx.attack(r, player, player.x > r.x ? 1 : -1);
      this.attackTimer = 1.1;
    }
  }
}

// ---------------------------------------------------------------- traffic
function buildCarGeoms(kind) {
  const paint = [];
  const dark = [];
  const glass = [];
  const lights = [];
  if (kind === 'car') {
    const body = new THREE.BoxGeometry(1.86, 0.72, 4.5);
    body.translate(0, 0.78, 0);
    paint.push(body);
    const hood = new THREE.BoxGeometry(1.78, 0.28, 1.5);
    hood.translate(0, 1.12, -1.35);
    paint.push(hood);
    const roof = new THREE.BoxGeometry(1.66, 0.62, 2.2);
    roof.translate(0, 1.42, 0.16);
    paint.push(roof);
    const trunk = new THREE.BoxGeometry(1.78, 0.24, 1.2);
    trunk.translate(0, 1.1, 1.62);
    paint.push(trunk);
    const wind = new THREE.BoxGeometry(1.6, 0.5, 0.08);
    wind.rotateX(-0.5);
    wind.translate(0, 1.42, -0.95);
    glass.push(wind);
    const rear = new THREE.BoxGeometry(1.55, 0.44, 0.08);
    rear.rotateX(0.55);
    rear.translate(0, 1.42, 1.26);
    glass.push(rear);
    for (const sx of [-1, 1]) {
      const side = new THREE.BoxGeometry(0.06, 0.42, 2.0);
      side.translate(sx * 0.84, 1.44, 0.2);
      glass.push(side);
    }
    for (const sx of [-1, 1])
      for (const sz of [-1.45, 1.5]) {
        const w = new THREE.CylinderGeometry(0.35, 0.35, 0.24, 12);
        w.rotateZ(Math.PI / 2);
        w.translate(sx * 0.92, 0.36, sz);
        dark.push(w);
      }
    const bumper = new THREE.BoxGeometry(1.9, 0.22, 0.2);
    bumper.translate(0, 0.62, -2.28);
    dark.push(bumper);
    const bumper2 = bumper.clone();
    bumper2.translate(0, 0, 4.56);
    dark.push(bumper2);
    for (const sx of [-1, 1]) {
      const hl = new THREE.BoxGeometry(0.42, 0.18, 0.1);
      hl.translate(sx * 0.62, 0.96, -2.26);
      lights.push(hl);
    }
  } else {
    const body = new THREE.BoxGeometry(2.2, 1.5, 5.4);
    body.translate(0, 1.35, 0.3);
    paint.push(body);
    const cab = new THREE.BoxGeometry(2.15, 0.95, 1.7);
    cab.translate(0, 1.5, -2.1);
    paint.push(cab);
    const wind = new THREE.BoxGeometry(2.0, 0.72, 0.08);
    wind.rotateX(-0.16);
    wind.translate(0, 1.62, -2.94);
    glass.push(wind);
    for (const sx of [-1, 1])
      for (const sz of [-1.9, 1.4, 2.4]) {
        const w = new THREE.CylinderGeometry(0.46, 0.46, 0.3, 12);
        w.rotateZ(Math.PI / 2);
        w.translate(sx * 1.06, 0.48, sz);
        dark.push(w);
      }
    for (const sx of [-1, 1]) {
      const hl = new THREE.BoxGeometry(0.36, 0.24, 0.1);
      hl.translate(sx * 0.78, 1.05, -2.96);
      lights.push(hl);
    }
  }
  return {
    paint: mergeGeometries(paint, false),
    dark: mergeGeometries(dark, false),
    glass: mergeGeometries(glass, false),
    lights: mergeGeometries(lights, false),
  };
}

export class TrafficSystem {
  constructor(scene, track, mats, opts = {}) {
    this.track = track;
    this.rng = new RNG(opts.seed ?? 4242);
    this.max = opts.max ?? 9;
    this.active = [];
    this.sets = {};
    const paintMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.18,
      metalness: 0.45,
      vertexColors: false,
      envMapIntensity: 1.5,
    });
    for (const kind of ['car', 'truck']) {
      const geo = buildCarGeoms(kind);
      const n = kind === 'car' ? this.max : Math.ceil(this.max * 0.5);
      const mk = (g, m, colorable) => {
        const im = new THREE.InstancedMesh(g, m, n);
        im.frustumCulled = false;
        im.castShadow = true;
        im.receiveShadow = false;
        im.count = 0;
        if (colorable) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
        scene.add(im);
        return im;
      };
      this.sets[kind] = {
        n,
        paint: mk(geo.paint, paintMat.clone(), true),
        dark: mk(geo.dark, mats.plastic, false),
        glass: mk(geo.glass, mats.glass, false),
        lights: mk(geo.lights, mats.emissiveWhite, false),
      };
      this.sets[kind].paint.material.vertexColors = true;
    }
    this.palette = [0xbcc4d0, 0x24313f, 0x8a2226, 0x2e5b3a, 0xd9d2c4, 0x1c1f24, 0xc9821f];
  }

  spawn(playerS) {
    const t = this.track;
    const oncoming = this.rng.chance(0.62);
    const kind = this.rng.chance(0.75) ? 'car' : 'truck';
    const dir = oncoming ? -1 : 1;
    const s = t.wrap(playerS + (oncoming ? this.rng.range(320, 620) : this.rng.range(120, 400)));
    const x = oncoming ? -this.rng.pick([2.2, 5.2]) : this.rng.pick([3.2, 5.6]);
    const v = oncoming ? this.rng.range(20, 30) : this.rng.range(15, 24);
    this.active.push({
      kind,
      s,
      x,
      v,
      dir,
      color: new THREE.Color(this.rng.pick(this.palette)),
      wobble: this.rng.range(0, 6.28),
    });
  }

  update(dt, playerS, playerV) {
    const t = this.track;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const c = this.active[i];
      c.s = t.wrap(c.s + c.v * c.dir * dt);
      const d = t.delta(c.s, playerS);
      if (d < -140 || d > 900) this.active.splice(i, 1);
    }
    while (this.active.length < this.max) this.spawn(playerS);

    // write instance transforms
    for (const kind of ['car', 'truck']) {
      const set = this.sets[kind];
      let n = 0;
      const sm = {};
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const basis = new THREE.Matrix4();
      const fwd = new THREE.Vector3();
      for (const c of this.active) {
        if (c.kind !== kind || n >= set.n) continue;
        t.sample(c.s, sm);
        fwd.copy(sm.fwd).multiplyScalar(c.dir);
        const right = sm.right.clone().multiplyScalar(c.dir);
        basis.makeBasis(right, sm.up, fwd.clone().negate());
        q.setFromRotationMatrix(basis);
        const p = sm.pos.clone().addScaledVector(sm.right, c.x).addScaledVector(sm.up, 0.02);
        m.compose(p, q, new THREE.Vector3(1, 1, 1));
        for (const key of ['paint', 'dark', 'glass', 'lights']) {
          m.toArray(set[key].instanceMatrix.array, n * 16);
        }
        set.paint.instanceColor.array[n * 3] = c.color.r;
        set.paint.instanceColor.array[n * 3 + 1] = c.color.g;
        set.paint.instanceColor.array[n * 3 + 2] = c.color.b;
        c.world = p;
        n++;
      }
      for (const key of ['paint', 'dark', 'glass', 'lights']) {
        set[key].count = n;
        set[key].instanceMatrix.needsUpdate = true;
      }
      set.paint.instanceColor.needsUpdate = true;
    }
    void playerV;
  }

  // returns the traffic object hit, or null
  checkHit(racer) {
    const t = this.track;
    for (const c of this.active) {
      const ds = t.delta(c.s, racer.s);
      const dx = c.x - racer.x;
      const halfLen = c.kind === 'truck' ? 3.0 : 2.4;
      const halfW = c.kind === 'truck' ? 1.3 : 1.1;
      if (Math.abs(ds) < halfLen && Math.abs(dx) < halfW + 0.5) return c;
    }
    return null;
  }
}

export { LANES, lerp };
