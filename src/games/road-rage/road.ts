// Road segment system + pseudo-3D projection — themed track engine

export interface RoadSprite {
  offset: number;
  source: string;
  collides: boolean;
}

export interface RoadSegment {
  world: { x: number; y: number; z: number; w: number };
  screen: { x: number; y: number; w: number };
  curve: number;
  hill: number;
  clip: number;
  color: { road: string; grass: string; rumble: string; lane: string };
  sprites: RoadSprite[];
}

export interface Camera {
  x: number;
  y: number;
  z: number;
  distToPlayer: number;
  distToProjection: number;
}

export interface TrackPalette {
  sky: { top: string; bottom: string };
  grass: { light: string; dark: string };
  road: { light: string; dark: string };
  rumble: { light: string; dark: string };
  lane: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SEGMENT_LENGTH = 200;
export const ROAD_WIDTH = 2000;
export const DRAW_DISTANCE = 400;
export const FIELD_OF_VIEW = 100;
export const CAMERA_HEIGHT = 1000;
export const TOTAL_SEGMENTS = 6000;
const TRACK_SEGMENT_COUNTS = [4000, 4500, 3500, 5000];
export const LANES = 3;
export const SCREEN_WIDTH = 800;
export const SCREEN_HEIGHT = 500;

const BAND_SIZE = 3;

// ---------------------------------------------------------------------------
// Track palettes
// ---------------------------------------------------------------------------

const TRACK_PALETTES: TrackPalette[] = [
  { // 0: Desert Highway — tan sand, warm sky
    sky: { top: '#1a0a2e', bottom: '#ff6b35' },
    grass: { light: '#c2a645', dark: '#b09030' },
    road: { light: '#555555', dark: '#4a4a4a' },
    rumble: { light: '#cc0000', dark: '#555555' },
    lane: '#ffffff',
  },
  { // 1: Coastal Road — ocean blues, lush green
    sky: { top: '#0044aa', bottom: '#66bbff' },
    grass: { light: '#22aa55', dark: '#118844' },
    road: { light: '#444444', dark: '#3a3a3a' },
    rumble: { light: '#ffffff', dark: '#cc0000' },
    lane: '#ffffff',
  },
  { // 2: City Streets — gray concrete, overcast
    sky: { top: '#222233', bottom: '#556677' },
    grass: { light: '#888888', dark: '#777777' },
    road: { light: '#606060', dark: '#555555' },
    rumble: { light: '#ffcc00', dark: '#555555' },
    lane: '#ffcc00',
  },
  { // 3: Mountain Pass — dark pines, cold sky
    sky: { top: '#001122', bottom: '#334466' },
    grass: { light: '#1a6630', dark: '#0d4418' },
    road: { light: '#3c3c3c', dark: '#333333' },
    rumble: { light: '#cc0000', dark: '#444444' },
    lane: '#ffffff',
  },
];

let currentTrackId = 0;
let currentPalette: TrackPalette = TRACK_PALETTES[0];

export function getTrackPalette(): TrackPalette { return currentPalette; }
export function getTrackId(): number { return currentTrackId; }
export function getTotalSegments(): number { return TRACK_SEGMENT_COUNTS[currentTrackId]; }

// ---------------------------------------------------------------------------
// Track metadata
// ---------------------------------------------------------------------------

export interface TrackInfo {
  id: number;
  name: string;
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Expert';
  description: string;
  segments: number;
}

export const TRACKS: TrackInfo[] = [
  { id: 0, name: 'Desert Run', difficulty: 'Easy', description: 'Long straights and gentle curves through sun-scorched desert.', segments: 4000 },
  { id: 1, name: 'Pacific Coast', difficulty: 'Medium', description: 'Winding coastal cliffs with ocean views and moderate elevation.', segments: 4500 },
  { id: 2, name: 'Metro Rush', difficulty: 'Hard', description: 'Tight city turns through narrow streets lined with skyscrapers.', segments: 3500 },
  { id: 3, name: 'Thunder Peak', difficulty: 'Expert', description: 'Extreme switchbacks and steep climbs through treacherous mountains.', segments: 5000 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function easeInOut(t: number): number {
  return (1 - Math.cos(Math.PI * t)) / 2;
}

function seededRand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function createSegment(index: number, palette: TrackPalette): RoadSegment {
  const isLight = Math.floor(index / BAND_SIZE) % 2 === 0;
  return {
    world: { x: 0, y: 0, z: index * SEGMENT_LENGTH, w: ROAD_WIDTH },
    screen: { x: 0, y: 0, w: 0 },
    curve: 0,
    hill: 0,
    clip: 0,
    color: {
      road: isLight ? palette.road.light : palette.road.dark,
      grass: isLight ? palette.grass.light : palette.grass.dark,
      rumble: isLight ? palette.rumble.light : palette.rumble.dark,
      lane: isLight ? palette.lane : palette.road.dark,
    },
    sprites: [],
  };
}

// Smooth road section with sine-eased enter/exit
function addRoad(
  segs: RoadSegment[], start: number, count: number, curve: number, hill: number,
): number {
  const enter = Math.floor(count * 0.25);
  const hold = Math.floor(count * 0.5);
  const exit = count - enter - hold;
  for (let i = 0; i < enter; i++) {
    const idx = start + i;
    if (idx >= segs.length) break;
    const t = easeInOut(i / Math.max(enter, 1));
    segs[idx].curve = curve * t;
    segs[idx].hill = hill * t;
  }
  for (let i = 0; i < hold; i++) {
    const idx = start + enter + i;
    if (idx >= segs.length) break;
    segs[idx].curve = curve;
    segs[idx].hill = hill;
  }
  for (let i = 0; i < exit; i++) {
    const idx = start + enter + hold + i;
    if (idx >= segs.length) break;
    const t = 1 - easeInOut(i / Math.max(exit, 1));
    segs[idx].curve = curve * t;
    segs[idx].hill = hill * t;
  }
  return start + count;
}

function applyWidthVariation(segs: RoadSegment[], base: number): void {
  for (const seg of segs) {
    const curveShrink = 1 - Math.min(Math.abs(seg.curve), 1) * 0.12;
    seg.world.w = ROAD_WIDTH * base * curveShrink;
  }
}

// ---------------------------------------------------------------------------
// Track layout generators
// ---------------------------------------------------------------------------

function generateDesertHighway(s: RoadSegment[]): void {
  let i = 0;
  i = addRoad(s, i, 120, 0, 0);
  i = addRoad(s, i, 200, 0.25, 0);
  i = addRoad(s, i, 100, 0, 1);
  i = addRoad(s, i, 180, -0.3, 0);
  i = addRoad(s, i, 150, 0, 0);
  i = addRoad(s, i, 200, 0.4, 0.5);
  i = addRoad(s, i, 120, 0, 0);
  i = addRoad(s, i, 220, -0.35, 0);
  i = addRoad(s, i, 80, 0, -1);
  i = addRoad(s, i, 160, 0.2, 0);
  i = addRoad(s, i, 200, 0, 0);
  i = addRoad(s, i, 200, -0.25, 1);
  i = addRoad(s, i, 140, 0, 0);
  i = addRoad(s, i, 200, 0.35, 0);
  i = addRoad(s, i, 100, 0, -0.5);
  i = addRoad(s, i, 180, 0, 0);
  i = addRoad(s, i, 200, -0.3, 0.5);
  i = addRoad(s, i, 160, 0.2, 0);
  i = addRoad(s, i, 120, 0, 0);
  i = addRoad(s, i, 200, -0.2, 0);
  i = addRoad(s, i, 100, 0, 1);
  i = addRoad(s, i, 180, 0.3, 0);
  while (i < s.length) {
    const n = Math.min(s.length - i, 140);
    if (n <= 0) break;
    i = addRoad(s, i, n, Math.sin(i * 0.005) * 0.2, Math.cos(i * 0.003) * 0.5);
  }
  applyWidthVariation(s, 1.0);
}

function generateCoastalRoad(s: RoadSegment[]): void {
  let i = 0;
  i = addRoad(s, i, 60, 0, 0);
  i = addRoad(s, i, 120, 0.5, 3);
  i = addRoad(s, i, 80, -0.4, -2);
  i = addRoad(s, i, 100, 0.6, 2);
  i = addRoad(s, i, 60, 0, -4);
  i = addRoad(s, i, 140, -0.55, 1);
  i = addRoad(s, i, 80, 0, 0);
  i = addRoad(s, i, 120, 0.45, 3);
  i = addRoad(s, i, 100, -0.6, -3);
  i = addRoad(s, i, 60, 0, 5);
  i = addRoad(s, i, 100, 0.5, 0);
  i = addRoad(s, i, 100, 0, -5);
  i = addRoad(s, i, 120, -0.4, 2);
  i = addRoad(s, i, 80, 0.3, -1);
  i = addRoad(s, i, 100, 0, 0);
  i = addRoad(s, i, 150, -0.5, 3);
  i = addRoad(s, i, 80, 0.6, -2);
  i = addRoad(s, i, 100, 0, 4);
  i = addRoad(s, i, 120, -0.45, 0);
  i = addRoad(s, i, 80, 0.5, -3);
  i = addRoad(s, i, 60, 0, 0);
  while (i < s.length) {
    const n = Math.min(s.length - i, 100);
    if (n <= 0) break;
    i = addRoad(s, i, n, Math.sin(i * 0.008) * 0.5, Math.cos(i * 0.005) * 3);
  }
  applyWidthVariation(s, 0.9);
}

function generateCityStreets(s: RoadSegment[]): void {
  let i = 0;
  i = addRoad(s, i, 40, 0, 0);
  i = addRoad(s, i, 60, 0.8, 0);
  i = addRoad(s, i, 40, 0, 0);
  i = addRoad(s, i, 70, -0.9, 0);
  i = addRoad(s, i, 30, 0, 0);
  i = addRoad(s, i, 80, 0.7, 0.3);
  i = addRoad(s, i, 50, 0, 0);
  i = addRoad(s, i, 60, -1.0, 0);
  i = addRoad(s, i, 80, 0, 0);
  i = addRoad(s, i, 70, 0.9, -0.3);
  i = addRoad(s, i, 40, 0, 0);
  i = addRoad(s, i, 80, -0.8, 0);
  i = addRoad(s, i, 60, 0, 0);
  i = addRoad(s, i, 50, 0.6, 0);
  i = addRoad(s, i, 80, 0, 0);
  i = addRoad(s, i, 70, -0.7, 0);
  i = addRoad(s, i, 100, 0, 0);
  i = addRoad(s, i, 60, 1.0, 0);
  i = addRoad(s, i, 50, 0, 0);
  i = addRoad(s, i, 70, -0.85, 0);
  i = addRoad(s, i, 60, 0, 0);
  i = addRoad(s, i, 80, 0.75, 0);
  while (i < s.length) {
    const n = Math.min(s.length - i, 60);
    if (n <= 0) break;
    i = addRoad(s, i, n, Math.sin(i * 0.012) * 0.8, Math.cos(i * 0.01) * 0.2);
  }
  applyWidthVariation(s, 0.8);
}

function generateMountainPass(s: RoadSegment[]): void {
  let i = 0;
  i = addRoad(s, i, 40, 0, 0);
  i = addRoad(s, i, 100, 0.7, 8);
  i = addRoad(s, i, 80, -0.9, 5);
  i = addRoad(s, i, 60, 0, 10);
  i = addRoad(s, i, 100, 1.0, 3);
  i = addRoad(s, i, 80, -1.1, -2);
  i = addRoad(s, i, 60, 0, -8);
  i = addRoad(s, i, 100, 0.8, -5);
  i = addRoad(s, i, 80, -0.9, 6);
  i = addRoad(s, i, 60, 0, 12);
  i = addRoad(s, i, 100, 1.1, 2);
  i = addRoad(s, i, 80, 0, -10);
  i = addRoad(s, i, 60, -1.0, -3);
  i = addRoad(s, i, 100, 0, 7);
  i = addRoad(s, i, 80, 0.9, 4);
  i = addRoad(s, i, 60, -0.8, -6);
  i = addRoad(s, i, 80, 0, 8);
  i = addRoad(s, i, 100, 1.0, -4);
  i = addRoad(s, i, 60, -0.9, 5);
  while (i < s.length) {
    const n = Math.min(s.length - i, 80);
    if (n <= 0) break;
    i = addRoad(s, i, n, Math.sin(i * 0.01) * 1.0, Math.cos(i * 0.006) * 8);
  }
  applyWidthVariation(s, 0.7);
}

// ---------------------------------------------------------------------------
// Track-specific scenery
// ---------------------------------------------------------------------------

function placeDesertScenery(segs: RoadSegment[]): void {
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const r1 = seededRand(i * 7 + 3);
    const r2 = seededRand(i * 13 + 7);
    const r3 = seededRand(i * 19 + 11);
    // Saguaro cactus — sparse, every ~18 segments
    if (i % 18 === 0 && i > 0) {
      seg.sprites.push({ offset: (r2 > 0.5 ? 1 : -1) * (1.3 + r3 * 0.5), source: 'cactus_tall', collides: true });
    }
    // Barrel cactus — staggered opposite side, every ~22
    if (i % 22 === 11) {
      seg.sprites.push({ offset: (r1 > 0.5 ? 1 : -1) * (1.4 + r2 * 0.4), source: 'cactus_short', collides: true });
    }
    // Red mesa / butte silhouette (distant) — rare
    if (i % 250 === 60) {
      seg.sprites.push({ offset: (r1 > 0.5 ? 1 : -1) * (2.2 + r3 * 0.4), source: 'mesa', collides: false });
    }
    // Desert bush / tumbleweed — every ~20
    if (i % 20 === 7) {
      seg.sprites.push({ offset: (r3 > 0.5 ? 1 : -1) * (1.2 + r1 * 0.4), source: 'desert_bush', collides: false });
    }
    // Boulder — every ~25
    if (i % 25 === 12) {
      seg.sprites.push({ offset: (r1 > 0.5 ? 1 : -1) * (1.4 + r2 * 0.6), source: 'boulder', collides: false });
    }
    // Rock — every ~30
    if (i % 30 === 0 && i > 0) {
      seg.sprites.push({ offset: (r3 > 0.5 ? 1 : -1) * (1.3 + r2 * 0.5), source: 'rock', collides: false });
    }
    // Speed sign — rare
    if (i % 300 === 0 && i > 0) {
      seg.sprites.push({ offset: (r1 > 0.5 ? 1 : -1) * 1.5, source: 'sign_speed', collides: true });
    }
    // Distance sign — rare
    if (i % 350 === 100) {
      seg.sprites.push({ offset: (r2 > 0.5 ? 1 : -1) * 1.4, source: 'sign_distance', collides: true });
    }
  }
}

function placeCoastalScenery(segs: RoadSegment[]): void {
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const r1 = seededRand(i * 7 + 3);
    const r2 = seededRand(i * 13 + 7);
    const r3 = seededRand(i * 19 + 11);
    // Palm tree — every ~10, staggered sides
    if (i % 10 === 0 && i > 0) {
      seg.sprites.push({ offset: (r1 > 0.5 ? 1 : -1) * (1.3 + r2 * 0.4), source: 'palm_tree', collides: true });
    }
    // Palm tree — secondary, every ~14
    if (i % 14 === 7) {
      seg.sprites.push({ offset: (r3 > 0.5 ? 1 : -1) * (1.5 + r1 * 0.3), source: 'palm_tree', collides: true });
    }
    // Guard rail on cliff edge — every 3 segments on one side
    if (i % 3 === 0) {
      seg.sprites.push({ offset: -1.15, source: 'guard_rail', collides: false });
    }
    // Beach sign — every ~120
    if (i % 120 === 30) {
      seg.sprites.push({ offset: (r2 > 0.5 ? 1 : -1) * 1.4, source: 'beach_sign', collides: true });
    }
    // Lighthouse (distant) — rare
    if (i % 400 === 100) {
      seg.sprites.push({ offset: (r1 > 0.5 ? 1 : -1) * (2.0 + r3 * 0.5), source: 'lighthouse', collides: false });
    }
    // Rock — every ~15
    if (i % 15 === 5) {
      seg.sprites.push({ offset: (r2 > 0.5 ? 1 : -1) * (1.4 + r3 * 0.5), source: 'rock', collides: false });
    }
    // Curve sign — every ~100
    if (i % 100 === 0 && i > 0) {
      seg.sprites.push({ offset: 1.5, source: 'sign_curve', collides: true });
    }
    // Bush — every ~12
    if (i % 12 === 4) {
      seg.sprites.push({ offset: (r1 > 0.5 ? 1 : -1) * (1.2 + r2 * 0.4), source: 'bush', collides: false });
    }
  }
}

function placeCityScenery(segs: RoadSegment[]): void {
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const r1 = seededRand(i * 7 + 3);
    const r2 = seededRand(i * 13 + 7);
    const r3 = seededRand(i * 19 + 11);
    // Buildings — dense, every 3-4 segments, both sides staggered
    if (i % 3 === 0) {
      seg.sprites.push({ offset: -1.6 - r2 * 0.3, source: r1 > 0.5 ? 'building_tall' : 'building', collides: true });
    }
    if (i % 3 === 1) {
      seg.sprites.push({ offset: 1.6 + r1 * 0.3, source: r3 > 0.5 ? 'building_tall' : 'building', collides: true });
    }
    // Street lamps — every ~15 segments, both sides
    if (i % 15 === 0) {
      seg.sprites.push({ offset: -1.15, source: 'lamp', collides: false });
      seg.sprites.push({ offset: 1.15, source: 'lamp', collides: false });
    }
    // Bus stop — every ~80
    if (i % 80 === 20) {
      seg.sprites.push({ offset: (r1 > 0.5 ? 1 : -1) * 1.3, source: 'bus_stop', collides: true });
    }
    // Billboard — every ~60
    if (i % 60 === 35) {
      seg.sprites.push({ offset: (r2 > 0.5 ? 1 : -1) * (1.7 + r3 * 0.3), source: 'billboard', collides: true });
    }
    // Speed sign — every ~50
    if (i % 50 === 0 && i > 0) {
      seg.sprites.push({ offset: 1.4, source: 'sign_speed', collides: true });
    }
    // Distance sign — every ~45
    if (i % 45 === 22) {
      seg.sprites.push({ offset: -1.4, source: 'sign_distance', collides: true });
    }
  }
}

function placeMountainScenery(segs: RoadSegment[]): void {
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const r1 = seededRand(i * 7 + 3);
    const r2 = seededRand(i * 13 + 7);
    const r3 = seededRand(i * 19 + 11);
    // Pine trees — moderate-dense, every ~7
    if (i % 7 === 0) {
      const side = r2 > 0.5 ? 1 : -1;
      seg.sprites.push({ offset: side * (1.3 + r3 * 0.4), source: r1 > 0.7 ? 'pine_tree_snow' : 'pine_tree', collides: true });
    }
    // Secondary pine — every ~10, staggered
    if (i % 10 === 5) {
      seg.sprites.push({ offset: (r1 > 0.5 ? 1 : -1) * (1.5 + r2 * 0.5), source: r3 > 0.6 ? 'pine_tree_snow' : 'pine_tree', collides: true });
    }
    // Guard rails on tight curves
    if (Math.abs(seg.curve) > 0.3 && i % 2 === 0) {
      seg.sprites.push({ offset: (seg.curve > 0 ? 1 : -1) * 1.15, source: 'guard_rail', collides: false });
    }
    // Snow-capped peak silhouette (distant) — rare
    if (i % 300 === 80) {
      seg.sprites.push({ offset: (r1 > 0.5 ? 1 : -1) * (2.2 + r3 * 0.5), source: 'snow_peak', collides: false });
    }
    // Log cabin — rare
    if (i % 200 === 50) {
      seg.sprites.push({ offset: (r2 > 0.5 ? 1 : -1) * (1.6 + r1 * 0.3), source: 'log_cabin', collides: true });
    }
    // Rocky outcrop — every ~20
    if (i % 20 === 10) {
      seg.sprites.push({ offset: (r2 > 0.5 ? 1 : -1) * (1.4 + r1 * 0.6), source: 'rocky_outcrop', collides: true });
    }
    // Boulder — every ~18
    if (i % 18 === 0 && i > 0) {
      seg.sprites.push({ offset: (r2 > 0.5 ? 1 : -1) * (1.4 + r1 * 0.6), source: 'boulder', collides: true });
    }
    // Rock — every ~12
    if (i % 12 === 6) {
      seg.sprites.push({ offset: (r3 > 0.5 ? 1 : -1) * (1.3 + r2 * 0.5), source: 'rock', collides: false });
    }
    // Curve sign — every ~80
    if (i % 80 === 0 && i > 0) {
      seg.sprites.push({ offset: (r1 > 0.5 ? 1 : -1) * 1.5, source: 'sign_curve', collides: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Main generation
// ---------------------------------------------------------------------------

export function generateRoad(trackId: number = 0): RoadSegment[] {
  const tid = Math.max(0, Math.min(3, trackId));
  currentTrackId = tid;
  currentPalette = TRACK_PALETTES[tid];
  const segCount = TRACK_SEGMENT_COUNTS[tid];

  const segments: RoadSegment[] = [];
  for (let i = 0; i < segCount; i++) {
    segments.push(createSegment(i, currentPalette));
  }

  switch (tid) {
    case 0: generateDesertHighway(segments); break;
    case 1: generateCoastalRoad(segments); break;
    case 2: generateCityStreets(segments); break;
    case 3: generateMountainPass(segments); break;
  }

  // Cumulative height from hill values
  let cumY = 0;
  for (const seg of segments) {
    cumY += seg.hill;
    seg.world.y = cumY;
  }

  switch (tid) {
    case 0: placeDesertScenery(segments); break;
    case 1: placeCoastalScenery(segments); break;
    case 2: placeCityScenery(segments); break;
    case 3: placeMountainScenery(segments); break;
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export function projectSegments(
  segments: RoadSegment[],
  camera: Camera,
  width: number,
  height: number,
): { startIdx: number; endIdx: number } {
  const totalZ = segments.length * SEGMENT_LENGTH;
  const cameraZ = camera.z;
  const halfW = width / 2;
  const halfH = height / 2;
  const baseIdx = Math.floor(cameraZ / SEGMENT_LENGTH) % segments.length;

  let curveAccum = 0;
  let maxY = height;
  const startIdx = baseIdx;
  let endIdx = baseIdx;

  for (let n = 0; n < DRAW_DISTANCE; n++) {
    const idx = (baseIdx + n) % segments.length;
    const seg = segments[idx];

    let relZ = seg.world.z - cameraZ;
    if (relZ < 0) relZ += totalZ;
    if (relZ <= 0) continue;

    const scale = camera.distToProjection / relZ;
    curveAccum += seg.curve;
    const curveOffset = curveAccum - segments[(baseIdx + 1) % segments.length].curve;

    seg.screen.x = Math.round(halfW + scale * (seg.world.x + curveOffset * SEGMENT_LENGTH - camera.x) * halfW);
    seg.screen.y = Math.round(halfH - scale * (seg.world.y - camera.y) * halfH);
    seg.screen.w = Math.round(scale * seg.world.w * halfW);

    seg.clip = maxY;
    if (seg.screen.y < maxY) {
      endIdx = idx;
      maxY = seg.screen.y;
    }
  }

  return { startIdx, endIdx };
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

export function createCamera(): Camera {
  const distToProjection = 1 / Math.tan(((FIELD_OF_VIEW / 2) * Math.PI) / 180);
  return {
    x: 0,
    y: CAMERA_HEIGHT,
    z: 0,
    distToPlayer: 200,
    distToProjection,
  };
}
