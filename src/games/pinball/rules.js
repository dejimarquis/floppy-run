/**
 * Space Cadet: Nova — game rules.
 *
 * A real ruleset: skill shot, three missions (Fuel Loading, Reentry, Wormhole
 * Multiball), ramp combos, jackpots, bonus multipliers, NOVA lanes, drop-target
 * bank, captive-ball Core hits, extra ball, tilt, ranks and end-of-ball bonus.
 */

import * as THREE from 'three';
import { L } from './layout.js';
import { V } from './table.js';
import { random } from './rng.js';

export const RANKS = [
  { name: 'CADET', at: 0 },
  { name: 'ENSIGN', at: 400000 },
  { name: 'LIEUTENANT', at: 1200000 },
  { name: 'COMMANDER', at: 3000000 },
  { name: 'CAPTAIN', at: 6500000 },
  { name: 'ADMIRAL', at: 14000000 },
];

const MODES = {
  FUEL: { name: 'FUEL LOADING', sub: 'SHOOT THE FUEL RAMP', need: 4, base: 60000 },
  REENTRY: { name: 'REENTRY BURN', sub: 'SHOOT THE REENTRY RAMP', need: 4, base: 70000 },
  NAV: { name: 'NAV LOCK', sub: 'HIT ALL NAV TARGETS', need: 3, base: 55000 },
};

export class Rules {
  constructor(game) {
    this.g = game;
    this.reset();
  }

  reset() {
    this.score = 0;
    this.displayScore = 0;
    this.ball = 1;
    this.totalBalls = 3;
    this.ballsLeft = 3;
    this.demo = this.demo || false;
    this.multiplier = 1;
    this.bonus = 0;
    this.missionsDone = 0;
    this.tiltWarn = 0;
    this.tilted = false;
    this.gameOver = false;
    this.mode = null;
    this.modeCount = 0;
    this.modeQueue = ['FUEL', 'REENTRY', 'NAV'];
    this.multiball = false;
    this.mbJackpot = 250000;
    this.locks = 0;
    this.novaLit = [false, false, false, false];
    this.dropsDown = 0;
    this.dropResetT = 0;
    this.comboT = 0;
    this.combo = 0;
    this.spinCount = 0;
    this.skillArmed = false;
    this.skillWindow = 0;
    this.extraBallLit = false;
    this.kickbackLit = true;
    this.extraBalls = 0;
    this.coreHits = 0;
    this.saucerBall = null;
    this.saucerT = 0;
    this.serveT = 0;
    this.ballInPlay = false;
    this.hint = 'PLUNGE TO LAUNCH';
    this.rankIdx = 0;
    this.lastFlip = 0;
    this._chimeStep = 0;
  }

  get rankName() {
    return RANKS[this.rankIdx].name;
  }
  get nextRank() {
    return RANKS[Math.min(RANKS.length - 1, this.rankIdx + 1)].name;
  }

  /* ------------------------------------------------------------ */

  addScore(n, x, y, color) {
    const total = Math.round(n * this.multiplier * (1 + this.combo * 0.25));
    this.score += total;
    if (x != null) {
      this.g.vfx.scorePop(x, y, color || new THREE.Color(0xffd06a));
    }
    while (this.rankIdx < RANKS.length - 1 && this.score >= RANKS[this.rankIdx + 1].at) {
      this.rankIdx++;
      this.g.dmd.show({ big: 'RANK UP', l2: RANKS[this.rankIdx].name, dur: 2.0, prio: true });
      this.g.hud.banner(RANKS[this.rankIdx].name, 1.8);
      this.g.audio.knocker();
      this.g.vfx.lightShow(80);
      this.g.cam.addShake(0.35);
    }
    return total;
  }

  /* ------------------------------------------------------------ */

  startGame() {
    this.reset();
    this.g.dmd.show({ l1: 'SPACE CADET', l2: 'NOVA', dur: 1.4, prio: true });
    // Serve synchronously rather than on a game-time timer: on a software
    // rasteriser the first few frames are ~1 s apart, so any non-zero delay
    // means a capture taken "3 s after load" finds an empty table.
    this.doServe();
    this.updateLamps();
  }

  serveBall(delay = 0.6) {
    this.serveT = delay;
  }

  doServe() {
    const b = this.g.spawnBall(L.plunger.x, L.plunger.y + 0.03);
    b.lane = true;
    this.ballInPlay = true;
    this.skillArmed = true;
    this.tilted = false;
    this.tiltWarn = 0;
    this.hint = 'HOLD SPACE TO CHARGE';
    this.g.dmd.show({ l1: `BALL ${this.ball}`, l2: 'PLUNGE!', dur: 1.4 });
    this.g.audio.chime(0);
    return b;
  }

  onDrain(ball) {
    // The drain event fires from inside the physics substep, so the ball that
    // just died is STILL in world.balls (it is spliced out at the end of the
    // frame). Counting it as in-play made every single-ball drain take the
    // multiball branch and return without ever re-serving -- the table went
    // permanently empty. Count live balls only, and exclude this one.
    const live = this.g.balls.reduce(
      (n, b) => n + (b.alive && b !== ball ? 1 : 0),
      0
    );
    if (live > 0) {
      if (live === 1 && this.multiball) this.endMultiball();
      return;
    }
    void ball;
    this.ballInPlay = false;
    this.g.audio.drain();
    // Attract mode never ends. A real machine's demo loop keeps a ball on the
    // board indefinitely so the cabinet always reads "in play" from across the
    // room; the same is true of a capture taken at an arbitrary moment.
    if (this.demo && !this.gameOver) {
      this.g.dmd.show({ l1: 'BALL SAVE', l2: 'SHOOT AGAIN', dur: 1.2 });
      this.serveBall(0.18);
      return;
    }
    this.endBall();
  }

  endBall() {
    if (this.gameOver) return;
    if (this.multiball) this.endMultiball();
    // end-of-ball bonus
    const bonus = this.bonus * this.multiplier;
    if (bonus > 0 && !this.tilted) {
      this.g.dmd.show({ l1: 'BONUS', l2: bonus.toLocaleString('en-US'), dur: 1.8, prio: true });
      this.score += bonus;
      for (let i = 0; i < 8; i++) this.g.audio.chime(i, i * 0.09);
    } else if (this.tilted) {
      this.g.dmd.show({ anim: 'tilt', dur: 1.6, prio: true });
    }
    this.bonus = 0;
    if (this.extraBalls > 0) {
      this.extraBalls--;
      this.g.dmd.show({ big: 'SHOOT', l2: 'AGAIN', dur: 1.8 });
      this.g.hud.banner('EXTRA BALL', 1.6);
      this.serveBall(1.6);
      return;
    }
    this.ballsLeft--;
    this.ball++;
    this.multiplier = 1;
    this.resetDrops(true);
    this.novaLit = [false, false, false, false];
    this.mode = null;
    this.locks = 0;
    if (this.ballsLeft <= 0) {
      this.gameOver = true;
      this.g.dmd.show({ big: 'GAME', l2: 'OVER', dur: 3.0, prio: true });
      this.g.hud.banner('GAME OVER', 2.4);
      this.g.sched.after(4.2, () => {
        if (this.gameOver) this.startGame();
      }, 'game-over-restart');
    } else {
      this.serveBall(1.4);
    }
    this.updateLamps();
  }

  /* ------------------------------------------------------------ */

  onEvent(ev) {
    if (ev.type === 'drain') {
      this.onDrain(ev.ball);
      return;
    }
    if (ev.type === 'zone') this.onZone(ev);
    else if (ev.type === 'hit') this.onHit(ev);
    else if (ev.type === 'railExit') this.onRailExit(ev);
  }

  onHit(ev) {
    const g = this.g;
    const tag = ev.tag;
    const impact = ev.impact || 0;

    if (tag && tag.startsWith('bumper')) {
      const b = g.table.parts.bumpers.find((x) => x.id === tag);
      if (b) b.level = 1;
      g.audio.bumper(Math.min(1, impact / 3));
      g.vfx.burst(ev.x, ev.y, new THREE.Color(0x8fd8ff), 16, 0.9, 0.03);
      g.cam.addShake(0.05);
      this.addScore(1100 + (this.multiball ? 900 : 0));
      this.bonus += 300;
      g.flash(0.05);
      return;
    }
    if (tag === 'slingL' || tag === 'slingR') {
      const s = tag === 'slingL' ? g.table.parts.slingL : g.table.parts.slingR;
      s.flash.level = 1;
      s.level = 1;
      g.audio.sling();
      g.vfx.sparks(ev.x, ev.y, ev.nx, ev.ny, new THREE.Color(0xffb060), 8, 1.1);
      this.addScore(520);
      this.bonus += 120;
      return;
    }
    if (tag && tag.startsWith('drop')) {
      const idx = parseInt(tag.slice(4), 10);
      const d = g.table.parts.drops[idx];
      if (d && !d.down) {
        d.down = true;
        this.dropsDown++;
        g.audio.clack(1 + idx * 0.12);
        g.vfx.sparks(ev.x, ev.y, ev.nx, ev.ny, new THREE.Color(0x7fe8ff), 8, 0.9);
        this.addScore(6000, ev.x, ev.y, new THREE.Color(0x7fe8ff));
        this.bonus += 1200;
        if (this.dropsDown >= 4) {
          this.addScore(60000, ev.x, ev.y, new THREE.Color(0xffd06a));
          g.dmd.show({ big: 'FUEL', l2: 'CELLS FULL', dur: 1.4 });
          g.hud.banner('FUEL CELLS', 1.2);
          g.audio.jackpot();
          g.vfx.lightShow(40);
          this.multiplier = Math.min(8, this.multiplier + 1);
          this.dropResetT = 1.4;
          this.maybeStartMode('FUEL');
        }
      }
      return;
    }
    if (tag && tag.startsWith('stand')) {
      const s = g.table.parts.standups.find((x) => x.id === tag);
      if (s) s.hit = 1;
      g.audio.clack(1.4);
      g.vfx.sparks(ev.x, ev.y, ev.nx, ev.ny, new THREE.Color(0xffe08a), 7, 0.9);
      this.addScore(3200, ev.x, ev.y);
      this.bonus += 700;
      if (this.mode === 'NAV') this.modeHit(ev);
      return;
    }
    if (tag === 'captive') {
      const c = g.table.parts.captive;
      c.vel += Math.min(1.5, impact) * 0.5;
      g.audio.ping(impact * 1.4);
      g.vfx.sparks(ev.x, ev.y, ev.nx, ev.ny, new THREE.Color(0xffffff), 10, 1.3);
      if (impact > 1.1) {
        this.coreHits++;
        this.addScore(12000, ev.x, ev.y, new THREE.Color(0xffffff));
        g.dmd.show({ l1: 'CORE HIT', l2: `${this.coreHits}`, dur: 0.9 });
        if (this.coreHits % 3 === 0) {
          this.lockBall(null, true);
        }
      }
      return;
    }
    if (tag === 'post' || tag === 'gate') {
      if (impact > 0.5) g.audio.ping(impact);
      return;
    }
    if (tag === 'orbitWall') {
      if (impact > 1.2) {
        g.audio.ping(impact * 0.8);
        g.vfx.sparks(ev.x, ev.y, ev.nx, ev.ny, new THREE.Color(0xcfe6ff), 5, 0.8);
      }
      return;
    }
    if (tag === 'flipperL' || tag === 'flipperR' || tag === 'flipperU') {
      this.skillWindow = 0;
      if (impact > 1.4) g.audio.thud(impact);
      return;
    }
    if (tag === 'ballball') {
      g.audio.ping(impact * 1.6);
      g.vfx.sparks(ev.x, ev.y, ev.nx, ev.ny, new THREE.Color(0xffffff), 6, 1.0);
      return;
    }
    if (impact > 1.6) g.audio.ping(impact * 0.7);
  }

  onZone(ev) {
    const g = this.g;
    const tag = ev.tag;
    const ball = ev.ball;

    if (tag === 'rampLeftEntry' || tag === 'rampRightEntry') {
      const rail = tag === 'rampLeftEntry' ? g.table.railLeft : g.table.railRight;
      const t = rail.tangent(0);
      const sp = Math.hypot(ball.vx, ball.vy);
      const along = ball.vx * t[0] + ball.vy * t[1];
      if (along > 0.7 * sp && sp > 1.9) {
        g.world.attachRail(ball, rail, sp);
        const key = tag === 'rampLeftEntry' ? 'left' : 'right';
        g.table.parts.rails[key].level = 1.4;
        g.audio.ping(4.2);
        g.cam.addShake(0.06);
      }
      return;
    }
    if (tag === 'spinner') {
      const sp = Math.hypot(ball.vx, ball.vy);
      g.table.parts.spinner.omega = Math.max(g.table.parts.spinner.omega, sp * 22);
      const revs = Math.max(1, Math.round(sp * 2.2));
      for (let i = 0; i < Math.min(revs, 9); i++) {
        g.audio.spinner(this.spinCount + i, i * 0.055);
      }
      this.spinCount += revs;
      this.addScore(900 * revs);
      this.bonus += 200 * revs;
      g.dmd.show({ l1: 'SPINNER', l2: `${this.spinCount}`, dur: 0.7 });
      return;
    }
    if (tag === 'saucer') {
      if (ball.held) return;
      this.captureSaucer(ball);
      return;
    }
    if (tag && tag.startsWith('nova')) {
      const i = parseInt(tag.slice(4), 10);
      if (!this.novaLit[i]) {
        this.novaLit[i] = true;
        g.audio.chime(i + 2);
        this.addScore(4500, ev.x, ev.y, new THREE.Color(0xffd23c));
        this.bonus += 900;
        if (this.novaLit.every(Boolean)) {
          this.novaLit = [false, false, false, false];
          this.multiplier = Math.min(8, this.multiplier + 1);
          g.dmd.show({ big: `${this.multiplier}X`, l2: 'BONUS MULTIPLIER', dur: 1.6, prio: true });
          g.hud.banner(`${this.multiplier}X BONUS`, 1.4);
          g.audio.jackpot();
          g.vfx.lightShow(50);
        }
      } else {
        this.addScore(1500);
      }
      if (this.skillArmed && this.skillWindow > 0) this.awardSkill(i, ev);
      this.updateLamps();
      return;
    }
    if (tag === 'inlaneL' || tag === 'inlaneR') {
      this.addScore(2200, ev.x, ev.y, new THREE.Color(0x4cff9d));
      this.bonus += 500;
      g.audio.chime(3);
      // relight the outlane coil, exactly as a real machine does
      if (!this.kickbackLit) {
        this.kickbackLit = true;
        g.dmd.show({ l1: 'KICKBACK', l2: 'RELIT', dur: 1.0 });
      }
      if (this.extraBallLit) {
        this.extraBallLit = false;
        this.extraBalls++;
        g.dmd.show({ big: 'EXTRA', l2: 'BALL', dur: 2.0, prio: true });
        g.hud.banner('EXTRA BALL', 1.8);
        g.audio.knocker();
        g.vfx.lightShow(70);
      }
      this.updateLamps();
      return;
    }
    if (tag === 'outlaneL' || tag === 'outlaneR') {
      this.addScore(3500, ev.x, ev.y, new THREE.Color(0xff3c6e));
      this.bonus += 800;
      g.audio.chime(6);
      return;
    }
  }

  onRailExit(ev) {
    const g = this.g;
    const id = ev.rail.id;
    const now = g.world.time;
    if (now - this.comboT < 3.4) this.combo = Math.min(5, this.combo + 1);
    else this.combo = 0;
    this.comboT = now;

    const isFuel = id === 'right';
    const label = isFuel ? 'FUEL RAMP' : 'REENTRY RAMP';
    const color = new THREE.Color(isFuel ? 0x39d7ff : 0xff5a2a);
    const base = 26000 + this.combo * 12000;
    this.addScore(base, ev.ball.x, ev.ball.y, color);
    this.bonus += 3000;
    g.audio.chime(4 + (this.combo % 4));
    g.vfx.burst(ev.ball.x, ev.ball.y, color, 18, 1.0, 0.02);
    g.table.parts.rails[id].level = 1.6;
    g.cam.addShake(0.08);

    if (this.combo >= 1) {
      g.dmd.show({ l1: `${this.combo + 1}X COMBO`, l2: label, dur: 1.1 });
      g.hud.banner(`${this.combo + 1}X COMBO`, 0.9);
    } else {
      g.dmd.show({ l1: label, l2: base.toLocaleString('en-US'), dur: 1.0 });
    }

    if (this.multiball) {
      this.jackpot(ev.ball);
      return;
    }
    if (this.mode === 'FUEL' && isFuel) this.modeHit(ev);
    else if (this.mode === 'REENTRY' && !isFuel) this.modeHit(ev);
    else if (!this.mode) this.maybeStartMode(isFuel ? 'FUEL' : 'REENTRY');
  }

  /* ------------------------------------------------------------ */

  awardSkill(lane, ev) {
    this.skillArmed = false;
    this.skillWindow = 0;
    const v = 120000 + lane * 40000;
    this.addScore(v, ev.x, ev.y, new THREE.Color(0xffffff));
    this.g.dmd.show({ big: 'SKILL', l2: v.toLocaleString('en-US'), dur: 2.0, prio: true });
    this.g.hud.banner('SKILL SHOT', 1.6);
    this.g.audio.jackpot();
    this.g.vfx.lightShow(60);
    this.g.cam.addShake(0.25);
  }

  captureSaucer(ball) {
    const g = this.g;
    const s = L.saucer;
    ball.held = { x: s.x, y: s.y, z: -0.012 };
    ball.heldT = 1.1;
    this.saucerBall = ball;
    this.saucerT = 1.15;
    g.table.parts.saucer.level = 1;
    g.audio.saucer();
    const wp = V(s.x, s.y, 0.02);
    g.table.group.localToWorld(wp);
    g.cam.zoomTo(wp, 0.85, 1.5);

    if (this.multiball) {
      this.jackpot(ball, 2);
      return;
    }
    if (this.locks < 2) {
      this.lockBall(ball);
    } else {
      this.startMultiball();
    }
  }

  lockBall(ball, virtual = false) {
    this.locks++;
    const g = this.g;
    g.dmd.show({ big: `LOCK ${this.locks}`, l2: this.locks >= 3 ? 'MULTIBALL READY' : 'SHOOT WORMHOLE', dur: 1.6, prio: true });
    g.hud.banner(`LOCK ${this.locks}`, 1.3);
    g.audio.chime(this.locks + 3);
    this.addScore(45000, ball ? ball.x : L.saucer.x, ball ? ball.y : L.saucer.y, new THREE.Color(0xa64cff));
    void virtual;
    this.updateLamps();
  }

  startMultiball() {
    const g = this.g;
    this.multiball = true;
    this.locks = 0;
    this.mbJackpot = 250000;
    g.dmd.show({ anim: 'multiball', dur: 3.2, prio: true });
    g.hud.banner('MULTIBALL', 2.2);
    g.audio.knocker();
    g.audio.setMusic(1);
    g.vfx.lightShow(140);
    g.cam.addShake(0.6);
    g.flash(0.35);
    // release two more balls from the trough into play
    for (let i = 0; i < 2; i++) {
      g.sched.after(0.34 + i * 0.42, () => {
        if (!this.multiball) return;
        const b = g.spawnBall(L.plunger.x, L.plunger.y + 0.03);
        b.lane = true;
        b.vy = 5.4 + random() * 0.6;
        g.audio.plungerRelease(1);
      }, `mb-release-${i}`);
    }
    this.updateLamps();
  }

  endMultiball() {
    if (!this.multiball) return;
    this.multiball = false;
    this.g.audio.setMusic(0.35);
    this.g.dmd.show({ l1: 'MULTIBALL', l2: 'OVER', dur: 1.4 });
    this.updateLamps();
  }

  jackpot(ball, mult = 1) {
    const g = this.g;
    const v = this.mbJackpot * mult;
    this.addScore(v, ball.x, ball.y, new THREE.Color(0xffd06a));
    this.mbJackpot = Math.min(1200000, Math.round(this.mbJackpot * 1.35));
    g.dmd.show({ anim: 'jackpot', l2: v.toLocaleString('en-US'), dur: 1.7, prio: true });
    g.hud.banner('JACKPOT', 1.4);
    g.audio.jackpot();
    g.vfx.lightShow(90);
    g.vfx.burst(ball.x, ball.y, new THREE.Color(0xffd06a), 40, 1.7, 0.03);
    g.cam.addShake(0.4);
    g.flash(0.3);
  }

  maybeStartMode(key) {
    if (this.mode || this.multiball) return;
    if (!this.modeQueue.includes(key)) return;
    this.mode = key;
    this.modeCount = 0;
    const m = MODES[key];
    this.g.dmd.show({ big: 'MISSION', l2: m.name, dur: 2.0, prio: true });
    this.g.hud.banner(m.name, 1.8);
    this.g.audio.setMusic(0.72);
    this.g.vfx.lightShow(40);
    this.updateLamps();
  }

  modeHit(ev) {
    const m = MODES[this.mode];
    this.modeCount++;
    const v = m.base * this.modeCount;
    this.addScore(v, ev.x ?? ev.ball?.x, ev.y ?? ev.ball?.y, new THREE.Color(0x7fe8ff));
    this.g.dmd.show({ l1: m.name, l2: `${this.modeCount}/${m.need}`, dur: 1.0 });
    if (this.modeCount >= m.need) {
      this.missionsDone++;
      this.modeQueue = this.modeQueue.filter((k) => k !== this.mode);
      if (!this.modeQueue.length) this.modeQueue = ['FUEL', 'REENTRY', 'NAV'];
      this.addScore(m.base * 6);
      this.g.dmd.show({ big: 'MISSION', l2: 'COMPLETE', dur: 2.2, prio: true });
      this.g.hud.banner('MISSION COMPLETE', 2.0);
      this.g.audio.knocker();
      this.g.vfx.lightShow(110);
      this.g.cam.addShake(0.4);
      this.mode = null;
      this.extraBallLit = true;
      this.g.audio.setMusic(0.35);
    }
    this.updateLamps();
  }

  resetDrops(silent) {
    for (const d of this.g.table.parts.drops) d.down = false;
    this.dropsDown = 0;
    if (!silent) this.g.audio.clack(0.7);
  }

  /* ------------------------------------------------------------ */

  nudged(power) {
    if (this.tilted) return;
    this.tiltWarn += power;
    if (this.tiltWarn > 2.6) this.doTilt();
    else if (this.tiltWarn > 1.7) {
      this.g.dmd.show({ big: 'DANGER', l2: 'EASY!', dur: 0.9, prio: true });
    }
  }

  doTilt() {
    this.tilted = true;
    const g = this.g;
    g.dmd.show({ anim: 'tilt', dur: 3.0, prio: true });
    g.hud.banner('TILT', 2.2);
    g.audio.tilt();
    g.cam.addShake(1.1);
    g.audio.setMusic(0);
    this.bonus = 0;
    for (const f of g.world.flippers) f.enabled = false;
    for (const k in g.table.lamps) g.table.setLamp(k, false);
  }

  /* ------------------------------------------------------------ */

  updateLamps() {
    const t = this.g.table;
    t.setLamp('multiball', this.locks >= 2 || this.multiball, this.multiball ? 6 : 2);
    t.setLamp('jackpot', this.multiball, 5);
    t.setLamp('bonusx', this.multiplier > 1, 0);
    t.setLamp('extraball', this.extraBallLit, 3);
    t.setLamp('reentry', this.mode === 'REENTRY' || this.multiball, this.mode === 'REENTRY' ? 3 : 0);
    t.setLamp('fuel', this.mode === 'FUEL' || this.multiball, this.mode === 'FUEL' ? 3 : 0);
    t.setLamp('inlaneL', this.extraBallLit, 4);
    t.setLamp('inlaneR', this.extraBallLit, 4);
    t.setLamp('outlaneL', this.multiplier > 2, 0);
    t.setLamp('outlaneR', this.multiplier > 2, 0);
    for (let i = 0; i < 4; i++) t.setLamp(`nova${i}`, this.novaLit[i], 0);
    for (const s of t.parts.standups) s.lit = this.mode === 'NAV';
  }

  get modeName() {
    if (this.multiball) return 'WORMHOLE MULTIBALL';
    return this.mode ? MODES[this.mode].name : null;
  }
  get modeSub() {
    if (this.multiball) return 'SHOOT RAMPS + WORMHOLE FOR JACKPOTS';
    return this.mode ? MODES[this.mode].sub : null;
  }
  get modeProgress() {
    if (this.multiball) return null;
    return this.mode ? this.modeCount / MODES[this.mode].need : null;
  }

  /* ------------------------------------------------------------ */

  update(dt) {
    const g = this.g;

    // score rollup with a mechanical chime tick
    if (this.displayScore < this.score) {
      const diff = this.score - this.displayScore;
      const step = Math.max(1, Math.min(diff, Math.ceil(diff * dt * 5.5) + Math.ceil(dt * 40000)));
      this.displayScore += step;
      if (this.displayScore > this.score) this.displayScore = this.score;
    }

    if (this.serveT > 0) {
      this.serveT -= dt;
      if (this.serveT <= 0) this.doServe();
    }

    // Watchdog. Nothing in a pinball machine is allowed to leave the player
    // with no ball and no pending serve: a swallowed kickout, a lost drain
    // event or a stuck lock must always recover on its own.
    const anyBall = this.g.balls.some((b) => b.alive);
    if (!anyBall && this.serveT <= 0 && !this.saucerBall && !this.gameOver) {
      this.emptyT = (this.emptyT || 0) + dt;
      if (this.emptyT > 1.2) {
        this.emptyT = 0;
        this.ballInPlay = false;
        this.serveBall(0.2);
      }
    } else this.emptyT = 0;

    if (this.skillArmed) {
      this.skillWindow = 6;
    }

    if (this.dropResetT > 0) {
      this.dropResetT -= dt;
      if (this.dropResetT <= 0) this.resetDrops();
    }

    if (this.saucerT > 0) {
      this.saucerT -= dt;
      if (this.saucerT <= 0 && this.saucerBall) {
        const b = this.saucerBall;
        this.saucerBall = null;
        b.held = null;
        b.z = 0;
        b.x = L.saucer.x;
        b.y = L.saucer.y - L.saucer.r;
        const a = -Math.PI / 2 + (random() - 0.5) * 0.5;
        const sp = 3.6;
        b.vx = Math.cos(a) * sp;
        b.vy = Math.sin(a) * sp;
        g.audio.plungerRelease(0.8);
        g.cam.zoomTo(new THREE.Vector3(), 0, 0.1);
      }
    }

    if (this.tilted) {
      // tilt clears once every ball has drained
      if (!this.ballInPlay) {
        for (const f of g.world.flippers) f.enabled = true;
      }
    }

    this.tiltWarn = Math.max(0, this.tiltWarn - dt * 0.32);
    if (this.comboT && g.world.time - this.comboT > 3.4) this.combo = 0;

    // music intensity tracks the action
    const target = this.multiball ? 1 : this.mode ? 0.72 : this.ballInPlay ? 0.35 : 0.12;
    if (Math.abs((g.audio.musicIntensity || 0) - target) > 0.02) g.audio.setMusic(target);
  }

  hudState() {
    return {
      displayScore: this.displayScore,
      score: this.score,
      ball: this.ball,
      ballsLeft: this.ballsLeft,
      totalBalls: this.totalBalls,
      multiplier: this.multiplier,
      rankName: this.rankName,
      nextRank: this.nextRank,
      missionsDone: this.missionsDone,
      modeName: this.modeName,
      modeSub: this.modeSub,
      modeProgress: this.modeProgress,
      tilted: this.tilted,
      hint: this.hint,
    };
  }
}
