/**
 * Space Cadet: Nova — entry point.
 *
 * Wires the renderer, IBL, table, physics, rules, audio, VFX, HUD, camera and
 * post chain together; owns the frame loop and the harness contract.
 */

import * as THREE from 'three';
import { L } from './layout.js';
import { World, MAT } from './physics.js';
import { buildEnvironment, buildBackdrop, buildFloor, buildNeighbours, buildRoomDressing } from './env.js';
import { createMaterials } from './materials.js';
import { Table, V } from './table.js';
import { DMD } from './dmd.js';
import { VFX, BallView } from './vfx.js';
import { PostFX } from './postfx.js';
import { CameraRig } from './camera.js';
import { HUD } from './hud.js';
import { Rules } from './rules.js';
import { Audio } from './audio.js';
import { Scheduler } from './scheduler.js';
import { seed as setSeed, random } from './rng.js';
import { Q, setTier } from './quality.js';
import { makeBallProbe } from './art.js';

const qs = new URLSearchParams(location.search);

/* ------------------------------------------------------------------ */
/* renderer + quality                                                  */
/* ------------------------------------------------------------------ */

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  // Deliberately NOT preserveDrawingBuffer. On a CPU rasteriser it forces the
  // compositor to copy the whole 1600x900 surface instead of swapping it, and
  // that first copy stalled the frame *after* the first render by ~11 s.
  // Chromium's screenshot path forces its own composite, so captures are
  // unaffected, and the shot harness retries blank frames anyway.
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const BASE_EXPOSURE = 1.34;
renderer.toneMappingExposure = BASE_EXPOSURE;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
app.appendChild(renderer.domElement);

function isSoftwareGL() {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const s = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    return /swiftshader|llvmpipe|software|basic render|mesa offscreen/i.test(s);
  } catch (e) {
    void e;
    return false;
  }
}
Q.softwareGL = isSoftwareGL();

function detectTier() {
  const forced = qs.get('q') || qs.get('quality');
  if (forced) return forced;
  if (Q.softwareGL) return 'high';
  if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) return 'med';
  return 'ultra';
}

let quality = detectTier();
setTier(quality);
quality = Q.tier;
renderer.setPixelRatio(Math.max(0.5, Q.pixelRatio));

/* ------------------------------------------------------------------ */

setSeed(parseInt(qs.get('seed') || '1337', 10) || 1337);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 0.02, 80);
camera.position.set(0, 0.8, 0.8);

const T0 = performance.now();
const MARKS = [];
const mark = (n) => {
  MARKS.push([n, Math.round(performance.now() - T0)]);
  if (qs.get('t')) console.log('[t]', n, Math.round(performance.now() - T0));
};
const env = buildEnvironment(renderer);
mark('env');
scene.environment = env;
const backdrop = buildBackdrop();
// The room lives on its own layer. The key/top/rim rig is sized to blast a
// 60cm playfield, and any directional strong enough to do that also floods a
// 50m carpet to mid-grey - which is what turned the arcade into a fog bank.
// Off layer 0 the room is lit purely by the dark IBL plus its own emissive
// marquees, neon and floor pools, which is exactly how an arcade reads.
const ROOM_LAYER = 2;
const room = new THREE.Group();
room.add(backdrop, buildFloor(env), buildNeighbours(env), buildRoomDressing(env));
room.traverse((o) => o.layers.set(ROOM_LAYER));
scene.add(room);
camera.layers.enable(ROOM_LAYER);

// A dedicated rig for the room only. Layer-gated so it cannot touch the
// playfield: the walls need soft, wide, low-intensity fill with real falloff
// from the modelled ceiling troughs, and the table needs the opposite.
const roomAmb = new THREE.HemisphereLight(0x8fb0ff, 0x1a1430, 1.20);
roomAmb.layers.set(ROOM_LAYER);
scene.add(roomAmb);
const roomKey = new THREE.DirectionalLight(0xbcd2ff, 0.58);
roomKey.position.set(2.2, 3.4, 1.6);
roomKey.layers.set(ROOM_LAYER);
scene.add(roomKey);
if (Q.practicalLights) {
  for (const [px, pz, col, inten] of [
    [-3.4, -3.1, 0xffc98a, 5.2],
    [1.9, -3.1, 0xffc98a, 5.2],
    [-6.4, -4.4, 0xff5fc8, 2.4],
    [0.0, -6.6, 0x66d0ff, 3.0],
  ]) {
    const pl = new THREE.PointLight(col, inten, 6.2, 2);
    pl.position.set(px, 1.18, pz);
    pl.layers.set(ROOM_LAYER);
    scene.add(pl);
  }
}

const M = createMaterials(renderer, env);
mark('materials');

/* ---- lighting ---- */
const key = new THREE.DirectionalLight(0xfff2e2, 0.88);
key.position.set(-1.55, 3.05, -1.95);
key.target.position.set(0, 0, -0.55);
key.castShadow = true;
const shadowRes = Q.softwareGL ? 640 : ({ low: 1024, med: 1024, high: 2048, ultra: 2048 }[quality] || 1024);
key.shadow.mapSize.set(shadowRes, shadowRes);
key.shadow.camera.left = -0.78;
key.shadow.camera.right = 0.78;
key.shadow.camera.top = 1.35;
key.shadow.camera.bottom = -1.35;
key.shadow.camera.near = 0.4;
key.shadow.camera.far = 5.4;
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.0025;
key.shadow.radius = 2.6;
scene.add(key);
scene.add(key.target);

const rim = new THREE.DirectionalLight(0x6fa8ff, 0.20);
rim.position.set(-1.4, 1.0, -1.6);
scene.add(rim);

// separation rim from behind the backbox so ramps and wireforms read as
// silhouettes against the playfield art instead of melting into it
// kicker from camera-left so the near cabinet face never goes to pure black
const sideKick = new THREE.DirectionalLight(0x9db4ff, 0.20);
sideKick.position.set(-2.4, 0.55, 1.7);
sideKick.target.position.set(0, -0.2, -0.3);
scene.add(sideKick);
scene.add(sideKick.target);

const backRim = new THREE.DirectionalLight(0x7fb4ff, 0.16);
backRim.position.set(-0.8, 1.4, -2.6);
backRim.target.position.set(0, 0, -0.4);
scene.add(backRim);
scene.add(backRim.target);

// warm bounce card at floor level so the legs and cabinet base catch light
const bounce = new THREE.PointLight(0xffb478, 0.34, 3.6, 2);
bounce.position.set(0, -0.85, 0.55);
if (Q.practicalLights) scene.add(bounce);

// Ambient must stay low: every unit of unshadowed fill directly cancels
// the key's shadows, and a shadowless playfield reads as a flat decal.
const fill = new THREE.HemisphereLight(0xa8c8ff, 0x2a1c40, 0.13);
scene.add(fill);

// The playfield's own overhead light — mounted high and up-table, the way a
// real machine is lit from the backbox hood. It casts, so every plastic,
// post, ramp and the ball drop a crisp shadow down-table onto the art. This
// second shadow caster is what makes the board read as a manufactured object
// rather than a printed mousepad.
const topFill = new THREE.DirectionalLight(0xdfe8ff, 0.36);
topFill.position.set(0.20, 2.35, -2.10);
topFill.target.position.set(0.02, 0, -0.52);
topFill.castShadow = true;
topFill.shadow.mapSize.set(shadowRes, shadowRes);
topFill.shadow.camera.left = -0.40;
topFill.shadow.camera.right = 0.40;
topFill.shadow.camera.top = 0.78;
topFill.shadow.camera.bottom = -0.78;
topFill.shadow.camera.near = 1.2;
topFill.shadow.camera.far = 4.2;
topFill.shadow.bias = -0.00035;
topFill.shadow.normalBias = 0.0016;
topFill.shadow.radius = 2.2;
scene.add(topFill);
scene.add(topFill.target);

// dedicated lift on the lower playfield (flippers / launch pad). A grazing
// directional keeps the clearcoat lobe off-camera so nothing blows out.
const lowerFill = new THREE.DirectionalLight(0x9fbdff, 0.16);
lowerFill.position.set(-1.05, 0.95, 0.62);
lowerFill.target.position.set(0.02, 0.02, -0.30);
scene.add(lowerFill);
scene.add(lowerFill.target);

// The machine's own hood light. Range-limited so it dies before it reaches
// the carpet: the playfield has to be the brightest surface in frame, and a
// scene-wide directional bright enough to do that also floods the room grey.
const pfSpot = new THREE.SpotLight(0xeaf2ff, 1.05, 3.10, 0.70, 0.72, 1.0);
pfSpot.position.set(0.10, 1.46, -0.52);
pfSpot.target.position.set(0.02, 0, -0.56);
scene.add(pfSpot);
scene.add(pfSpot.target);

const playerGlow = new THREE.PointLight(0xffb877, 0.55, 3.2, 2);
playerGlow.position.set(0, 0.5, 1.1);
if (Q.tier !== 'low' && Q.practicalLights) scene.add(playerGlow);

// general-illumination wash: the bulbs under the plastics that make a real
// machine glow. Two warm, two cool, spread along the table.
const giLights = [];
const GI_DEFS = [
  [-0.20, -0.31, 0xff5fa8, 0.34],
  [0.17, -0.24, 0x4fd8ff, 0.34],
  [-0.16, -0.74, 0xffc59a, 0.30],
  [0.14, -0.98, 0x9ec4ff, 0.28],
];
for (const [gx, gz, col, inten] of GI_DEFS.slice(0, Q.sceneGI)) {
  const pl = new THREE.PointLight(col, inten, 0.5, 2);
  pl.position.set(gx, 0.11, gz);
  giLights.push(pl);
  scene.add(pl);
}

/* ------------------------------------------------------------------ */
/* world + table                                                       */
/* ------------------------------------------------------------------ */

const world = new World({ incline: L.incline, ballR: L.ballR, drainY: -0.02 });
world.bounds = { x0: -0.3, x1: 0.3, y0: -0.2, y1: 1.16 };

const dmd = new DMD(8);
const table = new Table(renderer, M, env, quality).build(world, dmd);
mark('table');
scene.add(table.group);

const vfx = new VFX(table.playfieldGroup, env);
const hud = new HUD(document.body);
const cam = new CameraRig(camera, table);
const audio = new Audio();
const sched = new Scheduler();

/* ---- hero ball: live cube reflection ---- */
let ballEnvRT = null;
let cubeCam = null;
const ballMat = M.chrome.clone();
// dedicated studio probe: the room PMREM is far too dark to make a mirror
// sphere read, and the hero ball must always look like polished steel.
const ballProbe = new THREE.CanvasTexture(makeBallProbe(Q.tier === 'low' ? 256 : 512));
ballProbe.mapping = THREE.EquirectangularReflectionMapping;
ballProbe.colorSpace = THREE.SRGBColorSpace;
ballMat.envMap = ballProbe;
ballMat.envMapIntensity = 2.15;
ballMat.color = new THREE.Color(0xf2f5fa);
ballMat.metalness = 1;
ballMat.roughness = 0.035;
if (Q.cubeReflect) {
  ballEnvRT = new THREE.WebGLCubeRenderTarget(Q.tier === 'ultra' ? 256 : 128, { type: THREE.HalfFloatType });
  cubeCam = new THREE.CubeCamera(0.02, 6, ballEnvRT);
  cubeCam.children.forEach((c) => c.layers.enable(ROOM_LAYER));
  scene.add(cubeCam);
}
// The ball keeps the studio probe until the cube camera has genuinely
// rendered — an un-updated cube RT is pure black and turns the hero object
// into a dead grey marble, which is exactly what happens under software GL.
let cubeReady = 0;

/* ------------------------------------------------------------------ */

const game = {
  world,
  table,
  dmd,
  vfx,
  hud,
  cam,
  audio,
  sched,
  balls: world.balls,
  views: [],
  flashV: 0,
  flash(v) {
    this.flashV = Math.max(this.flashV, v);
  },
  spawnBall(x, y, vx = 0, vy = 0) {
    const b = world.spawnBall(x, y, vx, vy);
    const view = new BallView(vfx, table.playfieldGroup, ballMat, L.ballR);
    view.ball = b;
    game.views.push(view);
    return b;
  },
};

const rules = new Rules(game);
game.rules = rules;

world.onEvent = (ev) => rules.onEvent(ev);

/* ------------------------------------------------------------------ */
/* input                                                              */
/* ------------------------------------------------------------------ */

const input = {
  left: false,
  right: false,
  plunge: false,
  pull: 0,
  releasing: 0,
  lastUser: -100,
};

let started = false;
const bootMs = performance.now();
let clock = 0;

function firstGesture() {
  audio.resume();
  if (!started) {
    started = true;
    hud.hideStart();
  }
}

function userAct() {
  input.lastUser = clock;
  firstGesture();
}

const KEYS_L = new Set(['KeyZ', 'ArrowLeft', 'ShiftLeft', 'KeyA']);
const KEYS_R = new Set(['Slash', 'ArrowRight', 'ShiftRight', 'KeyL', 'Period']);

addEventListener('keydown', (e) => {
  userAct();
  if (KEYS_L.has(e.code)) {
    if (!input.left) audio.flipper(true);
    input.left = true;
    e.preventDefault();
  }
  if (KEYS_R.has(e.code)) {
    if (!input.right) audio.flipper(true);
    input.right = true;
    e.preventDefault();
  }
  if (e.code === 'Space') {
    input.plunge = true;
    e.preventDefault();
  }
  if (e.code === 'KeyX' || e.code === 'Comma') nudge(-1);
  if (e.code === 'KeyC') nudge(1);
  if (e.code === 'ArrowUp' || e.code === 'KeyW') nudge(0, 1);
  if (e.code === 'ArrowDown') nudge(0, -1);
  if (e.code === 'Digit1') cam.setMode('table');
  if (e.code === 'Digit2') cam.setMode('follow');
  if (e.code === 'Digit3') cam.setMode('ballcam');
  if (e.code === 'Digit4') cam.setMode('cinematic');
  if (e.code === 'Digit5') cam.setMode('orbit');
  if (e.code === 'KeyM') audio.enabled = !audio.enabled;
});

addEventListener('keyup', (e) => {
  if (KEYS_L.has(e.code)) {
    input.left = false;
    audio.flipper(false);
  }
  if (KEYS_R.has(e.code)) {
    input.right = false;
    audio.flipper(false);
  }
  if (e.code === 'Space') {
    if (input.pull > 0.02) releasePlunger();
    input.plunge = false;
  }
});

addEventListener('pointerdown', (e) => {
  userAct();
  const x = e.clientX / window.innerWidth;
  if (x < 0.4) input.left = true;
  else if (x > 0.6) input.right = true;
  else input.plunge = true;
});
addEventListener('pointerup', () => {
  input.left = false;
  input.right = false;
  if (input.pull > 0.02) releasePlunger();
  input.plunge = false;
});

function nudge(dx, dy = 0) {
  userAct();
  world.nudge(dx * 13, dy * 13);
  cam.addShake(0.24);
  audio.thud(1.6);
  rules.nudged(0.62);
}

function releasePlunger() {
  const p = input.pull;
  if (p <= 0.02) return;
  input.releasing = 0.09;
  audio.plungerRelease(p);
  for (const b of world.balls) {
    if (b.x > L.laneIn && b.y < 0.30 && !b.rail && !b.held) {
      b.vy = 2.5 + p * 4.5;
      b.vx = (random() - 0.5) * 0.05;
      b.lane = false;
      dmd.show({ anim: 'launch', dur: 1.4 });
      rules.hint = 'HIT THE RAMPS';
      cam.addShake(0.12);
    }
  }
  input.pull = 0;
}

/* ------------------------------------------------------------------ */
/* demo / attract AI                                                   */
/* ------------------------------------------------------------------ */

let aiL = 0;
let aiR = 0;
let aiPlunge = 0;

function demoAI(dt) {
  aiL = Math.max(-0.6, aiL - dt);
  aiR = Math.max(-0.6, aiR - dt);
  aiPlunge = Math.max(0, aiPlunge - dt);
  let wantL = false;
  let wantR = false;
  let wantU = false;
  for (const b of world.balls) {
    if (b.rail || b.held) continue;
    if (b.x > L.laneIn && b.y < 0.30) {
      if (aiPlunge <= 0) {
        input.pull = 0.55 + random() * 0.45;
        releasePlunger();
        aiPlunge = 0.9;
      }
      continue;
    }
    const px = b.x + b.vx * 0.055;
    const py = b.y + b.vy * 0.055;
    const sp = Math.hypot(b.vx, b.vy);
    if (py < 0.28 && py > 0.075 && b.vy < 0.4 && sp > 0.55) {
      if (px < L.cx + 0.05 && px > -0.19) wantL = true;
      if (px > L.cx - 0.05 && px < 0.17) wantR = true;
    } else if (sp < 0.55 && b.y < 0.2 && b.y > 0.05) {
      // cradled — let it settle to the tip, then punt
      b._cradle = (b._cradle || 0) + dt;
      if (b._cradle > 0.75) {
        if (b.x < L.cx) wantL = true;
        else wantR = true;
        b._cradle = -0.4;
      }
    } else b._cradle = 0;
    if (py < 0.62 && py > 0.48 && b.vy < 0 && b.x > 0.0) wantU = true;
  }
  if (wantL && aiL <= -0.18) aiL = 0.12;
  if (wantR && aiR <= -0.18) aiR = 0.12;
  table.flipperL.pressed = aiL > 0;
  table.flipperR.pressed = aiR > 0;
  table.flipperU.pressed = wantU;
}

/* ------------------------------------------------------------------ */
/* post fx                                                             */
/* ------------------------------------------------------------------ */

const NOFX = qs.get('nofx') === '1';
const post = new PostFX(renderer, scene, camera, quality);
mark('post');

addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.setSize(w, h);
});

/* ------------------------------------------------------------------ */
/* loop                                                                */
/* ------------------------------------------------------------------ */

let paused = false;
let frames = 0;
let fpsAcc = 0;
let fps = 60;
let cubeT = 0;
let last = performance.now();
let readySent = false;
let totalFrames = 0;
let visDt = 0;
let lastCalls = 0;
let lastTris = 0;

function update(dt) {
  clock += dt;
  sched.update(dt);

  // Under software GL a single frame can cost 600 ms, so a real-time idle test
  // never trips; use the simulation clock and keep the window short.
  const idle = !!window.__SHOT__ || clock - input.lastUser > 1.5;
  rules.demo = idle;
  if (idle) demoAI(dt);
  else {
    table.flipperL.pressed = input.left;
    table.flipperR.pressed = input.right;
    table.flipperU.pressed = input.right;
  }

  if (input.plunge && !idle) {
    input.pull = Math.min(1, input.pull + dt * 1.7);
    input.plungeT = (input.plungeT || 0) + dt;
    if (random() < 0.25) audio.plungerPull(input.pull);
    // a stuck pointerdown (the shot harness clicks but may never release)
    // must not hold the plunger charged forever
    if (input.plungeT > 1.3) {
      releasePlunger();
      input.plunge = false;
      input.plungeT = 0;
    }
  } else input.plungeT = 0;
  if (input.releasing > 0) input.releasing -= dt;
  table.setPlunger(input.pull);

  // auto-plunge safety so a ball never sits in the lane forever
  for (const b of world.balls) {
    if (b.x > L.laneIn && b.y < 0.30 && Math.abs(b.vy) < 0.06) {
      b._laneT = (b._laneT || 0) + dt;
      const forced = b._laneT > 1.5;
      if (b._laneT > 0.55 && (!input.plunge || forced)) {
        input.pull = 0.6 + random() * 0.4;
        releasePlunger();
        input.plunge = false;
        b._laneT = 0;
      }
    } else b._laneT = 0;
  }

  // ---- left-outlane kickback -------------------------------------------
  // A real coil in the left outlane that fires the ball back up the lane.
  // Lit by the inlane rollovers in normal play; always armed in attract mode
  // so the demo table never reads as an empty board.
  for (const b of world.balls) {
    if (!b.alive || b.rail || b.held) continue;
    if (b.x < -0.2255 && b.y < 0.29 && b.y > 0.115 && b.vy < 0.35) {
      const armed = rules.demo || rules.kickbackLit;
      if (!armed) continue;
      b.vy = 5.1 + random() * 0.5;
      b.vx = 0.12;
      b.spin = -12;
      if (!rules.demo) rules.kickbackLit = false;
      table.fireKickback();
      audio.sling(1.0);
      audio.thud(1.5);
      vfx.sparks(b.x, b.y - 0.02, 0, 1, new THREE.Color(0xffd08a), 14, 1.3);
      dmd.show({ big: 'KICKBACK', dur: 1.0 });
      hud.banner('KICKBACK', 0.9);
      cam.addShake(0.16);
      rules.addScore(2500, b.x, b.y, new THREE.Color(0xffd08a));
    }
  }

  // ball search: never let a ball stay wedged
  for (const b of world.balls) {
    if (!b.alive || b.rail || b.held) continue;
    const sp = Math.hypot(b.vx, b.vy);
    const inLane = b.x > L.laneIn && b.y < 0.3;
    if (sp < 0.09 && !inLane) {
      b._stuck = (b._stuck || 0) + dt;
      if (b._stuck > 2.2) {
        world.nudge((random() - 0.5) * 18, 9);
        cam.addShake(0.16);
        audio.thud(1.1);
        b._stuck = 0;
        b._search = (b._search || 0) + 1;
        if (b._search > 2) {
          // full ball search: put it back in the shooter lane
          b.x = L.plunger.x;
          b.y = L.plunger.y + 0.03;
          b.vx = 0;
          b.vy = 0;
          b.spin = 0;
          b.lane = true;
          b._search = 0;
          dmd.show({ l1: 'BALL', l2: 'SEARCH', dur: 1.0 });
        }
      }
    } else {
      b._stuck = 0;
      b._search = 0;
    }
    // positional stagnation: a ball rattling in one spot is also stuck
    if (b._sx === undefined || Math.hypot(b.x - b._sx, b.y - b._sy) > 0.11) {
      b._sx = b.x;
      b._sy = b.y;
      b._sT = 0;
    } else if (!inLane) {
      b._sT = (b._sT || 0) + dt;
      if (b._sT > 6) {
        b._sT = 0;
        b.x = L.plunger.x;
        b.y = L.plunger.y + 0.03;
        b.vx = 0;
        b.vy = 0;
        b.spin = 0;
        b.lane = true;
        dmd.show({ l1: 'BALL', l2: 'SEARCH', dur: 1.0 });
      }
    }
  }

  world.update(dt);
  world.events.length = 0;

  for (let i = world.balls.length - 1; i >= 0; i--) {
    if (!world.balls[i].alive) {
      const b = world.balls[i];
      world.balls.splice(i, 1);
      const vi = game.views.findIndex((v) => v.ball === b);
      if (vi >= 0) {
        game.views[vi].dispose(table.playfieldGroup);
        game.views.splice(vi, 1);
      }
    }
  }

  rules.update(dt);
  visDt += dt;
}

/** Per-rendered-frame visual sync. Runs once per frame, never per substep. */
function syncViews() {
  const dt = visDt || 1 / 240;
  visDt = 0;
  table.update(dt, clock);
  const punch = table.runShow(dt);
  if (punch > 0) game.flash(punch * 0.32);
  renderer.toneMappingExposure = BASE_EXPOSURE * (1 + punch * 0.10);
  vfx.update(dt);

  let hero = null;
  let heroSpeed = -1;
  for (const v of game.views) {
    v.update(v.ball, dt, camera);
    const s = v.ball.speed || 0;
    if (s > heroSpeed) {
      heroSpeed = s;
      hero = v.ball;
    }
  }
  if (!hero && world.balls.length) hero = world.balls[0];

  audio.setRolling(hero ? hero.speed || 0 : 0, hero ? !!hero.rail : false);
  audio.updateMusic(dt);

  const st = rules.hudState();
  dmd.update(dt, st);
  hud.update(dt, st);
  cam.update(dt, hero, world.balls);

  backdrop.material.uniforms.uTime.value = clock;
  const pulse = 0.75 + Math.sin(clock * 2.1) * 0.12;
  table.parts.dmdLight.intensity = 0.7 * pulse + game.flashV * 2;
  table.parts.barLight.intensity = 0.6 * pulse;
  playerGlow.intensity = 0.5 + game.flashV * 2.5;
  for (let i = 0; i < giLights.length; i++) {
    giLights[i].intensity = GI_DEFS[i][3] * (0.85 + Math.sin(clock * 1.7 + i * 1.9) * 0.15);
  }
  game.flashV = Math.max(0, game.flashV - dt * 2.4);

  if (!started && (clock > 0.7 || performance.now() - bootMs > 700 || window.__SHOT__)) {
    started = true;
    hud.hideStart();
  }

  // The cube pass is 6 extra scene renders; throttle it hard and skip it
  // entirely when the frame budget is already blown (software GL).
  if (cubeCam && hero && frameMs < 90) {
    cubeT += dt;
    if (cubeT > 0.28) {
      cubeT = 0;
      const wp = V(hero.x, hero.y, hero.z + L.ballR);
      table.group.localToWorld(wp);
      cubeCam.position.copy(wp);
      const hidden = [];
      for (const v of game.views) {
        hidden.push(v.group, v.trail);
        v.group.visible = false;
        v.trail.visible = false;
      }
      const gl = table.parts.glass;
      const gv = gl.visible;
      gl.visible = false;
      cubeCam.update(renderer, scene);
      gl.visible = gv;
      for (const o of hidden) o.visible = true;
      if (++cubeReady === 2) {
        // Two good renders in the bank: the live cube is now strictly better
        // than the static probe, so promote it.
        ballMat.envMap = ballEnvRT.texture;
        ballMat.envMapIntensity = 2.15;
        ballMat.needsUpdate = true;
      }
    }
  }
}


const PHYS_H = 1 / 240;      // game-logic + physics fixed step
const SUB_MAX = 320;         // hard ceiling on catch-up substeps per frame
let acc = 0;
let frameMs = 16;            // smoothed frame cost, drives adaptive resolution
let dynScale = 1;            // 0.45 .. 1 multiplier on Q.pixelRatio
let curScale = -1;

function applyResolution() {
  const want = Math.max(0.42, Math.min(2, Q.pixelRatio * dynScale));
  if (Math.abs(want - curScale) < 0.04) return;
  curScale = want;
  renderer.setPixelRatio(want);
  post.setSize(window.innerWidth, window.innerHeight, want);
}

const MIN_SCALE = Q.softwareGL ? 0.72 : 0.45;
const SIM_BUDGET_MS = Q.softwareGL ? 90 : 9;
const SHADOW_EVERY = Q.softwareGL ? 3 : 1;
if (SHADOW_EVERY > 1) renderer.shadowMap.autoUpdate = false;
const perf = { sim: 0, sync: 0, draw: 0 };
window.__PERF__ = perf;

function step(now) {
  const t0 = now;
  const t0Real = performance.now();
  const wall = (now - last) / 1000;
  last = now;

  // ---- adaptive resolution: keep the frame budget under ~110ms even on
  // software GL so the fixed-step accumulator can actually track wall clock.
  const ms = Math.min(4000, wall * 1000);
  frameMs = totalFrames < 3 ? ms : frameMs * 0.8 + ms * 0.2;
  const budget = Q.softwareGL ? 760 : 34;
  if (frameMs > budget) dynScale = Math.max(MIN_SCALE, dynScale * (frameMs > budget * 3 ? 0.6 : 0.88));
  else if (frameMs < budget * 0.55 && dynScale < 1) dynScale = Math.min(1, dynScale + 0.04);
  applyResolution();

  // ---- fixed timestep. Every substep is exactly PHYS_H so behaviour is
  // frame-rate independent. The catch-up budget is a *time* budget, not a
  // step count: a 240Hz substep with three balls costs tens of microseconds,
  // which is nothing next to a 700ms software-GL draw, so on a CPU rasteriser
  // we happily run 200+ substeps to keep game time locked to wall clock. A
  // hard step ceiling plus the time bail-out make a spiral impossible.
  if (!paused) {
    acc += Math.min(1.2, wall);
    let n = 0;
    while (acc >= PHYS_H && n < SUB_MAX) {
      update(PHYS_H);
      acc -= PHYS_H;
      n++;
      if ((n & 15) === 0 && performance.now() - t0Real > SIM_BUDGET_MS) break;
    }
    if (acc > PHYS_H * 4) acc = 0;
  } else {
    acc = 0;
  }

  const tSim = performance.now();
  // The shadow map is a second full-geometry pass into a buffer larger than
  // the framebuffer itself. On CPU rasterisers it dominates the frame, so it
  // refreshes on a third of the frames -- the ball shadow lags by ~2 frames at
  // 6fps, which is invisible next to the cost.
  renderer.shadowMap.needsUpdate =
    SHADOW_EVERY === 1 || totalFrames < 4 || totalFrames % SHADOW_EVERY === 0;
  renderer.info.reset();
  syncViews();
  const tSync = performance.now();
  if (NOFX) renderer.render(scene, camera);
  else post.render(Math.min(0.1, wall), clock, cam.focus, cam.shakeVec, game.flashV);
  const tDraw = performance.now();
  perf.sim = perf.sim * 0.8 + (tSim - t0Real) * 0.2;
  perf.sync = perf.sync * 0.8 + (tSync - tSim) * 0.2;
  perf.draw = perf.draw * 0.8 + (tDraw - tSync) * 0.2;
  lastCalls = renderer.info.render.calls;
  lastTris = renderer.info.render.triangles;

  frames++;
  fpsAcc += wall;
  if (fpsAcc > 0.5) {
    fps = frames / fpsAcc;
    frames = 0;
    fpsAcc = 0;
  }
  totalFrames++;
  void t0;
  // Flip READY synchronously at the end of the second completed render. Two
  // frames guarantee a composited, non-blank buffer; scheduling it off a
  // nested requestAnimationFrame instead added seconds of latency on software
  // GL even though the scene had been fully drawn since frame 1.
  if (!readySent && totalFrames >= 2) {
    readySent = true;
    mark('firstframe');
    window.__READY__ = true;
    mark('ready');
  }
}

cam.update(0.016, null, []);
renderer.compile(scene, camera);
mark('compile');

renderer.setAnimationLoop(step);

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

rules.startGame();
dmd.update(0.016, rules.hudState());

const camParam = qs.get('cam');
cam.setMode(camParam || 'table');
// An explicit ?cam= (or the shot harness) means "give me this exact framing":
// suppress the event zoom-ins so repeat captures are byte-comparable.
cam.lockFraming = !!camParam || !!window.__SHOT__;
cam._snap = true;

// The start card is presentation only; dismiss it on a wall-clock timer so a
// slow first frame can never leave it on screen during a capture.
setTimeout(() => {
  if (!started) {
    started = true;
    hud.hideStart();
  }
}, 700);

function forceEvent(name) {
  const b = world.balls[0];
  table.startShow(name);
  cam.addShake(name === 'tilt' ? 1.0 : 0.55);
  game.flash(name === 'tilt' ? 0.5 : 0.35);
  switch (name) {
    case 'multiball':
      rules.startMultiball();
      break;
    case 'jackpot':
      rules.multiball = true;
      rules.jackpot(b || { x: 0, y: 0.5 });
      break;
    case 'tilt':
      rules.doTilt();
      break;
    case 'bumper':
      for (const bp of table.parts.bumpers) {
        bp.level = 1;
        vfx.burst(bp.x, bp.y, new THREE.Color(0x8fd8ff), 20, 1.1, 0.03);
      }
      audio.bumper(1);
      game.flash(0.2);
      break;
    case 'launch':
      input.pull = 1;
      releasePlunger();
      break;
    default:
      break;
  }
}

const evParam = qs.get('event');
if (evParam) {
  // Re-fire off the simulation clock, never `setInterval`: a blocked main
  // thread makes wall-clock intervals bunch up and fire several times in one
  // frame, which strobes the lamp show instead of sustaining it.
  sched.every(2.2, () => forceEvent(evParam), 0.5, 'ev-driver');
}

window.__STATS__ = () => ({
  fps: Math.round(fps * 10) / 10,
  drawCalls: lastCalls,
  triangles: lastTris,
  quality,
  resScale: Math.round(curScale * 100) / 100,
  frameMs: Math.round(frameMs * 10) / 10,
});

window.__GAME__ = {
  THREE,
  cam,
  setCamera: (n) => {
    cam.lockFraming = true;
    cam.setMode(n);
  },
  pause: () => {
    paused = true;
  },
  resume: () => {
    paused = false;
    last = performance.now();
  },
  seed: (n) => setSeed(n),
  forceEvent,
  setQuality: (tier) => {
    setTier(tier);
    quality = Q.tier;
    renderer.setPixelRatio(Math.max(0.5, Q.pixelRatio));
    post.setQuality(quality);
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.setSize(window.innerWidth, window.innerHeight);
  },
  world,
  rules,
  table,
  views: game.views,
  dmd,
  hud,
  vfx,
  audio,
  sched,
  MAT,
  renderer,
  scene,
  camera,
  post,
  marks: MARKS,
  get clock() {
    return clock;
  },
  get started() {
    return started;
  },
  get frames() {
    return totalFrames;
  },
};
