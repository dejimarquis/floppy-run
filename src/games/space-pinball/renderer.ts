import { PhysicsWorld, Ball, TABLE_WIDTH, TABLE_HEIGHT } from './physics';
import { TableElement } from './table';
import { TiltState } from './tilt';

// ── Types ───────────────────────────────────────────────────────────
export interface ScorePopup {
  x: number; y: number; text: string; life: number; maxLife: number;
}

export interface RenderState {
  bumperFlash: number[];
  slingFlash: number[];
  dropTargetHit: boolean[];
  spinnerAngle: number;
  scorePopups: ScorePopup[];
  ballTrail: { x: number; y: number }[];
}

// ── Factory ─────────────────────────────────────────────────────────
export function createRenderState(): RenderState {
  return {
    bumperFlash: [0, 0, 0],
    slingFlash: [0, 0],
    dropTargetHit: [false, false, false],
    spinnerAngle: 0,
    scorePopups: [],
    ballTrail: [],
  };
}

export function triggerBumperFlash(rs: RenderState, idx: number): void {
  if (idx < rs.bumperFlash.length) rs.bumperFlash[idx] = 0.15;
}

export function triggerSlingFlash(rs: RenderState, side: number): void {
  if (side < rs.slingFlash.length) rs.slingFlash[side] = 0.12;
}

export function addScorePopup(rs: RenderState, x: number, y: number, text: string): void {
  rs.scorePopups.push({ x, y, text, life: 0.8, maxLife: 0.8 });
}

export function updateRenderState(rs: RenderState, dt: number, ball: Ball): void {
  for (let i = 0; i < rs.bumperFlash.length; i++) {
    if (rs.bumperFlash[i] > 0) rs.bumperFlash[i] = Math.max(0, rs.bumperFlash[i] - dt);
  }
  for (let i = 0; i < rs.slingFlash.length; i++) {
    if (rs.slingFlash[i] > 0) rs.slingFlash[i] = Math.max(0, rs.slingFlash[i] - dt);
  }
  for (let i = rs.scorePopups.length - 1; i >= 0; i--) {
    rs.scorePopups[i].life -= dt;
    rs.scorePopups[i].y -= 40 * dt;
    if (rs.scorePopups[i].life <= 0) rs.scorePopups.splice(i, 1);
  }
  // Ball trail
  if (ball.active && ball.speed > 200) {
    rs.ballTrail.push({ x: ball.x, y: ball.y });
    if (rs.ballTrail.length > 5) rs.ballTrail.shift();
  } else {
    rs.ballTrail.length = 0;
  }
}

// ── Main Render ─────────────────────────────────────────────────────
export function render(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  world: PhysicsWorld,
  ball: Ball,
  rs: RenderState,
  tilt: TiltState,
  score: number,
  highScore: number,
  ballsLeft: number,
  multiplier: number,
  elements: TableElement[],
  gameOver: boolean,
): void {
  const sx = canvas.width / TABLE_WIDTH;
  const sy = canvas.height / TABLE_HEIGHT;

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Tilt offset
  ctx.translate(tilt.tableOffsetX * sx, tilt.tableOffsetY * sy);

  // Background
  ctx.fillStyle = '#0a0020';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle grid
  ctx.strokeStyle = 'rgba(40,30,80,0.4)';
  ctx.lineWidth = 0.5;
  for (let gx = 0; gx < TABLE_WIDTH; gx += 20) {
    ctx.beginPath(); ctx.moveTo(gx * sx, 0); ctx.lineTo(gx * sx, canvas.height); ctx.stroke();
  }
  for (let gy = 0; gy < TABLE_HEIGHT; gy += 20) {
    ctx.beginPath(); ctx.moveTo(0, gy * sy); ctx.lineTo(canvas.width, gy * sy); ctx.stroke();
  }

  // ── Walls (line colliders) ──────────────────────────────────────
  // Categorize by table elements
  const elementLineIndices = new Set(elements.filter(e => e.type === 'slingshot' || e.type === 'ramp' || e.type === 'drop_target').map(e => e.index));

  for (let i = 0; i < world.lines.length; i++) {
    const line = world.lines[i];
    const el = elements.find(e => e.index === i && (e.type === 'slingshot' || e.type === 'ramp' || e.type === 'drop_target'));

    if (el && !el.active) {
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 2 * sx;
    } else if (el?.type === 'slingshot') {
      const slingElements = elements.filter(e => e.type === 'slingshot');
      const sideIdx = slingElements.indexOf(el) < 3 ? 0 : 1;
      const flash = rs.slingFlash[sideIdx] || 0;
      ctx.strokeStyle = flash > 0 ? `rgba(255,${150 + flash * 700},0,1)` : '#ff6600';
      ctx.lineWidth = (flash > 0 ? 4 : 2.5) * sx;
    } else if (el?.type === 'ramp') {
      ctx.strokeStyle = '#00ccff';
      ctx.lineWidth = 3 * sx;
    } else if (el?.type === 'drop_target') {
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 4 * sx;
    } else if (!elementLineIndices.has(i)) {
      // Plain wall — metallic glow
      ctx.strokeStyle = '#3344aa';
      ctx.lineWidth = 3 * sx;
      ctx.beginPath();
      ctx.moveTo(line.x1 * sx, line.y1 * sy);
      ctx.lineTo(line.x2 * sx, line.y2 * sy);
      ctx.stroke();
      ctx.strokeStyle = '#8899dd';
      ctx.lineWidth = 1.5 * sx;
    }

    ctx.beginPath();
    ctx.moveTo(line.x1 * sx, line.y1 * sy);
    ctx.lineTo(line.x2 * sx, line.y2 * sy);
    ctx.stroke();
  }

  // ── Ramp arrows ────────────────────────────────────────────────
  for (const el of elements) {
    if (el.type !== 'ramp' || !el.active) continue;
    const l = world.lines[el.index];
    if (!l) continue;
    const mx = (l.x1 + l.x2) / 2 * sx;
    const my = (l.y1 + l.y2) / 2 * sy;
    ctx.fillStyle = 'rgba(0,204,255,0.6)';
    ctx.beginPath();
    ctx.moveTo(mx, my - 6 * sy);
    ctx.lineTo(mx - 4 * sx, my + 2 * sy);
    ctx.lineTo(mx + 4 * sx, my + 2 * sy);
    ctx.closePath();
    ctx.fill();
  }

  // ── Bumpers ────────────────────────────────────────────────────
  const bumperElements = elements.filter(e => e.type === 'bumper');
  for (let bi = 0; bi < bumperElements.length; bi++) {
    const el = bumperElements[bi];
    const c = world.circles[el.index];
    if (!c) continue;
    const flash = rs.bumperFlash[bi] || 0;
    const cx = c.x * sx, cy = c.y * sy, r = c.radius * sx;

    // Outer glow
    if (flash > 0) {
      const glowR = r + (flash / 0.15) * 12 * sx;
      ctx.fillStyle = `rgba(255,255,255,${flash / 0.15 * 0.3})`;
      ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, Math.PI * 2); ctx.fill();
    }

    // 3 concentric rings
    ctx.fillStyle = flash > 0 ? '#ffffff' : '#ff2266';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = flash > 0 ? '#ffccdd' : '#cc1144';
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = flash > 0 ? '#ffffff' : '#ff4488';
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.35, 0, Math.PI * 2); ctx.fill();

    // Ring outline
    ctx.strokeStyle = '#ff88aa';
    ctx.lineWidth = 1.5 * sx;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }

  // ── Rollover lanes ────────────────────────────────────────────
  const rolloverElements = elements.filter(e => e.type === 'rollover');
  for (const el of rolloverElements) {
    const c = world.circles[el.index];
    if (!c) continue;
    const cx = c.x * sx, cy = c.y * sy, r = c.radius * sx;
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.005);
    ctx.fillStyle = `rgba(34,255,102,${0.4 + pulse * 0.4})`;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#22ff66';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }

  // ── Spinner ───────────────────────────────────────────────────
  const spinnerEl = elements.find(e => e.type === 'spinner');
  if (spinnerEl) {
    const c = world.circles[spinnerEl.index];
    if (c) {
      const cx = c.x * sx, cy = c.y * sy;
      const lineLen = 10 * sx;
      const a = rs.spinnerAngle;
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2 * sx;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * lineLen, cy + Math.sin(a) * lineLen);
      ctx.lineTo(cx - Math.cos(a) * lineLen, cy - Math.sin(a) * lineLen);
      ctx.stroke();
      ctx.fillStyle = '#ffee88';
      ctx.beginPath(); ctx.arc(cx, cy, 3 * sx, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ── Flippers ──────────────────────────────────────────────────
  for (const f of world.flippers) {
    const tipX = f.pivotX + Math.cos(f.angle) * f.length;
    const tipY = f.pivotY + Math.sin(f.angle) * f.length;
    // Glow when pressed
    if (f.isPressed) {
      ctx.strokeStyle = 'rgba(100,150,255,0.4)';
      ctx.lineWidth = 10 * sx;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(f.pivotX * sx, f.pivotY * sy);
      ctx.lineTo(tipX * sx, tipY * sy);
      ctx.stroke();
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6 * sx;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(f.pivotX * sx, f.pivotY * sy);
    ctx.lineTo(tipX * sx, tipY * sy);
    ctx.stroke();
    // Pivot
    ctx.fillStyle = '#aaccff';
    ctx.beginPath();
    ctx.arc(f.pivotX * sx, f.pivotY * sy, 4 * sx, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Plunger ───────────────────────────────────────────────────
  const pl = world.plunger;
  const plW = 14 * sx;
  const plX = pl.x * sx - plW / 2;
  const plTop = pl.yTop * sy;
  const plBot = pl.yBottom * sy;
  // Track
  ctx.fillStyle = '#1a1a3a';
  ctx.fillRect(plX - 2, plTop, plW + 4, plBot - plTop);
  // Handle
  const handleY = pl.y * sy;
  const powerFrac = pl.power;
  const r = Math.floor(200 + powerFrac * 55);
  const g = Math.floor(80 - powerFrac * 60);
  ctx.fillStyle = `rgb(${r},${g},0)`;
  ctx.fillRect(plX, handleY, plW, plBot - handleY);
  ctx.strokeStyle = '#ffaa44';
  ctx.lineWidth = 1;
  ctx.strokeRect(plX, handleY, plW, plBot - handleY);

  // ── Ball trail ────────────────────────────────────────────────
  for (let i = 0; i < rs.ballTrail.length; i++) {
    const t = rs.ballTrail[i];
    const alpha = (i + 1) / (rs.ballTrail.length + 1) * 0.3;
    ctx.fillStyle = `rgba(200,200,200,${alpha})`;
    ctx.beginPath();
    ctx.arc(t.x * sx, t.y * sy, ball.radius * sx * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Ball ──────────────────────────────────────────────────────
  if (ball.active) {
    const bx = ball.x * sx, by = ball.y * sy, br = ball.radius * sx;
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(bx + 2 * sx, by + 2 * sy, br, br * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Ball body
    const grad = ctx.createRadialGradient(bx - br * 0.3, by - br * 0.3, br * 0.1, bx, by, br);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, '#cccccc');
    grad.addColorStop(1, '#888888');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
    // Specular highlight
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.arc(bx - br * 0.25, by - br * 0.25, br * 0.3, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();

  // ── Score popups (not affected by tilt offset) ────────────────
  for (const popup of rs.scorePopups) {
    const alpha = popup.life / popup.maxLife;
    ctx.fillStyle = `rgba(255,255,100,${alpha})`;
    ctx.font = `bold ${Math.round(12 * sx)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(popup.text, popup.x * sx, popup.y * sy);
  }

  // ── HUD ───────────────────────────────────────────────────────
  const fontSize = Math.round(13 * sx);
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#88aaff';
  ctx.fillText('SCORE', 6 * sx, 18 * sy);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(score).padStart(8, '0'), 6 * sx, 32 * sy);

  // High score
  ctx.fillStyle = '#667799';
  ctx.font = `${Math.round(9 * sx)}px monospace`;
  ctx.fillText(`HI: ${String(highScore).padStart(8, '0')}`, 6 * sx, 44 * sy);

  // Multiplier
  if (multiplier > 1) {
    ctx.fillStyle = '#ffcc00';
    ctx.font = `bold ${Math.round(11 * sx)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`${multiplier}X`, canvas.width / 2, 20 * sy);
  }

  // Ball icons
  ctx.textAlign = 'right';
  for (let i = 0; i < ballsLeft; i++) {
    ctx.fillStyle = '#cccccc';
    ctx.beginPath();
    ctx.arc(canvas.width - (8 + i * 16) * sx, 14 * sy, 5 * sx, 0, Math.PI * 2);
    ctx.fill();
  }

  // Drop target status
  const dtElements = elements.filter(e => e.type === 'drop_target');
  ctx.textAlign = 'center';
  for (let i = 0; i < dtElements.length; i++) {
    const bx = (TABLE_WIDTH / 2 - 20 + i * 20) * sx;
    const by = (TABLE_HEIGHT - 12) * sy;
    ctx.fillStyle = dtElements[i].active ? '#ffff00' : '#333';
    ctx.fillRect(bx - 6 * sx, by - 4 * sy, 12 * sx, 8 * sy);
  }

  // ── Tilt message ──────────────────────────────────────────────
  if (tilt.isTilted) {
    ctx.fillStyle = '#ff0000';
    ctx.font = `bold ${Math.round(28 * sx)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('TILT', canvas.width / 2, canvas.height / 2);
  }

  // ── Game over ─────────────────────────────────────────────────
  if (gameOver) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, canvas.height * 0.35, canvas.width, canvas.height * 0.3);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(24 * sx)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 10 * sy);
    ctx.font = `${Math.round(14 * sx)}px monospace`;
    ctx.fillText(`FINAL SCORE: ${score}`, canvas.width / 2, canvas.height / 2 + 15 * sy);
    ctx.font = `${Math.round(11 * sx)}px monospace`;
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText('SPACE to restart', canvas.width / 2, canvas.height / 2 + 35 * sy);
  }
}
