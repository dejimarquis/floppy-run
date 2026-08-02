/**
 * Space Cadet: Nova — procedural playfield artwork.
 *
 * Everything here is drawn on a <canvas> at load time: a screen-printed
 * sci-fi playfield (nebulae, starfield, planets, mission rings, vector
 * lettering, insert lenses, lane art, halftone screen and wear), plus the
 * matching roughness / normal / AO maps so the clearcoat reads in 3D.
 */

import * as THREE from 'three';
import { L } from './layout.js';
import { makeRng } from './rng.js';

const BW = L.boardX1 - L.boardX0;
const BH = L.boardY1 - L.boardY0;

export const ART_ASPECT = BH / BW;

/* ------------------------------------------------------------------ */

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

class Painter {
  constructor(ctx, W, H) {
    this.g = ctx;
    this.W = W;
    this.H = H;
  }
  X(x) {
    return ((x - L.boardX0) / BW) * this.W;
  }
  Y(y) {
    return (1 - (y - L.boardY0) / BH) * this.H;
  }
  S(v) {
    return (v / BW) * this.W;
  }
}

/* ---------------------------- primitives -------------------------- */

function radial(g, x, y, r, stops) {
  const grd = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [t, c] of stops) grd.addColorStop(t, c);
  return grd;
}

function nebula(p, rnd, x, y, r, hue, alpha) {
  const g = p.g;
  g.save();
  g.globalCompositeOperation = 'screen';
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.pow(rnd(), 0.6) * r;
    const rr = r * (0.22 + rnd() * 0.55);
    const cx = x + Math.cos(a) * d;
    const cy = y + Math.sin(a) * d * 0.85;
    const h = hue + (rnd() - 0.5) * 46;
    const s = 62 + rnd() * 30;
    const l = 26 + rnd() * 26;
    g.fillStyle = radial(g, cx, cy, rr, [
      [0, `hsla(${h},${s}%,${l}%,${alpha})`],
      [0.45, `hsla(${h},${s}%,${l * 0.6}%,${alpha * 0.45})`],
      [1, `hsla(${h},${s}%,${l * 0.3}%,0)`],
    ]);
    g.beginPath();
    g.arc(cx, cy, rr, 0, 7);
    g.fill();
  }
  g.restore();
}

function starfield(p, rnd, count, maxR, alpha) {
  const g = p.g;
  g.save();
  g.globalCompositeOperation = 'screen';
  for (let i = 0; i < count; i++) {
    const x = rnd() * p.W;
    const y = rnd() * p.H;
    const r = Math.pow(rnd(), 3) * maxR + 0.4;
    const a = (0.35 + rnd() * 0.65) * alpha;
    const tint = rnd();
    const col = tint > 0.88 ? '190,215,255' : tint > 0.72 ? '255,224,190' : '255,255,255';
    g.fillStyle = radial(g, x, y, r * 3.4, [
      [0, `rgba(${col},${a})`],
      [0.25, `rgba(${col},${a * 0.5})`],
      [1, `rgba(${col},0)`],
    ]);
    g.beginPath();
    g.arc(x, y, r * 3.4, 0, 7);
    g.fill();
    if (r > 1.6) {
      g.strokeStyle = `rgba(${col},${a * 0.7})`;
      g.lineWidth = Math.max(1, r * 0.35);
      g.beginPath();
      g.moveTo(x - r * 4, y);
      g.lineTo(x + r * 4, y);
      g.moveTo(x, y - r * 4);
      g.lineTo(x, y + r * 4);
      g.stroke();
    }
  }
  g.restore();
}

function planet(p, rnd, cx, cy, r, hue, ring) {
  const g = p.g;
  g.save();
  // body
  g.beginPath();
  g.arc(cx, cy, r, 0, 7);
  g.fillStyle = radial(g, cx - r * 0.35, cy - r * 0.4, r * 1.7, [
    [0, `hsl(${hue},58%,64%)`],
    [0.35, `hsl(${hue},54%,40%)`],
    [0.7, `hsl(${hue + 12},52%,20%)`],
    [1, `hsl(${hue + 24},48%,7%)`],
  ]);
  g.fill();
  // banding
  g.save();
  g.clip();
  g.globalAlpha = 0.32;
  for (let i = 0; i < 26; i++) {
    const yy = cy - r + (i / 26) * r * 2;
    const th = r * (0.02 + rnd() * 0.06);
    g.fillStyle = `hsla(${hue + (rnd() - 0.5) * 40},${40 + rnd() * 40}%,${8 + rnd() * 45}%,0.55)`;
    g.beginPath();
    g.ellipse(cx, yy, r * (0.98 + rnd() * 0.06), th, 0, 0, 7);
    g.fill();
  }
  // terminator
  g.globalAlpha = 1;
  g.fillStyle = radial(g, cx - r * 0.5, cy - r * 0.5, r * 2.0, [
    [0, 'rgba(0,0,0,0)'],
    [0.55, 'rgba(0,0,0,0.15)'],
    [1, 'rgba(0,0,6,0.92)'],
  ]);
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
  g.restore();
  // rim light
  g.strokeStyle = `hsla(${hue - 20},95%,80%,0.75)`;
  g.lineWidth = r * 0.035;
  g.beginPath();
  g.arc(cx, cy, r * 0.99, -2.5, 0.5);
  g.stroke();

  if (ring) {
    g.save();
    g.translate(cx, cy);
    g.rotate(-0.35);
    g.scale(1, 0.24);
    for (let i = 0; i < 7; i++) {
      const rr = r * (1.35 + i * 0.13);
      g.strokeStyle = `hsla(${hue + 20 + i * 6},60%,${58 - i * 4}%,${0.5 - i * 0.05})`;
      g.lineWidth = r * (0.06 - i * 0.004);
      g.beginPath();
      g.arc(0, 0, rr, 0, 7);
      g.stroke();
    }
    g.restore();
  }
  g.restore();
}

function ringSet(p, cx, cy, r0, r1, n, color, alpha, dash) {
  const g = p.g;
  g.save();
  g.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    const r = r0 + ((r1 - r0) * i) / Math.max(1, n - 1);
    g.strokeStyle = color;
    g.lineWidth = p.S(0.0016) * (i % 2 ? 1 : 2.2);
    if (dash) g.setLineDash([p.S(0.012), p.S(0.008)]);
    else g.setLineDash([]);
    g.beginPath();
    g.arc(cx, cy, r, 0, 7);
    g.stroke();
  }
  g.setLineDash([]);
  g.restore();
}

function poly(p, pts, close = true) {
  const g = p.g;
  g.beginPath();
  g.moveTo(p.X(pts[0][0]), p.Y(pts[0][1]));
  for (let i = 1; i < pts.length; i++) g.lineTo(p.X(pts[i][0]), p.Y(pts[i][1]));
  if (close) g.closePath();
}

function chevrons(p, x, y, ang, n, w, gap, color, glow) {
  const g = p.g;
  g.save();
  g.translate(p.X(x), p.Y(y));
  g.rotate(-ang);
  const W = p.S(w);
  const G = p.S(gap);
  for (let i = 0; i < n; i++) {
    const a = 1 - i / (n + 1.2);
    g.globalAlpha = a;
    if (glow) {
      g.shadowColor = color;
      g.shadowBlur = p.S(0.006);
    }
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(-W * 0.5, i * G + W * 0.42);
    g.lineTo(0, i * G - W * 0.14);
    g.lineTo(W * 0.5, i * G + W * 0.42);
    g.lineTo(W * 0.5, i * G + W * 0.72);
    g.lineTo(0, i * G + 0.16 * W);
    g.lineTo(-W * 0.5, i * G + W * 0.72);
    g.closePath();
    g.fill();
  }
  g.restore();
}

/** A physical insert lens: bevelled acrylic window set into the wood. */
function insert(p, shape, color) {
  const g = p.g;
  g.save();
  shape(g);
  // dark lens body
  g.fillStyle = `rgba(8,10,16,0.92)`;
  g.fill();
  g.save();
  g.clip();
  const b = g.canvas;
  void b;
  g.fillStyle = color;
  g.globalAlpha = 0.24;
  g.fillRect(0, 0, p.W, p.H);
  g.globalAlpha = 1;
  g.restore();
  // bevel highlight
  g.lineWidth = p.S(0.0022);
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.stroke();
  g.lineWidth = p.S(0.0009);
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.stroke();
  g.restore();
}

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

function arrowPath(g, cx, cy, w, h, ang) {
  g.save();
  g.translate(cx, cy);
  g.rotate(ang);
  g.beginPath();
  g.moveTo(0, -h * 0.5);
  g.lineTo(w * 0.5, 0);
  g.lineTo(w * 0.22, 0);
  g.lineTo(w * 0.22, h * 0.5);
  g.lineTo(-w * 0.22, h * 0.5);
  g.lineTo(-w * 0.22, 0);
  g.lineTo(-w * 0.5, 0);
  g.closePath();
  g.restore();
}

function stencilText(p, txt, x, y, size, opts = {}) {
  const g = p.g;
  g.save();
  g.translate(p.X(x), p.Y(y));
  if (opts.rot) g.rotate(-opts.rot);
  const px = p.S(size);
  g.font = `${opts.weight || 900} ${px}px ${opts.font || '"Arial Black", "Helvetica Neue", Impact, sans-serif'}`;
  g.textAlign = opts.align || 'center';
  g.textBaseline = opts.baseline || 'middle';
  if (opts.letterSpacing) g.letterSpacing = `${p.S(opts.letterSpacing)}px`;
  if (opts.glow) {
    g.shadowColor = opts.glow;
    g.shadowBlur = px * 0.55;
  }
  if (opts.shadow !== false) {
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillText(txt, px * 0.045, px * 0.05);
  }
  g.fillStyle = opts.fill || '#fff';
  g.fillText(txt, 0, 0);
  g.shadowBlur = 0;
  if (opts.stroke) {
    g.lineWidth = px * (opts.strokeW || 0.06);
    g.strokeStyle = opts.stroke;
    g.strokeText(txt, 0, 0);
  }
  g.letterSpacing = '0px';
  g.restore();
}

/* ------------------------------------------------------------------ */
/* Main artwork                                                        */
/* ------------------------------------------------------------------ */

export function makePlayfieldArt(res = 2048) {
  const W = res;
  const H = Math.round(res * ART_ASPECT);
  const c = mkCanvas(W, H);
  const g = c.getContext('2d');
  const p = new Painter(g, W, H);
  const rnd = makeRng(0xc0ffee);

  /* ---- base: deep space --------------------------------------- */
  // The negative space of a real playfield is *dark*. Everything that makes a
  // machine look expensive -- insert lamps, chrome, the ball, screen-printed
  // spot colour -- only reads because it sits against near-black. A mid-value
  // background flattens all of it into one pastel field no matter how the
  // light rig is tuned, so the deep-space base is kept down at 5-12% value
  // and the nebulae are used sparingly as accents rather than as ground.
  // Space Cadet reads as a *steel deck* first and deep space second: the
  // negative space is blue-grey gunmetal, not a purple nebula field. Stars
  // and planets are a window motif at the top of the board, not the ground.
  const bg = g.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, '#1a2431');
  bg.addColorStop(0.28, '#22303f');
  bg.addColorStop(0.55, '#1b2632');
  bg.addColorStop(0.8, '#141c26');
  bg.addColorStop(1, '#0c1119');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // A single cold nebula wash up-table where the starfield window sits.
  nebula(p, rnd, W * 0.42, H * 0.14, W * 0.55, 210, 0.16);
  nebula(p, rnd, W * 0.74, H * 0.30, W * 0.34, 198, 0.10);
  starfield(p, rnd, 1500, 2.1, 0.75);

  /* ---- riveted steel deck plating ------------------------------- */
  // The XP table is painted sheet metal: big plates, recessed seams, rows of
  // rivets, and stencilled bay numbers. This layer is what makes the board
  // read as a hangar deck instead of a nightclub floor.
  g.save();
  const plateH = H / 9;
  for (let row = 0; row < 9; row++) {
    const yy = row * plateH;
    const off = row % 2 ? W * 0.09 : 0;
    const cols = 5;
    for (let col = -1; col <= cols; col++) {
      const xx = col * (W / cols) + off;
      const tone = (rnd() - 0.5) * 12;
      g.fillStyle = `rgba(${(58 + tone) | 0},${(74 + tone) | 0},${(92 + tone) | 0},0.20)`;
      g.fillRect(xx + 2, yy + 2, W / cols - 4, plateH - 4);
      // recessed seam: dark groove with a lit top lip
      g.fillStyle = 'rgba(6,10,16,0.42)';
      g.fillRect(xx, yy, W / cols, 3);
      g.fillRect(xx, yy, 3, plateH);
      g.fillStyle = 'rgba(168,196,224,0.10)';
      g.fillRect(xx + 3, yy + 3, W / cols - 6, 1.5);
    }
  }
  // rivet rows along every seam
  const rivet = (x, y, r) => {
    g.fillStyle = 'rgba(8,12,18,0.5)';
    g.beginPath();
    g.arc(x, y + r * 0.5, r, 0, 7);
    g.fill();
    g.fillStyle = 'rgba(150,178,206,0.34)';
    g.beginPath();
    g.arc(x, y, r * 0.85, 0, 7);
    g.fill();
    g.fillStyle = 'rgba(226,238,250,0.30)';
    g.beginPath();
    g.arc(x - r * 0.28, y - r * 0.30, r * 0.34, 0, 7);
    g.fill();
  };
  const rr = p.S(0.0038);
  for (let row = 0; row <= 9; row++) {
    const yy = row * plateH + 8;
    for (let i = 0; i < 30; i++) rivet((i + 0.5) * (W / 30), yy, rr);
  }
  g.restore();

  /* ---- starfield window through the deck, up-table --------------- */
  g.save();
  g.beginPath();
  g.ellipse(p.X(-0.019), p.Y(1.01), p.S(0.30), p.S(0.19), 0, 0, 7);
  g.clip();
  g.fillStyle = '#050810';
  g.fillRect(0, 0, W, H);
  starfield(p, rnd, 900, 2.6, 1.0);
  planet(p, rnd, p.X(-0.17), p.Y(1.00), p.S(0.078), 28, true);
  planet(p, rnd, p.X(0.175), p.Y(1.055), p.S(0.034), 205, false);
  g.restore();
  // heavy steel bezel around the window
  g.save();
  g.strokeStyle = 'rgba(6,10,16,0.9)';
  g.lineWidth = p.S(0.0090);
  g.beginPath();
  g.ellipse(p.X(-0.019), p.Y(1.01), p.S(0.30), p.S(0.19), 0, 0, 7);
  g.stroke();
  g.strokeStyle = 'rgba(150,178,206,0.42)';
  g.lineWidth = p.S(0.0026);
  g.beginPath();
  g.ellipse(p.X(-0.019), p.Y(1.01), p.S(0.296), p.S(0.186), 0, 0, 7);
  g.stroke();
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    rivet(p.X(-0.019) + Math.cos(a) * p.S(0.306), p.Y(1.01) + Math.sin(a) * p.S(0.196), rr);
  }
  g.restore();

  /* ---- mission rings around the bumper cluster ------------------ */
  const bcx = p.X(-0.019);
  const bcy = p.Y(0.73);
  ringSet(p, bcx, bcy, p.S(0.055), p.S(0.19), 7, '#8fb4d4', 0.26, false);
  ringSet(p, bcx, bcy, p.S(0.2), p.S(0.235), 2, '#ffab35', 0.38, true);
  g.save();
  g.globalCompositeOperation = 'screen';
  g.fillStyle = radial(g, bcx, bcy, p.S(0.22), [
    [0, 'rgba(96,130,164,0.24)'],
    [0.5, 'rgba(52,74,102,0.11)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  g.beginPath();
  g.arc(bcx, bcy, p.S(0.22), 0, 7);
  g.fill();
  g.restore();

  // radial tick marks
  g.save();
  g.strokeStyle = 'rgba(198,216,232,0.42)';
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const r0 = p.S(0.2);
    const r1 = p.S(i % 4 === 0 ? 0.222 : 0.211);
    g.lineWidth = p.S(i % 4 === 0 ? 0.0022 : 0.001);
    g.beginPath();
    g.moveTo(bcx + Math.cos(a) * r0, bcy + Math.sin(a) * r0);
    g.lineTo(bcx + Math.cos(a) * r1, bcy + Math.sin(a) * r1);
    g.stroke();
  }
  g.restore();

  /* ---- bold screen-printed colour fields ------------------------ */
  // A real playfield is *printed*: large flat spot colours with hard edges
  // and heavy keylines, not a haze of translucent gradients. Without this
  // layer the whole board sits in a 10-45% value band and reads as mush.
  const kline = (pts, w, col) => {
    g.save();
    poly(p, pts);
    g.closePath();
    g.lineJoin = 'round';
    g.lineWidth = p.S(w);
    g.strokeStyle = col;
    g.stroke();
    g.restore();
  };
  const field = (pts, stops, ang) => {
    g.save();
    poly(p, pts);
    g.closePath();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [ax, ay] of pts) {
      const px = p.X(ax), py = p.Y(ay);
      x0 = Math.min(x0, px); y0 = Math.min(y0, py);
      x1 = Math.max(x1, px); y1 = Math.max(y1, py);
    }
    const gr = ang
      ? g.createLinearGradient(x0, y0, x1, y1)
      : g.createLinearGradient(x0, y0, x0, y1);
    for (const [t, cc] of stops) gr.addColorStop(t, cc);
    g.fillStyle = gr;
    g.fill();
    g.restore();
  };

  // left flank: the fuel-loading apron. Amber-into-rust, the one warm mass on
  // an otherwise cold steel board -- Space Cadet's only real hot colour.
  const leftField = [
    [-0.298, 0.585], [-0.176, 0.548], [-0.130, 0.430],
    [-0.155, 0.256], [-0.243, 0.171], [-0.298, 0.214],
  ];
  field(leftField, [
    [0, '#e8961f'], [0.32, '#c46414'], [0.66, '#8a3510'], [1, '#3d1a09'],
  ], true);
  kline(leftField, 0.0075, '#080c12');
  kline(leftField, 0.0022, 'rgba(255,214,150,0.45)');

  // right flank: cold counterweight — painted steel, not neon cyan
  const rightField = [
    [0.276, 0.600], [0.156, 0.556], [0.112, 0.432],
    [0.140, 0.252], [0.228, 0.166], [0.282, 0.212],
  ];
  field(rightField, [
    [0, '#7c9cb8'], [0.34, '#456c8c'], [0.7, '#25405c'], [1, '#111d2c'],
  ], true);
  kline(rightField, 0.0075, '#080c12');
  kline(rightField, 0.0022, 'rgba(196,220,238,0.42)');

  // hazard chevrons stamped across the amber apron
  g.save();
  poly(p, leftField);
  g.closePath();
  g.clip();
  g.globalAlpha = 0.34;
  g.fillStyle = '#0b0f16';
  for (let i = -12; i < 22; i++) {
    g.save();
    g.translate(p.X(-0.21), p.Y(0.38));
    g.rotate(-0.62);
    g.fillRect(-p.S(0.30) + i * p.S(0.030), -p.S(0.30), p.S(0.013), p.S(0.60));
    g.restore();
  }
  g.restore();

  // scan grid stamped across the steel flank
  g.save();
  poly(p, rightField);
  g.closePath();
  g.clip();
  g.globalAlpha = 0.30;
  g.strokeStyle = '#0b1622';
  g.lineWidth = p.S(0.0022);
  for (let i = 0; i < 26; i++) {
    const yy = p.Y(0.16 + i * 0.019);
    g.beginPath(); g.moveTo(p.X(0.10), yy); g.lineTo(p.X(0.30), yy); g.stroke();
  }
  for (let i = 0; i < 14; i++) {
    const xx = p.X(0.10 + i * 0.016);
    g.beginPath(); g.moveTo(xx, p.Y(0.14)); g.lineTo(xx, p.Y(0.63)); g.stroke();
  }
  g.restore();

  // ivory orbit band sweeping the mid playfield: the single brightest print
  // on the board, so the eye has a highlight to anchor on
  g.save();
  g.lineCap = 'round';
  for (const [rr2, w, col] of [
    [0.300, 0.0175, 'rgba(226,234,242,0.86)'],
    [0.300, 0.0068, 'rgba(255,176,58,0.50)'],
  ]) {
    g.strokeStyle = col;
    g.lineWidth = p.S(w);
    g.beginPath();
    g.arc(p.X(-0.019), p.Y(0.73), p.S(rr2), Math.PI * 0.18, Math.PI * 0.82);
    g.stroke();
  }
  g.strokeStyle = '#080c12';
  g.lineWidth = p.S(0.0026);
  for (const off of [-0.0105, 0.0105]) {
    g.beginPath();
    g.arc(p.X(-0.019), p.Y(0.73), p.S(0.300 + off), Math.PI * 0.17, Math.PI * 0.83);
    g.stroke();
  }
  g.restore();

  // registration/serial block, bottom-right of the print
  g.save();
  g.globalAlpha = 0.55;
  g.fillStyle = '#e8f0ff';
  g.fillRect(p.X(0.196), p.Y(0.085), p.S(0.072), p.S(0.0075));
  g.fillStyle = '#0a0d1e';
  g.font = `600 ${Math.round(p.S(0.0125))}px "Helvetica Neue", Arial, sans-serif`;
  g.restore();

  /* ---- hero illustration + value anchors ------------------------ */
  // The board needed (a) real blacks, (b) a cream/ivory value at the top of
  // the range and (c) an actual illustration rather than a gradient field.
  // Everything below is opaque spot colour so it survives the halftone pass
  // and the clearcoat.
  const INK = '#070b11';
  const CREAM = '#e6ecf2';

  // -- (1) hard-edged deck plates: the blacks -------------------------
  const plate = (pts, tint) => {
    g.save();
    poly(p, pts);
    g.closePath();
    g.fillStyle = tint;
    g.fill();
    g.restore();
    kline(pts, 0.0060, INK);
    kline(pts, 0.0016, 'rgba(176,200,220,0.38)');
  };
  // top deck strip, above the NOVA rollover lanes
  plate([
    [-0.250, 1.098], [0.192, 1.098], [0.240, 1.030],
    [0.196, 0.958], [-0.212, 0.958], [-0.262, 1.030],
  ], 'rgba(6,9,22,0.80)');

  // -- (2) hero illustration: the ND-7 launch vehicle -----------------
  // Sits dead centre under the bumper cluster, the way a real machine puts
  // its key art under the hardware.
  g.save();
  g.translate(p.X(-0.019), p.Y(0.700));
  g.rotate(-0.16);
  const u = (v) => p.S(v);
  // exhaust plume first, behind the hull
  const plume = g.createLinearGradient(0, u(0.040), 0, u(0.250));
  plume.addColorStop(0, 'rgba(255,240,200,0.95)');
  plume.addColorStop(0.20, 'rgba(255,172,62,0.82)');
  plume.addColorStop(0.55, 'rgba(232,64,52,0.40)');
  plume.addColorStop(1, 'rgba(120,20,60,0)');
  g.fillStyle = plume;
  g.beginPath();
  g.moveTo(-u(0.036), u(0.040));
  g.quadraticCurveTo(-u(0.072), u(0.160), 0, u(0.252));
  g.quadraticCurveTo(u(0.072), u(0.160), u(0.036), u(0.040));
  g.closePath();
  g.fill();
  // hull
  const hull = [
    [0, -u(0.176)], [u(0.028), -u(0.108)], [u(0.036), u(0.014)],
    [u(0.036), u(0.046)], [-u(0.036), u(0.046)], [-u(0.036), u(0.014)],
    [-u(0.028), -u(0.108)],
  ];
  const hg = g.createLinearGradient(-u(0.04), 0, u(0.04), 0);
  hg.addColorStop(0, '#4b5570');
  hg.addColorStop(0.22, '#eef2fa');
  hg.addColorStop(0.55, '#c0cadd');
  hg.addColorStop(1, '#3d4661');
  g.fillStyle = hg;
  g.beginPath();
  g.moveTo(hull[0][0], hull[0][1]);
  for (let i = 1; i < hull.length; i++) g.lineTo(hull[i][0], hull[i][1]);
  g.closePath();
  g.fill();
  g.lineJoin = 'round';
  g.lineWidth = u(0.0055);
  g.strokeStyle = INK;
  g.stroke();
  // fins
  for (const d of [-1, 1]) {
    g.fillStyle = d < 0 ? '#c8340f' : '#e5501c';
    g.beginPath();
    g.moveTo(d * u(0.033), -u(0.004));
    g.lineTo(d * u(0.086), u(0.056));
    g.lineTo(d * u(0.033), u(0.046));
    g.closePath();
    g.fill();
    g.lineWidth = u(0.005);
    g.strokeStyle = INK;
    g.stroke();
  }
  // livery bands + porthole
  g.fillStyle = '#e5501c';
  g.fillRect(-u(0.033), -u(0.070), u(0.066), u(0.017));
  g.fillStyle = INK;
  g.fillRect(-u(0.033), -u(0.045), u(0.066), u(0.005));
  // cockpit window band
  for (let i = -1; i <= 1; i++) {
    g.beginPath();
    g.arc(i * u(0.019), -u(0.014), u(0.0090), 0, 7);
    g.fillStyle = '#122a54';
    g.fill();
    g.lineWidth = u(0.0038);
    g.strokeStyle = '#9fb2cf';
    g.stroke();
    g.beginPath();
    g.arc(i * u(0.019) - u(0.003), -u(0.017), u(0.0030), 0, 7);
    g.fillStyle = 'rgba(205,238,255,0.85)';
    g.fill();
  }
  g.restore();

  // -- (4) cream orbit guide sweeping the top arc ---------------------
  g.save();
  g.lineCap = 'butt';
  for (const [rr, w, col] of [
    [0.252, 0.0225, 'rgba(7,11,17,0.92)'],
    [0.252, 0.0155, CREAM],
    [0.252, 0.0040, 'rgba(255,176,58,0.62)'],
  ]) {
    g.strokeStyle = col;
    g.lineWidth = p.S(w);
    for (const [a0, a1] of [[Math.PI * 1.06, Math.PI * 1.36], [Math.PI * 1.64, Math.PI * 1.94]]) {
      g.beginPath();
      g.arc(p.X(0), p.Y(0.800), p.S(rr), a0, a1);
      g.stroke();
    }
  }
  g.restore();

  // -- (3) cream vector type on the top deck --------------------------
  g.save();
  g.translate(p.X(-0.010), p.Y(1.030));
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `800 ${Math.round(p.S(0.0300))}px "Helvetica Neue", Arial, sans-serif`;
  g.letterSpacing = `${p.S(0.006)}px`;
  g.lineWidth = p.S(0.0080);
  g.lineJoin = 'round';
  g.strokeStyle = INK;
  g.strokeText('ORBITAL DEFENCE', 0, -p.S(0.014));
  g.fillStyle = CREAM;
  g.fillText('ORBITAL DEFENCE', 0, -p.S(0.014));
  g.font = `700 ${Math.round(p.S(0.0140))}px "Helvetica Neue", Arial, sans-serif`;
  g.letterSpacing = `${p.S(0.008)}px`;
  g.lineWidth = p.S(0.0046);
  g.strokeText('COMMAND · MODEL ND-7', 0, p.S(0.018));
  g.fillStyle = '#ffb733';
  g.fillText('COMMAND · MODEL ND-7', 0, p.S(0.018));
  g.letterSpacing = '0px';
  g.restore();

  // -- (5) drain-mouth hazard wedge between the flippers --------------
  const mouth = [
    [-0.108, 0.176], [0.072, 0.176], [0.034, 0.012], [-0.070, 0.012],
  ];
  g.save();
  poly(p, mouth);
  g.closePath();
  g.fillStyle = 'rgba(255,196,74,0.95)';
  g.fill();
  g.clip();
  g.fillStyle = '#0a0d18';
  for (let i = -6; i < 18; i++) {
    g.save();
    g.translate(p.X(-0.018), p.Y(0.094));
    g.rotate(0.50);
    g.fillRect(-p.S(0.16) + i * p.S(0.026), -p.S(0.16), p.S(0.012), p.S(0.32));
    g.restore();
  }
  const tr = g.createLinearGradient(0, p.Y(0.176), 0, p.Y(0.012));
  tr.addColorStop(0, 'rgba(198,52,36,0.46)');
  tr.addColorStop(1, 'rgba(255,150,30,0.10)');
  g.fillStyle = tr;
  g.fillRect(p.X(-0.108), p.Y(0.176), p.S(0.180), p.S(0.166));
  g.restore();
  kline(mouth, 0.0065, INK);

  // -- (6) outlane / inlane stencils -----------------------------------
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `800 ${Math.round(p.S(0.0110))}px "Helvetica Neue", Arial, sans-serif`;
  g.letterSpacing = `${p.S(0.0026)}px`;
  for (const [sx, sy, rot, txt, col] of [
    [-0.2405, 0.240, 0.10, 'OUT LANE', '#ffd166'],
    [0.2075, 0.240, -0.10, 'OUT LANE', '#ffd166'],
    [-0.170, 0.210, 0.10, 'RETURN', '#8fd8a0'],
    [0.137, 0.210, -0.10, 'RETURN', '#8fd8a0'],
  ]) {
    g.save();
    g.translate(p.X(sx), p.Y(sy));
    g.rotate(rot);
    g.lineWidth = p.S(0.0042);
    g.lineJoin = 'round';
    g.strokeStyle = INK;
    g.strokeText(txt, 0, 0);
    g.fillStyle = col;
    g.fillText(txt, 0, 0);
    g.restore();
  }
  g.letterSpacing = '0px';
  g.restore();

  // -- (7) technical stencil clusters: print density ------------------
  g.save();
  g.fillStyle = 'rgba(198,216,232,0.46)';
  g.font = `600 ${Math.round(p.S(0.0090))}px "Helvetica Neue", Arial, sans-serif`;
  g.letterSpacing = `${p.S(0.0018)}px`;
  const stencils = [
    [-0.268, 0.700, 'SECTOR 7 / NAV'],
    [0.196, 0.660, 'THRUST 04'],
    [-0.126, 0.278, 'CTRL-A22'],
    [0.062, 0.278, 'BAY 03'],
    [-0.262, 0.900, 'DECK 1'],
    [0.150, 0.900, 'DECK 2'],
  ];
  for (const [sx, sy, txt] of stencils) {
    g.save();
    g.translate(p.X(sx), p.Y(sy));
    g.rotate(-0.09);
    g.fillText(txt, 0, 0);
    g.fillRect(0, p.S(0.004), p.S(0.052), p.S(0.0012));
    g.restore();
  }
  g.letterSpacing = '0px';
  g.restore();

  /* ---- big geometric brand wedge across the middle -------------- */
  g.save();
  g.globalAlpha = 0.9;
  g.translate(p.X(-0.017), p.Y(0.32));
  g.rotate(-0.06);
  const wedge = g.createLinearGradient(-p.S(0.3), 0, p.S(0.3), 0);
  wedge.addColorStop(0, 'rgba(255,164,44,0)');
  wedge.addColorStop(0.25, 'rgba(255,164,44,0.50)');
  wedge.addColorStop(0.5, 'rgba(226,236,244,0.42)');
  wedge.addColorStop(0.75, 'rgba(96,140,178,0.44)');
  wedge.addColorStop(1, 'rgba(96,140,178,0)');
  g.fillStyle = wedge;
  g.beginPath();
  g.moveTo(-p.S(0.3), -p.S(0.02));
  g.lineTo(p.S(0.3), -p.S(0.035));
  g.lineTo(p.S(0.3), p.S(0.006));
  g.lineTo(-p.S(0.3), p.S(0.022));
  g.closePath();
  g.fill();
  g.restore();

  /* ---- lower-third launchpad graphic ---------------------------- */
  g.save();
  g.translate(p.X(-0.017), p.Y(0.155));
  g.globalAlpha = 0.55;
  for (let i = 0; i < 9; i++) {
    g.strokeStyle = `rgba(190,210,226,${0.46 - i * 0.042})`;
    g.lineWidth = p.S(0.0018);
    g.beginPath();
    g.ellipse(0, 0, p.S(0.05 + i * 0.026), p.S(0.018 + i * 0.011), 0, 0, 7);
    g.stroke();
  }
  g.restore();

  /* ---- shooter lane art ----------------------------------------- */
  g.save();
  const lx0 = p.X(L.laneIn);
  const lx1 = p.X(L.laneOut);
  const lgrd = g.createLinearGradient(lx0, 0, lx1, 0);
  lgrd.addColorStop(0, 'rgba(10,14,30,0.9)');
  lgrd.addColorStop(0.5, 'rgba(30,44,86,0.85)');
  lgrd.addColorStop(1, 'rgba(10,14,30,0.9)');
  g.fillStyle = lgrd;
  g.fillRect(lx0, p.Y(L.laneTop), lx1 - lx0, p.Y(L.laneBottom) - p.Y(L.laneTop));
  for (let i = 0; i < 26; i++) {
    const yy = L.laneBottom + 0.03 + i * 0.028;
    if (yy > L.laneTop - 0.02) break;
    g.fillStyle = i % 2 ? 'rgba(255,172,44,0.48)' : 'rgba(150,178,200,0.34)';
    g.fillRect(lx0 + p.S(0.004), p.Y(yy), lx1 - lx0 - p.S(0.008), p.S(0.004));
  }
  stencilText(p, 'LAUNCH', L.laneIn + 0.017, 0.42, 0.0195, {
    rot: -Math.PI / 2,
    fill: '#e8eef4',
    letterSpacing: 0.006,
    glow: 'rgba(255,176,58,0.75)',
  });
  g.restore();

  /* ---- lane / channel floor tints -------------------------------- */
  const tintPoly = (pts, col, a) => {
    g.save();
    g.globalAlpha = a;
    poly(p, pts);
    g.fillStyle = col;
    g.fill();
    g.restore();
  };
  tintPoly(
    [
      [-0.27, 0.33],
      [-0.214, 0.302],
      [-0.196, 0.206],
      [-0.158, 0.161],
      [-0.199, 0.054],
      [-0.246, 0.118],
      [-0.268, 0.205],
    ],
    '#111a24',
    0.75
  );
  tintPoly(
    [
      [0.236, 0.33],
      [0.18, 0.302],
      [0.162, 0.206],
      [0.124, 0.161],
      [0.165, 0.054],
      [0.212, 0.118],
      [0.234, 0.205],
    ],
    '#111a24',
    0.75
  );

  /* ---- big vector lettering ------------------------------------- */
  // title along the lower third
  stencilText(p, 'SPACE CADET', -0.017, 0.258, 0.0185, {
    fill: '#e9eff5',
    letterSpacing: 0.0075,
    glow: 'rgba(255,176,58,0.55)',
    stroke: 'rgba(8,12,18,0.92)',
    strokeW: 0.05,
  });
  const nova = g.createLinearGradient(p.X(-0.15), 0, p.X(0.12), 0);
  nova.addColorStop(0, '#ffd25a');
  nova.addColorStop(0.42, '#ffa728');
  nova.addColorStop(0.74, '#e2601f');
  nova.addColorStop(1, '#b8371f');
  stencilText(p, 'NOVA', -0.017, 0.206, 0.049, {
    fill: nova,
    letterSpacing: 0.011,
    glow: 'rgba(255,140,60,0.42)',
    stroke: 'rgba(232,240,248,0.50)',
    strokeW: 0.028,
  });
  stencilText(p, '\u2605  ORBITAL  DEFENCE  COMMAND  \u2605', -0.017, 0.168, 0.0092, {
    fill: 'rgba(198,214,228,0.70)',
    letterSpacing: 0.0032,
    shadow: false,
  });

  // side-rail vertical callouts
  stencilText(p, 'REENTRY', -0.257, 0.335, 0.017, {
    rot: -Math.PI / 2,
    fill: 'rgba(255,172,72,0.50)',
    letterSpacing: 0.006,
    shadow: false,
  });

  /* ---- feature labels & inserts --------------------------------- */
  const inserts = [];

  const addRoundInsert = (x, y, w, h, r, color, label, labelSize, rot = 0) => {
    const cx = p.X(x);
    const cy = p.Y(y);
    const ww = p.S(w);
    const hh = p.S(h);
    g.save();
    g.translate(cx, cy);
    g.rotate(-rot);
    insert(p, (gg) => roundRectPath(gg, -ww / 2, -hh / 2, ww, hh, p.S(r)), color);
    g.restore();
    if (label)
      stencilText(p, label, x, y, labelSize, {
        rot,
        fill: 'rgba(255,255,255,0.82)',
        letterSpacing: 0.0022,
        shadow: false,
      });
    inserts.push({ x, y, w, h, color, rot, shape: 'rect' });
  };

  const addArrowInsert = (x, y, w, h, color, ang) => {
    const cx = p.X(x);
    const cy = p.Y(y);
    insert(p, (gg) => arrowPath(gg, cx, cy, p.S(w), p.S(h), ang), color);
    inserts.push({ x, y, w, h, color, rot: -ang, shape: 'arrow' });
  };

  // ramp entrance arrows + labels
  addArrowInsert(-0.132, 0.318, 0.036, 0.05, '#e0532a', 0.35);
  stencilText(p, 'REENTRY', -0.132, 0.272, 0.0135, {
    fill: '#ffbe72',
    letterSpacing: 0.0026,
    glow: 'rgba(224,83,42,0.7)',
  });
  addArrowInsert(0.126, 0.338, 0.036, 0.05, '#4fbf6e', -0.22);
  stencilText(p, 'FUEL', 0.126, 0.292, 0.0135, {
    fill: '#a8e6b6',
    letterSpacing: 0.0026,
    glow: 'rgba(79,191,110,0.7)',
  });

  chevrons(p, -0.145, 0.36, 1.9, 5, 0.03, 0.026, 'rgba(255,140,52,0.70)', true);
  chevrons(p, 0.138, 0.38, 1.28, 5, 0.03, 0.026, 'rgba(120,206,140,0.66)', true);

  // saucer surround
  const sx = p.X(L.saucer.x);
  const sy = p.Y(L.saucer.y);
  g.save();
  g.globalCompositeOperation = 'screen';
  g.fillStyle = radial(g, sx, sy, p.S(0.075), [
    [0, 'rgba(90,160,200,0.46)'],
    [0.4, 'rgba(46,96,140,0.22)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  g.beginPath();
  g.arc(sx, sy, p.S(0.075), 0, 7);
  g.fill();
  g.restore();
  ringSet(p, sx, sy, p.S(0.026), p.S(0.055), 5, '#9fc6e2', 0.62, true);
  stencilText(p, 'WORMHOLE', L.saucer.x, L.saucer.y - 0.044, 0.0135, {
    fill: '#dbe8f2',
    letterSpacing: 0.003,
    glow: 'rgba(110,178,220,0.8)',
  });

  // NOVA top-lane letters + inserts
  for (let i = 0; i < 4; i++) {
    const lx = (L.laneGuideX[i] + L.laneGuideX[i + 1]) / 2;
    addRoundInsert(lx, 0.9, 0.03, 0.03, 0.006, '#ffbb2e', null, 0);
    stencilText(p, L.laneLetters[i], lx, 0.9, 0.024, {
      fill: 'rgba(255,255,255,0.9)',
      shadow: false,
    });
  }

  // in/outlane rollovers
  for (const r of L.rollovers) {
    addRoundInsert(r.x, r.y, 0.05, 0.017, 0.0075, r.label === 'SPECIAL' ? '#d8402c' : '#4fbf6e', r.label, 0.0092, r.x < 0 ? -0.28 : 0.28);
  }

  // drop target bank label
  stencilText(p, 'FUEL  CELLS', -0.176, 0.512, 0.0135, {
    fill: '#d8e4ee',
    letterSpacing: 0.0034,
    rot: -0.44,
    glow: 'rgba(255,176,58,0.55)',
  });

  // standup targets label
  stencilText(p, 'NAV', 0.196, 0.652, 0.0145, {
    fill: '#ffd9a0',
    letterSpacing: 0.003,
    rot: -0.2,
    shadow: false,
  });

  // jackpot / multiball inserts down the centre
  addRoundInsert(-0.017, 0.44, 0.088, 0.024, 0.008, '#d8402c', 'JACKPOT', 0.0135);
  addRoundInsert(-0.017, 0.404, 0.088, 0.02, 0.007, '#4fbf6e', 'MULTIBALL', 0.0112);
  addRoundInsert(-0.098, 0.212, 0.05, 0.018, 0.007, '#e9eff5', 'BONUS X', 0.0098);
  addRoundInsert(0.064, 0.212, 0.05, 0.018, 0.007, '#ffb02a', 'EXTRA BALL', 0.0084);

  // spinner label
  stencilText(p, 'SPIN', -0.253, 0.655, 0.0115, {
    rot: -Math.PI / 2,
    fill: 'rgba(206,220,232,0.75)',
    letterSpacing: 0.0024,
    shadow: false,
  });

  // captive ball callout
  stencilText(p, 'CORE', -0.186, 0.652, 0.0115, {
    fill: 'rgba(255,196,130,0.8)',
    letterSpacing: 0.0024,
    shadow: false,
  });

  /* ================================================================ */
  /* SCREEN-PRINT GRAPHIC LAYER                                        */
  /* Hard-edged, black-keylined, saturated colour blocking. This is    */
  /* what separates a designed playfield from an airbrushed render.    */
  /* ================================================================ */

  // --- helpers -----------------------------------------------------
  const keyline = (w = 0.0028, col = 'rgba(7,11,17,0.92)') => {
    g.strokeStyle = col;
    g.lineWidth = p.S(w);
    g.lineJoin = 'miter';
    g.stroke();
  };
  const shapePoly = (pts) => {
    g.beginPath();
    g.moveTo(p.X(pts[0][0]), p.Y(pts[0][1]));
    for (let i = 1; i < pts.length; i++) g.lineTo(p.X(pts[i][0]), p.Y(pts[i][1]));
    g.closePath();
  };
  // a saturated block with a printed halftone gradient inside it
  const printBlock = (pts, c0, c1, ang = 0) => {
    shapePoly(pts);
    g.save();
    g.clip();
    let xa = 1e9, xb = -1e9, ya = 1e9, yb = -1e9;
    for (const q of pts) {
      xa = Math.min(xa, p.X(q[0])); xb = Math.max(xb, p.X(q[0]));
      ya = Math.min(ya, p.Y(q[1])); yb = Math.max(yb, p.Y(q[1]));
    }
    const gr = g.createLinearGradient(
      xa + (xb - xa) * (0.5 - Math.cos(ang) * 0.5),
      ya + (yb - ya) * (0.5 - Math.sin(ang) * 0.5),
      xa + (xb - xa) * (0.5 + Math.cos(ang) * 0.5),
      ya + (yb - ya) * (0.5 + Math.sin(ang) * 0.5)
    );
    gr.addColorStop(0, c0);
    gr.addColorStop(1, c1);
    g.fillStyle = gr;
    g.fillRect(xa, ya, xb - xa, yb - ya);
    // halftone dots fading across the block — a real screen-print tell
    const d = p.S(0.0042);
    for (let yy = ya; yy < yb; yy += d * 2) {
      for (let xx = xa; xx < xb; xx += d * 2) {
        const t = (xx - xa) / Math.max(1, xb - xa);
        const r = d * 0.95 * Math.max(0, Math.min(1, t * 1.35 - 0.18));
        if (r < 0.35) continue;
        g.fillStyle = 'rgba(7,11,17,0.55)';
        g.beginPath();
        g.arc(xx, yy, r, 0, 7);
        g.fill();
      }
    }
    g.restore();
    shapePoly(pts);
    keyline(0.0032);
  };
  // stacked chevrons pointing up-table
  const chevStack = (x, y, w, n, col, dir = 1, rot = 0, gap = 0.024) => {
    g.save();
    g.translate(p.X(x), p.Y(y));
    g.rotate(-rot);
    for (let i = 0; i < n; i++) {
      const yy = -i * p.S(gap) * dir;
      const a = 1 - i * 0.22;
      g.beginPath();
      g.moveTo(-p.S(w) / 2, yy + p.S(w) * 0.34 * dir);
      g.lineTo(0, yy - p.S(w) * 0.16 * dir);
      g.lineTo(p.S(w) / 2, yy + p.S(w) * 0.34 * dir);
      g.lineTo(p.S(w) * 0.32, yy + p.S(w) * 0.40 * dir);
      g.lineTo(0, yy + p.S(w) * 0.10 * dir);
      g.lineTo(-p.S(w) * 0.32, yy + p.S(w) * 0.40 * dir);
      g.closePath();
      g.fillStyle = col.replace('ALPHA', (0.92 * a).toFixed(2));
      g.fill();
      g.strokeStyle = 'rgba(7,11,17,0.9)';
      g.lineWidth = p.S(0.0018);
      g.stroke();
    }
    g.restore();
  };

  // --- 1. hard black keyline around the whole print ----------------
  g.save();
  g.beginPath();
  g.rect(p.X(-0.292), p.Y(1.104), p.S(0.584), p.Y(0.02) - p.Y(1.104));
  g.strokeStyle = 'rgba(6,9,14,0.85)';
  g.lineWidth = p.S(0.0055);
  g.stroke();
  g.restore();

  // --- 2. LAUNCH PAD: the lower-third hero graphic ------------------
  // big warm trapezoid deck with a black keyline and cross-hatched deck plate
  printBlock(
    [[-0.212, 0.288], [0.178, 0.288], [0.226, 0.086], [-0.260, 0.086]],
    'rgba(46,64,84,0.94)',
    'rgba(22,32,45,0.94)',
    0.25
  );
  // deck plate hatching
  g.save();
  shapePoly([[-0.212, 0.288], [0.178, 0.288], [0.226, 0.086], [-0.260, 0.086]]);
  g.clip();
  g.strokeStyle = 'rgba(8,12,18,0.34)';
  g.lineWidth = p.S(0.0016);
  for (let i = -30; i < 40; i++) {
    g.beginPath();
    g.moveTo(p.X(-0.30 + i * 0.019), p.Y(0.30));
    g.lineTo(p.X(-0.30 + i * 0.019 + 0.06), p.Y(0.06));
    g.stroke();
  }
  g.restore();
  // hot exhaust cone — the one warm accent in the cool lower third
  {
    g.save();
    shapePoly([[-0.212, 0.288], [0.178, 0.288], [0.226, 0.086], [-0.260, 0.086]]);
    g.clip();
    const fx = p.X(-0.017);
    const fy = p.Y(0.264);
    const fl = g.createLinearGradient(fx, fy, fx, p.Y(0.096));
    fl.addColorStop(0, 'rgba(255,236,170,0.70)');
    fl.addColorStop(0.28, 'rgba(255,170,52,0.56)');
    fl.addColorStop(0.62, 'rgba(206,62,36,0.34)');
    fl.addColorStop(1, 'rgba(90,26,18,0.0)');
    g.fillStyle = fl;
    g.beginPath();
    g.moveTo(p.X(-0.030), fy);
    g.lineTo(p.X(-0.004), fy);
    g.lineTo(p.X(0.052), p.Y(0.100));
    g.lineTo(p.X(-0.086), p.Y(0.100));
    g.closePath();
    g.fill();
    keyline(0.0024, 'rgba(8,10,20,0.55)');
    g.restore();
  }
  // concentric landing rings, hard-edged
  for (let i = 0; i < 4; i++) {
    g.save();
    g.translate(p.X(-0.017), p.Y(0.183));
    g.scale(1, 0.44);
    g.beginPath();
    g.arc(0, 0, p.S(0.052 + i * 0.038), 0, 7);
    g.strokeStyle = i % 2 ? 'rgba(8,12,18,0.8)' : 'rgba(255,186,72,0.85)';
    g.lineWidth = p.S(0.0038 - i * 0.0005);
    g.stroke();
    g.restore();
  }
  // registration marks at the pad corners
  for (const [mx, my] of [[-0.196, 0.262], [0.162, 0.262], [-0.238, 0.108], [0.204, 0.108]]) {
    g.save();
    g.strokeStyle = 'rgba(9,13,19,0.8)';
    g.lineWidth = p.S(0.0022);
    g.beginPath();
    g.moveTo(p.X(mx - 0.012), p.Y(my));
    g.lineTo(p.X(mx + 0.012), p.Y(my));
    g.moveTo(p.X(mx), p.Y(my - 0.012));
    g.lineTo(p.X(mx), p.Y(my + 0.012));
    g.stroke();
    g.beginPath();
    g.arc(p.X(mx), p.Y(my), p.S(0.0068), 0, 7);
    g.stroke();
    g.restore();
  }

  // --- 3. in/outlane guide blocking + chevrons ---------------------
  printBlock(
    [[-0.268, 0.276], [-0.196, 0.244], [-0.170, 0.108], [-0.246, 0.086]],
    'rgba(52,72,94,0.88)',
    'rgba(18,27,38,0.88)',
    1.2
  );
  printBlock(
    [[0.234, 0.276], [0.162, 0.244], [0.136, 0.108], [0.212, 0.086]],
    'rgba(52,72,94,0.88)',
    'rgba(18,27,38,0.88)',
    1.9
  );
  chevStack(-0.238, 0.212, 0.036, 3, 'rgba(255,178,58,ALPHA)', 1, -0.24);
  chevStack(-0.152, 0.222, 0.034, 3, 'rgba(110,198,132,ALPHA)', 1, -0.24);
  chevStack(0.204, 0.212, 0.036, 3, 'rgba(255,178,58,ALPHA)', 1, 0.24);
  chevStack(0.118, 0.222, 0.034, 3, 'rgba(110,198,132,ALPHA)', 1, 0.24);

  // --- 4. mid-field mission panels --------------------------------
  printBlock(
    [[-0.276, 0.612], [-0.196, 0.628], [-0.182, 0.452], [-0.268, 0.436]],
    'rgba(196,58,38,0.74)',
    'rgba(74,20,12,0.74)',
    1.55
  );
  printBlock(
    [[0.244, 0.612], [0.164, 0.628], [0.150, 0.452], [0.236, 0.436]],
    'rgba(78,116,148,0.74)',
    'rgba(20,34,50,0.74)',
    1.55
  );
  stencilText(p, 'FUEL', -0.228, 0.560, 0.0148, {
    rot: -Math.PI / 2,
    fill: '#f4eae6',
    letterSpacing: 0.003,
    stroke: 'rgba(8,10,20,0.9)',
    strokeW: 0.05,
    shadow: false,
  });
  stencilText(p, 'CORE', 0.196, 0.560, 0.0148, {
    rot: Math.PI / 2,
    fill: '#e6eef4',
    letterSpacing: 0.003,
    stroke: 'rgba(8,10,20,0.9)',
    strokeW: 0.05,
    shadow: false,
  });

  // --- 5. sunburst behind the bumper nest -------------------------
  g.save();
  g.translate(p.X(-0.019), p.Y(0.78));
  g.globalAlpha = 0.30;
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * Math.PI * 2;
    const a1 = a0 + Math.PI / 24;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, p.S(0.262), a0, a1);
    g.closePath();
    g.fillStyle = i % 2 ? 'rgba(38,54,74,0.85)' : 'rgba(66,92,118,0.44)';
    g.fill();
  }
  g.restore();

  // --- 6. upper mission dial with hard ticks ----------------------
  g.save();
  g.translate(p.X(-0.019), p.Y(0.78));
  g.strokeStyle = 'rgba(7,11,17,0.85)';
  g.lineWidth = p.S(0.0034);
  g.beginPath();
  g.arc(0, 0, p.S(0.212), 0, 7);
  g.stroke();
  g.strokeStyle = 'rgba(240,232,214,0.9)';
  g.lineWidth = p.S(0.0022);
  g.beginPath();
  g.arc(0, 0, p.S(0.198), 0, 7);
  g.stroke();
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const big = i % 3 === 0;
    g.strokeStyle = big ? 'rgba(255,196,92,0.95)' : 'rgba(176,196,214,0.55)';
    g.lineWidth = p.S(big ? 0.0032 : 0.0014);
    g.beginPath();
    g.moveTo(Math.cos(a) * p.S(0.198), Math.sin(a) * p.S(0.198));
    g.lineTo(Math.cos(a) * p.S(big ? 0.176 : 0.186), Math.sin(a) * p.S(big ? 0.176 : 0.186));
    g.stroke();
  }
  g.restore();

  // --- 7. bold numerals in the orbit corridors ---------------------
  const bigNum = (txt, x, y, sz, col, rot) => {
    stencilText(p, txt, x, y, sz, {
      rot,
      fill: col,
      letterSpacing: 0.004,
      stroke: 'rgba(7,11,17,0.92)',
      strokeW: 0.07,
      shadow: false,
    });
  };
  bigNum('01', -0.257, 0.470, 0.026, 'rgba(255,196,92,0.85)', -Math.PI / 2);
  bigNum('02', 0.214, 0.470, 0.026, 'rgba(206,222,236,0.85)', Math.PI / 2);
  bigNum('03', -0.252, 0.872, 0.026, 'rgba(214,90,62,0.82)', -Math.PI / 2);
  bigNum('04', 0.222, 0.872, 0.026, 'rgba(122,196,142,0.80)', Math.PI / 2);

  // --- 8. top-lane divider stripes --------------------------------
  for (let i = 0; i < 4; i++) {
    const cx = (L.laneGuideX[i] + L.laneGuideX[i + 1]) / 2;
    printBlock(
      [[cx - 0.020, 0.968], [cx + 0.020, 0.968], [cx + 0.020, 0.926], [cx - 0.020, 0.926]],
      i % 2 ? 'rgba(255,178,44,0.58)' : 'rgba(180,200,216,0.50)',
      'rgba(10,15,22,0.58)',
      1.57
    );
  }

  // --- 9. slingshot flash panels ----------------------------------
  printBlock(
    [[-0.196, 0.300], [-0.128, 0.256], [-0.150, 0.196], [-0.208, 0.236]],
    'rgba(255,196,52,0.70)',
    'rgba(190,66,28,0.70)',
    0.7
  );
  printBlock(
    [[0.162, 0.300], [0.094, 0.256], [0.116, 0.196], [0.174, 0.236]],
    'rgba(255,196,52,0.70)',
    'rgba(190,66,28,0.70)',
    2.4
  );

  /* ---- fine print / grid technical detail ------------------------ */
  g.save();
  g.globalAlpha = 0.16;
  g.strokeStyle = '#9fb6c8';
  g.lineWidth = p.S(0.0007);
  for (let x = -0.28; x < 0.29; x += 0.028) {
    g.beginPath();
    g.moveTo(p.X(x), p.Y(0.02));
    g.lineTo(p.X(x), p.Y(1.09));
    g.stroke();
  }
  for (let y = 0.02; y < 1.1; y += 0.028) {
    g.beginPath();
    g.moveTo(p.X(-0.29), p.Y(y));
    g.lineTo(p.X(0.29), p.Y(y));
    g.stroke();
  }
  g.restore();

  /* ---- halftone screen print ------------------------------------- */
  g.save();
  g.globalAlpha = 0.11;
  g.globalCompositeOperation = 'overlay';
  const dot = p.S(0.0038);
  for (let y = 0; y < H; y += dot * 2) {
    for (let x = 0; x < W; x += dot * 2) {
      g.fillStyle = (x / (dot * 2) + y / (dot * 2)) % 2 < 1 ? '#ffffff' : '#000000';
      g.fillRect(x, y, dot, dot);
    }
  }
  g.restore();

  /* ---- wear: ball paths and scuffs -------------------------------- */
  g.save();
  g.globalCompositeOperation = 'screen';
  g.globalAlpha = 0.1;
  g.lineCap = 'round';
  for (let i = 0; i < 130; i++) {
    const x0 = -0.26 + rnd() * 0.5;
    const y0 = 0.05 + rnd() * 0.95;
    const a = rnd() * Math.PI * 2;
    const len = 0.02 + rnd() * 0.13;
    g.strokeStyle = `rgba(226,234,242,${0.1 + rnd() * 0.25})`;
    g.lineWidth = p.S(0.0006 + rnd() * 0.0016);
    g.beginPath();
    g.moveTo(p.X(x0), p.Y(y0));
    g.quadraticCurveTo(
      p.X(x0 + Math.cos(a) * len * 0.5 + (rnd() - 0.5) * 0.02),
      p.Y(y0 + Math.sin(a) * len * 0.5),
      p.X(x0 + Math.cos(a) * len),
      p.Y(y0 + Math.sin(a) * len)
    );
    g.stroke();
  }
  g.restore();

  // grime under the bumpers / around the drain
  g.save();
  g.globalCompositeOperation = 'multiply';
  for (const b of L.bumpers) {
    g.fillStyle = radial(g, p.X(b.x), p.Y(b.y), p.S(0.07), [
      [0, 'rgba(90,90,110,1)'],
      [0.6, 'rgba(180,180,200,1)'],
      [1, 'rgba(255,255,255,1)'],
    ]);
    g.beginPath();
    g.arc(p.X(b.x), p.Y(b.y), p.S(0.07), 0, 7);
    g.fill();
  }
  g.fillStyle = radial(g, p.X(-0.017), p.Y(0.06), p.S(0.14), [
    [0, 'rgba(178,178,192,1)'],
    [1, 'rgba(255,255,255,1)'],
  ]);
  g.fillRect(0, p.Y(0.2), W, H - p.Y(0.2));
  g.restore();

  // Baked light falloff. A machine is lit by a hood lamp over the upper
  // playfield plus the bulbs under the plastics, so the outer inches of the
  // board and the two bottom corners either side of the drain sit in real
  // shadow. Printing that falloff means the board still has dark corners for
  // the inserts, the chrome and the ball to read against no matter what the
  // 3D rig is doing, which is the difference between a lit object and a
  // uniformly bright decal.
  g.save();
  g.globalCompositeOperation = 'multiply';
  const vg = g.createRadialGradient(W * 0.5, H * 0.40, W * 0.16, W * 0.5, H * 0.46, W * 1.02);
  vg.addColorStop(0, 'rgba(255,255,255,1)');
  vg.addColorStop(0.45, 'rgba(214,218,236,1)');
  vg.addColorStop(0.78, 'rgba(140,146,176,1)');
  vg.addColorStop(1, 'rgba(74,80,112,1)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);

  // down-table falloff: nothing lights the apron end of the board
  const dg = g.createLinearGradient(0, H * 0.62, 0, H);
  dg.addColorStop(0, 'rgba(255,255,255,1)');
  dg.addColorStop(0.62, 'rgba(208,212,232,1)');
  dg.addColorStop(1, 'rgba(150,155,186,1)');
  g.fillStyle = dg;
  g.fillRect(0, H * 0.62, W, H * 0.38);

  // hard shadow gutters down both side rails
  for (const [x0, x1] of [[0, W * 0.085], [W * 0.915, W]]) {
    const sg = g.createLinearGradient(x0, 0, x1, 0);
    const a = x0 === 0 ? ['rgba(58,62,92,1)', 'rgba(255,255,255,1)'] : ['rgba(255,255,255,1)', 'rgba(58,62,92,1)'];
    sg.addColorStop(0, a[0]);
    sg.addColorStop(1, a[1]);
    g.fillStyle = sg;
    g.fillRect(x0, 0, x1 - x0, H);
  }
  g.restore();

  return { canvas: c, inserts, W, H };
}

/* ------------------------------------------------------------------ */
/* General-illumination emissive map                                   */
/* ------------------------------------------------------------------ */

/**
 * The pools of light thrown by the GI bulbs under the plastics, baked into an
 * emissive map that is modulated by the print itself. This is what makes a
 * real machine glow from within: the artwork lights up in warm and cool
 * patches rather than being lit purely from a single overhead hood. It is
 * also the only way to get that read on the software rasteriser, where every
 * real point light has to be switched off to keep the frame rate.
 */
export function makePlayfieldGI(art) {
  const W = art.W;
  const H = art.H;
  const c = mkCanvas(W, H);
  const g = c.getContext('2d');
  const p = new Painter(g, W, H);

  g.fillStyle = '#000000';
  g.fillRect(0, 0, W, H);

  g.globalCompositeOperation = 'lighter';
  const pools = [
    // x, y, radius, colour, peak. Space Cadet's GI is warm incandescent —
    // amber and cream bulbs under the plastics with a few red and green
    // feature lamps. No cyan, no magenta: those are the arcade signature we
    // are deliberately not using.
    [-0.205, 0.300, 0.200, [255, 152, 56], 1.15],
    [0.180, 0.300, 0.195, [255, 176, 96], 1.10],
    [-0.019, 0.170, 0.215, [255, 168, 78], 0.98],
    [-0.235, 0.560, 0.185, [255, 138, 46], 1.00],
    [0.215, 0.560, 0.180, [186, 208, 226], 0.86],
    [-0.019, 0.400, 0.250, [214, 92, 52], 0.72],
    [-0.019, 0.075, 0.180, [255, 196, 128], 0.72],
    // slingshot / inlane lamps: the flipper zone is the closest thing to the
    // lens in the hero framing and it cannot be a dead grey shelf
    [-0.196, 0.205, 0.115, [255, 150, 66], 0.95],
    [0.162, 0.205, 0.115, [255, 150, 66], 0.92],
    [-0.105, 0.120, 0.098, [255, 214, 150], 0.66],
    [0.071, 0.120, 0.098, [255, 214, 150], 0.66],
    [0.253, 0.420, 0.130, [255, 196, 110], 0.72],
    [-0.019, 0.735, 0.250, [176, 200, 220], 0.52],
    [-0.019, 0.960, 0.220, [150, 180, 206], 0.40],
    [-0.019, 1.070, 0.200, [120, 152, 182], 0.30],
  ];
  for (const [x, y, r, [cr, cg, cb], a] of pools) {
    const px = p.X(x);
    const py = p.Y(y);
    const pr = p.S(r);
    g.fillStyle = radial(g, px, py, pr, [
      [0, `rgba(${cr},${cg},${cb},${a})`],
      [0.42, `rgba(${cr},${cg},${cb},${a * 0.46})`],
      [1, `rgba(${cr},${cg},${cb},0)`],
    ]);
    g.beginPath();
    g.arc(px, py, pr, 0, 7);
    g.fill();
  }
  // a low even floor so no corner of the print goes fully dead
  g.fillStyle = 'rgba(126,142,164,0.09)';
  g.fillRect(0, 0, W, H);

  // modulate by the print so the glow carries the artwork's own colour and
  // the keylines stay black instead of being flooded
  g.globalCompositeOperation = 'multiply';
  g.drawImage(art.canvas, 0, 0, W, H);

  return c;
}

/* ------------------------------------------------------------------ */
/* Height → normal + roughness                                         */
/* ------------------------------------------------------------------ */

export function makePlayfieldMaps(art, res = 1024) {
  const W = res;
  const H = Math.round(res * ART_ASPECT);

  // --- height field --------------------------------------------------
  const hc = mkCanvas(W, H);
  const hg = hc.getContext('2d');
  const hp = new Painter(hg, W, H);
  hg.fillStyle = '#808080';
  hg.fillRect(0, 0, W, H);
  const rnd = makeRng(0x5eed);

  // Clearcoat "orange peel" — the real surface texture of a coated playfield.
  // (Wood grain must NOT show through: the board is printed and cleared, and
  // grain in the normal map reads as bare plywood under a raking key light.)
  hg.save();
  hg.globalAlpha = 0.5;
  for (let i = 0; i < 340; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = (6 + rnd() * 26) * (W / 1024);
    const v = 128 + (rnd() - 0.5) * 9;
    hg.fillStyle = radial(hg, x, y, r, [
      [0, `rgba(${v | 0},${v | 0},${v | 0},0.5)`],
      [1, 'rgba(128,128,128,0)'],
    ]);
    hg.beginPath();
    hg.arc(x, y, r, 0, 7);
    hg.fill();
  }
  hg.restore();

  // a whisper of directional grain so the surface isn't perfectly uniform
  hg.save();
  hg.globalAlpha = 0.08;
  for (let i = 0; i < 160; i++) {
    const y = rnd() * H;
    hg.strokeStyle = `rgba(${128 + (rnd() - 0.5) * 8 | 0},128,128,0.4)`;
    hg.lineWidth = 0.6 + rnd() * 1.2;
    hg.beginPath();
    hg.moveTo(0, y);
    hg.bezierCurveTo(W * 0.3, y + (rnd() - 0.5) * 12, W * 0.7, y + (rnd() - 0.5) * 12, W, y + (rnd() - 0.5) * 8);
    hg.stroke();
  }
  hg.restore();

  // inserts sit a hair below the surface → dark
  for (const ins of art.inserts) {
    hg.save();
    hg.translate(hp.X(ins.x), hp.Y(ins.y));
    hg.rotate(-(ins.rot || 0));
    hg.fillStyle = '#5a5a5a';
    if (ins.shape === 'arrow') arrowPath(hg, 0, 0, hp.S(ins.w), hp.S(ins.h), 0);
    else roundRectPath(hg, -hp.S(ins.w) / 2, -hp.S(ins.h) / 2, hp.S(ins.w), hp.S(ins.h), hp.S(0.005));
    hg.fill();
    hg.lineWidth = 2.5;
    hg.strokeStyle = '#a0a0a0';
    hg.stroke();
    hg.restore();
  }

  // screw heads
  const screws = [
    [-0.275, 0.06], [0.275, 0.06], [-0.275, 0.6], [0.288, 0.6],
    [-0.275, 1.05], [0.275, 1.05], [-0.05, 1.06], [0.05, 1.06],
  ];
  for (const [x, y] of screws) {
    const cx = hp.X(x);
    const cy = hp.Y(y);
    const r = hp.S(0.005);
    hg.fillStyle = '#6a6a6a';
    hg.beginPath();
    hg.arc(cx, cy, r, 0, 7);
    hg.fill();
    hg.strokeStyle = '#a8a8a8';
    hg.lineWidth = 2;
    hg.stroke();
  }

  const hd = hg.getImageData(0, 0, W, H).data;

  // --- normal map via sobel -----------------------------------------
  const nc = mkCanvas(W, H);
  const ng = nc.getContext('2d');
  const nimg = ng.createImageData(W, H);
  const nd = nimg.data;
  const at = (x, y) => hd[((Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) << 2)] / 255;
  const strength = 1.5;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) -
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));
      let nx = dx * strength;
      let ny = dy * strength;
      const nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * W + x) << 2;
      nd[i] = ((nx / l) * 0.5 + 0.5) * 255;
      nd[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      nd[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      nd[i + 3] = 255;
    }
  }
  ng.putImageData(nimg, 0, 0);

  // --- roughness: clearcoat wear -------------------------------------
  const rc = mkCanvas(W, H);
  const rg = rc.getContext('2d');
  const rp = new Painter(rg, W, H);
  // The printed base layer is matte — all the gloss comes from the clearcoat
  // above it. A glossy base *and* a glossy coat double the specular and haze
  // the art out to beige.
  rg.fillStyle = '#8c8c8c';
  rg.fillRect(0, 0, W, H);
  const r2 = makeRng(0xbeef);
  rg.save();
  rg.globalAlpha = 0.55;
  for (let i = 0; i < 420; i++) {
    const x = r2() * W;
    const y = r2() * H;
    const r = (10 + r2() * 90) * (W / 1024);
    rg.fillStyle = radial(rg, x, y, r, [
      [0, `rgba(190,190,190,${0.12 + r2() * 0.3})`],
      [1, 'rgba(0,0,0,0)'],
    ]);
    rg.beginPath();
    rg.arc(x, y, r, 0, 7);
    rg.fill();
  }
  rg.restore();
  // ball tracks polish the clearcoat (smoother)
  rg.save();
  rg.globalAlpha = 0.5;
  rg.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const x0 = -0.26 + r2() * 0.5;
    const y0 = 0.05 + r2() * 0.95;
    const a = r2() * Math.PI * 2;
    const len = 0.03 + r2() * 0.15;
    rg.strokeStyle = 'rgba(10,10,10,0.5)';
    rg.lineWidth = rp.S(0.0016 + r2() * 0.0032);
    rg.beginPath();
    rg.moveTo(rp.X(x0), rp.Y(y0));
    rg.lineTo(rp.X(x0 + Math.cos(a) * len), rp.Y(y0 + Math.sin(a) * len));
    rg.stroke();
  }
  rg.restore();
  // inserts are glassier
  for (const ins of art.inserts) {
    rg.save();
    rg.translate(rp.X(ins.x), rp.Y(ins.y));
    rg.rotate(-(ins.rot || 0));
    rg.fillStyle = '#3a3a3a';
    if (ins.shape === 'arrow') arrowPath(rg, 0, 0, rp.S(ins.w), rp.S(ins.h), 0);
    else roundRectPath(rg, -rp.S(ins.w) / 2, -rp.S(ins.h) / 2, rp.S(ins.w), rp.S(ins.h), rp.S(0.005));
    rg.fill();
    rg.restore();
  }

  return { normal: nc, rough: rc };
}

/* ------------------------------------------------------------------ */

export function canvasTexture(canvas, { srgb = false, aniso = 8, renderer = null } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = renderer ? Math.min(aniso, renderer.capabilities.getMaxAnisotropy()) : aniso;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------------ */
/* Cabinet side art + apron                                            */
/* ------------------------------------------------------------------ */

export function makeSideArt(w = 1024) {
  const h = Math.round(w * 0.34);
  const c = mkCanvas(w, h);
  const g = c.getContext('2d');
  const rnd = makeRng(0x51de);
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#0a1018');
  bg.addColorStop(0.4, '#131f2c');
  bg.addColorStop(0.7, '#1b2c3c');
  bg.addColorStop(1, '#070c13');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const p = new Painter(g, w, h);
  nebula(p, rnd, w * 0.5, h * 0.5, w * 0.5, 208, 0.30);
  starfield(p, rnd, 460, 1.6, 0.80);

  // streaking comet
  g.save();
  g.globalCompositeOperation = 'screen';
  const cg = g.createLinearGradient(w * 0.08, h * 0.75, w * 0.72, h * 0.2);
  cg.addColorStop(0, 'rgba(255,120,40,0)');
  cg.addColorStop(0.6, 'rgba(255,170,60,0.55)');
  cg.addColorStop(1, 'rgba(255,245,210,0.95)');
  g.strokeStyle = cg;
  g.lineWidth = h * 0.05;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(w * 0.08, h * 0.78);
  g.quadraticCurveTo(w * 0.4, h * 0.62, w * 0.72, h * 0.2);
  g.stroke();
  g.restore();

  g.save();
  g.translate(w * 0.5, h * 0.55);
  g.rotate(-0.06);
  g.font = `900 ${h * 0.32}px "Arial Black", Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.letterSpacing = `${h * 0.02}px`;
  const tg = g.createLinearGradient(-w * 0.3, 0, w * 0.3, 0);
  tg.addColorStop(0, '#ffdc78');
  tg.addColorStop(0.5, '#ffa326');
  tg.addColorStop(1, '#d2481d');
  g.shadowColor = 'rgba(255,140,50,0.75)';
  g.shadowBlur = h * 0.14;
  g.fillStyle = tg;
  g.fillText('NOVA', 0, 0);
  g.shadowBlur = 0;
  g.lineWidth = h * 0.009;
  g.strokeStyle = 'rgba(226,236,244,0.65)';
  g.strokeText('NOVA', 0, 0);
  g.font = `700 ${h * 0.082}px "Helvetica Neue", Arial, sans-serif`;
  g.letterSpacing = `${h * 0.028}px`;
  g.fillStyle = 'rgba(206,222,236,0.9)';
  g.shadowBlur = 0;
  g.fillText('SPACE CADET', 0, h * 0.24, w * 0.62);
  g.restore();
  return c;
}

export function makeBackglass(w = 1024) {
  const h = Math.round(w * 0.78);
  const c = mkCanvas(w, h);
  const g = c.getContext('2d');
  const p = new Painter(g, w, h);
  const rnd = makeRng(0xba0);
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#03050a');
  bg.addColorStop(0.45, '#08121f');
  bg.addColorStop(1, '#0b1520');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  nebula(p, rnd, w * 0.5, h * 0.42, w * 0.62, 206, 0.34);
  nebula(p, rnd, w * 0.2, h * 0.7, w * 0.4, 24, 0.16);
  starfield(p, rnd, 1100, 2.0, 1);
  planet(p, rnd, w * 0.78, h * 0.72, w * 0.17, 30, true);

  // hero ship silhouette
  g.save();
  g.translate(w * 0.32, h * 0.62);
  g.rotate(-0.35);
  g.scale(w / 1024, w / 1024);
  const shipGrad = g.createLinearGradient(-160, -40, 160, 60);
  shipGrad.addColorStop(0, '#e8f2ff');
  shipGrad.addColorStop(0.5, '#8ba4c8');
  shipGrad.addColorStop(1, '#2a3350');
  g.fillStyle = shipGrad;
  g.beginPath();
  g.moveTo(180, 0);
  g.lineTo(40, -34);
  g.lineTo(-90, -26);
  g.lineTo(-140, -58);
  g.lineTo(-160, -50);
  g.lineTo(-120, -18);
  g.lineTo(-160, 0);
  g.lineTo(-120, 18);
  g.lineTo(-160, 50);
  g.lineTo(-140, 58);
  g.lineTo(-90, 26);
  g.lineTo(40, 34);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(176,202,224,0.85)';
  g.lineWidth = 3;
  g.stroke();
  // engine glow
  g.globalCompositeOperation = 'screen';
  g.fillStyle = radial(g, -170, 0, 120, [
    [0, 'rgba(255,228,170,0.95)'],
    [0.3, 'rgba(255,150,50,0.5)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  g.beginPath();
  g.arc(-170, 0, 120, 0, 7);
  g.fill();
  g.restore();

  // title
  g.save();
  g.translate(w * 0.5, h * 0.2);
  g.font = `900 ${h * 0.2}px "Arial Black", Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.letterSpacing = `${h * 0.035}px`;
  const tg = g.createLinearGradient(-w * 0.35, 0, w * 0.35, 0);
  tg.addColorStop(0, '#ffe27a');
  tg.addColorStop(0.4, '#ffa728');
  tg.addColorStop(0.75, '#e2601f');
  tg.addColorStop(1, '#b8371f');
  g.shadowColor = 'rgba(255,140,50,0.75)';
  g.shadowBlur = h * 0.09;
  g.fillStyle = tg;
  g.fillText('NOVA', 0, 0);
  g.shadowBlur = 0;
  g.lineWidth = h * 0.008;
  g.strokeStyle = 'rgba(226,236,244,0.85)';
  g.strokeText('NOVA', 0, 0);
  g.font = `800 ${h * 0.052}px "Helvetica Neue", Arial, sans-serif`;
  g.letterSpacing = `${h * 0.022}px`;
  g.fillStyle = '#cfdeea';
  g.fillText('S P A C E   C A D E T', 0, h * 0.135, w * 0.62);
  g.restore();

  // bottom bar -- kept clear of the DMD bezel that sits below the glass, so the
  // model badge is set high enough never to collide with the display
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(0, h * 0.80, w, h * 0.075);
  g.font = `700 ${h * 0.042}px "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(186,206,224,0.8)';
  g.letterSpacing = `${h * 0.018}px`;
  g.fillText('ORBITAL DEFENCE COMMAND \u2022 MODEL ND-7', w * 0.5, h * 0.8375, w * 0.86);
  return c;
}

/**
 * Apron art: the printed steel plate in front of the flippers carrying the
 * instruction cards and the model badge. Screen-printed on brushed stock.
 */
export function makeApronArt(w = 1024) {
  const h = Math.round(w * 0.22);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');

  // brushed dark steel base
  const base = g.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, '#171b25');
  base.addColorStop(0.45, '#0d1119');
  base.addColorStop(1, '#05070c');
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.07;
  for (let i = 0; i < 900; i++) {
    const y = Math.random() * h;
    g.strokeStyle = Math.random() > 0.5 ? '#ffffff' : '#000000';
    g.lineWidth = Math.random() * 1.2;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y + (Math.random() - 0.5) * 3);
    g.stroke();
  }
  g.globalAlpha = 1;

  // instruction cards, left and right
  const card = (cx, cy, cw, ch, title, lines, accent) => {
    g.save();
    g.translate(cx, cy);
    g.fillStyle = '#c3ccda';
    g.strokeStyle = '#232a38';
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(-cw / 2, -ch / 2, cw, ch, 6);
    g.fill();
    g.stroke();
    g.fillStyle = accent;
    g.fillRect(-cw / 2, -ch / 2, cw, ch * 0.24);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#0b1018';
    g.font = `800 ${ch * 0.15}px "Helvetica Neue", Arial, sans-serif`;
    g.letterSpacing = `${ch * 0.03}px`;
    g.fillText(title, 0, -ch * 0.37, cw * 0.9);
    g.letterSpacing = '0px';
    g.fillStyle = '#1a2230';
    g.font = `600 ${ch * 0.115}px "Helvetica Neue", Arial, sans-serif`;
    lines.forEach((ln, i) => {
      g.fillText(ln, 0, -ch * 0.08 + i * ch * 0.185, cw * 0.9);
    });
    g.restore();
  };

  card(w * 0.16, h * 0.52, w * 0.215, h * 0.56, 'MISSION BRIEF', [
    'RAMPS LIGHT JACKPOT',
    'ORBIT x3 = WORMHOLE',
    'DROPS AWARD BONUS',
  ], '#e8a02c');
  card(w * 0.84, h * 0.52, w * 0.215, h * 0.56, 'FLIGHT RULES', [
    'TILT ENDS BALL',
    '3 BALLS PER GAME',
    'MATCH AWARDS CREDIT',
  ], '#5c8aa8');

  // centre badge
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffcf6a';
  g.font = `900 ${h * 0.26}px "Helvetica Neue", Arial, sans-serif`;
  g.letterSpacing = `${h * 0.05}px`;
  g.shadowColor = 'rgba(255,180,60,0.6)';
  g.shadowBlur = h * 0.10;
  g.fillText('NOVA', w * 0.5, h * 0.40, w * 0.3);
  g.shadowBlur = 0;
  g.font = `700 ${h * 0.10}px "Helvetica Neue", Arial, sans-serif`;
  g.letterSpacing = `${h * 0.035}px`;
  g.fillStyle = '#9fb4c6';
  g.fillText('ORBITAL DEFENCE COMMAND', w * 0.5, h * 0.68, w * 0.32);

  g.fillStyle = 'rgba(6,9,16,0.30)';
  g.fillRect(0, 0, w, h);

  // hairline border + fastener holes
  g.strokeStyle = 'rgba(255,255,255,0.16)';
  g.lineWidth = 2;
  g.strokeRect(4, 4, w - 8, h - 8);
  for (const fx of [0.04, 0.5, 0.96]) {
    g.fillStyle = '#05070b';
    g.beginPath();
    g.arc(w * fx, h * 0.14, h * 0.045, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/**
 * Screen-printed plastic: the translucent coloured canopies that sit on posts
 * above the playfield. Real ones are printed with line-work and a label, and
 * the print is what stops them reading as flat coloured card.
 */
export function makePlasticArt(hex, label, res = 512) {
  const c = document.createElement('canvas');
  c.width = res;
  c.height = res;
  const g = c.getContext('2d');
  const col = '#' + hex.toString(16).padStart(6, '0');

  const grd = g.createLinearGradient(0, 0, res, res);
  grd.addColorStop(0, col);
  grd.addColorStop(0.5, shade(col, 1.35));
  grd.addColorStop(1, shade(col, 0.62));
  g.fillStyle = grd;
  g.fillRect(0, 0, res, res);

  // starfield print under the graphics
  g.globalAlpha = 0.5;
  for (let i = 0; i < 260; i++) {
    g.fillStyle = Math.random() > 0.6 ? '#ffffff' : '#0a0d16';
    const r = Math.random() * 2.2 + 0.4;
    g.beginPath();
    g.arc(Math.random() * res, Math.random() * res, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  // concentric mission rings
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  for (let i = 1; i <= 4; i++) {
    g.lineWidth = i === 2 ? 7 : 3;
    g.beginPath();
    g.arc(res * 0.34, res * 0.46, res * 0.09 * i, 0, Math.PI * 2);
    g.stroke();
  }
  // chevrons
  g.strokeStyle = 'rgba(10,12,20,0.7)';
  g.lineWidth = res * 0.035;
  for (let i = 0; i < 3; i++) {
    const x = res * (0.60 + i * 0.11);
    g.beginPath();
    g.moveTo(x, res * 0.22);
    g.lineTo(x + res * 0.09, res * 0.46);
    g.lineTo(x, res * 0.70);
    g.stroke();
  }
  // hard white border keyline, the classic plastics look
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = res * 0.045;
  g.strokeRect(res * 0.022, res * 0.022, res * 0.956, res * 0.956);

  if (label) {
    g.save();
    g.translate(res * 0.5, res * 0.84);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 ${res * 0.15}px "Helvetica Neue", Arial, sans-serif`;
    g.letterSpacing = `${res * 0.02}px`;
    g.lineWidth = res * 0.03;
    g.strokeStyle = 'rgba(8,10,18,0.85)';
    g.strokeText(label, 0, 0, res * 0.9);
    g.fillStyle = '#ffffff';
    g.fillText(label, 0, 0, res * 0.9);
    g.restore();
  }
  return c;
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const gg = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${gg},${b})`;
}

/* ------------------------------------------------------------------ */
/* Hangar deck floor — dark riveted steel plate. Tiles cleanly. The old
/* neon-confetti arcade carpet was exactly the nightclub signature this
/* re-theme is removing. */

export function makeArcadeCarpet(size = 1024, rng = Math.random) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const S = size;

  // gunmetal ground
  x.fillStyle = '#131920';
  x.fillRect(0, 0, S, S);
  const sheen = x.createLinearGradient(0, 0, S, S);
  sheen.addColorStop(0, 'rgba(150,175,200,0.05)');
  sheen.addColorStop(0.5, 'rgba(0,0,0,0.06)');
  sheen.addColorStop(1, 'rgba(150,175,200,0.04)');
  x.fillStyle = sheen;
  x.fillRect(0, 0, S, S);

  // 2x2 plates with recessed seams
  const N = 2;
  const P = S / N;
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const px = ix * P;
      const py = iy * P;
      const t = (rng() - 0.5) * 10;
      x.fillStyle = `rgba(${(34 + t) | 0},${(43 + t) | 0},${(54 + t) | 0},0.9)`;
      x.fillRect(px + 3, py + 3, P - 6, P - 6);
      x.fillStyle = 'rgba(4,7,11,0.85)';
      x.fillRect(px, py, P, 4);
      x.fillRect(px, py, 4, P);
      x.fillStyle = 'rgba(150,178,206,0.10)';
      x.fillRect(px + 4, py + 4, P - 8, 2);
    }
  }

  // rivets along the seams
  const rivet = (rx, ry, r) => {
    x.fillStyle = 'rgba(4,7,11,0.7)';
    x.beginPath(); x.arc(rx, ry + r * 0.5, r, 0, 7); x.fill();
    x.fillStyle = 'rgba(120,146,172,0.35)';
    x.beginPath(); x.arc(rx, ry, r * 0.85, 0, 7); x.fill();
  };
  const rr = S * 0.006;
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < 16; k++) {
      const f = (k + 0.5) / 16;
      rivet(i * P + 12, f * S, rr);
      rivet(f * S, i * P + 12, rr);
    }
  }

  // anti-slip tread dimples across each plate
  x.globalAlpha = 0.16;
  for (let iy = 0; iy < 46; iy++) {
    for (let ix = 0; ix < 46; ix++) {
      const px = (ix + 0.5) * (S / 46) + (iy % 2 ? S / 92 : 0);
      const py = (iy + 0.5) * (S / 46);
      x.fillStyle = '#9fb6c8';
      x.beginPath();
      x.arc(px, py, S * 0.0035, 0, 7);
      x.fill();
    }
  }
  x.globalAlpha = 1;

  // wear, oil stains and grime
  for (let i = 0; i < 300; i++) {
    const px = rng() * S;
    const py = rng() * S;
    const r = S * (0.01 + rng() * 0.06);
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(0,0,0,${0.06 + rng() * 0.14})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(px - r, py - r, r * 2, r * 2);
  }
  // faint yellow hazard stripe stencil, the one accent
  x.save();
  x.globalAlpha = 0.10;
  x.translate(S * 0.5, S * 0.5);
  x.rotate(-0.6);
  for (let i = -8; i < 8; i++) {
    x.fillStyle = i % 2 ? '#ffb02a' : '#0a0e14';
    x.fillRect(-S, i * S * 0.05, S * 2, S * 0.05);
  }
  x.restore();

  x.fillStyle = 'rgba(4,7,12,0.42)';
  x.fillRect(0, 0, S, S);
  return c;
}

/* ------------------------------------------------------------------ */
/* Hero-ball reflection probe.                                         */
/* The room PMREM is deliberately dark, which makes a chrome sphere     */
/* render near-black. The ball is the hero object, so it gets its own   */
/* brighter studio equirect: ceiling banks, neon strips, backglass      */
/* wash and a warm floor pool. Cheap (one 512x256 canvas) and it is     */
/* what makes the ball read as polished steel from any angle.           */

export function makeBallProbe(w = 512) {
  const h = w / 2;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');

  // A chrome sphere is a *mirror*: it reads as polished steel only when what
  // it mirrors has extreme contrast — a near-black room with a few hard,
  // very bright bars. A soft mid-grey probe makes the ball look like a
  // ping-pong ball, which is the classic amateur pinball tell.
  const base = g.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0.0, '#121821');
  base.addColorStop(0.30, '#26313e');
  base.addColorStop(0.50, '#151b24');
  base.addColorStop(0.62, '#2c3846');
  base.addColorStop(0.80, '#3a4756');
  base.addColorStop(1.0, '#161c25');
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);

  // ceiling light banks. Equirect compresses hard toward the pole, so any
  // full-width band up there wraps into a perfect bullseye and the ball reads
  // as a printed decal. Keep the pole as one broad soft cap and put the hard
  // sources lower, where they mirror as elongated streaks.
  {
    const cap = g.createRadialGradient(w * 0.5, 0, 0, w * 0.5, 0, h * 0.30);
    cap.addColorStop(0.0, 'rgba(226,236,255,0.55)');
    cap.addColorStop(0.45, 'rgba(150,168,205,0.18)');
    cap.addColorStop(1.0, 'rgba(120,140,180,0)');
    g.fillStyle = cap;
    g.fillRect(0, 0, w, h * 0.32);
  }
  const bars = [
    [0.215, 0.10, 0.34, 1.0],
    [0.215, 0.62, 0.24, 0.95],
    [0.300, 0.02, 0.20, 0.95],
    [0.300, 0.40, 0.30, 0.85],
    [0.300, 0.80, 0.16, 0.75],
    [0.385, 0.24, 0.18, 0.68],
    [0.150, 0.44, 0.22, 0.9],
    [0.470, 0.68, 0.20, 0.5],
  ];
  for (const [fy, fx, fw, peak] of bars) {
    const y = h * fy;
    const halo = h * 0.032;
    const gr = g.createLinearGradient(0, y - halo, 0, y + halo);
    gr.addColorStop(0.0, 'rgba(255,248,232,0)');
    gr.addColorStop(0.40, `rgba(255,248,232,${peak * 0.22})`);
    gr.addColorStop(0.5, `rgba(255,253,246,${peak})`);
    gr.addColorStop(0.60, `rgba(255,248,232,${peak * 0.22})`);
    gr.addColorStop(1.0, 'rgba(255,248,232,0)');
    g.fillStyle = gr;
    g.fillRect(w * fx, y - halo, w * fw, halo * 2);
  }

  // neon wall strips — coloured accents. Kept modest: the ball must read
  // as steel first and pick up colour second.
  const strips = [
    [0.40, 'rgba(255,186,110,0.66)'],
    [0.445, 'rgba(196,214,232,0.62)'],
    [0.355, 'rgba(214,110,70,0.48)'],
    [0.615, 'rgba(150,178,204,0.40)'],
  ];
  for (const [fy, col] of strips) {
    const y = h * fy;
    const gr = g.createLinearGradient(0, y - h * 0.018, 0, y + h * 0.018);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(0.42, col.replace(/[\d.]+\)$/, '0.25)'));
    gr.addColorStop(0.5, col);
    gr.addColorStop(0.58, col.replace(/[\d.]+\)$/, '0.25)'));
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, y - h * 0.02, w, h * 0.04);
  }

  // backglass wash: one big warm blob the ball catches as a broad highlight
  const blob = (cx, cy, r, col, a) => {
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, col.replace('%A%', a));
    gr.addColorStop(1, col.replace('%A%', '0'));
    g.fillStyle = gr;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  blob(w * 0.5, h * 0.33, w * 0.16, 'rgba(255,226,190,%A%)', '0.7');
  blob(w * 0.14, h * 0.40, w * 0.10, 'rgba(186,208,230,%A%)', '0.42');
  blob(w * 0.84, h * 0.41, w * 0.10, 'rgba(255,178,110,%A%)', '0.32');

  // ---- lower hemisphere: the playfield the ball is sitting on ----------
  // A chrome ball over a lit playfield picks up the printed art and the
  // insert lamps underneath it. Leaving this half black is the single
  // biggest "plastic marble" tell.
  // Kept deliberately desaturated: a real chrome ball mirrors the playfield
  // as a dim, dark, mostly-neutral field. Push the chroma up here and the
  // ball turns into an iridescent soap bubble instead of polished steel.
  const pf = g.createLinearGradient(0, h * 0.52, 0, h);
  pf.addColorStop(0.0, 'rgba(52,58,70,0)');
  pf.addColorStop(0.22, 'rgba(58,66,80,0.74)');
  pf.addColorStop(0.52, 'rgba(70,80,96,0.88)');
  pf.addColorStop(0.78, 'rgba(28,33,42,0.94)');
  pf.addColorStop(1.0, 'rgba(6,8,11,0.98)');
  g.fillStyle = pf;
  g.fillRect(0, h * 0.52, w, h * 0.48);

  // GI strips under the plastics: hard, bright, horizontal. Without a few
  // crisp bright edges below the equator the ball's lower half turns into a
  // soft violet wash and reads as painted plastic instead of steel.
  for (const [fy, fx, fw, peak, col] of [
    [0.585, 0.02, 0.36, 0.95, '255,246,224'],
    [0.585, 0.56, 0.30, 0.8, '255,246,224'],
    [0.665, 0.30, 0.26, 0.7, '236,244,255'],
    [0.735, 0.00, 0.22, 0.55, '255,228,196'],
    [0.735, 0.68, 0.26, 0.6, '255,228,196'],
  ]) {
    const y = h * fy;
    const halo = h * 0.022;
    const gr = g.createLinearGradient(0, y - halo, 0, y + halo);
    gr.addColorStop(0.0, `rgba(${col},0)`);
    gr.addColorStop(0.42, `rgba(${col},${peak * 0.28})`);
    gr.addColorStop(0.5, `rgba(${col},${peak})`);
    gr.addColorStop(0.58, `rgba(${col},${peak * 0.28})`);
    gr.addColorStop(1.0, `rgba(${col},0)`);
    g.fillStyle = gr;
    g.fillRect(w * fx, y - halo, w * fw, halo * 2);
  }

  // insert lamps mirrored in the underside — small hot coloured pools.
  // Small and comparatively dim: they are accents on a steel mirror, not
  // the dominant colour of the ball.
  for (const [fx, fy, r, col, a] of [
    [0.18, 0.70, 0.045, 'rgba(226,88,58,%A%)', '0.58'],
    [0.42, 0.82, 0.050, 'rgba(255,196,110,%A%)', '0.58'],
    [0.66, 0.68, 0.042, 'rgba(255,210,120,%A%)', '0.55'],
    [0.88, 0.79, 0.046, 'rgba(186,208,230,%A%)', '0.46'],
    [0.05, 0.90, 0.040, 'rgba(120,196,140,%A%)', '0.42'],
    [0.74, 0.94, 0.044, 'rgba(255,170,120,%A%)', '0.38'],
  ]) {
    blob(w * fx, h * fy, w * r, col, a);
  }

  // the table's own horizon: the dark rail band just below the equator
  const hz = g.createLinearGradient(0, h * 0.495, 0, h * 0.565);
  hz.addColorStop(0, 'rgba(0,0,0,0)');
  hz.addColorStop(0.45, 'rgba(0,0,0,0.82)');
  hz.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = hz;
  g.fillRect(0, h * 0.495, w, h * 0.07);

  // a couple of hard specular pips so there is always a hotspot
  for (const [fx, fy, r, a] of [
    [0.30, 0.20, 0.016, 1.0],
    [0.68, 0.17, 0.013, 0.9],
    [0.48, 0.27, 0.020, 0.8],
  ]) {
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.beginPath();
    g.arc(w * fx, h * fy, w * r, 0, 7);
    g.fill();
  }
  return c;
}

/* ------------------------------------------------------------------ */
/* target faces — printed drop-target / standup decals                 */
/* ------------------------------------------------------------------ */

export function makeTargetFace(hex, label, res = 256) {
  const c = document.createElement('canvas');
  c.width = res;
  c.height = Math.round(res * 0.55);
  const g = c.getContext('2d');
  const h = c.height;
  const col = '#' + hex.toString(16).padStart(6, '0');

  // base colour with a vertical moulding gradient
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, shade(col, 1.32));
  bg.addColorStop(0.42, col);
  bg.addColorStop(1, shade(col, 0.55));
  g.fillStyle = bg;
  g.fillRect(0, 0, res, h);

  // screen-printed white band + black keyline
  g.fillStyle = 'rgba(255,255,255,0.93)';
  g.fillRect(res * 0.06, h * 0.24, res * 0.88, h * 0.52);
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.lineWidth = Math.max(2, res * 0.014);
  g.strokeRect(res * 0.06, h * 0.24, res * 0.88, h * 0.52);

  // label
  g.fillStyle = '#0b0e15';
  g.font = `900 ${Math.round(h * 0.40)}px "Arial Black", Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const m = g.measureText(label).width;
  const max = res * 0.78;
  if (m > max) g.setTransform(max / m, 0, 0, 1, res * 0.5 * (1 - max / m), 0);
  g.fillText(label, res * 0.5, h * 0.51);
  g.setTransform(1, 0, 0, 1, 0, 0);

  // top bevel highlight + bottom shadow
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(0, 0, res, Math.max(1, h * 0.05));
  g.fillStyle = 'rgba(0,0,0,0.42)';
  g.fillRect(0, h - Math.max(1, h * 0.09), res, h);

  // scuffs
  for (let i = 0; i < 26; i++) {
    g.globalAlpha = 0.03 + Math.random() * 0.06;
    g.fillStyle = Math.random() < 0.5 ? '#000' : '#fff';
    g.fillRect(Math.random() * res, Math.random() * h, 1 + Math.random() * 10, 1);
  }
  g.globalAlpha = 1;
  return c;
}

/**
 * Pop-bumper cap. Mapped round the lathe, so u runs around the cap and v runs
 * from the crown down to the skirt: the art has to be built as horizontal
 * bands, not a top-down disc.
 */
export function makeBumperCapArt(hex, res = 512) {
  const c = document.createElement('canvas');
  c.width = res;
  c.height = res / 2;
  const g = c.getContext('2d');
  const W = c.width;
  const H = c.height;
  const col = '#' + hex.toString(16).padStart(6, '0');

  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, shade(col, 1.5));
  grd.addColorStop(0.42, col);
  grd.addColorStop(1, shade(col, 0.5));
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);

  // screened band round the shoulder
  g.fillStyle = 'rgba(8,10,20,0.85)';
  g.fillRect(0, H * 0.50, W, H * 0.17);
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.fillRect(0, H * 0.485, W, H * 0.012);
  g.fillRect(0, H * 0.675, W, H * 0.012);

  // repeating chevrons + label round the band
  g.save();
  g.beginPath();
  g.rect(0, H * 0.50, W, H * 0.17);
  g.clip();
  g.strokeStyle = 'rgba(255,255,255,0.30)';
  g.lineWidth = H * 0.016;
  for (let i = 0; i < 24; i++) {
    const x = (i / 24) * W;
    g.beginPath();
    g.moveTo(x, H * 0.50);
    g.lineTo(x + W * 0.018, H * 0.585);
    g.lineTo(x, H * 0.67);
    g.stroke();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.font = `900 ${H * 0.11}px "Arial Black", Impact, sans-serif`;
  g.letterSpacing = `${H * 0.03}px`;
  for (let i = 0; i < 4; i++) g.fillText('NOVA', W * (0.125 + i * 0.25), H * 0.585);
  g.restore();

  // crown starburst
  g.save();
  g.globalAlpha = 0.5;
  g.strokeStyle = '#ffffff';
  g.lineWidth = H * 0.01;
  for (let i = 0; i < 32; i++) {
    const x = (i / 32) * W;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H * 0.30 * (i % 2 ? 0.5 : 1));
    g.stroke();
  }
  g.restore();

  // moulding wear
  g.globalAlpha = 0.12;
  for (let i = 0; i < 200; i++) {
    g.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
    g.fillRect(Math.random() * W, Math.random() * H, Math.random() * 14, 1);
  }
  g.globalAlpha = 1;
  return c;
}

/* ------------------------------------------------------------------ */
/* ramp bed decal — the printed runway graphic on a moulded ramp        */
/* UVs run u across the width, v from entry (0) to exit (1).           */
/* ------------------------------------------------------------------ */

export function makeRampArt(hex, label = 'RAMP', res = 256) {
  const W = res;
  const H = res * 4;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const col = `#${(hex >>> 0).toString(16).padStart(6, '0')}`;

  g.fillStyle = '#05070e';
  g.fillRect(0, 0, W, H);

  // longitudinal tint gradient — hot at the exit, cool at the entry
  const lg = g.createLinearGradient(0, 0, 0, H);
  lg.addColorStop(0.0, 'rgba(6,10,20,1)');
  lg.addColorStop(0.35, 'rgba(12,20,40,1)');
  lg.addColorStop(1.0, 'rgba(4,6,14,1)');
  g.fillStyle = lg;
  g.fillRect(0, 0, W, H);

  // edge safety stripes
  const edge = W * 0.085;
  for (const x of [0, W - edge]) {
    g.fillStyle = col;
    g.globalAlpha = 0.9;
    g.fillRect(x, 0, edge, H);
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(x + (x === 0 ? edge - 3 : 0), 0, 3, H);
  }

  // hazard dashes inside the stripes
  g.fillStyle = 'rgba(0,0,0,0.45)';
  for (let y = 0; y < H; y += 34) {
    g.fillRect(0, y, edge, 14);
    g.fillRect(W - edge, y + 17, edge, 14);
  }

  // centre channel
  const cg = g.createLinearGradient(edge, 0, W - edge, 0);
  cg.addColorStop(0, 'rgba(255,255,255,0.10)');
  cg.addColorStop(0.5, 'rgba(255,255,255,0.02)');
  cg.addColorStop(1, 'rgba(255,255,255,0.10)');
  g.fillStyle = cg;
  g.fillRect(edge, 0, W - edge * 2, H);

  // directional chevrons pointing toward the exit
  const cw = W * 0.62;
  const cx = W / 2;
  for (let i = 0; i < 13; i++) {
    const y = H * 0.06 + i * H * 0.068;
    const a = 0.16 + (i / 13) * 0.5;
    g.strokeStyle = col;
    g.globalAlpha = a;
    g.lineWidth = W * 0.05;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(cx - cw / 2, y + W * 0.13);
    g.lineTo(cx, y);
    g.lineTo(cx + cw / 2, y + W * 0.13);
    g.stroke();
  }
  g.globalAlpha = 1;

  // lettering, repeated down the run, rotated to read along the ramp
  g.save();
  g.translate(cx, H * 0.5);
  g.rotate(-Math.PI / 2);
  g.font = `700 ${Math.round(W * 0.20)}px "Eurostile","Bahnschrift","Arial Narrow",sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,0.72)';
  g.letterSpacing = `${Math.round(W * 0.05)}px`;
  g.fillText(label, 0, 0);
  g.strokeStyle = col;
  g.lineWidth = 2;
  g.strokeText(label, 0, 0);
  g.restore();

  // small tick marks along the run
  g.fillStyle = 'rgba(255,255,255,0.16)';
  for (let y = 0; y < H; y += H / 40) {
    g.fillRect(edge + 4, y, W * 0.05, 2);
    g.fillRect(W - edge - 4 - W * 0.05, y, W * 0.05, 2);
  }

  // moulding sheen + scuffs from thousands of ball passes
  const sh = g.createLinearGradient(0, 0, W, 0);
  sh.addColorStop(0, 'rgba(255,255,255,0)');
  sh.addColorStop(0.42, 'rgba(255,255,255,0.09)');
  sh.addColorStop(0.5, 'rgba(255,255,255,0.16)');
  sh.addColorStop(0.6, 'rgba(255,255,255,0.05)');
  sh.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sh;
  g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.10;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 1;
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * H;
    g.beginPath();
    g.moveTo(W * (0.3 + Math.random() * 0.4), y);
    g.lineTo(W * (0.3 + Math.random() * 0.4), y + 6 + Math.random() * 30);
    g.stroke();
  }
  g.globalAlpha = 1;
  return c;
}

/* ------------------------------------------------------------------ */
/* insert lenses                                                       */
/*                                                                     */
/* A real playfield insert is a moulded acrylic lens screen-printed with */
/* an opaque black legend and dropped into a milled pocket. The ink is  */
/* opaque, so when the lamp behind it fires the legend stays BLACK      */
/* while everything around it blazes -- that read is the single         */
/* strongest "this is a manufactured pinball machine" cue there is.     */
/* We therefore build two canvases per insert: the printed lens itself, */
/* and a glow mask with the same ink knocked out of the alpha so the    */
/* additive halo never washes the lettering away.                       */
/* ------------------------------------------------------------------ */

function insertLegend(g, W, H, label, shape, ink) {
  g.save();
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (shape === 'arrow') {
    // chevron stack instead of type -- arrows never carry a word
    const n = 3;
    g.lineWidth = Math.max(2, W * 0.075);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let i = 0; i < n; i++) {
      const cy = H * (0.30 + i * 0.20);
      const w = W * 0.24;
      g.beginPath();
      g.moveTo(W * 0.5 - w, cy + H * 0.055);
      g.lineTo(W * 0.5, cy - H * 0.055);
      g.lineTo(W * 0.5 + w, cy + H * 0.055);
      g.stroke();
    }
    g.restore();
    return;
  }
  const words = String(label).split('\n');
  const lines = words.length;
  const size = Math.round((H * (lines > 1 ? 0.40 : 0.60)) / 1);
  g.font = `900 ${size}px "Arial Black", "Helvetica Neue", Impact, sans-serif`;
  const track = Math.max(1, size * 0.055);
  for (let li = 0; li < lines; li++) {
    const txt = words[li];
    const chars = [...txt];
    let wsum = 0;
    for (const ch of chars) wsum += g.measureText(ch).width + track;
    wsum -= track;
    const max = W * 0.86;
    const sx = wsum > max ? max / wsum : 1;
    const y = lines === 1 ? H * 0.53 : H * (0.31 + li * 0.40);
    let x = W * 0.5 - (wsum * sx) / 2;
    g.save();
    g.translate(x, y);
    g.scale(sx, 1);
    let cx = 0;
    for (const ch of chars) {
      const cw = g.measureText(ch).width;
      g.fillText(ch, cx + cw / 2, 0);
      cx += cw + track;
    }
    g.restore();
  }
  g.restore();
}

const _insertCache = new Map();

/**
 * @returns {{lens: HTMLCanvasElement, glow: HTMLCanvasElement}}
 */
export function makeInsertArt(hex, label, aspect = 2.2, shape = 'rect', res = 288) {
  const key = `${hex}|${label}|${aspect.toFixed(2)}|${shape}`;
  const hit = _insertCache.get(key);
  if (hit) return hit;

  const W = res;
  const H = Math.max(26, Math.round(res / Math.max(0.32, aspect)));
  const col = '#' + hex.toString(16).padStart(6, '0');

  /* ---------------- printed lens ---------------- */
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');

  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, shade(col, 1.62));
  bg.addColorStop(0.34, shade(col, 1.14));
  bg.addColorStop(0.82, shade(col, 0.74));
  bg.addColorStop(1, shade(col, 0.5));
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // moulded diffuser ribs -- the fine ridges cast into the back of the lens
  g.globalAlpha = 0.085;
  g.fillStyle = '#ffffff';
  for (let y = 1; y < H; y += 3) g.fillRect(0, y, W, 1);
  g.globalAlpha = 0.05;
  g.fillStyle = '#000000';
  for (let x = 2; x < W; x += 5) g.fillRect(x, 0, 1, H);
  g.globalAlpha = 1;

  // the lamp sits behind centre: a hot pool that falls off to the corners
  const rg = g.createRadialGradient(W * 0.5, H * 0.52, 0, W * 0.5, H * 0.52, W * 0.6);
  rg.addColorStop(0, 'rgba(255,255,255,0.46)');
  rg.addColorStop(0.45, 'rgba(255,255,255,0.14)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, W, H);

  if (shape !== 'arrow') {
    // screen-printed keyline
    g.strokeStyle = 'rgba(8,8,14,0.62)';
    g.lineWidth = Math.max(2, W * 0.011);
    g.strokeRect(W * 0.032, H * 0.085, W * 0.936, H * 0.83);
  }

  insertLegend(g, W, H, label, shape, 'rgba(8,9,16,0.94)');

  // moulded bevel: bright top edge, dark bottom edge
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillRect(0, 0, W, Math.max(1, H * 0.045));
  g.fillStyle = 'rgba(255,255,255,0.22)';
  g.fillRect(0, 0, Math.max(1, W * 0.012), H);
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(0, H - Math.max(1, H * 0.075), W, H);
  g.fillStyle = 'rgba(0,0,0,0.26)';
  g.fillRect(W - Math.max(1, W * 0.012), 0, W, H);

  // ball wear: the lens is the lowest, hardest thing on the board
  for (let i = 0; i < 34; i++) {
    g.globalAlpha = 0.03 + Math.random() * 0.07;
    g.fillStyle = Math.random() < 0.55 ? '#ffffff' : '#000000';
    const w = 1 + Math.random() * 12;
    g.fillRect(Math.random() * W, Math.random() * H, w, 1);
  }
  g.globalAlpha = 1;

  /* ---------------- glow mask (ink knocked out) ---------------- */
  const c2 = document.createElement('canvas');
  c2.width = W;
  c2.height = H;
  const g2 = c2.getContext('2d');
  const img = g2.createImageData(W, H);
  const ar = W / H;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = ((x / (W - 1)) * 2 - 1) * ar;
      const v = (y / (H - 1)) * 2 - 1;
      const bx = Math.max(Math.abs(u) - (ar - 0.34), 0);
      const by = Math.max(Math.abs(v) - 0.44, 0);
      const d = Math.hypot(bx, by);
      const core = Math.max(0, 1 - d / 0.16);
      const bleed = Math.max(0, 1 - d / 0.72);
      const a = Math.min(1, core * 0.85 + bleed * bleed * bleed * 0.3);
      const o = (y * W + x) * 4;
      img.data[o] = 255;
      img.data[o + 1] = 255;
      img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  g2.putImageData(img, 0, 0);
  g2.globalCompositeOperation = 'destination-out';
  insertLegend(g2, W, H, label, shape, 'rgba(0,0,0,0.96)');
  g2.globalCompositeOperation = 'source-over';

  const out = { lens: c, glow: c2 };
  _insertCache.set(key, out);
  return out;
}
