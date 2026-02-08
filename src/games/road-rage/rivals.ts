// AI rival riders — personality-driven motorcycle opponents

import type { Player } from './player';
import {
  type RoadSegment,
  type Camera,
  SEGMENT_LENGTH,
  ROAD_WIDTH,
} from './road';

export interface Rival {
  x: number;          // horizontal position on road (-1 to 1)
  z: number;          // position along road (world units)
  speed: number;      // current speed (same scale as Player.speed, 0-300)
  baseSpeed: number;  // target cruising speed (varies per rival)
  health: number;     // 0-100
  maxHealth: number;
  isWipedOut: boolean;
  wipeoutTimer: number;
  color: string;      // bike color for rendering
  personality: 'aggressive' | 'defensive' | 'reckless';
  name: string;       // display name
  portraitColor: string; // unique color for name tag
  targetX: number;    // where the rival wants to be horizontally
  laneChangeTimer: number; // cooldown for lane changes
  hitFlash: number;     // 0=normal, >0 = flash white, decays per frame
}

// --- Constants -----------------------------------------------------------

// Personality-based color cues: aggressive=red, defensive=blue, reckless=yellow
const PERSONALITY_COLORS: Record<Rival['personality'], string[]> = {
  aggressive: ['#e74c3c', '#cc3333', '#ff4444'],
  defensive: ['#3498db', '#2277bb', '#5599dd'],
  reckless: ['#f1c40f', '#e6a800', '#ffcc22'],
};

const RIVAL_PROFILES = [
  { name: 'BLAZE', color: '#ff3333', personality: 'aggressive' as const },
  { name: 'VIPER', color: '#33cc33', personality: 'aggressive' as const },
  { name: 'SHADOW', color: '#6633cc', personality: 'defensive' as const },
  { name: 'GHOST', color: '#cccccc', personality: 'defensive' as const },
  { name: 'FURY', color: '#ff6600', personality: 'reckless' as const },
  { name: 'STORM', color: '#3399ff', personality: 'reckless' as const },
  { name: 'RAZOR', color: '#cc33cc', personality: 'aggressive' as const },
];

const PERSONALITIES: Rival['personality'][] = [
  'aggressive', 'defensive', 'reckless',
];

const WIPEOUT_DURATION = 2;
const COLLISION_Z = 100;       // world-unit proximity for collision
const COLLISION_X = 0.3;       // x-proximity (-1 to 1 scale)
const RUBBER_BAND_RANGE = 5000;
const LANE_CHANGE_MIN = 1.5;   // seconds
const LANE_CHANGE_MAX = 4;
const CENTRIFUGAL_FORCE = 0.3; // same as player

// --- Factory -------------------------------------------------------------

export function createRivals(count: number, _roadLength: number): Rival[] {
  const rivals: Rival[] = [];
  for (let i = 0; i < count; i++) {
    const profile = RIVAL_PROFILES[i % RIVAL_PROFILES.length];
    const baseSpeed = 180 + (100 * i) / Math.max(count - 1, 1); // 180-280
    const personality = profile.personality;
    const colors = PERSONALITY_COLORS[personality];
    rivals.push({
      x: -0.6 + (1.2 * i) / Math.max(count - 1, 1),
      z: 2000 + i * 800,
      speed: baseSpeed,
      baseSpeed,
      health: 100,
      maxHealth: 100,
      isWipedOut: false,
      wipeoutTimer: 0,
      color: colors[Math.floor(i / PERSONALITIES.length) % colors.length],
      personality,
      name: profile.name,
      portraitColor: profile.color,
      targetX: 0,
      laneChangeTimer: 1 + i * 0.4,
      hitFlash: 0,
    });
  }
  return rivals;
}

// --- Update --------------------------------------------------------------

/**
 * Returns true when a rival–player collision occurs this tick so the
 * caller can apply damage / slowdown to the player as well.
 */
export function updateRivals(
  rivals: Rival[],
  player: Player,
  road: RoadSegment[],
  dt: number,
): boolean {
  const totalZ = road.length * SEGMENT_LENGTH;
  let playerHit = false;

  for (const rival of rivals) {
    if (rival.hitFlash > 0) rival.hitFlash = Math.max(0, rival.hitFlash - dt * 8);

    // --- Wipeout recovery ---
    if (rival.isWipedOut) {
      rival.wipeoutTimer -= dt;
      rival.speed = Math.max(0, rival.speed - rival.baseSpeed * 2 * dt);
      if (rival.wipeoutTimer <= 0) {
        rival.isWipedOut = false;
        rival.health = rival.maxHealth;
        rival.speed = rival.baseSpeed * 0.5;
      }
      rival.z = (rival.z + rival.speed * SEGMENT_LENGTH * dt) % totalZ;
      continue;
    }

    // --- Speed oscillation (±10%) for natural pack feel ---
    const noise = Math.sin(rival.z * 0.001 + rival.baseSpeed) * 0.1;
    let targetSpeed = rival.baseSpeed * (1 + noise);

    // --- Personality speed modifiers ---
    if (rival.personality === 'reckless') {
      targetSpeed *= 1.12; // reckless riders are noticeably faster
    } else if (rival.personality === 'defensive') {
      targetSpeed *= 0.95; // defensive riders play it safe
    }

    // --- Rubber banding (subtle) ---
    const dz = wrappedDelta(rival.z, player.z, totalZ);
    if (dz < -RUBBER_BAND_RANGE) {
      targetSpeed *= 1.15; // behind → gentle boost
    } else if (dz > RUBBER_BAND_RANGE) {
      targetSpeed *= 0.88; // ahead → ease off
    }

    // Smoothly approach target speed
    rival.speed += (targetSpeed - rival.speed) * 2 * dt;
    rival.speed = Math.max(0, rival.speed);

    // --- Lane-change AI ---
    rival.laneChangeTimer -= dt;
    if (rival.laneChangeTimer <= 0) {
      rival.targetX = pickTargetX(rival, player, dz);
      const interval = rival.personality === 'aggressive'
        ? LANE_CHANGE_MIN
        : rival.personality === 'reckless'
          ? LANE_CHANGE_MIN * 0.5 // reckless weaves very frequently
          : LANE_CHANGE_MAX;
      rival.laneChangeTimer = interval + Math.random() * interval;
    }

    // Steer smoothly toward target — reckless steers faster, aggressive moderately
    const steerMult = rival.personality === 'reckless' ? 2.5
      : rival.personality === 'aggressive' ? 1.8 : 1.2;
    const steerRate = steerMult * dt;
    rival.x += (rival.targetX - rival.x) * steerRate;
    rival.x = Math.max(-1, Math.min(1, rival.x));

    // --- Curve centrifugal pull (mirrors player physics) ---
    const segIdx = Math.floor(rival.z / SEGMENT_LENGTH) % road.length;
    const speedRatio = rival.speed / 300; // normalise same as player
    rival.x -= CENTRIFUGAL_FORCE * speedRatio * road[segIdx].curve * dt;

    // --- Move forward (same formula as player.ts) ---
    rival.z = (rival.z + rival.speed * SEGMENT_LENGTH * dt) % totalZ;

    // --- Reckless crash chance: high speed + sharp curves → random wipeout ---
    if (rival.personality === 'reckless' && !rival.isWipedOut) {
      const curve = Math.abs(road[segIdx].curve);
      if (curve > 0.3 && speedRatio > 0.7 && Math.random() < 0.003) {
        rival.isWipedOut = true;
        rival.wipeoutTimer = WIPEOUT_DURATION;
        rival.health = 0;
        rival.speed *= 0.2;
      }
    }

    // --- Collision with player ---
    if (!player.isWipedOut) {
      const collDZ = Math.abs(wrappedDelta(rival.z, player.z, totalZ));
      const collDX = Math.abs(rival.x - player.x);
      if (collDZ < COLLISION_Z && collDX < COLLISION_X) {
        rival.speed *= 0.92;
        rival.health -= 5;
        if (rival.health <= 0) {
          rival.isWipedOut = true;
          rival.wipeoutTimer = WIPEOUT_DURATION;
        }
        playerHit = true;
      }
    }
  }

  return playerHit;
}

// --- Rendering -----------------------------------------------------------

export function renderRivals(
  ctx: CanvasRenderingContext2D,
  rivals: Rival[],
  segments: RoadSegment[],
  camera: Camera,
  resolution: { width: number; height: number },
): void {
  const totalZ = segments.length * SEGMENT_LENGTH;
  const halfW = resolution.width / 2;
  const halfH = resolution.height / 2;

  // Sort rivals back-to-front relative to camera
  const sorted = [...rivals]
    .map((r) => {
      let relZ = r.z - camera.z;
      if (relZ < 0) relZ += totalZ;
      return { rival: r, relZ };
    })
    .filter((r) => r.relZ > 0 && r.relZ < SEGMENT_LENGTH * 300)
    .sort((a, b) => b.relZ - a.relZ); // farthest first

  const baseIdx = Math.floor(camera.z / SEGMENT_LENGTH) % segments.length;

  for (const { rival, relZ } of sorted) {
    const scale = camera.distToProjection / relZ;
    if (scale < 0.0005) continue;

    // Segment the rival sits on — gives us world.y for vertical placement
    const segIdx = Math.floor(rival.z / SEGMENT_LENGTH) % segments.length;
    const seg = segments[segIdx];

    // Accumulate curve offset from camera to this rival's distance
    const stepsToRival = Math.floor(relZ / SEGMENT_LENGTH);
    let curveAccum = 0;
    for (let s = 0; s <= stepsToRival && s < 300; s++) {
      curveAccum += segments[(baseIdx + s) % segments.length].curve;
    }
    const curveOffset = curveAccum * SEGMENT_LENGTH;

    // Project to screen (mirrors renderer.ts projection maths)
    const screenX =
      halfW +
      scale * (rival.x * ROAD_WIDTH + curveOffset - camera.x) * halfW;
    const screenY = halfH - (scale * (seg.world.y - camera.y) * halfH);

    // Clip below road horizon
    if (screenY > seg.clip && seg.clip > 0) continue;

    // Bike dimensions scale with distance
    const bikeW = Math.max(2, scale * ROAD_WIDTH * 0.07 * halfW);
    const bikeH = bikeW * 1.6;

    ctx.save();

    if (rival.isWipedOut) {
      ctx.globalAlpha = 0.5 + Math.sin(rival.wipeoutTimer * 12) * 0.3;
    }

    // Hit flash — draw everything white
    const useColor = rival.hitFlash > 0 ? '#ffffff' : rival.color;
    const useDark = rival.hitFlash > 0 ? '#dddddd' : '#222222';
    const useAccent = rival.hitFlash > 0 ? '#eeeeee' : '#444444';

    const bw = bikeW;
    const bh = bikeH;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(screenX, screenY + bh * 0.05, bw * 0.7, bh * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();

    // --- Rear wheel ---
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.ellipse(screenX - bw * 0.18, screenY, bw * 0.18, bh * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    // Rim
    ctx.strokeStyle = '#555';
    ctx.lineWidth = Math.max(0.5, bw * 0.03);
    ctx.beginPath();
    ctx.ellipse(screenX - bw * 0.18, screenY, bw * 0.13, bh * 0.1, 0, 0, Math.PI * 2);
    ctx.stroke();

    // --- Front wheel ---
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.ellipse(screenX + bw * 0.18, screenY, bw * 0.18, bh * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = Math.max(0.5, bw * 0.03);
    ctx.beginPath();
    ctx.ellipse(screenX + bw * 0.18, screenY, bw * 0.13, bh * 0.1, 0, 0, Math.PI * 2);
    ctx.stroke();

    // --- Frame (connects wheels) ---
    ctx.fillStyle = useColor;
    ctx.beginPath();
    ctx.moveTo(screenX - bw * 0.3, screenY - bh * 0.05);
    ctx.lineTo(screenX - bw * 0.15, screenY - bh * 0.35);
    ctx.lineTo(screenX + bw * 0.15, screenY - bh * 0.4);
    ctx.lineTo(screenX + bw * 0.3, screenY - bh * 0.1);
    ctx.lineTo(screenX + bw * 0.25, screenY);
    ctx.lineTo(screenX - bw * 0.25, screenY);
    ctx.closePath();
    ctx.fill();

    // --- Engine block ---
    ctx.fillStyle = useAccent;
    ctx.fillRect(screenX - bw * 0.12, screenY - bh * 0.15, bw * 0.24, bh * 0.12);

    // --- Exhaust ---
    ctx.fillStyle = '#666';
    ctx.fillRect(screenX - bw * 0.35, screenY - bh * 0.08, bw * 0.12, bh * 0.05);

    // --- Seat ---
    ctx.fillStyle = useDark;
    ctx.fillRect(screenX - bw * 0.15, screenY - bh * 0.42, bw * 0.25, bh * 0.1);

    // --- Rider torso ---
    ctx.fillStyle = useDark;
    ctx.beginPath();
    ctx.moveTo(screenX - bw * 0.12, screenY - bh * 0.42);
    ctx.lineTo(screenX - bw * 0.08, screenY - bh * 0.7);
    ctx.lineTo(screenX + bw * 0.08, screenY - bh * 0.7);
    ctx.lineTo(screenX + bw * 0.12, screenY - bh * 0.42);
    ctx.closePath();
    ctx.fill();

    // --- Helmet ---
    const helmetColor = rival.hitFlash > 0 ? '#ffffff' : rival.color;
    ctx.fillStyle = helmetColor;
    ctx.beginPath();
    ctx.arc(screenX, screenY - bh * 0.78, bw * 0.12, 0, Math.PI * 2);
    ctx.fill();
    // Visor
    ctx.fillStyle = '#1a1a3a';
    ctx.beginPath();
    ctx.arc(screenX, screenY - bh * 0.76, bw * 0.09, -0.3, Math.PI + 0.3, true);
    ctx.closePath();
    ctx.fill();

    // --- Arms (reaching to handlebars) ---
    ctx.strokeStyle = useDark;
    ctx.lineWidth = Math.max(1, bw * 0.06);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(screenX - bw * 0.1, screenY - bh * 0.6);
    ctx.lineTo(screenX + bw * 0.2, screenY - bh * 0.38);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(screenX + bw * 0.1, screenY - bh * 0.6);
    ctx.lineTo(screenX + bw * 0.25, screenY - bh * 0.38);
    ctx.stroke();

    // --- Handlebars ---
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = Math.max(0.5, bw * 0.04);
    ctx.beginPath();
    ctx.moveTo(screenX + bw * 0.12, screenY - bh * 0.38);
    ctx.lineTo(screenX + bw * 0.3, screenY - bh * 0.42);
    ctx.stroke();

    // --- Headlight glow (subtle) ---
    ctx.fillStyle = 'rgba(255,255,136,0.3)';
    ctx.beginPath();
    ctx.arc(screenX + bw * 0.28, screenY - bh * 0.25, bw * 0.06, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

// --- Helpers -------------------------------------------------------------

/** Signed wrapped distance from `a` to `b` on a looped road. */
function wrappedDelta(a: number, b: number, total: number): number {
  let d = a - b;
  if (d > total / 2) d -= total;
  if (d < -total / 2) d += total;
  return d;
}

/** Choose a target lane position based on personality and proximity to player. */
function pickTargetX(rival: Rival, player: Player, dzToPlayer: number): number {
  const nearPlayer = Math.abs(dzToPlayer) < 2000;

  switch (rival.personality) {
    case 'aggressive':
      // Near player → steer toward them aggressively; far → random lane
      if (nearPlayer) return player.x + (Math.random() - 0.5) * 0.08;
      return (Math.random() - 0.5) * 1.4;

    case 'defensive':
      if (nearPlayer) {
        // Steer firmly away from player
        const away = rival.x > player.x ? 0.8 : -0.8;
        return Math.max(-1, Math.min(1, away + (Math.random() - 0.5) * 0.2));
      }
      return (Math.random() - 0.5) * 0.6;

    case 'reckless':
      // Wild weaving regardless of player
      return (Math.random() - 0.5) * 2.0;

    default:
      return 0;
  }
}

// --- Portrait name tags --------------------------------------------------

const PORTRAIT_Z_RANGE = 300;
const PORTRAIT_MAX = 3;

/** Render name tags above the closest rivals within range. */
export function renderRivalPortrait(
  ctx: CanvasRenderingContext2D,
  rivals: Rival[],
  segments: RoadSegment[],
  camera: Camera,
  player: { z: number },
  resolution: { width: number; height: number },
): void {
  const totalZ = segments.length * SEGMENT_LENGTH;
  const halfW = resolution.width / 2;
  const halfH = resolution.height / 2;
  const baseIdx = Math.floor(camera.z / SEGMENT_LENGTH) % segments.length;

  // Find rivals within range, sorted by distance
  const nearby: { rival: Rival; relZ: number }[] = [];
  for (const rival of rivals) {
    let dz = rival.z - player.z;
    if (dz > totalZ / 2) dz -= totalZ;
    if (dz < -totalZ / 2) dz += totalZ;
    if (Math.abs(dz) <= PORTRAIT_Z_RANGE && dz > 0) {
      let relZ = rival.z - camera.z;
      if (relZ < 0) relZ += totalZ;
      nearby.push({ rival, relZ });
    }
  }
  nearby.sort((a, b) => a.relZ - b.relZ);
  const show = nearby.slice(0, PORTRAIT_MAX);

  for (const { rival, relZ } of show) {
    if (relZ <= 0) continue;
    const scale = camera.distToProjection / relZ;
    if (scale < 0.001) continue;

    const segIdx = Math.floor(rival.z / SEGMENT_LENGTH) % segments.length;
    const seg = segments[segIdx];

    const stepsToRival = Math.floor(relZ / SEGMENT_LENGTH);
    let curveAccum = 0;
    for (let s = 0; s <= stepsToRival && s < 300; s++) {
      curveAccum += segments[(baseIdx + s) % segments.length].curve;
    }
    const curveOffset = curveAccum * SEGMENT_LENGTH;

    const screenX = halfW + scale * (rival.x * ROAD_WIDTH + curveOffset - camera.x) * halfW;
    const screenY = halfH - (scale * (seg.world.y - camera.y) * halfH);
    const bikeW = Math.max(2, scale * ROAD_WIDTH * 0.07 * halfW);
    const bikeH = bikeW * 1.6;

    // Draw name tag above the rival
    const tagY = screenY - bikeH - bikeH * 0.5;
    const tagW = rival.name.length * 6 + 12;
    const tagH = 12;

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = rival.portraitColor;
    ctx.fillRect(screenX - tagW / 2, tagY - tagH, tagW, tagH);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(rival.name, screenX, tagY - tagH / 2);
    ctx.restore();
  }
}
