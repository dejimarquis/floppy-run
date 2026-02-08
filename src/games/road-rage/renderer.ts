// Pseudo-3D road renderer — dramatic OutRun/Road Rash-style rendering

import {
  type RoadSegment,
  type Camera,
  SEGMENT_LENGTH,
  DRAW_DISTANCE,
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  LANES,
  getTrackPalette,
  getTrackId,
} from './road';
import { drawScenerySprite } from './objects';

// ---------------------------------------------------------------------------
// Trapezoid primitive
// ---------------------------------------------------------------------------

function drawTrap(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, w1: number,
  x2: number, y2: number, w2: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1 - w1, y1);
  ctx.lineTo(x1 + w1, y1);
  ctx.lineTo(x2 + w2, y2);
  ctx.lineTo(x2 - w2, y2);
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Sky — gradient + parallax mountains + clouds
// ---------------------------------------------------------------------------

function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, cameraZ: number): void {
  const palette = getTrackPalette();
  const horizon = Math.round(h * 0.48);

  // Sky gradient
  const grad = ctx.createLinearGradient(0, 0, 0, horizon);
  grad.addColorStop(0, palette.sky.top);
  grad.addColorStop(1, palette.sky.bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, horizon);

  // Ground base
  ctx.fillStyle = palette.grass.dark;
  ctx.fillRect(0, horizon, w, h - horizon);

  // Parallax mountains
  drawMountains(ctx, w, horizon, cameraZ);

  // Clouds
  drawClouds(ctx, w, horizon, cameraZ);
}

function drawMountains(
  ctx: CanvasRenderingContext2D, w: number, horizon: number, cameraZ: number,
): void {
  const tid = getTrackId();
  const palette = getTrackPalette();
  const parallax = (cameraZ * 0.002) % w;

  // Pick mountain color based on track
  let mtnColor: string;
  let mtnColor2: string;
  switch (tid) {
    case 0: mtnColor = '#8b4513'; mtnColor2 = '#a0522d'; break; // desert mesa
    case 1: mtnColor = '#2d5a3d'; mtnColor2 = '#3a7a55'; break; // coastal hills
    case 2: mtnColor = '#444455'; mtnColor2 = '#555566'; break; // city skyline
    case 3: mtnColor = '#1a3a2a'; mtnColor2 = '#2a4a3a'; break; // mountain ridges
    default: mtnColor = '#333'; mtnColor2 = '#444';
  }

  // Background layer (farther, slower)
  ctx.fillStyle = mtnColor;
  const bgShift = parallax * 0.3;
  for (let p = -1; p <= 2; p++) {
    const baseX = p * w - bgShift;
    ctx.beginPath();
    ctx.moveTo(baseX, horizon);
    for (let x = 0; x <= w; x += 40) {
      const seed = Math.sin((x + p * w) * 0.008) * 30 + Math.sin((x + p * w) * 0.02) * 15;
      ctx.lineTo(baseX + x, horizon - 40 - Math.max(0, seed));
    }
    ctx.lineTo(baseX + w, horizon);
    ctx.closePath();
    ctx.fill();
  }

  // Foreground layer (closer, slightly faster)
  ctx.fillStyle = mtnColor2;
  const fgShift = parallax * 0.6;
  for (let p = -1; p <= 2; p++) {
    const baseX = p * w - fgShift;
    ctx.beginPath();
    ctx.moveTo(baseX, horizon);
    for (let x = 0; x <= w; x += 30) {
      const seed = Math.sin((x + p * w) * 0.012 + 2) * 20 + Math.sin((x + p * w) * 0.03) * 10;
      ctx.lineTo(baseX + x, horizon - 15 - Math.max(0, seed));
    }
    ctx.lineTo(baseX + w, horizon);
    ctx.closePath();
    ctx.fill();
  }
}

function drawClouds(
  ctx: CanvasRenderingContext2D, w: number, horizon: number, cameraZ: number,
): void {
  const shift = (cameraZ * 0.0008) % w;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  // A few simple elliptical clouds
  const clouds = [
    { x: 120, y: horizon * 0.25, rx: 60, ry: 12 },
    { x: 380, y: horizon * 0.18, rx: 80, ry: 14 },
    { x: 600, y: horizon * 0.30, rx: 50, ry: 10 },
    { x: 200, y: horizon * 0.15, rx: 70, ry: 11 },
    { x: 700, y: horizon * 0.22, rx: 55, ry: 13 },
  ];
  for (const c of clouds) {
    const cx = ((c.x - shift) % (w + 200)) + 100;
    ctx.beginPath();
    ctx.ellipse(cx, c.y, c.rx, c.ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Sprite drawing — procedural pixel art
// ---------------------------------------------------------------------------

function drawSprite(
  ctx: CanvasRenderingContext2D,
  source: string,
  x: number,
  y: number,
  scale: number,
  side: number,
): void {
  const s = scale;
  if (s < 0.003) return;

  ctx.save();
  switch (source) {
    case 'pine_tree': drawPineTree(ctx, x, y, s, false); break;
    case 'pine_tree_snow': drawPineTree(ctx, x, y, s, true); break;
    case 'palm_tree': drawPalmTree(ctx, x, y, s, side); break;
    case 'cactus_tall': drawCactusTall(ctx, x, y, s); break;
    case 'cactus_short': drawCactusShort(ctx, x, y, s); break;
    case 'guard_rail': drawGuardRail(ctx, x, y, s); break;
    case 'boulder': drawBoulder(ctx, x, y, s); break;
    case 'building_tall': drawBuildingTall(ctx, x, y, s); break;
    case 'sign_speed': drawSignSpeed(ctx, x, y, s); break;
    case 'sign_curve': drawSignCurve(ctx, x, y, s); break;
    case 'mesa': drawMesa(ctx, x, y, s); break;
    case 'desert_bush': drawDesertBush(ctx, x, y, s); break;
    case 'beach_sign': drawBeachSign(ctx, x, y, s); break;
    case 'lighthouse': drawLighthouse(ctx, x, y, s); break;
    case 'bus_stop': drawBusStop(ctx, x, y, s); break;
    case 'billboard': drawBillboard(ctx, x, y, s); break;
    case 'snow_peak': drawSnowPeak(ctx, x, y, s); break;
    case 'log_cabin': drawLogCabin(ctx, x, y, s); break;
    case 'rocky_outcrop': drawRockyOutcrop(ctx, x, y, s); break;
    default:
      // Delegate existing types to objects.ts
      drawScenerySprite(ctx, source, x, y, s, side);
      break;
  }
  ctx.restore();
}

function drawPineTree(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, snow: boolean): void {
  const tw = 8 * s;
  const th = 45 * s;
  // Trunk
  ctx.fillStyle = '#4a3020';
  ctx.fillRect(Math.round(x - tw * 0.3), Math.round(y - th * 0.3), Math.round(tw * 0.6), Math.round(th * 0.3));
  // Three-tier canopy
  const tiers = [
    { w: 1.4, h: 0.35, yOff: 0.3 },
    { w: 1.8, h: 0.3, yOff: 0.55 },
    { w: 2.4, h: 0.25, yOff: 0.72 },
  ];
  for (const tier of tiers) {
    ctx.fillStyle = snow ? '#1a5c2a' : '#0a4a1a';
    ctx.beginPath();
    ctx.moveTo(Math.round(x), Math.round(y - th));
    ctx.lineTo(Math.round(x - tw * tier.w), Math.round(y - th * tier.yOff));
    ctx.lineTo(Math.round(x + tw * tier.w), Math.round(y - th * tier.yOff));
    ctx.closePath();
    ctx.fill();
  }
  if (snow) {
    // Snow cap
    ctx.fillStyle = '#ddeeff';
    ctx.beginPath();
    ctx.moveTo(Math.round(x), Math.round(y - th));
    ctx.lineTo(Math.round(x - tw * 0.6), Math.round(y - th * 0.85));
    ctx.lineTo(Math.round(x + tw * 0.6), Math.round(y - th * 0.85));
    ctx.closePath();
    ctx.fill();
  }
}

function drawPalmTree(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, side: number): void {
  const tw = 4 * s;
  const th = 48 * s;
  // Curved trunk
  ctx.strokeStyle = '#8b6914';
  ctx.lineWidth = Math.max(1, tw * 0.8);
  ctx.lineCap = 'round';
  ctx.beginPath();
  const lean = side * tw * 2;
  ctx.moveTo(Math.round(x), Math.round(y));
  ctx.quadraticCurveTo(Math.round(x + lean * 0.5), Math.round(y - th * 0.5), Math.round(x + lean), Math.round(y - th));
  ctx.stroke();
  // Fan fronds
  const topX = Math.round(x + lean);
  const topY = Math.round(y - th);
  ctx.fillStyle = '#228833';
  for (let a = -2; a <= 2; a++) {
    const angle = a * 0.5 - 0.1;
    const fx = topX + Math.cos(angle) * tw * 5;
    const fy = topY + Math.sin(angle) * tw * 3;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(topX + (fx - topX) * 0.3, topY - tw * 2, fx, fy);
    ctx.quadraticCurveTo(topX + (fx - topX) * 0.5, topY + tw, topX, topY);
    ctx.fill();
  }
}

function drawCactusTall(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const cw = 5 * s;
  const ch = 35 * s;
  // Main stem
  ctx.fillStyle = '#2d7a2d';
  ctx.fillRect(Math.round(x - cw * 0.5), Math.round(y - ch), Math.round(cw), Math.round(ch));
  // Arms
  ctx.fillStyle = '#2d7a2d';
  // Left arm
  ctx.fillRect(Math.round(x - cw * 2.5), Math.round(y - ch * 0.6), Math.round(cw * 2), Math.round(cw));
  ctx.fillRect(Math.round(x - cw * 2.5), Math.round(y - ch * 0.8), Math.round(cw), Math.round(cw + ch * 0.2));
  // Right arm
  ctx.fillRect(Math.round(x + cw * 0.5), Math.round(y - ch * 0.45), Math.round(cw * 2), Math.round(cw));
  ctx.fillRect(Math.round(x + cw * 1.5), Math.round(y - ch * 0.65), Math.round(cw), Math.round(cw + ch * 0.2));
  // Highlights
  ctx.fillStyle = '#3a9a3a';
  ctx.fillRect(Math.round(x - cw * 0.15), Math.round(y - ch), Math.round(cw * 0.3), Math.round(ch));
}

function drawCactusShort(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const cw = 8 * s;
  const ch = 12 * s;
  // Barrel cactus
  ctx.fillStyle = '#2d7a2d';
  ctx.beginPath();
  ctx.ellipse(Math.round(x), Math.round(y - ch * 0.5), Math.round(cw), Math.round(ch * 0.5), 0, 0, Math.PI * 2);
  ctx.fill();
  // Ridges
  ctx.strokeStyle = '#226622';
  ctx.lineWidth = Math.max(1, s);
  for (let r = -2; r <= 2; r++) {
    ctx.beginPath();
    ctx.moveTo(Math.round(x + r * cw * 0.3), Math.round(y - ch));
    ctx.lineTo(Math.round(x + r * cw * 0.35), Math.round(y));
    ctx.stroke();
  }
}

function drawGuardRail(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const pw = 2 * s;
  const ph = 12 * s;
  // Post
  ctx.fillStyle = '#888888';
  ctx.fillRect(Math.round(x - pw * 0.5), Math.round(y - ph), Math.round(pw), Math.round(ph));
  // Rail
  ctx.fillStyle = '#cccccc';
  ctx.fillRect(Math.round(x - 8 * s), Math.round(y - ph * 0.7), Math.round(16 * s), Math.round(3 * s));
  // Reflector
  ctx.fillStyle = '#ff4400';
  ctx.fillRect(Math.round(x - pw), Math.round(y - ph * 0.85), Math.round(pw * 2), Math.round(2 * s));
}

function drawBoulder(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const rw = 12 * s;
  const rh = 9 * s;
  // Main body
  ctx.fillStyle = '#666666';
  ctx.beginPath();
  ctx.moveTo(Math.round(x - rw * 0.4), Math.round(y));
  ctx.lineTo(Math.round(x - rw * 0.5), Math.round(y - rh * 0.6));
  ctx.lineTo(Math.round(x - rw * 0.2), Math.round(y - rh));
  ctx.lineTo(Math.round(x + rw * 0.3), Math.round(y - rh * 0.9));
  ctx.lineTo(Math.round(x + rw * 0.5), Math.round(y - rh * 0.4));
  ctx.lineTo(Math.round(x + rw * 0.3), Math.round(y));
  ctx.closePath();
  ctx.fill();
  // Highlight
  ctx.fillStyle = '#888888';
  ctx.beginPath();
  ctx.moveTo(Math.round(x - rw * 0.2), Math.round(y - rh));
  ctx.lineTo(Math.round(x + rw * 0.1), Math.round(y - rh * 0.85));
  ctx.lineTo(Math.round(x), Math.round(y - rh * 0.5));
  ctx.lineTo(Math.round(x - rw * 0.3), Math.round(y - rh * 0.6));
  ctx.closePath();
  ctx.fill();
}

function drawBuildingTall(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const bw = 35 * s;
  const bh = 70 * s;
  const seed = Math.sin(x * 7 + y * 3) * 0.5 + 0.5;
  const r = 70 + Math.floor(seed * 50);
  const g = 65 + Math.floor(seed * 40);
  const b = 75 + Math.floor(seed * 45);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(Math.round(x - bw * 0.5), Math.round(y - bh), Math.round(bw), Math.round(bh));
  // Roof
  ctx.fillStyle = `rgb(${r - 20},${g - 20},${b - 20})`;
  ctx.fillRect(Math.round(x - bw * 0.55), Math.round(y - bh), Math.round(bw * 1.1), Math.round(bh * 0.04));
  // Windows grid (3x5)
  ctx.fillStyle = '#334455';
  const winW = bw * 0.12;
  const winH = bh * 0.06;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      // Randomly lit windows
      const lit = Math.sin(row * 13 + col * 7 + seed * 100) > 0;
      ctx.fillStyle = lit ? '#ffdd77' : '#334455';
      const wx = x - bw * 0.3 + col * bw * 0.25;
      const wy = y - bh * 0.9 + row * bh * 0.17;
      ctx.fillRect(Math.round(wx), Math.round(wy), Math.round(winW), Math.round(winH));
    }
  }
}

function drawSignSpeed(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const pw = 3 * s;
  const ph = 28 * s;
  ctx.fillStyle = '#888888';
  ctx.fillRect(Math.round(x - pw * 0.5), Math.round(y - ph), Math.round(pw), Math.round(ph));
  // White circle
  const cr = 9 * s;
  const cy = y - ph - cr * 0.3;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(Math.round(x), Math.round(cy), Math.round(cr), 0, Math.PI * 2);
  ctx.fill();
  // Red ring
  ctx.strokeStyle = '#cc0000';
  ctx.lineWidth = Math.max(1, 2 * s);
  ctx.beginPath();
  ctx.arc(Math.round(x), Math.round(cy), Math.round(cr * 0.85), 0, Math.PI * 2);
  ctx.stroke();
  // Number
  ctx.fillStyle = '#000000';
  const fontSize = Math.max(4, Math.round(8 * s));
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('80', Math.round(x), Math.round(cy));
}

function drawSignCurve(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const pw = 3 * s;
  const ph = 28 * s;
  ctx.fillStyle = '#888888';
  ctx.fillRect(Math.round(x - pw * 0.5), Math.round(y - ph), Math.round(pw), Math.round(ph));
  // Yellow diamond
  const ds = 11 * s;
  const dy = y - ph - ds * 0.3;
  ctx.fillStyle = '#ddcc00';
  ctx.beginPath();
  ctx.moveTo(Math.round(x), Math.round(dy - ds));
  ctx.lineTo(Math.round(x + ds), Math.round(dy));
  ctx.lineTo(Math.round(x), Math.round(dy + ds));
  ctx.lineTo(Math.round(x - ds), Math.round(dy));
  ctx.closePath();
  ctx.fill();
  // Black border
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(1, 1.5 * s);
  ctx.stroke();
  // Arrow
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(1, 2 * s);
  ctx.beginPath();
  ctx.moveTo(Math.round(x - ds * 0.4), Math.round(dy + ds * 0.2));
  ctx.quadraticCurveTo(Math.round(x), Math.round(dy - ds * 0.4), Math.round(x + ds * 0.4), Math.round(dy + ds * 0.2));
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// New track-themed scenery draw functions
// ---------------------------------------------------------------------------

function drawMesa(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const mw = 50 * s;
  const mh = 35 * s;
  // Flat-topped mesa silhouette
  ctx.fillStyle = '#8b3a1a';
  ctx.beginPath();
  ctx.moveTo(Math.round(x - mw * 0.5), Math.round(y));
  ctx.lineTo(Math.round(x - mw * 0.4), Math.round(y - mh));
  ctx.lineTo(Math.round(x + mw * 0.4), Math.round(y - mh));
  ctx.lineTo(Math.round(x + mw * 0.5), Math.round(y));
  ctx.closePath();
  ctx.fill();
  // Layered stripe
  ctx.fillStyle = '#a0522d';
  ctx.fillRect(Math.round(x - mw * 0.38), Math.round(y - mh * 0.6), Math.round(mw * 0.76), Math.round(mh * 0.12));
  // Flat top highlight
  ctx.fillStyle = '#9b4b2a';
  ctx.fillRect(Math.round(x - mw * 0.38), Math.round(y - mh), Math.round(mw * 0.76), Math.round(mh * 0.08));
}

function drawDesertBush(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const bw = 10 * s;
  const bh = 7 * s;
  // Dried tumbleweed-like bush
  ctx.fillStyle = '#8a7a3a';
  ctx.beginPath();
  ctx.ellipse(Math.round(x), Math.round(y - bh * 0.5), Math.round(bw * 0.5), Math.round(bh * 0.5), 0, 0, Math.PI * 2);
  ctx.fill();
  // Darker center
  ctx.fillStyle = '#6a5a2a';
  ctx.beginPath();
  ctx.ellipse(Math.round(x), Math.round(y - bh * 0.5), Math.round(bw * 0.3), Math.round(bh * 0.3), 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBeachSign(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const pw = 3 * s;
  const ph = 24 * s;
  // Wooden post
  ctx.fillStyle = '#8b6914';
  ctx.fillRect(Math.round(x - pw * 0.5), Math.round(y - ph), Math.round(pw), Math.round(ph));
  // Wooden sign board
  const sw = 20 * s;
  const sh = 10 * s;
  ctx.fillStyle = '#c4a24a';
  ctx.fillRect(Math.round(x - sw * 0.5), Math.round(y - ph - sh * 0.2), Math.round(sw), Math.round(sh));
  // Blue wave line
  ctx.strokeStyle = '#2288cc';
  ctx.lineWidth = Math.max(1, 2 * s);
  ctx.beginPath();
  ctx.moveTo(Math.round(x - sw * 0.3), Math.round(y - ph + sh * 0.2));
  ctx.quadraticCurveTo(Math.round(x), Math.round(y - ph - sh * 0.2), Math.round(x + sw * 0.3), Math.round(y - ph + sh * 0.2));
  ctx.stroke();
}

function drawLighthouse(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const tw = 6 * s;
  const th = 55 * s;
  // Tower — tapered
  ctx.fillStyle = '#eeeeee';
  ctx.beginPath();
  ctx.moveTo(Math.round(x - tw * 0.6), Math.round(y));
  ctx.lineTo(Math.round(x - tw * 0.35), Math.round(y - th));
  ctx.lineTo(Math.round(x + tw * 0.35), Math.round(y - th));
  ctx.lineTo(Math.round(x + tw * 0.6), Math.round(y));
  ctx.closePath();
  ctx.fill();
  // Red stripes
  ctx.fillStyle = '#cc2222';
  for (let stripe = 0; stripe < 3; stripe++) {
    const sy = y - th * (0.2 + stripe * 0.25);
    const ratio = 1 - (0.2 + stripe * 0.25) * 0.4;
    ctx.fillRect(Math.round(x - tw * 0.5 * ratio), Math.round(sy), Math.round(tw * ratio), Math.round(th * 0.1));
  }
  // Light dome
  ctx.fillStyle = '#ffee44';
  ctx.fillRect(Math.round(x - tw * 0.4), Math.round(y - th - 4 * s), Math.round(tw * 0.8), Math.round(4 * s));
  // Roof
  ctx.fillStyle = '#333333';
  ctx.beginPath();
  ctx.moveTo(Math.round(x), Math.round(y - th - 8 * s));
  ctx.lineTo(Math.round(x - tw * 0.5), Math.round(y - th - 4 * s));
  ctx.lineTo(Math.round(x + tw * 0.5), Math.round(y - th - 4 * s));
  ctx.closePath();
  ctx.fill();
}

function drawBusStop(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const bw = 18 * s;
  const bh = 24 * s;
  // Shelter posts
  ctx.fillStyle = '#666666';
  ctx.fillRect(Math.round(x - bw * 0.5), Math.round(y - bh), Math.round(2 * s), Math.round(bh));
  ctx.fillRect(Math.round(x + bw * 0.5 - 2 * s), Math.round(y - bh), Math.round(2 * s), Math.round(bh));
  // Roof
  ctx.fillStyle = '#4488aa';
  ctx.fillRect(Math.round(x - bw * 0.55), Math.round(y - bh), Math.round(bw * 1.1), Math.round(3 * s));
  // Back panel
  ctx.fillStyle = '#88bbdd';
  ctx.globalAlpha = 0.5;
  ctx.fillRect(Math.round(x - bw * 0.5), Math.round(y - bh + 3 * s), Math.round(bw), Math.round(bh * 0.6));
  ctx.globalAlpha = 1;
  // Bench
  ctx.fillStyle = '#555555';
  ctx.fillRect(Math.round(x - bw * 0.35), Math.round(y - bh * 0.25), Math.round(bw * 0.7), Math.round(2 * s));
}

function drawBillboard(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const bw = 30 * s;
  const bh = 18 * s;
  const ph = 35 * s;
  // Support poles
  ctx.fillStyle = '#555555';
  ctx.fillRect(Math.round(x - bw * 0.25), Math.round(y - ph), Math.round(3 * s), Math.round(ph));
  ctx.fillRect(Math.round(x + bw * 0.25 - 3 * s), Math.round(y - ph), Math.round(3 * s), Math.round(ph));
  // Board
  const seed = Math.sin(x * 5 + y * 3) * 0.5 + 0.5;
  const bg = seed > 0.5 ? '#2244aa' : '#aa2244';
  ctx.fillStyle = bg;
  ctx.fillRect(Math.round(x - bw * 0.5), Math.round(y - ph - bh * 0.3), Math.round(bw), Math.round(bh));
  // White text bars
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(Math.round(x - bw * 0.35), Math.round(y - ph - bh * 0.1), Math.round(bw * 0.7), Math.round(bh * 0.12));
  ctx.fillRect(Math.round(x - bw * 0.25), Math.round(y - ph + bh * 0.1), Math.round(bw * 0.5), Math.round(bh * 0.08));
  // Border
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = Math.max(1, 1.5 * s);
  ctx.strokeRect(Math.round(x - bw * 0.5), Math.round(y - ph - bh * 0.3), Math.round(bw), Math.round(bh));
}

function drawSnowPeak(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const mw = 45 * s;
  const mh = 50 * s;
  // Mountain body
  ctx.fillStyle = '#2a3a4a';
  ctx.beginPath();
  ctx.moveTo(Math.round(x), Math.round(y - mh));
  ctx.lineTo(Math.round(x - mw * 0.5), Math.round(y));
  ctx.lineTo(Math.round(x + mw * 0.5), Math.round(y));
  ctx.closePath();
  ctx.fill();
  // Ridge highlight
  ctx.fillStyle = '#3a4a5a';
  ctx.beginPath();
  ctx.moveTo(Math.round(x), Math.round(y - mh));
  ctx.lineTo(Math.round(x + mw * 0.1), Math.round(y - mh * 0.6));
  ctx.lineTo(Math.round(x + mw * 0.5), Math.round(y));
  ctx.closePath();
  ctx.fill();
  // Snow cap
  ctx.fillStyle = '#ddeeff';
  ctx.beginPath();
  ctx.moveTo(Math.round(x), Math.round(y - mh));
  ctx.lineTo(Math.round(x - mw * 0.15), Math.round(y - mh * 0.7));
  ctx.lineTo(Math.round(x + mw * 0.15), Math.round(y - mh * 0.7));
  ctx.closePath();
  ctx.fill();
  // Snow drip
  ctx.fillStyle = '#ccddee';
  ctx.beginPath();
  ctx.moveTo(Math.round(x - mw * 0.15), Math.round(y - mh * 0.7));
  ctx.lineTo(Math.round(x - mw * 0.1), Math.round(y - mh * 0.6));
  ctx.lineTo(Math.round(x - mw * 0.05), Math.round(y - mh * 0.65));
  ctx.lineTo(Math.round(x + mw * 0.05), Math.round(y - mh * 0.62));
  ctx.lineTo(Math.round(x + mw * 0.15), Math.round(y - mh * 0.7));
  ctx.closePath();
  ctx.fill();
}

function drawLogCabin(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const cw = 22 * s;
  const ch = 16 * s;
  // Log walls
  ctx.fillStyle = '#6b4226';
  ctx.fillRect(Math.round(x - cw * 0.5), Math.round(y - ch), Math.round(cw), Math.round(ch));
  // Log lines
  ctx.strokeStyle = '#5a3520';
  ctx.lineWidth = Math.max(1, s);
  for (let row = 0; row < 4; row++) {
    const ly = y - ch + ch * (row + 0.5) * 0.25;
    ctx.beginPath();
    ctx.moveTo(Math.round(x - cw * 0.5), Math.round(ly));
    ctx.lineTo(Math.round(x + cw * 0.5), Math.round(ly));
    ctx.stroke();
  }
  // Door
  ctx.fillStyle = '#3a2010';
  ctx.fillRect(Math.round(x - cw * 0.12), Math.round(y - ch * 0.55), Math.round(cw * 0.24), Math.round(ch * 0.55));
  // Window
  ctx.fillStyle = '#88aacc';
  ctx.fillRect(Math.round(x + cw * 0.15), Math.round(y - ch * 0.75), Math.round(cw * 0.18), Math.round(ch * 0.2));
  // Roof
  ctx.fillStyle = '#4a2a10';
  ctx.beginPath();
  ctx.moveTo(Math.round(x), Math.round(y - ch - ch * 0.4));
  ctx.lineTo(Math.round(x - cw * 0.6), Math.round(y - ch));
  ctx.lineTo(Math.round(x + cw * 0.6), Math.round(y - ch));
  ctx.closePath();
  ctx.fill();
  // Chimney
  ctx.fillStyle = '#555555';
  ctx.fillRect(Math.round(x + cw * 0.25), Math.round(y - ch - ch * 0.45), Math.round(3 * s), Math.round(ch * 0.25));
}

function drawRockyOutcrop(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const rw = 14 * s;
  const rh = 18 * s;
  // Jagged rock shape
  ctx.fillStyle = '#5a5a5a';
  ctx.beginPath();
  ctx.moveTo(Math.round(x - rw * 0.4), Math.round(y));
  ctx.lineTo(Math.round(x - rw * 0.5), Math.round(y - rh * 0.5));
  ctx.lineTo(Math.round(x - rw * 0.2), Math.round(y - rh * 0.8));
  ctx.lineTo(Math.round(x + rw * 0.1), Math.round(y - rh));
  ctx.lineTo(Math.round(x + rw * 0.3), Math.round(y - rh * 0.7));
  ctx.lineTo(Math.round(x + rw * 0.5), Math.round(y - rh * 0.4));
  ctx.lineTo(Math.round(x + rw * 0.35), Math.round(y));
  ctx.closePath();
  ctx.fill();
  // Lighter face
  ctx.fillStyle = '#7a7a7a';
  ctx.beginPath();
  ctx.moveTo(Math.round(x + rw * 0.1), Math.round(y - rh));
  ctx.lineTo(Math.round(x + rw * 0.3), Math.round(y - rh * 0.7));
  ctx.lineTo(Math.round(x + rw * 0.2), Math.round(y - rh * 0.3));
  ctx.lineTo(Math.round(x), Math.round(y - rh * 0.5));
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Speed effects
// ---------------------------------------------------------------------------

function drawSpeedLines(
  ctx: CanvasRenderingContext2D, w: number, h: number, ratio: number,
): void {
  if (ratio <= 0.7) return;
  const strength = (ratio - 0.7) / 0.3;
  ctx.lineWidth = 1;
  const count = Math.floor(12 + strength * 12);
  for (let i = 0; i < count; i++) {
    const y = Math.round((h * (i + 0.5)) / count + (Math.sin(i * 37) * 8));
    const len = Math.round(15 + 45 * strength * (0.5 + Math.abs(Math.sin(i * 17)) * 0.5));
    const a = strength * 0.15 * (0.4 + Math.abs(Math.sin(i * 23)) * 0.6);
    ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    // Left edge
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(len, y);
    ctx.stroke();
    // Right edge
    ctx.beginPath();
    ctx.moveTo(w, y);
    ctx.lineTo(w - len, y);
    ctx.stroke();
  }
}

function drawVignette(
  ctx: CanvasRenderingContext2D, w: number, h: number, ratio: number,
): void {
  if (ratio <= 0.9) return;
  const strength = (ratio - 0.9) / 0.1;
  const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.35, w / 2, h / 2, w * 0.7);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(0,0,0,${(strength * 0.35).toFixed(3)})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

export function renderRoad(
  ctx: CanvasRenderingContext2D,
  segments: RoadSegment[],
  camera: Camera,
  playerSpeed?: number,
  maxSpeed?: number,
): void {
  const w = SCREEN_WIDTH;
  const h = SCREEN_HEIGHT;
  const speedRatio = (playerSpeed != null && maxSpeed != null && maxSpeed > 0)
    ? playerSpeed / maxSpeed : 0;

  ctx.imageSmoothingEnabled = false;

  // Dynamic camera height: lower at high speed for drama
  const effectiveCamY = camera.y - speedRatio * 250;

  // 1. Clear + sky
  ctx.clearRect(0, 0, w, h);
  drawSky(ctx, w, h, camera.z);

  const totalZ = segments.length * SEGMENT_LENGTH;
  const cameraZ = camera.z;
  const baseIdx = Math.floor(cameraZ / SEGMENT_LENGTH) % segments.length;
  const halfW = w / 2;
  const halfH = h / 2;

  // FOV widens slightly with speed
  const depthFactor = 1 + speedRatio * 0.08;
  const distToProj = camera.distToProjection * depthFactor;

  // --- Projection pass (near to far) ---
  let curveAccum = 0;
  let maxY = h;

  for (let n = 0; n < DRAW_DISTANCE; n++) {
    const idx = (baseIdx + n) % segments.length;
    const seg = segments[idx];

    let relZ = seg.world.z - cameraZ;
    if (relZ < 0) relZ += totalZ;
    if (relZ <= 0) continue;

    const scale = distToProj / relZ;

    // Smooth curve accumulation with damping
    curveAccum += seg.curve * (1 - n / DRAW_DISTANCE * 0.15);
    const curveOffset = curveAccum;

    seg.screen.x = Math.round(halfW + scale * (seg.world.x + curveOffset * SEGMENT_LENGTH - camera.x) * halfW);
    seg.screen.y = Math.round(halfH - scale * (seg.world.y - effectiveCamY) * halfH);
    seg.screen.w = Math.round(scale * seg.world.w * halfW);

    seg.clip = maxY;
    if (seg.screen.y < maxY) {
      maxY = seg.screen.y;
    }
  }

  // --- Render pass (back to front) ---
  for (let n = DRAW_DISTANCE - 1; n > 0; n--) {
    const idx = (baseIdx + n) % segments.length;
    const prevIdx = (baseIdx + n - 1) % segments.length;
    const seg = segments[idx];
    const prev = segments[prevIdx];

    if (seg.screen.y >= seg.clip && prev.screen.y >= prev.clip) continue;

    const sy1 = prev.screen.y;
    const sx1 = prev.screen.x;
    const sw1 = prev.screen.w;
    const sy2 = seg.screen.y;
    const sx2 = seg.screen.x;
    const sw2 = seg.screen.w;

    // Grass
    drawTrap(ctx, halfW, sy1, w, halfW, sy2, w, seg.color.grass);

    // Rumble strips (visible width)
    const rw1 = sw1 * 1.18;
    const rw2 = sw2 * 1.18;
    drawTrap(ctx, sx1, sy1, rw1, sx2, sy2, rw2, seg.color.rumble);

    // Road surface
    drawTrap(ctx, sx1, sy1, sw1, sx2, sy2, sw2, seg.color.road);

    // Subtle tire tracks (darker strips in lanes)
    if (sw2 > 4) {
      const trackAlpha = 0.06;
      ctx.fillStyle = `rgba(0,0,0,${trackAlpha})`;
      for (let lane = 0; lane < LANES; lane++) {
        const t = (lane + 0.5) / LANES;
        const tx1 = sx1 + sw1 * (2 * t - 1);
        const tx2 = sx2 + sw2 * (2 * t - 1);
        const tw1 = sw1 * 0.06;
        const tw2 = sw2 * 0.06;
        drawTrap(ctx, tx1, sy1, tw1, tx2, sy2, tw2, `rgba(0,0,0,${trackAlpha})`);
      }
    }

    // Edge lines (always visible)
    if (sw2 > 2) {
      const elw1 = sw1 * 0.012;
      const elw2 = sw2 * 0.012;
      ctx.fillStyle = '#ffffff';
      // Left edge
      drawTrap(ctx, sx1 - sw1 + elw1, sy1, elw1, sx2 - sw2 + elw2, sy2, elw2, '#ffffff');
      // Right edge
      drawTrap(ctx, sx1 + sw1 - elw1, sy1, elw1, sx2 + sw2 - elw2, sy2, elw2, '#ffffff');
    }

    // Lane markers (dashed — only on light bands)
    const isLightBand = seg.color.lane !== seg.color.road;
    if (isLightBand && sw2 > 3) {
      const lw1 = sw1 * 0.01;
      const lw2 = sw2 * 0.01;
      for (let lane = 1; lane < LANES; lane++) {
        const t = lane / LANES;
        const lx1 = sx1 + sw1 * (2 * t - 1);
        const lx2 = sx2 + sw2 * (2 * t - 1);
        drawTrap(ctx, lx1, sy1, lw1, lx2, sy2, lw2, seg.color.lane);
      }
    }
  }

  // --- Sprites (back to front) ---
  for (let n = DRAW_DISTANCE - 1; n > 0; n--) {
    const idx = (baseIdx + n) % segments.length;
    const seg = segments[idx];
    if (seg.sprites.length === 0) continue;
    if (seg.screen.y >= seg.clip) continue;

    let relZ = seg.world.z - cameraZ;
    if (relZ < 0) relZ += totalZ;
    if (relZ <= 0) continue;

    const spriteScale = distToProj / relZ * 30;

    for (const sprite of seg.sprites) {
      const spriteX = seg.screen.x + seg.screen.w * sprite.offset;
      const spriteY = seg.screen.y;
      const side = sprite.offset < 0 ? -1 : 1;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, seg.clip);
      ctx.clip();
      drawSprite(ctx, sprite.source, spriteX, spriteY, spriteScale, side);
      ctx.restore();
    }
  }

  // --- Speed effects ---
  drawSpeedLines(ctx, w, h, speedRatio);
  drawVignette(ctx, w, h, speedRatio);
}
