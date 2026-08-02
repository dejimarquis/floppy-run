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

/** Frame-rate independent exponential approach. */
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

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
      // Critical damping for a quarter car here is ~9100 Ns/m. The old 3600
      // left the body at zeta ~0.4, so it pattered over every joint and never
      // settled -- the "car is jittering rather than sitting planted" defect.
      damper: 6400,
      maxSteer: 0.52,
      enginePower: 54000,
      brakePower: 26000,
      // Human-readable speeds. 317 km/h gave the player less than a second to
      // read a corner; the *sensation* of speed comes from camera height, FOV
      // kick and motion blur, not from the number on the dial.
      topSpeed: 55,
      boostSpeed: 62,
      gripFront: 2.65,
      gripRear: 2.45,
      drag: 0.9,
      downforce: 3.4,
      // A car that lolls +-18 degrees while driving straight reads as broken
      // animation. Stiffer bar + more suspension damping keeps it planted.
      rollStiff: 0.95,
      comHeight: 0.46,
      driveBias: 0.25, // 0 = RWD, 1 = FWD
    }, opts.cfg || {});

    this.track = opts.track;
    this.body = new Body({ mass: cfg.mass, size: cfg.size });
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, boost: 0 };
    this.steerAngle = 0;
    // Normalised steering command, ramped (see step()). Kept separate from
    // steerAngle so the speed-sensitive lock limit can move without the ramp
    // having to chase it.
    this.steerRaw = 0;
    this.steerCmd = 0;
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
    this.wallContact = 0;
    this.wallSide = 0;
    this.wallDir = 1;
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
    this.steerRaw = 0; this.steerCmd = 0; this.steerAngle = 0;
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
    let cmd = clamp(inp.steer, -1, 1);
    // While scraping a barrier, steering further into it only scrubs the tyres,
    // so the lock is trimmed -- but only trimmed. Cutting it to 0.22 (as this
    // did) left the player with almost no wheel at exactly the moment they are
    // trying to sort the car out, and the barrier corrector now handles the
    // stall case on its own.
    if (this.wallContact > 0 && Math.sign(cmd) === this.wallSide && cmd !== 0) {
      cmd *= 0.55;
    }
    // Slew-rate limited ramp plus light smoothing, NOT an exponential chase.
    // The old `rate = 9.0` against a 0.52 rad lock reached full lock in ~60ms,
    // which is a step function, not a steering input: it is what made the car
    // feel like it was being driven by a computer. STEER_SLEW = 5 units/sec is
    // ~0.20s centre-to-full-lock; the damp on top adds a little more lag so it
    // settles around 0.25s. Returning to centre is deliberately quicker than
    // committing to a lock, which is how a real driver unwinds a wheel.
    //
    // `instantSteer` opts a vehicle out: the ramp models a human's hands, and
    // putting the rival AI (or the player's own autopilot) behind 0.25s of lag
    // just makes them understeer into the barriers.
    if (this.instantSteer) {
      this.steerRaw = cmd;
      this.steerCmd = damp(this.steerCmd, cmd, 22, dt);
    } else {
      const SLEW = 5.0;
      const slew = SLEW * (Math.abs(cmd) < Math.abs(this.steerRaw) ? 1.8 : 1);
      this.steerRaw += clamp(cmd - this.steerRaw, -slew * dt, slew * dt);
      this.steerCmd = damp(this.steerCmd, this.steerRaw, 14, dt);
    }
    this.steerAngle = this.steerCmd * steerLimit;

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
      // Applying the lateral force ABOVE the centre of mass rolls the car into
      // the corner like a motorbike; the old 0.82 factor put it 0.21 m above
      // the CoM and, with an underdamped roll mode, the body lolled +-18 deg
      // while driving straight. Sit it essentially AT the CoM height so the
      // chassis stays planted and readable, and let the anti-roll bar do the
      // rest.
      _rollPt.copy(w.contactPoint).addScaledVector(up, (cfg.comHeight + cfg.wheelR) * 0.90);
      _v4.copy(wr).multiplyScalar(fy);
      b.applyForce(_v4, _rollPt);
      w.spinVel = vf / cfg.wheelR;
    }

    // Anti-roll bars keep it planted -- or they did not: the shipped signs were
    // INVERTED. `diff` is positive when wheel A is the more compressed (loaded)
    // corner, and the code then pushed A *down* and B *up*, which is a PRO-roll
    // bar. It is why the chassis lolled +-18 deg on a straight, and why simply
    // raising rollStiff tipped the car onto two wheels and left it there
    // (measured: compressions 0 / 0.79 / 0 / 0.80, i.e. resting on its side).
    // A real bar pushes UP on the loaded corner and DOWN on the unloaded one.
    for (const [a, c] of [[0, 1], [2, 3]]) {
      const wa = this.wheels[a], wb = this.wheels[c];
      if (!wa.contact || !wb.contact) continue;
      const diff = clamp(
        (wa.compression - wb.compression) * cfg.springK * cfg.rollStiff,
        -cfg.springK * 0.45, cfg.springK * 0.45);
      b.applyForce(_v1.copy(wa.contactNormal).multiplyScalar(diff), wa.worldPos);
      b.applyForce(_v1.copy(wb.contactNormal).multiplyScalar(-diff), wb.worldPos);
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

    // Self-righting. A car resting on its flank slides for as long as it keeps
    // any speed at all -- it never wrecks, never recovers, and the player is
    // left watching an unreadable sideways car. Once it is more than ~63 deg
    // off level with barely any wheels down, roll it back onto its feet.
    if (!this.wrecked && groundedCount <= 2 && up.y < 0.45) {
      const axis = _v2.crossVectors(up, _v1.set(0, 1, 0));
      b.applyTorque(axis.multiplyScalar(11000));
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

    // Hard rate cap. Nothing a driveable car does should look like a blender:
    // a glancing traffic hit was measured spinning the chassis at 7.05 rad/s
    // (404 deg/s), which is a full rotation inside two frames of a 60Hz camera
    // and reads as pure noise. Wrecks get a looser ceiling so a real crash can
    // still tumble, but even they stay legible.
    const angCap = this.wrecked ? 7.5 : 3.4;
    const angLen = b.ang.length();
    if (angLen > angCap) b.ang.multiplyScalar(angCap / angLen);

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
      // Arcade wall-ride, applied on every contact frame (not just while
      // grinding). Left alone, the scrape torque pivots the car nose-in, the
      // tyres then scrub sideways against the barrier and full throttle nets
      // walking pace -- which is exactly the "the game is fighting me" feeling
      // we are trying to remove. Burnout snaps you parallel and lets you slide;
      // so do we: bleed the induced spin, yaw the chassis back along the wall,
      // and redirect the existing speed rather than deleting it.
      this.wallSide = side;
      this.wallContact = 0.14;
      const fw = this.forward;
      // Which way along the barrier are we facing? At exactly 90deg this dot
      // product is zero and the sign flips frame to frame, which is precisely
      // how the car used to end up pinned nose-first into the wall at a dead
      // stop: the corrector had no preferred direction and cancelled itself
      // out. Latch the last confident answer through the ambiguous band.
      const along = fw.dot(f.tan);
      if (Math.abs(along) > 0.2) this.wallDir = along >= 0 ? 1 : -1;
      else if (!this.wallDir) this.wallDir = b.vel.dot(f.tan) >= 0 ? 1 : -1;
      _v4w.copy(f.tan).multiplyScalar(this.wallDir);
      const yawErr = Math.atan2(
        fw.x * _v4w.z - fw.z * _v4w.x,
        fw.x * _v4w.x + fw.z * _v4w.z);
      // Drive the yaw *rate* toward a bounded target instead of accumulating
      // into it. The shipped `ang.y += yawErr * dt*10 * 7` was an undamped P
      // term fighting a separate `ang.y *= 1 - dt*8` decay: it overshot,
      // oscillated, and could spin the car to 7 rad/s (400 deg/s).
      const wantYaw = clamp(yawErr * 2.4, -2.6, 2.6);
      b.ang.y += (wantYaw - b.ang.y) * Math.min(1, dt * 9);
      const tanSpeed = b.vel.dot(f.tan);
      const horiz = Math.hypot(b.vel.x, b.vel.z);
      if (horiz > 0.5) {
        _v2.copy(f.tan).multiplyScalar(horiz * (tanSpeed >= 0 ? 1 : -1));
        _v2.y = b.vel.y;
        b.vel.lerp(_v2, Math.min(1, dt * 6.0));
      }
      // Anti-pin. Nose-in against the barrier the tyres point at the wall, so
      // full throttle produces nothing at all and the car simply parks there
      // until the recovery watchdog notices. Give the driver a shove along the
      // barrier so holding accelerate always eventually means "go".
      // The shove has to beat wall friction outright: at mass*7 and only below
      // 8 m/s a kid holding one direction still ended the test parked at
      // <1 m/s in 2 runs out of 3. Stronger, and active over a wider band.
      if (this.speed < 22 && this.input.throttle > 0.15 && !this.wrecked) {
        const need = clamp(1 - this.speed / 22, 0.25, 1);
        b.applyCentralForce(_v2.copy(f.tan)
          .multiplyScalar(this.wallDir * this.cfg.mass * 26 * need * this.input.throttle));
      }

      if (vn < 0) {
        const j = -vn * (1 + 0.32) * this.cfg.mass;
        b.vel.addScaledVector(nrm, j / this.cfg.mass);
        // A scrape should scuff the car, not spin it. The shipped *10 kick was
        // enough to put a 40 m/s glancing blow into a full pirouette.
        b.applyAngularImpulse(_v2.set(0, -side * Math.min(6, Math.abs(vn)) * 3, 0));
        const impact = Math.abs(vn);
        if (impact > 3 && this.onWallHit) {
          const cp = _v3.copy(b.pos).addScaledVector(nrm, -halfW);
          this.onWallHit(impact, cp, nrm);
        }
        this.lastWallImpact = impact;
      } else {
        const tangentSpeed = Math.abs(tanSpeed);
        this.wallHit = Math.min(1, tangentSpeed / 40);
        if (this.onWallHit && tangentSpeed > 12) {
          const cp = _v3.copy(b.pos).addScaledVector(nrm, -halfW);
          this.onWallHit(-1, cp, nrm);
        }
      }
    } else {
      this.wallHit *= 0.9;
    }
    this.wallContact = Math.max(0, (this.wallContact || 0) - dt);
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
const _v4w = new THREE.Vector3();
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
