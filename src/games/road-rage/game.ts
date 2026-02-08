// Road Rage — race state machine (TITLE → TRACK_SELECT → COUNTDOWN → RACING → FINISHED → BIKE_SHOP → TRACK_SELECT)

import type { InputManager } from '../../engine/input';
import type { Player } from './player';
import type { Rival } from './rivals';
import type { RoadSegment, Camera } from './road';
import { SEGMENT_LENGTH, SCREEN_WIDTH, SCREEN_HEIGHT, TRACKS } from './road';
import { renderRoad } from './renderer';
import { updatePlayer, drawPlayerBike } from './player';
import { updateRivals, renderRivals, renderRivalPortrait } from './rivals';
import { type CombatState, updateCombat, renderCombatArm } from './combat';
import { type Vehicle, updateTraffic, checkVehicleCollision, renderVehicle } from './traffic';
import {
  type PoliceState,
  createPoliceState,
  updatePolice,
  incrementCombatCount,
  checkCopHit,
  hitCop,
  resetPolice,
  renderCop,
  renderPoliceHUD,
  renderBustedScreen,
} from './police';
import {
  type HUDState,
  createHUDState,
  updateHUD,
  triggerDamageFlash,
  calculatePosition,
  renderHUD,
} from './hud';
import {
  type ProgressionState,
  type BikeStats,
  BIKES,
  loadProgression,
  saveProgression,
  calculateEarnings,
  canAdvanceToNextTrack,
  advanceTrack,
  getCurrentBike,
  purchaseBike,
} from './progression';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RaceState = 'TITLE' | 'TRACK_SELECT' | 'BIKE_SHOP' | 'COUNTDOWN' | 'RACING' | 'FINISHED' | 'BUSTED';

export interface RaceResult {
  name: string;
  position: number;
  time: number;
}

export interface RaceData {
  state: RaceState;
  countdown: number;
  raceDistance: number;
  playerFinished: boolean;
  finishPosition: number;
  raceTimer: number;
  results: RaceResult[];
  // internal bookkeeping
  nextPosition: number;
  blinkTimer: number;
  hudState: HUDState;
  prevHealth: number;
  // progression / menus
  progression: ProgressionState;
  earnings: number;
  menuCursor: number;
  shopScrollOffset: number;
  trackSelectDone: boolean;
  policeState: PoliceState;
  // Combat juice
  damagePopups: { x: number; y: number; text: string; timer: number; critical: boolean }[];
  hitFreezeTimer: number;
  combatHintTimer: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ~2-3 min at full speed: 5000 segments * SEGMENT_LENGTH
const RACE_SEGMENTS = 5000;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRaceData(segmentCount: number): RaceData {
  return {
    state: 'TITLE',
    countdown: 4, // starts at 4 so first tick brings it to 3
    raceDistance: RACE_SEGMENTS * SEGMENT_LENGTH,
    playerFinished: false,
    finishPosition: 0,
    raceTimer: 0,
    results: [],
    nextPosition: 1,
    blinkTimer: 0,
    hudState: createHUDState(),
    prevHealth: 100,
    progression: loadProgression(),
    earnings: 0,
    menuCursor: 0,
    shopScrollOffset: 0,
    trackSelectDone: false,
    policeState: createPoliceState(),
    damagePopups: [],
    hitFreezeTimer: 0,
    combatHintTimer: 8,
  };
}

// ---------------------------------------------------------------------------
// Reset helpers
// ---------------------------------------------------------------------------

export function resetRace(
  race: RaceData,
  player: Player,
  rivals: Rival[],
): void {
  race.state = 'TITLE';
  race.countdown = 4;
  race.playerFinished = false;
  race.finishPosition = 0;
  race.raceTimer = 0;
  race.results = [];
  race.nextPosition = 1;
  race.blinkTimer = 0;
  race.hudState = createHUDState();
  race.prevHealth = player.maxHealth;
  resetPolice(race.policeState);

  // Reset player
  player.x = 0;
  player.z = 0;
  player.speed = 0;
  player.health = player.maxHealth;
  player.isWipedOut = false;
  player.wipeoutTimer = 0;
  player.lean = 0;
  player.animationFrame = 'straight';
  player.wipeoutPhase = 'none';
  player.wipeoutPhaseTimer = 0;
  player.riderOffsetX = 0;
  player.riderOffsetY = 0;
  player.riderRotation = 0;
  player.bikeSlideX = 0;
  player.bikeSlideSpeed = 0;
  player.wheelieTimer = 0;
  player.offroad = false;
  player.draftBoost = 0;
  player.gear = 1;
  player.prevSpeed = 0;

  // Reset rivals to staggered start positions
  for (let i = 0; i < rivals.length; i++) {
    const r = rivals[i];
    r.x = -0.6 + (1.2 * i) / Math.max(rivals.length - 1, 1);
    r.z = 300 + i * 350;
    r.speed = 0;
    r.health = r.maxHealth;
    r.isWipedOut = false;
    r.wipeoutTimer = 0;
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export function updateRace(
  race: RaceData,
  player: Player,
  rivals: Rival[],
  segments: RoadSegment[],
  camera: Camera,
  input: InputManager,
  dt: number,
  combat?: CombatState,
  traffic?: Vehicle[],
): void {
  const totalLength = segments.length * SEGMENT_LENGTH;

  switch (race.state) {
    // ------------------------------------------------------------------
    case 'TITLE': {
      race.blinkTimer += dt;
      // Slowly scroll camera for scenic background
      camera.z = (camera.z + 20 * dt) % totalLength;
      camera.x = 0;

      if (input.justPressed('Space') || input.justPressed('Enter')) {
        race.trackSelectDone = true;
        race.blinkTimer = 0;
      }
      break;
    }

    // ------------------------------------------------------------------
    case 'TRACK_SELECT': {
      race.blinkTimer += dt;
      camera.z = (camera.z + 20 * dt) % totalLength;
      camera.x = 0;

      if (input.justPressed('ArrowUp') || input.justPressed('KeyW')) {
        race.menuCursor = Math.max(0, race.menuCursor - 1);
      }
      if (input.justPressed('ArrowDown') || input.justPressed('KeyS')) {
        race.menuCursor = Math.min(TRACKS.length - 1, race.menuCursor + 1);
      }
      if (input.justPressed('Space')) {
        const idx = race.menuCursor;
        if (race.progression.unlockedTracks.includes(idx)) {
          race.progression.currentTrackIndex = idx;
          race.trackSelectDone = true;
          // Transition to COUNTDOWN handled by index.ts (rebuilds road)
        }
      }
      // Allow jumping to bike shop with B key
      if (input.justPressed('KeyB')) {
        race.state = 'BIKE_SHOP';
        race.menuCursor = 0;
        race.blinkTimer = 0;
      }
      break;
    }

    // ------------------------------------------------------------------
    case 'BIKE_SHOP': {
      race.blinkTimer += dt;
      camera.z = (camera.z + 20 * dt) % totalLength;
      camera.x = 0;

      if (input.justPressed('ArrowUp') || input.justPressed('KeyW')) {
        race.menuCursor = Math.max(0, race.menuCursor - 1);
      }
      if (input.justPressed('ArrowDown') || input.justPressed('KeyS')) {
        race.menuCursor = Math.min(BIKES.length - 1, race.menuCursor + 1);
      }
      if (input.justPressed('Space')) {
        const bike = BIKES[race.menuCursor];
        if (race.progression.ownedBikes.includes(bike.id)) {
          // Select owned bike
          race.progression.currentBikeId = bike.id;
          saveProgression(race.progression);
        } else {
          // Try to purchase
          purchaseBike(race.progression, bike.id);
          saveProgression(race.progression);
        }
      }
      // Escape / Backspace → back to track select
      if (input.justPressed('Escape') || input.justPressed('Backspace') || input.justPressed('KeyB')) {
        race.state = 'TRACK_SELECT';
        race.menuCursor = race.progression.currentTrackIndex;
        race.blinkTimer = 0;
      }
      break;
    }

    // ------------------------------------------------------------------
    case 'COUNTDOWN': {
      race.countdown -= dt;
      // Rival engine wobble
      for (const r of rivals) {
        r.x += (Math.random() - 0.5) * 0.02;
        r.x = Math.max(-1, Math.min(1, r.x));
      }
      camera.z = player.z;
      camera.x = 0;

      if (race.countdown <= 0) {
        race.state = 'RACING';
        race.raceTimer = 0;
      }
      break;
    }

    // ------------------------------------------------------------------
    case 'RACING': {
      // Hit freeze — pause all game logic for impact effect
      if (race.hitFreezeTimer > 0) {
        race.hitFreezeTimer -= dt;
        break;
      }
      race.raceTimer += dt;

      updatePlayer(player, input, segments, dt, rivals);

      const playerHit = updateRivals(rivals, player, segments, dt);
      if (playerHit && !player.isWipedOut) {
        player.speed *= 0.94;
        player.health -= 3;
      }

      // Combat system
      if (combat) {
        const hits = updateCombat(combat, player, rivals, input, dt);
        for (const hit of hits) {
          if (hit.targetIndex >= 0) {
            // Player hit a rival
            const rival = rivals[hit.targetIndex];
            rival.health -= hit.damage;
            rival.hitFlash = 0.15;
            // Hit freeze
            race.hitFreezeTimer = 0.05;
            // Floating damage popup
            race.damagePopups.push({
              x: rival.x,
              y: 0,
              text: hit.isCritical ? `${hit.damage} CRIT!` : `+${hit.damage}`,
              timer: 0.7,
              critical: hit.isCritical || false,
            });
            if (rival.health <= 0) {
              rival.isWipedOut = true;
              rival.wipeoutTimer = 2;
            }
            incrementCombatCount(race.policeState);
          } else {
            // Rival hit the player
            player.health -= hit.damage;
            incrementCombatCount(race.policeState);
          }
        }

        // Check if player attack hits the cop
        if (combat.isAttacking && combat.attackPhase === 'ACTIVE' && race.policeState.cop.active) {
          const copHit = checkCopHit(
            race.policeState, player, combat.attackSide,
            combat.range.x, combat.range.z, totalLength,
          );
          if (copHit) {
            hitCop(race.policeState, combat.damage.punch);
          }
        }
      }

      // Police pursuit
      updatePolice(race.policeState, player, segments, dt);
      if (race.policeState.busted) {
        race.state = 'BUSTED';
        race.blinkTimer = 0;
        race.playerFinished = true;
        race.finishPosition = rivals.length + 1; // last place
        break;
      }

      // Camera follows player
      camera.z = player.z;
      camera.x = player.x * segments[0].world.w;

      // Traffic
      if (traffic) {
        updateTraffic(traffic, dt, totalLength);
        // Player-vehicle collision
        if (!player.isWipedOut) {
          const hitVehicle = checkVehicleCollision(player.x, player.z, traffic);
          if (hitVehicle) {
            player.health = 0;
            player.isWipedOut = true;
            player.wipeoutTimer = 2;
            player.wipeoutPhase = 'launch';
            player.wipeoutPhaseTimer = 0.4;
            player.animationFrame = 'wipeout';
            player.riderOffsetX = 0;
            player.riderOffsetY = 0;
            player.riderRotation = 0;
            player.bikeSlideX = 0;
            player.bikeSlideSpeed = player.speed * 0.6;
            player.speed *= 0.2;
          }
        }
        // Rival-vehicle collision
        for (const r of rivals) {
          if (!r.isWipedOut) {
            const hitV = checkVehicleCollision(r.x, r.z, traffic);
            if (hitV) {
              r.health = 0;
              r.isWipedOut = true;
              r.wipeoutTimer = 2;
              r.speed *= 0.2;
            }
          }
        }
      }

      // Check rivals crossing finish
      for (let i = 0; i < rivals.length; i++) {
        const r = rivals[i];
        if (r.z >= race.raceDistance && !race.results.find((res) => res.name === rivals[i].name)) {
          race.results.push({
            name: rivals[i].name,
            position: race.nextPosition,
            time: race.raceTimer,
          });
          race.nextPosition++;
        }
      }

      // Check player crossing finish
      if (!race.playerFinished && player.z >= race.raceDistance) {
        race.playerFinished = true;
        race.finishPosition = race.nextPosition;
        race.results.push({
          name: 'YOU',
          position: race.nextPosition,
          time: race.raceTimer,
        });
        race.nextPosition++;
        race.state = 'FINISHED';
        race.blinkTimer = 0;
      }

      // All rivals finished → player loses
      if (!race.playerFinished && race.results.length >= rivals.length) {
        race.playerFinished = true;
        race.finishPosition = race.nextPosition;
        race.results.push({
          name: 'YOU',
          position: race.nextPosition,
          time: race.raceTimer,
        });
        race.state = 'FINISHED';
        race.blinkTimer = 0;
      }

      // HUD state: detect damage and update
      if (player.health < race.prevHealth) {
        triggerDamageFlash(race.hudState);
      }
      race.prevHealth = player.health;
      updateHUD(race.hudState, dt);

      // Combat hint decay
      if (race.combatHintTimer > 0) race.combatHintTimer -= dt;

      // Damage popup decay
      for (let i = race.damagePopups.length - 1; i >= 0; i--) {
        race.damagePopups[i].timer -= dt;
        race.damagePopups[i].y -= 80 * dt;
        if (race.damagePopups[i].timer <= 0) race.damagePopups.splice(i, 1);
      }

      break;
    }

    // ------------------------------------------------------------------
    case 'FINISHED': {
      // Slow the player to a stop
      player.speed = Math.max(0, player.speed - 200 * dt);
      player.z += player.speed * SEGMENT_LENGTH * dt;
      camera.z = player.z;
      camera.x = player.x * segments[0].world.w;
      race.blinkTimer += dt;

      // Calculate earnings once
      if (race.earnings === 0 && race.finishPosition > 0) {
        race.earnings = calculateEarnings(race.finishPosition, race.progression.currentTrackIndex);
        race.progression.cash += race.earnings;
        race.progression.raceHistory.push({
          track: race.progression.currentTrackIndex,
          position: race.finishPosition,
          earnings: race.earnings,
        });
        // Check for track unlock
        if (canAdvanceToNextTrack(race.progression)) {
          advanceTrack(race.progression);
        }
        saveProgression(race.progression);
      }

      if (input.justPressed('Space') || input.justPressed('Enter')) {
        race.trackSelectDone = true;
        race.blinkTimer = 0;
        race.earnings = 0;
      }
      break;
    }

    // ------------------------------------------------------------------
    case 'BUSTED': {
      // Slow the player to a stop
      player.speed = Math.max(0, player.speed - 300 * dt);
      player.z += player.speed * SEGMENT_LENGTH * dt;
      camera.z = player.z;
      camera.x = player.x * segments[0].world.w;
      race.blinkTimer += dt;

      if (input.justPressed('Space') || input.justPressed('Enter')) {
        resetPolice(race.policeState);
        race.trackSelectDone = true;
        race.blinkTimer = 0;
        race.earnings = 0;
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function renderRace(
  ctx: CanvasRenderingContext2D,
  race: RaceData,
  player: Player,
  rivals: Rival[],
  segments: RoadSegment[],
  camera: Camera,
  combat?: CombatState,
  traffic?: Vehicle[],
): void {
  const W = SCREEN_WIDTH;
  const H = SCREEN_HEIGHT;

  // Always render the road scene
  renderRoad(ctx, segments, camera, player.speed, player.maxSpeed);

  switch (race.state) {
    // ------------------------------------------------------------------
    case 'TITLE': {
      renderRivals(ctx, rivals, segments, camera, { width: W, height: H });

      // Dim overlay
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, H);

      // Title
      ctx.fillStyle = '#ff3333';
      ctx.font = 'bold 48px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ROAD RAGE', W / 2, H / 2 - 60);

      // Subtitle
      ctx.fillStyle = '#cccccc';
      ctx.font = '14px monospace';
      ctx.fillText('WASD to ride \u2022 ENTER punch \u2022 SPACE kick', W / 2, H / 2 - 20);

      // Blinking prompt
      if (Math.floor(race.blinkTimer * 2.5) % 2 === 0) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '20px monospace';
        ctx.fillText('Press ENTER to Race', W / 2, H / 2 + 30);
      }

      // Cash display
      ctx.fillStyle = '#ffdd00';
      ctx.font = '16px monospace';
      ctx.fillText(`Cash: $${race.progression.cash}`, W / 2, H / 2 + 70);

      ctx.textAlign = 'left';
      break;
    }

    // ------------------------------------------------------------------
    case 'TRACK_SELECT': {
      renderRivals(ctx, rivals, segments, camera, { width: W, height: H });

      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, W, H);

      renderTrackSelectScreen(ctx, race, W, H);
      break;
    }

    // ------------------------------------------------------------------
    case 'BIKE_SHOP': {
      renderRivals(ctx, rivals, segments, camera, { width: W, height: H });

      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(0, 0, W, H);

      renderBikeShopScreen(ctx, race, W, H);
      break;
    }

    // ------------------------------------------------------------------
    case 'COUNTDOWN': {
      renderRivals(ctx, rivals, segments, camera, { width: W, height: H });
      drawPlayerBike(ctx, player, W, H);

      // Large countdown number
      const num = Math.ceil(race.countdown);
      const label = num <= 0 ? 'GO!' : num > 3 ? '' : String(num);
      if (label) {
        ctx.fillStyle = num <= 0 ? '#00ff00' : '#ffffff';
        ctx.font = 'bold 80px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(label, W / 2, H / 2 + 20);
        ctx.textAlign = 'left';
      }
      break;
    }

    // ------------------------------------------------------------------
    case 'RACING': {
      if (traffic) renderTrafficOnRoad(ctx, traffic, segments, camera, W, H);
      renderRivals(ctx, rivals, segments, camera, { width: W, height: H });
      renderCop(ctx, race.policeState, segments, camera, { width: W, height: H });
      renderRivalPortrait(ctx, rivals, segments, camera, player, { width: W, height: H });
      drawPlayerBike(ctx, player, W, H);
      if (combat) {
        const cx = W / 2 + player.lean * 40;
        const by = H - 18;
        renderCombatArm(ctx, combat, cx, by);
      }
      drawRacingHUD(ctx, race, player, rivals);
      renderPoliceHUD(ctx, race.policeState, W, H);

      // Floating damage popups
      for (const popup of race.damagePopups) {
        const alpha = Math.min(1, popup.timer / 0.3);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = popup.critical ? '#ff3333' : '#ffdd00';
        ctx.font = popup.critical ? 'bold 18px monospace' : 'bold 14px monospace';
        ctx.textAlign = 'center';
        // Convert road x-position to screen (approximate: center + offset)
        const popupScreenX = W / 2 + popup.x * W * 0.3;
        const popupScreenY = H * 0.4 + popup.y;
        ctx.fillText(popup.text, popupScreenX, popupScreenY);
        ctx.restore();
      }

      // Combat control hints (first 8 seconds)
      if (race.combatHintTimer > 0) {
        const hintAlpha = race.combatHintTimer > 2 ? 1 : race.combatHintTimer / 2;
        ctx.save();
        ctx.globalAlpha = hintAlpha * 0.8;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('ENTER = PUNCH    SPACE = KICK', W / 2, 60);
        ctx.restore();
      }
      break;
    }

    // ------------------------------------------------------------------
    case 'FINISHED': {
      renderRivals(ctx, rivals, segments, camera, { width: W, height: H });
      drawPlayerBike(ctx, player, W, H);

      // Dim overlay
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);

      ctx.textAlign = 'center';

      // Position headline
      const posStr = race.finishPosition === 1
        ? 'YOU WIN!'
        : `YOU FINISHED ${ordinal(race.finishPosition)}!`;
      ctx.fillStyle = race.finishPosition === 1 ? '#ffdd00' : '#ffffff';
      ctx.font = 'bold 36px monospace';
      ctx.fillText(posStr, W / 2, H / 2 - 100);

      // Earnings
      if (race.earnings > 0) {
        ctx.fillStyle = '#00ff88';
        ctx.font = 'bold 24px monospace';
        ctx.fillText(`You earned $${race.earnings}!`, W / 2, H / 2 - 65);
      } else {
        ctx.fillStyle = '#ff6666';
        ctx.font = '18px monospace';
        ctx.fillText('No earnings this race', W / 2, H / 2 - 65);
      }

      // Cash total
      ctx.fillStyle = '#ffdd00';
      ctx.font = '16px monospace';
      ctx.fillText(`Total Cash: $${race.progression.cash}`, W / 2, H / 2 - 40);

      // Race time
      ctx.fillStyle = '#cccccc';
      ctx.font = '18px monospace';
      ctx.fillText(`Time: ${formatTime(race.raceTimer)}`, W / 2, H / 2 - 18);

      // Top finishers
      const sorted = [...race.results].sort((a, b) => a.position - b.position);
      ctx.font = '16px monospace';
      const top = sorted.slice(0, Math.min(sorted.length, 5));
      for (let i = 0; i < top.length; i++) {
        const r = top[i];
        ctx.fillStyle = r.name === 'YOU' ? '#ffdd00' : '#aaaaaa';
        ctx.fillText(
          `${ordinal(r.position)}  ${r.name}  ${formatTime(r.time)}`,
          W / 2,
          H / 2 + 12 + i * 24,
        );
      }

      // Blink prompt
      race.blinkTimer += 0; // already incremented in update
      if (Math.floor(race.blinkTimer * 2.5) % 2 === 0) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '18px monospace';
        ctx.fillText('Press ENTER to Race Again', W / 2, H / 2 + 150);
      }

      ctx.textAlign = 'left';
      break;
    }

    // ------------------------------------------------------------------
    case 'BUSTED': {
      renderRivals(ctx, rivals, segments, camera, { width: W, height: H });
      renderCop(ctx, race.policeState, segments, camera, { width: W, height: H });
      drawPlayerBike(ctx, player, W, H);
      renderBustedScreen(ctx, W, H, race.blinkTimer);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// HUD (during racing) — delegates to hud.ts module
// ---------------------------------------------------------------------------

function drawRacingHUD(
  ctx: CanvasRenderingContext2D,
  race: RaceData,
  player: Player,
  rivals: Rival[],
): void {
  const position = calculatePosition(player.z, rivals, race.raceDistance);
  const progress = Math.min(1, Math.max(0, player.z / race.raceDistance));
  const rivalProgress = rivals.map(r =>
    Math.min(1, Math.max(0, r.z / race.raceDistance)),
  );

  renderHUD(
    ctx,
    race.hudState,
    player.speed,
    player.maxSpeed,
    player.health,
    player.maxHealth,
    position,
    rivals.length + 1,
    progress,
    race.raceTimer,
    rivalProgress,
  );

  // Wipeout overlay
  if (player.isWipedOut) {
    ctx.fillStyle = '#ff4444';
    ctx.font = '24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('WIPEOUT!', SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2);
    ctx.textAlign = 'left';
  }
}

// ---------------------------------------------------------------------------
// Track Select screen
// ---------------------------------------------------------------------------

function renderTrackSelectScreen(
  ctx: CanvasRenderingContext2D,
  race: RaceData,
  W: number,
  H: number,
): void {
  ctx.textAlign = 'center';

  ctx.fillStyle = '#ff3333';
  ctx.font = 'bold 32px monospace';
  ctx.fillText('SELECT TRACK', W / 2, 60);

  ctx.fillStyle = '#ffdd00';
  ctx.font = '16px monospace';
  ctx.fillText(`Cash: $${race.progression.cash}`, W / 2, 90);

  const startY = 130;
  const rowH = 70;

  for (let i = 0; i < TRACKS.length; i++) {
    const t = TRACKS[i];
    const y = startY + i * rowH;
    const unlocked = race.progression.unlockedTracks.includes(i);
    const selected = race.menuCursor === i;

    // Selection highlight
    if (selected) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(W / 2 - 280, y - 18, 560, rowH - 6);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px monospace';
      ctx.fillText('\u25B6', W / 2 - 260, y + 8);
    }

    if (unlocked) {
      ctx.fillStyle = selected ? '#ffffff' : '#cccccc';
      ctx.font = 'bold 18px monospace';
      ctx.fillText(t.name, W / 2, y);
      ctx.fillStyle = '#999999';
      ctx.font = '13px monospace';
      ctx.fillText(`${t.difficulty} — ${t.description}`, W / 2, y + 22);
    } else {
      ctx.fillStyle = '#555555';
      ctx.font = 'bold 18px monospace';
      ctx.fillText(`${t.name} [LOCKED]`, W / 2, y);
      ctx.fillStyle = '#444444';
      ctx.font = '13px monospace';
      ctx.fillText('Finish top 3 on previous track to unlock', W / 2, y + 22);
    }
  }

  // Current bike
  const bike = getCurrentBike(race.progression);
  ctx.fillStyle = '#aaaaaa';
  ctx.font = '14px monospace';
  ctx.fillText(`Current Bike: ${bike.name}`, W / 2, H - 70);

  // Controls
  ctx.fillStyle = '#888888';
  ctx.font = '14px monospace';
  ctx.fillText('\u2191\u2193 Select  \u2022  SPACE Confirm  \u2022  B Bike Shop', W / 2, H - 30);

  ctx.textAlign = 'left';
}

// ---------------------------------------------------------------------------
// Bike Shop screen
// ---------------------------------------------------------------------------

function renderBikeShopScreen(
  ctx: CanvasRenderingContext2D,
  race: RaceData,
  W: number,
  H: number,
): void {
  ctx.textAlign = 'center';

  ctx.fillStyle = '#33aaff';
  ctx.font = 'bold 32px monospace';
  ctx.fillText('BIKE SHOP', W / 2, 50);

  ctx.fillStyle = '#ffdd00';
  ctx.font = '16px monospace';
  ctx.fillText(`Cash: $${race.progression.cash}`, W / 2, 78);

  const startY = 115;
  const rowH = 85;

  for (let i = 0; i < BIKES.length; i++) {
    const b = BIKES[i];
    const y = startY + i * rowH;
    const owned = race.progression.ownedBikes.includes(b.id);
    const equipped = race.progression.currentBikeId === b.id;
    const canBuy = !owned && race.progression.cash >= b.price;
    const selected = race.menuCursor === i;

    // Selection highlight
    if (selected) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(W / 2 - 300, y - 20, 600, rowH - 6);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px monospace';
      ctx.fillText('\u25B6', W / 2 - 280, y + 6);
    }

    // Bike color swatch
    ctx.fillStyle = b.color;
    ctx.fillRect(W / 2 - 250, y - 8, 20, 20);

    // Name and price
    ctx.fillStyle = selected ? '#ffffff' : '#cccccc';
    ctx.font = 'bold 18px monospace';
    const priceLabel = b.price === 0 ? 'FREE' : `$${b.price}`;
    const statusLabel = equipped ? ' [EQUIPPED]' : owned ? ' [OWNED]' : '';
    ctx.fillText(`${b.name}  ${priceLabel}${statusLabel}`, W / 2, y);

    // Stats bar
    ctx.fillStyle = '#888888';
    ctx.font = '12px monospace';
    const stats = `SPD:${b.maxSpeed}  ACC:${b.acceleration}  HND:${b.handling.toFixed(1)}  TGH:${b.toughness.toFixed(1)}`;
    ctx.fillText(stats, W / 2, y + 20);

    // Action hint for selected
    if (selected) {
      ctx.font = '12px monospace';
      if (equipped) {
        ctx.fillStyle = '#00ff88';
        ctx.fillText('Currently equipped', W / 2, y + 40);
      } else if (owned) {
        ctx.fillStyle = '#00aaff';
        ctx.fillText('SPACE to equip', W / 2, y + 40);
      } else if (canBuy) {
        ctx.fillStyle = '#ffdd00';
        ctx.fillText('SPACE to buy', W / 2, y + 40);
      } else {
        ctx.fillStyle = '#ff4444';
        ctx.fillText('Not enough cash', W / 2, y + 40);
      }
    }
  }

  // Controls
  ctx.fillStyle = '#888888';
  ctx.font = '14px monospace';
  ctx.fillText('\u2191\u2193 Select  \u2022  SPACE Buy/Equip  \u2022  B/ESC Back', W / 2, H - 30);

  ctx.textAlign = 'left';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

// Render traffic vehicles using the road projection
function renderTrafficOnRoad(
  ctx: CanvasRenderingContext2D,
  traffic: Vehicle[],
  segments: RoadSegment[],
  camera: Camera,
  W: number,
  H: number,
): void {
  const halfW = W / 2;
  const len = segments.length;
  const totalZ = len * SEGMENT_LENGTH;
  const camZ = ((camera.z % totalZ) + totalZ) % totalZ;
  const camIdx = Math.floor(camZ / SEGMENT_LENGTH) % len;

  for (const v of traffic) {
    // Relative z distance from camera
    let relZ = v.z - camZ;
    if (relZ < -totalZ / 2) relZ += totalZ;
    if (relZ > totalZ / 2) relZ -= totalZ;

    // Only render if ahead and within draw distance
    if (relZ < SEGMENT_LENGTH || relZ > 300 * SEGMENT_LENGTH) continue;

    // Find the road segment this vehicle is on
    const segIdx = (Math.floor(v.z / SEGMENT_LENGTH) % len + len) % len;
    const seg = segments[segIdx];

    // Use the segment's screen projection if it was projected
    if (seg.screen.y <= 0) continue;

    const scale = seg.screen.w > 0 ? seg.screen.w / seg.world.w : 0;
    if (scale < 0.001) continue;

    const screenX = seg.screen.x + v.x * seg.screen.w;
    const screenY = seg.screen.y;

    renderVehicle(ctx, v, screenX, screenY, scale);
  }
}
