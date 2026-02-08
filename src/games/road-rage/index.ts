// Road Rage — entry point
// Pseudo-3D road engine with race state machine

import { GameLoop } from '../../engine/game-loop';
import { InputManager } from '../../engine/input';
import {
  generateRoad,
  createCamera,
  SEGMENT_LENGTH,
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
} from './road';
import { createPlayer } from './player';
import type { Player } from './player';
import { createRivals } from './rivals';
import { createCombatState } from './combat';
import { createRaceData, resetRace, updateRace, renderRace } from './game';
import { createTraffic } from './traffic';
import {
  createSpeedEffects,
  updateSpeedEffects,
  triggerShake,
  applyRoadRumble,
  renderParallaxBg,
  renderSpeedLines,
  renderVignette,
} from './effects';
import {
  initSounds,
  updateEngine,
  playPunchHit,
  playKickHit,
  playChainHit,
  playClubHit,
  playGrunt,
  playCrash,
  playSirenBurst,
  startSirenLoop,
  stopSirenLoop,
  stopAllSounds,
} from './sounds';
import { getCurrentBike } from './progression';
import type { BikeStats } from './progression';

let loop: GameLoop | null = null;
let input: InputManager | null = null;

export function mount(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot get 2d context');

  let segments = generateRoad();
  let totalLength = segments.length * SEGMENT_LENGTH;
  const camera = createCamera();
  const player = createPlayer();
  let rivals = createRivals(7, totalLength);
  let combat = createCombatState(7);
  const race = createRaceData(segments.length);
  let traffic = createTraffic(20, totalLength);
  const effects = { shakeTimer: 0, shakeIntensity: 0, redFlashAlpha: 0 };
  const speedFx = createSpeedEffects();

  // Initialize audio engine
  initSounds();

  // Apply initial bike stats
  applyBikeStats(player, getCurrentBike(race.progression));

  function rebuildTrack(trackIdx: number): void {
    segments = generateRoad(trackIdx);
    totalLength = segments.length * SEGMENT_LENGTH;
    rivals = createRivals(7, totalLength);
    combat = createCombatState(7);
    traffic = createTraffic(20, totalLength);
    race.raceDistance = segments.length * SEGMENT_LENGTH;

    // Apply bike stats
    applyBikeStats(player, getCurrentBike(race.progression));

    // Reset race state for countdown
    resetRace(race, player, rivals);
    race.state = 'COUNTDOWN';
    race.countdown = 4;
    player.z = 0;
    player.x = 0;
    player.speed = 0;
    for (let i = 0; i < rivals.length; i++) {
      rivals[i].z = 200 + i * 300;
      rivals[i].speed = 0;
    }
    camera.z = 0;
  }

  input = new InputManager();
  input.mapAction('left', 'KeyA', 'ArrowLeft');
  input.mapAction('right', 'KeyD', 'ArrowRight');
  input.mapAction('accel', 'KeyW', 'ArrowUp');
  input.mapAction('brake', 'KeyS', 'ArrowDown');
  input.mapAction('kick', 'Space');
  input.mapAction('punch', 'Enter');

  const update = (dt: number): void => {
    if (!input) return;

    // Check if track select was confirmed — rebuild road & start race
    if (race.trackSelectDone) {
      race.trackSelectDone = false;
      rebuildTrack(race.progression.currentTrackIndex);
      return;
    }

    // Snapshot health before update to detect combat events
    const prevHP = player.health;
    const prevWiped = player.isWipedOut;
    const rivalHP = rivals.map(r => r.health);
    const rivalWiped = rivals.map(r => r.isWipedOut);

    updateRace(race, player, rivals, segments, camera, input, dt, combat, traffic);

    // Engine audio pitch follows speed
    updateEngine(player.speed, player.maxSpeed);

    // Camera shake + sound on taking a hit
    if (player.health < prevHP) {
      playGrunt();
      effects.shakeTimer = 0.2;
      effects.shakeIntensity = 12;
      triggerShake(speedFx, 12, 0.2);
    }
    // Camera shake + sound on landing a hit on a rival
    for (let i = 0; i < rivals.length; i++) {
      if (rivals[i].health < rivalHP[i]) {
        if (combat.weapon.type === 'chain') playChainHit();
        else if (combat.weapon.type === 'club') playClubHit();
        else if (combat.attackType === 'kick') playKickHit();
        else playPunchHit();
        effects.shakeTimer = 0.18;
        effects.shakeIntensity = 8;
        triggerShake(speedFx, 8, 0.18);
        break;
      }
    }
    // Wipeout: red flash + heavy camera bounce + crash sound
    if (player.isWipedOut && !prevWiped) {
      playCrash();
      effects.redFlashAlpha = 0.5;
      effects.shakeTimer = 0.3;
      effects.shakeIntensity = 15;
      triggerShake(speedFx, 15, 0.3);
    }
    // Rival wipeout → crash sound
    for (let i = 0; i < rivals.length; i++) {
      if (rivals[i].isWipedOut && !rivalWiped[i]) {
        playCrash();
        break;
      }
    }

    effects.shakeTimer = Math.max(0, effects.shakeTimer - dt);
    effects.redFlashAlpha = Math.max(0, effects.redFlashAlpha - dt * 2);

    // Police siren sounds
    const ps = race.policeState;
    if (ps.sirenSoundActive && ps.warningTimer > 0 && ps.warningTimer + dt >= 2) {
      playSirenBurst();
    }
    if (ps.sirenSoundActive && ps.cop.active && !ps.cop.isWipedOut) {
      startSirenLoop();
    } else {
      stopSirenLoop();
    }

    updateSpeedEffects(speedFx, dt);

    input.update();
  };

  const render = (_interp: number): void => {
    // Letterbox scaling: render at 800×500 logical, scale to fit viewport
    const scale = Math.min(canvas.width / SCREEN_WIDTH, canvas.height / SCREEN_HEIGHT);
    const offsetX = (canvas.width - SCREEN_WIDTH * scale) / 2;
    const offsetY = (canvas.height - SCREEN_HEIGHT * scale) / 2;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = false;

    // Camera shake — combined original + effects module
    if (effects.shakeTimer > 0) {
      const t = effects.shakeTimer / 0.15;
      const mag = effects.shakeIntensity * Math.min(t, 1);
      ctx.translate(
        (Math.random() - 0.5) * mag + speedFx.shakeX,
        (Math.random() - 0.5) * mag + speedFx.shakeY,
      );
    } else if (speedFx.shakeTimer > 0) {
      ctx.translate(speedFx.shakeX, speedFx.shakeY);
    }

    // Road rumble at high speed
    applyRoadRumble(ctx, player.speed, player.maxSpeed);

    // Parallax mountains behind the road
    renderParallaxBg(ctx, player.x, player.z, player.speed, SCREEN_WIDTH, SCREEN_HEIGHT);

    renderRace(ctx, race, player, rivals, segments, camera, combat, traffic);

    // Speed lines and vignette overlays
    renderSpeedLines(ctx, player.speed, player.maxSpeed, SCREEN_WIDTH, SCREEN_HEIGHT);
    renderVignette(ctx, player.speed, player.maxSpeed, SCREEN_WIDTH, SCREEN_HEIGHT);

    // Red flash overlay (wipeout)
    if (effects.redFlashAlpha > 0) {
      ctx.fillStyle = `rgba(255,0,0,${effects.redFlashAlpha.toFixed(2)})`;
      ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    }

    ctx.restore();
  };

  loop = new GameLoop();
  loop.start(update, render);
}

function applyBikeStats(player: Player, bike: BikeStats): void {
  player.maxSpeed = bike.maxSpeed;
  player.accel = bike.acceleration;
  player.turnSpeed = 3.0 * bike.handling;
  player.maxHealth = Math.round(100 * bike.toughness);
  player.health = player.maxHealth;
}

export function unmount(): void {
  if (loop) {
    loop.stop();
    loop = null;
  }
  if (input) {
    input.destroy();
    input = null;
  }
  stopAllSounds();
}
