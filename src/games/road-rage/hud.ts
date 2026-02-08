// Race HUD overlay — tachometer, position, health, progress, damage vignette, timer

// ---------------------------------------------------------------------------
// HUD State
// ---------------------------------------------------------------------------

export interface HUDState {
  damageFlash: number;      // 0-1, decays over time
  positionChanged: number;  // timer for position change animation
  lastPosition: number;
}

export function createHUDState(): HUDState {
  return { damageFlash: 0, positionChanged: 0, lastPosition: 1 };
}

export function updateHUD(state: HUDState, dt: number): void {
  state.damageFlash = Math.max(0, state.damageFlash - dt * 3);
  state.positionChanged = Math.max(0, state.positionChanged - dt * 3);
}

export function triggerDamageFlash(state: HUDState): void {
  state.damageFlash = 1;
}

// ---------------------------------------------------------------------------
// Position calculation (kept for external use)
// ---------------------------------------------------------------------------

export function calculatePosition(
  playerZ: number,
  rivals: Array<{ z: number }>,
  totalDistance: number,
): number {
  let ahead = 0;
  for (const r of rivals) {
    let dz = r.z - playerZ;
    if (dz < -totalDistance / 2) dz += totalDistance;
    if (dz > totalDistance / 2) dz -= totalDistance;
    if (dz > 0) ahead++;
  }
  return ahead + 1;
}

// ---------------------------------------------------------------------------
// Main render entry
// ---------------------------------------------------------------------------

export function renderHUD(
  ctx: CanvasRenderingContext2D,
  state: HUDState,
  speed: number,
  maxSpeed: number,
  health: number,
  maxHealth: number,
  position: number,
  totalRacers: number,
  progress: number,
  raceTime: number,
  rivalProgress: number[],
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;

  ctx.save();

  // Detect position change
  if (position !== state.lastPosition) {
    state.positionChanged = 1;
    state.lastPosition = position;
  }

  drawSpeedometer(ctx, speed, maxSpeed, H);
  drawPositionIndicator(ctx, position, totalRacers, state.positionChanged, W);
  drawHealthBar(ctx, health, maxHealth, state.damageFlash);
  drawProgressBar(ctx, progress, rivalProgress, W, H);
  drawDamageVignette(ctx, state.damageFlash, health, maxHealth, W, H);
  drawRaceTimer(ctx, raceTime, W);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// 1. Tachometer-style speedometer (bottom-left)
// ---------------------------------------------------------------------------

function drawSpeedometer(
  ctx: CanvasRenderingContext2D,
  speed: number,
  maxSpeed: number,
  H: number,
): void {
  const cx = 66;
  const cy = H - 66;
  const radius = 50;
  const ratio = Math.min(1, Math.max(0, speed / maxSpeed));
  const mph = Math.round(ratio * 180);

  // Arc range: from 150° to 390° (240° sweep)
  const startAngle = (150 * Math.PI) / 180;
  const endAngle = (390 * Math.PI) / 180;
  const sweep = endAngle - startAngle;

  // Dark background circle
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
  ctx.fill();

  // Outer ring
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
  ctx.stroke();

  // Colored arc segments (green → yellow → red)
  const arcWidth = 6;
  const segments = 40;
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    const a0 = startAngle + sweep * t;
    const a1 = startAngle + sweep * ((i + 1) / segments);
    ctx.strokeStyle = arcColor(t);
    ctx.lineWidth = arcWidth;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 4, a0, a1);
    ctx.stroke();
  }

  // Tick marks
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const angle = startAngle + sweep * t;
    const isMajor = i % 3 === 0;
    const innerR = radius - (isMajor ? 14 : 10);
    const outerR = radius - 8;
    ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
    ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
    ctx.stroke();
  }

  // Needle
  const needleAngle = startAngle + sweep * ratio;
  ctx.strokeStyle = '#ff3333';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(
    cx + Math.cos(needleAngle) * (radius - 16),
    cy + Math.sin(needleAngle) * (radius - 16),
  );
  ctx.stroke();

  // Needle hub
  ctx.fillStyle = '#cc2200';
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();

  // Digital speed readout
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 22px monospace';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${mph}`, cx, cy + 18);
  ctx.font = '9px monospace';
  ctx.fillStyle = '#999999';
  ctx.fillText('MPH', cx, cy + 30);
}

function arcColor(t: number): string {
  if (t < 0.45) return `rgb(34,204,68)`;
  if (t < 0.7) {
    const blend = (t - 0.45) / 0.25;
    const r = Math.round(34 + (221 - 34) * blend);
    const g = Math.round(204 + (170 - 204) * blend);
    return `rgb(${r},${g},0)`;
  }
  const blend = (t - 0.7) / 0.3;
  const r = Math.round(221 + (255 - 221) * blend);
  const g = Math.round(170 * (1 - blend));
  return `rgb(${r},${g},0)`;
}

// ---------------------------------------------------------------------------
// 2. Position indicator (top-right)
// ---------------------------------------------------------------------------

function drawPositionIndicator(
  ctx: CanvasRenderingContext2D,
  position: number,
  totalRacers: number,
  animTimer: number,
  W: number,
): void {
  const px = W - 80;
  const py = 16;

  // Panel
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(ctx, px - 10, py - 6, 80, 50, 5);
  ctx.fill();

  // Scale animation on position change
  const scale = 1 + animTimer * 0.3;
  ctx.save();
  ctx.translate(px + 20, py + 14);
  ctx.scale(scale, scale);

  // Position color
  const color =
    position === 1 ? '#ffd700' :
    position === 2 ? '#c0c0c0' :
    position === 3 ? '#cd7f32' : '#ffffff';

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 28px monospace';
  ctx.fillStyle = color;
  ctx.fillText(ordinal(position), 0, 0);
  ctx.restore();

  // "of N"
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = '11px monospace';
  ctx.fillStyle = '#999999';
  ctx.fillText(`of ${totalRacers}`, px + 20, py + 32);
}

// ---------------------------------------------------------------------------
// 3. Health bar (top-left)
// ---------------------------------------------------------------------------

function drawHealthBar(
  ctx: CanvasRenderingContext2D,
  health: number,
  maxHealth: number,
  damageFlash: number,
): void {
  const px = 12;
  const py = 12;
  const barW = 150;
  const barH = 15;
  const hpPct = Math.max(0, Math.min(1, health / maxHealth));

  // Panel background
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(ctx, px - 4, py - 4, barW + 50, barH + 16, 4);
  ctx.fill();

  // HP label
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 10px monospace';
  ctx.fillStyle = '#bbbbbb';
  ctx.fillText('HP', px, py + barH / 2);

  const barX = px + 22;
  const innerW = barW - 22;

  // Pixel-art border
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX - 1, py - 1, innerW + 2, barH + 2);

  // Bar background
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(barX, py, innerW, barH);

  // Fill color by %
  const barColor = hpPct > 0.6 ? '#22cc44' : hpPct > 0.3 ? '#ddaa00' : '#dd2222';

  // Flash white on damage
  const flashWhite = damageFlash > 0.5;
  ctx.fillStyle = flashWhite ? '#ffffff' : barColor;
  ctx.fillRect(barX, py, innerW * hpPct, barH);

  // Highlight stripe on bar top
  if (hpPct > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(barX, py, innerW * hpPct, 3);
  }

  // Numeric health
  ctx.textAlign = 'left';
  ctx.font = '11px monospace';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${Math.round(health)}`, barX + innerW + 6, py + barH / 2);
}

// ---------------------------------------------------------------------------
// 4. Progress bar (bottom, full width)
// ---------------------------------------------------------------------------

function drawProgressBar(
  ctx: CanvasRenderingContext2D,
  progress: number,
  rivalProgress: number[],
  W: number,
  H: number,
): void {
  const margin = 12;
  const barH = 8;
  const barY = H - barH - 4;
  const barW = W - margin * 2;
  const pct = Math.min(1, Math.max(0, progress));

  // Track background
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(ctx, margin - 2, barY - 2, barW + 4, barH + 4, 3);
  ctx.fill();

  ctx.fillStyle = '#222222';
  ctx.fillRect(margin, barY, barW, barH);

  // Filled portion
  ctx.fillStyle = '#335588';
  ctx.fillRect(margin, barY, barW * pct, barH);

  // Rival dots
  for (const rp of rivalProgress) {
    const rx = margin + barW * Math.min(1, Math.max(0, rp));
    ctx.fillStyle = '#ff5555';
    ctx.beginPath();
    ctx.arc(rx, barY + barH / 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player dot (on top)
  const dotX = margin + barW * pct;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(dotX, barY + barH / 2, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#4488ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(dotX, barY + barH / 2, 4, 0, Math.PI * 2);
  ctx.stroke();

  // Finish flag icon (checkered pattern at end)
  const flagX = margin + barW - 1;
  const flagY = barY - 6;
  const s = 3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#111111';
      ctx.fillRect(flagX + c * s, flagY + r * s, s, s);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Damage vignette
// ---------------------------------------------------------------------------

function drawDamageVignette(
  ctx: CanvasRenderingContext2D,
  damageFlash: number,
  health: number,
  maxHealth: number,
  W: number,
  H: number,
): void {
  const hpPct = maxHealth > 0 ? health / maxHealth : 1;

  // Persistent low-health pulse when < 25%
  let alpha = 0;
  if (hpPct < 0.25 && hpPct > 0) {
    alpha = (0.15 + Math.sin(Date.now() * 0.006) * 0.08) * (1 - hpPct / 0.25);
  }

  // Acute damage flash
  if (damageFlash > 0) {
    alpha = Math.max(alpha, damageFlash * 0.35);
  }

  if (alpha <= 0) return;

  // Radial gradient: transparent center, red edges
  const grd = ctx.createRadialGradient(W / 2, H / 2, W * 0.25, W / 2, H / 2, W * 0.7);
  grd.addColorStop(0, 'rgba(255,0,0,0)');
  grd.addColorStop(1, `rgba(200,0,0,${alpha.toFixed(3)})`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------------------
// 6. Race timer (top-center)
// ---------------------------------------------------------------------------

function drawRaceTimer(
  ctx: CanvasRenderingContext2D,
  raceTime: number,
  W: number,
): void {
  const label = formatTime(raceTime);

  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(ctx, W / 2 - 44, 10, 88, 22, 4);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '13px monospace';
  ctx.fillStyle = '#cccccc';
  ctx.fillText(label, W / 2, 21);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ordinal(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
