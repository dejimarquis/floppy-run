// ── Tilt Mechanic ───────────────────────────────────────────────────

export interface TiltState {
  nudgeCount: number;
  nudgeDecayTimer: number;
  isTilted: boolean;
  tiltTimer: number;
  tableOffsetX: number;
  tableOffsetY: number;
}

export function createTiltState(): TiltState {
  return {
    nudgeCount: 0,
    nudgeDecayTimer: 0,
    isTilted: false,
    tiltTimer: 0,
    tableOffsetX: 0,
    tableOffsetY: 0,
  };
}

const NUDGE_FORCE = 120;
const NUDGE_DECAY_INTERVAL = 2; // seconds per -1 nudge
const TILT_THRESHOLD = 4;
const TILT_PENALTY_DURATION = 3; // seconds
const VISUAL_SHAKE = 3; // px

export function nudgeTable(
  state: TiltState,
  direction: 'left' | 'right' | 'up',
): { dx: number; dy: number } {
  if (state.isTilted) return { dx: 0, dy: 0 };

  state.nudgeCount++;
  state.nudgeDecayTimer = 0;

  // Visual shake
  switch (direction) {
    case 'left':
      state.tableOffsetX = -VISUAL_SHAKE;
      break;
    case 'right':
      state.tableOffsetX = VISUAL_SHAKE;
      break;
    case 'up':
      state.tableOffsetY = -VISUAL_SHAKE;
      break;
  }

  // Check for tilt
  if (state.nudgeCount > TILT_THRESHOLD) {
    state.isTilted = true;
    state.tiltTimer = TILT_PENALTY_DURATION;
    return { dx: 0, dy: 0 };
  }

  // Return impulse to apply to ball
  switch (direction) {
    case 'left':
      return { dx: -NUDGE_FORCE, dy: 0 };
    case 'right':
      return { dx: NUDGE_FORCE, dy: 0 };
    case 'up':
      return { dx: 0, dy: -NUDGE_FORCE };
  }
}

export function updateTilt(state: TiltState, dt: number): void {
  // Decay visual shake toward zero
  state.tableOffsetX *= Math.max(0, 1 - dt * 15);
  state.tableOffsetY *= Math.max(0, 1 - dt * 15);
  if (Math.abs(state.tableOffsetX) < 0.1) state.tableOffsetX = 0;
  if (Math.abs(state.tableOffsetY) < 0.1) state.tableOffsetY = 0;

  if (state.isTilted) {
    state.tiltTimer -= dt;
    if (state.tiltTimer <= 0) {
      state.isTilted = false;
      state.tiltTimer = 0;
      state.nudgeCount = 0;
    }
    return;
  }

  // Decay nudge count over time
  state.nudgeDecayTimer += dt;
  if (state.nudgeDecayTimer >= NUDGE_DECAY_INTERVAL && state.nudgeCount > 0) {
    state.nudgeCount--;
    state.nudgeDecayTimer = 0;
  }
}
