// Police pursuit system — spawns cops after excessive combat

import type { Player } from './player';
import type { Rival } from './rivals';
import type { RoadSegment, Camera } from './road';
import { SEGMENT_LENGTH, ROAD_WIDTH } from './road';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PoliceCop {
  x: number;
  z: number;
  speed: number;
  health: number;
  maxHealth: number;
  isWipedOut: boolean;
  wipeoutTimer: number;
  active: boolean;
}

export interface PoliceState {
  combatCount: number;
  cop: PoliceCop;
  respawnTimer: number;        // countdown to next cop spawn after KO
  busted: boolean;
  bustTimer: number;           // continuous seconds player is in bust range
  warningTimer: number;        // brief "POLICE!" flash countdown
  sirenPhase: number;          // oscillator phase for light flashing
  sirenSoundActive: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMBAT_THRESHOLD = 5;
const COP_HEALTH = 150;
const COP_WIPEOUT_DURATION = 5;
const COP_RESPAWN_DELAY = 30;
const BUST_RANGE_X = 0.2;
const BUST_RANGE_Z = 150;
const BUST_TIME = 3;           // seconds in range to get busted
const WARNING_DURATION = 2;    // seconds to flash "POLICE!"
const LIGHT_FLASH_INTERVAL = 0.3;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPoliceState(): PoliceState {
  return {
    combatCount: 0,
    cop: createCop(),
    respawnTimer: 0,
    busted: false,
    bustTimer: 0,
    warningTimer: 0,
    sirenPhase: 0,
    sirenSoundActive: false,
  };
}

function createCop(): PoliceCop {
  return {
    x: 0,
    z: 0,
    speed: 0,
    health: COP_HEALTH,
    maxHealth: COP_HEALTH,
    isWipedOut: false,
    wipeoutTimer: 0,
    active: false,
  };
}

// ---------------------------------------------------------------------------
// Combat counting
// ---------------------------------------------------------------------------

export function incrementCombatCount(police: PoliceState): void {
  police.combatCount++;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export function updatePolice(
  police: PoliceState,
  player: Player,
  road: RoadSegment[],
  dt: number,
): void {
  if (police.busted) return;

  const totalZ = road.length * SEGMENT_LENGTH;
  const cop = police.cop;

  police.sirenPhase += dt;
  police.warningTimer = Math.max(0, police.warningTimer - dt);

  // --- Spawn logic ---
  if (!cop.active && police.combatCount >= COMBAT_THRESHOLD) {
    if (cop.isWipedOut) {
      // Waiting for respawn
      police.respawnTimer -= dt;
      if (police.respawnTimer <= 0) {
        spawnCop(cop, player, totalZ);
        police.warningTimer = WARNING_DURATION;
        police.sirenSoundActive = true;
      }
    } else {
      // First spawn
      spawnCop(cop, player, totalZ);
      police.warningTimer = WARNING_DURATION;
      police.sirenSoundActive = true;
    }
  }

  if (!cop.active) return;

  // --- Wipeout recovery ---
  if (cop.isWipedOut) {
    cop.wipeoutTimer -= dt;
    cop.speed = Math.max(0, cop.speed - 200 * dt);
    cop.z = (cop.z + cop.speed * SEGMENT_LENGTH * dt) % totalZ;
    if (cop.wipeoutTimer <= 0) {
      cop.active = false;
      cop.isWipedOut = false;
      cop.health = COP_HEALTH;
      police.respawnTimer = COP_RESPAWN_DELAY;
      police.sirenSoundActive = false;
    }
    return;
  }

  // --- Chase AI ---
  const targetSpeed = player.maxSpeed * 1.1;
  cop.speed += (targetSpeed - cop.speed) * 2 * dt;
  cop.speed = Math.max(0, cop.speed);

  // Follow player's lane
  const steerRate = 2.5 * dt;
  cop.x += (player.x - cop.x) * steerRate;
  cop.x = Math.max(-1, Math.min(1, cop.x));

  // Curve centrifugal pull
  const segIdx = Math.floor(cop.z / SEGMENT_LENGTH) % road.length;
  const speedRatio = cop.speed / 300;
  cop.x -= 0.3 * speedRatio * road[segIdx].curve * dt;

  // Move forward
  cop.z = (cop.z + cop.speed * SEGMENT_LENGTH * dt) % totalZ;

  // --- Bust check ---
  const dz = Math.abs(wrappedDelta(cop.z, player.z, totalZ));
  const dx = Math.abs(cop.x - player.x);
  if (dz < BUST_RANGE_Z && dx < BUST_RANGE_X && !player.isWipedOut) {
    police.bustTimer += dt;
    if (police.bustTimer >= BUST_TIME) {
      police.busted = true;
    }
  } else {
    police.bustTimer = Math.max(0, police.bustTimer - dt * 0.5);
  }
}

function spawnCop(cop: PoliceCop, player: Player, totalZ: number): void {
  cop.active = true;
  cop.isWipedOut = false;
  cop.health = COP_HEALTH;
  cop.speed = player.speed * 0.8;
  cop.x = player.x;
  cop.z = (player.z - 3000 + totalZ) % totalZ; // spawn behind player
}

// ---------------------------------------------------------------------------
// Player punches cop
// ---------------------------------------------------------------------------

export function hitCop(police: PoliceState, damage: number): void {
  const cop = police.cop;
  if (!cop.active || cop.isWipedOut) return;
  cop.health -= damage;
  cop.speed *= 0.7;
  // Knock back
  cop.z -= 500;
  if (cop.z < 0) cop.z += 999999; // will be wrapped by update
  if (cop.health <= 0) {
    cop.isWipedOut = true;
    cop.wipeoutTimer = COP_WIPEOUT_DURATION;
    cop.health = 0;
  }
}

// Check if player attack is in range of cop
export function checkCopHit(
  police: PoliceState,
  player: Player,
  side: 'left' | 'right',
  rangeX: number,
  rangeZ: number,
  totalZ: number,
): boolean {
  const cop = police.cop;
  if (!cop.active || cop.isWipedOut) return false;

  let dz = cop.z - player.z;
  if (dz > totalZ / 2) dz -= totalZ;
  if (dz < -totalZ / 2) dz += totalZ;
  if (Math.abs(dz) > rangeZ) return false;

  const dx = cop.x - player.x;
  if (Math.abs(dx) > rangeX) return false;
  if (side === 'left' && dx > 0) return false;
  if (side === 'right' && dx < 0) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

export function resetPolice(police: PoliceState): void {
  police.combatCount = 0;
  police.busted = false;
  police.bustTimer = 0;
  police.warningTimer = 0;
  police.respawnTimer = 0;
  police.sirenPhase = 0;
  police.sirenSoundActive = false;
  const cop = police.cop;
  cop.active = false;
  cop.isWipedOut = false;
  cop.health = COP_HEALTH;
  cop.speed = 0;
  cop.wipeoutTimer = 0;
  cop.x = 0;
  cop.z = 0;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderCop(
  ctx: CanvasRenderingContext2D,
  police: PoliceState,
  segments: RoadSegment[],
  camera: Camera,
  resolution: { width: number; height: number },
): void {
  const cop = police.cop;
  if (!cop.active) return;

  const totalZ = segments.length * SEGMENT_LENGTH;
  const halfW = resolution.width / 2;
  const halfH = resolution.height / 2;

  let relZ = cop.z - camera.z;
  if (relZ < 0) relZ += totalZ;
  if (relZ <= 0 || relZ > SEGMENT_LENGTH * 300) return;

  const scale = camera.distToProjection / relZ;
  if (scale < 0.0005) return;

  const segIdx = Math.floor(cop.z / SEGMENT_LENGTH) % segments.length;
  const seg = segments[segIdx];

  const baseIdx = Math.floor(camera.z / SEGMENT_LENGTH) % segments.length;
  const stepsToRival = Math.floor(relZ / SEGMENT_LENGTH);
  let curveAccum = 0;
  for (let s = 0; s <= stepsToRival && s < 300; s++) {
    curveAccum += segments[(baseIdx + s) % segments.length].curve;
  }
  const curveOffset = curveAccum * SEGMENT_LENGTH;

  const screenX = halfW + scale * (cop.x * ROAD_WIDTH + curveOffset - camera.x) * halfW;
  const screenY = halfH - (scale * (seg.world.y - camera.y) * halfH);

  if (screenY > seg.clip && seg.clip > 0) return;

  const bikeW = Math.max(2, scale * ROAD_WIDTH * 0.04 * halfW);
  const bikeH = bikeW * 1.6;

  ctx.save();

  if (cop.isWipedOut) {
    ctx.globalAlpha = 0.5 + Math.sin(cop.wipeoutTimer * 12) * 0.3;
  }

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(screenX - bikeW * 0.6, screenY - bikeH * 0.05, bikeW * 1.2, bikeH * 0.12);

  // Bike body — police blue/white
  ctx.fillStyle = '#2255cc';
  ctx.fillRect(screenX - bikeW / 2, screenY - bikeH, bikeW, bikeH * 0.7);

  // White stripe
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(screenX - bikeW * 0.15, screenY - bikeH, bikeW * 0.3, bikeH * 0.7);

  // Rider
  ctx.fillStyle = '#1a1a44';
  ctx.fillRect(
    screenX - bikeW * 0.3,
    screenY - bikeH - bikeH * 0.3,
    bikeW * 0.6,
    bikeH * 0.4,
  );

  // Wheels
  ctx.fillStyle = '#111111';
  const wheelR = bikeW * 0.22;
  ctx.beginPath();
  ctx.arc(screenX - bikeW * 0.25, screenY, wheelR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(screenX + bikeW * 0.25, screenY, wheelR, 0, Math.PI * 2);
  ctx.fill();

  // Flashing lights — alternate red/blue every 0.3s
  const lightColor = Math.floor(police.sirenPhase / LIGHT_FLASH_INTERVAL) % 2 === 0
    ? '#ff0000' : '#0044ff';
  const lightR = bikeW * 0.18;
  ctx.fillStyle = lightColor;
  ctx.beginPath();
  ctx.arc(screenX - bikeW * 0.2, screenY - bikeH - bikeH * 0.35, lightR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(screenX + bikeW * 0.2, screenY - bikeH - bikeH * 0.35, lightR, 0, Math.PI * 2);
  ctx.fill();

  // Light glow
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = lightColor;
  ctx.beginPath();
  ctx.arc(screenX, screenY - bikeH - bikeH * 0.35, lightR * 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// Render police HUD elements (warning text, bust meter)
export function renderPoliceHUD(
  ctx: CanvasRenderingContext2D,
  police: PoliceState,
  W: number,
  H: number,
): void {
  if (!police.cop.active && police.combatCount < COMBAT_THRESHOLD) return;

  // "POLICE!" warning flash
  if (police.warningTimer > 0) {
    const flash = Math.floor(police.warningTimer * 5) % 2 === 0;
    if (flash) {
      ctx.save();
      ctx.fillStyle = '#ff0000';
      ctx.font = 'bold 32px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('POLICE!', W / 2, H / 2 - 100);
      ctx.textAlign = 'left';
      ctx.restore();
    }
  }

  // Bust proximity meter
  if (police.bustTimer > 0 && !police.busted) {
    const pct = Math.min(1, police.bustTimer / BUST_TIME);
    const barW = 200;
    const barH = 8;
    const bx = (W - barW) / 2;
    const by = 60;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bx - 2, by - 2, barW + 4, barH + 4);
    ctx.fillStyle = pct > 0.7 ? '#ff0000' : '#ffaa00';
    ctx.fillRect(bx, by, barW * pct, barH);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('BUSTING...', W / 2, by - 5);
    ctx.textAlign = 'left';
    ctx.restore();
  }
}

// Render BUSTED screen overlay
export function renderBustedScreen(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  blinkTimer: number,
): void {
  // Dim overlay
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, W, H);

  // Red/blue flashing border
  const borderColor = Math.floor(blinkTimer * 4) % 2 === 0 ? '#ff0000' : '#0044ff';
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);

  ctx.textAlign = 'center';

  // "BUSTED!" text
  ctx.fillStyle = '#ff0000';
  ctx.font = 'bold 60px monospace';
  ctx.fillText('BUSTED!', W / 2, H / 2 - 40);

  // Subtitle
  ctx.fillStyle = '#cccccc';
  ctx.font = '16px monospace';
  ctx.fillText('Pulled over by the cops!', W / 2, H / 2 + 10);
  ctx.fillText('Last place \u2022 No earnings', W / 2, H / 2 + 35);

  // Blink prompt
  if (Math.floor(blinkTimer * 2.5) % 2 === 0) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px monospace';
    ctx.fillText('Press SPACE to try again', W / 2, H / 2 + 80);
  }

  ctx.textAlign = 'left';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrappedDelta(a: number, b: number, total: number): number {
  let d = a - b;
  if (d > total / 2) d -= total;
  if (d < -total / 2) d += total;
  return d;
}
