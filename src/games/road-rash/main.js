// Asphalt Fury — motorcycle combat racer.
// Entry point: renderer, lighting/IBL, cameras, race loop, combat, public API.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { RNG, clamp, lerp, damp } from './rng.js';
import { buildTextures } from './textures.js';
import { Track } from './track.js';
import { Materials } from './materials.js';
import { World } from './world.js';
import { createBike, setBikeDetail } from './bike.js';
import { Racer } from './physics.js';
import { RivalAI, CopAI, TrafficSystem } from './ai.js';
import { VFX, SkidRibbon } from './vfx.js';
import { PostFX } from './postfx.js';
import { HUD } from './hud.js';
import { Audio } from './audio.js';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
  stencil: false,
  alpha: false,
});
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// The scene renders into a linear HDR target and the grade pass tone-maps it
// exactly once, at the end. Leaving ACES on here tone-mapped a second time and
// is what crushed every midtone into the washed-out look.
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor(0x0a0d13, 1);
app.appendChild(renderer.domElement);

// ------------------------------------------------------------ quality tier
function detectSoftware() {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const s = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    return /swiftshader|llvmpipe|software/i.test(s);
  } catch (e) {
    return false;
  }
}
const isSoftware = detectSoftware();
let quality = params.get('q') || (isSoftware ? 'high' : 'ultra');

const QUALITY = {
  ultra: { shadow: 2048, pr: Math.min(window.devicePixelRatio, 2), post: true, viewFwd: 700 },
  high: { shadow: 1536, pr: 1, post: true, viewFwd: 660 },
  med: { shadow: 1024, pr: 1, post: true, viewFwd: 560 },
  low: { shadow: 512, pr: 1, post: true, viewFwd: 420 },
};
const maxAniso = renderer.capabilities.getMaxAnisotropy();

// ------------------------------------------------------------------- scene
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x9fb0c4, 0.00058);  // set from the TOD table below

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.35, 14000);
camera.position.set(0, 4, 12);

// ---------------------------------------------------------- time of day rig
// A real rig, not a hardcoded setup: every light, the sky parameters, the fog
// and the grade are driven from this table so a second TOD is a one-line change.
const TOD = {
  // Ratio discipline: `key * sin(elev)` is the irradiance a flat road receives
  // from the key. `hemi + rim*sin(rimElev) + bounce*sin(50) + env*0.77` is the
  // fill. AAA outdoor daylight runs 6:1..10:1; anything under 3:1 has no form.
  // day  -> key 9.40*sin34 = 5.26 vs fill 0.26+0.30*sin34+0.30*sin50+0.24*0.77
  //         = 0.26+0.168+0.230+0.185 = 0.843  ->  6.24 : 1
  // Pass 3 raised the fill from 0.551 (9.55:1) to 0.843. 9.5:1 measured well on
  // the road but crushed every dark material in the build - near-black leathers
  // on a near-black chassis meant the rider on the hero bike did not read at
  // all in a chase frame. 6.2:1 is still comfortably inside the AAA outdoor
  // band and inside the >=4:1 the critique demanded.
  // The env term is the one that actually decides shadow depth: a PMREM of a
  // clear Preetham sky is a very bright hemisphere and it is NOT occluded by
  // the shadow map, so every point of environmentIntensity is a point of
  // unshadowable fill. Pass 2 ran it at 0.78 and the shadows had nowhere to go.
  // Azimuth 292 puts the sun off the rider's left and slightly behind, so the
  // bike throws its shadow to the RIGHT and slightly forward - into frame from
  // the chase cam. At 218 the shadow fell straight back and the bike sat on top
  // of it, which is why pass 2 measured a zero-delta cast shadow.
  day: {
    elev: 34.0, azim: 292, key: 9.40, keyColor: 0xfff0d2,
    rim: 0.30, rimColor: 0xb9d2ff, rimElev: 34, bounce: 0.30, bounceColor: 0xc9b089,
    env: 0.24, exposure: 0.88,
    turbidity: 2.8, rayleigh: 1.5, mie: 0.0020, mieG: 0.80,
    fog: 0xa9bcd0, fogD: 0.00052, groundBounce: 0x5a4c3c,
    hemi: 0.26, hemiSky: 0x7e93b4, hemiGround: 0x6b5a42,
    sunSprite: [1.45, 1.22, 0.92], sunScale: 150, lampsOn: 0,
    cloud: 0xffffff, cloudOp: 1.0, head: 0,
    grade: { warm: 1.0, teal: 1.0 },
  },
  // dusk -> key 7.60*sin8.5 = 1.12 vs fill 0.20+0.36*sin30+0.13*sin50+0.34*0.77
  //         = 0.20+0.180+0.100+0.262 = 0.742  ->  1.51 : 1 raw, but the head-
  //         light and lamp pools carry the local ratio. Elevation raised from
  //         4.2 to 8.5 so the sun actually reaches the road instead of grazing
  //         it: pass 2 dusk was 33.8% pure black with 0% speculars.
  dusk: {
    elev: 8.5, azim: 250, key: 7.60, keyColor: 0xffa855,
    rim: 0.36, rimColor: 0x8fabe0, rimElev: 26, bounce: 0.13, bounceColor: 0xa07a58,
    env: 0.34, exposure: 1.02,
    turbidity: 5.4, rayleigh: 2.4, mie: 0.006, mieG: 0.86,
    fog: 0xb08a76, fogD: 0.00074, groundBounce: 0x3a2a20,
    hemi: 0.20, hemiSky: 0x6b7fa4, hemiGround: 0x4a2f1e,
    sunSprite: [2.1, 1.05, 0.5], sunScale: 250, lampsOn: 0.75,
    cloud: 0xffb98a, cloudOp: 0.95, head: 620,
    grade: { warm: 1.14, teal: 1.05 },
  },
  night: {
    elev: -7.0, azim: 264, key: 0.95, keyColor: 0x93a9da,
    rim: 0.55, rimColor: 0x6f8bd4, rimElev: 22, bounce: 0.20, bounceColor: 0x2c3d5c,
    env: 0.52, exposure: 1.95,
    turbidity: 2.0, rayleigh: 0.6, mie: 0.004, mieG: 0.80,
    fog: 0x0e1626, fogD: 0.00110, groundBounce: 0x0c1018,
    hemi: 0.62, hemiSky: 0x33456a, hemiGround: 0x1b2331,
    sunSprite: [0.35, 0.45, 0.9], sunScale: 90, lampsOn: 1,
    cloud: 0x39466a, cloudOp: 0.9, head: 1700,
    grade: { warm: 0.86, teal: 1.22 },
  },
};
const TOD_NAME = TOD[params.get('tod')] ? params.get('tod') : 'day';
const tod = TOD[TOD_NAME];
const SUN_ELEV = tod.elev;
const SUN_AZIM = tod.azim;
const sunDir = new THREE.Vector3();
{
  const phi = THREE.MathUtils.degToRad(90 - SUN_ELEV);
  const theta = THREE.MathUtils.degToRad(SUN_AZIM);
  sunDir.setFromSphericalCoords(1, phi, theta);
}

const sky = new Sky();
sky.scale.setScalar(9000);
// Preetham radiance near the sun runs into the tens; clamp it so the bloom pass
// gets a sane HDR range instead of nuking the frame.
sky.material.fragmentShader = sky.material.fragmentShader.replace(
  'gl_FragColor = vec4( texColor, 1.0 );',
  'gl_FragColor = vec4( min( texColor, vec3( 2.40 ) ), 1.0 );'
);
{
  const u = sky.material.uniforms;
  u.turbidity.value = tod.turbidity;
  u.rayleigh.value = tod.rayleigh;
  u.mieCoefficient.value = tod.mie;
  u.mieDirectionalG.value = tod.mieG;
  u.sunPosition.value.copy(sunDir);
  if (u.cloudCoverage) u.cloudCoverage.value = 0.42;
  if (u.cloudDensity) u.cloudDensity.value = 0.5;
  if (u.cloudScale) u.cloudScale.value = 0.00016;
  if (u.cloudSpeed) u.cloudSpeed.value = 0.00004;
  if (u.cloudElevation) u.cloudElevation.value = 0.6;
  // The Preetham sun disc is ~19000x brighter than the sky; feeding that into
  // the bloom pass nukes the frame. We draw our own controlled sun instead.
  if (u.showSunDisc) u.showSunDisc.value = 0;
}
scene.add(sky);

// controlled sun disc + glare, bright enough to bloom but not to blow out
const sunSprite = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0.0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.06, 'rgba(255,252,240,1)');
  grd.addColorStop(0.11, 'rgba(255,226,170,0.36)');
  grd.addColorStop(0.26, 'rgba(255,180,110,0.09)');
  grd.addColorStop(1.0, 'rgba(255,150,70,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: t,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: true,
  });
  mat.color.setRGB(tod.sunSprite[0], tod.sunSprite[1], tod.sunSprite[2]);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.scale.setScalar(tod.sunScale);
  m.renderOrder = -2;
  m.frustumCulled = false;
  scene.add(m);
  return m;
})();

// IBL from the very same sky
const pmrem = new THREE.PMREMGenerator(renderer);
{
  const envScene = new THREE.Scene();
  const skyCopy = new Sky();
  skyCopy.scale.setScalar(9000);
  // Same clamp as the visible sky: without it the PMREM env map carries raw
  // Preetham radiance (tens of units near the sun) and every metal/clearcoat
  // surface in the game mirrors it as pure blown-out white.
  skyCopy.material.fragmentShader = skyCopy.material.fragmentShader.replace(
    'gl_FragColor = vec4( texColor, 1.0 );',
    'gl_FragColor = vec4( min( texColor, vec3( 1.35 ) ), 1.0 );'
  );
  skyCopy.material.needsUpdate = true;
  skyCopy.material.uniforms.turbidity.value = tod.turbidity;
  skyCopy.material.uniforms.rayleigh.value = tod.rayleigh;
  skyCopy.material.uniforms.mieCoefficient.value = tod.mie;
  skyCopy.material.uniforms.mieDirectionalG.value = tod.mieG;
  skyCopy.material.uniforms.sunPosition.value.copy(sunDir);
  if (skyCopy.material.uniforms.showSunDisc) skyCopy.material.uniforms.showSunDisc.value = 0;
  envScene.add(skyCopy);
  // warm ground bounce card so the underside of things isn't dead
  const ground = new THREE.Mesh(
    new THREE.SphereGeometry(3000, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: tod.groundBounce, side: THREE.BackSide })
  );
  envScene.add(ground);

  const rt = pmrem.fromScene(envScene, 0.02);
  scene.environment = rt.texture;
  scene.environmentIntensity = tod.env;
  // The IBL is baked once. Everything that produced it — the PMREM blur/GGX
  // materials and the throwaway sky + bounce-card scene — is dead weight
  // afterwards, and every one of those materials is still holding a compiled
  // shader program alive. Drop them.
  pmrem.dispose();
  skyCopy.material.dispose();
  skyCopy.geometry.dispose();
  ground.material.dispose();
  ground.geometry.dispose();
  envScene.clear();
}

const HERO_SPLIT_ = 0.34;
const sun = new THREE.DirectionalLight(tod.keyColor, tod.key * (1 - HERO_SPLIT_));
sun.position.copy(sunDir).multiplyScalar(160);
sun.castShadow = true;
sun.shadow.mapSize.set(QUALITY[quality].shadow, QUALITY[quality].shadow);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 900;
// wide enough that the mid-distance world still casts; the map follows the
// player and is snapped to texel centres in render() to stop shadow crawl.
const SHADOW_EXT = quality === 'low' ? 58 : quality === 'med' ? 72 : 92;
sun.shadow.camera.left = -SHADOW_EXT;
sun.shadow.camera.right = SHADOW_EXT;
sun.shadow.camera.top = SHADOW_EXT;
sun.shadow.camera.bottom = -SHADOW_EXT;
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.022;
sun.shadow.radius = 2.2;
scene.add(sun);
scene.add(sun.target);

// A second, tight shadow caster locked to the bike. This is what makes the
// hero asset sit ON the road instead of hovering: the wide cascade above has
// ~15 cm texels, this one has ~5 mm.
// It carries a real slice of the key intensity (subtracted from the sun below)
// so its shadow term actually darkens pixels.
const HERO_SPLIT = 0.34;
const heroShadow = new THREE.DirectionalLight(tod.keyColor, tod.key * HERO_SPLIT);
// low tier drops the second (hero) shadow cascade entirely: one fewer full
// shadow pass is the single biggest triangle saving available.
heroShadow.castShadow = quality !== 'low';
heroShadow.shadow.mapSize.set(quality === 'low' ? 512 : 1024, quality === 'low' ? 512 : 1024);
heroShadow.shadow.camera.near = 0.5;
heroShadow.shadow.camera.far = 90;
// +-3.2 m over a 1024 map = 6.25 mm/texel: tight enough for a tyre contact edge
heroShadow.shadow.camera.left = -3.2;
heroShadow.shadow.camera.right = 3.2;
heroShadow.shadow.camera.top = 3.2;
heroShadow.shadow.camera.bottom = -3.2;
heroShadow.shadow.bias = -0.00018;
heroShadow.shadow.normalBias = 0.004;
heroShadow.shadow.radius = 1.6;
scene.add(heroShadow);
scene.add(heroShadow.target);

// Rider headlight. Off in daylight; at dusk and night it is the only thing
// that keeps the tarmac in front of the bike from being a black void, and the
// pool of light sliding over the road is a strong speed cue in its own right.
const headLight = new THREE.SpotLight(0xffeed0, tod.head, 130, 0.50, 0.62, 1.35);
headLight.visible = tod.head > 0;
headLight.castShadow = false;
scene.add(headLight);
scene.add(headLight.target);
scene.fog.color.setHex(tod.fog);
scene.fog.density = tod.fogD;
// Exposure now lives in the grade pass (the only place that tone-maps).
const EXPOSURE = tod.exposure * 0.68;

const bounce = new THREE.DirectionalLight(tod.bounceColor, tod.bounce);
bounce.position.set(-sunDir.x * 60, 60, -sunDir.z * 60);
scene.add(bounce);
// Rim: behind and off-axis from the key so the fairing edge separates from the
// asphalt. Azimuth is deliberately +145 degrees off the sun, elevation from the
// TOD table. It exists to draw an edge, NOT to relight the world - at 0.34 it
// contributes 0.19 of the 0.68 total fill.
const rimAz = THREE.MathUtils.degToRad(SUN_AZIM + 145);
const rimEl = THREE.MathUtils.degToRad(tod.rimElev || 26);
const rimLight = new THREE.DirectionalLight(tod.rimColor, tod.rim);
rimLight.position.set(
  Math.sin(rimAz) * Math.cos(rimEl) * 90,
  Math.sin(rimEl) * 90,
  Math.cos(rimAz) * Math.cos(rimEl) * 90
);
scene.add(rimLight);
// World-parked sky/ground hemisphere. This is NOT a camera fill - it does not
// move with the viewer - it is the ambient term that stops the shaded side of
// the bike collapsing to black mud while leaving the key/rim shaping intact.
const hemi = new THREE.HemisphereLight(tod.hemiSky, tod.hemiGround, tod.hemi);
hemi.position.set(0, 60, 0);
scene.add(hemi);

// ------------------------------------------------------------------ assets
const forcedEvent = params.get('event');
let seedValue = parseInt(params.get('seed') || '20260728', 10);
const bootRng = new RNG(seedValue);
const boot = { t0: performance.now() };
const T = buildTextures(quality === 'low' ? 'low' : quality === 'med' ? 'med' : 'ultra', maxAniso);
boot.textures = performance.now() - boot.t0;
const track = new Track(seedValue);
boot.track = performance.now() - boot.t0;
const mats = new Materials(T, scene.environment, 1.0);
mats.T = T;
const world = new World(scene, track, mats, T, { seed: seedValue, quality, lampsOn: tod.lampsOn, cloudTint: tod.cloud, cloudOp: tod.cloudOp });
boot.world = performance.now() - boot.t0;
const vfx = new VFX(scene, T, quality);
const crashRoot = new THREE.Group();
scene.add(crashRoot);
const skidTrail = new SkidRibbon(scene, mats.skid, 120);
const traffic = new TrafficSystem(scene, track, mats, { seed: seedValue + 17, max: quality === 'low' ? 5 : 9 });

// ------------------------------------------------------------------ racers
const RIVAL_DEFS = [
  { name: 'VIPER', paint: 0x0d8fb0, paint2: 0x1d2f42, trim: 0xd8e8f0, accent: 0x0b1520, leather: 0x14212c, helmet: 0xd8e8f0, stripe: 0x0d8fb0, suit: 0x155a70, aggro: 0.7, skill: 0.86, base: 69 },
  { name: 'HOWLER', paint: 0xc99a08, paint2: 0x33302a, trim: 0x1a1a1a, accent: 0x1a1508, leather: 0x2a2410, helmet: 0x1a1a1a, stripe: 0xc99a08, suit: 0x8a6c08, aggro: 0.85, skill: 0.74, base: 67 },
  { name: 'SABLE', paint: 0x2b2f38, paint2: 0x9c2a2e, trim: 0xc8ccd2, accent: 0x101216, leather: 0x14161a, helmet: 0x8a2226, stripe: 0xd0d0d0, suit: 0x8a2226, aggro: 0.6, skill: 0.92, base: 70 },
  { name: 'ROXY', paint: 0xb32458, paint2: 0x3a2c38, trim: 0xe0d6dc, accent: 0x1c0d15, leather: 0x241220, helmet: 0xcfc9cd, stripe: 0xb32458, suit: 0x7d1f42, aggro: 0.78, skill: 0.8, base: 68 },
  { name: 'GRIT', paint: 0x2f7d38, paint2: 0x2b3328, trim: 0xd8d2c0, accent: 0x0f1a10, leather: 0x16241a, helmet: 0x2a3a2c, stripe: 0x2f7d38, suit: 0x27622c, aggro: 0.92, skill: 0.68, base: 66 },
];

const racers = [];
const brains = new Map();

setBikeDetail({ ultra: 1, high: 0.92, med: 0.5, low: 0.14 }[quality] ?? 1);

const playerBike = createBike(mats, {
  paint: 0xaa0f18,
  paint2: 0x1b1f27,
  accent: 0x14161c,
  leather: 0x2b3038,
  helmet: 0x9aa3b0,
  stripe: 0xaa0f18,
  suit: 0xaa0f18,
  trim: 0xdfe3e8,
  numberTex: T.numbers[0],
});
scene.add(playerBike.group);
if (tod.head > 0) playerBike.parts.headlight.material.emissiveIntensity = 1.6;
const player = new Racer(track, playerBike, {
  isPlayer: true,
  s: 0,
  x: 2.6,
  v: 36,
  name: 'YOU',
  color: 0xd8262c,
  maxSpeed: 80,
  power: 1.04,
});
player.attachCrashRoot(crashRoot);
racers.push(player);

RIVAL_DEFS.forEach((d, i) => {
  const bike = createBike(mats, {
    paint: d.paint,
    paint2: d.paint2,
    trim: d.trim,
    accent: d.accent,
    leather: d.leather,
    helmet: d.helmet,
    suit: d.suit,
    stripe: d.stripe,
    numberTex: T.numbers[(i + 1) % T.numbers.length],
  });
  scene.add(bike.group);
  const r = new Racer(track, bike, {
    s: 14 + i * 12,
    x: (i % 2 === 0 ? 1 : -1) * (1.5 + (i % 3) * 1.7),
    v: 38,
    name: d.name,
    color: d.paint,
    maxSpeed: 78,
    power: 0.97 + i * 0.01,
    weapon: i === 1 || i === 3 ? 'CHAIN' : null,
  });
  r.attachCrashRoot(crashRoot);
  racers.push(r);
  brains.set(r, new RivalAI(r, { seed: seedValue + i * 31 + 7, aggression: d.aggro, skill: d.skill, baseSpeed: d.base }));
});

function attachWeapon(racer) {
  if (racer.weaponMesh || !racer.weapon) return;
  const chain = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const l = new THREE.TorusGeometry(0.036, 0.012, 4, 8);
    l.rotateY(i % 2 ? Math.PI / 2 : 0);
    l.translate(0, -i * 0.058, 0);
    chain.add(new THREE.Mesh(l, mats.chrome));
  }
  chain.position.set(0.05, -0.5, -0.2);
  racer.bike.parts.armR.add(chain);
  racer.weaponMesh = chain;
}
for (const r of racers) if (r.weapon) attachWeapon(r);

// ---------------------------------------------------------------- HUD/audio
const hud = new HUD(app, track);
const audio = new Audio();

// -------------------------------------------------------------------- cops
const cops = [];
function spawnCop() {
  if (cops.length >= 2) return null;
  const bike = createBike(mats, {
    paint: 0xd8dde4,
    paint2: 0x22407a,
    trim: 0x1e4fa8,
    suit: 0x14264d,
    accent: 0x10131a,
    leather: 0x0e1116,
    helmet: 0x12161c,
    stripe: 0x1e4fa8,
  });
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.13), mats.emissiveBlue.clone());
  blue.position.set(-0.12, 1.14, 0.74);
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.13), mats.emissiveRed.clone());
  red.position.set(0.12, 1.14, 0.74);
  bike.group.add(blue, red);
  bike.copLights = { blue, red };
  scene.add(bike.group);
  const r = new Racer(track, bike, {
    s: track.wrap(player.s - 48),
    x: player.x + 2,
    v: Math.max(player.v, 42),
    name: 'PATROL',
    color: 0x3b7de0,
    maxSpeed: 83,
    power: 1.06,
  });
  r.isCop = true;
  r.attachCrashRoot(crashRoot);
  racers.push(r);
  brains.set(r, new CopAI(r, { seed: seedValue + 777 }));
  cops.push(r);
  hud.callout('COPS', 'shake them off');
  audio.chime(false);
  return r;
}

// ------------------------------------------------------------------- input
const keys = new Set();
let userTookControl = false;
let started = false;

function firstGesture() {
  audio.resume();
  if (!started) {
    started = true;
    hud.dismissTitle();
  }
}

function onKey(e, down) {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (down) {
    keys.add(k);
    firstGesture();
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'x',
         'q', 'e', 'f', 'j', 'k', 'l', 'Shift', ' '].includes(k)) userTookControl = true;
    if (k === 'c') cycleCamera();
    if (k === 'p') (paused ? api.resume : api.pause)();
    if (k === 'm') audio.setMuted(!audio.muted);
  } else keys.delete(k);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
}
window.addEventListener('keydown', (e) => onKey(e, true));
window.addEventListener('keyup', (e) => onKey(e, false));
window.addEventListener('pointerdown', firstGesture);

// ------------------------------------------------------------------ camera
const CAMS = ['chase', 'hood', 'cinematic', 'orbit'];
let camMode = CAMS.includes(params.get('cam')) ? params.get('cam') : 'chase';
function cycleCamera() {
  camMode = CAMS[(CAMS.indexOf(camMode) + 1) % CAMS.length];
}

const orbitCfg = { pin: null, radius: 6.4, height: 2.2, fov: 44 };

const camState = {
  pos: new THREE.Vector3(0, 5, 14),  look: new THREE.Vector3(),
  roll: 0,
  fov: 62,
  shake: 0,
  lagX: 0,
  lagInit: false,
  cineT: 0,
  cineIdx: 0,
  init: false,
  punchDolly: 0,
  punchRoll: 0,
};

// Directed takedown camera. A rival going down is THE money shot of this genre
// and it cannot be left to the chase rig, which drives straight past it.
const takedownCam = { t: 0, victim: null };
const meleeCam = { t: 0, target: null };
// Worst-frame draw-call budget; the governor in step() defends this number.
const DRAW_BUDGET = 250;
let lod0Allow = 2;

const _idealPos = new THREE.Vector3();
const _cRight = new THREE.Vector3();
const _cUp = new THREE.Vector3();
const _idealLook = new THREE.Vector3();
const _shake = new THREE.Vector3();
const _camSm = { focus: new THREE.Vector3() };
const _camOff = new THREE.Vector3();
const _tmpA = new THREE.Vector3();
const _horizDir = new THREE.Vector3();
const _shTmp = new THREE.Vector3();
// tyre contact-patch offsets along the bike's longitudinal axis (bike.js:562-563)
const PATCH_Z = [-0.70, 0.70];

let boostPunch = 0;
let wasBoosting = false;
function updateCamera(dt) {
  const p = player;
  // FOV punch on boost *onset* only, decaying over ~0.4 s
  if (p.boosting && !wasBoosting) boostPunch = 1;
  wasBoosting = p.boosting;
  boostPunch = Math.max(0, boostPunch - dt * 2.5);
  const up = p.upW;
  const fwd = p.fwdW;
  const right = p.rightW;
  const speed01 = clamp(p.v / p.maxSpeed, 0, 1.15);

  let idealFov = 62;
  let fovRate = 9;
  let idealRoll = 0;
  let lagP = 7.5;
  let lagL = 10;

  if (p.crashed && camMode !== 'hood') {
    // The story of a crash is the rider AND the sliding bike, so frame both:
    // orbit a fixed-radius arc around their midpoint. The radius floor is what
    // keeps the lens out of the rider's legs.
    const a = 0.9 + p.crashT * 0.8;
    const hip = p.crashRig ? p.crashRig.riderPos : p.group.position;
    _camSm.focus.copy(hip).lerp(p.group.position, 0.5);
    const c = _camSm.focus;
    const sep = hip.distanceTo(p.group.position);
    _camOff
      .set(0, 0, 0)
      .addScaledVector(fwd, 2.2 + Math.sin(a) * 1.1)
      .addScaledVector(right, Math.cos(a) * 3.2)
      .addScaledVector(up, 1.05 + Math.sin(a * 0.6) * 0.5);
    const rad = clamp(3.9 + sep * 0.72, 4.0, 9.5);
    _camOff.setLength(rad);
    _idealPos.copy(c).add(_camOff);
    const roadY = p.pos.y;
    if (_idealPos.y < roadY + 1.05) _idealPos.y = roadY + 1.05;
    _idealLook.copy(c).addScaledVector(up, 0.22);
    idealFov = 46;
    lagP = 14;
    lagL = 20;
  } else if ((punchHold > 0 || meleeCam.t > 0) && (punchHoldTarget || meleeCam.target) && camMode !== 'hood' && camMode !== 'orbit') {
    // Directed melee framing: drop to shoulder height on the far side of the
    // strike so the extended arm is silhouetted against the rival's bodywork
    // instead of being hidden by the player's own back.
    const t = (punchHold > 0 ? punchHoldTarget : null) || meleeCam.target || punchHoldTarget;
    // Stand opposite the target so the swing crosses the lens; if that side
    // puts the low sun in frame, flip - a blown-out flare hides the punch.
    const pref = t.x > p.x ? -1 : 1;
    // Four candidate set-ups (trailing/leading x left/right). Score = how much
    // of the low sun ends up down the barrel, minus a bonus for standing on the
    // far side of the strike. A reverse angle beats a blown-out trailing one.
    let best = null;
    for (const fz of [-1, 1]) {
      for (const sd of [-1, 1]) {
        _tmpA.copy(fwd).multiplyScalar(fz * 2.35).addScaledVector(right, sd * 1.95).normalize().negate();
        // Leading (reverse) angle is near-mandatory for combat readability -
        // it must outweigh the sun term, not merely tie with it.
        const score = _tmpA.dot(sunDir) * 1.6 + (sd === pref ? -0.55 : 0) + (fz > 0 ? -3.0 : 0);
        if (!best || score < best.score) best = { fz, sd, score };
      }
    }
    const mid = _camSm.focus;
    mid.copy(p.pos).add(t.group.position).multiplyScalar(0.5).addScaledVector(up, 1.52);
    _idealPos
      .copy(mid)
      .addScaledVector(fwd, best.fz * 2.60)
      .addScaledVector(right, best.sd * 2.95)
      .addScaledVector(up, 2.05);
    const roadYp = p.pos.y;
    if (_idealPos.y < roadYp + 1.0) _idealPos.y = roadYp + 1.0;
    _idealLook.copy(mid);
    const blend = punchHold > 0 ? 1 : clamp(meleeCam.t / 0.22, 0, 1);
    idealFov = 41 + (1 - blend) * 33;
    fovRate = 24;
    idealRoll = -p.lean * 0.20;
    lagP = 16 + (1 - blend) * 8;
    lagL = 24;
  } else if (takedownCam.t > 0 && takedownCam.victim && camMode !== 'hood' && camMode !== 'orbit') {
    // Sit behind and above the falling rival, looking at them, with the player
    // riding away up-frame. 1.4 s hold, then hand back to the chase rig.
    const v = takedownCam.victim;
    const vp = v.crashRig ? v.crashRig.riderPos : v.group.position;
    const side = v.x > p.x ? 1 : -1;
    _camSm.focus.copy(vp).addScaledVector(v.upW, 0.45);
    _idealPos
      .copy(vp)
      .addScaledVector(v.fwdW, -5.2)
      .addScaledVector(v.rightW, side * 2.6)
      .addScaledVector(v.upW, 2.05);
    const roadY0 = v.pos.y;
    if (_idealPos.y < roadY0 + 1.1) _idealPos.y = roadY0 + 1.1;
    _idealLook.copy(_camSm.focus);
    idealFov = 54;
    fovRate = 24;
    lagP = 15;
    lagL = 22;
  } else if (camMode === 'hood') {
    // Rider's eyeline: BEHIND the bars, not out in front of the bodywork. The
    // frame must contain the cockpit - screen, mirrors, bars, gloved hands.
    _idealPos
      .copy(p.pos)
      // 1.80 m up / 0.02 m back is the only station that clears the rider's own
      // helmet and shoulders while still framing the tank, screen and mirrors.
      // Pulling back to a true eye point (1.64 / -0.42) puts the lens inside
      // the torso; dropping lower lets the tank eat the whole lower half.
      .addScaledVector(up, 1.8)
      .addScaledVector(fwd, -0.02)
      .addScaledVector(right, p.lean * 0.06);
    // The gloves sit 0.52 m ahead and 0.67 m below this eye point, i.e. 52 deg
    // below the optical axis. A level look target at 30 m put them a long way
    // outside a 38 deg half-FOV, which is why every hood capture so far has
    // been a floating drone shot. Pulling the aim point in to 7 m and 0.25 m
    // below the tarmac pitches the lens 15.6 deg down; 15.6 + 38 = 53.6 > 52,
    // so both hands sit just inside the bottom edge - and the extra asphalt in
    // frame is free road rush.
    _idealLook
      .copy(p.pos)
      .addScaledVector(fwd, 5.4)
      .addScaledVector(up, -0.62 - speed01 * 0.3);
    // world-space damping trails by velocity/rate; at 60 m/s anything below
    // ~40 leaves the camera metres behind the bike it is supposed to be on.
    idealFov = 68 + speed01 * 8 + (p.boosting ? 2 : 0);
    idealRoll = -p.lean * 0.52;
    lagP = 60;
    lagL = 30;
  } else if (camMode === 'orbit') {
    const a = orbitCfg.pin != null ? orbitCfg.pin : performance.now() * 0.00028;
    // hard guard: no orbit radius may put the near plane inside the bodywork
    const orad = Math.max(2.1, orbitCfg.radius);
    _idealPos
      .copy(p.pos)
      .addScaledVector(right, Math.cos(a) * orad)
      .addScaledVector(fwd, Math.sin(a) * orad)
      .addScaledVector(up, orbitCfg.height);
    _idealLook.copy(p.pos).addScaledVector(up, 0.85);
    idealFov = orbitCfg.fov;
    lagP = 13;
    lagL = 15;
  } else if (camMode === 'cinematic') {
    camState.cineT += dt;
    if (camState.cineT > 4.4) {
      camState.cineT = 0;
      camState.cineIdx = (camState.cineIdx + 1) % 4;
    }
    const c = p.pos;
    const k = camState.cineIdx;
    if (k === 0) {
      // low hero shot from in front, looking back down the bike
      _idealPos.copy(c).addScaledVector(fwd, 8.2).addScaledVector(right, -2.4).addScaledVector(up, 0.72);
      idealFov = 36;
    } else if (k === 1) {
      // tracking side pass, tank height
      _idealPos.copy(c).addScaledVector(right, 4.4).addScaledVector(fwd, 0.4).addScaledVector(up, 0.34);
      idealFov = 42;
    } else if (k === 2) {
      // over-the-shoulder trailing quarter
      _idealPos.copy(c).addScaledVector(fwd, -5.0).addScaledVector(right, 2.2).addScaledVector(up, 1.30);
      idealFov = 48;
    } else {
      // high crane looking down on the pack
      _idealPos.copy(c).addScaledVector(fwd, -8.0).addScaledVector(up, 4.2).addScaledVector(right, -3.2);
      idealFov = 42;
    }
    _idealLook.copy(c).addScaledVector(up, 0.92).addScaledVector(fwd, k === 0 ? -0.6 : 0.8);
    // never dip below the tarmac: a cinematic frame from under the road is a bug
    const roadY = track.sample(p.s, _camSm).pos.y;
    if (_idealPos.y < roadY + 0.42) _idealPos.y = roadY + 0.42;
    lagP = 34;
    lagL = 26;
  } else {
    // Chase cam damps its *basis* rather than its world position, so there is no
    // speed-dependent trailing: the rig stays glued at `back` metres at 250 km/h
    // just like it does at walking pace, but still swings smoothly through bends.
    // Drop and pull in as speed climbs: low camera + near ground plane is the
    // single biggest contributor to felt velocity.
    const back = lerp(4.35, 3.62, speed01);
    const height = lerp(1.86, 1.16, speed01);
    if (!camState.basisInit) {
      camState.basisInit = true;
      camState.fwd = fwd.clone();
      camState.up = up.clone();
    }
    const kb = 1 - Math.exp(-6.5 * dt);
    camState.fwd.lerp(fwd, kb).normalize();
    camState.up.lerp(up, 1 - Math.exp(-9 * dt)).normalize();
    _cRight.crossVectors(camState.fwd, camState.up).normalize();
    _cUp.crossVectors(_cRight, camState.fwd).normalize();
    // The lens trails the bike laterally instead of being welded to it, so a
    // steer reads as "I moved" rather than "the world slid sideways".
    if (!camState.lagInit) { camState.lagInit = true; camState.lagX = p.x; }
    camState.lagX = damp(camState.lagX, p.x, 3.6, dt);
    const driftX = clamp(p.x - camState.lagX, -1.6, 1.6);
    _idealPos
      .copy(p.pos)
      .addScaledVector(camState.fwd, -back)
      .addScaledVector(_cUp, height)
      .addScaledVector(_cRight, p.lean * 0.55 - driftX * 0.92);
    _idealLook
      .copy(p.pos)
      .addScaledVector(camState.fwd, 15 + speed01 * 13)
      .addScaledVector(_cRight, -driftX * 0.5)
      .addScaledVector(_cUp, 1.28 - speed01 * 0.22);
    idealFov = 62 + speed01 * 27 + boostPunch * 10;
    idealRoll = -p.lean * 0.3;
    lagP = 40;
    lagL = 40;
  }

  if (!camState.init) {
    camState.init = true;
    camState.pos.copy(_idealPos);
    camState.look.copy(_idealLook);
    camState.fov = idealFov;
  }
  camState.pos.lerp(_idealPos, 1 - Math.exp(-lagP * dt));
  camState.look.lerp(_idealLook, 1 - Math.exp(-lagL * dt));
  camState.fov = damp(camState.fov, idealFov, fovRate, dt);
  camState.roll = damp(camState.roll, idealRoll + camState.punchRoll, 8, dt);
  // impact dolly: a short shove of the lens toward the contact point
  if (camState.punchDolly > 0) {
    camState.pos.addScaledVector(fwd, camState.punchDolly);
    camState.punchDolly = Math.max(0, camState.punchDolly - dt * 0.55);
  }
  if (camState.punchRoll !== 0) camState.punchRoll = damp(camState.punchRoll, 0, 5, dt);

  camState.shake = Math.max(0, camState.shake - dt * 2.6);
  // above 120 km/h (33.3 m/s) a tight 18 Hz buzz gets layered on top of the
  // slow body roll - it is what sells "this thing is about to get away from me".
  const buzz = clamp((p.v - 28) / 28, 0, 1);
  const amp = clamp((p.v - 38) / 52, 0, 1) * 0.046 + p.offroad * 0.08 + camState.shake * 0.7;
  const tn = performance.now() * 0.001;
  const b18 = Math.sin(tn * 113.1) * buzz * 0.016;
  const b23 = Math.sin(tn * 146.6) * buzz * 0.011;
  _shake
    .set(
      Math.sin(tn * 37.1) * 0.5 + Math.sin(tn * 19.3) * 0.5,
      Math.sin(tn * 29.7) * 0.5 + Math.sin(tn * 13.1) * 0.5,
      Math.sin(tn * 41.3) * 0.4
    )
    .multiplyScalar(amp);
  _shake.x += b18;
  _shake.y += b23;
  _shake.z += b18 * 0.5;

  camera.position.copy(camState.pos).add(_shake);
  camera.up.copy(p.upW);
  camera.lookAt(camState.look);
  camera.rotateZ(camState.roll + _shake.z * 0.2);
  if (Math.abs(camera.fov - camState.fov) > 0.01) {
    camera.fov = camState.fov;
    camera.updateProjectionMatrix();
  }
}

// ------------------------------------------------------------------ combat
let timeScale = 1;
let hitStop = 0;
let slowmo = 0;
let flash = 0;
let damageFlash = 0;

const DUMMY = { s: 1e9, x: 1e9, crashed: true, hurt: () => false, name: '', v: 0 };

// Harness-only: after a forced player punch we hold the rivals off for a beat
// so the capture shows the player's HIT!, not a rival's counter overwriting it.
let aiMeleeLock = 0;
// Harness-only: holds the strike pose + the rival alongside for a forced punch,
// because under software GL a single frame can span the whole 0.5s swing.
let punchHold = 0;
let punchHoldTarget = null;
let punchHoldTick = 0;
// Harness-only: a forced jump lasts ~1.9s of sim, which under software GL can
// be a single frame. Holds the bike near apex so the capture is airborne.
let jumpHold = 0;

function attack(attacker, target, side) {
  if (!target || attacker.crashed || attacker.stamina < 0.16) return;
  if (target === player && attacker !== player && aiMeleeLock > 0) return;
  attacker.stamina -= 0.19;
  attacker.punchCooldown = 0.42;
  if (attacker === player || Math.abs(track.delta(attacker.s, player.s)) < 60) audio.punchWhoosh();
  // The hit resolves when the fist arrives, not when the button is pressed.
  attacker.bike.punch(side, () => resolveHit(attacker, target, side));
}

const WHACKS = ['WHACK!', 'SMACK!', 'CRUNCH!', 'BAM!', 'THWACK!'];
let whackN = 0;

function resolveHit(attacker, target, side) {
  if (!target || target.crashed || attacker.crashed) return;
  const ds = track.delta(target.s, attacker.s);
  const dx = target.x - attacker.x;
  if (Math.abs(ds) > 3.4 || Math.abs(dx) > 3.6 || Math.sign(dx) !== Math.sign(side)) return;
  const dmg = 0.17 + (attacker.weapon ? 0.19 : 0) + clamp(attacker.v - target.v, 0, 20) * 0.004;
  const down = target.hurt(dmg, dx > 0);
  if (target.bike) target.bike.state.hurt = 1;
  audio.punchHit();
  const hitPos = target.group.position.clone()
    .lerp(attacker.group.position, 0.42)
    .addScaledVector(target.upW, 1.44);
  vfx.impactFlash(hitPos, 1.9);
  vfx.sparks.emit(hitPos, attacker.rightW.clone().multiplyScalar(side).addScaledVector(attacker.upW, 0.9), 130, {
    speed: 24,
    life: 0.55,
    size: 0.36,
    color: [1.0, 0.92, 0.62],
  });
  vfx.rings.burst(hitPos, 0xffe6b0, 2.4, 0.40);
  vfx.rings.burst(hitPos, 0xff7a2a, 1.3, 0.30);
  // The rival has to visibly reel, or the hit reads as a particle effect that
  // happened to be near a bike.
  target.stagger = Math.min(1, target.stagger + 0.55);
  target.wobble = Math.min(1, target.wobble + 0.6);
  // 45 ms of hitstop is imperceptible; Burnout-class impact is ~110 ms with a
  // camera dolly toward the contact.
  hitStop = Math.max(hitStop, 0.17);
  if (attacker === player) {
    camState.shake = Math.max(camState.shake, 0.78);
    camState.punchDolly = 0.17;
    camState.punchRoll = 0.09 * side;
    meleeCam.target = target;
    meleeCam.t = 0.62;
    flash = 0.20;
    if (!down) hud.callout(WHACKS[(whackN++) % WHACKS.length], `${target.name} reeling`);
  }
  if (target === player) {
    camState.shake = Math.max(camState.shake, 0.62);
    damageFlash = 1;
    if (!down) hud.callout('OOF!', `${attacker.name} caught you`);
  }
  if (down) onTakedown(attacker, target);
}

function onTakedown(attacker, target) {
  const pos = target.group.position.clone();
  // The flash exists to punctuate the wreck, not to replace it. A 2.0 core
  // under bloom is a 400px fireball that erases the very thing the callout is
  // announcing - which is exactly how pass 2 shipped "an orange word".
  vfx.impactFlash(pos.clone().setY(pos.y + 0.9), 0.75);
  vfx.rings.burst(pos.clone().setY(pos.y + 0.55), 0xffb060, 2.1, 0.42);
  vfx.sparks.emit(pos, new THREE.Vector3(0, 0.45, 0), 110, { speed: 21, life: 0.62, size: 0.24 });
  vfx.dustPuff(pos.clone().setY(pos.y + 0.25), 8, 0.6);
  audio.impact(1.3);
  if (attacker === player) {
    hud.callout('TAKEDOWN', `${target.name} is down`);
    hitStop = 0.14;
    // 0.35x time for 0.55 s, then a 1.4 s directed hold on the victim. Pass 2
    // played `slowmo = 1.1` for 0.1 s of hitstop, which is imperceptible.
    slowmo = 0.55;
    takedownCam.t = 1.75;
    takedownCam.victim = target;
    camState.shake = 0.7;
    audio.chime(true);
    if (target.weapon && !player.weapon) {
      player.weapon = target.weapon;
      target.weapon = null;
      if (target.weaponMesh && target.weaponMesh.parent) target.weaponMesh.parent.remove(target.weaponMesh);
      target.weaponMesh = null;
      attachWeapon(player);
      hud.setWeapon(player.weapon);
    }
  } else if (target === player) {
    hud.callout('DOWN!', `${attacker.name} put you down`);
    damageFlash = 1;
    camState.shake = 0.9;
  }
}

function bust() {
  if (player.crashed) return;
  player.crash('busted');
  hud.callout('BUSTED', 'the law wins this one');
  damageFlash = 1;
  camState.shake = 1;
  audio.impact(1.4);
}

// ---------------------------------------------------------------- collision
function racerCollisions(dt) {
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      const a = racers[i];
      const b = racers[j];
      if (a.crashed || b.crashed) continue;
      const ds = track.delta(a.s, b.s);
      const dx = a.x - b.x;
      if (Math.abs(ds) < 2.0 && Math.abs(dx) < 1.2) {
        const push = (1.2 - Math.abs(dx)) * 26;
        const sgn = Math.sign(dx || 1);
        a.vx += sgn * push * dt * 10;
        b.vx -= sgn * push * dt * 10;
        if (Math.abs(a.v - b.v) > 9) {
          a.health = Math.max(0.05, a.health - 0.05 * dt);
          b.health = Math.max(0.05, b.health - 0.05 * dt);
        }
        if (a === player || b === player) camState.shake = Math.max(camState.shake, 0.12);
      }
    }
  }
}

function trafficCollisions() {
  for (const r of racers) {
    if (r.crashed) continue;
    const hit = traffic.checkHit(r);
    if (!hit) continue;
    const closing = hit.dir < 0 ? r.v + hit.v : Math.abs(r.v - hit.v);
    if (closing > 17) {
      r.crash('traffic');
      const p = r.group.position.clone();
      vfx.rings.burst(p, 0xffc080, 1.9, 0.45);
      vfx.sparks.emit(p, new THREE.Vector3(0, 0.5, 0), 40, { speed: 18, life: 0.6, size: 0.09 });
      if (r === player) {
        hud.callout('WIPEOUT', 'mind the traffic');
        camState.shake = 1;
        damageFlash = 1;
        audio.impact(1.5);
      }
    } else {
      r.vx += Math.sign(r.x - hit.x || 1) * 13;
      r.v *= 0.94;
    }
  }
}

function computePositions() {
  const sorted = racers.filter((r) => !r.isCop).sort((a, b) => b.totalS - a.totalS);
  sorted.forEach((r, i) => (r.position = i + 1));
}

// ------------------------------------------------------------------ effects
function updateEffects(dt) {
  const p = player;
  const braking = p.input.brake > 0.4 && p.v > 8;
  // Gate on actual slip AND actual motion. Pass 2 emitted a permanent blown
  // white plume at 0 km/h that swallowed the whole contact-shadow region.
  const burnout = p.input.throttle > 0.15 && p.v > 2.5 && p.v < 12 && p.slip > 0.08;
  if ((braking || burnout || p.slip > 0.6) && !p.crashed) {
    const back = p.pos.clone().addScaledVector(p.fwdW, -0.75).addScaledVector(p.upW, 0.16);
    vfx.smoke.emit(back, p.fwdW.clone().multiplyScalar(-p.v * 0.1), 2, {
      life: 0.9,
      size: 0.48,
      grow: 3.2,
      alpha: 0.2,
      color0: [0.8, 0.79, 0.8],
      color1: [0.34, 0.34, 0.36],
      jitter: 0.5,
    });
    skidTrail.push(back, p.rightW, 0.17, p.fwdW);
  }
  if (p.offroad > 0.4 && p.v > 6 && !p.crashed) {
    vfx.smoke.emit(p.pos.clone().addScaledVector(p.fwdW, -0.85), new THREE.Vector3(0, 1.3, 0), 2, {
      life: 1.2,
      size: 1.15,
      grow: 3.4,
      alpha: 0.36,
      color0: [0.7, 0.6, 0.45],
      color1: [0.4, 0.34, 0.26],
      jitter: 0.9,
    });
  }
  if (p.rpm > 0.82 && !p.crashed && Math.random() < 0.35) {
    vfx.smoke.emit(
      p.pos.clone().addScaledVector(p.fwdW, -1.05).addScaledVector(p.upW, 0.6),
      p.fwdW.clone().multiplyScalar(-7),
      1,
      { life: 0.32, size: 0.42, grow: 3, alpha: 0.09, color0: [0.92, 0.88, 0.82], color1: [0.6, 0.6, 0.6], jitter: 0.2 }
    );
  }

  let scrapeAmt = 0;
  for (const r of racers) {
    if (!r.crashed || !r.scraping || r.v < 3) continue;
    const p2 = r.group.position.clone();
    // 0.05 m sparks subtend ~4 px at 12 m. A scraping wreck is one of the
    // loudest images in the genre; it needs to be legible from the chase cam.
    vfx.sparks.emit(p2, r.fwdW.clone().multiplyScalar(-1), 14, {
      speed: 10 + r.v * 0.45,
      life: 0.5,
      size: 0.22,
      spread: 1.3,
      color: [1.0, 0.76, 0.3],
    });
    if (Math.random() < 0.55) vfx.dustPuff(p2, 2, 0.42);
    if (Math.random() < 0.4)
      vfx.smoke.emit(p2, new THREE.Vector3(0, 0.6, 0), 1, {
        life: 0.7,
        size: 0.75,
        grow: 2.6,
        alpha: 0.2,
        color0: [0.72, 0.7, 0.68],
        color1: [0.4, 0.4, 0.4],
      });
    if (r === player) scrapeAmt = clamp(r.v / 24, 0, 1);
  }
  audio.scrape(scrapeAmt);

  vfx.shadows.begin();
  const sm = {};
  for (const r of racers) {
    if (r.crashed) {
      // A crashed rider and the sliding bike still need ground contact, or the
      // tumbling body reads as a decal floating over the asphalt.
      if (r.crashRig) {
        _shTmp.copy(r.crashRig.riderPos).sub(r.pos);
        const hAbove = _shTmp.dot(r.upW);
        const sc = clamp(1.5 - hAbove * 0.42, 0.7, 1.6);
        vfx.shadows.add(
          _shTmp.copy(r.crashRig.riderPos).addScaledVector(r.upW, -hAbove + 0.05).clone(),
          r.rightW, r.fwdW, sc, sc * 1.2,
          clamp(0.62 - hAbove * 0.14, 0.12, 0.62)
        );
      }
      vfx.shadows.add(r.pos.clone().addScaledVector(r.upW, 0.04), r.rightW, r.fwdW, 1.4, 2.4, 0.5);
      continue;
    }
    // Broad ambient-occlusion pool for the whole machine...
    const air = clamp(1 - r.h * 1.4, 0, 1);
    vfx.shadows.add(
      r.pos.clone().addScaledVector(r.upW, 0.035 - r.h),
      r.rightW, r.fwdW, 1.5, 2.9, 0.30 * air
    );
    // ...plus a tight, dark decal at each tyre contact patch. This is the cue
    // that actually says "on the ground" - the cascade cannot resolve it.
    if (r === player || r.lodLevel === 0) {
      for (const dz of PATCH_Z) {
        vfx.shadows.add(
          _shTmp.copy(r.pos).addScaledVector(r.upW, 0.03 - r.h).addScaledVector(r.fwdW, dz).clone(),
          r.rightW, r.fwdW, 0.44, 0.66, 0.82 * air
        );
      }
    }
  }
  for (const c of traffic.active) {
    track.sample(c.s, sm);
    vfx.shadows.add(
      sm.pos.clone().addScaledVector(sm.right, c.x).addScaledVector(sm.up, 0.04),
      sm.right,
      sm.fwd,
      2.7,
      c.kind === 'truck' ? 6.6 : 5.2
    );
  }
  vfx.shadows.end();
  void dt;
}

// --------------------------------------------------------------------- loop
let raceTime = 0;
let paused = false;
// Frame instrumentation. The measurement path must NEVER see the clamped
// simulation delta: accumulating clamped time makes the reported frame rate
// mathematically incapable of dropping below 1/clampCeiling, which turns the
// counter into a liar exactly when you need it most.
let frames = 0;
let fpsAccum = 0;      // wall-clock seconds, unclamped
let fps = 60;
let hitches = 0;       // frames slower than 33.3 ms since load
let totalFrames = 0;
let p99Ms = 0;
let maxMs = 0;
const frameLog = new Float32Array(240);
let frameLogI = 0;
let frameLogN = 0;
let last = performance.now();
// Fixed simulation timestep (120Hz) decoupled from render rate.
const SIM_DT = 1 / 120;
const SIM_MAX_STEPS = 8;
let simAcc = 0;
let shadowTick = 0;
let readySignalled = false;
let lastCalls = 0;
let lastTris = 0;
const LAPS = 3;

const attractBrain = new RivalAI(player, { seed: 5, aggression: 0.72, skill: 0.86, baseSpeed: 70 });

function nearestTarget(side) {
  let best = null;
  let bestD = 99;
  for (const r of racers) {
    if (r === player || r.crashed) continue;
    const ds = Math.abs(track.delta(r.s, player.s));
    const dx = r.x - player.x;
    if (Math.sign(dx) !== side) continue;
    if (ds < 3.4 && Math.abs(dx) < 4.2 && ds < bestD) {
      bestD = ds;
      best = r;
    }
  }
  return best || DUMMY;
}

const ctx = { track, player, racers, traffic, attack, bust };

function readInput(dt) {
  const p = player;
  if (!userTookControl) {
    attractBrain.update(dt, ctx);
    return;
  }
  p.input.throttle = keys.has('ArrowUp') || keys.has('w') ? 1 : 0;
  p.input.brake = keys.has('ArrowDown') || keys.has('s') || keys.has('x') ? 1 : 0;
  // WASD must steer. Previously 'w' accelerated while 'a'/'d' punched, so
  // anyone who assumed WASD held W+A, punched the air, and concluded the bike
  // could not steer at all. Attacks moved to dedicated keys.
  p.input.steer =
    (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) -
    (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0);
  // Space is the signature action in every game on this site (nitro / boost /
  // plunger). It used to be unused here while nitro hid on Shift.
  p.input.boost = keys.has(' ') || keys.has('Shift');
  if (p.punchCooldown <= 0) {
    if (keys.has('q') || keys.has('j')) attack(p, nearestTarget(-1), -1);
    else if (keys.has('e') || keys.has('l')) attack(p, nearestTarget(1), 1);
    else if (keys.has('f') || keys.has('k')) {
      p.bike.kick();
      p.punchCooldown = 0.5;
      const side = p.x > 0 ? -1 : 1;
      const t = nearestTarget(side);
      if (t !== DUMMY) attack(p, t, side);
    }
  }
}

function step(dt) {
  raceTime += dt;
  if (aiMeleeLock > 0) aiMeleeLock -= dt;
  if (jumpHold > 0) {
    jumpHold -= dt;
    player.airborne = true;
    if (player.h < 1.25) player.h = 1.25;
    if (player.vy < -1.2) player.vy = -1.2;
  }
  if (punchHold > 0) {
    punchHold -= dt;
    const t = punchHoldTarget;
    if (t && !t.crashed) {
      t.s = track.wrap(player.s + 0.5);
      t.x = player.x + 1.15;
      t.v = player.v;
    }
  }
  readInput(dt);

  if (player.railBang > 0.05 && !player.crashed) {
    const k = player.railBang;
    const railPos = player.group.position.clone()
      .addScaledVector(player.rightW, Math.sign(player.x) * 0.55)
      .addScaledVector(player.upW, 0.35);
    vfx.sparks.emit(railPos, player.rightW.clone().multiplyScalar(-Math.sign(player.x)).addScaledVector(player.upW, 0.5), 40 + k * 60, {
      speed: 16, life: 0.4, size: 0.22, color: [1.0, 0.82, 0.45],
    });
    camState.shake = Math.max(camState.shake, 0.22 + k * 0.3);
    audio.impact(0.35 + k * 0.4);
    player.railBang = 0;
  }

  for (const r of racers) {
    const brain = brains.get(r);
    if (brain && r !== player) brain.update(dt, ctx);
    r.update(dt);
  }

  // ---- draw-call governor ------------------------------------------------
  // A machine is ~36 meshes and it is drawn three times (beauty + two shadow
  // cascades), so every rival held at full detail costs ~108 calls. The budget
  // has to survive the *worst* frame - a takedown, where the camera is 2.4 m
  // from two bikes at once - not the average one. So detail is granted, not
  // assumed: rivals are sorted by distance and the closest N get LOD0, where N
  // is driven by the previous frame's measured call count against the budget.
  {
    const near = [];
    for (const r of racers) {
      if (r === player || !r.bike || !r.bike.setLOD) continue;
      near.push([camera.position.distanceTo(r.group ? r.group.position : r.pos), r]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const calls = renderer.info.render.calls;
    if (calls > DRAW_BUDGET) lod0Allow = Math.max(0, lod0Allow - 1);
    else if (calls < DRAW_BUDGET - 90) lod0Allow = Math.min(2, lod0Allow + 1);
    const cut = quality === 'low' ? 7 : quality === 'med' ? 10 : 13;
    for (let i = 0; i < near.length; i++) {
      const [d, r] = near[i];
      // A downed machine is a tumbling wreck trailing sparks; nobody reads its
      // chain links, and the takedown camera is the tightest draw-call frame
      // in the game, so a crashed rival never gets the detailed rig.
      const wrecked = r.crashed || r.down || r.downed;
      // A rival being punched is the subject of a directed close-up: it keeps
      // the animated rig no matter what the budget says, because a merged
      // static proxy cannot flinch.
      const starring = r === meleeCam.target || r === takedownCam.victim;
      r.lodLevel = starring || (!wrecked && d <= cut && i < lod0Allow) ? 0 : 1;
      r.bike.setLOD(r.lodLevel);
    }
    if (player.bike && player.bike.setLOD) player.bike.setLOD(0);
  }
  racerCollisions(dt);
  trafficCollisions();

  // Pose pinning for the harness `punch` event has to run AFTER the rig update
  // or the animation code overwrites it on the same frame.
  if (punchHold > 0) {
    const st = player.bike.state;
    st.hold = true;
    st.punchR = 0.80; // exact pose peak of the front-loaded swing curve
    player.bike.update(0.016, { speed: player.v, steer: player.steer, lean: player.lean, tuck: player.tuck });
    const t = punchHoldTarget;
    if (t && !t.crashed && t.bike) {
      // rival recoils away from the blow: head snapped, torso rolled 0.42 rad
      t.bike.state.hurt = 1;
      t.bike.update(0.016, { speed: t.v, steer: t.steer, lean: 0.62, tuck: 0 });
      punchHoldTick -= dt;
      if (punchHoldTick <= 0) {
        punchHoldTick = 0.26;
        const hp = t.group.position.clone().lerp(player.group.position, 0.34).addScaledVector(t.upW, 1.44);
        vfx.sparks.emit(hp, player.rightW.clone().addScaledVector(player.upW, 1.0), 24, {
          speed: 36,
          life: 0.30,
          size: 0.30,
          color: [1.0, 0.86, 0.58],
        });
        vfx.rings.burst(hp, 0xffd9a0, 1.55, 0.42);
      }
    }
  } else if (player.bike.state.hold) {
    player.bike.state.hold = false;
  }
  traffic.update(dt, player.s, player.v);

  if (player.gearChanged && player.gear > player.prevGear) audio.gearShift();

  computePositions();
  mats.wind.value = raceTime;
  world.update(player.s, QUALITY[quality].viewFwd, 190, camera.position, raceTime);
  updateEffects(dt);

  for (const c of cops) {
    if (!c.bike.copLights) continue;
    const t2 = performance.now() * 0.007;
    c.bike.copLights.blue.material.emissiveIntensity = 1.5 + 9 * Math.max(0, Math.sin(t2));
    c.bike.copLights.red.material.emissiveIntensity = 1.5 + 9 * Math.max(0, Math.sin(t2 + Math.PI));
  }

  // Snap the wide shadow focus to texel centres so the map doesn't crawl as
  // the player moves; without this a 155 m cascade shimmers on every edge.
  const focus = player.pos.clone().addScaledVector(player.fwdW, SHADOW_EXT * 0.48);
  const texel = (SHADOW_EXT * 2) / QUALITY[quality].shadow;
  focus.x = Math.round(focus.x / texel) * texel;
  focus.z = Math.round(focus.z / texel) * texel;
  focus.y = Math.round(focus.y / texel) * texel;
  sun.position.copy(focus).addScaledVector(sunDir, 420);
  sun.target.position.copy(focus);
  sun.target.updateMatrixWorld();

  const hf = player.pos;
  if (headLight.visible) {
    headLight.position.copy(player.pos).addScaledVector(player.upW, 0.86).addScaledVector(player.fwdW, 0.55);
    headLight.target.position.copy(player.pos).addScaledVector(player.fwdW, 34).addScaledVector(player.upW, -0.4);
    headLight.target.updateMatrixWorld();
  }
  heroShadow.position.copy(hf).addScaledVector(sunDir, 40);
  heroShadow.target.position.copy(hf);
  heroShadow.target.updateMatrixWorld();

  audio.updateEngine(player.rpm, player.input.throttle, clamp(player.v / 80, 0, 1), player.v);
  audio.updateWind(player.v);
  audio.updateScreech(player.crashed ? 0 : player.slip, player.v);
  const near = racers
    .filter((r) => r !== player && !r.isCop)
    .map((r) => ({ r, d: Math.abs(track.delta(r.s, player.s)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  near.forEach((n, i) => audio.updateRival(i, n.r.rpm, n.d, player.v - n.r.v));
  for (let i = near.length; i < 3; i++) audio.updateRival(i, 0, 999, 0);
  audio.updateSiren(cops.length > 0, cops.length ? Math.abs(track.delta(cops[0].s, player.s)) : 999);

  if (player.lapJustChanged && player.lap <= LAPS) {
    hud.callout(`LAP ${player.lap}`, `${LAPS - player.lap + 1} to go`);
    audio.chime(true);
  }
  if (player.lap > LAPS && !player.finished) {
    player.finished = true;
    hud.callout(player.position === 1 ? 'WINNER' : `P${player.position}`, 'race complete');
    audio.chime(player.position === 1);
  }

  if (!cops.length && raceTime > 40 && player.v > 52 && Math.random() < dt * 0.35) spawnCop();
}

const _camDir = new THREE.Vector3();

let bootClock = 0;
// Wall-clock scheduler. setTimeout is starved on software GL where a single
// frame can block the main thread for >10 s, which silently swallowed forced
// events and left the title card up in captures.
const pendingTimed = [];
function render(now) {
  const wallDt = Math.max(0.0001, (now - last) / 1000);
  const rawDt = Math.min(0.05, Math.max(0.0005, wallDt));
  last = now;
  bootClock += wallDt;
  if (bootClock > 1.6) hud.dismissTitle(bootClock > 2.4);
  for (let i = pendingTimed.length - 1; i >= 0; i--) {
    if (bootClock >= pendingTimed[i].t) {
      const job = pendingTimed.splice(i, 1)[0];
      try { job.fn(); } catch (e) { console.warn('timed job failed', e); }
    }
  }
  renderer.info.autoReset = false;
  renderer.info.reset();
  // Refresh the shadow map on a cadence rather than every frame (see boot).
  shadowTick++;
  renderer.shadowMap.needsUpdate = shadowTick % 3 === 0;
  // measurement uses wallDt; simulation uses the clamped rawDt
  fpsAccum += wallDt;
  frames++;
  totalFrames++;
  const ms = wallDt * 1000;
  if (ms > 33.34) hitches++;
  if (ms > maxMs) maxMs = ms;
  frameLog[frameLogI] = ms;
  frameLogI = (frameLogI + 1) % frameLog.length;
  if (frameLogN < frameLog.length) frameLogN++;
  if (fpsAccum > 0.4) {
    fps = frames / fpsAccum;
    frames = 0;
    fpsAccum = 0;
    const w = Array.prototype.slice.call(frameLog, 0, frameLogN).sort((a, b) => a - b);
    p99Ms = w.length ? w[Math.min(w.length - 1, Math.floor(w.length * 0.99))] : 0;
  }

  if (!paused) {
    let ts = 1;
    if (hitStop > 0) {
      hitStop -= rawDt;
      ts = 0.06;
    } else if (slowmo > 0) {
      slowmo -= rawDt;
      ts = lerp(0.35, 1, Math.pow(clamp(1 - slowmo / 0.55, 0, 1), 0.6));
    }
    timeScale = damp(timeScale, ts, 22, rawDt);
    // Fixed-timestep accumulator. Previously step() was fed the clamped frame
    // delta directly, so any frame slower than 1/20s silently ran the whole
    // simulation in slow motion instead of dropping steps -- which is what made
    // the game feel laggy AND unresponsive at the same time.
    simAcc += rawDt * timeScale;
    let subSteps = 0;
    while (simAcc >= SIM_DT && subSteps < SIM_MAX_STEPS) {
      step(SIM_DT);
      simAcc -= SIM_DT;
      subSteps++;
    }
    // Long stall (tab restore, shader compile): drop the backlog rather than
    // spiral-of-death through hundreds of catch-up steps.
    if (simAcc > SIM_DT * SIM_MAX_STEPS) simAcc = 0;
  }

  if (meleeCam.t > 0) {
    meleeCam.t -= rawDt;
    if (meleeCam.t <= 0) meleeCam.target = null;
  }
  if (takedownCam.t > 0) {
    takedownCam.t -= rawDt;
    if (takedownCam.t <= 0) takedownCam.victim = null;
  }

  updateCamera(rawDt);
  sky.position.copy(camera.position);
  sunSprite.position.copy(camera.position).addScaledVector(sunDir, 6000);
  sunSprite.quaternion.copy(camera.quaternion);
  camera.getWorldDirection(_camDir);
  vfx.update(rawDt * timeScale, camera.position, _camDir, player.v, player.crashed ? 0.25 : 1);

  flash = Math.max(0, flash - rawDt * 1.6);
  damageFlash = Math.max(0, damageFlash - rawDt * 1.5);

  hud.update(
    {
      speedKph: player.v * 3.6,
      rpm: player.rpm,
      gear: player.gear,
      position: player.position || 1,
      racers: racers.filter((r) => !r.isCop).length,
      lap: player.lap,
      laps: LAPS,
      time: raceTime,
      health: player.health,
      stamina: player.stamina,
      boost: player.boost,
      boosting: player.boosting,
      damageFlash,
      playerFrac: player.lapProgress,
      rivalFracs: racers.filter((r) => r !== player).map((r) => ({ f: r.lapProgress, cop: r.isCop })),
    },
    rawDt
  );

  if (post) {
    const speed01 = clamp((player.v - 22) / 62, 0, 1);
    const stat = camMode === 'orbit' ? 0.12 : camMode === 'cinematic' ? 0.55 : 1;
    // Screen Y of the true horizon, used by the grade pass as its distance
    // proxy for motion blur and speed slivers.
    camera.getWorldDirection(_horizDir);
    _horizDir.y = 0;
    if (_horizDir.lengthSq() < 1e-6) _horizDir.set(0, 0, -1);
    _horizDir.normalize().multiplyScalar(9000).add(camera.position);
    _horizDir.project(camera);
    post.setParams({
      uHorizon: clamp(_horizDir.y * 0.5 + 0.5, 0.02, 0.98),
      uBlur: (0.004 + speed01 * 0.050) * (player.boosting ? 1.25 : 1) * stat,
      uSpeed: clamp((player.v - 16) / 36, 0, 1) * stat * (player.crashed ? 0.2 : 1),
      uCA: 0.00040 + speed01 * 0.00085,
      uVignette: 0.62,
      uGrain: quality === 'low' ? 0.022 : 0.032,
      uDamage: damageFlash * 0.62,
      uFlash: flash,
      uSlowmo: clamp(slowmo, 0, 1),
      uExposure: EXPOSURE,
      uSat: 1.46,
      uContrast: 1.12,
      uWarm: tod.grade.warm,
      uTeal: tod.grade.teal,
    });
    post.render(rawDt);
  } else {
    renderer.render(scene, camera);
  }

  if (!readySignalled) {
    readySignalled = true;
    window.__READY__ = true;
  }
  lastCalls = renderer.info.render.calls;
  lastTris = renderer.info.render.triangles;
  requestAnimationFrame(render);
}

// ---------------------------------------------------------------- resizing
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pr = QUALITY[quality].pr;
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (post) post.setSize(Math.floor(w * pr), Math.floor(h * pr));
}

// ------------------------------------------------------------------ postfx
let post = QUALITY[quality].post ? new PostFX(renderer, scene, camera, quality) : null;
window.addEventListener('resize', onResize);
onResize();

// -------------------------------------------------------------- public API
function resetRace(seed) {
  seedValue = seed >>> 0;
  racers.forEach((r, i) => {
    if (r.crashed) r.remount();
    r.s = i === 0 ? 0 : 14 + i * 12;
    r.totalS = r.s;
    r.x = i === 0 ? 2.6 : (i % 2 === 0 ? 1 : -1) * (1.5 + (i % 3) * 1.7);
    r.v = 36;
    r.vx = 0;
    r.health = 1;
    r.stamina = 1;
    r.lap = 1;
    r.finished = false;
    r.sync(0);
  });
  raceTime = 0;
  camState.init = false;
}

const api = {
  setCamera(name) {
    if (CAMS.includes(name)) camMode = name;
  },
  pause() {
    paused = true;
  },
  resume() {
    paused = false;
    last = performance.now();
  },
  seed(n) {
    resetRace(n);
  },
  forceEvent(name) {
    if (name === 'punch') {
      // A forced punch has to LAND, or the capture is a picture of a man
      // riding in a straight line. Pull the nearest rival alongside first.
      let t = nearestTarget(1);
      if (t === DUMMY) {
        t = racers.find((r) => r !== player && !r.crashed && !r.isCop) || racers[1];
      }
      // Park the target squarely inside the strike box so the swing connects
      // even if the AI had drifted a lane away between the call and the frame.
      t.s = track.wrap(player.s + 0.5);
      t.x = player.x + 1.15;
      t.v = player.v;
      t.health = Math.max(t.health, 0.55);
      t.sync(0);
      player.stamina = 1;
      player.punchCooldown = 0;
      aiMeleeLock = 2.2;
      attack(player, t, 1);
      punchHold = 6.0;
      punchHoldTarget = t;
      punchHoldTick = 0;
      camState.shake = Math.max(camState.shake, 0.55);
    } else if (name === 'takedown') {
      const t = racers.find((r) => r !== player && !r.crashed && !r.isCop) || racers[1];
      t.s = track.wrap(player.s + 2.2);
      t.x = player.x + 1.9;
      t.v = player.v;
      t.sync(0);
      t.health = 0;
      t.crash('beaten');
      onTakedown(player, t);
      t.crashHold = true;
      takedownCam.t = 6.0; // long hold so a 4 s harness capture lands inside it
    } else if (name === 'crash') {
      player.crash('forced');
      camState.shake = 1;
      damageFlash = 1;
      audio.impact(1.5);
    } else if (name === 'cop') {
      const c = spawnCop();
      // Default spawn is 48m behind, which a forward chase cam never sees.
      // For a forced capture, pull the patrol bike up alongside the player.
      if (c) {
        c.s = track.wrap(player.s + 5.5);
        c.x = player.x - 2.4;
        c.v = player.v;
        c.sync(0);
      }
      hud.callout('COPS', 'Patrol on your tail');
    } else if (name === 'jump') {
      player.airborne = true;
      player.vy = 9.5;
      player.h = 0.25;
      jumpHold = 2.6;
      hud.callout('AIRBORNE', 'crest launch');
    }
  },
  // Harness hook for the speed-readability A/B: pins the player to an exact
  // km/h so a 40 and a 160 frame can be compared with the HUD masked.
  setSpeed(kmh) {
    player.v = Math.max(0, kmh) / 3.6;
    player.pinnedV = Math.max(0, kmh) / 3.6;
  },
  setQuality(tier) {
    if (!QUALITY[tier] || tier === quality) return;
    quality = tier;
    sun.shadow.mapSize.set(QUALITY[tier].shadow, QUALITY[tier].shadow);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
    post = QUALITY[tier].post ? new PostFX(renderer, scene, camera, tier) : null;
    onResize();
  },
  get racers() {
    return racers;
  },
  // Inspection helper: pin the orbit camera to an exact angle/radius/height.
  orbit(angleDeg, radius, height, fov) {
    camMode = 'orbit';
    orbitCfg.pin = angleDeg == null ? null : (angleDeg * Math.PI) / 180;
    if (radius != null) orbitCfg.radius = radius;
    if (height != null) orbitCfg.height = height;
    if (fov != null) orbitCfg.fov = fov;
    camState.init = false;
  },
};
window.__GAME__ = api;
window.__STATS__ = () => ({
  fps: Math.round(fps * 10) / 10,
  frameMsP99: Math.round(p99Ms * 10) / 10,
  frameMsMax: Math.round(maxMs * 10) / 10,
  hitches,
  totalFrames,
  drawCalls: lastCalls,
  triangles: lastTris,
  quality,
  timeOfDay: TOD_NAME,
  boot,
});
window.__SCENE__ = { THREE, scene, renderer, camera, mats, T, track, world, sun, heroShadow, hemi, rimLight, bounce, get tod() { return tod; }, todName: TOD_NAME, get camMode() { return camMode; }, get post() { return post; }, racers, player, audio, hud, vfx, takedownCam };

// ?event=punch|takedown|crash|cop|jump - fires after an 8 s warm-up so the pack
// has actually closed up and the frame shows the event in context.
const pinKmh = parseFloat(params.get('kmh'));
if (Number.isFinite(pinKmh)) pendingTimed.push({ t: 0.9, fn: () => api.setSpeed(pinKmh) });

if (forcedEvent) {
  const evDelay = parseFloat(params.get('evdelay') || '8');
  pendingTimed.push({
    t: evDelay,
    fn: () => {
      try { api.forceEvent(forcedEvent); } catch (e) { console.warn('forceEvent failed', e); }
    },
  });
}

if (window.__SHOT__) hud.dismissTitle(true);

// ?orbit=deg,radius,height,fov - reproducible hero-asset inspection angle.

const orbitArg = params.get('orbit');
if (orbitArg) {
  const [a, r, h, f] = orbitArg.split(',').map(parseFloat);
  pendingTimed.push({
    t: 0.4,
    fn: () => api.orbit(
      Number.isFinite(a) ? a : 0,
      Number.isFinite(r) ? r : undefined,
      Number.isFinite(h) ? h : undefined,
      Number.isFinite(f) ? f : undefined,
    ),
  });
}

world.update(player.s, QUALITY[quality].viewFwd, 190, camera.position, raceTime);
traffic.update(0.016, player.s, player.v);
void bootRng;

// Compile every shader program up front. Three.js otherwise compiles lazily on
// first render of each material, so the opening seconds of play stutter once
// per new object type entering view (67 programs = 67 stalls). This is the
// single biggest cause of the "lag" felt on real hardware.
//
// The scene is rendered INTO the composer's HalfFloat target, where the
// renderer's output colour space is linear-sRGB rather than the sRGB of the
// default framebuffer. Compiling with no target bound therefore warmed the
// wrong variant of every program and the real ones were compiled again on the
// first frame — an exact 2x on the program count. Bind the target first.
// Three.js renders every transparent DoubleSide material in TWO passes, and it
// does so by mutating material.side to BackSide and then FrontSide around each
// draw. Each of those states is a separate shader permutation, so one such
// material silently costs three compiled programs (DoubleSide from the
// precompile, plus BackSide and FrontSide from the first frame) and two draw
// calls per object. forceSinglePass collapses all of that; on foliage cards,
// light cones and decals — which are additive or depth-write-off anyway — the
// two-pass sort buys nothing visible.
{
  let singlePassed = 0;
  scene.traverse((o) => {
    const m = o.material;
    if (!m) return;
    for (const mm of Array.isArray(m) ? m : [m]) {
      if (mm.transparent && mm.side === THREE.DoubleSide && !mm.forceSinglePass) {
        mm.forceSinglePass = true;
        singlePassed++;
      }
    }
  });
  void singlePassed;
}

if (post) renderer.setRenderTarget(post.rt);
renderer.compile(scene, camera);
renderer.setRenderTarget(null);
if (post) post.precompile();

// The shadow camera follows the player, but 347 casters re-projected every
// frame doubles the scene's geometry cost for detail no one can resolve in
// motion. Refresh on a cadence instead.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;

// Don't burn CPU/GPU (or accumulate a simulation backlog) in a hidden tab.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    paused = true;
  } else {
    paused = false;
    last = performance.now();
    simAcc = 0;
  }
});

requestAnimationFrame(render);
