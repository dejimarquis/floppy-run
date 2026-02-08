import { Ball, PhysicsWorld, createBall } from './physics';

export interface MultiballState {
  lockedBalls: number;
  isMultiball: boolean;
  multiballTimer: number;
  jackpotValue: number;
  extraBalls: Ball[];
}

export function createMultiballState(): MultiballState {
  return {
    lockedBalls: 0,
    isMultiball: false,
    multiballTimer: 0,
    jackpotValue: 5000,
    extraBalls: [],
  };
}

export function lockBall(state: MultiballState): boolean {
  if (state.isMultiball) return false;
  state.lockedBalls++;
  if (state.lockedBalls >= 3) {
    state.lockedBalls = 0;
    return true; // multiball triggered
  }
  return false;
}

export function startMultiball(state: MultiballState, world: PhysicsWorld): Ball[] {
  state.isMultiball = true;
  state.multiballTimer = 30;

  const positions: [number, number][] = [[150, 300], [250, 300]];
  const newBalls: Ball[] = [];

  for (const [px, py] of positions) {
    const ball = createBall(px, py);
    ball.vx = (Math.random() - 0.5) * 400;
    ball.vy = -Math.random() * 300 - 200;
    ball.speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    newBalls.push(ball);
    world.balls.push(ball);
  }

  state.extraBalls = newBalls;
  return newBalls;
}

export function updateMultiball(state: MultiballState, dt: number, _world: PhysicsWorld): boolean {
  if (!state.isMultiball) return false;

  state.multiballTimer -= dt;

  // Remove drained extra balls
  state.extraBalls = state.extraBalls.filter((b) => b.active);

  if (state.multiballTimer <= 0 || state.extraBalls.length === 0) {
    state.isMultiball = false;
    state.multiballTimer = 0;
    state.jackpotValue += 1000;
    state.extraBalls = [];
    return true; // multiball ended
  }

  return false;
}

export function getJackpotValue(state: MultiballState): number {
  return state.jackpotValue;
}

export function isMultiballActive(state: MultiballState): boolean {
  return state.isMultiball;
}
