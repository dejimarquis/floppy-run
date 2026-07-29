// Arcade rigid-body car physics: per-wheel raycast suspension, slip-based tyre
// forces, weight transfer, handbrake drifting, boost, and impulse collisions.
import * as THREE from 'three';
import { clamp } from './rng.js';
import { ROAD_HALF, VERGE, BARRIER_U } from './track.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _b1 = new THREE.Vector3(), _b2 = new THREE.Vector3(), _b3 = new THREE.Vector3();
const _m3 = new THREE.Matrix3();

export class Body {
  constructor({ mass = 1400, size = [1.9, 1.25, 4.5] } = {}) {
    this.mass = mass;
    this.invMass = 1 / mass;
    this.size = size;
    const [w, h, l] = size;
    const k = mass / 12;
    this.inertia = new THREE.Vector3(k * (h * h + l * l), k * (w * w + l * l), k * (w * w + h * h));
    this.invInertia = new THREE.Vector3(1 / this.inertia.x, 1 / this.inertia.y, 1 / this.inertia.z);
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.ang = new THREE.Vector3();
    this.force = new THREE.Vector3();
    this.torque = new THREE.Vector3();
    this.matrix = new THREE.Matrix4();
    this.sleeping = false;
  }

  updateMatrix() {
    this.matrix.compose(this.pos, this.quat, _v1.set(1, 1, 1));
  }

  localToWorld(v, out) {
    return out.copy(v).applyQuaternion(this.quat).add(this.pos);
  }
  dirToWorld(v, out) {
    return out.copy(v).applyQuaternion(this.quat);
  }
  pointVelocity(worldPoint, out) {
    _b3.subVectors(worldPoint, this.pos);
    return out.crossVectors(this.ang, _b3).add(this.vel);
  }
  applyForce(f, worldPoint) {
    this.force.add(f);
    _b1.subVectors(worldPoint, this.pos);
    this.torque.add(_b2.crossVectors(_b1, f));
  }
  applyCentralForce(f) { this.force.add(f); }
  applyImpulse(j, worldPoint) {
    this.vel.addScaledVector(j, this.invMass);
    _b1.subVectors(worldPoint, this.pos);
    _b2.crossVectors(_b1, j);
    this.applyAngularImpulse(_b2);
  }
  applyAngularImpulse(t) {
    // convert to local, scale by inverse inertia, back to world
    _v4.copy(t).applyQuaternion(_q1.copy(this.quat).invert());
    _v4.multiply(this.invInertia);
    _v4.applyQuaternion(this.quat);
    this.ang.add(_v4);
  }
  applyTorque(t) { this.torque.add(t); }

  integrate(dt) {
    // linear
    this.vel.addScaledVector(this.force, this.invMass * dt);
    this.pos.addScaledVector(this.vel, dt);
    // angular (world-space inertia via local transform)
    _v4.copy(this.torque).applyQuaternion(_q1.copy(this.quat).invert());
    _v4.multiply(this.invInertia);
    _v4.applyQuaternion(this.quat);
    this.ang.addScaledVector(_v4, dt);
    const w = this.ang;
    if (w.lengthSq() > 1e-9) {
      _q1.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0).multiply(this.quat);
      this.quat.x += _q1.x; this.quat.y += _q1.y; this.quat.z += _q1.z; this.quat.w += _q1.w;
      this.quat.normalize();
    }
    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
  }
}

export const GRAVITY = -19.5; // punchy arcade gravity

export class Vehicle {
  constructor(opts) {
    const cfg = this.cfg = Object.assign({
      mass: 1350,
      size: [1.95, 1.25, 4.5],
      wheelBase: 2.7,
      trackWidth: 1.62,
      wheelR: 0.36,
      restLen: 0.42,
      springK: 62000,
      damper: 3600,
      maxSteer: 0.52,
      enginePower: 54000,
      brakePower: 26000,
      topSpeed: 88,
      boostSpeed: 118,
      gripFront: 2.65,
      gripRear: 2.45,
      drag: 0.72,
      downforce: 3.4,
      rollStiff: 0.55,
      comHeight: 0.46,
      driveBias: 0.25, // 0 = RWD, 1 = FWD
    }, opts.cfg || {});

    this.track = opts.track;
    this.body = new Body({ mass: cfg.mass, size: cfg.size });
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, boost: 0 };
    this.steerAngle = 0;
    this.wheels = [];
    const hw = cfg.trackWidth / 2, hl = cfg.wheelBase / 2;
    // static compression so the car sits at the right ride height with the
    // body origin (centre of mass) `comHeight` above the ground plane.
    this.staticComp = (cfg.mass * -GRAVITY) / (4 * cfg.springK);
    const attachY = cfg.restLen + cfg.wheelR - this.staticComp - cfg.comHeight;
    const layout = [
      [-hw, hl, true], [hw, hl, true], [-hw, -hl, false], [hw, -hl, false],
    ];
    for (const [x, z, front] of layout) {
      this.wheels.push({
        local: new THREE.Vector3(x, attachY, z),
        front,
        contact: false,
        compression: 0,
        susForce: 0,
        spin: 0,
        spinVel: 0,
        slip: 0,
        latSlip: 0,
        worldPos: new THREE.Vector3(),
        contactPoint: new THREE.Vector3(),
        contactNormal: new THREE.Vector3(0, 1, 0),
        surfaceKind: 'open',
        skid: 0,
      });
    }
    this.hint = -1;
    this.trackS = 0;
    this.trackU = 0;
    this.airTime = 0;
    this.grounded = 0;
    this.speed = 0;
    this.rpm = 900;
    this.gear = 1;
    this.gearRatios = [3.4, 2.35, 1.72, 1.32, 1.05, 0.86];
    this.finalDrive = 3.6;
    this.shiftTimer = 0;
    this.wallHit = 0;
    this.lastWallImpact = 0;
    this.onWallHit = null;
    this.boostAmount = 0;
    this.wrecked = false;
    this.driftAmount = 0;
    this.enabled = true;
  }

  reset(s, u, track) {
    const t = track || this.track;
    const p = new THREE.Vector3();
    t.posAt(s, u, this.cfg.comHeight + 0.05, p);
    const f = t.frameAt(s, _frameTmp);
    this.body.pos.copy(p);
    const m = new THREE.Matrix4().makeBasis(
      f.right.clone(), f.up.clone(), f.tan.clone()
    );
    this.body.quat.setFromRotationMatrix(m);
    this.body.vel.set(0, 0, 0);
    this.body.ang.set(0, 0, 0);
    this.trackS = s; this.trackU = u; this.hint = -1;
    this.wrecked = false;
  }

  get forward() { return this.body.dirToWorld(_FWD, _fwdOut); }
  get up() { return this.body.dirToWorld(_UP, _upOut); }
  get right() { return this.body.dirToWorld(_RIGHT, _rightOut); }

  update(dt) {
    if (!this.enabled) return;
    const sub = 3;
    const h = dt / sub;
    for (let i = 0; i < sub; i++) this.step(h);
    this.postStep(dt);
  }

  step(dt) {
    const b = this.body;
    const cfg = this.cfg;
    const inp = this.input;

    // steering with speed-sensitive reduction
    const spd = b.vel.length();
    const steerLimit = cfg.maxSteer * (0.30 + 0.70 / (1 + spd * 0.024));
    const target = inp.steer * steerLimit;
    const rate = 9.0;
    this.steerAngle += clamp(target - this.steerAngle, -rate * dt, rate * dt);

    // gravity
    b.applyCentralForce(_v1.set(0, GRAVITY * cfg.mass, 0));

    const fwd = b.dirToWorld(_FWD, _v2).clone();
    const up = b.dirToWorld(_UP, _v3).clone();
    const right = b.dirToWorld(_RIGHT, _v4).clone();

    let groundedCount = 0;
    let totalLoad = 0;

    for (const w of this.wheels) {
      b.localToWorld(w.local, w.worldPos);
      // road plane under the wheel
      const surf = this.track.surface(w.worldPos.x, w.worldPos.z, this.hint);
      w.surfaceKind = surf.kind;
      const n = _v5.set(surf.nx, surf.ny, surf.nz);
      const planeY = surf.y;
      const rayDir = _v6.copy(up).multiplyScalar(-1);
      const denom = rayDir.dot(n);
      let t = Infinity;
      if (denom < -1e-4) {
        // plane point: (wx, planeY, wz)
        const px = w.worldPos.x - w.worldPos.x;
        void px;
        const dx = w.worldPos.x - w.worldPos.x;
        void dx;
        const toPlane = _v1.set(0, planeY - w.worldPos.y, 0);
        t = toPlane.dot(n) / denom;
      }
      const maxT = cfg.restLen + cfg.wheelR;
      // allow the wheel to sit below the plane (penetration recovery) so the
      // car can never fall through the road on steep crests or after a wreck.
      if (t > -0.9 && t < maxT) {
        const tc = Math.max(t, 0);
        w.contact = true;
        w.compression = clamp(maxT - t, 0, maxT + 0.9);
        w.contactPoint.copy(w.worldPos).addScaledVector(up, -tc);
        w.contactNormal.copy(n);
        groundedCount++;

        // suspension
        const pv = b.pointVelocity(w.worldPos, _v1);
        const relN = pv.dot(n);
        let force = cfg.springK * w.compression - cfg.damper * relN;
        force = clamp(force, 0, cfg.springK * 2.4);
        w.susForce = Math.min(force, cfg.springK * 1.2);
        totalLoad += w.susForce;
        b.applyForce(_v2.copy(n).multiplyScalar(force), w.contactPoint);
      } else {
        w.contact = false;
        w.compression = 0;
        w.susForce = Math.max(0, w.susForce - dt * 40000);
      }
    }

    this.grounded = groundedCount;
    if (groundedCount === 0) this.airTime += dt; else this.airTime = 0;

    // tyre forces
    const boosting = inp.boost > 0.5;
    const maxSpd = boosting ? cfg.boostSpeed : cfg.topSpeed;
    const speedFrac = clamp(spd / maxSpd, 0, 1.4);
    const powerCurve = (1 - Math.pow(speedFrac, 2.2));
    const drivePerWheel = (cfg.enginePower * (boosting ? 1.55 : 1.0) * inp.throttle * Math.max(0, powerCurve)) / 2;

    for (const w of this.wheels) {
      if (!w.contact) { w.slip *= 0.9; w.skid *= 0.9; continue; }
      const n = w.contactNormal;
      // wheel heading
      let wf = _v1.copy(fwd);
      if (w.front && Math.abs(this.steerAngle) > 1e-4) {
        wf.applyAxisAngle(up, this.steerAngle);
      }
      // project onto contact plane
      wf.addScaledVector(n, -wf.dot(n)).normalize();
      const wr = _v2.crossVectors(n, wf).normalize().negate();

      const pv = b.pointVelocity(w.contactPoint, _v3);
      const vf = pv.dot(wf);
      const vr = pv.dot(wr);

      const load = w.susForce;
      const gripBase = (w.front ? cfg.gripFront : cfg.gripRear);
      const surfaceGrip = 1.0;
      let grip = gripBase * surfaceGrip;
      if (this.wrecked) grip *= 0.35;

      // lateral
      // Cornering stiffness in newtons per m/s of lateral slip. It must be of
      // the same order as the friction-circle limit (load * grip), otherwise the
      // tyres generate no lateral force at all and the car permanently slides.
      const latStiff = w.front ? 9500 : 8200;
      let fy = -clamp(vr * latStiff, -load * grip * 2.2, load * grip * 2.2);
      // longitudinal
      let fx = 0;
      const isDriven = w.front ? cfg.driveBias > 0.5 : cfg.driveBias < 0.5;
      if (isDriven) fx += drivePerWheel;
      if (inp.brake > 0) fx -= Math.sign(vf) * cfg.brakePower * inp.brake * (w.front ? 0.62 : 0.38);
      if (inp.handbrake > 0 && !w.front) {
        fx -= Math.sign(vf) * cfg.brakePower * 0.55;
        fy *= 0.30;
      }
      // rolling resistance
      fx -= vf * 9;

      // friction circle
      const maxF = load * grip;
      const mag = Math.hypot(fx, fy);
      if (mag > maxF && maxF > 0) {
        const k = maxF / mag;
        fx *= k; fy *= k;
        w.skid = clamp(w.skid + (mag / maxF - 1) * 0.35, 0, 1);
      } else {
        w.skid = Math.max(0, w.skid - dt * 2.2);
      }
      w.latSlip = Math.abs(vr);
      w.slip = Math.abs(vf) > 1 ? clamp(Math.abs(vr) / Math.abs(vf), 0, 2) : 0;

      // Longitudinal force acts at the contact patch (so braking still dives and
      // power still squats). The lateral force is applied most of the way up to
      // the centre of mass: at 2.4 g of grip with a 0.46 m CoM and a 1.62 m track
      // the true contact patch would roll the car over in every corner.
      _v4.copy(wf).multiplyScalar(fx);
      b.applyForce(_v4, w.contactPoint);
      _rollPt.copy(w.contactPoint).addScaledVector(up, (cfg.comHeight + cfg.wheelR) * 0.82);
      _v4.copy(wr).multiplyScalar(fy);
      b.applyForce(_v4, _rollPt);
      w.spinVel = vf / cfg.wheelR;
    }

    // anti-roll bars keep it planted
    for (const [a, c] of [[0, 1], [2, 3]]) {
      const wa = this.wheels[a], wb = this.wheels[c];
      if (!wa.contact && !wb.contact) continue;
      const diff = (wa.compression - wb.compression) * cfg.springK * cfg.rollStiff;
      if (wa.contact) b.applyForce(_v1.copy(wa.contactNormal).multiplyScalar(-diff), wa.worldPos);
      if (wb.contact) b.applyForce(_v1.copy(wb.contactNormal).multiplyScalar(diff), wb.worldPos);
    }

    // aero
    const v = b.vel;
    const vlen = v.length();
    if (vlen > 0.01) {
      const dragF = cfg.drag * vlen * vlen;
      b.applyCentralForce(_v1.copy(v).multiplyScalar(-dragF / vlen));
    }
    if (groundedCount > 0) {
      b.applyCentralForce(_v1.copy(up).multiplyScalar(-cfg.downforce * vlen * vlen));
    } else {
      // air control: keep the car roughly level, allow spin
      const flat = _v1.set(0, 1, 0);
      const axis = _v2.crossVectors(up, flat);
      b.applyTorque(axis.multiplyScalar(this.wrecked ? 900 : 12000 * clamp(this.airTime, 0, 1)));
      b.ang.multiplyScalar(1 - 0.9 * dt);
    }

    // yaw assist for arcade responsiveness
    if (groundedCount >= 2 && !this.wrecked) {
      // cap the assist to a yaw rate the tyres can actually support, otherwise the
      // car pirouettes while sliding straight into the barrier at high speed
      const maxLat = (cfg.gripFront + cfg.gripRear) * 0.5 * 9.81 * 1.15;
      const yawCap = maxLat / Math.max(vlen, 6);
      const yawWanted = clamp(this.steerAngle * clamp(vlen / 16, 0, 1.6) * 2.1, -yawCap, yawCap);
      const yawNow = b.ang.dot(up);
      const corr = (yawWanted - yawNow) * cfg.mass * (Math.abs(yawNow) > Math.abs(yawWanted) + 0.35 ? 2.4 : 1.05);
      b.applyTorque(_v1.copy(up).multiplyScalar(corr));
    }

    // angular damping
    b.ang.multiplyScalar(1 - clamp((this.wrecked ? 0.25 : 1.9) * dt, 0, 0.4));

    b.integrate(dt);

    // barrier / wall constraint
    this.constrainToRoad(dt);
  }

  constrainToRoad(dt) {
    const b = this.body;
    const p = this.track.project(b.pos.x, b.pos.z, this.hint);
    this.hint = p.i;
    this.trackS = p.s;
    this.trackU = p.u;
    // hard floor: the chassis may never sink through the carriageway
    const floorY = p.y + this.cfg.comHeight * 0.34;
    if (b.pos.y < floorY) {
      b.pos.y = floorY;
      if (b.vel.y < 0) b.vel.y *= -0.15;
    }
    const halfW = this.cfg.size[0] / 2;
    const limit = BARRIER_U - 0.32 - halfW * 0.75;
    if (Math.abs(p.u) > limit) {
      const side = Math.sign(p.u);
      const pen = Math.abs(p.u) - limit;
      const f = this.track.frameAt(p.s, _frameTmp);
      const nrm = _v1.copy(f.right).multiplyScalar(-side);
      // positional correction
      b.pos.addScaledVector(nrm, pen * Math.min(1, dt * 55));
      const vn = b.vel.dot(nrm);
      if (vn < 0) {
        const j = -vn * (1 + 0.32) * this.cfg.mass;
        b.vel.addScaledVector(nrm, j / this.cfg.mass);
        // scrape torque
        b.applyAngularImpulse(_v2.set(0, -side * Math.abs(vn) * 30, 0));
        const impact = Math.abs(vn);
        if (impact > 3 && this.onWallHit) {
          const cp = _v3.copy(b.pos).addScaledVector(nrm, -halfW);
          this.onWallHit(impact, cp, nrm);
        }
        this.lastWallImpact = impact;
      } else {
        // grinding
        const tangentSpeed = Math.abs(b.vel.dot(f.tan));
        this.wallHit = Math.min(1, tangentSpeed / 40);
        if (this.onWallHit && tangentSpeed > 12) {
          const cp = _v3.copy(b.pos).addScaledVector(nrm, -halfW);
          this.onWallHit(-1, cp, nrm);
        }
      }
    } else {
      this.wallHit *= 0.9;
    }
    void ROAD_HALF; void VERGE;
  }

  postStep(dt) {
    const b = this.body;
    this.speed = b.vel.length();
    // drivetrain sim for audio
    const fwdSpeed = b.vel.dot(this.forward);
    const wheelRPM = (Math.abs(fwdSpeed) / (2 * Math.PI * this.cfg.wheelR)) * 60;
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    const ratio = this.gearRatios[this.gear - 1] * this.finalDrive;
    let rpm = wheelRPM * ratio;
    if (this.shiftTimer <= 0) {
      if (rpm > 6800 && this.gear < this.gearRatios.length) { this.gear++; this.shiftTimer = 0.18; this.justShifted = 1; }
      else if (rpm < 2600 && this.gear > 1) { this.gear--; this.shiftTimer = 0.16; }
    }
    const r2 = wheelRPM * this.gearRatios[this.gear - 1] * this.finalDrive;
    this.rpm = clamp(Math.max(900, r2 + this.input.throttle * 900), 700, 7600);
    // wheel visual spin
    for (const w of this.wheels) {
      w.spin += w.spinVel * dt;
    }
    // drift metric
    const lat = Math.abs(b.vel.dot(this.right));
    this.driftAmount = clamp(lat / Math.max(6, this.speed), 0, 1);
    b.updateMatrix();
  }
}

const _FWD = new THREE.Vector3(0, 0, 1);
const _UP = new THREE.Vector3(0, 1, 0);
const _RIGHT = new THREE.Vector3(1, 0, 0);
const _fwdOut = new THREE.Vector3(), _upOut = new THREE.Vector3(), _rightOut = new THREE.Vector3();
const _rollPt = new THREE.Vector3();
const _frameTmp = {
  pos: new THREE.Vector3(), tan: new THREE.Vector3(),
  right: new THREE.Vector3(), up: new THREE.Vector3(), curv: 0, bank: 0, kind: 'open',
};

// ------------------------------------------------------------- collisions
/** Approximate a car as 3 spheres along its length for cheap, readable collisions. */
export function carSpheres(veh, out) {
  const b = veh.body;
  const l = veh.cfg.size[2];
  const r = veh.cfg.size[0] * 0.52;
  const offs = [-l * 0.30, 0, l * 0.30];
  for (let i = 0; i < 3; i++) {
    const p = out[i] || (out[i] = { c: new THREE.Vector3(), r });
    p.r = r;
    p.c.set(0, veh.cfg.size[1] * 0.42, offs[i]).applyQuaternion(b.quat).add(b.pos);
  }
  return out;
}

const _n = new THREE.Vector3(), _rel = new THREE.Vector3();
const _ra = new THREE.Vector3(), _rb = new THREE.Vector3();
const _cp = new THREE.Vector3();

/**
 * Resolve a collision between two vehicles. Returns impact info or null.
 */
export function resolveCarCollision(a, b, restitution = 0.28) {
  const sa = carSpheres(a, _sphA);
  const sb = carSpheres(b, _sphB);
  let best = null;
  for (const x of sa) {
    for (const y of sb) {
      const d = x.c.distanceTo(y.c);
      const pen = x.r + y.r - d;
      if (pen > 0 && (!best || pen > best.pen)) best = { pen, x, y, d };
    }
  }
  if (!best) return null;
  const { pen, x, y, d } = best;
  _n.subVectors(y.c, x.c);
  if (d < 1e-5) _n.set(0, 0, 1); else _n.multiplyScalar(1 / d);
  _cp.copy(x.c).addScaledVector(_n, x.r - pen * 0.5);

  const A = a.body, B = b.body;
  const totalInv = A.invMass + B.invMass;
  // positional separation
  A.pos.addScaledVector(_n, -pen * (A.invMass / totalInv) * 0.7);
  B.pos.addScaledVector(_n, pen * (B.invMass / totalInv) * 0.7);

  const va = A.pointVelocity(_cp, _v1).clone();
  const vb = B.pointVelocity(_cp, _v2).clone();
  _rel.subVectors(vb, va);
  const vn = _rel.dot(_n);
  if (vn > 0) return null;

  _ra.subVectors(_cp, A.pos);
  _rb.subVectors(_cp, B.pos);

  const jn = (-(1 + restitution) * vn) / totalInv;
  const imp = _v3.copy(_n).multiplyScalar(jn);
  A.applyImpulse(_v4.copy(imp).negate(), _cp);
  B.applyImpulse(imp, _cp);

  // tangential friction impulse (this is what makes takedowns spin cars out)
  const vt = _v5.copy(_rel).addScaledVector(_n, -vn);
  const vtl = vt.length();
  if (vtl > 0.1) {
    vt.multiplyScalar(1 / vtl);
    const jt = clamp(-vtl / totalInv, -jn * 0.9, jn * 0.9);
    const timp = _v6.copy(vt).multiplyScalar(jt);
    A.applyImpulse(_v1.copy(timp).negate(), _cp);
    B.applyImpulse(timp, _cp);
  }

  return { point: _cp.clone(), normal: _n.clone(), impulse: jn, speed: -vn };
}

const _sphA = [], _sphB = [];
