// Racer physics in track space (s along the spline, x lateral, h above road)
// plus crash simulation for bike + rider.
import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep } from './rng.js';
import { ROAD_HALF_WIDTH as HW } from './track.js';

const GEARS = [15, 26, 38, 50, 63, 79];
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _hip = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _f = new THREE.Vector3();

export class Racer {
  constructor(track, bike, opts = {}) {
    this.track = track;
    this.bike = bike;
    this.group = bike.group;
    this.isPlayer = !!opts.isPlayer;
    this.isCop = !!opts.isCop;
    this.name = opts.name || 'Rider';
    this.color = opts.color ?? 0xffffff;

    this.s = opts.s ?? 0;
    this.x = opts.x ?? 0;
    this.v = opts.v ?? 0;
    this.h = 0;
    this.vy = 0;
    this.vx = 0;
    this.airborne = false;
    this.lean = 0;
    this.leanTarget = 0;
    this.pitch = 0;
    this.steer = 0;
    this.tuck = 0;
    this.gear = 1;
    this.rpm = 0.15;
    this.prevGear = 1;
    this.health = 1;
    this.stamina = 1;
    this.boost = 0;
    this.boosting = false;
    this.offroad = 0;
    this.slip = 0;
    this.lap = 1;
    this.lapProgress = 0;
    this.totalS = opts.s ?? 0;
    this.crashT = -1;
    this.hitStop = 0;
    this.punchCooldown = 0;
    this.stagger = 0;
    this.weapon = opts.weapon ?? null;
    this.wobble = 0;
    this.railCooldown = 0;
    this.railBang = 0;
    this.input = { throttle: 0, brake: 0, steer: 0, boost: false };
    this.maxSpeed = opts.maxSpeed ?? 79;
    this.power = opts.power ?? 1;
    this.crashRig = null;
    this.finished = false;

    this.pos = new THREE.Vector3();
    this.fwdW = new THREE.Vector3(0, 0, -1);
    this.rightW = new THREE.Vector3(1, 0, 0);
    this.upW = new THREE.Vector3(0, 1, 0);
    this._sm = {};
    this.sync(0);
  }

  get crashed() {
    return this.crashT >= 0;
  }

  gearFor(v) {
    for (let i = 0; i < GEARS.length; i++) if (v < GEARS[i]) return i + 1;
    return GEARS.length;
  }

  update(dt) {
    if (this.crashed) return this.updateCrash(dt);
    const t = this.track;
    const inp = this.input;

    // ---- longitudinal ----
    const boostAvail = this.boost > 0.02 && inp.boost;
    this.boosting = boostAvail;
    if (boostAvail) this.boost = Math.max(0, this.boost - dt * 0.34);
    else this.boost = Math.min(1, this.boost + dt * 0.035);

    const offroadNow = Math.abs(this.x) > HW - 0.4 ? 1 : 0;
    this.offroad = damp(this.offroad, offroadNow, 6, dt);

    const vmax = this.maxSpeed * (1 - this.offroad * 0.42) * (boostAvail ? 1.14 : 1);
    const P = 1180 * this.power * (boostAvail ? 1.5 : 1);
    const thrust = Math.min(P / Math.max(this.v, 6), 13.5 * this.power * (boostAvail ? 1.55 : 1));
    const dragK = 0.0022 * (1 + this.offroad * 1.6) * (1 - this.tuck * 0.12);
    const drag = dragK * this.v * this.v + 0.35 + this.offroad * 5.5;
    const grade = -this.track.slope(this.s) * 9.4;

    let a = thrust * inp.throttle - drag + grade;
    if (inp.brake > 0) a -= inp.brake * (16 + this.v * 0.16);
    if (this.stagger > 0) a -= this.stagger * 9;
    if (this.airborne) a = -drag * 0.5;
    this.v = clamp(this.v + a * dt, 0, vmax);
    if (this.pinnedV != null) this.v = this.pinnedV;

    // ---- lateral ----
    const sm = t.sample(this.s, this._sm);
    // Arcade steering: two serial low-pass filters used to stack up to ~1s of
    // mush. Both rates are now high enough that the bike answers the key in a
    // couple of frames while still reading as a lean rather than a teleport.
    const speedF = clamp(this.v / 34, 0.45, 1);
    const steerAuthority = lerp(13.5, 9.8, clamp(this.v / this.maxSpeed, 0, 1)) * (1 - this.offroad * 0.35);
    this.steer = damp(this.steer, clamp(inp.steer, -1, 1), 30, dt);
    const centri = -sm.curv * this.v * this.v * 0.019;
    const bankHelp = sm.bank * this.v * 0.30;
    // Gentle auto-centring once you are off the carriageway: keeps a kid who
    // holds one direction pinned against the rail instead of buried in it.
    const edge = clamp((Math.abs(this.x) - (HW - 0.2)) / 2.2, 0, 1);
    const recenter = -Math.sign(this.x || 1) * edge * edge * 6.5;
    this.vx = damp(this.vx, this.steer * steerAuthority * speedF + centri + bankHelp + recenter, 18, dt);
    if (this.wobble > 0) {
      this.vx += Math.sin(performance.now() * 0.021) * this.wobble * 7;
      this.wobble = Math.max(0, this.wobble - dt * 0.7);
    }
    this.x += this.vx * dt;

    // guardrail — scrub-and-bounce, not a health drain. Continuous scraping is
    // an arcade staple; it should cost speed and look loud, never kill you.
    if (this.railCooldown > 0) this.railCooldown -= dt;
    const lim = HW + 2.1;
    if (Math.abs(this.x) > lim) {
      this.x = Math.sign(this.x) * lim;
      const impactSpeed = Math.abs(this.vx);
      this.vx = -Math.sign(this.x) * Math.max(3.2, impactSpeed * 0.42);
      this.v *= 1 - clamp(impactSpeed * 0.012, 0, 0.14);
      this.railHit = clamp(impactSpeed / 9, 0, 1);
      // One damage tick per contact event, not per frame.
      if (this.railCooldown <= 0) {
        this.railCooldown = 1.1;
        this.health -= clamp(this.railHit, 0, 1) * 0.035;
        this.railBang = this.railHit;
      } else this.railBang = 0;
    } else {
      this.railHit = 0;
      this.railBang = 0;
    }
    this.health = clamp(this.health, 0, 1);

    // ---- vertical / jumps ----
    const crest = t.crest(this.s);
    const needed = -crest * this.v * this.v;
    if (!this.airborne && needed > 8.4 && this.v > 24) {
      this.airborne = true;
      this.vy = clamp((needed - 8.4) * 0.22, 0.6, 11);
    }
    if (this.airborne) {
      this.h += this.vy * dt;
      this.vy -= 19.6 * dt;
      if (this.h <= 0) {
        this.h = 0;
        this.airborne = false;
        this.landImpact = clamp(-this.vy / 14, 0, 1);
        this.vy = 0;
        if (this.landImpact > 0.85 && Math.abs(this.steer) > 0.65) this.crash('land');
      }
    } else {
      this.landImpact = damp(this.landImpact || 0, 0, 8, dt);
      this.h = damp(this.h, 0, 12, dt);
    }

    // ---- attitude ----
    this.leanTarget = clamp(this.steer * 0.62 + sm.curv * this.v * 0.62, -0.85, 0.85);
    if (this.airborne) this.leanTarget *= 0.4;
    this.lean = damp(this.lean, this.leanTarget, 7.5, dt);
    const accelPitch = clamp(a * 0.006, -0.09, 0.07);
    this.pitch = damp(this.pitch, -accelPitch + (this.airborne ? -0.06 : 0), 6, dt);
    this.tuck = damp(this.tuck, this.isPlayer ? clamp((this.v - 30) / 40, 0, 1) * (inp.throttle > 0.3 ? 1 : 0.3) : clamp((this.v - 30) / 45, 0, 1), 4, dt);

    // slip / screech
    const latSlip = Math.abs(this.vx) / 9 + Math.abs(sm.curv) * this.v * 0.9;
    this.slip = damp(this.slip, clamp(latSlip - 0.35, 0, 1) + (inp.brake > 0.5 && this.v > 12 ? 0.55 : 0), 8, dt);

    // ---- gears ----
    const g = this.gearFor(this.v);
    if (g !== this.gear) {
      this.prevGear = this.gear;
      this.gear = g;
      this.gearChanged = true;
    } else this.gearChanged = false;
    const lo = this.gear > 1 ? GEARS[this.gear - 2] : 0;
    const hi = GEARS[this.gear - 1];
    this.rpm = clamp(0.22 + 0.78 * ((this.v - lo) / Math.max(1, hi - lo)), 0.12, 1.02) * (inp.throttle > 0.1 ? 1 : 0.82);

    // ---- progress ----
    const ds = this.v * dt;
    this.s = t.wrap(this.s + ds);
    this.totalS += ds;
    const newLap = Math.floor(this.totalS / t.length) + 1;
    if (newLap !== this.lap) this.lapJustChanged = true;
    else this.lapJustChanged = false;
    this.lap = newLap;
    this.lapProgress = (this.totalS % t.length) / t.length;

    // ---- recovery ----
    this.stamina = clamp(this.stamina + dt * 0.13, 0, 1);
    this.health = clamp(this.health + dt * 0.03, 0, 1);
    if (this.punchCooldown > 0) this.punchCooldown -= dt;
    if (this.stagger > 0) this.stagger = Math.max(0, this.stagger - dt * 1.6);

    this.sync(dt);
  }

  sync(dt) {
    const t = this.track;
    const sm = t.sample(this.s, this._sm);
    _r.copy(sm.right);
    _u.copy(sm.up);
    _f.copy(sm.fwd);
    const roll = this.lean;
    _q.setFromAxisAngle(_f, roll);
    _r.applyQuaternion(_q);
    _u.applyQuaternion(_q);
    const crown = 0.13 * (1 - Math.pow(clamp(this.x / HW, -1, 1), 2));
    const off = this.offroad > 0.5 ? t.terrainProfile(this.s, this.x) : 0;
    this.pos.copy(sm.pos).addScaledVector(sm.right, this.x).addScaledVector(sm.up, crown + this.h + off);
    this.fwdW.copy(_f);
    this.rightW.copy(_r);
    this.upW.copy(_u);
    _m.makeBasis(_r, _u, _f.clone().negate());
    this.group.quaternion.setFromRotationMatrix(_m);
    if (this.pitch) {
      _q.setFromAxisAngle(_r, this.pitch);
      this.group.quaternion.premultiply(_q);
    }
    this.group.position.copy(this.pos);
    if (dt > 0) {
      this.bike.update(dt, { speed: this.v, steer: this.steer, lean: this.lean, tuck: this.tuck });
    }
  }

  // ------------------------------------------------------------------ crash
  crash(reason = 'hit') {
    if (this.crashed || this.finished) return false;
    this.crashT = 0;
    this.crashReason = reason;
    const dir = this.fwdW.clone().multiplyScalar(this.v * 0.85);
    const side = this.rightW.clone().multiplyScalar((Math.random() - 0.5) * 8);
    this.crashRig = {
      bikePos: this.pos.clone(),
      bikeQuat: this.group.quaternion.clone(),
      bikeVel: dir.clone().add(side).add(new THREE.Vector3(0, 3.5 + Math.random() * 3, 0)),
      bikeSpin: new THREE.Vector3(4.2 + (Math.random() - 0.5) * 3, 1.1 + (Math.random() - 0.5) * 2, 6.8 + (Math.random() - 0.5) * 3),
      // riderPos tracks the HIP JOINT in world space, not the rider group
      // origin. The group origin sits on the road under the bike, so driving it
      // directly launched the body a metre into the air and made every limb
      // swing on a 1 m lever, which is what read as detached boxes in flight.
      riderPos: this.pos.clone().addScaledVector(this.upW, 1.02),
      riderQuat: this.group.quaternion.clone(),
      riderVel: dir
        .clone()
        .multiplyScalar(0.9)
        .add(new THREE.Vector3(0, 2.7 + Math.random() * 1.6, 0))
        .add(side.clone().multiplyScalar(0.6)),
      riderSpin: new THREE.Vector3(4.5 + Math.random() * 5, (Math.random() - 0.5) * 3.5, (Math.random() - 0.5) * 5),
      groundY: this.pos.y,
    };
    this.v *= 0.35;
    this.health = Math.max(0, this.health - 0.34);
    return true;
  }

  attachCrashRoot(root) {
    this.crashRoot = root;
  }

  updateCrash(dt) {
    this.crashT += dt;
    const rig = this.crashRig;
    const t = this.track;

    // bike tumbles
    rig.bikeVel.y -= 20 * dt;
    rig.bikePos.addScaledVector(rig.bikeVel, dt);
    const sm = t.sample(this.s, this._sm);
    const groundY = sm.pos.y + 0.02;
    if (rig.bikePos.y < groundY) {
      rig.bikePos.y = groundY;
      rig.bikeVel.y *= -0.34;
      rig.bikeVel.multiplyScalar(0.82);
      rig.bikeSpin.multiplyScalar(0.7);
      this.scraping = true;
    } else this.scraping = false;
    rig.bikeVel.x *= 1 - dt * 0.9;
    rig.bikeVel.z *= 1 - dt * 0.9;
    _q.setFromEuler(new THREE.Euler(rig.bikeSpin.x * dt, rig.bikeSpin.y * dt, rig.bikeSpin.z * dt));
    rig.bikeQuat.multiply(_q);
    this.group.position.copy(rig.bikePos);
    this.group.quaternion.copy(rig.bikeQuat);

    // rider ragdoll
    rig.riderVel.y -= 21 * dt;
    rig.riderPos.addScaledVector(rig.riderVel, dt);
    const HIP_H = 0.55; // shoulder-to-hip half height: keeps the body off the tarmac
    if (rig.riderPos.y < groundY + HIP_H) {
      rig.riderPos.y = groundY + HIP_H;
      rig.riderVel.y *= -0.28;
      rig.riderVel.multiplyScalar(0.74);
      rig.riderSpin.multiplyScalar(0.66);
      this.riderSliding = true;
    } else this.riderSliding = false;
    rig.riderVel.x *= 1 - dt * 1.1;
    rig.riderVel.z *= 1 - dt * 1.1;
    _q.setFromEuler(new THREE.Euler(rig.riderSpin.x * dt, rig.riderSpin.y * dt, rig.riderSpin.z * dt));
    rig.riderQuat.multiply(_q);
    const rider = this.bike.parts.rider;
    if (rider.parent !== this.crashRoot && this.crashRoot) {
      this.crashRoot.add(rider);
      rider.visible = true;
    }
    // Place the rider so the HIP lands on rig.riderPos: the body then tumbles
    // about its own centre of mass instead of swinging around a point on the
    // road surface.
    _hip.set(0, 0.985, 0.12).applyQuaternion(rig.riderQuat);
    rider.position.copy(rig.riderPos).sub(_hip);
    rider.quaternion.copy(rig.riderQuat);

    // Protective tumble: limbs tuck in toward the torso and stay there. A
    // rigid, believable tumble beats a flail that reads as disassembly.
    const tuckT = Math.min(1, this.crashT * 3.2);
    const jitter = Math.exp(-this.crashT * 1.6) * 0.16;
    const P = this.bike.parts;
    P.torso.rotation.x = lerp(P.torso.rotation.x, -1.02, Math.min(1, dt * 9));
    P.torso.rotation.z = lerp(P.torso.rotation.z, 0.18, Math.min(1, dt * 9));
    P.armL.rotation.set(-1.15 * tuckT + Math.sin(this.crashT * 9) * jitter, 0, -0.62 * tuckT);
    P.armR.rotation.set(-1.15 * tuckT + Math.cos(this.crashT * 8) * jitter, 0, 0.62 * tuckT);
    P.legL.rotation.set(-0.95 * tuckT + Math.sin(this.crashT * 7) * jitter, 0, -0.24 * tuckT);
    P.legR.rotation.set(-0.95 * tuckT + Math.cos(this.crashT * 7.5) * jitter, 0, 0.24 * tuckT);

    this.v = damp(this.v, 0, 1.6, dt);
    this.s = t.wrap(this.s + this.v * dt);
    this.totalS += this.v * dt;

    if (this.crashT > (this.isPlayer ? 3.1 : 2.6) && !this.crashHold) this.remount();
  }

  remount() {
    this.crashT = -1;
    this.crashRig = null;
    this.scraping = false;
    const r = this.bike.parts.rider;
    this.group.add(r);
    r.position.set(0, 0, 0);
    r.quaternion.identity();
    this.bike.parts.armL.rotation.set(0.55, 0, 0.1);
    this.bike.parts.armR.rotation.set(0.55, 0, -0.1);
    this.bike.parts.legL.rotation.set(0, 0, 0);
    this.bike.parts.legR.rotation.set(0, 0, 0);
    this.v = Math.max(this.v, 11);
    this.x = clamp(this.x, -HW + 2, HW - 2);
    this.lean = 0;
    this.vx = 0;
    this.h = 0;
    this.vy = 0;
    this.airborne = false;
    this.stamina = Math.max(this.stamina, 0.45);
    this.health = Math.max(this.health, 0.42);
    this.sync(0);
  }

  hurt(amount, fromRight) {
    if (this.crashed) return false;
    this.health -= amount;
    this.stagger = Math.min(1, this.stagger + amount * 2.4);
    this.wobble = Math.min(1, this.wobble + amount * 2.6);
    this.vx += (fromRight ? -1 : 1) * amount * 26;
    if (this.health <= 0) {
      this.crash('beaten');
      return true;
    }
    return false;
  }
}

export function distanceBetween(track, a, b) {
  return track.delta(a.s, b.s);
}

export { GEARS, smoothstep };
