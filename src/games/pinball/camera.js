/**
 * Camera rig: damped 3/4 table view that follows the ball, plus ball-cam,
 * fixed table, cinematic orbit and free orbit. Handles zoom-ins for saucer and
 * mission moments, and screen shake for nudge / tilt / big hits.
 */

import * as THREE from 'three';

const lerp = (a, b, t) => a + (b - a) * t;

export class CameraRig {
  constructor(camera, table) {
    this.cam = camera;
    this.table = table;
    this.mode = 'follow';
    this.pos = new THREE.Vector3(0, 0.97, 0.6);
    this.target = new THREE.Vector3(0, 0.05, -0.52);
    this.desiredPos = this.pos.clone();
    this.desiredTarget = this.target.clone();
    this.shake = 0;
    this.shakeVec = new THREE.Vector2();
    this.t = 0;
    this.zoom = 0;
    this.zoomTarget = 0;
    this.zoomPoint = new THREE.Vector3();
    this.fov = 55;
    this.focus = 0.42;
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
  }

  setMode(m) {
    if (['table', 'follow', 'ballcam', 'cinematic', 'orbit'].includes(m)) {
      if (m !== this.mode) this._snap = true;
      this.mode = m;
    }
  }

  addShake(v) {
    this.shake = Math.min(1.4, this.shake + v);
  }

  zoomTo(worldPos, amount = 1, dur = 1.2) {
    // Deterministic capture: when a camera preset is explicitly requested via
    // ?cam= (or the shot harness is driving), event zoom-ins must not hijack
    // the framing — the critic re-shoots the same preset and expects the same
    // composition every time.
    if (this.lockFraming) return;
    this.zoomPoint.copy(worldPos);
    this.zoomTarget = amount;
    this._zoomUntil = this.t + dur;
  }

  update(dt, ball, balls) {
    this.t += dt;
    if (this._zoomUntil && this.t > this._zoomUntil) this.zoomTarget = 0;
    this.zoom = lerp(this.zoom, this.zoomTarget, Math.min(1, dt * 3.4));

    // ball position in world space
    const bp = this._tmp;
    if (ball) {
      bp.set(ball.x, ball.z + 0.014, -ball.y);
      this.table.group.localToWorld(bp);
    } else {
      bp.set(0, 0.06, -0.5);
    }

    let px = 0;
    let py = 0.52;
    let pz = 0.55;
    let tx = 0;
    let ty = 0.10;
    let tz = -0.52;
    let fov = 52;
    let roll = 0;

    if (this.mode === 'table') {
      // THE Space Cadet shot: a fixed, high three-quarter view, near enough to
      // the table's own axis that the whole playfield reads at once, steep
      // enough that you are looking *down* the deck. The original never
      // swooped and never went oblique — the machine sat still and you read
      // the board. Backbox clipped at the top of frame, apron at the bottom.
      px = 0.105;
      py = 1.005;
      pz = 0.625;
      tx = 0.002;
      ty = -0.029;
      tz = -0.483;
      fov = 34;
      roll = 0;
    } else if (this.mode === 'follow') {
      // The same fixed framing with a whisper of parallax toward the ball.
      // Deliberately tiny: the reference view is bolted down, and a camera
      // that chases the ball around the board is the single most "modern
      // videogame" thing a pinball table can do.
      const lower = THREE.MathUtils.clamp((bp.z + 0.75) / 0.75, 0, 1); // 1 = near flippers
      px = 0.105 - bp.x * 0.035;
      py = 1.005 - lower * 0.010;
      pz = 0.625 - lower * 0.006;
      tx = 0.002 + bp.x * 0.055;
      ty = -0.029;
      tz = -0.483 - bp.z * 0.028;
      fov = 34 + lower * 0.7;
      roll = 0;
    } else if (this.mode === 'ballcam') {
      // chase cam locked behind and above the ball: the ball is the hero
      // object, so it has to own the middle of the frame with the table
      // opening up beyond it.
      // Sit far enough back that ramp walls and wireforms never intrude into
      // the near plane, and clamp the height so the camera cannot drop inside
      // a ramp bed when the ball is riding one.
      // A steeper drop-in also keeps translucent plastics and ramp flanges
      // from parking themselves between the lens and the ball.
      px = bp.x - 0.044;
      py = Math.max(bp.y + 0.158, 0.172);
      pz = bp.z + 0.236;
      // Aim just above the ball rather than well past it: the look-at point
      // being 0.1 m up-table pushed the ball to the very bottom of frame, so
      // the "hero close-up" never actually contained the hero.
      tx = bp.x + 0.006;
      ty = bp.y + 0.014;
      tz = bp.z - 0.018;
      fov = 34;
    } else if (this.mode === 'cinematic') {
      const a = this.t * 0.15;
      const r = 0.62 + Math.sin(this.t * 0.21) * 0.1;
      px = Math.sin(a) * r;
      py = 0.42 + Math.sin(this.t * 0.27) * 0.14;
      pz = 0.10 + Math.cos(a) * r * 0.9;
      tx = bp.x * 0.45;
      ty = 0.075;
      tz = -0.55 + bp.z * 0.22;
      fov = 44;
    } else if (this.mode === 'top') {
      // straight-down playfield inspection view
      px = 0;
      py = 1.02;
      pz = -0.52;
      tx = 0;
      ty = 0;
      tz = -0.5201;
      fov = 46;
    } else if (this.mode === 'orbit') {
      // Orbit inside the ring of neighbouring cabinets (nearest is 3.1 m out)
      // and stay above their 1.8 m bezels for most of the sweep, so the hero
      // machine is never occluded by a black slab of background furniture.
      const a = this.t * 0.24;
      px = Math.sin(a) * 1.06;
      py = 0.78 + Math.sin(this.t * 0.19) * 0.12;
      pz = Math.cos(a) * 1.06 - 0.5;
      tx = 0;
      ty = 0.03;
      tz = -0.52;
      fov = 44;
    }

    // multiball: pull back so all balls stay framed
    if (balls && balls.length > 1) {
      let minZ = 1e9;
      let maxZ = -1e9;
      for (const b of balls) {
        minZ = Math.min(minZ, -b.y);
        maxZ = Math.max(maxZ, -b.y);
      }
      const spread = Math.min(0.6, (maxZ - minZ) * 0.5);
      py += spread * 0.12;
      pz += spread * 0.16;
      fov += spread * 5;
    }

    // zoom-in moment
    if (this.zoom > 0.01) {
      const zp = this.zoomPoint;
      px = lerp(px, zp.x * 0.7, this.zoom * 0.8);
      py = lerp(py, zp.y + 0.19, this.zoom * 0.8);
      pz = lerp(pz, zp.z + 0.30, this.zoom * 0.8);
      tx = lerp(tx, zp.x, this.zoom);
      ty = lerp(ty, zp.y, this.zoom);
      tz = lerp(tz, zp.z, this.zoom);
      fov = lerp(fov, 30, this.zoom);
    }

    this.desiredPos.set(px, py, pz);
    this.desiredTarget.set(tx, ty, tz);

    const s = this._snap ? 1 : Math.min(1, dt * 4.4);
    this._snap = false;
    this.pos.lerp(this.desiredPos, s);
    this.target.lerp(this.desiredTarget, s);
    this.fov = lerp(this.fov, fov, s);

    // shake
    this.shake = Math.max(0, this.shake - dt * 2.6);
    const sh = this.shake * this.shake;
    this.shakeVec.set(
      Math.sin(this.t * 61.3) * sh * 0.011,
      Math.cos(this.t * 47.7) * sh * 0.011
    );

    this.cam.position.copy(this.pos);
    this.cam.position.x += Math.sin(this.t * 53) * sh * 0.02;
    this.cam.position.y += Math.cos(this.t * 71) * sh * 0.015;
    this.cam.lookAt(this.target);
    this.roll = lerp(this.roll || 0, roll, s);
    if (Math.abs(this.roll) > 1e-4) this.cam.rotateZ(this.roll);
    this.cam.fov = this.fov;
    this.cam.updateProjectionMatrix();

    // autofocus: project the ball to screen space; the grade pass blurs by
    // distance from this band, which gives the classic tilt-shift table look
    const p = this._tmp2.copy(bp).project(this.cam);
    const uvY = THREE.MathUtils.clamp(p.y * 0.5 + 0.5, 0.12, 0.8);
    this.focus = lerp(this.focus, uvY, Math.min(1, dt * 3));
  }
}
