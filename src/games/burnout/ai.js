// Rival AI + attract-mode driving.
import * as THREE from 'three';
import { clamp } from './rng.js';
import { ROAD_HALF } from './track.js';

const _p = new THREE.Vector3(), _d = new THREE.Vector3();

export class RacerAI {
  constructor(car, game, opts = {}) {
    this.car = car;
    this.game = game;
    this.aggression = opts.aggression ?? 0.6;
    this.skill = opts.skill ?? 0.8;
    this.targetU = opts.lane ?? 4;
    this.laneTimer = 0;
    this.boostTimer = 0;
    this.boostCharge = 1;
    this.recovering = 0;
    this.stuckTimer = 0;
    this.rammer = opts.rammer ?? false;
    this.name = opts.name || 'RIVAL';
  }

  update(dt) {
    const car = this.car;
    const veh = car.veh;
    const t = this.game.track;
    const inp = veh.input;

    if (car.wrecked) {
      inp.throttle = 0; inp.brake = 0; inp.steer = 0; inp.boost = 0;
      this.recovering += dt;
      // Never teleport the car the crash camera is currently framing -- the
      // replay would cut to a pristine rival driving away from its own wreck.
      const held = this.game.takedownTarget === this.car &&
        (this.game.takedownCamT > 0 || this.game.cameraMode === 'crashcam');
      if (this.recovering > 3.4 && !held) this.respawn();
      return;
    }
    this.recovering = 0;

    const s = veh.trackS;
    const u = veh.trackU;
    const speed = veh.speed;

    // ---- pick a target lane
    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      this.laneTimer = 0.6 + Math.random() * 1.2;
      const base = this.baseLane ?? 4.2;
      // corner-cutting racing line: a modest offset around the base lane, not a
      // full-width swing (that used to pin cars against the barriers)
      const fAhead = t.frameAt(s + 80, _frame);
      const curv = fAhead.curv;
      let want = base + clamp(-Math.sign(curv) * Math.min(3.4, Math.abs(curv) * 900), -3.4, 3.4);

      // avoid traffic and other cars ahead
      let danger = 0;
      for (const it of this.game.traffic.items) {
        if (!it.active) continue;
        const ds = t.deltaS(it.s, s);
        if (ds < 4 || ds > 95) continue;
        const pr = t.project(it.body.pos.x, it.body.pos.z, it.hint);
        if (Math.abs(pr.u - want) < 4.2) {
          want += (want > pr.u ? 1 : -1) * Math.min(3.2, 5.4 - Math.abs(pr.u - want));
          danger = Math.max(danger, 1 - ds / 95);
        }
      }
      for (const other of this.game.cars) {
        if (other === car) continue;
        const ds = t.deltaS(other.veh.trackS, s);
        if (ds < 3 || ds > 55) continue;
        if (Math.abs(other.veh.trackU - want) < 3.4) want += (want > other.veh.trackU ? 1 : -1) * 3.6;
      }

      // aggression: line up on the player for a takedown
      const player = this.game.player;
      if (player && player !== car && !player.wrecked) {
        const ds = t.deltaS(player.veh.trackS, s);
        if (ds > -8 && ds < 46 && this.aggression > 0.4) {
          const k = clamp(1 - Math.abs(ds) / 46, 0, 1) * this.aggression;
          want = want * (1 - k) + player.veh.trackU * k;
        }
      }
      want = clamp(want, base - 5.5, base + 5.5);
      want = clamp(want, this.minU ?? -ROAD_HALF + 4.4, this.maxU ?? ROAD_HALF - 4.4);
      // ease toward the new lane so the car never asks for an impossible swerve
      this.targetU += clamp(want - this.targetU, -2.6, 2.6);
      this.dangerLevel = danger;
    }

    // ---- steering: aim the car's heading at a desired heading built from the
    // track tangent plus a lane-error correction. Working in heading space (rather
    // than chasing a look-ahead point) means a spun-out car automatically
    // counter-steers itself back onto the racing line.
    const look = clamp(9 + speed * 0.42, 12, 44);
    const ahead = t.frameAt(s + look, _frame);
    const here = t.frameAt(s + 2, _frame0);
    // Proportional-derivative lane hold expressed as a heading offset in radians.
    // The derivative term on lateral velocity is what stops the car from
    // commanding a correction it cannot cancel and sliding into the barrier.
    const latVel = veh.body.vel.dot(here.right);
    const laneErr = clamp((this.targetU - u) * 0.028 - latVel * 0.075, -0.30, 0.30);
    _d.copy(ahead.tan).multiplyScalar(0.55).addScaledVector(here.tan, 0.45)
      .addScaledVector(here.right, Math.tan(laneErr));
    _d.y = 0;
    _d.normalize();
    const fwd = veh.forward;
    const right = veh.right;
    const lateral = _d.dot(right);           // sin(heading error), + => aim right
    const forwardDot = _d.dot(fwd);
    const spun = forwardDot < 0.35;
    const yawRate = veh.body.ang.dot(veh.up);
    // Gentle proportional-derivative on heading. The old 3.4 gain saturated the
    // lock on a 7-degree error, which at 280 km/h is an instant spin.
    let steer = spun ? Math.sign(lateral || 1) * Math.min(1, 0.45 + Math.abs(lateral))
                     : clamp(lateral * 1.75 - yawRate * 0.40, -1, 1);
    if (spun) steer -= yawRate * 0.06;
    inp.steer = clamp(steer, -1, 1);
    this.spun = spun;

    // ---- speed control: scan a long way ahead and respect the braking distance
    // needed to reach each corner's physical limit.
    const latAccel = 11.0 * (0.85 + this.skill * 0.20);   // m/s^2 the tyres can hold
    const decel = 14.0;                                    // m/s^2 under braking
    let curveAhead = 0;
    let targetSpeed = veh.cfg.topSpeed * (0.58 + this.skill * 0.20);
    for (let d = 12; d <= 220; d += 16) {
      const c = Math.abs(t.frameAt(s + d, _frame).curv);
      if (d < 70) curveAhead = Math.max(curveAhead, c);
      const vCorner = Math.sqrt(latAccel / Math.max(c, 2.2e-5));
      // speed we may carry now and still bleed down to vCorner by the time we arrive
      const vAllowed = Math.sqrt(vCorner * vCorner + 2 * decel * d);
      if (vAllowed < targetSpeed) targetSpeed = vAllowed;
    }
    targetSpeed = Math.max(18, targetSpeed);
    if (this.dangerLevel > 0.6) targetSpeed *= 0.86;
    if (this.spun) targetSpeed = Math.min(targetSpeed, 26);

    // ---- forward collision avoidance. Scanned every frame (the lane picker only
    // runs a few times a second, which is far too slow at 290 km/h) so the car
    // both drifts around and closes gently on anything sharing its lane.
    let blockGap = Infinity, blockSpeed = 0, blockU = 0;
    const scan = (oS, oU, oSpd, halfW) => {
      const ds = t.deltaS(oS, s);
      if (ds < 1.5 || ds > 90) return;
      if (Math.abs(oU - u) > halfW) return;
      if (ds < blockGap) { blockGap = ds; blockSpeed = oSpd; blockU = oU; }
    };
    for (const it of this.game.traffic.items) {
      if (!it.active) continue;
      scan(it.s, it.u, it.dir > 0 ? it.speed : -it.speed, 3.9 + it.cfg.size[0] * 0.5);
    }
    for (const other of this.game.cars) {
      if (other === this.car || other.wrecked) continue;
      scan(other.veh.trackS, other.veh.trackU, other.veh.speed, 3.6);
    }
    if (blockGap < Infinity) {
      const closing = speed - blockSpeed;
      // dodge: nudge the lane target to whichever side has room
      const away = (blockU > u ? -1 : 1) * (Math.abs(blockU - u) < 0.4 ? (u > 0 ? -1 : 1) : 1);
      const urgency = clamp(1 - blockGap / 90, 0, 1);
      this.targetU = clamp(this.targetU + away * urgency * 9 * dt * 6,
        this.minU ?? -ROAD_HALF + 4.4, this.maxU ?? ROAD_HALF - 4.4);
      // ...and if we still cannot get past, match speed rather than rear-end it
      if (closing > 1 && blockGap < 6 + closing * closing / (2 * decel)) {
        targetSpeed = Math.min(targetSpeed, Math.max(blockSpeed * 0.92, 14));
      }
    }

    // running wide? shed speed until the car is back on its line
    const offLine = Math.abs(u - this.targetU);
    if (offLine > 3.5 && speed > 34) targetSpeed = Math.min(targetSpeed, speed - 5 - offLine);

    if (speed < targetSpeed * 0.98) { inp.throttle = 1; inp.brake = 0; }
    else if (speed > targetSpeed * 1.04) { inp.throttle = 0; inp.brake = clamp((speed - targetSpeed) / 9, 0, 1); }
    else { inp.throttle = 0.5; inp.brake = 0; }

    // handbrake for tight stuff
    inp.handbrake = (curveAhead > 0.011 && speed < 34 && speed > 18) ? 0.3 : 0;

    // ---- boost
    this.boostTimer -= dt;
    if (this.boostCharge > 0.25 && curveAhead < 0.0016 && speed > 30 && !this.spun && speed < targetSpeed * 1.02 && this.boostTimer <= 0) {
      inp.boost = 1;
      this.boostCharge -= dt * 0.30;
      if (this.boostCharge <= 0.02) { this.boostTimer = 5 + Math.random() * 5; }
    } else {
      inp.boost = 0;
      this.boostCharge = clamp(this.boostCharge + dt * 0.06, 0, 1);
    }
    this.car.boostActive = inp.boost > 0.5;

    // stuck / backwards recovery
    const alongRoad = fwd.dot(here.tan);
    if (alongRoad < 0.15 && speed < 12) {
      inp.throttle = 0.6;
      inp.brake = 0;
      inp.steer = clamp(lateral * 2.0, -1, 1);
    }
    this.stuckTimer = (alongRoad < 0.4 || Math.abs(u) > ROAD_HALF - 1.4) ? this.stuckTimer + dt : 0;
    if (this.stuckTimer > 4.5 && this.game.takedownTarget !== this.car) { this.respawn(); this.stuckTimer = 0; }
  }

  respawn() {
    const car = this.car;
    const t = this.game.track;
    const s = t.wrapS(this.game.player.veh.trackS + 40 + Math.random() * 90);
    car.veh.reset(s, (Math.random() - 0.5) * 10, t);
    car.repair();
    this.recovering = 0;
    this.boostCharge = 1;
  }
}

const mkFrame = () => ({
  pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(),
  up: new THREE.Vector3(), curv: 0, bank: 0, kind: 'open',
});
const _frame = mkFrame();
const _frame0 = mkFrame();
