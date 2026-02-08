// Roadside scenery — procedural pixel-art objects for Road Rage

import type { RoadSegment } from './road';

// Simple seeded pseudo-random for deterministic placement
function seededRand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

export function drawScenerySprite(
  ctx: CanvasRenderingContext2D,
  type: string,
  x: number,
  y: number,
  scale: number,
  side: number,
): void {
  const s = scale;
  if (s < 0.003) return;

  ctx.save();
  switch (type) {
    case 'tree_small': {
      const tw = 6 * s;
      const th = 30 * s;
      // Trunk
      ctx.fillStyle = '#664422';
      ctx.fillRect(x - tw * 0.5, y - th * 0.4, tw, th * 0.4);
      // Triangle canopy
      ctx.fillStyle = '#117711';
      ctx.beginPath();
      ctx.moveTo(x, y - th);
      ctx.lineTo(x - tw * 1.8, y - th * 0.35);
      ctx.lineTo(x + tw * 1.8, y - th * 0.35);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'tree_large': {
      const tw = 10 * s;
      const th = 50 * s;
      // Trunk
      ctx.fillStyle = '#553311';
      ctx.fillRect(x - tw * 0.4, y - th * 0.35, tw * 0.8, th * 0.35);
      // Two-tier triangle canopy
      ctx.fillStyle = '#0a5c0a';
      ctx.beginPath();
      ctx.moveTo(x, y - th);
      ctx.lineTo(x - tw * 2, y - th * 0.5);
      ctx.lineTo(x + tw * 2, y - th * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0e6e0e';
      ctx.beginPath();
      ctx.moveTo(x, y - th * 0.75);
      ctx.lineTo(x - tw * 2.5, y - th * 0.25);
      ctx.lineTo(x + tw * 2.5, y - th * 0.25);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'bush': {
      const bw = 14 * s;
      const bh = 10 * s;
      ctx.fillStyle = '#226622';
      const rx = x - bw * 0.5;
      const ry = y - bh;
      const r = Math.min(bw, bh) * 0.4;
      // Rounded rect approximation
      ctx.beginPath();
      ctx.moveTo(rx + r, ry);
      ctx.lineTo(rx + bw - r, ry);
      ctx.quadraticCurveTo(rx + bw, ry, rx + bw, ry + r);
      ctx.lineTo(rx + bw, ry + bh - r);
      ctx.quadraticCurveTo(rx + bw, ry + bh, rx + bw - r, ry + bh);
      ctx.lineTo(rx + r, ry + bh);
      ctx.quadraticCurveTo(rx, ry + bh, rx, ry + bh - r);
      ctx.lineTo(rx, ry + r);
      ctx.quadraticCurveTo(rx, ry, rx + r, ry);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'sign_warning': {
      const pw = 3 * s;
      const ph = 30 * s;
      // Pole
      ctx.fillStyle = '#888888';
      ctx.fillRect(x - pw * 0.5, y - ph, pw, ph);
      // Yellow sign
      const sw = 18 * s;
      const sh = 14 * s;
      ctx.fillStyle = '#ddcc00';
      ctx.fillRect(x - sw * 0.5, y - ph - sh * 0.3, sw, sh);
      // Black border
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(1, s * 2);
      ctx.strokeRect(x - sw * 0.5, y - ph - sh * 0.3, sw, sh);
      break;
    }
    case 'sign_distance': {
      const pw = 3 * s;
      const ph = 28 * s;
      ctx.fillStyle = '#888888';
      ctx.fillRect(x - pw * 0.5, y - ph, pw, ph);
      // Green sign
      const sw = 22 * s;
      const sh = 12 * s;
      ctx.fillStyle = '#116633';
      ctx.fillRect(x - sw * 0.5, y - ph - sh * 0.2, sw, sh);
      // White text line
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - sw * 0.3, y - ph - sh * 0.2 + sh * 0.35, sw * 0.6, sh * 0.15);
      ctx.fillRect(x - sw * 0.2, y - ph - sh * 0.2 + sh * 0.6, sw * 0.4, sh * 0.15);
      break;
    }
    case 'building': {
      const bw = 40 * s;
      const bh = 50 * s;
      // Main structure
      const hue = seededRand(x * 100 + y);
      const r = 80 + Math.floor(hue * 60);
      const g = 70 + Math.floor(hue * 40);
      const b = 60 + Math.floor(hue * 50);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x - bw * 0.5, y - bh, bw, bh);
      // Roof line
      ctx.fillStyle = `rgb(${r - 30},${g - 30},${b - 30})`;
      ctx.fillRect(x - bw * 0.55, y - bh, bw * 1.1, bh * 0.08);
      // Windows (2×3 grid)
      ctx.fillStyle = '#223344';
      const winW = bw * 0.15;
      const winH = bh * 0.1;
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 2; col++) {
          const wx = x - bw * 0.25 + col * bw * 0.35;
          const wy = y - bh * 0.85 + row * bh * 0.28;
          ctx.fillRect(wx, wy, winW, winH);
        }
      }
      break;
    }
    case 'rock': {
      const rw = 8 * s;
      const rh = 6 * s;
      ctx.fillStyle = '#777777';
      ctx.fillRect(x - rw * 0.5, y - rh, rw, rh);
      ctx.fillStyle = '#666666';
      ctx.fillRect(x - rw * 0.3 + rw * 0.1 * side, y - rh * 1.3, rw * 0.6, rh * 0.5);
      break;
    }
    case 'lamp': {
      const pw = 2.5 * s;
      const ph = 40 * s;
      // Pole
      ctx.fillStyle = '#555555';
      ctx.fillRect(x - pw * 0.5, y - ph, pw, ph);
      // Arm extending toward road
      const armLen = 10 * s * side;
      ctx.fillRect(x, y - ph, armLen, pw);
      // Light
      ctx.fillStyle = '#ffee66';
      ctx.fillRect(x + armLen - 4 * s * side, y - ph - 3 * s, 8 * s, 5 * s);
      // Glow
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = '#ffee66';
      ctx.beginPath();
      ctx.arc(x + armLen, y - ph, 12 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    default: {
      // fallback — small gray rect
      ctx.fillStyle = '#888888';
      const fw = 10 * s;
      const fh = 20 * s;
      ctx.fillRect(x - fw * 0.5, y - fh, fw, fh);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Placement — populates segment sprite arrays
// ---------------------------------------------------------------------------

export function placeScenery(segments: RoadSegment[]): void {
  const len = segments.length;

  // Determine town sections: clusters of 50 segments every 500-800 apart
  const towns: { start: number; end: number }[] = [];
  {
    let cursor = 500 + Math.floor(seededRand(42) * 300);
    while (cursor + 50 < len) {
      towns.push({ start: cursor, end: cursor + 50 });
      cursor += 500 + Math.floor(seededRand(cursor) * 300);
    }
  }

  function inTown(i: number): boolean {
    for (const t of towns) {
      if (i >= t.start && i < t.end) return true;
    }
    return false;
  }

  for (let i = 0; i < len; i++) {
    const seg = segments[i];
    const r1 = seededRand(i * 7 + 3);
    const r2 = seededRand(i * 13 + 7);
    const r3 = seededRand(i * 19 + 11);

    // --- Town sections: buildings + lamp posts ---
    if (inTown(i)) {
      // Buildings every 4-6 segments on each side
      if (i % 5 === 0) {
        seg.sprites.push({ offset: -1.8 - r1 * 0.4, source: 'building', collides: true });
      }
      if (i % 5 === 2) {
        seg.sprites.push({ offset: 1.8 + r2 * 0.4, source: 'building', collides: true });
      }
      // Lamp posts every 30 segments
      if (i % 30 === 0) {
        seg.sprites.push({ offset: -1.2, source: 'lamp', collides: false });
        seg.sprites.push({ offset: 1.2, source: 'lamp', collides: false });
      }
      continue; // skip natural scenery in towns
    }

    // --- Trees: every 10-20 segments, staggered ---
    const treeInterval = 10 + Math.floor(r1 * 10); // 10–19
    if (i % treeInterval === 0 && i > 0) {
      const variant = r2 > 0.5 ? 'tree_large' : 'tree_small';
      const dist = 1.4 + r3 * 0.6;
      // Left side on even multiples, right on odd — staggered
      if (i % (treeInterval * 2) < treeInterval) {
        seg.sprites.push({ offset: -dist, source: variant, collides: true });
      } else {
        seg.sprites.push({ offset: dist, source: variant, collides: true });
      }
    }
    // Extra tree on opposite side offset by ~half interval
    if ((i + 7) % 14 === 0) {
      const variant = r1 > 0.4 ? 'tree_small' : 'tree_large';
      const side = r2 > 0.5 ? 1 : -1;
      const dist = 1.5 + r3 * 0.5;
      seg.sprites.push({ offset: side * dist, source: variant, collides: true });
    }

    // --- Bushes: fill gaps (every 5-8 segments) ---
    if (i % 6 === 3) {
      const side = r1 > 0.5 ? 1 : -1;
      seg.sprites.push({ offset: side * (1.3 + r2 * 0.5), source: 'bush', collides: false });
    }
    if (i % 9 === 0) {
      seg.sprites.push({ offset: -(1.2 + r3 * 0.3), source: 'bush', collides: false });
    }

    // --- Signs: every 100-200 segments ---
    if (i % 130 === 0 && i > 0) {
      const signType = r1 > 0.5 ? 'sign_warning' : 'sign_distance';
      const side = r2 > 0.5 ? 1 : -1;
      seg.sprites.push({ offset: side * 1.4, source: signType, collides: true });
    }
    if (i % 170 === 50) {
      const signType = r3 > 0.5 ? 'sign_distance' : 'sign_warning';
      seg.sprites.push({ offset: (r1 > 0.5 ? 1 : -1) * 1.5, source: signType, collides: true });
    }

    // --- Rocks: scattered ---
    if (i % 11 === 0) {
      const side = r2 > 0.5 ? 1 : -1;
      seg.sprites.push({ offset: side * (1.3 + r1 * 0.8), source: 'rock', collides: false });
    }
  }
}

// ---------------------------------------------------------------------------
// Collision detection
// ---------------------------------------------------------------------------

const COLLIDABLE_TYPES = new Set([
  'tree_small', 'tree_large', 'sign_warning', 'sign_distance', 'building',
  'cactus_tall', 'cactus_short', 'palm_tree', 'pine_tree', 'pine_tree_snow',
  'building_tall', 'sign_speed', 'sign_curve', 'beach_sign', 'lighthouse',
  'bus_stop', 'billboard', 'log_cabin', 'rocky_outcrop', 'boulder',
]);

// Half-widths for collidable objects (in offset units relative to road width)
const HITBOX_HALF: Record<string, number> = {
  tree_small: 0.08,
  tree_large: 0.12,
  sign_warning: 0.06,
  sign_distance: 0.07,
  building: 0.2,
  cactus_tall: 0.06,
  cactus_short: 0.08,
  palm_tree: 0.06,
  pine_tree: 0.08,
  pine_tree_snow: 0.08,
  building_tall: 0.18,
  sign_speed: 0.06,
  sign_curve: 0.06,
  beach_sign: 0.06,
  lighthouse: 0.05,
  bus_stop: 0.1,
  billboard: 0.15,
  log_cabin: 0.12,
  rocky_outcrop: 0.1,
  boulder: 0.1,
};

/**
 * Check if the player (at a given offset from road center, in road-width units)
 * collides with any scenery sprite on the given segment.
 * Returns the sprite source type if collision, or null.
 */
export function checkSceneryCollision(
  segment: RoadSegment,
  playerOffset: number, // player x / ROAD_WIDTH
): string | null {
  for (const sprite of segment.sprites) {
    if (!COLLIDABLE_TYPES.has(sprite.source)) continue;
    const half = HITBOX_HALF[sprite.source] ?? 0.1;
    if (Math.abs(playerOffset - sprite.offset) < half + 0.05) {
      return sprite.source;
    }
  }
  return null;
}
