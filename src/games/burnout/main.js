// CRASHOUT -- a Burnout-style arcade crash racer.
// Entry point: renderer, lighting/IBL, game loop, cameras, collisions,
// takedowns, crash mode, scoring, and the screenshot-harness API.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Track } from './track.js';
import { World } from './world.js';
import { VFX } from './vfx.js';
import { Traffic } from './traffic.js';
import { Car } from './car.js';
import { RacerAI } from './ai.js';
import { Audio } from './audio.js';
import { HUD } from './hud.js';
import { PostFX } from './postfx.js';
import { resolveCarCollision } from './physics.js';
import { RNG, clamp } from './rng.js';
import * as TX from './textures.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _up = new THREE.Vector3();
const _v0 = new THREE.Vector3();
const _frame = {
  pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(),
  up: new THREE.Vector3(), curv: 0, bank: 0, kind: 'open',
};

// --------------------------------------------------------------- quality
const TAKEDOWN_CAM_LEN = 3.2;
const DT_FIXED = 1 / 120;
// 60 x 20ms = 1.2s of catch-up per rendered frame, which covers everything
// down to ~0.85fps. Going wider is counter-productive: the catch-up itself is
// main-thread work, so an unbounded budget turns one slow frame into a longer
// frame into a bigger budget, and the sim death-spirals. 20ms is a hard
// ceiling because raycast suspension is unstable above it.
const DT_MAX_STEPS = 60;
const DT_STEP_CAP = 0.02;
const DT_HITCH_CAP = 1.0;   // beyond this we assume a stall, not a slow frame

const EXPOSURE = 0.46;
const SKY_INTENSITY = 1.0;

const TIERS = {
  low: {
    tier: 'low', pixelRatio: 1.0, shadows: true, shadowMap: 1024, msaa: 0, smaa: false,
    bloomStrength: 0.62, bloomRadius: 0.34, bloomThreshold: 1.02, rain: 260,
    particleScale: 0.55, beams: false, aniso: 8, traffic: 12, rivals: 3, buildings: 0.5,
    envSize: 256, soft: true,
  },
  med: {
    tier: 'med', pixelRatio: 1.0, shadows: true, shadowMap: 1024, msaa: 0, smaa: true,
    bloomStrength: 0.66, bloomRadius: 0.36, bloomThreshold: 0.96, rain: 700,
    particleScale: 0.55, beams: true, aniso: 8, traffic: 20, rivals: 4, buildings: 0.75, envSize: 256,
  },
  high: {
    // 'high' is what detectTier() hands every integrated GPU, so it has to
    // reach first frame fast. It keeps the look of ultra and drops the costs
    // that only show up in a pixel peep: shadow resolution and rain density.
    tier: 'high', pixelRatio: 1.0, shadows: true, shadowMap: 1024, msaa: 0, smaa: true,
    bloomStrength: 0.70, bloomRadius: 0.38, bloomThreshold: 0.90, rain: 820,
    particleScale: 0.80, beams: true, aniso: 8, traffic: 22, rivals: 5, buildings: 0.85, envSize: 256,
  },
  ultra: {
    tier: 'ultra', pixelRatio: Math.min(window.devicePixelRatio || 1, 2), shadows: true,
    shadowMap: 2048, msaa: 4, smaa: true, bloomStrength: 0.74, bloomRadius: 0.40,
    bloomThreshold: 0.86, rain: 2400, particleScale: 1.0, beams: true, aniso: 16,
    traffic: 30, rivals: 5, buildings: 1, envSize: 512,
  },
};

function detectTier() {
  const params = new URLSearchParams(location.search);
  const forced = params.get('q');
  if (forced && TIERS[forced]) return forced;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'low';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const r = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|software|basic render|mesa offscreen/i.test(r)) return 'low';
    if (/intel/i.test(r) && !/arc/i.test(r)) return 'high';
    return 'ultra';
  } catch (e) {
    return 'med';
  }
}

const RIVAL_DEFS = [
  { name: 'VIPER', color: 0x00a6ff, style: 'super' },
  { name: 'HAVOC', color: 0x00f07a, style: 'muscle' },
  { name: 'ONYX', color: 0xffd400, style: 'sport' },
  { name: 'RAZOR', color: 0xff6a00, style: 'super' },
  { name: 'BRUTE', color: 0xc026ff, style: 'muscle' },
];

class Game {
  constructor(root) {
    this.root = root;
    this.params = new URLSearchParams(location.search);
    this.seedValue = parseInt(this.params.get('seed') || '20260728', 10);
    this.rng = new RNG(this.seedValue);
    this.quality = { ...TIERS[detectTier()] };
    this.time = 0;
    this.realTime = 0;
    this.timeScale = 1;
    this.targetTimeScale = 1;
    this.slowmoT = 0;
    this.hitStopT = 0;
    this.paused = false;
    // Latches true the first time the player steers; retires the autopilot.
    this.userDriving = false;
    // Latched separately: steering must not retire the throttle assist.
    this.userThrottling = false;
    this.stuckT = 0;
    this.unsticking = false;
    this.unstickT = 0;
    this.frames = 0;
    // Frame timing is measured from UNCLAMPED wall-clock deltas so the reported
    // numbers can never be flattered by the simulation's step clamp.
    this.fps = 0;
    this.realFps = 0;
    this.fpsAccum = 0;
    this.fpsFrames = 0;
    this.frameMs = new Float32Array(180);
    this.frameMsN = 0;
    this.frameMsCount = 0;
    this.simAccum = 0;
    this.cineHold = false;
    this.cineFrozen = false;
    this._cineSettle = 0;
    this.cineFreezeAt = 0;
    this.cineHoldT = 1.4;
    this._camBeat = -1;
    this._camCut = false;
    this.shockT = 0;
    this.pendingBlasts = [];
    this.shockPos = new THREE.Vector3();
    this.wetness = 1.0;
    this.shake = 0;
    this.shakeDecay = 3.2;
    this.cameraMode = this.params.get('cam') || 'chase';
    this.score = 0;
    this.takedowns = 0;
    this.nearMisses = 0;
    this.boost = 0.62;
    this.boosting = false;
    this.forceBoost = 0;
    this.chain = 0;
    this.chainTimer = 0;
    this.crashMode = false;
    this.pileWide = false;
    this.cineLockCam = false;
    this.crashMeter = 0;
    this.crashScore = 0;
    this.crashStart = 0;
    this.takedownCamT = 0;
    this.simDt = 0;
    this.timers = [];
    this.takedownTarget = null;
    this.lap = 1;
    this.laps = 3;
    this.raceTime = 0;
    this.position = 1;
    this.playerControlled = false;
    this.idleTimer = 0;
    this.muted = false;

    this.initRenderer();
    const _t = () => performance.now();
    const t0 = _t();
    this.initScene();
    const t1 = _t();
    this.initGameObjects();
    const t2 = _t();
    this.initInput();
    this.initAPI();
    window.__BOOT__ = { scene: (t1 - t0) | 0, objects: (t2 - t1) | 0, total: (_t() - t0) | 0 };
  }

  // ------------------------------------------------------------- renderer
  initRenderer() {
    const q = this.quality;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(q.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Tone mapping is done once, in the post composite. Leaving ACES on the
    // renderer put `toneMapping` into every material's program cache key, so
    // each `toneMapped:false` material compiled a second copy of its shader.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = q.shadows;
    // NOT PCFSoftShadowMap: three deprecated it and WebGLShadowMap.render()
    // silently rewrites the type on the first shadow pass -- which happens
    // AFTER renderer.compile(), invalidating every program we just built and
    // forcing a full recompile storm on frame 1.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.renderer.domElement.style.display = 'block';
    this.root.appendChild(this.renderer.domElement);
    TX.setAnisotropy(Math.min(q.aniso, this.renderer.capabilities.getMaxAnisotropy()));
  }

  initScene() {
    const q = this.quality;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.28, 3600);
    this.camera.position.set(0, 6, -14);

    // ---- sky (baked to a cube so its HDR range is under our control)
    const sky = new Sky();
    sky.scale.setScalar(4000);
    const su = sky.material.uniforms;
    su.turbidity.value = 3.6;
    su.rayleigh.value = 2.05;
    su.mieCoefficient.value = 0.0016;
    su.mieDirectionalG.value = 0.72;
    // the addon's sun disc is 19000x -- it destroys the bloom pass. The sun is
    // represented by the directional light + a lens glow instead.
    if (su.showSunDisc) su.showSunDisc.value = 0;
    if (su.cloudCoverage) su.cloudCoverage.value = 0.0;
    if (su.cloudDensity) su.cloudDensity.value = 0.9;
    if (su.cloudElevation) su.cloudElevation.value = 0.55;
    if (su.cloudScale) su.cloudScale.value = 1.0;
    if (su.cloudSpeed) su.cloudSpeed.value = 0.0;
    const elevation = 34.0, azimuth = 296;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    su.sunPosition.value.copy(this.sunDir);
    this.sky = sky;

    const skyScene = new THREE.Scene();
    skyScene.add(sky);

    // ---- cloud dome, baked into the same cube so it lights the world too
    const cloudTex = TX.makeCloudSheet({
      w: q.tier === 'low' ? 512 : 1024, h: q.tier === 'low' ? 256 : 512,
      cover: 0.44, sunU: (azimuth / 360 + 0.25) % 1,
      lit: [1.12, 0.94, 0.80], dark: [0.30, 0.34, 0.46],
    });
    const domeGeo = new THREE.SphereGeometry(8, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.52);
    const domeMat = new THREE.MeshBasicMaterial({
      map: cloudTex, transparent: true, depthWrite: false, side: THREE.BackSide,
      fog: false, toneMapped: false, opacity: 1.0,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    // second, slower layer for parallax depth
    const dome2 = new THREE.Mesh(
      new THREE.SphereGeometry(7.2, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.46),
      new THREE.MeshBasicMaterial({
        map: TX.makeCloudSheet({
          w: q.tier === 'low' ? 512 : 1024, h: q.tier === 'low' ? 256 : 512,
          cover: 0.30, sunU: (azimuth / 360 + 0.25) % 1,
          lit: [1.25, 1.02, 0.84], dark: [0.42, 0.44, 0.55],
        }),
        transparent: true, depthWrite: false, side: THREE.BackSide,
        fog: false, toneMapped: false, opacity: 0.75,
      })
    );
    dome2.rotation.y = 1.9;
    skyScene.add(dome, dome2);

    const cubeRT = new THREE.WebGLCubeRenderTarget(q.envSize, { type: THREE.HalfFloatType });
    const cubeCam = new THREE.CubeCamera(0.5, 20, cubeRT);
    cubeCam.update(this.renderer, skyScene);
    this.skyCube = cubeRT;
    this.scene.background = cubeRT.texture;
    this.scene.backgroundIntensity = SKY_INTENSITY * 1.05;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envRT = pmrem.fromCubemap(cubeRT.texture);
    this.envMap = envRT.texture;
    this.scene.environment = this.envMap;
    if ('environmentIntensity' in this.scene) this.scene.environmentIntensity = SKY_INTENSITY * 0.42;
    pmrem.dispose();
    // The sky dome only exists to bake the cube map. Releasing it now frees
    // its shader programs -- they would otherwise sit in the cache forever.
    skyScene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    skyScene.clear();

    // ---- fog
    this.scene.fog = new THREE.FogExp2(new THREE.Color(0x7d90a8), 0.00034);
    this.fogBase = 0.00034;

    // ---- lights
    this.sun = new THREE.DirectionalLight(0xffeeda, 8.2);
    this.sun.position.copy(this.sunDir).multiplyScalar(220);
    this.sun.castShadow = q.shadows;
    if (q.shadows) {
      const s = this.sun.shadow;
      s.mapSize.set(q.shadowMap, q.shadowMap);
      s.camera.near = 1;
      s.camera.far = 400;
      s.camera.left = -34; s.camera.right = 34;
      s.camera.top = 34; s.camera.bottom = -34;
      s.bias = -0.0006;
      s.normalBias = 0.05;
      // three.js never refreshes an orthographic shadow frustum on its own, so
      // without this the light keeps the default 10x10 m box and nothing on the
      // road ever ends up inside the shadow map.
      s.camera.updateProjectionMatrix();
    }
    this.scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x9dbbe4, 0x33302c, 0.55);
    this.scene.add(this.hemi);
    // NOTE: there is deliberately no fill light. An unshadowed second
    // directional is the fastest way to erase a cast shadow; the sun plus a
    // low-intensity PMREM does all the ambient work.

    // hero rim light: a local point light that rides above the player so the
    // car paint always reads, without lifting the whole scene
    this.heroLight = new THREE.PointLight(0xffe7cc, 4.0, 16, 2.0);
    this.scene.add(this.heroLight);
    // cinematic rim used only by the crash camera. Kept permanently in the
    // scene at zero intensity: toggling `visible` on a light changes the
    // scene's light counts, and three.js then recompiles every material in the
    // scene. That was multiplying the shader program count several times over.
    this.rimLight = new THREE.PointLight(0x9ec8ff, 0, 30, 2.0);
    this.rimLight.visible = true;
    this.scene.add(this.rimLight);

    // Fixed pool of wreck-fire lights. Same reason: a light added on demand
    // during a crash forces a full recompile at the worst possible moment.
    this.wreckLights = [];
    for (let i = 0; i < 2; i++) {
      const wl = new THREE.PointLight(0xff8a34, 0, 26, 2);
      wl.visible = true;
      this.scene.add(wl);
      this.wreckLights.push({ light: wl, owner: null, age: 1e9 });
    }
  }

  initGameObjects() {
    const q = this.quality;
    this.track = new Track(this.seedValue);
    this.world = new World(this.scene, this.track, { quality: q, rng: new RNG(this.seedValue ^ 0x9e37), renderer: this.renderer });
    if (this.world.setEnvironment) this.world.setEnvironment(this.envMap);
    this.vfx = new VFX(this.scene, q);
    if (this.vfx.setEnvironment) this.vfx.setEnvironment(this.envMap);
    this.audio = new Audio();
    this.hud = new HUD(this.root);
    this.hud.setTrack(this.track);

    this.traffic = new Traffic(this, q.traffic);
    this.traffic.setEnvironment(this.envMap);

    this.player = new Car(this, {
      isPlayer: true, style: 'super', color: 0xff1330, name: 'YOU',
    });
    this.player.id = 'P';
    this.player.setEnvironment(this.envMap);
    this.cars = [this.player];
    this.ais = [];
    this.attractAI = new RacerAI(this.player, this, { aggression: 0.34, skill: 0.99 });
    this.attractAI.minU = -7.0; this.attractAI.maxU = 7.0; this.attractAI.baseLane = 2.2;

    for (let i = 0; i < q.rivals; i++) {
      const d = RIVAL_DEFS[i % RIVAL_DEFS.length];
      const c = new Car(this, { style: d.style, color: d.color, name: d.name });
      c.id = 'R' + i;
      c.setEnvironment(this.envMap);
      this.cars.push(c);
      const ai = new RacerAI(c, this, { aggression: 0.45 + i * 0.11, skill: 0.86 + i * 0.022 });
      ai.baseLane = ((i % 3) - 1) * 4.2 + 3;
      c.ai = ai;
      this.ais.push(ai);
    }

    this.resetRace();
    this.post = new PostFX(this.renderer, this.scene, this.camera, q);

    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.camYaw = 0;
    this.camFov = 62;
    this.orbitAngle = 0;
    this.crashCamAngle = 0;
    this.crashCamSide = 1;
    this.shakeOffset = new THREE.Vector3();

    // seat the camera immediately so the first frame is composed
    this.camPos.copy(this.player.veh.body.pos).addScaledVector(this.player.veh.forward, -8).add(new THREE.Vector3(0, 2.6, 0));
    this.camLook.copy(this.player.veh.body.pos).addScaledVector(this.player.veh.forward, 12);
  }

  resetRace() {
    const t = this.track;
    const startS = 120;
    this.player.veh.reset(startS, 3.0, t);
    const f = t.frameAt(startS, _frame);
    this.player.veh.body.vel.copy(f.tan).multiplyScalar(56);
    this.player.veh.speed = 56;
    this.player.repair();
    this.player.prevS = startS;
    this.player.totalS = startS;
    for (let i = 1; i < this.cars.length; i++) {
      const c = this.cars[i];
      const s = t.wrapS(startS + 26 + i * 34);
      const u = ((i % 3) - 1) * 4.4 + 1;
      c.veh.reset(s, u, t);
      const ff = t.frameAt(s, _frame);
      c.veh.body.vel.copy(ff.tan).multiplyScalar(56 + i);
      c.veh.speed = 56;
      c.repair();
      c.prevS = s;
      c.totalS = s + 26 + i * 34;
    }
    if (this.traffic) this.traffic.reset(startS);
  }

  // ---------------------------------------------------------------- input
  initInput() {
    this.keys = Object.create(null);
    const down = (e) => {
      this.keys[e.code] = true;
      this.onUserInput();
      if (!e.repeat) {
        if (e.code === 'KeyC') this.cycleCamera();
        if (e.code === 'KeyR') this.respawnPlayer();
        if (e.code === 'KeyM') { this.muted = !this.muted; this.audio.setMuted(this.muted); }
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    };
    const up = (e) => { this.keys[e.code] = false; };
    window.addEventListener('keydown', down, { passive: false });
    window.addEventListener('keyup', up);
    window.addEventListener('pointerdown', () => { this.audio.resume(); this.hud.hideTitle(); });
    window.addEventListener('resize', () => this.onResize());
  }

  onUserInput() {
    this.hud.hideTitle();
    this.playerControlled = true;
    this.idleTimer = 0;
    this.audio.resume();
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
  }

  cycleCamera() {
    const order = ['chase', 'hood', 'cinematic', 'orbit'];
    const i = order.indexOf(this.cameraMode);
    this.setCamera(order[(i + 1) % order.length]);
  }

  setCamera(name) { this.cameraMode = name; }

  // ----------------------------------------------------------------- API
  initAPI() {
    window.__STATS__ = () => {
      const pct = (f) => {
        const n = this.frameMsCount;
        if (!n) return 0;
        const a = Array.prototype.slice.call(this.frameMs, 0, n).sort((x, y) => x - y);
        return Math.round(a[Math.min(n - 1, Math.floor(n * f))] * 100) / 100;
      };
      return {
        fps: Math.round(this.realFps * 10) / 10,
        realFps: Math.round(this.realFps * 100) / 100,
        frameMsP50: pct(0.50),
        frameMsP95: pct(0.95),
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        quality: this.quality.tier,
        trackS: Math.round(this.player.veh.trackS * 100) / 100,
        simSteps: this.frames,
      };
    };
    window.__GAME__ = {
      setCamera: (n) => this.setCamera(n),
      pause: () => { this.paused = true; },
      resume: () => { this.paused = false; },
      seed: (n) => this.reseed(n),
      forceEvent: (n) => this.forceEvent(n),
      setQuality: (t) => this.setQuality(t),
      state: () => ({
        speed: this.player.veh.speed, score: this.score, takedowns: this.takedowns,
        boost: this.boost, crashMode: this.crashMode, health: this.player.health,
      }),
    };
  }

  reseed(n) {
    this.seedValue = n >>> 0;
    this.rng.reseed(this.seedValue);
    this.score = 0;
    this.takedowns = 0;
    this.raceTime = 0;
    this.resetRace();
  }

  setQuality(t) {
    if (!TIERS[t] || t === this.quality.tier) return;
    // Applied live rather than by reloading: the screenshot harness holds a
    // reference to window.__GAME__, and a navigation would destroy it.
    // Construction-time budgets (traffic count, scatter density, MSAA samples)
    // keep their original values; everything adjustable is re-applied here.
    const next = TIERS[t];
    Object.assign(this.quality, next);
    this.renderer.setPixelRatio(Math.min(next.pixelRatio, 2));
    this.onResize();
    this.post.bloom.radius = next.bloomRadius;
    this.post.bloom.threshold = next.bloomThreshold;
    for (const c of this.cars) {
      c.beamsAllowed = c.isPlayer || next.beams;
    }
    if (this.world.rain) this.world.rain.visible = next.rain > 0;
  }

  forceEvent(name) {
    const p = this.player;
    const t = this.track;
    switch (name) {
      case 'boost':
        this.boost = 1;
        this.forceBoost = this.cineHold ? 40 : 6;
        this.playerControlled = false;
        this.audio.boostHit();
        // Park the capture 2.4 simulated seconds in: long enough for the flame,
        // streak field and FOV punch to be fully on, short enough that the
        // attract driver cannot have found a barrier yet.
        if (this.cineHold) this.cineFreezeAt = this.time + 2.4;
        break;
      case 'nearmiss': {
        const it = this.traffic.items.find((x) => x.active && x.mode === 'cruise');
        if (it) {
          it.s = t.wrapS(p.veh.trackS + 14);
          it.u = p.veh.trackU + 2.8;
          this.traffic.placeCruise(it);
        }
        this.registerNearMiss(1.2);
        if (this.cineHold) this.cineFreezeAt = this.time + 0.9;
        break;
      }
      case 'takedown': {
        const rival = this.cars.find((c) => c !== p && !c.wrecked) || this.cars[1];
        if (!rival) break;
        const s = t.wrapS(p.veh.trackS + 8);
        rival.veh.reset(s, clamp(p.veh.trackU + 3.4, -9, 9), t);
        const f = t.frameAt(s, _frame);
        rival.veh.body.vel.copy(f.tan).multiplyScalar(52);
        rival.lastHitBy = p;
        rival.lastHitTime = this.time;
        rival.applyImpact(rival.veh.body.pos.clone().addScaledVector(f.right, -0.9), f.right.clone(), 1.0, 42, 'car');
        rival.veh.body.applyImpulse(
          _v1.copy(f.right).multiplyScalar(rival.veh.body.mass * 19),
          _v2.copy(rival.veh.body.pos).addScaledVector(f.tan, 1.3)
        );
        rival.veh.body.ang.add(_v1.set(f.tan.x * 3, 5.0, f.tan.z * 3));
        // Buckle the shell from three angles first so the replay frames an
        // actually-crumpled car rather than a pristine one that is merely spinning.
        for (let k = 0; k < 3; k++) {
          _v2.copy(rival.veh.body.pos);
          _v2.y += 0.45 + k * 0.22;
          _v2.addScaledVector(f.tan, 1.5 - k * 1.4).addScaledVector(f.right, this.rng.range(-0.7, 0.7));
          _n1.copy(f.tan).multiplyScalar(-1).addScaledVector(f.right, this.rng.range(-0.6, 0.6));
          _n1.y -= 0.25; _n1.normalize();
          rival.applyImpact(_v2, _n1, 0.95, 44, 'car');
        }
        rival.wreck(f.right.clone(), 1);
        this.vfx.explosion(rival.veh.body.pos, rival.veh.body.vel, 1.0, [0.9, 0.5, 0.2]);
        break;
      }
      case 'crash': {
        const dir = p.veh.forward.clone();
        p.applyImpact(p.veh.body.pos.clone().addScaledVector(dir, 1.7), dir, 1.0, 46, 'wall');
        p.veh.body.ang.add(_v1.set(1.5, 4.2, 3.0));
        p.veh.body.vel.multiplyScalar(0.55).add(_v1.set(0, 7, 0));
        p.wreck(dir, 1);
        break;
      }
      case 'pileup': {
        const near = this.traffic.items.filter((x) => x.active).slice(0, 7);
        near.forEach((it, i) => {
          it.s = t.wrapS(p.veh.trackS + 5 + i * 4.2);
          it.u = ((i % 3) - 1) * 4.4;
          this.traffic.placeCruise(it);
          this.traffic.activatePhysics(it);
          it.body.vel.set((this.rng.range(-1, 1)) * 20, 8 + this.rng.range(0, 9), (this.rng.range(-1, 1)) * 20);
          it.body.ang.set(this.rng.range(-8, 8), this.rng.range(-8, 8), this.rng.range(-8, 8));
          it.wrecked = true;
          // hammer it from a couple of angles so the deformer actually buckles
          _v2.copy(it.body.pos); _v2.y += 0.7;
          _v2.x += this.rng.range(-1, 1); _v2.z += this.rng.range(-1, 1);
          _n1.set(this.rng.range(-1, 1), this.rng.range(-0.4, 0.2), this.rng.range(-1, 1)).normalize();
          this.traffic.applyDamage(it, _v2, _n1, 0.85);
          _n1.set(this.rng.range(-1, 1), this.rng.range(-0.3, 0.5), this.rng.range(-1, 1)).normalize();
          this.traffic.applyDamage(it, _v2, _n1, 0.7);
          this.vfx.explosion(it.body.pos, it.body.vel, 0.9, [it.color.r, it.color.g, it.color.b]);
        });
        // Burnout's crash mode is YOUR car in the pile -- without wrecking the
        // player the camera frames a driver calmly leaving the accident he
        // caused, which is neither the mechanic nor a usable screenshot.
        {
          const dir = p.veh.forward.clone();
          p.applyImpact(p.veh.body.pos.clone().addScaledVector(dir, 1.7), dir, 1.0, 44, 'car');
          p.veh.body.ang.add(_v1.set(2.2, 3.4, 5.2));
          p.veh.body.vel.multiplyScalar(0.42).add(_v1.set(0, 5.5, 0));
          p.wreck(dir, 1);
          this.vfx.explosion(p.veh.body.pos, p.veh.body.vel, 1.0, [0.9, 0.45, 0.18]);
        }
        this.audio.explosion();
        this.enterCrashMode(true);
        if (this.cineHold) this.cineFreezeAt = this.time + 1.5;
        break;
      }
      default: break;
    }
  }

  // -------------------------------------------------------------- effects
  impactShake(a) {
    this.shake = Math.min(1.6, this.shake + a * 1.5);
    this.hud.impactFlash(clamp(a * 0.7, 0, 0.55));
    if (this.post) this.post.u.uFlash.value = clamp(this.post.u.uFlash.value + a * 0.5, 0, 0.45);
  }

  hitStop(d) { this.hitStopT = Math.max(this.hitStopT, d); }

  /**
   * Hand a wrecked car one of the fixed pool of fire lights. Freshest wreck
   * wins; everything else burns unlit rather than growing the scene's light
   * count (which would recompile every material in the game).
   */
  claimWreckLight(car, age) {
    const pool = this.wreckLights;
    if (!pool) return null;
    let free = null;
    for (const slot of pool) {
      if (slot.owner === car) { slot.age = age; return slot.light; }
      if (!slot.owner) free = free || slot;
    }
    if (free) { free.owner = car; free.age = age; return free.light; }
    // steal the stalest slot if this wreck is newer
    let worst = pool[0];
    for (const slot of pool) if (slot.age > worst.age) worst = slot;
    if (age < worst.age - 0.5) { worst.owner = car; worst.age = age; return worst.light; }
    return null;
  }

  releaseWreckLight(car) {
    if (!this.wreckLights) return;
    for (const slot of this.wreckLights) {
      if (slot.owner === car) { slot.owner = null; slot.age = 1e9; slot.light.intensity = 0; }
    }
  }

  // Screen-space impact shockwave (see postfx GradeShader uShock).
  shockAt(p, strength = 0.6) {
    if (this.shockT > 0.28) return;
    this.shockPos.copy(p);
    this.shockT = 0.42 * clamp(strength, 0.2, 1.2);
    this.shockLife = this.shockT;
  }

  // ------------------------------------------------------- game mechanics
  onCarWrecked(car) {
    if (car === this.player) { this.enterCrashMode(false); return; }
    const byPlayer = car.lastHitBy === this.player && (this.time - car.lastHitTime) < 3.4;
    if (byPlayer) this.registerTakedown(car);
    else this.addScore(300);
  }

  registerTakedown(car) {
    this.takedowns++;
    this.chain++;
    this.chainTimer = 5.0;
    const pts = 5000 * Math.max(1, this.chain);
    this.addScore(pts);
    this.boost = 1;
    this.audio.takedownSting();

    // ---- the payoff. A takedown is the whole point of the game, so it gets a
    // second, much bigger detonation on top of the wreck's own explosion, a
    // smoke column you can see from the next corner and a full-screen flash.
    const wp = car.veh.body.pos, wv = car.veh.body.vel;
    const pc = car.paint.color;
    this.vfx.explosion(wp, wv, 2.1, [pc.r, pc.g, pc.b]);
    this.vfx.smokeColumn(wp, 44, 12);
    this.vfx.fireBurst(wp, 46, 2.2);
    this.vfx.flashAt(wp, 7.0, 0.26, [3.4, 2.2, 0.9]);
    this.vfx.sparkBurst(wp, 260, null, 1.6, 30, [1.0, 0.86, 0.45]);
    this.shockAt(wp, 1.2);
    if (this.post) {
      this.post.u.uFlash.value = 0.85;
      this.post.u.uFlashCol.value.setRGB(1.0, 0.90, 0.62);
    }
    // A delayed secondary keeps the slow-mo replay alive instead of peaking on
    // frame one and then showing a static wreck for two seconds.
    this.pendingBlasts.push({ t: 0.30, p: wp.clone(), c: [pc.r, pc.g, pc.b] });
    this.pendingBlasts.push({ t: 0.68, p: wp.clone(), c: [pc.r, pc.g, pc.b] });

    this.hud.scorePop(`+${pts.toLocaleString()}`, '#ffdf4a', true);
    if (this.cineLockCam) return;   // a boost/near-miss capture keeps its camera
    this.hud.callout('TAKEDOWN!', `${car.name} wrecked  ·  +${pts.toLocaleString()}`, '#ffd23f');
    if (this.chain > 1) this.hud.showChain(`${this.chain}x TAKEDOWN CHAIN`);
    // Hard, but short. A 0.14x scale held for ~3s of wall time advances barely
    // 0.4s of game time -- the replay stops being a replay and becomes a pause,
    // and the player is dumped back out having lost all their speed.
    this.slowmo(0.17, 1.7);
    this.takedownCamT = TAKEDOWN_CAM_LEN;
    this._camBeat = -1;
    this.takedownTarget = car;
    this.prevCam = this.cameraMode === 'crashcam' ? 'chase' : this.cameraMode;
    this.cameraMode = 'crashcam';
    this.crashCamAngle = this.rng.range(0, Math.PI * 2);
    this.impactShake(1.5);
    this.hitStop(0.17);
    // Ramming a rival hard bleeds the hero's speed; it also keeps both cars
    // inside the replay framing instead of the hero rocketing out of shot.
    this.player.veh.body.vel.multiplyScalar(0.62);
  }

  registerNearMiss(strength) {
    this.nearMisses++;
    this.boost = clamp(this.boost + 0.06 * strength, 0, 1);
    const pts = Math.floor(120 * strength);
    this.addScore(pts);
    this.audio.whoosh(clamp(strength, 0.4, 1.4));
    // Near misses are frequent, so they get a flying score chip rather than the
    // full-screen slam -- that stays reserved for takedowns, which keeps the
    // big typography meaningful instead of wallpaper.
    this.hud.scorePop(`+${pts}`, '#7fe9ff');
    if (this.nearMissCallT === undefined || this.time - this.nearMissCallT > 2.4) {
      this.nearMissCallT = this.time;
      this.hud.showChain('NEAR MISS');
    }
    this.slowmo(0.68, 0.16);
  }

  addScore(n) { this.score += n; if (this.crashMode) this.crashScore += n; }

  /**
   * Wall-clock scheduler drained inside the render loop. setTimeout is not
   * usable here: under software GL a single frame can block the main thread for
   * 15+ seconds, so timers either fire far too late or all bunch up together
   * the instant the thread yields.
   */
  after(sec, fn) { this.timers.push({ t: sec, fn }); }

  drainTimers(dt) {
    if (!this.timers.length) return;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t > 0) continue;
      this.timers.splice(i, 1);
      try { tm.fn(); } catch (e) { console.error('[crashout] timer', e); }
    }
  }

  // Last-resort safety net, run from the render loop on WALL time so neither
  // slow-mo nor any early-return in the input path can defeat it. A racing game
  // that leaves a 10-year-old parked and motionless has simply stopped being a
  // game, so after two seconds of genuine standstill the car is put back on the
  // racing line at speed. In normal play this never fires.
  stuckWatchdog(dtWall) {
    const p = this.player;
    if (!p || p.wrecked || this.crashMode || !this.playerControlled || this.paused || this.time < 4) {
      this.stuckT = 0; this.unsticking = false; this.unstickT = 0;
      return;
    }
    const veh = p.veh;
    const braking = this.keys.ArrowDown || this.keys.KeyS;

    if (!braking && veh.speed < 7.0) this.stuckT += dtWall; else this.stuckT = 0;
    if (this.stuckT > 0.18) this.unsticking = true;
    if (this.unsticking && veh.speed > 22) { this.unsticking = false; this.unstickT = 0; }
    if (!this.unsticking) return;

    this.unstickT += dtWall;
    const f = this.track.frameAt(veh.trackS, _frame);
    const b = veh.body;

    // Escalation: half a second of hard assist without result means the car is
    // geometrically wedged and no amount of force will free it, so put it back
    // on the racing line at speed. Every arcade racer has this recovery; the
    // alternative is a player staring at a stationary car.
    if (this.unstickT > 0.5) {
      const s2 = this.track.wrapS(veh.trackS + 8);
      const fr = this.track.frameAt(s2, _frame);
      veh.reset(s2, 0, this.track);
      b.vel.copy(fr.tan).multiplyScalar(28);
      this.unsticking = false; this.unstickT = 0; this.stuckT = 0;
      this.hud.showChain('RECOVERED');
      return;
    }

    // Hard guarantee rather than a nudge: drive the along-track component up to
    // a rolling speed and walk the car back toward the carriageway. A wedged car
    // has no traction to convert a gentle push into motion, so a soft assist
    // just leaves it grinding at walking pace forever.
    const inward = -Math.sign(veh.trackU || 1);
    // Set, don't accumulate: a genuinely wedged car has the solver delete any
    // velocity we add within the same frame, so an incremental ramp never wins.
    const tanV = b.vel.dot(f.tan);
    if (tanV < 22) { b.vel.addScaledVector(f.tan, 22 - tanV); }
    b.vel.addScaledVector(f.right, inward * dtWall * 26);
    b.pos.addScaledVector(f.right, inward * dtWall * 5.5);
    const fw = veh.forward;
    b.ang.y += Math.atan2(fw.x * f.tan.z - fw.z * f.tan.x,
                          fw.x * f.tan.x + fw.z * f.tan.z) * dtWall * 16;
  }

  slowmo(scale, duration) {
    this.targetTimeScale = scale;
    this.slowmoT = duration;
    this.audio.setSlowmo(1 - scale);
  }

  enterCrashMode(fake = false) {
    if (this.crashMode || this.cineLockCam) return;
    this.crashMode = true;
    this.pileWide = fake;
    this.crashStart = this.time;
    this.crashStartWall = this.realTime;
    this.crashMeter = 0;
    this.crashScore = 0;
    this.targetTimeScale = 0.17;
    this.slowmoT = 4.6;
    if (this.cameraMode !== 'crashcam') this.prevCam = this.cameraMode;
    this.cameraMode = 'crashcam';
    this.takedownTarget = null;
    this.takedownCamT = 0;
    this.crashCamAngle = this.rng.range(0, Math.PI * 2);
    this._camBeat = -1;
    this.audio.setSlowmo(1);
    this.hud.callout(fake ? 'PILE UP' : 'CRASHED', 'AFTERTOUCH — STEER INTO TRAFFIC', '#ff5a3c');
    this.impactShake(1.2);
  }

  exitCrashMode() {
    if (!this.crashMode) return;
    this.crashMode = false;
    this.pileWide = false;
    this.targetTimeScale = 1;
    this.slowmoT = 0;
    this.audio.setSlowmo(0);
    this.cameraMode = this.prevCam && this.prevCam !== 'crashcam' ? this.prevCam : 'chase';
    this.respawnPlayer();
  }

  respawnPlayer() {
    const p = this.player;
    const t = this.track;
    const s = t.wrapS(p.veh.trackS + 30);
    p.veh.reset(s, clamp(p.veh.trackU, -8, 8), t);
    const f = t.frameAt(s, _frame);
    p.veh.body.vel.copy(f.tan).multiplyScalar(38);
    p.repair();
    this.boost = Math.max(this.boost, 0.4);
    this.chain = 0;
  }

  // ------------------------------------------------------------ collisions
  handleCollisions() {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        if (a.veh.body.pos.distanceToSquared(b.veh.body.pos) > 100) continue;
        const hit = resolveCarCollision(a.veh, b.veh, 0.22);
        if (!hit) continue;
        const e = clamp(hit.speed / 24, 0, 1);
        if (e < 0.035) continue;
        a.applyImpact(hit.point, hit.normal.clone(), e * 0.8, hit.speed, 'car');
        b.applyImpact(hit.point, hit.normal.clone().negate(), e * 0.9, hit.speed, 'car');
        if (a === this.player) { b.lastHitBy = a; b.lastHitTime = this.time; this.onPlayerRam(e); }
        else if (b === this.player) { a.lastHitBy = b; a.lastHitTime = this.time; this.onPlayerRam(e); }
      }
    }

    for (const car of cars) {
      for (const it of this.traffic.items) {
        if (!it.active) continue;
        const rad = 5.5 + it.cfg.size[2] * 0.5;
        if (car.veh.body.pos.distanceToSquared(it.body.pos) > rad * rad) continue;
        const wasCruise = it.mode === 'cruise';
        const hit = resolveCarCollision(car.veh, it, wasCruise ? 0.15 : 0.18);
        if (!hit) continue;
        const e = clamp(hit.speed / 26, 0, 1);
        if (wasCruise) this.traffic.activatePhysics(it);
        else if (e < 0.05) continue;
        it.lastHitBy = car;
        this.traffic.hit(it, hit.point, hit.normal, e, car);
        car.applyImpact(hit.point, hit.normal.clone(), e * (wasCruise ? 0.62 : 0.45), hit.speed, 'traffic');
        if (car === this.player) {
          const pts = Math.floor((wasCruise ? 220 : 60) + e * 900);
          this.addScore(pts);
          this.boost = clamp(this.boost + 0.05, 0, 1);
          if (wasCruise && e > 0.5) this.hud.callout('SMASH', `+${pts}`, '#ff9d3c');
          if (this.crashMode) this.crashMeter = clamp(this.crashMeter + 0.14 + e * 0.28, 0, 1);
        }
      }
    }

    const items = this.traffic.items;
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      if (!a.active || a.mode !== 'physics') continue;
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (!b.active) continue;
        const rad = (a.cfg.size[2] + b.cfg.size[2]) * 0.55;
        if (a.body.pos.distanceToSquared(b.body.pos) > rad * rad) continue;
        const hit = resolveCarCollision(a, b, 0.2);
        if (!hit) continue;
        const e = clamp(hit.speed / 26, 0, 1);
        if (e < 0.09) continue;
        this.traffic.activatePhysics(b);
        this.traffic.hit(b, hit.point, hit.normal, e * 0.7, a.lastHitBy);
        if (this.crashMode && a.lastHitBy === this.player) {
          this.crashMeter = clamp(this.crashMeter + 0.11, 0, 1);
          this.addScore(900);
        }
      }
    }
  }

  onPlayerRam(e) {
    if (e > 0.16) {
      this.addScore(Math.floor(1400 * e));
      this.boost = clamp(this.boost + 0.05 + e * 0.1, 0, 1);
      this.impactShake(e * 0.5);
    }
  }

  checkNearMisses() {
    const p = this.player;
    if (p.wrecked || p.veh.speed < 24) return;
    for (const it of this.traffic.items) {
      if (!it.active || it.mode !== 'cruise') continue;
      const d = p.veh.body.pos.distanceTo(it.body.pos);
      const near = 4.4 + it.cfg.size[0] * 0.5;
      if (d < near && !it._nm) {
        it._nm = true;
        const rel = _v1.subVectors(p.veh.body.vel, it.body.vel).length();
        this.registerNearMiss(clamp(rel / 60, 0.4, 1.6) * (it.dir < 0 ? 1.4 : 1));
      } else if (d > near * 2.2) it._nm = false;
    }
  }

  updateRacePositions() {
    const t = this.track;
    for (const c of this.cars) {
      const s = c.veh.trackS;
      let d = t.deltaS(s, c.prevS);
      if (Math.abs(d) > t.length * 0.4) d = 0;
      c.totalS += d;
      c.prevS = s;
    }
    const sorted = this.cars.slice().sort((a, b) => b.totalS - a.totalS);
    this.position = sorted.indexOf(this.player) + 1;
    this.lap = clamp(Math.floor(this.player.totalS / this.track.length) + 1, 1, this.laps);
  }

  // ---------------------------------------------------------------- input
  readInput(dt) {
    const p = this.player;
    const inp = p.veh.input;
    const k = this.keys;
    const any = k.ArrowUp || k.KeyW || k.ArrowDown || k.KeyS || k.ArrowLeft || k.KeyA ||
      k.ArrowRight || k.KeyD || k.ShiftLeft || k.ShiftRight || k.Space;
    if (any) { this.playerControlled = true; this.idleTimer = 0; }
    else if (this.playerControlled) {
      this.idleTimer += dt;
      if (this.idleTimer > 7) this.playerControlled = false;
    }

    if (this.crashMode) {
      const b = p.veh.body;
      const steer = (k.ArrowRight || k.KeyD ? 1 : 0) - (k.ArrowLeft || k.KeyA ? 1 : 0);
      const push = (k.ArrowUp || k.KeyW ? 1 : 0) - (k.ArrowDown || k.KeyS ? 1 : 0);
      const f = this.track.frameAt(p.veh.trackS, _frame);
      if (steer) b.applyCentralForce(_v1.copy(f.right).multiplyScalar(steer * b.mass * 18));
      if (push) b.applyCentralForce(_v1.copy(f.tan).multiplyScalar(push * b.mass * 15));
      if (k.Space) b.applyCentralForce(_v1.set(0, b.mass * 26, 0));
      inp.throttle = 0; inp.brake = 0; inp.steer = 0; inp.boost = 0; inp.handbrake = 0;
      return;
    }

    if (!this.playerControlled) {
      this.attractAI.update(dt);
      this.boosting = inp.boost > 0.5 && this.boost > 0.02;
      inp.boost = this.boosting ? 1 : 0;
      if (this.forceBoost > 0) { this.forceBoost -= dt; this.boosting = true; inp.boost = 1; inp.throttle = 1; }
      if (this.boosting) this.boost = clamp(this.boost - dt * 0.14, 0, 1);
      else this.boost = clamp(this.boost + dt * 0.05, 0, 1);
      p.boostActive = this.boosting;
      return;
    }

    const manualSteer = (k.ArrowRight || k.KeyD ? 1 : 0) - (k.ArrowLeft || k.KeyA ? 1 : 0);
    // Once the player steers, the racing-line autopilot stops steering for them
    // -- permanently. Previously it re-engaged whenever the stick was centred and
    // disengaged the instant a key went down, which ALSO cut the corner-entry
    // braking, so tapping left sent the car into the first barrier at full speed
    // (measured: 33.9 -> 1.6 m/s, health 1.0 -> 0.66).
    if (manualSteer !== 0) this.userDriving = true;

    // The racing line still runs every frame, but only ever contributes braking
    // once the player has taken over. A safety net that scrubs speed is a
    // difficulty aid; one that steers for you is the game playing itself.
    let assistSteer = 0;
    let assistBrake = 0;
    let assistThrottle = 0;
    if (!p.wrecked) {
      this.attractAI.update(dt);
      assistSteer = inp.steer;
      assistBrake = inp.brake;
      assistThrottle = inp.throttle;
      if (this.userDriving) this.attractAI.laneTimer = 0;
    }

    const keyThrottle = (k.ArrowUp || k.KeyW) ? 1 : 0;
    const keyBrake = (k.ArrowDown || k.KeyS) ? 1 : 0;
    // The other half of the autopilot bug. Steering used to retire the whole
    // assist including its throttle, so a player who only steered watched the
    // car coast to a dead stop under them (measured: 46.6 -> 0.1 m/s in 4s).
    // Throttle assist now retires only when the player uses throttle or brake
    // themselves; until then it keeps the car rolling. Nothing in an arcade
    // racer should ever end with the car parked and the player still holding a key.
    if (keyThrottle || keyBrake) this.userThrottling = true;
    inp.throttle = this.userThrottling ? keyThrottle : Math.max(keyThrottle, assistThrottle);
    inp.brake = keyBrake;
    // Corner-entry safety net: never overrides a deliberate brake, and only
    // scrubs enough to keep the car on the island.
    if (!inp.brake && assistBrake > 0.02) {
      // Speed-gated. The racing line wants to brake for a corner regardless of
      // how fast you are actually going, so a car crawling out of an incident
      // was held at walking pace by its own safety net with the throttle down.
      // Below ~14 m/s nothing needs scrubbing; fade it in above that.
      const spdGate = clamp((p.veh.speed - 14) / 16, 0, 1);
      const w = (this.userDriving ? 0.55 : 0.9) * spdGate;
      inp.brake = Math.min(1, assistBrake * w);
      inp.throttle *= 1 - clamp(assistBrake, 0, 1) * 0.85 * w;
    }
    inp.steer = this.userDriving ? manualSteer : assistSteer;
    inp.handbrake = k.Space ? 1 : 0;

    // Recovery assist (see stuckWatchdog, which runs on wall time): while it is
    // engaged the throttle is held open. Steering input is deliberately left
    // untouched, so the player never feels the wheel go light.
    if (this.unsticking && !keyBrake) { inp.throttle = Math.max(inp.throttle, 0.85); inp.brake = 0; }

    let wantBoost = (k.ShiftLeft || k.ShiftRight);
    if (this.forceBoost > 0) { this.forceBoost -= dt; wantBoost = true; }
    if (wantBoost && this.boost > 0.02) {
      if (!this.boosting) this.audio.boostHit();
      this.boosting = true;
      inp.boost = 1;
      inp.throttle = 1;
      this.boost = clamp(this.boost - dt * 0.19, 0, 1);
    } else {
      this.boosting = false;
      inp.boost = 0;
      this.boost = clamp(this.boost + dt * 0.024, 0, 1);
    }
    p.boostActive = this.boosting;

    if (p.veh.driftAmount > 0.2 && p.veh.speed > 20) {
      this.boost = clamp(this.boost + dt * p.veh.driftAmount * 0.14, 0, 1);
      this.addScore(Math.floor(p.veh.driftAmount * 600 * dt));
    }
    if (p.veh.trackU < -1.5 && p.veh.speed > 28) {
      this.boost = clamp(this.boost + dt * 0.10, 0, 1);
      this.addScore(Math.floor(400 * dt));
    }
    if (p.veh.airTime > 0.25) this.boost = clamp(this.boost + dt * 0.14, 0, 1);
  }

  // --------------------------------------------------------------- camera
  updateCamera(dt) {
    const p = this.player;
    const b = p.veh.body;
    const speed = p.veh.speed;
    const spd01 = clamp(speed / 95, 0, 1.3);
    const boostK = this.boosting ? 1 : 0;

    const fwd = _v1.copy(p.veh.forward);
    const flatFwd = _up.set(fwd.x, 0, fwd.z);
    if (flatFwd.lengthSq() < 1e-4) flatFwd.set(0, 0, 1);
    flatFwd.normalize();
    const targetYaw = Math.atan2(flatFwd.x, flatFwd.z);
    let dyaw = targetYaw - this.camYaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    this.camYaw += dyaw * clamp(dt * (4.2 + spd01 * 3), 0, 1);
    const ys = Math.sin(this.camYaw), yc = Math.cos(this.camYaw);

    const desired = _desired, look = _look;
    let fovTarget = 62;
    let stiff = 7.5;

    switch (this.cameraMode) {
      case 'hood':
        desired.copy(b.pos).addScaledVector(p.veh.forward, 1.58).addScaledVector(p.veh.up, 0.40);
        look.copy(b.pos).addScaledVector(p.veh.forward, 34).addScaledVector(p.veh.up, 1.1);
        fovTarget = 66 + spd01 * 16 + boostK * 15;
        stiff = 30;
        break;
      case 'cinematic': {
        const t = this.time * 0.3;
        const r = 13 + Math.sin(t * 0.7) * 3;
        const ang = this.camYaw + Math.PI * 0.72 + Math.sin(t) * 0.55;
        desired.set(b.pos.x + Math.sin(ang) * r, b.pos.y + 1.15 + Math.sin(t * 1.3) * 0.5, b.pos.z + Math.cos(ang) * r);
        look.copy(b.pos).addScaledVector(p.veh.forward, 4);
        fovTarget = 42;
        stiff = 3.6;
        break;
      }
      case 'orbit':
        this.orbitAngle += dt * 0.5;
        desired.set(b.pos.x + Math.sin(this.orbitAngle) * 9.5, b.pos.y + 2.9, b.pos.z + Math.cos(this.orbitAngle) * 9.5);
        look.copy(b.pos);
        fovTarget = 48;
        stiff = 5;
        break;
      case 'crashcam': {
        // Burnout's takedown replay is a CUT sequence, not a drone orbit:
        //   beat A (0.00-0.85s) low two-shot that frames BOTH cars,
        //   beat B (0.85-2.10s) hard cut to a ground-level hero angle looking
        //                       up at the wreck against the sky,
        //   beat C (2.10-3.20s) hard cut to a slow push-in on the victim.
        const victim = this.takedownTarget || p;
        // A wreck that has tunnelled below the deck would drag the whole
        // framing underground and leave the replay staring at asphalt, so the
        // subject point is clamped to the road surface it belongs on.
        const vsurf = this.track.surface(victim.veh.body.pos.x, victim.veh.body.pos.z, victim.veh.hint);
        const vgy = vsurf ? vsurf.y : victim.veh.body.pos.y;
        const tp = _tp.copy(victim.veh.body.pos);
        tp.y = clamp(tp.y, vgy + 0.35, vgy + 9);
        const hp = _hp.copy(p.veh.body.pos);
        const hsurf = this.track.surface(hp.x, hp.z, p.veh.hint);
        if (hsurf) hp.y = clamp(hp.y, hsurf.y + 0.35, hsurf.y + 9);
        const t = this.takedownCamT > 0 ? (TAKEDOWN_CAM_LEN - this.takedownCamT) : this.time - this.crashStart;
        const beat = t < 0.85 ? 0 : (t < 2.10 ? 1 : 2);
        if (beat !== this._camBeat) {
          this._camBeat = beat;
          this._camCut = true;                      // force a hard cut, no lerp
          this.crashCamAngle = this.rng.range(0, Math.PI * 2);
          if (beat === 0) this.crashCamSide = this.rng.next() < 0.5 ? -1 : 1;
        }
        if (!this.cineFrozen) this.crashCamAngle += dt * (beat === 2 ? 0.42 : 0.16);
        // framing point biased toward the victim, so the wreck is the subject
        // even when the hero has carried speed away from the impact.
        // Beat 0 is a TWO-shot: bias the framing point to the true midpoint or
        // the hero walks straight out of the left edge of frame.
        _mid.copy(hp).lerp(tp, beat === 0 ? 0.50 : 0.68);
        const span = Math.min(tp.distanceTo(hp), 24);
        // A crash-mode pile-up is a field of wrecks, not a two-car takedown:
        // stand well back or the shot is one bus panel filling the frame.
        // A solo wreck is one car: standing 7.5m further back for it just made
        // the hero small. Only a multi-body pile-up needs the wide lens.
        const wide = this.crashMode ? (this.pileWide ? 7.5 : 1.2) : 0;

        if (beat === 0) {
          // Low two-shot, framed DOWN THE ROAD rather than across it. A random
          // azimuth put the hero behind the lens half the time; a perpendicular
          // one stood the lens off the edge of an elevated deck or inside a
          // downtown facade. Sitting back along the track axis is always over
          // tarmac, always has a floor, and stacks both cars in depth near the
          // centre of frame, which is exactly how Burnout cuts an impact.
          const f = p.veh.forward;
          const fl = Math.hypot(f.x, f.z) || 1;
          const fx = f.x / fl, fz = f.z / fl;
          const side = this.crashCamSide || 1;
          const r = clamp(span * 0.42 + 14.0, 14.5, 21.0) + wide;
          const lat = side * (2.9 + wide * 0.5);
          desired.set(
            _mid.x - fx * r + fz * lat,
            _mid.y + (this.crashMode ? 5.0 : 2.65),
            _mid.z - fz * r - fx * lat,
          );
          const dsurf = this.track.surface(desired.x, desired.z, p.veh.hint);
          if (dsurf && desired.y < dsurf.y + 1.6) desired.y = dsurf.y + 1.6;
          look.copy(_mid); look.y += this.crashMode ? 1.5 : 0.95;
          fovTarget = 56;
          stiff = 4.2;
          this.camRollTarget = side * 0.06;
        } else if (beat === 1) {
          // hero angle: on the deck, looking UP at the wreck against the sky,
          // but keeping the road line in frame so the shot has a floor.
          const ang = this.crashCamAngle + 2.1;
          const gy = vgy;
          desired.set(tp.x + Math.sin(ang) * (11.4 + wide), gy + 1.55 + wide * 0.62, tp.z + Math.cos(ang) * (11.4 + wide));
          look.copy(tp); look.y = gy + (tp.y - gy) * 0.7 + 0.55;
          fovTarget = 45;
          stiff = 3.0;
          this.camRollTarget = -0.10;
        } else {
          // push-in, slight orbit, victim fills frame
          const ang = this.crashCamAngle + 4.4;
          const r = 11.5 + wide - clamp((t - 2.10) * 2.2, 0, 3.2);
          // Sit ABOVE the wreck. Framing from below put the lens under an
          // airborne, inverted car and filled the shot with floor pan and
          // suspension -- the least readable surface on the vehicle.
          desired.set(tp.x + Math.sin(ang) * r, Math.max(vgy + 3.1, tp.y + 2.35), tp.z + Math.cos(ang) * r);
          look.copy(tp); look.y += 0.15;
          fovTarget = 44;
          stiff = 5.2;
          this.camRollTarget = 0.09;
        }
        break;
      }
      default: {
        const back = 7.1 + spd01 * 2.2 + boostK * 1.8;
        const height = 2.52 + spd01 * 0.45;
        desired.set(b.pos.x - ys * back, b.pos.y + height, b.pos.z - yc * back);
        const surf = this.track.surface(desired.x, desired.z, p.veh.hint);
        if (surf && desired.y < surf.y + 1.5) desired.y = surf.y + 1.5;
        look.set(b.pos.x + ys * (8.5 + spd01 * 5), b.pos.y + 1.12, b.pos.z + yc * (8.5 + spd01 * 5));
        fovTarget = 58 + spd01 * 15 + boostK * 17;
        stiff = 6.0 + spd01 * 3.2;
        break;
      }
    }

    if (this.takedownCamT > 0) {
      // Screenshot harnesses need the signature moment to still be on screen
      // when the shutter fires, so ?event=/?hold= parks the replay on one beat.
      const floorT = this.cineHold ? Math.max(0.02, TAKEDOWN_CAM_LEN - this.cineHoldT) : 0;
      // Sim time, not wall time. Counting down in real seconds meant the 3.2s
      // replay expired during the bullet-time it exists to show off, and made
      // the signature moment unobservable to any screenshot harness.
      // Under a held capture the replay converges on the requested beat fast,
      // so a software-GL harness reaches it inside its wait budget.
      this.takedownCamT = Math.max(floorT, this.takedownCamT - this.simDt * (this.cineHold ? 3.0 : 1.0));
      // Once parked on the requested beat, stop advancing the sim entirely so
      // the composition is byte-identical across runs and machine speeds.
      // ...but only after a few more simulated frames. forceEvent() runs from
      // the timer drain, which is AFTER the physics steps, so freezing on the
      // very next frame would park the render with the victim's meshes still
      // sitting wherever it was before it got teleported into the wreck.
      if (this.cineHold && floorT > 0 && this.takedownCamT <= floorT + 1e-4) {
        this._cineSettle++;
        if (this._cineSettle >= 5) this.cineFrozen = true;
      }
      // vertigo dolly-zoom on the first beat
      fovTarget -= 12 * clamp((this.takedownCamT - (TAKEDOWN_CAM_LEN - 0.85)) / 0.85, 0, 1);
      if (this.takedownCamT <= 0 && this.cameraMode === 'crashcam' && !this.crashMode) {
        this.cameraMode = this.prevCam || 'chase';
        this.takedownTarget = null;
        this._camBeat = -1;
      }
    }

    // Wreck-camera body avoidance. A pile-up drops seven vehicles inside the
    // replay radius, and without this the hero shot is the inside of a bus.
    if (this.cameraMode === 'crashcam' || this.crashMode) {
      const minD = 4.2;
      const push = (bp) => {
        const dx = desired.x - bp.x, dy = desired.y - bp.y, dz = desired.z - bp.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > minD * minD || d2 < 1e-6) return;
        const d = Math.sqrt(d2), k = (minD - d) / d;
        desired.x += dx * k; desired.y += dy * k; desired.z += dz * k;
      };
      for (let pass = 0; pass < 3; pass++) {
        for (const c of this.cars) push(c.veh.body.pos);
        for (const it of this.traffic.items) if (it.active && it.body) push(it.body.pos);
      }
      const cs = this.track.surface(desired.x, desired.z, p.veh.hint);
      if (cs && desired.y < cs.y + 1.1) desired.y = cs.y + 1.1;
    }

    if (this.cineFrozen) { this._camCut = true; }
    if (this._camCut) {
      this._camCut = false;
      this.camPos.copy(desired);
      this.camLook.copy(look);
      this.camRoll = this.camRollTarget || 0;
      this.camFov = fovTarget;
    } else {
      this.camPos.lerp(desired, clamp(dt * stiff, 0, 1));
      this.camLook.lerp(look, clamp(dt * stiff * 1.3, 0, 1));
    }

    this.shake = Math.max(0, this.shake - dt * this.shakeDecay);
    const sh = this.shake * this.shake;
    // Boost has to be felt, not just seen: the rig gets a hard high-frequency
    // rumble the instant it lights, on top of the FOV punch and speed lines.
    const rumble = (spd01 > 0.72 ? (spd01 - 0.72) * 0.5 : 0) + (this.boosting ? 0.95 : 0);
    const amp = sh * 0.5 + rumble * 0.14;
    this.shakeOffset.set(
      (Math.random() - 0.5) * amp,
      (Math.random() - 0.5) * amp,
      (Math.random() - 0.5) * amp * 0.5
    );

    this.camera.position.copy(this.camPos).add(this.shakeOffset);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camLook);
    const rollWant = this.cameraMode === 'crashcam' ? (this.camRollTarget || 0) : 0;
    this.camRoll = (this.camRoll || 0) + (rollWant - (this.camRoll || 0)) * 0.08;
    if (Math.abs(this.camRoll) > 0.001) this.camera.rotateZ(this.camRoll);
    if (this.cameraMode === 'chase' || this.cameraMode === 'hood') {
      const lat = b.vel.dot(p.veh.right) / Math.max(14, speed);
      this.camera.rotateZ(clamp(lat * 0.15, -0.12, 0.12));
    }
    this.camFov += (fovTarget - this.camFov) * clamp(dt * (fovTarget > this.camFov ? 8.5 : 4.0), 0, 1);
    if (Math.abs(this.camera.fov - this.camFov) > 0.02) {
      this.camera.fov = this.camFov;
      this.camera.updateProjectionMatrix();
    }
  }

  updateLighting() {
    const p = this.player.veh.body.pos;
    this.sun.position.copy(this.sunDir).multiplyScalar(190).add(p);
    this.sun.target.position.copy(p);
    this.sun.target.updateMatrixWorld();
    const cine = this.cameraMode === 'crashcam';
    // Key whatever the crash camera is actually framing. Following
    // takedownTarget alone left the subject a flat silhouette once the
    // takedown timer expired but the camera was still on the wreck.
    const heroTarget = cine ? this.camLook
      : (this.takedownTarget && this.takedownCamT > 0 ? this.takedownTarget.veh.body.pos : p);
    if (this.heroLight) {
      if (cine) {
        // key the wreck so the hero moment never silhouettes into mush
        _v1.copy(this.camera.position).sub(heroTarget).normalize();
        this.heroLight.position.copy(heroTarget).addScaledVector(_v1, 5.0);
        this.heroLight.position.y += 3.4;
        this.heroLight.distance = 40;
        this.heroLight.intensity += (34 - this.heroLight.intensity) * 0.3;
      } else {
        this.heroLight.distance = 16;
        this.heroLight.position.set(p.x, p.y + 4.4, p.z).addScaledVector(this.player.veh.forward, -2.2);
        const want = this.world.inTunnel && this.world.inTunnel(this.player.veh.trackS) ? 14 : 2.2;
        this.heroLight.intensity += (want - this.heroLight.intensity) * 0.15;
      }
    }
    if (this.rimLight) {
      if (cine) {
        _v2.copy(this.camera.position).sub(heroTarget).normalize();
        this.rimLight.position.copy(heroTarget).addScaledVector(_v2, -7.5);
        this.rimLight.position.y += 5.0;
        this.rimLight.distance = 34;
        this.rimLight.intensity = 26;
      } else {
        this.rimLight.intensity = 0;
      }
    }
    const inTun = this.world.inTunnel ? this.world.inTunnel(this.player.veh.trackS) : false;
    const target = inTun ? this.fogBase * 2.6 : this.fogBase;
    this.scene.fog.density += (target - this.scene.fog.density) * 0.05;
    this.sun.intensity += ((inTun ? 0.30 : 8.2) - this.sun.intensity) * 0.06;
    this.hemi.intensity += ((inTun ? 0.34 : 0.55) - this.hemi.intensity) * 0.06;
  }


  // ----------------------------------------------------------------- loop
  step(dt) {
    this.time += dt;
    this.raceTime += dt;

    this.readInput(dt);

    for (const c of this.cars) {
      if (c !== this.player && c.ai) c.ai.update(dt);
      c.veh.update(dt);
    }
    this.traffic.update(dt, this.player.veh.trackS);
    this.handleCollisions();
    this.checkNearMisses();
    this.updateRacePositions();

    for (const c of this.cars) c.update(dt);
    // Delayed secondary detonations from takedowns / big wrecks.
    for (let i = this.pendingBlasts.length - 1; i >= 0; i--) {
      const b = this.pendingBlasts[i];
      b.t -= dt;
      if (b.t > 0) continue;
      this.pendingBlasts.splice(i, 1);
      this.vfx.fireBurst(b.p, 34, 1.9);
      this.vfx.debrisBurst(b.p, 46, _v0.set(0, 5, 0), b.c);
      this.vfx.sparkBurst(b.p, 150, null, 1.5, 26, [1.0, 0.78, 0.34]);
      this.vfx.smokePuff(b.p, 16, _v0.set(0, 3, 0), 2.6, 0.12, 3.0);
      this.vfx.flashAt(b.p, 3.4, 0.16, [2.6, 1.7, 0.7]);
      this.shockAt(b.p, 0.8);
      if (this.post) this.post.u.uFlash.value = Math.max(this.post.u.uFlash.value, 0.34);
    }
    this.vfx.update(dt, this._groundFn, this.camera.position);

    if (this.chainTimer > 0) {
      this.chainTimer -= dt;
      if (this.chainTimer <= 0) this.chain = 0;
    }

    if (this.crashMode) {
      this.crashMeter = clamp(this.crashMeter - dt * 0.02, 0, 1);
      if (!this.cineHold && this.realTime - this.crashStartWall > 7.5) this.exitCrashMode();
    }

    if (this.slowmoT > 0) {
      this.slowmoT -= dt / Math.max(0.05, this.timeScale);
      if (this.slowmoT <= 0 && !this.crashMode) {
        this.targetTimeScale = 1;
        this.audio.setSlowmo(0);
      }
    }
  }

  frame(dtReal) {
    const q = this.quality;
    this.realTime += Math.min(dtReal, DT_HITCH_CAP);

    // ---- fixed-step accumulator -------------------------------------------
    // dtWall is real wall time, only clamped for genuine hitches (tab-away,
    // shader compile stalls). Everything the player perceives as "time" is
    // driven from it, so the game never enters bullet time just because the
    // renderer is slow.
    const dtWall = Math.min(dtReal, DT_HITCH_CAP);

    if (this.hitStopT > 0) {
      this.hitStopT -= dtWall;
      this.timeScale += (0.05 - this.timeScale) * 0.7;
    } else {
      this.timeScale += (this.targetTimeScale - this.timeScale) * clamp(dtWall * 8, 0, 1);
    }

    if (!this.paused && !this.cineFrozen) {
      this.simAccum += dtWall * this.timeScale;
      // Slow renderer: shorten nothing, just run more (slightly wider) steps,
      // so metres-per-real-second stays constant at any frame rate. Physics is
      // cheap next to rasterisation, so 48 catch-up steps costs almost nothing.
      let step = DT_FIXED;
      let steps = Math.floor(this.simAccum / step);
      if (steps > 8) {
        step = Math.min(DT_STEP_CAP, Math.max(DT_FIXED, this.simAccum / DT_MAX_STEPS));
        steps = Math.min(DT_MAX_STEPS, Math.floor(this.simAccum / step));
      }
      for (let i = 0; i < steps; i++) this.step(step);
      this.simDt = steps * step;
      this.simAccum -= steps * step;
      if (this.simAccum > DT_STEP_CAP * DT_MAX_STEPS) this.simAccum = 0;
      // Non-cinematic forced events (boost, near-miss) park on their money frame
      // the same way the takedown replay does, so a 1.4fps software-GL capture
      // never catches the attract driver two seconds later in a barrier.
      if (this.cineFreezeAt > 0 && this.time >= this.cineFreezeAt) {
        this._cineSettle++;
        if (this._cineSettle >= 3) this.cineFrozen = true;
      }
    } else {
      this.simAccum = 0;
      this.simDt = 0;
    }
    this.stuckWatchdog(dtWall);
    this.drainTimers(dtWall);
    this.updateCamera(dtWall);
    this.updateLighting();
    if (this.world.update) this.world.update(dtWall, this.camera.position, this.player.veh.body.vel);

    const p = this.player;
    this.audio.updateEngine(p.veh.rpm, p.veh.input.throttle, p.veh.speed, this.boosting ? 1 : 0);
    let skid = 0;
    for (const w of p.veh.wheels) skid = Math.max(skid, w.skid || 0);
    this.audio.updateTyres(p.wrecked ? 0 : skid);
    this.audio.tick(dtWall);
    if (p.veh.justShifted) { p.veh.justShifted = 0; this.audio.blowoff(); }

    const u = this.post.u;
    const spd01 = clamp(p.veh.speed / 100, 0, 1.2);
    u.uTime.value = this.realTime;
    u.uSpeed.value += (spd01 * 0.85 - u.uSpeed.value) * clamp(dtWall * 6, 0, 1);
    u.uBoost.value += ((this.boosting ? 1 : 0) - u.uBoost.value) * clamp(dtWall * 5, 0, 1);
    u.uCrash.value += ((this.crashMode ? 1 : 0) - u.uCrash.value) * clamp(dtWall * 4, 0, 1);
    u.uFlash.value = clamp(u.uFlash.value - dtWall * 3.2, 0, 1);
    // Project the hero car into screen space so the grade pass can keep it out
    // of the radial blur.
    _proj.copy(p.group.position); _proj.y += 0.6;
    _proj.project(this.camera);
    const heroOnScreen = _proj.z < 1;
    u.uHero.value.set(_proj.x * 0.5 + 0.5, _proj.y * 0.5 + 0.5);
    const camDist = this.camera.position.distanceTo(p.group.position);
    u.uHeroR.value = heroOnScreen ? clamp(3.4 / Math.max(3, camDist), 0.05, 0.42) : 0.0;
    if (this.shockT > 0) {
      this.shockT -= dtWall;
      const k = 1 - clamp(this.shockT / Math.max(0.05, this.shockLife || 0.42), 0, 1);
      _proj.copy(this.shockPos).project(this.camera);
      u.uShockC.value.set(_proj.x * 0.5 + 0.5, _proj.y * 0.5 + 0.5);
      u.uShockR.value = k * 0.95;
      u.uShock.value = (1 - k) * (_proj.z < 1 ? 1 : 0);
    } else u.uShock.value = 0;
    this.post.bloom.strength = q.bloomStrength * (1 + u.uBoost.value * 0.45 + u.uCrash.value * 0.10);
    u.uExposure.value = EXPOSURE * (1 + u.uBoost.value * 0.09);

    const blips = this.cars.map((c) => ({
      x: c.veh.body.pos.x, z: c.veh.body.pos.z, me: c === p, rival: c !== p,
    }));
    // In hold mode (screenshot harness) the callout is pinned at its peak so
    // the signature typography is actually in the frame the shutter catches.
    if (this.cineHold && (this.crashMode || this.takedownCamT > 0)) this.hud.calloutT = 1.9 * 0.55;
    this.hud.update(dtWall, {
      speed: p.veh.speed, rpm: p.veh.rpm, gear: p.veh.gear,
      boost: this.boost, boosting: this.boosting,
      score: this.score, takedowns: this.takedowns,
      position: this.position, racers: this.cars.length,
      lap: this.lap, laps: this.laps, time: this.raceTime,
      crashMode: this.crashMode, crashMeter: this.crashMeter,
      health: p.health, blips,
    });

    this.renderer.info.reset();
    this.post.render(dtWall);

    // Honest frame-time accounting: dtReal is the raw, unclamped delta.
    const ms = dtReal * 1000;
    this.frameMs[this.frameMsN] = ms;
    this.frameMsN = (this.frameMsN + 1) % this.frameMs.length;
    if (this.frameMsCount < this.frameMs.length) this.frameMsCount++;
    this.fpsAccum += dtReal;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5 || this.fpsFrames >= 4) {
      this.realFps = this.fpsFrames / this.fpsAccum;
      this.fps = this.realFps;
      this.fpsAccum = 0; this.fpsFrames = 0;
    }
    this.frames++;
  }
}

const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _n1 = new THREE.Vector3();
const _tp = new THREE.Vector3();
const _hp = new THREE.Vector3();

// ------------------------------------------------------------------- boot
const root = document.getElementById('app') || document.body;
const game = new Game(root);
game._groundFn = (x, z) => {
  const s = game.track.surface(x, z, game.player.veh.hint);
  return s ? s.y : 0;
};
window.__CRASHOUT__ = game;
window.__THREE__ = THREE;

const bootParams = new URLSearchParams(location.search);
if (window.__SHOT__ || bootParams.has('cam') || bootParams.has('event')) game.hud.hideTitle();
game.after(2.4, () => game.hud.hideTitle());

if (window.__SHOT__ || bootParams.has('event') || bootParams.has('hold')) {
  game.cineHold = true;
  // Only wreck captures want their callout pinned open. Pinning it for a boost
  // or attract capture leaves a stale TAKEDOWN slam over an unrelated frame.
  const _ev = bootParams.get('event');
  game.hud.holdCallouts = !_ev || _ev === 'takedown' || _ev === 'crash' || _ev === 'pileup';
  // A boost or near-miss capture is about the car, so nothing is allowed to
  // steal the camera: an incidental takedown en route used to hijack the shot
  // into a replay of a rival, with the hero nowhere in frame.
  game.cineLockCam = _ev === 'boost' || _ev === 'nearmiss';
  const beat = bootParams.get('beat');
  game.cineHoldT = beat !== null ? [0.42, 1.45, 2.75][Math.min(2, Math.max(0, +beat))] : 1.45;
}

const forcedEvent = bootParams.get('event');
if (forcedEvent) {
  game.after(1.0, () => {
    game.playerControlled = false;
    // Stage held captures on the downtown neon strip so the money shots are
    // always shot against the best-looking part of the route.
    if (game.cineHold && !bootParams.has('here')) {
      const t = game.track;
      // 0.195 is the elevated downtown straight: neon signage, dense facades,
      // near-zero curvature for 200m either side. The old 0.845 was on a 6%
      // downhill, which launched the staged car and left it spun and stationary
      // in every capture.
      const s0 = t.length * (bootParams.has('at') ? +bootParams.get('at') : 0.195);
      const mkFrame = () => ({
        pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(),
        up: new THREE.Vector3(), curv: 0, bank: 0, kind: 'open',
      });
      const ff = t.frameAt(s0, game._bootFrame || (game._bootFrame = mkFrame()));
      game.player.veh.reset(s0, 2.4, t);
      game.player.veh.body.vel.copy(ff.tan).multiplyScalar(58);
      game.player.veh.speed = 58;
      game.player.repair();
      // Bring the whole field and the traffic stream with us, otherwise the
      // strip is empty and the rivals spend the capture respawning.
      const f2 = mkFrame();
      let n = 0;
      for (const c of game.cars) {
        if (c === game.player) continue;
        const ds = [16, -13, 30, -26][n % 4];
        const du = [-4.4, 4.6, 1.0, -1.4][n % 4];
        const cs = t.wrapS(s0 + ds);
        c.veh.reset(cs, du, t);
        t.frameAt(cs, f2);
        c.veh.body.vel.copy(f2.tan).multiplyScalar(55);
        c.veh.speed = 55;
        c.repair();
        if (c.ai) { c.ai.recovering = 0; c.ai.stuckTimer = 0; c.ai.targetU = du; }
        n++;
      }
      game.traffic.reset(s0);
      game.camPos.copy(game.player.veh.body.pos).addScaledVector(ff.tan, -8).y += 2.8;
    }
    try { game.forceEvent(forcedEvent); } catch (e) { console.error('[crashout] forceEvent', e); }
  });
}

let last = performance.now();
let firstFrame = true;

// Compile all shader programs up front. Three.js otherwise compiles lazily on
// first render of each material, stuttering once per new object type entering
// view -- a major cause of the "lag" felt during the opening seconds.
// The bind matters: program cache keys carry the output colour space, and the
// game only ever renders the scene into the HDR post target, so compiling with
// the canvas bound would have produced a throwaway program for every material.
game.renderer.setRenderTarget(game.post.sceneRT);
game.renderer.compile(game.scene, game.camera);
game.renderer.setRenderTarget(null);
// Refresh shadows on a cadence rather than every frame.
game.renderer.shadowMap.autoUpdate = false;
game.renderer.shadowMap.needsUpdate = true;
let shadowTick = 0;

// Don't run (or bank a simulation backlog) while the tab is hidden.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.paused = true;
  else { game.paused = false; last = performance.now(); }
});

function loop() {
  const now = performance.now();
  // Raw, unclamped wall-clock delta. Game.frame() owns all clamping so that the
  // reported frame timings are the real ones.
  const dt = Math.max(0.0002, (now - last) / 1000 || 0.016);
  last = now;
  shadowTick++;
  game.renderer.shadowMap.needsUpdate = shadowTick % 3 === 0;
  try {
    game.frame(dt);
  } catch (err) {
    console.error('[crashout] frame error', err);
  }
  if (firstFrame) {
    firstFrame = false;
    requestAnimationFrame(() => { window.__READY__ = true; });
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
