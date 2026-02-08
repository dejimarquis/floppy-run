// Player motorcycle — detailed pixel-art bike, advanced physics, and dramatic wipeout

import type { InputManager } from '../../engine/input';
import type { RoadSegment } from './road';
import { SEGMENT_LENGTH } from './road';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnimationFrame =
  | 'straight'
  | 'lean-left'
  | 'lean-right'
  | 'wheelie'
  | 'punch-left'
  | 'punch-right'
  | 'wipeout';

export type WipeoutPhase = 'none' | 'launch' | 'tumble' | 'getup' | 'run';

export interface Player {
  x: number;           // horizontal position (-1 to 1, 0 = center)
  z: number;           // position along the road (world units)
  speed: number;       // current speed (world units per second)
  maxSpeed: number;
  accel: number;       // acceleration rate
  decel: number;       // friction deceleration
  braking: number;     // brake deceleration
  turnSpeed: number;   // steering responsiveness
  health: number;
  maxHealth: number;
  isWipedOut: boolean;
  wipeoutTimer: number;
  lean: number;        // visual lean angle (-1 left, 0 straight, 1 right)
  // Extended state
  animationFrame: AnimationFrame;
  wipeoutPhase: WipeoutPhase;
  wipeoutPhaseTimer: number;
  // Rider position separate from bike during wipeout
  riderOffsetX: number;
  riderOffsetY: number;
  riderRotation: number;
  bikeSlideX: number;
  bikeSlideSpeed: number;
  wheelieTimer: number;
  offroad: boolean;
  draftBoost: number;
  gear: number;
  prevSpeed: number;
}

// ---------------------------------------------------------------------------
// Physics constants
// ---------------------------------------------------------------------------

const MAX_SPEED = 300;
const ACCELERATION = 200;
const BRAKING = 400;
const DECELERATION = 100;
const TURN_SPEED = 3.0;
const CENTRIFUGAL_FORCE = 0.6;
const OFFROAD_SPEED_CAP = MAX_SPEED * 0.2;
const OFFROAD_RUMBLE_AMP = 0.02;
const OFFROAD_RUMBLE_FREQ = 40;
const WIPEOUT_DURATION = 2.0;
const WIPEOUT_RESPAWN_HEALTH = 40;

// Gear-shift feel: slight acceleration dip at ~33% / ~66% of max speed
const GEAR_THRESHOLDS = [0.33, 0.66];
const GEAR_SHIFT_DIP = 0.35;
const GEAR_SHIFT_ZONE = 0.03;

// Drafting / slipstream
const DRAFT_Z_RANGE = 300;
const DRAFT_X_RANGE = 0.25;
const DRAFT_SPEED_BONUS = 0.08;

// Wipeout phase durations (total = 2.0 s)
const PHASE_LAUNCH = 0.4;
const PHASE_TUMBLE = 0.5;
const PHASE_GETUP = 0.3;
const PHASE_RUN = 0.8;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPlayer(): Player {
  return {
    x: 0,
    z: 0,
    speed: 0,
    maxSpeed: MAX_SPEED,
    accel: ACCELERATION,
    decel: DECELERATION,
    braking: BRAKING,
    turnSpeed: TURN_SPEED,
    health: 100,
    maxHealth: 100,
    isWipedOut: false,
    wipeoutTimer: 0,
    lean: 0,
    animationFrame: 'straight',
    wipeoutPhase: 'none',
    wipeoutPhaseTimer: 0,
    riderOffsetX: 0,
    riderOffsetY: 0,
    riderRotation: 0,
    bikeSlideX: 0,
    bikeSlideSpeed: 0,
    wheelieTimer: 0,
    offroad: false,
    draftBoost: 0,
    gear: 1,
    prevSpeed: 0,
  };
}

export function getPlayerSegmentIndex(
  player: Player,
  segmentLength: number,
  totalSegments: number,
): number {
  return Math.floor(player.z / segmentLength) % totalSegments;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export function updatePlayer(
  player: Player,
  input: InputManager,
  road: RoadSegment[],
  dt: number,
  nearbyRivals?: Array<{ x: number; z: number; speed: number }>,
): void {
  player.prevSpeed = player.speed;

  // --- Wipeout state ---
  if (player.isWipedOut) {
    updateWipeout(player, dt);
    return;
  }

  // --- Acceleration / braking / friction ---
  const isAccel = input.isActionDown('accel');
  const isBrake = input.isActionDown('brake');

  if (isAccel) {
    const speedRatio = player.speed / player.maxSpeed;
    // Aggressive initial thrust, tapering quadratically
    const baseFactor = 1 - speedRatio * speedRatio;
    // Gear-shift dip near thresholds
    let gearDip = 1;
    for (const threshold of GEAR_THRESHOLDS) {
      const dist = Math.abs(speedRatio - threshold);
      if (dist < GEAR_SHIFT_ZONE) {
        gearDip = 1 - GEAR_SHIFT_DIP * (1 - dist / GEAR_SHIFT_ZONE);
        break;
      }
    }
    // Track current gear
    if (speedRatio < GEAR_THRESHOLDS[0]) player.gear = 1;
    else if (speedRatio < GEAR_THRESHOLDS[1]) player.gear = 2;
    else player.gear = 3;

    player.speed += player.accel * baseFactor * gearDip * dt;
  } else if (isBrake) {
    player.speed -= player.braking * dt;
  } else {
    player.speed -= player.decel * dt;
  }

  // --- Drafting (slipstream) ---
  player.draftBoost = 0;
  if (nearbyRivals) {
    for (const rival of nearbyRivals) {
      const dz = rival.z - player.z;
      const dx = Math.abs(rival.x - player.x);
      if (dz > 0 && dz < DRAFT_Z_RANGE && dx < DRAFT_X_RANGE) {
        player.draftBoost = DRAFT_SPEED_BONUS;
        player.speed += player.maxSpeed * DRAFT_SPEED_BONUS * dt;
        break;
      }
    }
  }

  // --- Off-road penalty (more dramatic) ---
  const isOffroad = Math.abs(player.x) > 1;
  player.offroad = isOffroad;
  if (isOffroad) {
    if (player.speed > OFFROAD_SPEED_CAP) {
      player.speed -= player.braking * 2.5 * dt;
    }
    // Violent rumble
    player.x += Math.sin(player.z * OFFROAD_RUMBLE_FREQ) * OFFROAD_RUMBLE_AMP;
    player.x += (Math.random() - 0.5) * OFFROAD_RUMBLE_AMP * 0.5;
  }

  // Clamp speed
  player.speed = Math.max(0, Math.min(player.speed, player.maxSpeed));

  // --- Steering ---
  const speedRatio = player.speed / player.maxSpeed;
  // Low speed → responsive; high speed → sluggish but stable
  const baseTurn = 1 - speedRatio * 0.75;
  // Off-throttle → quicker steering (trail-braking feel)
  const trailBrake = isAccel ? 1.0 : 1.4;
  const turnFactor = baseTurn * trailBrake;
  let steering = 0;

  if (input.isActionDown('left')) steering = -1;
  if (input.isActionDown('right')) steering = 1;

  if (steering !== 0) {
    player.x += steering * player.turnSpeed * turnFactor * dt;
  }

  // --- Centrifugal force (0.6 — curves genuinely push you off-road) ---
  const segIdx = getPlayerSegmentIndex(player, SEGMENT_LENGTH, road.length);
  const curve = road[segIdx].curve;
  player.x -= CENTRIFUGAL_FORCE * speedRatio * curve * dt;

  // --- Visual lean ---
  const targetLean = steering !== 0 ? steering : -curve * speedRatio * 0.5;
  player.lean += (targetLean - player.lean) * Math.min(1, 8 * dt);

  // --- Wheelie detection (hard accel from low speed) ---
  if (isAccel && speedRatio < 0.3 && player.speed > player.prevSpeed + 2) {
    player.wheelieTimer = 0.4;
  }
  player.wheelieTimer = Math.max(0, player.wheelieTimer - dt);

  // --- Animation frame ---
  player.animationFrame = determineAnimationFrame(player, input);

  // --- Move forward ---
  player.z += player.speed * SEGMENT_LENGTH * dt;

  // --- Wipeout check ---
  if (player.health <= 0) {
    player.isWipedOut = true;
    player.wipeoutTimer = WIPEOUT_DURATION;
    player.wipeoutPhase = 'launch';
    player.wipeoutPhaseTimer = PHASE_LAUNCH;
    player.animationFrame = 'wipeout';
    player.health = 0;
    player.riderOffsetX = 0;
    player.riderOffsetY = 0;
    player.riderRotation = 0;
    player.bikeSlideX = 0;
    player.bikeSlideSpeed = player.speed * 0.6;
  }
}

// ---------------------------------------------------------------------------
// Wipeout multi-phase
// ---------------------------------------------------------------------------

function phaseDuration(phase: WipeoutPhase): number {
  switch (phase) {
    case 'none': return 0;
    case 'launch': return PHASE_LAUNCH;
    case 'tumble': return PHASE_TUMBLE;
    case 'getup': return PHASE_GETUP;
    case 'run': return PHASE_RUN;
  }
}

function updateWipeout(player: Player, dt: number): void {
  player.wipeoutTimer -= dt;
  player.wipeoutPhaseTimer -= dt;
  player.animationFrame = 'wipeout';

  // Advance phase
  if (player.wipeoutPhaseTimer <= 0) {
    switch (player.wipeoutPhase) {
      case 'launch':
        player.wipeoutPhase = 'tumble';
        player.wipeoutPhaseTimer = PHASE_TUMBLE;
        break;
      case 'tumble':
        player.wipeoutPhase = 'getup';
        player.wipeoutPhaseTimer = PHASE_GETUP;
        break;
      case 'getup':
        player.wipeoutPhase = 'run';
        player.wipeoutPhaseTimer = PHASE_RUN;
        break;
      case 'run':
        break;
      default:
        break;
    }
  }

  const dur = phaseDuration(player.wipeoutPhase);
  const t = dur > 0 ? Math.max(0, Math.min(1, 1 - player.wipeoutPhaseTimer / dur)) : 1;

  switch (player.wipeoutPhase) {
    case 'launch': {
      // Rider arcs upward and forward — parabolic trajectory
      player.riderOffsetX = t * 50;
      player.riderOffsetY = -Math.sin(t * Math.PI) * 80;
      // Full 360° tumble through air
      player.riderRotation = t * Math.PI * 2;
      // Bike slides forward, decelerating
      player.bikeSlideSpeed = Math.max(0, player.bikeSlideSpeed - 300 * dt);
      player.bikeSlideX += player.bikeSlideSpeed * dt;
      player.speed = Math.max(0, player.speed - player.braking * dt);
      break;
    }
    case 'tumble': {
      // Rider on ground — bouncing/rolling
      player.riderOffsetX = 50 + t * 10;
      // Decaying bounces
      const bounceAmp = 15 * (1 - t);
      player.riderOffsetY = -Math.abs(Math.sin(t * Math.PI * 3)) * bounceAmp;
      // Slower rotation, winding down
      player.riderRotation += dt * Math.PI * 3 * (1 - t);
      // Bike slides to a stop
      player.bikeSlideSpeed = Math.max(0, player.bikeSlideSpeed - 400 * dt);
      player.bikeSlideX += player.bikeSlideSpeed * dt;
      player.speed = Math.max(0, player.speed - player.braking * 2 * dt);
      break;
    }
    case 'getup': {
      // Rider stops rolling, stands up
      player.riderRotation *= Math.max(0, 1 - 6 * dt);
      player.riderOffsetY = player.riderOffsetY * (1 - t);
      player.speed = Math.max(0, player.speed - player.braking * 3 * dt);
      break;
    }
    case 'run': {
      // Rider runs back toward bike
      player.riderOffsetX = player.riderOffsetX * (1 - t);
      player.riderOffsetY = 0;
      player.riderRotation = 0;
      player.speed = 0;
      break;
    }
    default:
      break;
  }

  // Lean wobble during airborne/tumble phases
  if (player.wipeoutPhase === 'launch' || player.wipeoutPhase === 'tumble') {
    player.lean = Math.sin(player.wipeoutTimer * 12) * 0.5;
  } else {
    player.lean *= 0.9;
  }

  player.z += player.speed * SEGMENT_LENGTH * dt;

  // Recovery
  if (player.wipeoutTimer <= 0) {
    player.isWipedOut = false;
    player.wipeoutTimer = 0;
    player.wipeoutPhase = 'none';
    player.wipeoutPhaseTimer = 0;
    player.health = WIPEOUT_RESPAWN_HEALTH;
    player.x = 0;
    player.lean = 0;
    player.animationFrame = 'straight';
    player.wheelieTimer = 0;
    player.riderOffsetX = 0;
    player.riderOffsetY = 0;
    player.riderRotation = 0;
    player.bikeSlideX = 0;
    player.bikeSlideSpeed = 0;
    player.speed = 0;
  }
}

// ---------------------------------------------------------------------------
// Animation frame determination
// ---------------------------------------------------------------------------

function determineAnimationFrame(player: Player, input: InputManager): AnimationFrame {
  if (player.isWipedOut) return 'wipeout';
  if (player.wheelieTimer > 0) return 'wheelie';
  if (input.isActionDown('punch') || input.isActionDown('kick')) {
    return player.lean <= 0 ? 'punch-left' : 'punch-right';
  }
  if (player.lean < -0.3) return 'lean-left';
  if (player.lean > 0.3) return 'lean-right';
  return 'straight';
}

// =========================================================================
// Rendering — detailed procedural pixel-art motorcycle + rider
// =========================================================================

/**
 * Draw the player motorcycle at an arbitrary screen position / scale.
 * Each animation frame draws a different pose.
 */
export function renderPlayerBike(
  ctx: CanvasRenderingContext2D,
  player: Player,
  screenX: number,
  screenY: number,
  scale: number = 1,
): void {
  ctx.save();
  ctx.translate(screenX, screenY);
  ctx.scale(scale, scale);
  ctx.rotate(player.lean * 0.25);

  if (player.isWipedOut) {
    drawWipeoutScene(ctx, player);
  } else {
    drawMotorcycle(ctx, player);
    drawRider(ctx, player);
  }

  ctx.restore();
}

/** Backward-compatible wrapper — draws bike at bottom-center of screen. */
export function drawPlayerBike(
  ctx: CanvasRenderingContext2D,
  player: Player,
  screenWidth: number,
  screenHeight: number,
): void {
  const cx = screenWidth / 2 + player.lean * 40;
  const by = screenHeight - 18;
  renderPlayerBike(ctx, player, cx, by, 1.6);
}

// ---------------------------------------------------------------------------
// Wheel helper
// ---------------------------------------------------------------------------

function drawWheel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, rx: number, ry: number, spokePhase: number,
): void {
  // Tire
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  // Rim ring
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(x, y, rx - 2, ry - 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Spokes
  ctx.strokeStyle = '#777';
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 6; i++) {
    const a = spokePhase + (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * (rx - 2), y + Math.sin(a) * (ry - 2));
    ctx.stroke();
  }
  // Hub
  ctx.fillStyle = '#999';
  ctx.beginPath();
  ctx.ellipse(x, y, 2.5, 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Motorcycle body (3/4 rear view, ~60 w × ~50 h)
// ---------------------------------------------------------------------------

function drawMotorcycle(ctx: CanvasRenderingContext2D, player: Player): void {
  const isWheelie = player.animationFrame === 'wheelie';
  const fwOff = isWheelie ? -14 : 0; // front-wheel Y lift during wheelie
  const spokePhase = player.z * 0.04;

  // Shadow ellipse
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 4, 24, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // --- Rear wheel ---
  drawWheel(ctx, 0, 0, 12, 10, spokePhase);

  // --- Rear fender ---
  ctx.fillStyle = '#aa1a00';
  ctx.beginPath();
  ctx.arc(0, 0, 14, Math.PI * 1.15, Math.PI * 1.85);
  ctx.fill();

  // --- Front wheel (slightly ahead / higher for perspective) ---
  drawWheel(ctx, 0, -24 + fwOff, 11, 9, spokePhase * 1.05);

  // --- Front fender ---
  ctx.fillStyle = '#cc2200';
  ctx.beginPath();
  ctx.arc(0, -24 + fwOff, 13, Math.PI * 1.1, Math.PI * 1.9);
  ctx.fill();

  // --- Exhaust pipe (right side) ---
  ctx.fillStyle = '#777';
  ctx.beginPath();
  ctx.moveTo(7, -2);
  ctx.lineTo(10, -4);
  ctx.lineTo(12, -2);
  ctx.lineTo(12, 4);
  ctx.lineTo(10, 6);
  ctx.lineTo(7, 4);
  ctx.closePath();
  ctx.fill();
  // Chrome highlight
  ctx.fillStyle = '#aaa';
  ctx.fillRect(8, -3, 2, 4);
  // Exhaust tip heat glow
  ctx.fillStyle = '#ff5500';
  ctx.fillRect(10, 4, 2, 2);

  // --- Frame / body (motorcycle contour) ---
  ctx.fillStyle = '#cc2200';
  ctx.beginPath();
  ctx.moveTo(-11, 1);
  ctx.lineTo(-9, -5);
  ctx.lineTo(-7, -12);
  ctx.lineTo(-6, -18);
  ctx.lineTo(-5, -26 + fwOff * 0.4);
  ctx.lineTo(-3, -30 + fwOff * 0.6);
  ctx.lineTo(3, -30 + fwOff * 0.6);
  ctx.lineTo(5, -26 + fwOff * 0.4);
  ctx.lineTo(6, -18);
  ctx.lineTo(7, -12);
  ctx.lineTo(9, -5);
  ctx.lineTo(11, 1);
  ctx.closePath();
  ctx.fill();

  // --- Tank (raised chrome highlight) ---
  ctx.fillStyle = '#ff4422';
  ctx.beginPath();
  ctx.moveTo(-4, -20);
  ctx.lineTo(-3, -25);
  ctx.lineTo(3, -25);
  ctx.lineTo(4, -20);
  ctx.lineTo(3, -16);
  ctx.lineTo(-3, -16);
  ctx.closePath();
  ctx.fill();
  // Chrome racing stripe
  ctx.fillStyle = '#ddd';
  ctx.fillRect(-1, -25, 2, 10);

  // --- Seat (black leather) ---
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.moveTo(-8, -8);
  ctx.lineTo(-7, -14);
  ctx.lineTo(7, -14);
  ctx.lineTo(8, -8);
  ctx.closePath();
  ctx.fill();
  // Seat stitch detail
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(-5, -11);
  ctx.lineTo(5, -11);
  ctx.stroke();

  // --- Handlebars ---
  const hbY = -28 + fwOff * 0.5;
  ctx.strokeStyle = '#bbb';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-16, hbY);
  ctx.lineTo(-5, hbY + 1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(16, hbY);
  ctx.lineTo(5, hbY + 1);
  ctx.stroke();
  // Grips
  ctx.fillStyle = '#333';
  ctx.fillRect(-18, hbY - 2, 4, 4);
  ctx.fillRect(14, hbY - 2, 4, 4);

  // --- Headlight ---
  const hlY = -32 + fwOff * 0.7;
  ctx.fillStyle = '#ffff88';
  ctx.beginPath();
  ctx.arc(0, hlY, 4, 0, Math.PI * 2);
  ctx.fill();
  // Glow
  ctx.fillStyle = 'rgba(255,255,136,0.25)';
  ctx.beginPath();
  ctx.arc(0, hlY, 7, 0, Math.PI * 2);
  ctx.fill();

  // --- Tail light ---
  ctx.fillStyle = '#ff2200';
  ctx.fillRect(-4, 2, 8, 3);
  ctx.fillStyle = 'rgba(255,34,0,0.25)';
  ctx.fillRect(-6, 3, 12, 2);

  // --- Engine block detail (visible between wheels) ---
  ctx.fillStyle = '#444';
  ctx.fillRect(-5, -6, 10, 5);
  ctx.fillStyle = '#555';
  ctx.fillRect(-4, -5, 2, 3);
  ctx.fillRect(2, -5, 2, 3);
}

// ---------------------------------------------------------------------------
// Rider
// ---------------------------------------------------------------------------

function drawRider(ctx: CanvasRenderingContext2D, player: Player): void {
  const frame = player.animationFrame;
  const isWheelie = frame === 'wheelie';
  const shift = frame === 'lean-left' ? -3 : frame === 'lean-right' ? 3 : 0;
  const tiltBack = isWheelie ? 3 : 0;

  // --- Legs (straddling the bike) ---
  ctx.fillStyle = '#222';
  ctx.fillRect(-11 + shift, -10, 4, 9);
  ctx.fillRect(7 + shift, -10, 4, 9);
  // Boots
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(-12 + shift, -2, 5, 3);
  ctx.fillRect(7 + shift, -2, 5, 3);

  // --- Torso (leather jacket) ---
  const torsoY = isWheelie ? -20 : -17;
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.moveTo(-7 + shift, torsoY - 9);
  ctx.lineTo(-8 + shift, torsoY);
  ctx.lineTo(-6 + shift, torsoY + 7);
  ctx.lineTo(6 + shift, torsoY + 7);
  ctx.lineTo(8 + shift, torsoY);
  ctx.lineTo(7 + shift, torsoY - 9);
  ctx.closePath();
  ctx.fill();
  // Jacket collar
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(-5 + shift, torsoY - 10, 10, 3);
  // Zipper
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(shift, torsoY - 8);
  ctx.lineTo(shift, torsoY + 6);
  ctx.stroke();

  // --- Arms ---
  const hbY = -28 + (isWheelie ? -7 : 0);
  const shoulderY = torsoY - 5;
  drawArms(ctx, frame, shift, shoulderY, hbY);

  // --- Helmet ---
  const headX = shift;
  const headY = torsoY - 14 - tiltBack;
  // Main dome
  ctx.fillStyle = '#cc2200';
  ctx.beginPath();
  ctx.arc(headX, headY, 7, 0, Math.PI * 2);
  ctx.fill();
  // Visor (dark reflective)
  ctx.fillStyle = '#1a1a3a';
  ctx.beginPath();
  ctx.arc(headX, headY + 1.5, 6, -0.4, Math.PI + 0.4, true);
  ctx.closePath();
  ctx.fill();
  // Visor glint
  ctx.fillStyle = 'rgba(120,170,255,0.3)';
  ctx.beginPath();
  ctx.ellipse(headX - 2, headY - 1, 3, 2, -0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawArms(
  ctx: CanvasRenderingContext2D,
  frame: AnimationFrame,
  shift: number,
  shoulderY: number,
  hbY: number,
): void {
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  if (frame === 'punch-left') {
    // Left arm extended in punch
    ctx.beginPath();
    ctx.moveTo(-7 + shift, shoulderY);
    ctx.lineTo(-30 + shift, shoulderY - 5);
    ctx.stroke();
    // Fist
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(-30 + shift, shoulderY - 5, 3.5, 0, Math.PI * 2);
    ctx.fill();
    // Right arm on handlebar
    ctx.beginPath();
    ctx.moveTo(7 + shift, shoulderY);
    ctx.lineTo(15, hbY);
    ctx.stroke();
  } else if (frame === 'punch-right') {
    // Left arm on handlebar
    ctx.beginPath();
    ctx.moveTo(-7 + shift, shoulderY);
    ctx.lineTo(-15, hbY);
    ctx.stroke();
    // Right arm extended in punch
    ctx.beginPath();
    ctx.moveTo(7 + shift, shoulderY);
    ctx.lineTo(30 + shift, shoulderY - 5);
    ctx.stroke();
    // Fist
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(30 + shift, shoulderY - 5, 3.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Both hands on handlebars
    ctx.beginPath();
    ctx.moveTo(-7 + shift, shoulderY);
    ctx.lineTo(-15, hbY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(7 + shift, shoulderY);
    ctx.lineTo(15, hbY);
    ctx.stroke();
    // Gloves
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(-15, hbY, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(15, hbY, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Wipeout scene (multi-phase)
// ---------------------------------------------------------------------------

function drawWipeoutScene(ctx: CanvasRenderingContext2D, player: Player): void {
  const phase = player.wipeoutPhase;
  const dur = phaseDuration(phase);
  const t = dur > 0 ? Math.max(0, Math.min(1, 1 - player.wipeoutPhaseTimer / dur)) : 1;

  switch (phase) {
    case 'launch': {
      // Bike slides and rotates on ground
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.translate(player.bikeSlideX * 0.3, 0);
      ctx.rotate(t * 1.2);
      drawMotorcycle(ctx, player);
      ctx.restore();
      // Spark particles from bike sliding
      drawSparks(ctx, player.bikeSlideX * 0.3, 4, t);
      // Rider arcs through the air
      ctx.save();
      ctx.translate(player.riderOffsetX, player.riderOffsetY);
      ctx.rotate(player.riderRotation);
      drawRagdollRider(ctx);
      ctx.restore();
      break;
    }
    case 'tumble': {
      // Bike on its side, slid to final position
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.translate(-22 + player.bikeSlideX * 0.1, 0);
      ctx.rotate(1.4);
      drawMotorcycle(ctx, player);
      ctx.restore();
      // Rider bouncing/rolling on ground with dust
      ctx.save();
      ctx.translate(player.riderOffsetX, player.riderOffsetY);
      ctx.rotate(player.riderRotation);
      drawRagdollRider(ctx);
      ctx.restore();
      // Dust cloud particles
      drawDustParticles(ctx, player.riderOffsetX, 2, t);
      break;
    }
    case 'getup': {
      // Bike still fallen
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.translate(-22, 0);
      ctx.rotate(1.4);
      drawMotorcycle(ctx, player);
      ctx.restore();
      // Rider rising to standing
      ctx.save();
      ctx.translate(player.riderOffsetX, player.riderOffsetY - t * 12);
      ctx.rotate(player.riderRotation);
      drawStandingRider(ctx, t);
      ctx.restore();
      break;
    }
    case 'run': {
      // Bike gradually uprighting
      ctx.save();
      ctx.globalAlpha = 0.5 + t * 0.5;
      ctx.translate(-22 + t * 22, 0);
      ctx.rotate(1.4 * (1 - t));
      drawMotorcycle(ctx, player);
      ctx.restore();
      // Rider running toward bike
      ctx.save();
      ctx.translate(player.riderOffsetX, -16);
      drawRunningRider(ctx, t);
      ctx.restore();
      break;
    }
    default:
      break;
  }
}

// Spark particles emitted by sliding bike
function drawSparks(ctx: CanvasRenderingContext2D, bx: number, by: number, t: number): void {
  ctx.fillStyle = '#ffaa00';
  for (let i = 0; i < 5; i++) {
    const seed = i * 1.7 + t * 6;
    const sx = bx + Math.sin(seed) * 12;
    const sy = by + Math.cos(seed * 1.3) * 4 - 2;
    const size = 1.5 + Math.sin(seed * 2) * 1;
    const alpha = Math.max(0, 1 - t * 0.8 - i * 0.1);
    ctx.globalAlpha = alpha;
    ctx.fillRect(sx, sy, size, size);
  }
  ctx.globalAlpha = 1;
}

// Dust particles kicked up by tumbling rider
function drawDustParticles(ctx: CanvasRenderingContext2D, rx: number, ry: number, t: number): void {
  for (let i = 0; i < 6; i++) {
    const seed = i * 2.3 + t * 4;
    const dx = rx + Math.sin(seed) * 18 - 9;
    const dy = ry - Math.abs(Math.sin(seed * 0.7)) * 10;
    const radius = 2 + Math.sin(seed) * 1.5;
    const alpha = Math.max(0, 0.4 - t * 0.35);
    ctx.fillStyle = `rgba(180,160,120,${alpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(dx, dy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRagdollRider(ctx: CanvasRenderingContext2D): void {
  // Torso
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(-4, -6, 8, 10);
  // Helmet
  ctx.fillStyle = '#cc2200';
  ctx.beginPath();
  ctx.arc(0, -9, 5, 0, Math.PI * 2);
  ctx.fill();
  // Limbs
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-4, -3); ctx.lineTo(-11, 3);
  ctx.moveTo(4, -3);  ctx.lineTo(11, -4);
  ctx.moveTo(-3, 4);  ctx.lineTo(-7, 11);
  ctx.moveTo(3, 4);   ctx.lineTo(8, 10);
  ctx.stroke();
}

function drawStandingRider(ctx: CanvasRenderingContext2D, progress: number): void {
  const h = 12 + progress * 5;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(-4, -h, 8, h);
  ctx.fillStyle = '#cc2200';
  ctx.beginPath();
  ctx.arc(0, -h - 5, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#222';
  ctx.fillRect(-4, 0, 3, 8);
  ctx.fillRect(1, 0, 3, 8);
}

function drawRunningRider(ctx: CanvasRenderingContext2D, progress: number): void {
  // Body
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(-4, -15, 8, 13);
  // Helmet
  ctx.fillStyle = '#cc2200';
  ctx.beginPath();
  ctx.arc(0, -20, 5, 0, Math.PI * 2);
  ctx.fill();
  // Running legs
  const swing = Math.sin(progress * Math.PI * 8) * 6;
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-2, -2); ctx.lineTo(-2 - swing, 7);
  ctx.moveTo(2, -2);  ctx.lineTo(2 + swing, 7);
  ctx.stroke();
  // Arms pumping (opposite phase)
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-4, -10); ctx.lineTo(-4 + swing, -3);
  ctx.moveTo(4, -10);  ctx.lineTo(4 - swing, -3);
  ctx.stroke();
}
