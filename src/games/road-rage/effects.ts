// Speed-related visual effects — screen shake, parallax, speed lines, vignette, camera mods

import { getTrackPalette, getTrackId } from './road';

// ---------------------------------------------------------------------------
// Screen shake
// ---------------------------------------------------------------------------

export interface SpeedEffects {
  shakeX: number;
  shakeY: number;
  shakeTimer: number;
  shakeDuration: number;
  shakeIntensity: number;
}

export function createSpeedEffects(): SpeedEffects {
  return {
    shakeX: 0,
    shakeY: 0,
    shakeTimer: 0,
    shakeDuration: 0,
    shakeIntensity: 0,
  };
}

export function updateSpeedEffects(e: SpeedEffects, dt: number): void {
  if (e.shakeTimer > 0) {
    e.shakeTimer = Math.max(0, e.shakeTimer - dt);
    const t = e.shakeDuration > 0 ? e.shakeTimer / e.shakeDuration : 0;
    const mag = e.shakeIntensity * Math.min(t, 1);
    e.shakeX = (Math.random() - 0.5) * mag;
    e.shakeY = (Math.random() - 0.5) * mag;
  } else {
    e.shakeX = 0;
    e.shakeY = 0;
  }
}

export function triggerShake(e: SpeedEffects, intensity: number, duration: number): void {
  e.shakeIntensity = intensity;
  e.shakeDuration = duration;
  e.shakeTimer = duration;
}

// Road rumble: tiny random translate at high speed to simulate road texture
export function applyRoadRumble(
  ctx: CanvasRenderingContext2D,
  speed: number,
  maxSpeed: number,
): void {
  if (maxSpeed <= 0) return;
  const ratio = speed / maxSpeed;
  if (ratio < 0.6) return;
  const intensity = (ratio - 0.6) / 0.4 * 1.5;
  ctx.translate(
    (Math.random() - 0.5) * intensity,
    (Math.random() - 0.5) * intensity,
  );
}

// ---------------------------------------------------------------------------
// Parallax mountains / hills behind the road (call BEFORE road)
// ---------------------------------------------------------------------------

export function renderParallaxBg(
  ctx: CanvasRenderingContext2D,
  playerX: number,
  playerZ: number,
  speed: number,
  width: number,
  height: number,
  _palette?: unknown,
): void {
  const palette = getTrackPalette();
  const tid = getTrackId();
  const horizon = Math.round(height * 0.48);

  // Pick layer colors by track
  let farColor: string;
  let midColor: string;
  let nearColor: string;
  switch (tid) {
    case 0: farColor = '#6b3410'; midColor = '#7d441a'; nearColor = '#8b4513'; break;
    case 1: farColor = '#1a4a30'; midColor = '#245a3d'; nearColor = '#2d6a4a'; break;
    case 2: farColor = '#333344'; midColor = '#3d3d4e'; nearColor = '#474758'; break;
    case 3: farColor = '#0f2a1f'; midColor = '#163525'; nearColor = '#1d402c'; break;
    default: farColor = '#2a2a2a'; midColor = '#333'; nearColor = '#3c3c3c';
  }

  // Far layer — large gentle shapes, very slow scroll
  const farOff = playerZ * 0.001 + playerX * 0.05;
  drawMountainLayer(ctx, width, horizon, farOff, farColor, 50, 0.006, 35);

  // Mid layer — smaller hills, moderate scroll
  const midOff = playerZ * 0.003 + playerX * 0.1;
  drawMountainLayer(ctx, width, horizon, midOff, midColor, 30, 0.01, 22);

  // Near layer — closest hills (only when speed is non-trivial, for depth)
  if (speed > 10) {
    const nearOff = playerZ * 0.006 + playerX * 0.15;
    const alpha = Math.min(1, speed / 100);
    ctx.globalAlpha = alpha * 0.5;
    drawMountainLayer(ctx, width, horizon, nearOff, nearColor, 20, 0.018, 14);
    ctx.globalAlpha = 1;
  }
}

function drawMountainLayer(
  ctx: CanvasRenderingContext2D,
  w: number,
  horizon: number,
  offset: number,
  color: string,
  baseHeight: number,
  freq: number,
  step: number,
): void {
  const shift = (offset * w) % w;
  ctx.fillStyle = color;
  for (let p = -1; p <= 2; p++) {
    const baseX = p * w - shift;
    ctx.beginPath();
    ctx.moveTo(baseX, horizon);
    for (let x = 0; x <= w; x += step) {
      const wx = x + p * w;
      const h = Math.sin(wx * freq) * baseHeight + Math.sin(wx * freq * 2.7) * baseHeight * 0.4;
      ctx.lineTo(baseX + x, horizon - Math.max(0, h));
    }
    ctx.lineTo(baseX + w, horizon);
    ctx.closePath();
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Speed lines overlay (call AFTER road, BEFORE HUD)
// ---------------------------------------------------------------------------

interface SpeedLine {
  y: number;
  side: number; // -1 left, 1 right
  lifetime: number;
  maxLife: number;
  baseLen: number;
}

const speedLines: SpeedLine[] = [];
let speedLineTimer = 0;

export function renderSpeedLines(
  ctx: CanvasRenderingContext2D,
  speed: number,
  maxSpeed: number,
  w: number,
  h: number,
): void {
  if (maxSpeed <= 0) return;
  const ratio = speed / maxSpeed;
  if (ratio <= 0.5) {
    speedLines.length = 0;
    return;
  }

  const strength = (ratio - 0.5) / 0.5;
  const targetCount = Math.floor(18 + strength * 14);

  // Spawn new lines
  speedLineTimer += 0.016; // ~60fps tick
  while (speedLines.length < targetCount) {
    speedLines.push({
      y: Math.random() * h,
      side: Math.random() > 0.5 ? 1 : -1,
      lifetime: 0,
      maxLife: 0.15 + Math.random() * 0.3,
      baseLen: 20 + Math.random() * 50,
    });
  }

  // Update and draw
  ctx.lineWidth = 1.5 + strength;
  for (let i = speedLines.length - 1; i >= 0; i--) {
    const line = speedLines[i];
    line.lifetime += 0.016;

    // Fade factor: ramp up then down
    const lt = line.lifetime / line.maxLife;
    if (lt >= 1) {
      speedLines.splice(i, 1);
      continue;
    }
    const fade = lt < 0.3 ? lt / 0.3 : (1 - lt) / 0.7;
    const alpha = strength * 0.18 * fade;
    const len = line.baseLen * strength;

    ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    ctx.beginPath();
    if (line.side < 0) {
      ctx.moveTo(0, line.y);
      ctx.lineTo(len, line.y);
    } else {
      ctx.moveTo(w, line.y);
      ctx.lineTo(w - len, line.y);
    }
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Vignette darkening at edges (call AFTER road)
// ---------------------------------------------------------------------------

export function renderVignette(
  ctx: CanvasRenderingContext2D,
  speed: number,
  maxSpeed: number,
  w: number,
  h: number,
): void {
  if (maxSpeed <= 0) return;
  const ratio = speed / maxSpeed;
  if (ratio <= 0.85) return;

  const strength = (ratio - 0.85) / 0.15; // 0→1
  const alpha = strength * 0.4;

  const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.72);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(0,0,0,${alpha.toFixed(3)})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------------------
// Camera modifiers based on speed
// ---------------------------------------------------------------------------

/** Returns multiplier for camera height (1.0 at rest, ~0.85 at max). */
export function getCameraHeightMod(speed: number, maxSpeed: number): number {
  if (maxSpeed <= 0) return 1;
  const t = Math.min(1, speed / maxSpeed);
  return 1 - t * 0.15;
}

/** Returns multiplier for FOV (1.0 at rest, ~1.12 at max). */
export function getFOVMod(speed: number, maxSpeed: number): number {
  if (maxSpeed <= 0) return 1;
  const t = Math.min(1, speed / maxSpeed);
  return 1 + t * 0.12;
}
