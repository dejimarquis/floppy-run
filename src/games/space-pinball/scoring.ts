import { CollisionEvent, PhysicsWorld } from './physics';
import { TableElement } from './table';

// ── Interfaces ──────────────────────────────────────────────────────
export interface ScoreState {
  score: number;
  multiplier: number;
  combo: number;
  comboTimer: number;
  highScore: number;
  ballsLeft: number;
  currentBall: number;
  bonusMultiplier: number;

  dropTargetsHit: boolean[];
  rolloverLanesLit: boolean[];
  rampCount: number;
  spinnerHits: number;
  bumperHits: number;

  isSkillShot: boolean;
  skillShotTarget: number;

  scoreEvents: ScoreEvent[];
}

export interface ScoreEvent {
  type: 'points' | 'multiplier_up' | 'all_targets' | 'all_lanes' | 'skill_shot' | 'combo';
  points: number;
  x: number;
  y: number;
  message: string;
}

const HIGH_SCORE_KEY = 'floppy_pinball_highscore';
const COMBO_WINDOW = 2;
const MAX_MULTIPLIER = 5;

// ── Factory ─────────────────────────────────────────────────────────
export function createScoreState(): ScoreState {
  return {
    score: 0,
    multiplier: 1,
    combo: 0,
    comboTimer: 0,
    highScore: loadHighScore(),
    ballsLeft: 3,
    currentBall: 1,
    bonusMultiplier: 1,

    dropTargetsHit: [false, false, false],
    rolloverLanesLit: [false, false, false],
    rampCount: 0,
    spinnerHits: 0,
    bumperHits: 0,

    isSkillShot: true,
    skillShotTarget: Math.floor(Math.random() * 3),

    scoreEvents: [],
  };
}

// ── Helpers ─────────────────────────────────────────────────────────
function addPoints(state: ScoreState, pts: number, x: number, y: number, message: string): void {
  state.score += pts;
  state.scoreEvents.push({ type: 'points', points: pts, x, y, message });
}

function advanceCombo(state: ScoreState, x: number, y: number): void {
  state.comboTimer = COMBO_WINDOW;
  state.combo++;

  if (state.combo >= 10) {
    const bonus = 2000;
    state.score += bonus;
    state.scoreEvents.push({ type: 'combo', points: bonus, x, y, message: 'MEGA COMBO!' });
  } else if (state.combo >= 5) {
    const bonus = 500 * state.combo;
    state.score += bonus;
    state.scoreEvents.push({ type: 'combo', points: bonus, x, y, message: `COMBO x${state.combo}!` });
  }
}

function getCollisionPosition(event: CollisionEvent, world: PhysicsWorld): { x: number; y: number } {
  if (event.type === 'bumper') {
    const c = world.circles[event.index];
    return c ? { x: c.x, y: c.y } : { x: 200, y: 350 };
  }
  if (event.type === 'wall') {
    const l = world.lines[event.index];
    return l ? { x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 } : { x: 200, y: 350 };
  }
  return { x: 200, y: 350 };
}

function findElement(
  event: CollisionEvent,
  elements: TableElement[],
): TableElement | undefined {
  if (event.type === 'bumper') {
    // Circle colliders → bumper, rollover, or spinner
    return elements.find((e) => e.index === event.index && (e.type === 'bumper' || e.type === 'rollover' || e.type === 'spinner'));
  }
  if (event.type === 'wall') {
    // Line colliders → slingshot, ramp, drop_target
    return elements.find((e) => e.index === event.index && (e.type === 'slingshot' || e.type === 'ramp' || e.type === 'drop_target'));
  }
  return undefined;
}

// ── Process Collision ───────────────────────────────────────────────
export function processCollision(
  state: ScoreState,
  event: CollisionEvent,
  elements: TableElement[],
  world: PhysicsWorld,
): void {
  if (event.type === 'flipper' || event.type === 'drain') return;

  const element = findElement(event, elements);
  if (!element || !element.active) return;

  const pos = getCollisionPosition(event, world);

  // Skill shot check — must happen before any scoring
  if (state.isSkillShot) {
    state.isSkillShot = false;
    if (element.type === 'rollover') {
      const rolloverElements = elements.filter((e) => e.type === 'rollover');
      const rolloverIdx = rolloverElements.indexOf(element);
      if (rolloverIdx === state.skillShotTarget) {
        const pts = 10000;
        state.score += pts;
        state.scoreEvents.push({ type: 'skill_shot', points: pts, x: pos.x, y: pos.y, message: 'SKILL SHOT!' });
      }
    }
  }

  // Score based on element type
  let pts = 0;
  switch (element.type) {
    case 'bumper': {
      pts = 100 * state.multiplier;
      state.bumperHits++;
      addPoints(state, pts, pos.x, pos.y, `${pts}`);
      break;
    }
    case 'slingshot': {
      pts = 10 * state.multiplier;
      addPoints(state, pts, pos.x, pos.y, `${pts}`);
      break;
    }
    case 'drop_target': {
      pts = 250 * state.multiplier;
      addPoints(state, pts, pos.x, pos.y, `${pts}`);

      // Mark this target hit
      const dropElements = elements.filter((e) => e.type === 'drop_target');
      const dropIdx = dropElements.indexOf(element);
      if (dropIdx >= 0 && dropIdx < state.dropTargetsHit.length) {
        state.dropTargetsHit[dropIdx] = true;
        element.active = false;
      }

      // Check all drop targets
      if (state.dropTargetsHit.every(Boolean)) {
        const bonus = 5000;
        state.score += bonus;
        state.scoreEvents.push({ type: 'all_targets', points: bonus, x: pos.x, y: pos.y, message: 'ALL TARGETS! +5000' });
        state.bonusMultiplier++;
        if (state.multiplier < MAX_MULTIPLIER) {
          state.multiplier++;
          state.scoreEvents.push({ type: 'multiplier_up', points: 0, x: pos.x, y: pos.y - 20, message: `${state.multiplier}X MULTIPLIER` });
        }
        // Reset drop targets
        state.dropTargetsHit = [false, false, false];
        for (const el of dropElements) el.active = true;
      }
      break;
    }
    case 'rollover': {
      pts = 50 * state.multiplier;
      addPoints(state, pts, pos.x, pos.y, `${pts}`);

      const rolloverElements = elements.filter((e) => e.type === 'rollover');
      const rolloverIdx = rolloverElements.indexOf(element);
      if (rolloverIdx >= 0 && rolloverIdx < state.rolloverLanesLit.length) {
        state.rolloverLanesLit[rolloverIdx] = true;
      }

      // Check all lanes lit
      if (state.rolloverLanesLit.every(Boolean)) {
        const bonus = 2000;
        state.score += bonus;
        state.scoreEvents.push({ type: 'all_lanes', points: bonus, x: pos.x, y: pos.y, message: 'ALL LANES! +2000' });
        if (state.multiplier < MAX_MULTIPLIER) {
          state.multiplier++;
          state.scoreEvents.push({ type: 'multiplier_up', points: 0, x: pos.x, y: pos.y - 20, message: `${state.multiplier}X MULTIPLIER` });
        }
        state.rolloverLanesLit = [false, false, false];
      }
      break;
    }
    case 'ramp': {
      pts = element.points * state.multiplier;
      state.rampCount++;
      addPoints(state, pts, pos.x, pos.y, `${pts}`);

      if (state.rampCount % 3 === 0) {
        const bonus = 3000;
        state.score += bonus;
        state.scoreEvents.push({ type: 'points', points: bonus, x: pos.x, y: pos.y - 20, message: 'RAMP BONUS! +3000' });
      }
      break;
    }
    case 'spinner': {
      pts = 25 * state.multiplier;
      state.spinnerHits++;
      addPoints(state, pts, pos.x, pos.y, `${pts}`);

      if (state.spinnerHits % 10 === 0) {
        const bonus = 1000;
        state.score += bonus;
        state.scoreEvents.push({ type: 'points', points: bonus, x: pos.x, y: pos.y - 20, message: 'SPINNER BONUS! +1000' });
      }
      break;
    }
  }

  advanceCombo(state, pos.x, pos.y);
}

// ── Timer Update (call each frame) ─────────────────────────────────
export function updateScoring(state: ScoreState, dt: number): void {
  if (state.comboTimer > 0) {
    state.comboTimer -= dt;
    if (state.comboTimer <= 0) {
      state.comboTimer = 0;
      state.combo = 0;
    }
  }
}

// ── Ball Drain ──────────────────────────────────────────────────────
export function drainBall(state: ScoreState): boolean {
  const bonus = getEndOfBallBonus(state);
  state.score += bonus;
  state.scoreEvents.push({ type: 'points', points: bonus, x: 200, y: 350, message: `BALL BONUS: ${bonus}` });

  state.ballsLeft--;
  if (state.ballsLeft <= 0) {
    saveHighScore(state);
    return true; // game over
  }

  // Prepare next ball
  state.currentBall++;
  state.multiplier = 1;
  state.combo = 0;
  state.comboTimer = 0;
  state.isSkillShot = true;
  state.skillShotTarget = Math.floor(Math.random() * 3);
  return false;
}

// ── End-of-Ball Bonus ───────────────────────────────────────────────
export function getEndOfBallBonus(state: ScoreState): number {
  const hitTargets = state.dropTargetsHit.filter(Boolean).length;
  return (state.bumperHits * 10 + state.rampCount * 200 + hitTargets * 500) * state.bonusMultiplier;
}

// ── High Score Persistence ──────────────────────────────────────────
export function saveHighScore(state: ScoreState): void {
  if (state.score > state.highScore) {
    state.highScore = state.score;
    try {
      localStorage.setItem(HIGH_SCORE_KEY, String(state.highScore));
    } catch {
      // localStorage unavailable
    }
  }
}

export function loadHighScore(): number {
  try {
    const stored = localStorage.getItem(HIGH_SCORE_KEY);
    return stored ? parseInt(stored, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

// ── Event Consumer ──────────────────────────────────────────────────
export function consumeScoreEvents(state: ScoreState): ScoreEvent[] {
  const events = state.scoreEvents;
  state.scoreEvents = [];
  return events;
}
