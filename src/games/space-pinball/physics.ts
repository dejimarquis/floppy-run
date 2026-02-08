// ── Constants (tuned for 400×700 table) ────────────────────────────
export const TABLE_WIDTH = 400;
export const TABLE_HEIGHT = 700;
export const BALL_RADIUS = 8;
export const GRAVITY = 800;
export const MAX_BALL_SPEED = 2000;

const SUB_STEPS = 4;
const FLIPPER_ACTIVE_SPEED = 30;   // rad/s when pressing
const FLIPPER_RETURN_SPEED = 10;   // rad/s when releasing
const PLUNGER_CHARGE_TIME = 1.5;   // seconds to fully compress

// ── Ball ────────────────────────────────────────────────────────────
export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  active: boolean;
  speed: number;
}

export function createBall(x: number, y: number): Ball {
  return { x, y, vx: 0, vy: 0, radius: BALL_RADIUS, active: true, speed: 0 };
}

export function updateBall(ball: Ball, dt: number, gravity: number): void {
  if (!ball.active) return;
  ball.vy += gravity * dt;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  if (ball.speed > MAX_BALL_SPEED) {
    const scale = MAX_BALL_SPEED / ball.speed;
    ball.vx *= scale;
    ball.vy *= scale;
    ball.speed = MAX_BALL_SPEED;
  }
}

// ── Circle Collider (bumpers) ───────────────────────────────────────
export interface CircleCollider {
  x: number;
  y: number;
  radius: number;
  restitution: number;
}

export function collideCircle(ball: Ball, circle: CircleCollider): boolean {
  const dx = ball.x - circle.x;
  const dy = ball.y - circle.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const minDist = ball.radius + circle.radius;

  if (dist >= minDist || dist === 0) return false;

  // Collision normal (center-to-center)
  const nx = dx / dist;
  const ny = dy / dist;

  // Separate ball out of overlap
  const overlap = minDist - dist;
  ball.x += nx * overlap;
  ball.y += ny * overlap;

  // Reflect velocity along normal
  const dot = ball.vx * nx + ball.vy * ny;
  if (dot > 0) return false; // already moving away

  ball.vx -= (1 + circle.restitution) * dot * nx;
  ball.vy -= (1 + circle.restitution) * dot * ny;
  ball.speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);

  return true;
}

// ── Line Segment Collider (walls, ramps) ────────────────────────────
export interface LineCollider {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  restitution: number;
}

export function collideLine(ball: Ball, line: LineCollider): boolean {
  // Closest point on segment to ball center
  const ex = line.x2 - line.x1;
  const ey = line.y2 - line.y1;
  const lenSq = ex * ex + ey * ey;
  if (lenSq === 0) return false;

  let t = ((ball.x - line.x1) * ex + (ball.y - line.y1) * ey) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = line.x1 + t * ex;
  const closestY = line.y1 + t * ey;

  const dx = ball.x - closestX;
  const dy = ball.y - closestY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist >= ball.radius || dist === 0) return false;

  // Normal from closest point to ball center
  const nx = dx / dist;
  const ny = dy / dist;

  // Push ball out of overlap
  const overlap = ball.radius - dist;
  ball.x += nx * overlap;
  ball.y += ny * overlap;

  // Reflect velocity across normal
  const dot = ball.vx * nx + ball.vy * ny;
  if (dot > 0) return false; // moving away

  ball.vx -= (1 + line.restitution) * dot * nx;
  ball.vy -= (1 + line.restitution) * dot * ny;
  ball.speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);

  return true;
}

// ── Flipper ─────────────────────────────────────────────────────────
export interface Flipper {
  pivotX: number;
  pivotY: number;
  length: number;
  angle: number;
  restAngle: number;
  activeAngle: number;
  angularVelocity: number;
  side: 'left' | 'right';
  isPressed: boolean;
}

export function createFlipper(
  pivotX: number,
  pivotY: number,
  length: number,
  side: 'left' | 'right',
): Flipper {
  const restAngle = side === 'left' ? 0.5 : Math.PI - 0.5;
  const activeAngle = side === 'left' ? -0.5 : Math.PI + 0.5;
  return {
    pivotX,
    pivotY,
    length,
    angle: restAngle,
    restAngle,
    activeAngle,
    angularVelocity: 0,
    side,
    isPressed: false,
  };
}

export function updateFlipper(flipper: Flipper, pressed: boolean, dt: number): void {
  flipper.isPressed = pressed;
  const target = pressed ? flipper.activeAngle : flipper.restAngle;
  const speed = pressed ? FLIPPER_ACTIVE_SPEED : FLIPPER_RETURN_SPEED;
  const diff = target - flipper.angle;

  if (Math.abs(diff) < 0.001) {
    flipper.angle = target;
    flipper.angularVelocity = 0;
    return;
  }

  const dir = Math.sign(diff);
  flipper.angularVelocity = dir * speed;
  flipper.angle += flipper.angularVelocity * dt;

  // Clamp to not overshoot target
  if ((dir > 0 && flipper.angle > target) || (dir < 0 && flipper.angle < target)) {
    flipper.angle = target;
    flipper.angularVelocity = 0;
  }
}

/** Get flipper tip position from pivot, angle, and length */
function flipperTip(f: Flipper): { x: number; y: number } {
  return {
    x: f.pivotX + Math.cos(f.angle) * f.length,
    y: f.pivotY + Math.sin(f.angle) * f.length,
  };
}

export function collideFlipper(ball: Ball, flipper: Flipper): boolean {
  const tip = flipperTip(flipper);

  // Treat flipper as a line segment from pivot to tip
  const ex = tip.x - flipper.pivotX;
  const ey = tip.y - flipper.pivotY;
  const lenSq = ex * ex + ey * ey;
  if (lenSq === 0) return false;

  let t = ((ball.x - flipper.pivotX) * ex + (ball.y - flipper.pivotY) * ey) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = flipper.pivotX + t * ex;
  const closestY = flipper.pivotY + t * ey;

  const dx = ball.x - closestX;
  const dy = ball.y - closestY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist >= ball.radius || dist === 0) return false;

  // Normal from closest point to ball
  const nx = dx / dist;
  const ny = dy / dist;

  // Separate
  const overlap = ball.radius - dist;
  ball.x += nx * overlap;
  ball.y += ny * overlap;

  // Flipper surface velocity at contact point
  // v = ω × r (perpendicular to radius from pivot)
  const rx = closestX - flipper.pivotX;
  const ry = closestY - flipper.pivotY;
  const surfaceVx = -flipper.angularVelocity * ry;
  const surfaceVy = flipper.angularVelocity * rx;

  // Relative velocity of ball w.r.t. flipper surface
  const relVx = ball.vx - surfaceVx;
  const relVy = ball.vy - surfaceVy;
  const relDot = relVx * nx + relVy * ny;
  if (relDot > 0) return false; // moving away

  // Reflect relative velocity, restitution of 0.9 for flippers
  const restitution = 0.9;
  ball.vx -= (1 + restitution) * relDot * nx;
  ball.vy -= (1 + restitution) * relDot * ny;

  // Transfer angular momentum: contact near tip = more speed
  const contactRatio = t; // 0 = pivot, 1 = tip
  const transferScale = 0.3 * contactRatio;
  ball.vx += surfaceVx * transferScale;
  ball.vy += surfaceVy * transferScale;

  ball.speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  return true;
}

// ── Plunger / Launcher ──────────────────────────────────────────────
export interface Plunger {
  x: number;
  yTop: number;
  yBottom: number;
  y: number;
  power: number;
  maxForce: number;
  isHeld: boolean;
}

export function createPlunger(x: number, yTop: number, yBottom: number): Plunger {
  return {
    x,
    yTop,
    yBottom,
    y: yBottom,
    power: 0,
    maxForce: 1800,
    isHeld: false,
  };
}

export function updatePlunger(plunger: Plunger, held: boolean, dt: number): void {
  plunger.isHeld = held;
  if (held) {
    plunger.power = Math.min(1, plunger.power + dt / PLUNGER_CHARGE_TIME);
    plunger.y = plunger.yBottom - (plunger.yBottom - plunger.yTop) * plunger.power;
  } else if (plunger.power > 0) {
    // Spring back when not held — reset position
    plunger.y = plunger.yBottom;
  }
}

export function launchBall(plunger: Plunger, ball: Ball): void {
  if (plunger.power <= 0) return;
  ball.vy = -plunger.maxForce * plunger.power;
  ball.speed = Math.abs(ball.vy);
  plunger.power = 0;
  plunger.y = plunger.yBottom;
}

// ── Collision Events ────────────────────────────────────────────────
export interface CollisionEvent {
  type: 'bumper' | 'wall' | 'flipper' | 'drain';
  index: number;
  velocity: number;
}

// ── Physics World ───────────────────────────────────────────────────
export interface PhysicsWorld {
  balls: Ball[];
  circles: CircleCollider[];
  lines: LineCollider[];
  flippers: Flipper[];
  plunger: Plunger;
  gravity: number;
  drainY: number;
}

export function createPhysicsWorld(): PhysicsWorld {
  return {
    balls: [],
    circles: [],
    lines: [],
    flippers: [],
    plunger: createPlunger(TABLE_WIDTH - 20, TABLE_HEIGHT - 80, TABLE_HEIGHT - 20),
    gravity: GRAVITY,
    drainY: TABLE_HEIGHT + BALL_RADIUS,
  };
}

export function stepPhysics(world: PhysicsWorld, dt: number): CollisionEvent[] {
  const events: CollisionEvent[] = [];
  const subDt = dt / SUB_STEPS;

  // Update flippers once per frame (input-driven, not sub-stepped)
  for (const flipper of world.flippers) {
    updateFlipper(flipper, flipper.isPressed, dt);
  }

  // Update plunger once per frame
  updatePlunger(world.plunger, world.plunger.isHeld, dt);

  for (let step = 0; step < SUB_STEPS; step++) {
    for (const ball of world.balls) {
      if (!ball.active) continue;

      // 1. Apply gravity & update position
      updateBall(ball, subDt, world.gravity);

      // 2. Circle collisions (bumpers)
      for (let i = 0; i < world.circles.length; i++) {
        if (collideCircle(ball, world.circles[i])) {
          events.push({ type: 'bumper', index: i, velocity: ball.speed });
        }
      }

      // 3. Line collisions (walls)
      for (let i = 0; i < world.lines.length; i++) {
        if (collideLine(ball, world.lines[i])) {
          events.push({ type: 'wall', index: i, velocity: ball.speed });
        }
      }

      // 4. Flipper collisions
      for (let i = 0; i < world.flippers.length; i++) {
        if (collideFlipper(ball, world.flippers[i])) {
          events.push({ type: 'flipper', index: i, velocity: ball.speed });
        }
      }

      // 5. Drain check
      if (ball.y > world.drainY) {
        ball.active = false;
        events.push({ type: 'drain', index: 0, velocity: ball.speed });
      }
    }
  }

  return events;
}
