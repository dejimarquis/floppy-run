// Combat system — visceral Road Rash-style attacks with weapon pickups,
// combo chains, attack phases, and personality-driven rival AI

import type { InputManager } from '../../engine/input';
import type { Player } from './player';
import type { Rival } from './rivals';
import { SEGMENT_LENGTH, getTotalSegments } from './road';

// --- Attack Phase ------------------------------------------------------------

export type AttackPhase = 'NONE' | 'WINDUP' | 'ACTIVE' | 'RECOVERY';

// --- Weapon System -----------------------------------------------------------

export type WeaponType = 'fist' | 'chain' | 'club';

export interface Weapon {
  type: WeaponType;
  uses: number; // -1 = infinite (fist)
}

export interface WeaponPickup {
  type: WeaponType;
  z: number;
  x: number;
  collected: boolean;
}

interface WeaponStats {
  damage: number;
  rangeX: number;
  rangeZ: number;
  cooldown: number;
  maxUses: number;
}

const WEAPON_STATS: Record<WeaponType, WeaponStats> = {
  fist:  { damage: 15, rangeX: 0.3,  rangeZ: 150, cooldown: 0.4, maxUses: -1 },
  chain: { damage: 25, rangeX: 0.45, rangeZ: 200, cooldown: 0.6, maxUses: 3 },
  club:  { damage: 35, rangeX: 0.35, rangeZ: 180, cooldown: 0.8, maxUses: 5 },
};

// --- Types -------------------------------------------------------------------

export interface CombatHit {
  targetIndex: number; // -1 = player was hit, otherwise rival index
  type: 'punch' | 'kick';
  damage: number;
  knockbackX?: number;
  isCritical?: boolean;
}

interface RivalCombatState {
  isAttacking: boolean;
  attackTimer: number;
  cooldownTimer: number;
  wasHitRecently: boolean;
  wasHitTimer: number;
  telegraphing: boolean;
  telegraphTimer: number;
}

export interface CombatState {
  isAttacking: boolean;
  attackType: 'punch' | 'kick' | null;
  attackSide: 'left' | 'right';
  attackTimer: number;
  attackDuration: number;
  cooldown: number;
  cooldownTimer: number;
  damage: { punch: number; kick: number };
  range: { x: number; z: number };
  rivalStates: RivalCombatState[];
  /** @internal rivals already hit during current swing */
  _hitSet: Set<number>;
  // New fields
  attackPhase: AttackPhase;
  weapon: Weapon;
  weaponPickups: WeaponPickup[];
  /** Age (seconds) of each recent hit — oldest first, pruned beyond COMBO_WINDOW */
  comboHits: number[];
  comboCount: number;
}

// --- Constants ---------------------------------------------------------------

const WIND_UP = 0.1;
const ACTIVE_WINDOW = 0.15;
const RECOVERY = 0.2;
const TOTAL_ATTACK = WIND_UP + ACTIVE_WINDOW + RECOVERY;

const CRITICAL_CHANCE = 0.10;
const CRITICAL_MULTIPLIER = 1.5;
const COMBO_WINDOW = 3.0;
const COMBO_THRESHOLD = 3;

const RIVAL_ATTACK_CHANCE = 0.10;
const RIVAL_ATTACK_RANGE_X = 0.3;
const RIVAL_ATTACK_RANGE_Z = 150;
const RIVAL_ATTACK_DURATION = 0.35;
const RIVAL_ATTACK_COOLDOWN = 1.5;
const RIVAL_KNOCKBACK_X = 0.15;
const RIVAL_KNOCKBACK_SPEED = 0.7;
const RIVAL_TELEGRAPH_DURATION = 0.4;
const RIVAL_COUNTER_WINDOW = 2.0;

const PICKUP_RANGE_X = 0.3;
const PICKUP_RANGE_Z = 100;

function getTotalZ(): number { return getTotalSegments() * SEGMENT_LENGTH; }

// --- Helpers -----------------------------------------------------------------

export function getAttackPhase(combat: CombatState): AttackPhase {
  return combat.attackPhase;
}

export function getWeaponStats(type: WeaponType): WeaponStats {
  return { ...WEAPON_STATS[type] };
}

export function spawnWeaponPickup(
  combat: CombatState,
  type: WeaponType,
  z: number,
  x: number,
): void {
  combat.weaponPickups.push({ type, z, x, collected: false });
}

// --- Factory -----------------------------------------------------------------

function createRivalCombatState(): RivalCombatState {
  return {
    isAttacking: false,
    attackTimer: 0,
    cooldownTimer: 0,
    wasHitRecently: false,
    wasHitTimer: 0,
    telegraphing: false,
    telegraphTimer: 0,
  };
}

export function createCombatState(rivalCount: number = 0): CombatState {
  const rivalStates: RivalCombatState[] = [];
  for (let i = 0; i < rivalCount; i++) {
    rivalStates.push(createRivalCombatState());
  }
  const stats = WEAPON_STATS.fist;
  return {
    isAttacking: false,
    attackType: null,
    attackSide: 'right',
    attackTimer: 0,
    attackDuration: TOTAL_ATTACK,
    cooldown: stats.cooldown,
    cooldownTimer: 0,
    damage: { punch: stats.damage, kick: stats.damage },
    range: { x: stats.rangeX, z: stats.rangeZ },
    rivalStates,
    _hitSet: new Set(),
    attackPhase: 'NONE',
    weapon: { type: 'fist', uses: -1 },
    weaponPickups: [],
    comboHits: [],
    comboCount: 0,
  };
}

// --- Weapon pickup collection ------------------------------------------------

function applyWeaponStats(combat: CombatState): void {
  const stats = WEAPON_STATS[combat.weapon.type];
  combat.damage = { punch: stats.damage, kick: stats.damage };
  combat.range = { x: stats.rangeX, z: stats.rangeZ };
  combat.cooldown = stats.cooldown;
}

function updateWeaponPickups(combat: CombatState, player: Player): void {
  const totalZ = getTotalZ();
  for (const pickup of combat.weaponPickups) {
    if (pickup.collected) continue;
    let dz = pickup.z - player.z;
    if (dz > totalZ / 2) dz -= totalZ;
    if (dz < -totalZ / 2) dz += totalZ;
    if (Math.abs(dz) > PICKUP_RANGE_Z) continue;
    if (Math.abs(pickup.x - player.x) > PICKUP_RANGE_X) continue;
    pickup.collected = true;
    const stats = WEAPON_STATS[pickup.type];
    combat.weapon = { type: pickup.type, uses: stats.maxUses };
    applyWeaponStats(combat);
  }
}

// --- Update ------------------------------------------------------------------

export function updateCombat(
  combat: CombatState,
  player: Player,
  rivals: Rival[],
  input: InputManager,
  dt: number,
): CombatHit[] {
  const hits: CombatHit[] = [];

  // Ensure rivalStates array matches rivals length
  while (combat.rivalStates.length < rivals.length) {
    combat.rivalStates.push(createRivalCombatState());
  }

  // Age and prune combo hits
  for (let i = combat.comboHits.length - 1; i >= 0; i--) {
    combat.comboHits[i] += dt;
    if (combat.comboHits[i] > COMBO_WINDOW) {
      combat.comboHits.splice(i, 1);
    }
  }
  combat.comboCount = combat.comboHits.length;

  updateWeaponPickups(combat, player);
  updatePlayerAttack(combat, player, rivals, input, dt, hits);
  updateRivalAttacks(combat, player, rivals, dt, hits);

  return hits;
}

// --- Player attack -----------------------------------------------------------

function updatePlayerAttack(
  combat: CombatState,
  player: Player,
  rivals: Rival[],
  input: InputManager,
  dt: number,
  hits: CombatHit[],
): void {
  if (combat.cooldownTimer > 0) {
    combat.cooldownTimer -= dt;
  }

  if (combat.isAttacking) {
    combat.attackTimer += dt;

    // Determine current phase
    const t = combat.attackTimer;
    if (t < WIND_UP) {
      combat.attackPhase = 'WINDUP';
    } else if (t < WIND_UP + ACTIVE_WINDOW) {
      combat.attackPhase = 'ACTIVE';
      checkPlayerHits(combat, player, rivals, hits);
    } else {
      combat.attackPhase = 'RECOVERY';
    }

    if (combat.attackTimer >= combat.attackDuration) {
      combat.isAttacking = false;
      combat.attackType = null;
      combat.attackTimer = 0;
      combat.attackPhase = 'NONE';
      combat._hitSet.clear();
    }
    return;
  }

  combat.attackPhase = 'NONE';

  // Start new attack?
  if (combat.cooldownTimer > 0 || player.isWipedOut) return;

  let attackType: 'punch' | 'kick' | null = null;

  if (input.isActionJustPressed('punch')) {
    attackType = 'punch';
  } else if (input.isActionJustPressed('kick')) {
    attackType = 'kick';
  }

  if (attackType) {
    // Auto-derive side from player lean — punch/kick toward nearest rival
    const side: 'left' | 'right' = player.lean <= 0 ? 'left' : 'right';
    combat.isAttacking = true;
    combat.attackType = attackType;
    combat.attackSide = side;
    combat.attackTimer = 0;
    combat.attackDuration = TOTAL_ATTACK;
    combat.cooldownTimer = combat.cooldown;
    combat.attackPhase = 'WINDUP';
    combat._hitSet.clear();
  }
}

function checkPlayerHits(
  combat: CombatState,
  player: Player,
  rivals: Rival[],
  hits: CombatHit[],
): void {
  const totalZ1 = getTotalZ();
  for (let i = 0; i < rivals.length; i++) {
    if (combat._hitSet.has(i)) continue;
    const rival = rivals[i];
    if (rival.isWipedOut) continue;

    // Z proximity (wrapped)
    let dz = rival.z - player.z;
    if (dz > totalZ1 / 2) dz -= totalZ1;
    if (dz < -totalZ1 / 2) dz += totalZ1;
    if (Math.abs(dz) > combat.range.z) continue;

    // X proximity + side check
    const dx = rival.x - player.x;
    if (Math.abs(dx) > combat.range.x) continue;
    if (combat.attackSide === 'left' && dx > 0) continue;
    if (combat.attackSide === 'right' && dx < 0) continue;

    // Hit!
    combat._hitSet.add(i);

    // Combo tracking — push 0 (just happened), then check threshold
    combat.comboHits.push(0);
    let isCritical = Math.random() < CRITICAL_CHANCE;
    if (combat.comboHits.length >= COMBO_THRESHOLD) {
      isCritical = true;
    }

    let damage = combat.damage.punch;
    if (isCritical) damage = Math.round(damage * CRITICAL_MULTIPLIER);

    const pushDir = combat.attackSide === 'left' ? -1 : 1;
    const knockbackX = pushDir * RIVAL_KNOCKBACK_X;

    hits.push({
      targetIndex: i,
      type: combat.attackType!,
      damage,
      knockbackX,
      isCritical,
    });

    // Apply knockback
    rival.x += knockbackX;
    rival.x = Math.max(-1.5, Math.min(1.5, rival.x));
    rival.speed *= RIVAL_KNOCKBACK_SPEED;

    // Mark rival as recently hit (for defensive counter-attack)
    if (combat.rivalStates[i]) {
      combat.rivalStates[i].wasHitRecently = true;
      combat.rivalStates[i].wasHitTimer = RIVAL_COUNTER_WINDOW;
    }

    // Consume weapon use
    if (combat.weapon.uses > 0) {
      combat.weapon.uses--;
      if (combat.weapon.uses <= 0) {
        combat.weapon = { type: 'fist', uses: -1 };
        applyWeaponStats(combat);
      }
    }
  }
}

// --- Rival attacks -----------------------------------------------------------

function updateRivalAttacks(
  combat: CombatState,
  player: Player,
  rivals: Rival[],
  dt: number,
  hits: CombatHit[],
): void {
  const totalZ2 = getTotalZ();

  for (let i = 0; i < rivals.length; i++) {
    const rival = rivals[i];
    const rs = combat.rivalStates[i];

    if (rs.cooldownTimer > 0) rs.cooldownTimer -= dt;

    // Decay wasHit timer
    if (rs.wasHitRecently) {
      rs.wasHitTimer -= dt;
      if (rs.wasHitTimer <= 0) {
        rs.wasHitRecently = false;
        rs.wasHitTimer = 0;
      }
    }

    // Telegraph phase — rival edges closer before striking
    if (rs.telegraphing) {
      rs.telegraphTimer -= dt;
      const dir = player.x > rival.x ? 1 : -1;
      rival.x += dir * 0.5 * dt;
      rival.x = Math.max(-1.5, Math.min(1.5, rival.x));
      if (rs.telegraphTimer <= 0) {
        rs.telegraphing = false;
        rs.isAttacking = true;
        rs.attackTimer = 0;
      }
      continue;
    }

    if (rs.isAttacking) {
      rs.attackTimer += dt;
      // Deal damage once at mid-point of rival's swing
      if (rs.attackTimer >= RIVAL_ATTACK_DURATION * 0.5 && rs.attackTimer - dt < RIVAL_ATTACK_DURATION * 0.5) {
        if (!player.isWipedOut) {
          const pushDir = rival.x < player.x ? 1 : -1;
          hits.push({
            targetIndex: -1,
            type: 'punch',
            damage: WEAPON_STATS.fist.damage,
            knockbackX: pushDir * RIVAL_KNOCKBACK_X,
            isCritical: false,
          });
        }
      }
      if (rs.attackTimer >= RIVAL_ATTACK_DURATION) {
        rs.isAttacking = false;
        rs.attackTimer = 0;
      }
      continue;
    }

    if (rival.isWipedOut || player.isWipedOut) continue;
    if (rs.cooldownTimer > 0) continue;

    // Range check
    let dz = rival.z - player.z;
    if (dz > totalZ2 / 2) dz -= totalZ2;
    if (dz < -totalZ2 / 2) dz += totalZ2;
    if (Math.abs(dz) > RIVAL_ATTACK_RANGE_Z) continue;
    if (Math.abs(rival.x - player.x) > RIVAL_ATTACK_RANGE_X) continue;

    if (rival.personality === 'aggressive') {
      // Aggressive: telegraph by moving closer, then strike
      if (Math.random() > RIVAL_ATTACK_CHANCE) continue;
      rs.telegraphing = true;
      rs.telegraphTimer = RIVAL_TELEGRAPH_DURATION;
      rs.cooldownTimer = RIVAL_ATTACK_COOLDOWN;
    } else if (rival.personality === 'defensive') {
      // Defensive: only counter-attack after being hit
      if (!rs.wasHitRecently) continue;
      rs.telegraphing = true;
      rs.telegraphTimer = RIVAL_TELEGRAPH_DURATION * 0.5;
      rs.cooldownTimer = RIVAL_ATTACK_COOLDOWN;
      rs.wasHitRecently = false;
      rs.wasHitTimer = 0;
    }
  }
}

// --- Rendering ---------------------------------------------------------------

export function renderCombatArm(
  ctx: CanvasRenderingContext2D,
  combat: CombatState,
  playerScreenX: number,
  playerScreenY: number,
): void {
  if (!combat.isAttacking || combat.attackType === null) return;

  const t = combat.attackTimer;
  let extension: number;
  if (t < WIND_UP) {
    // WINDUP: arm pulls back
    extension = -(t / WIND_UP) * 0.3;
  } else if (t < WIND_UP + ACTIVE_WINDOW) {
    // ACTIVE: arm fully extends
    extension = 1;
  } else {
    // RECOVERY: arm returns
    extension = 1 - (t - WIND_UP - ACTIVE_WINDOW) / RECOVERY;
  }
  extension = Math.max(-0.3, Math.min(1, extension));

  const dir = combat.attackSide === 'left' ? -1 : 1;
  const isKick = combat.attackType === 'kick';
  const weaponType = combat.weapon.type;

  // Weapon-specific visuals
  let armLength: number;
  let color: string;
  let lineWidth: number;
  let tipRadius: number;
  switch (weaponType) {
    case 'chain':
      armLength = 50 * Math.abs(extension);
      color = '#aaaaaa';
      lineWidth = 3;
      tipRadius = 8;
      break;
    case 'club':
      armLength = 40 * Math.abs(extension);
      color = '#8B4513';
      lineWidth = 7;
      tipRadius = 9;
      break;
    default:
      armLength = (isKick ? 45 : 35) * Math.abs(extension);
      color = isKick ? '#ffaa00' : '#ffcc44';
      lineWidth = isKick ? 6 : 5;
      tipRadius = isKick ? 6 : 5;
  }

  const armY = isKick ? -10 : -22;
  const extDir = extension < 0 ? -dir : dir;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';

  const startX = playerScreenX + dir * 5;
  const startY = playerScreenY + armY;
  const endX = startX + extDir * armLength;
  const endY = startY - 2;

  // Chain weapon draws a wavy line
  if (weaponType === 'chain' && extension > 0) {
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    const steps = 6;
    for (let s = 1; s <= steps; s++) {
      const frac = s / steps;
      const cx = startX + (endX - startX) * frac;
      const cy = startY + (endY - startY) * frac + Math.sin(frac * Math.PI * 3) * 3;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }

  // Tip (fist / weapon head)
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(endX, endY, tipRadius, 0, Math.PI * 2);
  ctx.fill();

  // Impact flash during active phase when a hit has landed
  if (combat.attackPhase === 'ACTIVE' && combat._hitSet.size > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(endX, endY, tipRadius + 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
