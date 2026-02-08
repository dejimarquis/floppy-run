import { PhysicsWorld } from './physics';
import { TableElement } from './table';

// Precomputed star field (generated once, reused every frame)
const STARS: { x: number; y: number; b: number }[] = [];
for (let i = 0; i < 30; i++) {
  STARS.push({
    x: Math.random(),
    y: Math.random(),
    b: 0.3 + Math.random() * 0.7,
  });
}

export function drawTableBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sx: number,
  sy: number,
): void {
  ctx.save();

  // Deep navy base
  ctx.fillStyle = '#0a0020';
  ctx.fillRect(0, 0, w, h);

  // Star field
  for (const s of STARS) {
    const a = s.b * 0.8;
    ctx.fillStyle = `rgba(200,200,255,${a})`;
    ctx.fillRect(Math.floor(s.x * w), Math.floor(s.y * h), 1, 1);
  }

  // Grid lines every 40 table-units
  ctx.strokeStyle = 'rgba(40,30,80,0.2)';
  ctx.lineWidth = 0.5;
  for (let gx = 0; gx < w; gx += 40 * sx) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, h);
    ctx.stroke();
  }
  for (let gy = 0; gy < h; gy += 40 * sy) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }

  // Edge glow
  const edgeW = 40 * sx;
  // Left
  const gl = ctx.createLinearGradient(0, 0, edgeW, 0);
  gl.addColorStop(0, 'rgba(30,20,100,0.5)');
  gl.addColorStop(1, 'transparent');
  ctx.fillStyle = gl;
  ctx.fillRect(0, 0, edgeW, h);
  // Right
  const gr = ctx.createLinearGradient(w, 0, w - edgeW, 0);
  gr.addColorStop(0, 'rgba(30,20,100,0.5)');
  gr.addColorStop(1, 'transparent');
  ctx.fillStyle = gr;
  ctx.fillRect(w - edgeW, 0, edgeW, h);
  // Top
  const gt = ctx.createLinearGradient(0, 0, 0, edgeW);
  gt.addColorStop(0, 'rgba(60,20,120,0.4)');
  gt.addColorStop(1, 'transparent');
  ctx.fillStyle = gt;
  ctx.fillRect(0, 0, w, edgeW);

  // Title text
  ctx.font = `bold ${Math.round(10 * sx)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(120,130,160,0.35)';
  ctx.fillText('SPACE PINBALL', w / 2, 55 * sy);

  ctx.restore();
}

export function drawBumper(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  flash: number,
  sx: number,
  sy: number,
): void {
  ctx.save();
  const cx = x * sx;
  const cy = y * sy;
  const r = radius * sx;
  const f = flash > 0 ? Math.min(flash / 0.15, 1) : 0;

  // Expanding glow ring when flashing
  if (f > 0) {
    const glowR = r + f * 15 * sx;
    ctx.fillStyle = `rgba(255,255,255,${f * 0.3})`;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Outer ring fill
  const outerGrad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
  outerGrad.addColorStop(0, f > 0 ? '#ffffff' : '#ff4488');
  outerGrad.addColorStop(1, f > 0 ? '#ffccdd' : '#880022');
  ctx.fillStyle = outerGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Outer ring stroke
  ctx.strokeStyle = f > 0 ? '#ffffff' : '#ff2266';
  ctx.lineWidth = 3 * sx;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Middle ring
  ctx.fillStyle = f > 0 ? '#ffccdd' : '#cc1144';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.65, 0, Math.PI * 2);
  ctx.fill();

  // Inner dot
  ctx.fillStyle = f > 0 ? '#ffffff' : '#ff4488';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Cross-hair detail
  ctx.strokeStyle = f > 0 ? 'rgba(255,255,255,0.7)' : 'rgba(255,100,150,0.5)';
  ctx.lineWidth = 1 * sx;
  const ch = r * 0.45;
  ctx.beginPath();
  ctx.moveTo(cx - ch, cy);
  ctx.lineTo(cx + ch, cy);
  ctx.moveTo(cx, cy - ch);
  ctx.lineTo(cx, cy + ch);
  ctx.stroke();

  ctx.restore();
}

export function drawSlingshot(
  ctx: CanvasRenderingContext2D,
  lines: { x1: number; y1: number; x2: number; y2: number }[],
  flash: number,
  sx: number,
  sy: number,
): void {
  ctx.save();
  if (lines.length === 0) { ctx.restore(); return; }
  const f = flash > 0 ? Math.min(flash / 0.12, 1) : 0;

  // Build path
  ctx.beginPath();
  ctx.moveTo(lines[0].x1 * sx, lines[0].y1 * sy);
  for (const l of lines) {
    ctx.lineTo(l.x2 * sx, l.y2 * sy);
  }
  ctx.closePath();

  // Fill
  ctx.fillStyle = f > 0 ? `rgba(255,255,80,${0.5 + f * 0.5})` : 'rgba(204,68,0,0.6)';
  ctx.fill();

  // Edge stroke
  ctx.strokeStyle = f > 0 ? '#ffffff' : '#ff6600';
  ctx.lineWidth = 2.5 * sx;
  ctx.stroke();

  // Lightning bolt icon inside
  let mcx = 0, mcy = 0;
  for (const l of lines) { mcx += l.x1; mcy += l.y1; }
  mcx = (mcx / lines.length) * sx;
  mcy = (mcy / lines.length) * sy;
  const s = 5 * sx;
  ctx.strokeStyle = f > 0 ? '#ffffff' : '#ffaa44';
  ctx.lineWidth = 1.5 * sx;
  ctx.beginPath();
  ctx.moveTo(mcx - s * 0.2, mcy - s);
  ctx.lineTo(mcx + s * 0.3, mcy - s * 0.1);
  ctx.lineTo(mcx - s * 0.1, mcy + s * 0.1);
  ctx.lineTo(mcx + s * 0.4, mcy + s);
  ctx.stroke();

  ctx.restore();
}

export function drawRamp(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  sx: number,
  sy: number,
): void {
  ctx.save();
  const px1 = x1 * sx, py1 = y1 * sy;
  const px2 = x2 * sx, py2 = y2 * sy;

  // Glow behind
  ctx.strokeStyle = 'rgba(0,204,255,0.15)';
  ctx.lineWidth = 8 * sx;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px1, py1);
  ctx.lineTo(px2, py2);
  ctx.stroke();

  // Main gradient line
  const grad = ctx.createLinearGradient(px1, py1, px2, py2);
  grad.addColorStop(0, '#008899');
  grad.addColorStop(1, '#00ccff');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 3 * sx;
  ctx.beginPath();
  ctx.moveTo(px1, py1);
  ctx.lineTo(px2, py2);
  ctx.stroke();

  // Dashed center lane
  ctx.setLineDash([4 * sx, 4 * sx]);
  ctx.strokeStyle = 'rgba(0,204,255,0.4)';
  ctx.lineWidth = 1 * sx;
  ctx.beginPath();
  ctx.moveTo(px1, py1);
  ctx.lineTo(px2, py2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrow markers pointing upward along the ramp
  const dx = px2 - px1, dy = py2 - py1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len > 0) {
    const nx = dx / len, ny = dy / len;
    const perpX = -ny, perpY = nx;
    const arrowSize = 3 * sx;
    for (let t = 0.3; t <= 0.7; t += 0.4) {
      const ax = px1 + dx * t;
      const ay = py1 + dy * t;
      ctx.fillStyle = 'rgba(0,204,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(ax + nx * arrowSize, ay + ny * arrowSize);
      ctx.lineTo(ax - nx * arrowSize + perpX * arrowSize, ay - ny * arrowSize + perpY * arrowSize);
      ctx.lineTo(ax - nx * arrowSize - perpX * arrowSize, ay - ny * arrowSize - perpY * arrowSize);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.restore();
}

export function drawDropTarget(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  active: boolean,
  sx: number,
  sy: number,
): void {
  ctx.save();
  const cx = x * sx, cy = y * sy;
  const hw = 12 * sx, hh = 5 * sy;

  if (active) {
    // Pulsing glow
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.006);
    ctx.fillStyle = `rgba(255,255,0,${0.15 + pulse * 0.1})`;
    ctx.fillRect(cx - hw - 3 * sx, cy - hh - 3 * sy, (hw + 3 * sx) * 2, (hh + 3 * sy) * 2);

    // Beveled rectangle — lighter top, darker bottom
    ctx.fillStyle = '#ccaa00';
    ctx.fillRect(cx - hw, cy - hh, hw * 2, hh * 2);
    ctx.fillStyle = '#ffee44';
    ctx.fillRect(cx - hw, cy - hh, hw * 2, hh);
    ctx.fillStyle = '#aa8800';
    ctx.fillRect(cx - hw, cy, hw * 2, hh);

    // Border
    ctx.strokeStyle = '#ffff88';
    ctx.lineWidth = 1 * sx;
    ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);

    // "!" icon
    ctx.fillStyle = '#442200';
    ctx.font = `bold ${Math.round(8 * sx)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', cx, cy);
  } else {
    // Inactive — dark flat rectangle
    ctx.fillStyle = '#222222';
    ctx.fillRect(cx - hw, cy - hh, hw * 2, hh * 2);
    ctx.strokeStyle = '#444444';
    ctx.lineWidth = 1 * sx;
    ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
  }

  ctx.restore();
}

export function drawRolloverLane(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  lit: boolean,
  pulse: number,
  sx: number,
  sy: number,
): void {
  ctx.save();
  const cx = x * sx, cy = y * sy;
  const r = 6 * sx;

  if (lit) {
    // Pulsing glow ring
    const glowR = r * (1.5 + pulse * 0.5);
    ctx.fillStyle = `rgba(34,255,102,${0.15 + pulse * 0.15})`;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();

    // Bright green circle
    ctx.fillStyle = '#22ff66';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#88ffaa';
    ctx.lineWidth = 1.5 * sx;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Dim gray
    ctx.fillStyle = '#333333';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#555555';
    ctx.lineWidth = 1 * sx;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Arrow above pointing down
  const ay = cy - r - 5 * sy;
  const as = 3 * sx;
  ctx.fillStyle = lit ? '#22ff66' : '#555555';
  ctx.beginPath();
  ctx.moveTo(cx, ay + as);
  ctx.lineTo(cx - as, ay - as);
  ctx.lineTo(cx + as, ay - as);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

export function drawSpinner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  sx: number,
  sy: number,
): void {
  ctx.save();
  const cx = x * sx, cy = y * sy;
  const armLen = 10 * sx;

  // Speed lines (small arcs offset from the spinner)
  ctx.strokeStyle = 'rgba(255,204,0,0.25)';
  ctx.lineWidth = 1 * sx;
  for (let i = 0; i < 3; i++) {
    const a = angle + Math.PI * 0.5 + i * 0.4;
    ctx.beginPath();
    ctx.arc(cx, cy, armLen + 4 * sx, a, a + 0.3);
    ctx.stroke();
  }

  // Rotating arms
  ctx.strokeStyle = '#ffcc00';
  ctx.lineWidth = 2 * sx;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(angle) * armLen, cy + Math.sin(angle) * armLen);
  ctx.lineTo(cx - Math.cos(angle) * armLen, cy - Math.sin(angle) * armLen);
  ctx.stroke();

  // Central hub
  ctx.fillStyle = '#ffee88';
  ctx.beginPath();
  ctx.arc(cx, cy, 3 * sx, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ccaa00';
  ctx.lineWidth = 1 * sx;
  ctx.beginPath();
  ctx.arc(cx, cy, 3 * sx, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

export function drawFlipper(
  ctx: CanvasRenderingContext2D,
  pivotX: number,
  pivotY: number,
  tipX: number,
  tipY: number,
  pressed: boolean,
  sx: number,
  sy: number,
): void {
  ctx.save();
  const px = pivotX * sx, py = pivotY * sy;
  const tx = tipX * sx, ty = tipY * sy;

  // Blue glow when pressed
  if (pressed) {
    ctx.strokeStyle = 'rgba(68,102,255,0.4)';
    ctx.lineWidth = 14 * sx;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }

  // Tapered body: thicker at pivot, thinner at tip
  // Draw as two overlapping strokes
  ctx.strokeStyle = '#ddddee';
  ctx.lineCap = 'round';
  ctx.lineWidth = 8 * sx;
  ctx.beginPath();
  ctx.moveTo(px, py);
  const midX = (px + tx) / 2, midY = (py + ty) / 2;
  ctx.lineTo(midX, midY);
  ctx.stroke();

  ctx.lineWidth = 5 * sx;
  ctx.beginPath();
  ctx.moveTo(midX, midY);
  ctx.lineTo(tx, ty);
  ctx.stroke();

  // Pivot metallic ring
  ctx.strokeStyle = '#8899cc';
  ctx.lineWidth = 2 * sx;
  ctx.beginPath();
  ctx.arc(px, py, 5 * sx, 0, Math.PI * 2);
  ctx.stroke();

  // Pivot bright dot
  ctx.fillStyle = '#aaccff';
  ctx.beginPath();
  ctx.arc(px, py, 3 * sx, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function drawPlunger(
  ctx: CanvasRenderingContext2D,
  x: number,
  yTop: number,
  yBot: number,
  currentY: number,
  power: number,
  sx: number,
  sy: number,
): void {
  ctx.save();
  const plW = 14 * sx;
  const plX = x * sx - plW / 2;
  const pTop = yTop * sy;
  const pBot = yBot * sy;
  const handleY = currentY * sy;

  // Track
  ctx.fillStyle = '#1a1a3a';
  ctx.fillRect(plX - 2 * sx, pTop, plW + 4 * sx, pBot - pTop);
  ctx.strokeStyle = '#334466';
  ctx.lineWidth = 1 * sx;
  ctx.strokeRect(plX - 2 * sx, pTop, plW + 4 * sx, pBot - pTop);

  // Spring coils (zigzag between top of handle and yTop area)
  const springTop = pTop + 10 * sy;
  const springBot = handleY;
  if (springBot > springTop + 4 * sy) {
    const coils = 5;
    const coilH = (springBot - springTop) / coils;
    ctx.strokeStyle = 'rgba(150,150,180,0.6)';
    ctx.lineWidth = 1.5 * sx;
    ctx.beginPath();
    ctx.moveTo(plX + 2 * sx, springTop);
    for (let i = 0; i < coils; i++) {
      const cy1 = springTop + i * coilH + coilH * 0.5;
      const xOff = i % 2 === 0 ? plW - 2 * sx : 2 * sx;
      ctx.lineTo(plX + xOff, cy1);
    }
    ctx.lineTo(plX + plW / 2, springBot);
    ctx.stroke();
  }

  // Handle with gradient based on power
  const hGrad = ctx.createLinearGradient(plX, handleY, plX, pBot);
  const r = Math.floor(140 + power * 115);
  const g = Math.floor(60 - power * 40);
  hGrad.addColorStop(0, `rgb(${r},${g},0)`);
  hGrad.addColorStop(1, `rgb(${Math.min(255, r + 40)},${Math.floor(g * 0.5)},0)`);
  ctx.fillStyle = hGrad;
  ctx.fillRect(plX, handleY, plW, pBot - handleY);
  ctx.strokeStyle = '#ffaa44';
  ctx.lineWidth = 1 * sx;
  ctx.strokeRect(plX, handleY, plW, pBot - handleY);

  // Power LED dots (5 dots along the right side)
  const ledCount = 5;
  const ledSpacing = (pBot - pTop - 20 * sy) / (ledCount - 1);
  for (let i = 0; i < ledCount; i++) {
    const ledY = pBot - 10 * sy - i * ledSpacing;
    const ledX = plX + plW + 4 * sx;
    const litThreshold = (i + 1) / ledCount;
    const isLit = power >= litThreshold;
    ctx.fillStyle = isLit ? '#00ff44' : '#1a2a1a';
    ctx.beginPath();
    ctx.arc(ledX, ledY, 2 * sx, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function drawBall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  sx: number,
  sy: number,
): void {
  ctx.save();
  const bx = x * sx, by = y * sy, br = radius * sx;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(bx + 2 * sx, by + 2 * sy, br, br * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ball body with radial gradient
  const grad = ctx.createRadialGradient(
    bx - br * 0.3, by - br * 0.3, br * 0.1,
    bx, by, br,
  );
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.5, '#cccccc');
  grad.addColorStop(1, '#666666');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fill();

  // Specular highlight
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(bx - br * 0.25, by - br * 0.25, br * 0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function drawWall(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  sx: number,
  sy: number,
): void {
  ctx.save();
  const px1 = x1 * sx, py1 = y1 * sy;
  const px2 = x2 * sx, py2 = y2 * sy;

  // Wider dark blue underneath
  ctx.strokeStyle = '#223366';
  ctx.lineWidth = 4 * sx;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px1, py1);
  ctx.lineTo(px2, py2);
  ctx.stroke();

  // Thinner bright silver/blue on top
  ctx.strokeStyle = '#8899dd';
  ctx.lineWidth = 1.5 * sx;
  ctx.beginPath();
  ctx.moveTo(px1, py1);
  ctx.lineTo(px2, py2);
  ctx.stroke();

  ctx.restore();
}

export function drawTableDecorations(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
): void {
  ctx.save();

  // Mission display area at top-center
  const mw = 100 * sx, mh = 16 * sy;
  const mx = 200 * sx - mw / 2, my = 25 * sy;
  ctx.strokeStyle = 'rgba(100,120,180,0.4)';
  ctx.lineWidth = 1 * sx;
  ctx.strokeRect(mx, my, mw, mh);
  ctx.fillStyle = 'rgba(10,0,40,0.5)';
  ctx.fillRect(mx, my, mw, mh);

  // "SCORE ZONE" labels near bumper area
  ctx.font = `${Math.round(5 * sx)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,100,150,0.3)';
  ctx.fillText('SCORE ZONE', 190 * sx, 290 * sy);

  // Flipper zone boundary (dashed line)
  ctx.setLineDash([4 * sx, 6 * sx]);
  ctx.strokeStyle = 'rgba(100,100,200,0.2)';
  ctx.lineWidth = 1 * sx;
  ctx.beginPath();
  ctx.moveTo(50 * sx, 610 * sy);
  ctx.lineTo(340 * sx, 610 * sy);
  ctx.stroke();
  ctx.setLineDash([]);

  // LED dots along the side walls (every 20 table-units)
  ctx.fillStyle = 'rgba(60,60,150,0.4)';
  for (let wy = 60; wy < 580; wy += 20) {
    // Left wall LEDs
    ctx.beginPath();
    ctx.arc(33 * sx, wy * sy, 1.5 * sx, 0, Math.PI * 2);
    ctx.fill();
    // Right wall LEDs
    ctx.beginPath();
    ctx.arc(367 * sx, wy * sy, 1.5 * sx, 0, Math.PI * 2);
    ctx.fill();
  }

  // Star decorations in empty spaces
  const starDeco = [
    { x: 80, y: 150 }, { x: 310, y: 350 }, { x: 70, y: 450 },
    { x: 320, y: 480 }, { x: 250, y: 400 },
  ];
  ctx.strokeStyle = 'rgba(100,100,200,0.2)';
  ctx.lineWidth = 1 * sx;
  for (const sd of starDeco) {
    const scx = sd.x * sx, scy = sd.y * sy;
    const arm = 3 * sx;
    ctx.beginPath();
    ctx.moveTo(scx - arm, scy);
    ctx.lineTo(scx + arm, scy);
    ctx.moveTo(scx, scy - arm);
    ctx.lineTo(scx, scy + arm);
    ctx.stroke();
  }

  ctx.restore();
}
