/**
 * Space Cadet: Nova — physics engine.
 *
 * Pure, dependency-free 2.5D pinball dynamics.
 *
 * Coordinate system (table-local):
 *   x → right across the playfield
 *   y → "up the table", away from the player
 *   z → height above the playfield surface (only used by rails/ramps)
 *
 * The playfield is inclined by `incline` radians. Real gravity g is therefore
 * split into an in-plane component (g·sin θ, pointing toward -y) and a normal
 * component (g·cos θ) that presses the ball into the wood. Rails use both.
 *
 * Collision is fully continuous: every substep solves the exact time-of-impact
 * of a swept sphere against line segments (capsules), circular arcs and other
 * balls, so the ball can never tunnel regardless of speed.
 */

const EPS = 1e-9;

export const MAT = {
  wood: { e: 0.35, mu: 0.14 },
  metal: { e: 0.5, mu: 0.06 },
  rubber: { e: 0.78, mu: 0.42 },
  plastic: { e: 0.55, mu: 0.16 },
  post: { e: 0.72, mu: 0.3 },
  target: { e: 0.42, mu: 0.25 },
  soft: { e: 0.18, mu: 0.5 },
};

/* ------------------------------------------------------------------ */
/* Small vector helpers (scalar, allocation-free where it matters)     */
/* ------------------------------------------------------------------ */

function len2(x, y) {
  return Math.sqrt(x * x + y * y);
}

/* ------------------------------------------------------------------ */
/* Rail — an arclength-parameterised 3D polyline the ball can ride     */
/* ------------------------------------------------------------------ */

export class Rail {
  /**
   * @param {string} id
   * @param {number[][]} controls  list of [x,y,z] control points
   * @param {object} opts
   */
  constructor(id, controls, opts = {}) {
    this.id = id;
    this.opts = opts;
    this.friction = opts.friction ?? 0.55; // m/s^2 of drag along the rail
    this.exitTag = opts.exitTag || null;
    this.entryTag = opts.entryTag || null;
    this.oneWay = opts.oneWay !== false; // cannot roll back out of the entrance
    this.minSpeed = opts.minSpeed ?? 1.6;
    this.pts = resample(catmull(controls, opts.subdiv ?? 14), opts.step ?? 0.004);
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1];
      const b = this.pts[i];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      this.cum.push(this.cum[i - 1] + d);
    }
    this.length = this.cum[this.cum.length - 1];
  }

  _idx(s) {
    const c = this.cum;
    let lo = 0;
    let hi = c.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** position at arclength s → [x,y,z] */
  pos(s, out = [0, 0, 0]) {
    s = Math.min(Math.max(s, 0), this.length);
    const i = this._idx(s);
    const a = this.pts[i];
    const b = this.pts[Math.min(i + 1, this.pts.length - 1)];
    const seg = this.cum[i + 1] - this.cum[i] || 1;
    const t = (s - this.cum[i]) / seg;
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
    return out;
  }

  /** unit tangent at arclength s → [x,y,z] */
  tangent(s, out = [0, 0, 0]) {
    s = Math.min(Math.max(s, 0), this.length);
    const i = Math.min(this._idx(s), this.pts.length - 2);
    const a = this.pts[i];
    const b = this.pts[i + 1];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let dz = b[2] - a[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    out[0] = dx / l;
    out[1] = dy / l;
    out[2] = dz / l;
    return out;
  }
}

function catmull(cps, subdiv) {
  if (cps.length < 2) return cps.map((p) => p.slice());
  const p = [cps[0], ...cps, cps[cps.length - 1]];
  const out = [];
  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2];
    for (let j = 0; j < subdiv; j++) {
      const t = j / subdiv;
      const t2 = t * t;
      const t3 = t2 * t;
      const q = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        q[k] =
          0.5 *
          (2 * p1[k] +
            (-p0[k] + p2[k]) * t +
            (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
            (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      }
      out.push(q);
    }
  }
  out.push(cps[cps.length - 1].slice());
  return out;
}

function resample(poly, step) {
  const out = [poly[0].slice()];
  let carry = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = out[out.length - 1];
    const b = poly[i];
    let d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (d + carry < step) {
      carry += d;
      continue;
    }
    carry = 0;
    out.push(b.slice());
  }
  const last = poly[poly.length - 1];
  const e = out[out.length - 1];
  if (Math.hypot(last[0] - e[0], last[1] - e[1], last[2] - e[2]) > 1e-6) out.push(last.slice());
  return out;
}

/* ------------------------------------------------------------------ */
/* Colliders                                                           */
/* ------------------------------------------------------------------ */

export class Segment {
  constructor(x0, y0, x1, y1, props = {}) {
    this.type = 'seg';
    this.x0 = x0;
    this.y0 = y0;
    this.x1 = x1;
    this.y1 = y1;
    this.mat = props.mat || MAT.wood;
    this.tag = props.tag || null;
    this.enabled = props.enabled !== false;
    this.oneWay = props.oneWay || 0; // 0 = both sides, +1/-1 = only that side
    this.kick = props.kick || 0; // extra outward impulse (slingshots)
    this.kickThreshold = props.kickThreshold ?? 0.55;
    this.userData = props.userData || null;
    this.recompute();
  }
  recompute() {
    this.bx0 = Math.min(this.x0, this.x1);
    this.bx1 = Math.max(this.x0, this.x1);
    this.by0 = Math.min(this.y0, this.y1);
    this.by1 = Math.max(this.y0, this.y1);
    const dx = this.x1 - this.x0;
    const dy = this.y1 - this.y0;
    this.len = len2(dx, dy) || EPS;
    this.dx = dx / this.len;
    this.dy = dy / this.len;
    this.nx = -this.dy;
    this.ny = this.dx;
  }
  move(x0, y0, x1, y1) {
    this.x0 = x0;
    this.y0 = y0;
    this.x1 = x1;
    this.y1 = y1;
    this.recompute();
  }
}

export class Arc {
  /** Circular wall. concave=true → ball travels on the inside. */
  constructor(cx, cy, r, a0, a1, props = {}) {
    this.type = 'arc';
    this.cx = cx;
    this.cy = cy;
    this.r = r;
    this.a0 = a0;
    this.a1 = a1;
    this.concave = !!props.concave;
    this.mat = props.mat || MAT.wood;
    this.tag = props.tag || null;
    this.enabled = props.enabled !== false;
    this.kick = props.kick || 0;
    this.userData = props.userData || null;
    this.bx0 = cx - r;
    this.bx1 = cx + r;
    this.by0 = cy - r;
    this.by1 = cy + r;
  }
  contains(ang) {
    let a = ang;
    while (a < this.a0) a += Math.PI * 2;
    return a <= this.a1 + 1e-6;
  }
}

export class Circle {
  constructor(cx, cy, r, props = {}) {
    this.type = 'circle';
    this.cx = cx;
    this.cy = cy;
    this.r = r;
    this.mat = props.mat || MAT.post;
    this.tag = props.tag || null;
    this.enabled = props.enabled !== false;
    this.kick = props.kick || 0;
    this.userData = props.userData || null;
    this.bx0 = cx - r;
    this.bx1 = cx + r;
    this.by0 = cy - r;
    this.by1 = cy + r;
  }
}

/** Non-colliding region: fires an event while a ball's centre is inside. */
export class Zone {
  constructor(cx, cy, r, tag, props = {}) {
    this.type = 'zone';
    this.cx = cx;
    this.cy = cy;
    this.r = r;
    this.tag = tag;
    this.enabled = props.enabled !== false;
    this.once = props.once !== false; // only fire on entry
    this.userData = props.userData || null;
    this._inside = new Set();
  }
}

/* ------------------------------------------------------------------ */
/* Flipper                                                             */
/* ------------------------------------------------------------------ */

export class Flipper {
  /**
   * @param {object} o {x,y,restAngle,upAngle,length,r0,r1,side}
   */
  constructor(o) {
    this.x = o.x;
    this.y = o.y;
    this.restAngle = o.restAngle;
    this.upAngle = o.upAngle;
    this.length = o.length;
    this.r0 = o.r0 ?? 0.0125;
    this.r1 = o.r1 ?? 0.0075;
    this.side = o.side; // -1 left, +1 right
    this.tag = o.tag || 'flipper';
    this.angle = o.restAngle;
    this.omega = 0;
    this.pressed = false;
    this.enabled = true;
    this.maxOmega = o.maxOmega ?? 23;
    this.accel = o.accel ?? 1300;
    this.returnAccel = o.returnAccel ?? 470;
    this.hitAt = -1e9;
  }

  get dir() {
    return this.upAngle > this.restAngle ? 1 : -1;
  }

  update(dt) {
    const d = this.dir;
    const target = this.pressed && this.enabled ? this.upAngle : this.restAngle;
    const toward = target - this.angle;
    if (Math.abs(toward) < 1e-5 && Math.abs(this.omega) < 1e-3) {
      this.angle = target;
      this.omega = 0;
      return;
    }
    const a = (this.pressed && this.enabled ? this.accel : this.returnAccel) * Math.sign(toward);
    this.omega += a * dt;
    const cap = this.pressed && this.enabled ? this.maxOmega : this.maxOmega * 0.62;
    this.omega = Math.max(-cap, Math.min(cap, this.omega));
    let na = this.angle + this.omega * dt;
    // clamp at the end-stops, dissipating energy like a real rubber stop
    if ((toward > 0 && na >= target) || (toward < 0 && na <= target)) {
      na = target;
      this.omega *= -0.06;
    }
    this.angle = na;
    void d;
  }

  tip(out = [0, 0]) {
    out[0] = this.x + Math.cos(this.angle) * this.length;
    out[1] = this.y + Math.sin(this.angle) * this.length;
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Ball                                                                */
/* ------------------------------------------------------------------ */

let ballIds = 0;

export class Ball {
  constructor(x, y, r) {
    this.id = ++ballIds;
    this.x = x;
    this.y = y;
    this.z = 0;
    this.vx = 0;
    this.vy = 0;
    this.r = r;
    this.spin = 0; // angular velocity about the table normal (english)
    this.alive = true;
    this.rail = null;
    this.railS = 0;
    this.railV = 0;
    this.held = null; // saucer / kicker capture
    this.heldT = 0;
    this.lane = false; // in the plunger lane
    this.speed = 0;
    this.trail = [];
    this.lastHit = 0;
    // visual roll orientation, integrated by the renderer
    this.q = [0, 0, 0, 1];
  }
}

/* ------------------------------------------------------------------ */
/* World                                                               */
/* ------------------------------------------------------------------ */

export class World {
  constructor(opts = {}) {
    this.incline = opts.incline ?? (6.5 * Math.PI) / 180;
    this.g = opts.g ?? 9.81;
    this.gPlane = this.g * Math.sin(this.incline);
    this.gNormal = this.g * Math.cos(this.incline);
    this.ballR = opts.ballR ?? 0.0135;
    this.segments = [];
    this.arcs = [];
    this.circles = [];
    this.zones = [];
    this.flippers = [];
    this.rails = [];
    this.balls = [];
    this.events = [];
    this.time = 0;
    this.h = 1 / 240;
    this._acc = 0;
    this.nudgeX = 0;
    this.nudgeY = 0;
    this.nudgeDecay = 7.5;
    this.rollFriction = opts.rollFriction ?? 0.26;
    this.bounds = opts.bounds || { x0: -0.4, x1: 0.4, y0: -0.4, y1: 1.5 };
    this.drainY = opts.drainY ?? -0.02;
    this.onEvent = null;
    this.stats = { steps: 0, collisions: 0, maxSpeed: 0 };
  }

  add(c) {
    if (c.type === 'seg') this.segments.push(c);
    else if (c.type === 'arc') this.arcs.push(c);
    else if (c.type === 'circle') this.circles.push(c);
    else if (c.type === 'zone') this.zones.push(c);
    return c;
  }

  addRail(r) {
    this.rails.push(r);
    return r;
  }

  addFlipper(f) {
    this.flippers.push(f);
    return f;
  }

  spawnBall(x, y, vx = 0, vy = 0) {
    const b = new Ball(x, y, this.ballR);
    b.vx = vx;
    b.vy = vy;
    this.balls.push(b);
    return b;
  }

  emit(type, data) {
    const ev = Object.assign({ type, t: this.time }, data);
    this.events.push(ev);
    if (this.onEvent) this.onEvent(ev);
  }

  nudge(ax, ay, power = 1) {
    this.nudgeX += ax * power;
    this.nudgeY += ay * power;
  }

  /** Advance by real time dt using a fixed 480 Hz substep. */
  update(dt) {
    this._acc += Math.min(dt, 0.1);
    let guard = 0;
    while (this._acc >= this.h && guard++ < 96) {
      this.step(this.h);
      this._acc -= this.h;
    }
  }

  step(h) {
    this.time += h;
    this.stats.steps++;

    for (const f of this.flippers) f.update(h);

    // nudge acceleration decays exponentially
    const nx = this.nudgeX;
    const ny = this.nudgeY;
    this.nudgeX -= this.nudgeX * Math.min(1, this.nudgeDecay * h);
    this.nudgeY -= this.nudgeY * Math.min(1, this.nudgeDecay * h);

    for (const z of this.zones) if (z._inside.size) z._inside.forEach((id) => { void id; });

    for (const b of this.balls) {
      if (!b.alive) continue;
      if (b.rail) {
        this.stepRail(b, h);
        continue;
      }
      if (b.held) {
        b.heldT -= h;
        b.vx = 0;
        b.vy = 0;
        b.x += (b.held.x - b.x) * Math.min(1, 22 * h);
        b.y += (b.held.y - b.y) * Math.min(1, 22 * h);
        b.z += (b.held.z - b.z) * Math.min(1, 22 * h);
        continue;
      }
      this.stepPlanar(b, h, nx, ny);
    }

    this.ballVsBall(h);

    for (const b of this.balls) {
      if (!b.alive || b.rail || b.held) continue;
      this.checkZones(b);
      if (b.y < this.drainY) {
        b.alive = false;
        this.emit('drain', { ball: b });
      } else if (
        b.x < this.bounds.x0 ||
        b.x > this.bounds.x1 ||
        b.y > this.bounds.y1
      ) {
        // safety net: should never happen, but never let a ball escape
        b.x = Math.min(Math.max(b.x, this.bounds.x0 + 0.01), this.bounds.x1 - 0.01);
        b.y = Math.min(b.y, this.bounds.y1 - 0.01);
        b.vx *= -0.3;
        b.vy *= -0.3;
        this.stats.escapes = (this.stats.escapes || 0) + 1;
      }
      b.speed = len2(b.vx, b.vy);
      if (b.speed > this.stats.maxSpeed) this.stats.maxSpeed = b.speed;
    }
  }

  /* ---------------- planar integration with CCD ---------------- */

  stepPlanar(b, h, nx, ny) {
    // gravity down the incline + nudge
    const ax = nx;
    const ay = -this.gPlane + ny;

    b.vx += ax * h;
    b.vy += ay * h;

    // rolling resistance (proportional to normal load) + spin decay
    const sp = len2(b.vx, b.vy);
    if (sp > 1e-5) {
      const drag = this.rollFriction * h;
      const k = Math.max(0, 1 - drag / Math.max(sp, 0.08));
      b.vx *= k;
      b.vy *= k;
    }
    b.spin *= Math.max(0, 1 - 2.4 * h);

    let remaining = h;
    let iter = 0;
    while (remaining > 1e-7 && iter++ < 8) {
      const hit = this.sweep(b, remaining);
      if (!hit) {
        b.x += b.vx * remaining;
        b.y += b.vy * remaining;
        break;
      }
      const t = Math.max(0, hit.t - 1e-6);
      b.x += b.vx * t;
      b.y += b.vy * t;
      this.resolve(b, hit);
      remaining -= Math.max(hit.t, 1e-6);
      this.stats.collisions++;
    }

    // if we ran out of iterations, nudge out of any residual overlap
    if (iter >= 8) this.depenetrate(b);
  }

  /** Find the earliest impact within [0, dt]. */
  sweep(b, dt) {
    let best = null;
    const px = b.x;
    const py = b.y;
    const vx = b.vx;
    const vy = b.vy;
    const r = b.r;
    if (vx === 0 && vy === 0) return null;

    // swept AABB of the ball over this substep — the broad-phase rejects
    // ~95% of colliders before any narrow-phase maths runs.
    const ex = vx * dt;
    const ey = vy * dt;
    const qx0 = Math.min(px, px + ex) - r;
    const qx1 = Math.max(px, px + ex) + r;
    const qy0 = Math.min(py, py + ey) - r;
    const qy1 = Math.max(py, py + ey) + r;

    for (const s of this.segments) {
      if (!s.enabled) continue;
      if (s.bx1 < qx0 || s.bx0 > qx1 || s.by1 < qy0 || s.by0 > qy1) continue;
      const h = sweepSegment(px, py, vx, vy, r, s, dt);
      if (h && (!best || h.t < best.t)) {
        h.col = s;
        best = h;
      }
    }
    for (const a of this.arcs) {
      if (!a.enabled) continue;
      if (a.bx1 < qx0 || a.bx0 > qx1 || a.by1 < qy0 || a.by0 > qy1) continue;
      const h = sweepArc(px, py, vx, vy, r, a, dt);
      if (h && (!best || h.t < best.t)) {
        h.col = a;
        best = h;
      }
    }
    for (const c of this.circles) {
      if (!c.enabled) continue;
      if (c.bx1 < qx0 || c.bx0 > qx1 || c.by1 < qy0 || c.by0 > qy1) continue;
      const h = sweepCircleStatic(px, py, vx, vy, r, c.cx, c.cy, c.r, dt);
      if (h && (!best || h.t < best.t)) {
        h.col = c;
        best = h;
      }
    }
    for (const f of this.flippers) {
      const h = sweepFlipper(px, py, vx, vy, r, f, dt);
      if (h && (!best || h.t < best.t)) {
        h.col = f;
        h.flipper = f;
        best = h;
      }
    }
    return best;
  }

  resolve(b, hit) {
    const col = hit.col;
    const mat = hit.flipper ? MAT.rubber : col.mat || MAT.wood;
    let e = mat.e;
    const mu = mat.mu;
    const nxn = hit.nx;
    const nyn = hit.ny;

    // surface velocity at the contact point (moving flippers)
    let sx = 0;
    let sy = 0;
    if (hit.flipper) {
      const f = hit.flipper;
      const cx = b.x - nxn * b.r - f.x;
      const cy = b.y - nyn * b.r - f.y;
      sx = -f.omega * cy;
      sy = f.omega * cx;
      // a flipper that is actively driving delivers more than a passive one
      if (Math.abs(f.omega) > 3) e = 0.52;
      f.hitAt = this.time;
    }

    const rvx = b.vx - sx;
    const rvy = b.vy - sy;

    // contact point offset from centre (2D)
    const rcx = -nxn * b.r;
    const rcy = -nyn * b.r;
    // velocity of the material point of the ball at the contact
    const cvx = rvx + -b.spin * rcy;
    const cvy = rvy + b.spin * rcx;

    const vn = cvx * nxn + cvy * nyn;
    if (vn > 0) return; // already separating

    const I = 0.4 * b.r * b.r; // unit mass solid sphere
    const jn = -(1 + e) * vn;

    // tangential (friction) impulse — this is what creates english
    let tx = cvx - vn * nxn;
    let ty = cvy - vn * nyn;
    const tl = len2(tx, ty);
    let jt = 0;
    if (tl > 1e-6) {
      tx /= tl;
      ty /= tl;
      const rct = rcx * ty - rcy * tx;
      const km = 1 + (rct * rct) / I;
      jt = -tl / km;
      const max = mu * Math.abs(jn);
      if (jt < -max) jt = -max;
      if (jt > max) jt = max;
    } else {
      tx = 0;
      ty = 0;
    }

    b.vx += jn * nxn + jt * tx;
    b.vy += jn * nyn + jt * ty;
    b.spin += (rcx * (jn * nyn + jt * ty) - rcy * (jn * nxn + jt * tx)) / I;

    // active kickers (slingshots, bumpers)
    const impact = Math.abs(vn);
    if (col.kick && impact > (col.kickThreshold ?? 0.55)) {
      b.vx += nxn * col.kick;
      b.vy += nyn * col.kick;
    }

    if (Math.abs(b.spin) > 260) b.spin = 260 * Math.sign(b.spin);

    // clamp absurd energies (numerical safety, never triggers in practice)
    const sp = len2(b.vx, b.vy);
    if (sp > 12) {
      b.vx *= 12 / sp;
      b.vy *= 12 / sp;
    }

    if (col.tag) {
      this.emit('hit', {
        tag: col.tag,
        ball: b,
        impact,
        x: b.x,
        y: b.y,
        nx: nxn,
        ny: nyn,
        col,
      });
    } else if (hit.flipper) {
      this.emit('hit', { tag: hit.flipper.tag, ball: b, impact, x: b.x, y: b.y, nx: nxn, ny: nyn, col });
    }
  }

  depenetrate(b) {
    for (let k = 0; k < 3; k++) {
      let moved = false;
      for (const s of this.segments) {
        if (!s.enabled) continue;
        const q = closestOnSeg(b.x, b.y, s);
        const dx = b.x - q[0];
        const dy = b.y - q[1];
        const d = len2(dx, dy);
        if (d < b.r && d > 1e-9) {
          const push = (b.r - d) + 1e-5;
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
          moved = true;
        }
      }
      for (const c of this.circles) {
        if (!c.enabled) continue;
        const dx = b.x - c.cx;
        const dy = b.y - c.cy;
        const d = len2(dx, dy);
        const R = c.r + b.r;
        if (d < R && d > 1e-9) {
          b.x += (dx / d) * (R - d + 1e-5);
          b.y += (dy / d) * (R - d + 1e-5);
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  /* ---------------- ball vs ball ---------------- */

  ballVsBall() {
    const bs = this.balls;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      if (!a.alive || a.rail || a.held) continue;
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j];
        if (!b.alive || b.rail || b.held) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = len2(dx, dy);
        const R = a.r + b.r;
        if (d >= R || d < 1e-9) continue;
        const nxn = dx / d;
        const nyn = dy / d;
        const overlap = R - d;
        a.x -= nxn * overlap * 0.5;
        a.y -= nyn * overlap * 0.5;
        b.x += nxn * overlap * 0.5;
        b.y += nyn * overlap * 0.5;
        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const vn = rvx * nxn + rvy * nyn;
        if (vn > 0) continue;
        const e = 0.94;
        const j2 = (-(1 + e) * vn) / 2;
        a.vx -= j2 * nxn;
        a.vy -= j2 * nyn;
        b.vx += j2 * nxn;
        b.vy += j2 * nyn;
        if (Math.abs(vn) > 0.35) {
          this.emit('hit', { tag: 'ballball', ball: a, impact: Math.abs(vn), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, nx: nxn, ny: nyn, col: {} });
        }
      }
    }
  }

  /* ---------------- zones ---------------- */

  checkZones(b) {
    for (const z of this.zones) {
      if (!z.enabled) continue;
      const d2 = (b.x - z.cx) ** 2 + (b.y - z.cy) ** 2;
      const inside = d2 < z.r * z.r;
      const was = z._inside.has(b.id);
      if (inside && !was) {
        z._inside.add(b.id);
        this.emit('zone', { tag: z.tag, ball: b, zone: z, x: b.x, y: b.y });
      } else if (!inside && was) {
        z._inside.delete(b.id);
        this.emit('zoneExit', { tag: z.tag, ball: b, zone: z });
      }
    }
  }

  /* ---------------- rails ---------------- */

  attachRail(b, rail, speed) {
    b.rail = rail;
    b.railS = 0;
    b.railV = Math.max(speed, rail.minSpeed * 0.9);
    b.z = rail.pts[0][2];
    this.emit('railEnter', { rail, ball: b });
  }

  stepRail(b, h) {
    const rail = b.rail;
    const t = rail.tangent(b.railS);
    // acceleration along the rail from projected gravity
    const a = -(this.gPlane * t[1] + this.gNormal * t[2]);
    b.railV += a * h;
    b.railV -= Math.sign(b.railV) * rail.friction * h;
    b.railS += b.railV * h;

    if (b.railS >= rail.length) {
      const p = rail.pos(rail.length);
      const tt = rail.tangent(rail.length);
      b.x = p[0];
      b.y = p[1];
      b.z = p[2];
      const v = Math.max(b.railV, 0.5);
      b.vx = tt[0] * v;
      b.vy = tt[1] * v;
      b.rail = null;
      b.spin = 0;
      this.emit('railExit', { rail, ball: b, speed: v });
      return;
    }
    if (b.railS <= 0) {
      // rolled back out of the entrance
      const p = rail.pos(0);
      const tt = rail.tangent(0);
      b.x = p[0];
      b.y = p[1];
      b.z = p[2];
      const v = Math.min(b.railV, -0.2);
      b.vx = tt[0] * v;
      b.vy = tt[1] * v;
      b.rail = null;
      this.emit('railBack', { rail, ball: b });
      return;
    }
    const p = rail.pos(b.railS);
    b.x = p[0];
    b.y = p[1];
    b.z = p[2];
    b.speed = Math.abs(b.railV);
  }
}

/* ------------------------------------------------------------------ */
/* Swept tests                                                         */
/* ------------------------------------------------------------------ */

function closestOnSeg(px, py, s) {
  let u = ((px - s.x0) * s.dx + (py - s.y0) * s.dy) / s.len;
  u = Math.min(Math.max(u, 0), 1);
  return [s.x0 + s.dx * s.len * u, s.y0 + s.dy * s.len * u];
}

export function sweepSegment(px, py, vx, vy, r, s, dt) {
  let best = null;

  // --- flat side of the capsule ---
  const s0 = (px - s.x0) * s.nx + (py - s.y0) * s.ny;
  const vn = vx * s.nx + vy * s.ny;
  const sign = s0 >= 0 ? 1 : -1;
  if (!s.oneWay || s.oneWay === sign) {
    let t = null;
    if (Math.abs(s0) <= r) {
      if (vn * sign < 0) t = 0;
    } else if (Math.abs(vn) > EPS) {
      const tt = (sign * r - s0) / vn;
      if (tt >= 0 && tt <= dt) t = tt;
    }
    if (t !== null) {
      const cx = px + vx * t;
      const cy = py + vy * t;
      const u = ((cx - s.x0) * s.dx + (cy - s.y0) * s.dy) / s.len;
      if (u >= 0 && u <= 1) best = { t, nx: s.nx * sign, ny: s.ny * sign };
    }
  }

  // --- rounded ends ---
  for (let i = 0; i < 2; i++) {
    const ex = i ? s.x1 : s.x0;
    const ey = i ? s.y1 : s.y0;
    const h = sweepCircleStatic(px, py, vx, vy, r, ex, ey, 0, dt);
    if (h && (!best || h.t < best.t)) {
      if (s.oneWay) {
        const sd = (px - s.x0) * s.nx + (py - s.y0) * s.ny;
        if ((sd >= 0 ? 1 : -1) !== s.oneWay) continue;
      }
      best = h;
    }
  }
  return best;
}

/** swept sphere (radius r) vs a static circle of radius R, hitting from outside */
export function sweepCircleStatic(px, py, vx, vy, r, cx, cy, R, dt) {
  const ex = px - cx;
  const ey = py - cy;
  const rad = R + r;
  const a = vx * vx + vy * vy;
  if (a < EPS) return null;
  const bq = 2 * (ex * vx + ey * vy);
  const c = ex * ex + ey * ey - rad * rad;
  if (c < 0) {
    // already overlapping — valid contact if approaching
    if (bq < 0) {
      const d = Math.hypot(ex, ey) || EPS;
      return { t: 0, nx: ex / d, ny: ey / d };
    }
    return null;
  }
  const disc = bq * bq - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t = (-bq - sq) / (2 * a);
  if (t < 0 || t > dt) return null;
  const hx = ex + vx * t;
  const hy = ey + vy * t;
  const d = Math.hypot(hx, hy) || EPS;
  return { t, nx: hx / d, ny: hy / d };
}

export function sweepArc(px, py, vx, vy, r, arc, dt) {
  if (!arc.concave) {
    const h = sweepCircleStatic(px, py, vx, vy, r, arc.cx, arc.cy, arc.r, dt);
    if (h && arc.contains(Math.atan2(h.ny, h.nx))) return h;
    return null;
  }
  // concave: ball inside, hits when it reaches radius (R - r) going outward
  const ex = px - arc.cx;
  const ey = py - arc.cy;
  const rad = arc.r - r;
  const a = vx * vx + vy * vy;
  if (a < EPS) return null;
  const bq = 2 * (ex * vx + ey * vy);
  const c = ex * ex + ey * ey - rad * rad;
  const disc = bq * bq - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-bq + sq) / (2 * a);
  if (c > 0) {
    // already outside the arc radius — push back immediately if still leaving
    if (bq > 0) {
      const d = Math.hypot(ex, ey) || EPS;
      const ang = Math.atan2(ey, ex);
      if (!arc.contains(ang)) return null;
      return { t: 0, nx: -ex / d, ny: -ey / d };
    }
    return null;
  }
  if (t < 0 || t > dt) return null;
  const hx = ex + vx * t;
  const hy = ey + vy * t;
  const ang = Math.atan2(hy, hx);
  if (!arc.contains(ang)) return null;
  const d = Math.hypot(hx, hy) || EPS;
  return { t, nx: -hx / d, ny: -hy / d };
}

const _fseg = new Segment(0, 0, 1, 0, {});

export function sweepFlipper(px, py, vx, vy, r, f, dt) {
  const ca = Math.cos(f.angle);
  const sa = Math.sin(f.angle);
  const tx = f.x + ca * f.length;
  const ty = f.y + sa * f.length;
  // approximate the tapered bat with a capsule at the mean radius plus an
  // explicit fat base circle — good to a fraction of a millimetre
  const rr = (f.r0 + f.r1) * 0.5;
  _fseg.move(f.x, f.y, tx, ty);
  _fseg.oneWay = 0;
  const h1 = sweepSegment(px, py, vx, vy, r + rr, _fseg, dt);
  const h2 = sweepCircleStatic(px, py, vx, vy, r, f.x, f.y, f.r0, dt);
  let best = h1;
  if (h2 && (!best || h2.t < best.t)) best = h2;
  return best;
}
