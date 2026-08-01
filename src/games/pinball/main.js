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
import { mergeStatics, flattenToBasic, bakeFlatColors, coalesceGroups, collectLive, census } from './optimize.js';

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
  window.__MARKS__ = MARKS;
  if (qs.get('t')) console.log('[t]', n, Math.round(performance.now() - T0));
};
const env = buildEnvironment(renderer);
mark('env');
scene.environment = env;
const backdrop = buildBackdrop();
// The room is set dressing and nothing else. It used to be lit by its own
// six-light rig on a private layer -- except three.js does not mask lights per
// object, so those six lights were being evaluated by every fragment of the
// playfield too. It is now unlit (MeshBasic) and merged down to a handful of
// draw calls: same silhouette, zero shading cost, six fewer lights.
const ROOM_LAYER = 2;
const room = new THREE.Group();
room.name = 'room';
room.add(buildFloor(env), buildNeighbours(env), buildRoomDressing(env));
flattenToBasic(room);
coalesceGroups(room);
bakeFlatColors(room);
mergeStatics(room, new Set());
room.add(backdrop);
room.traverse((o) => o.layers.set(ROOM_LAYER));
scene.add(room);
camera.layers.enable(ROOM_LAYER);

const M = createMaterials(renderer, env);
mark('materials');

/* ---- lighting ------------------------------------------------------
 * SIX lights. That is the entire rig, and it is deliberate.
 *
 * three.js evaluates every light in the scene in every fragment of every
 * material, and compiles a separate program per light-count. The previous rig
 * ran 38. Every lamp, flasher, insert and GI bulb that used to be a real
 * PointLight is now an emissive material driven through bloom -- which on a
 * stylised table looks *better* (it glows the object itself, not a grey
 * hemisphere around it) and costs nothing.
 * ------------------------------------------------------------------ */

const shadowRes = Q.softwareGL ? 640 : ({ low: 512, med: 1024, high: 1024, ultra: 1536 }[quality] || 1024);

// 1. KEY — the only shadow caster. Hard, warm, up-table, so the ball and the
//    flippers drop a crisp readable shadow onto the art.
const key = new THREE.DirectionalLight(0xfff4e6, 1.55);
key.position.set(-1.55, 3.05, -1.95);
key.target.position.set(0, 0, -0.55);
key.castShadow = true;
key.shadow.mapSize.set(shadowRes, shadowRes);
key.shadow.camera.left = -0.5;
key.shadow.camera.right = 0.5;
key.shadow.camera.top = 1.1;
key.shadow.camera.bottom = -1.1;
key.shadow.camera.near = 1.2;
key.shadow.camera.far = 5.0;
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.0025;
key.shadow.radius = 2.2;
scene.add(key);
scene.add(key.target);

// 2. COOL RIM from behind the backbox — separates ramps and wireforms from the
//    playfield art. Saturated blue against the warm key: instant contrast.
const rim = new THREE.DirectionalLight(0x4aa8ff, 0.62);
rim.position.set(-1.2, 1.5, -2.6);
rim.target.position.set(0, 0, -0.4);
scene.add(rim);
scene.add(rim.target);

// 3. PLAYER-SIDE KICK — keeps the near cabinet face and the flippers off black.
const sideKick = new THREE.DirectionalLight(0xff7ad0, 0.34);
sideKick.position.set(-2.0, 0.7, 1.9);
sideKick.target.position.set(0, -0.1, -0.2);
scene.add(sideKick);
scene.add(sideKick.target);

// 4. AMBIENT — low. Every unit of unshadowed fill cancels the key's shadows.
const fill = new THREE.HemisphereLight(0x9ec8ff, 0x2a1440, 0.42);
scene.add(fill);

// 5. HOOD SPOT — the machine's own light, range-limited so the playfield is
//    always the brightest thing in frame. This is what makes the table pop out
//    of the dark room.
const pfSpot = new THREE.SpotLight(0xf2f7ff, 2.30, 3.10, 0.74, 0.66, 1.0);
pfSpot.position.set(0.10, 1.46, -0.52);
pfSpot.target.position.set(0.02, 0, -0.56);
scene.add(pfSpot);
scene.add(pfSpot.target);

// 6. LOWER-TABLE SPOT — the flippers are where the player's eyes actually
//    live, and the key light rakes from up-table, so without this the whole
//    business end of the table sits in shadow. Tight range, no shadow map.
const lowSpot = new THREE.SpotLight(0xffe6cc, 1.85, 1.45, 0.92, 0.78, 1.0);
lowSpot.position.set(0.0, 0.78, 0.20);
lowSpot.target.position.set(0.0, 0, -0.18);
scene.add(lowSpot);
scene.add(lowSpot.target);

// A pulse channel the show system drives. Not a light -- exposure + bloom.
const giLights = [];

/* ------------------------------------------------------------------ */
/* world + table                                                       */
/* ------------------------------------------------------------------ */

const world = new World({ incline: L.incline, ballR: L.ballR, drainY: -0.02 });
world.bounds = { x0: -0.3, x1: 0.3, y0: -0.2, y1: 1.16 };

const dmd = new DMD(8);
const table = new Table(renderer, M, env, quality).build(world, dmd);
mark('table');
scene.add(table.group);

/* ---- static-geometry fold -------------------------------------------
 * The table is authored as ~430 separate meshes. Everything the game never
 * touches again -- posts, screws, rails, lane guides, brackets, plastics,
 * cabinet, legs -- collapses into one mesh per material here. The objects
 * `table` still holds a reference to (lamps, targets, flippers, bumpers,
 * ramps, the ball) are detected automatically and left alone.
 * -------------------------------------------------------------------- */
// Containers the game holds a handle to but never animates: their contents
// are ordinary static furniture and must be allowed into the merge.
const staticContainers = new Set(
  ['cabinet', 'backbox', 'apron', 'giWash'].map((k) => table.parts[k]).filter(Boolean)
);
const liveObjects = collectLive(table, {
  skip: new Set([table.group, table.playfieldGroup, ...staticContainers]),
});
const groupReport = coalesceGroups(table.group);
const mergeReport = mergeStatics(table.group, liveObjects);
mergeReport.groups = groupReport;
if (qs.get('opt')) {
  const owners = {};
  for (const o of liveObjects) {
    let n = 0;
    o.traverse((x) => { if (x.isMesh) n++; });
    if (n) owners[o.name || o.type + '#' + o.id] = n;
  }
  mergeReport.owners = owners;
}

/* ---- shadow casters -------------------------------------------------
 * 155 casters meant a second full-geometry pass over the whole machine every
 * frame. Only the objects a player can actually track need to drop a shadow:
 * the ball, the flippers, and the few tall things it passes under. The rest
 * is painted into the playfield art.
 * -------------------------------------------------------------------- */
let casters = 0;
table.group.traverse((o) => {
  if (o.isMesh) o.castShadow = false;
});
for (const p of [table.parts.flipL, table.parts.flipR, table.parts.flipU]) {
  if (!p || !p.g) continue;
  // bat + rubber only; the bushing, hub and acorn nut are 4mm details whose
  // shadows nobody will ever see and which each cost a full extra pass entry
  let n = 0;
  p.g.traverse((o) => {
    if (o.isMesh && n < 2) { o.castShadow = true; casters++; n++; }
  });
}

const vfx = new VFX(table.playfieldGroup, env);
const hud = new HUD(document.body);
const cam = new CameraRig(camera, table);
const audio = new Audio();
const sched = new Scheduler();

/* ---- hero ball ------------------------------------------------------
 * A live CubeCamera meant six extra full-scene renders every 0.28s -- ~25ms
 * of the frame, and the single biggest draw-call spike in the profile. A
 * baked studio probe reflects a bright rim and a hot key from every angle,
 * which is what actually makes a mirror ball read as fast-moving steel. The
 * live version reflected a dark room, i.e. almost nothing.
 * ------------------------------------------------------------------- */
const ballMat = M.chrome.clone();
const ballProbe = new THREE.CanvasTexture(makeBallProbe(Q.tier === 'low' ? 256 : 512));
ballProbe.mapping = THREE.EquirectangularReflectionMapping;
ballProbe.colorSpace = THREE.SRGBColorSpace;
ballMat.envMap = ballProbe;
ballMat.envMapIntensity = 2.6;
ballMat.color = new THREE.Color(0xf6f9ff);
ballMat.metalness = 1;
ballMat.roughness = 0.028;

/* ------------------------------------------------------------------ */

const POPV = new THREE.Vector3();

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
  /**
   * Throw a chunky score number up out of a playfield position. Projects the
   * table-space point through the live camera so the number lands exactly on
   * the thing that was hit, wherever the camera happens to be.
   */
  popScore(text, x, y, color, big = false) {
    POPV.set(x, 0.05, -y);
    table.playfieldGroup.localToWorld(POPV);
    POPV.project(camera);
    if (POPV.z > 1) return;
    hud.pop(
      text,
      Math.round((POPV.x * 0.5 + 0.5) * window.innerWidth),
      Math.round((-POPV.y * 0.5 + 0.5) * window.innerHeight),
      color,
      big
    );
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
  // The DMD hood and the bar sign are emissive cards now, not PointLights.
  table.parts.dmdLight.intensity = 0.7 * pulse + game.flashV * 2;
  table.parts.barLight.intensity = 0.6 * pulse;
  game.flashV = Math.max(0, game.flashV - dt * 2.4);

  if (!started && (clock > 0.7 || performance.now() - bootMs > 700 || window.__SHOT__)) {
    started = true;
    hud.hideStart();
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

// Don't run (or bank a physics backlog) while the tab is hidden.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) renderer.setAnimationLoop(null);
  else { last = performance.now(); acc = 0; renderer.setAnimationLoop(step); }
});

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
  ...census(scene),
  shadowCasters: casters,
  merged: mergeReport.merged,
  mergeReport,
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
