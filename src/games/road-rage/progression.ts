// Road Rage — cash / progression / bike shop / track unlock system

import { TRACKS } from './road';

// ---------------------------------------------------------------------------
// Bike catalog
// ---------------------------------------------------------------------------

export interface BikeStats {
  id: string;
  name: string;
  price: number;
  maxSpeed: number;
  acceleration: number;
  handling: number;
  toughness: number;
  color: string;
}

export const BIKES: BikeStats[] = [
  { id: 'rattler',  name: 'RATTLER',  price: 0,     maxSpeed: 280, acceleration: 180, handling: 1.2, toughness: 0.8, color: '#cc3333' },
  { id: 'venom',    name: 'VENOM',    price: 3000,  maxSpeed: 320, acceleration: 200, handling: 1.0, toughness: 1.0, color: '#33aa33' },
  { id: 'phantom',  name: 'PHANTOM',  price: 6000,  maxSpeed: 350, acceleration: 220, handling: 0.85, toughness: 1.1, color: '#3333cc' },
  { id: 'diablo',   name: 'DIABLO',   price: 12000, maxSpeed: 400, acceleration: 250, handling: 0.7,  toughness: 1.3, color: '#111111' },
];

// ---------------------------------------------------------------------------
// Progression state
// ---------------------------------------------------------------------------

export interface ProgressionState {
  cash: number;
  currentBikeId: string;
  currentTrackIndex: number;
  unlockedTracks: number[];
  ownedBikes: string[];
  raceHistory: Array<{ track: number; position: number; earnings: number }>;
}

const STORAGE_KEY = 'road-rage-progression';

export function createProgression(): ProgressionState {
  return {
    cash: 0,
    currentBikeId: 'rattler',
    currentTrackIndex: 0,
    unlockedTracks: [0],
    ownedBikes: ['rattler'],
    raceHistory: [],
  };
}

// ---------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------

export function calculateEarnings(position: number, trackIndex: number): number {
  const multiplier = trackIndex + 1;
  if (position === 1) return 2000 * multiplier;
  if (position === 2) return 1200 * multiplier;
  if (position === 3) return 600 * multiplier;
  if (position >= 4 && position <= 7) return 200 * multiplier;
  return 0;
}

// ---------------------------------------------------------------------------
// Track advancement
// ---------------------------------------------------------------------------

export function canAdvanceToNextTrack(state: ProgressionState): boolean {
  const nextTrack = state.currentTrackIndex + 1;
  if (nextTrack >= TRACKS.length) return false;
  if (state.unlockedTracks.includes(nextTrack)) return false;
  // Must have a top-3 finish on the current track
  return state.raceHistory.some(
    (r) => r.track === state.currentTrackIndex && r.position <= 3,
  );
}

export function advanceTrack(state: ProgressionState): void {
  if (!canAdvanceToNextTrack(state)) return;
  const nextTrack = state.currentTrackIndex + 1;
  state.unlockedTracks.push(nextTrack);
}

// ---------------------------------------------------------------------------
// Bike purchase
// ---------------------------------------------------------------------------

export function purchaseBike(state: ProgressionState, bikeId: string): boolean {
  const bike = BIKES.find((b) => b.id === bikeId);
  if (!bike) return false;
  if (state.ownedBikes.includes(bikeId)) return false;
  if (state.cash < bike.price) return false;
  state.cash -= bike.price;
  state.ownedBikes.push(bikeId);
  state.currentBikeId = bikeId;
  return true;
}

export function getCurrentBike(state: ProgressionState): BikeStats {
  return BIKES.find((b) => b.id === state.currentBikeId) ?? BIKES[0];
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function saveProgression(state: ProgressionState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* quota / private browsing — silently fail */ }
}

export function loadProgression(): ProgressionState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ProgressionState>;
      const base = createProgression();
      return { ...base, ...parsed };
    }
  } catch { /* corrupt data — start fresh */ }
  return createProgression();
}
