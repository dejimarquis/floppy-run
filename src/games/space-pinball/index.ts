import {
  createPhysicsWorld,
  createBall,
  stepPhysics,
  launchBall,
  PhysicsWorld,
  Ball,
  CollisionEvent,
} from './physics';
import { buildTable, getTableElements, TableElement } from './table';
import { createTiltState, nudgeTable, updateTilt, TiltState } from './tilt';
import {
  createRenderState,
  updateRenderState,
  render,
  triggerBumperFlash,
  triggerSlingFlash,
  addScorePopup,
  RenderState,
} from './renderer';
import {
  createScoreState,
  processCollision,
  updateScoring,
  drainBall,
  consumeScoreEvents,
  ScoreState,
} from './scoring';
import {
  createPinballAudio,
  playFlipperSound,
  playBumperSound,
  playSlingSound,
  playRampSound,
  playDropTargetSound,
  playRolloverSound,
  playSpinnerSound,
  playDrainSound,
  playLaunchSound,
  playTiltSound,
  playGameOverSound,
  playAllTargetsSound,
  playSkillShotSound,
  playBonusSound,
  toggleMute,
  PinballAudio,
} from './sound';
import {
  createMissionState,
  startNextMission,
  onDropTarget,
  onRamp,
  onRollover,
  onBumper,
  getMissionDisplay,
  MissionState,
} from './missions';
import {
  createMultiballState,
  lockBall,
  startMultiball,
  updateMultiball,
  isMultiballActive,
  getJackpotValue,
  MultiballState,
} from './multiball';
import {
  createMenuState,
  updateMenu,
  handleMenuInput,
  renderTitle,
  renderGameOver,
  renderControls,
  saveScore,
  MenuState,
} from './menus';

// ── Game State ──────────────────────────────────────────────────────
interface GameState {
  world: PhysicsWorld;
  ball: Ball;
  tilt: TiltState;
  scoring: ScoreState;
  renderState: RenderState;
  audio: PinballAudio;
  elements: TableElement[];
  missions: MissionState;
  multiball: MultiballState;
  menu: MenuState;
  leftFlipperPressed: boolean;
  rightFlipperPressed: boolean;
  plungerHeld: boolean;
  plungerPower: number;
  lastTime: number;
  animFrame: number;
  gameOver: boolean;
}

let state: GameState | null = null;
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

// ── Input Handling ──────────────────────────────────────────────────
function onKeyDown(e: KeyboardEvent): void {
  if (!state) return;

  // Menu input
  if (state.menu.screen !== 'playing' || state.menu.showControls) {
    const action = handleMenuInput(state.menu, e.code);
    if (action === 'start') {
      state.menu.screen = 'playing';
      startNextMission(state.missions);
    } else if (action === 'toggle_controls') {
      state.menu.showControls = !state.menu.showControls;
    } else if (action === 'restart') {
      restartGame();
      state.menu.screen = 'playing';
      state.menu.gameOverTimer = 0;
    }
    return;
  }

  // Mute toggle
  if (e.code === 'KeyM') {
    toggleMute(state.audio);
    return;
  }

  // Controls overlay
  if (e.code === 'KeyH') {
    state.menu.showControls = true;
    return;
  }

  switch (e.code) {
    case 'ShiftLeft':
    case 'KeyZ':
      if (!state.leftFlipperPressed) {
        state.leftFlipperPressed = true;
        playFlipperSound(state.audio);
      }
      break;
    case 'ShiftRight':
    case 'Slash':
      if (!state.rightFlipperPressed) {
        state.rightFlipperPressed = true;
        playFlipperSound(state.audio);
      }
      break;
    case 'Space':
      e.preventDefault();
      if (state.gameOver) {
        saveScore(state.scoring.score);
        state.menu.screen = 'game_over';
        state.menu.gameOverTimer = 0;
        state.menu.highScores = state.menu.highScores; // will refresh on restart
        return;
      }
      state.plungerHeld = true;
      break;
    case 'ArrowLeft':
      applyNudge('left');
      break;
    case 'ArrowRight':
      applyNudge('right');
      break;
    case 'ArrowUp':
      applyNudge('up');
      break;
  }
}

function onKeyUp(e: KeyboardEvent): void {
  if (!state || state.menu.screen !== 'playing') return;
  switch (e.code) {
    case 'ShiftLeft':
    case 'KeyZ':
      state.leftFlipperPressed = false;
      break;
    case 'ShiftRight':
    case 'Slash':
      state.rightFlipperPressed = false;
      break;
    case 'Space':
      if (state.plungerHeld) {
        state.plungerHeld = false;
        if (!state.ball.active && !state.gameOver) {
          resetBall(state);
        }
        state.plungerPower = state.world.plunger.power;
        launchBall(state.world.plunger, state.ball);
        if (state.plungerPower > 0) {
          playLaunchSound(state.audio, state.plungerPower);
        }
      }
      break;
  }
}

function applyNudge(direction: 'left' | 'right' | 'up'): void {
  if (!state) return;
  const wasTilted = state.tilt.isTilted;
  const impulse = nudgeTable(state.tilt, direction);
  if (state.ball.active) {
    state.ball.vx += impulse.dx;
    state.ball.vy += impulse.dy;
  }
  if (!wasTilted && state.tilt.isTilted) {
    playTiltSound(state.audio);
  }
}

function resetBall(gs: GameState): void {
  gs.ball.x = gs.world.plunger.x;
  gs.ball.y = gs.world.plunger.yBottom - 15;
  gs.ball.vx = 0;
  gs.ball.vy = 0;
  gs.ball.active = true;
  gs.ball.speed = 0;
}

function initGameState(): void {
  if (!canvas || !ctx) return;
  const world = createPhysicsWorld();
  buildTable(world);
  const ball = createBall(world.plunger.x, world.plunger.yBottom - 15);
  world.balls.push(ball);

  const missions = createMissionState();

  state = {
    world,
    ball,
    tilt: createTiltState(),
    scoring: createScoreState(),
    renderState: createRenderState(),
    audio: state?.audio ?? createPinballAudio(),
    elements: getTableElements(),
    missions,
    multiball: createMultiballState(),
    menu: state?.menu ?? createMenuState(),
    leftFlipperPressed: false,
    rightFlipperPressed: false,
    plungerHeld: false,
    plungerPower: 0,
    lastTime: performance.now(),
    animFrame: 0,
    gameOver: false,
  };
}

function restartGame(): void {
  const prevAudio = state?.audio;
  const prevMenu = state?.menu;
  initGameState();
  if (state && prevAudio) state.audio = prevAudio;
  if (state && prevMenu) {
    state.menu = prevMenu;
  }
  if (state) startNextMission(state.missions);
}

// ── Collision Event Handling ────────────────────────────────────────
function handleEvents(events: CollisionEvent[], gs: GameState): void {
  for (const ev of events) {
    if (ev.type === 'drain') {
      // During multiball, only extra balls drain without penalty
      if (isMultiballActive(gs.multiball)) {
        continue; // multiball module handles extra ball cleanup
      }
      const isOver = drainBall(gs.scoring);
      if (isOver) {
        gs.gameOver = true;
        playGameOverSound(gs.audio);
        saveScore(gs.scoring.score);
      } else {
        playDrainSound(gs.audio);
        resetBall(gs);
        // Start next mission if current is completed
        if (gs.missions.currentMission?.completed) {
          startNextMission(gs.missions);
        }
      }
      continue;
    }

    // Process scoring
    processCollision(gs.scoring, ev, gs.elements, gs.world);

    // Mission tracking + multiball
    if (ev.type === 'bumper') {
      const el = gs.elements.find(
        (e) => e.index === ev.index && (e.type === 'bumper' || e.type === 'rollover' || e.type === 'spinner'),
      );
      if (el?.type === 'bumper') {
        const bumperEls = gs.elements.filter(e => e.type === 'bumper');
        const bi = bumperEls.indexOf(el);
        triggerBumperFlash(gs.renderState, bi);
        playBumperSound(gs.audio, Math.min(1, ev.velocity / 1000));
        onBumper(gs.missions);
        // Multiball jackpot during multiball
        if (isMultiballActive(gs.multiball)) {
          const jp = getJackpotValue(gs.multiball);
          gs.scoring.score += jp;
          addScorePopup(gs.renderState, gs.world.circles[ev.index].x, gs.world.circles[ev.index].y - 15, `JACKPOT ${jp}`);
        }
      } else if (el?.type === 'rollover') {
        playRolloverSound(gs.audio);
        if (onRollover(gs.missions) && gs.missions.currentMission?.completed) {
          gs.scoring.score += gs.missions.currentMission.reward;
          addScorePopup(gs.renderState, 200, 200, `MISSION! +${gs.missions.currentMission.reward}`);
          playBonusSound(gs.audio);
        }
      } else if (el?.type === 'spinner') {
        gs.renderState.spinnerAngle += Math.PI / 2;
        playSpinnerSound(gs.audio);
      }
    } else if (ev.type === 'wall') {
      const el = gs.elements.find(
        (e) => e.index === ev.index && (e.type === 'slingshot' || e.type === 'ramp' || e.type === 'drop_target'),
      );
      if (el?.type === 'slingshot') {
        const slingEls = gs.elements.filter(e => e.type === 'slingshot');
        const side = slingEls.indexOf(el) < 3 ? 0 : 1;
        triggerSlingFlash(gs.renderState, side);
        playSlingSound(gs.audio);
      } else if (el?.type === 'ramp') {
        playRampSound(gs.audio);
        if (onRamp(gs.missions) && gs.missions.currentMission?.completed) {
          gs.scoring.score += gs.missions.currentMission.reward;
          addScorePopup(gs.renderState, 200, 200, `MISSION! +${gs.missions.currentMission.reward}`);
          playBonusSound(gs.audio);
        }
        // Multiball lock on center ramp at high speed
        if (ev.velocity > 800 && !isMultiballActive(gs.multiball)) {
          const triggered = lockBall(gs.multiball);
          if (triggered) {
            const newBalls = startMultiball(gs.multiball, gs.world);
            addScorePopup(gs.renderState, 200, 300, 'MULTIBALL!');
            playAllTargetsSound(gs.audio);
            // Add new balls to the world (already done in startMultiball)
            void newBalls;
          } else {
            addScorePopup(gs.renderState, 200, 300, `BALL ${gs.multiball.lockedBalls} LOCKED`);
            playBonusSound(gs.audio);
          }
        }
      } else if (el?.type === 'drop_target') {
        playDropTargetSound(gs.audio);
        if (onDropTarget(gs.missions) && gs.missions.currentMission?.completed) {
          gs.scoring.score += gs.missions.currentMission.reward;
          addScorePopup(gs.renderState, 200, 320, `MISSION! +${gs.missions.currentMission.reward}`);
          playBonusSound(gs.audio);
        }
      }
    }
  }

  // Process score events → popup text + special sounds
  const scoreEvts = consumeScoreEvents(gs.scoring);
  for (const se of scoreEvts) {
    addScorePopup(gs.renderState, se.x, se.y, se.message);
    if (se.type === 'all_targets') playAllTargetsSound(gs.audio);
    if (se.type === 'skill_shot') playSkillShotSound(gs.audio);
    if (se.type === 'all_lanes' || se.type === 'multiplier_up') playBonusSound(gs.audio);
  }
}

// ── Game Loop ───────────────────────────────────────────────────────
function gameLoop(time: number): void {
  if (!state || !ctx || !canvas) return;

  const dt = Math.min((time - state.lastTime) / 1000, 1 / 30);
  state.lastTime = time;

  // Menu update (always runs for animations)
  updateMenu(state.menu, dt);

  if (state.menu.screen === 'title') {
    renderTitle(ctx, canvas, state.menu);
    state.animFrame = requestAnimationFrame(gameLoop);
    return;
  }

  if (state.menu.screen === 'playing' && !state.menu.showControls) {
    if (!state.gameOver) {
      // Flipper input → physics
      const flippersDisabled = state.tilt.isTilted;
      if (state.world.flippers.length >= 2) {
        state.world.flippers[0].isPressed = !flippersDisabled && state.leftFlipperPressed;
        state.world.flippers[1].isPressed = !flippersDisabled && state.rightFlipperPressed;
        if (state.world.flippers.length >= 3) {
          state.world.flippers[2].isPressed = !flippersDisabled && state.rightFlipperPressed;
        }
      }

      // Plunger
      state.world.plunger.isHeld = state.plungerHeld;

      // Physics step
      const events = stepPhysics(state.world, dt);
      handleEvents(events, state);

      // Tilt update
      updateTilt(state.tilt, dt);

      // Scoring timer
      updateScoring(state.scoring, dt);

      // Multiball timer
      updateMultiball(state.multiball, dt, state.world);
    }

    // Render state update
    updateRenderState(state.renderState, dt, state.ball);

    // Render table
    render(
      ctx,
      canvas,
      state.world,
      state.ball,
      state.renderState,
      state.tilt,
      state.scoring.score,
      state.scoring.highScore,
      state.scoring.ballsLeft,
      state.scoring.multiplier,
      state.elements,
      state.gameOver,
    );

    // Mission display overlay
    const missionInfo = getMissionDisplay(state.missions);
    if (missionInfo && !state.gameOver) {
      const sx = canvas.width / 400;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(canvas.width * 0.1, 50 * (canvas.height / 700), canvas.width * 0.8, 30 * (canvas.height / 700));
      ctx.fillStyle = '#00ccff';
      ctx.font = `bold ${Math.round(10 * sx)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`${missionInfo.title}: ${missionInfo.progress}`, canvas.width / 2, 68 * (canvas.height / 700));
    }

    // Rank display
    if (state.missions.rank > 0 && !state.gameOver) {
      const sx = canvas.width / 400;
      ctx.fillStyle = '#ffd700';
      ctx.font = `${Math.round(8 * sx)}px monospace`;
      ctx.textAlign = 'left';
      ctx.fillText(`RANK: ${state.missions.rankNames[state.missions.rank]}`, 6 * sx, 54 * (canvas.height / 700));
    }

    // Multiball indicator
    if (isMultiballActive(state.multiball)) {
      const sx = canvas.width / 400;
      const flash = 0.5 + 0.5 * Math.sin(Date.now() * 0.01);
      ctx.fillStyle = `rgba(255,100,0,${flash})`;
      ctx.font = `bold ${Math.round(12 * sx)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`MULTIBALL ${Math.ceil(state.multiball.multiballTimer)}s`, canvas.width / 2, canvas.height - 20 * (canvas.height / 700));
    }
  }

  // Game over → show game over screen after a moment
  if (state.gameOver && state.menu.screen === 'playing') {
    state.menu.screen = 'game_over';
    state.menu.gameOverTimer = 0;
    saveScore(state.scoring.score);
    state.menu.highScores = (() => {
      try {
        const raw = localStorage.getItem('floppy_pinball_scores');
        if (raw) {
          const parsed = JSON.parse(raw) as number[];
          return parsed.sort((a: number, b: number) => b - a).slice(0, 5);
        }
      } catch { /* ignore */ }
      return [0, 0, 0, 0, 0];
    })();
  }

  if (state.menu.screen === 'game_over') {
    // Render table underneath (frozen)
    render(
      ctx,
      canvas,
      state.world,
      state.ball,
      state.renderState,
      state.tilt,
      state.scoring.score,
      state.scoring.highScore,
      state.scoring.ballsLeft,
      state.scoring.multiplier,
      state.elements,
      false, // don't show built-in game over overlay
    );
    renderGameOver(ctx, canvas, state.menu, state.scoring.score);
  }

  // Controls overlay
  if (state.menu.showControls) {
    renderControls(ctx, canvas);
  }

  state.animFrame = requestAnimationFrame(gameLoop);
}

// ── Mount / Unmount ─────────────────────────────────────────────────
export function mount(canvasEl: HTMLCanvasElement): void {
  canvas = canvasEl;
  ctx = canvas.getContext('2d');
  if (!ctx) return;

  initGameState();
  if (!state) return;

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  state.animFrame = requestAnimationFrame(gameLoop);
}

export function unmount(): void {
  if (state) {
    cancelAnimationFrame(state.animFrame);
  }
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  state = null;
  canvas = null;
  ctx = null;
}
