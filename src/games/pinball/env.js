/**
 * Procedural environment: a dark arcade room with warm practical lights.
 * Rendered once through PMREMGenerator so the chrome ball, rails and plastics
 * have something real to reflect. This is what sells the metal.
 */

import * as THREE from 'three';
import { Q } from './quality.js';
import { makeArcadeCarpet } from './art.js';

function emissivePlane(w, h, color, intensity) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide })
  );
  return m;
}

export function buildEnvScene() {
  const s = new THREE.Scene();

  // room shell — very dark, slightly blue
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(14, 6.4, 18),
    new THREE.MeshStandardMaterial({ color: 0x0a0d11, roughness: 0.92, metalness: 0, side: THREE.BackSide })
  );
  room.position.y = 2.0;
  s.add(room);

  // ceiling gradient wash
  const ceil = emissivePlane(14, 18, 0x1e2a36, 0.26);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = 5.15;
  s.add(ceil);

  // floor — dark carpet with a faint sheen
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 18),
    new THREE.MeshStandardMaterial({ color: 0x10141a, roughness: 0.55, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.2;
  s.add(floor);

  // warm overhead practicals (the classic arcade tube lights)
  const tubeCols = [0xffeccb, 0xffdca8, 0xffd096];
  for (let i = 0; i < 5; i++) {
    const t = emissivePlane(0.34, 5.2, tubeCols[i % 3], 14 - i * 1.1);
    t.rotation.x = Math.PI / 2;
    t.position.set(-4.2 + i * 2.1, 4.6, -1.4 + (i % 2) * 1.2);
    s.add(t);
  }

  // Service strips along the bay walls. Space Cadet is a naval space-station
  // deck, not a nightclub: amber sodium, a red port marker and one cold white
  // gantry tube. No cyan, no magenta.
  const neons = [
    { c: 0xffb057, i: 9, p: [-6.6, 1.9, -3.4], r: [0, Math.PI / 2, 0], w: 0.12, h: 7.4 },
    { c: 0xc8422a, i: 7, p: [6.6, 2.4, -1.0], r: [0, -Math.PI / 2, 0], w: 0.12, h: 7.4 },
    { c: 0x8fa8bd, i: 7, p: [0, 3.4, -8.6], r: [0, 0, 0], w: 9.5, h: 0.13 },
    { c: 0xffa22a, i: 8, p: [0, 0.6, -8.6], r: [0, 0, 0], w: 9.5, h: 0.1 },
    { c: 0xffb877, i: 3, p: [-3.2, 0.2, 8.4], r: [0, Math.PI, 0], w: 5.0, h: 0.12 },
  ];
  for (const n of neons) {
    const m = emissivePlane(n.w, n.h, n.c, n.i);
    m.position.set(...n.p);
    m.rotation.set(...n.r);
    s.add(m);
  }

  // a bank of other cabinets glowing in the background
  for (let i = 0; i < 7; i++) {
    // amber / green console glow, the colours a 90s ops room actually had
    const c = new THREE.Color(i % 3 === 1 ? 0x8fb0c8 : 0xffab46);
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 1.9, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x0e1018, roughness: 0.5, metalness: 0.2 })
    );
    cab.position.set(-5.4 + i * 1.8, 0.0, -7.4);
    s.add(cab);
    const scr = emissivePlane(0.62, 0.86, c, 3.0);
    scr.position.set(-5.4 + i * 1.8, 0.42, -7.05);
    s.add(scr);
  }

  // warm key bounce from the player's side (front fill)
  const fill = emissivePlane(8, 3.2, 0xffb877, 1.5);
  fill.position.set(0, 1.2, 7.6);
  fill.rotation.y = Math.PI;
  s.add(fill);

  s.add(new THREE.AmbientLight(0x1b2530, 0.5));
  const dl = new THREE.DirectionalLight(0xfff0d6, 1.25);
  dl.position.set(2, 6, 3);
  s.add(dl);

  return s;
}

export function buildEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const scene = buildEnvScene();
  const rt = pmrem.fromScene(scene, 0.02, 0.1, 60, { size: Q.envRes });
  pmrem.dispose();
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  return rt.texture;
}

/** The arcade room the machine stands in — a cheap but convincing backdrop. */
export function buildBackdrop() {
  const g = new THREE.SphereGeometry(26, 40, 28);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vPos;
      uniform float uTime;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float box(vec2 p, vec2 b){ vec2 d = abs(p)-b; return length(max(d,0.0)) + min(max(d.x,d.y),0.0); }
      void main(){
        vec3 d = normalize(vPos);
        float h = d.y*0.5+0.5;

        // --- room shell: dark walls, slightly warmer floor ----------------
        vec3 ceil = vec3(0.007,0.009,0.013);
        vec3 wall = vec3(0.026,0.031,0.040);
        vec3 floorC = vec3(0.009,0.011,0.014);
        vec3 c = mix(floorC, wall, smoothstep(0.06,0.46,h));
        c = mix(c, ceil, smoothstep(0.54,0.95,h));

        float az = atan(d.z, d.x);
        float ele = d.y;

        // --- wall construction: panel seams, dado rail, skirting -----------
        // A pure gradient reads as an empty grey void. Real rooms have joints.
        float panel = az * 4.5;
        float seam = abs(fract(panel) - 0.5) * 2.0;
        float seamLine = 1.0 - smoothstep(0.90, 1.0, seam);
        float pid = floor(panel);
        c *= 1.0 + (hash(vec2(pid, 2.0)) - 0.5) * 0.34;      // per-panel tone
        c *= mix(1.0, 0.42, seamLine * step(-0.02, ele));     // recessed joint

        // dado rail + skirting board, both catching a little practical light
        float dado = 1.0 - smoothstep(0.0, 0.006, abs(ele - 0.128));
        c += vec3(0.028,0.031,0.038) * dado;
        c *= mix(1.0, 0.55, 1.0 - smoothstep(0.0, 0.016, abs(ele - 0.118)));
        float skirt = smoothstep(-0.052, -0.030, ele) * (1.0 - smoothstep(-0.030, -0.014, ele));
        c *= mix(1.0, 0.36, skirt);

        // faint acoustic-panel speckle above the dado
        float sp = hash(floor(vec2(az*70.0, ele*70.0)));
        c *= 1.0 + (sp - 0.5) * 0.10 * step(0.13, ele);
        for (int i = 0; i < 14; i++) {
          float fi = float(i);
          float ax = -3.1416 + fi * 0.4488 + 0.13 * hash(vec2(fi, 3.0));
          float wdt = 0.150 + 0.050 * hash(vec2(fi, 7.0));
          float hh = 0.150 + 0.062 * hash(vec2(fi, 11.0));
          float base = -0.030;
          float cy = base + hh;
          float dd = box(vec2(az - ax, ele - cy), vec2(wdt, hh));
          float body = 1.0 - smoothstep(0.0, 0.010, dd);
          c = mix(c, vec3(0.012,0.014,0.018), body * 0.95);
          // amber / green console family only — no rainbow marquees
          vec3 mcol = mix(vec3(1.00,0.62,0.22), vec3(0.42,0.72,0.50), step(1.5, mod(fi,3.0)));
          // lit backglass panel
          float scr = 1.0 - smoothstep(0.0, 0.008,
            box(vec2(az - ax, ele - (base + hh*1.42)), vec2(wdt*0.70, hh*0.30)));
          c += mcol * scr * 0.46 * (0.72 + 0.28*sin(uTime*0.9 + fi*1.3));
          // marquee glow strip across the top
          float mq = 1.0 - smoothstep(0.0, 0.010,
            box(vec2(az - ax, ele - (base + hh*1.95)), vec2(wdt*0.86, 0.011)));
          c += mcol * mq * (0.60 + 0.40*sin(uTime*1.3 + fi*2.0)) * 1.25;
          // spill from each cabinet onto the wall behind and floor in front
          float spill = exp(-abs(az - ax) * 5.0) * exp(-abs(ele - base) * 6.0);
          c += mcol * spill * 0.13;
        }

        // --- neon tube strips along the far wall ---------------------------
        float t1 = 1.0 - smoothstep(0.0, 0.005, abs(ele - 0.470));
        c += vec3(0.62,0.36,0.12) * t1 * (0.8 + 0.2*sin(uTime*0.7 + az*3.0));
        c += vec3(0.09,0.05,0.02) * (1.0 - smoothstep(0.0, 0.05, abs(ele - 0.470)));
        float t2 = 1.0 - smoothstep(0.0, 0.004, abs(ele - 0.575));
        c += vec3(0.34,0.40,0.46) * t2;
        c += vec3(0.04,0.05,0.06) * (1.0 - smoothstep(0.0, 0.045, abs(ele - 0.575)));

        // --- soft, evenly spread glow near the horizon ------------------------
        c += vec3(0.026,0.020,0.016) * pow(max(0.0, 1.0-abs(ele+0.05)*2.4), 3.0);
        c += vec3(0.016,0.019,0.024) * pow(max(0.0, ele), 1.5);
        c += vec3(0.030,0.022,0.014) * pow(max(0.0, 1.0-abs(az*0.3183)), 2.0) * 0.5;

        // --- floor sheen under the machine -----------------------------------
        float fl = smoothstep(0.0, -0.35, ele);
        c += vec3(0.022,0.024,0.030) * fl;

        // dither to kill banding
        c += (hash(d.xy*512.0) - 0.5) * 0.006;
        gl_FragColor = vec4(max(c, 0.0), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}

/** The arcade floor the cabinet stands on, with a warm light pool. */
export function buildFloor(env) {
  const g = new THREE.Group();

  const carpet = new THREE.CanvasTexture(makeArcadeCarpet(Q.tier === 'low' ? 512 : 1024));
  carpet.colorSpace = THREE.SRGBColorSpace;
  carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping;
  carpet.repeat.set(20, 20);
  carpet.anisotropy = Q.aniso || 4;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(52, 52),
    new THREE.MeshStandardMaterial({
      map: carpet,
      // The room must fall away to near-black so the machine reads as the
      // brightest object in frame — that tonal separation is most of the
      // "AAA product shot" illusion. The carpet art stays; it is just
      // driven down to a whisper and only recovers inside the light pools.
      color: 0x080a0d,
      // Polished dark arcade floor: glossy enough to mirror the neon into long
      // vertical streaks, but almost no diffuse ambient. Flat diffuse from the
      // IBL is what turned 40% of the frame into featureless grey.
      roughness: 0.28,
      metalness: 0.62,
      envMap: env || null,
      envMapIntensity: 0.16,
      // The room is off the key light's layer, so its only diffuse comes from
      // the IBL. A whisper of self-illumination through the carpet map stands
      // in for the ambient bounce a real arcade floor picks up.
      emissive: 0xffffff,
      emissiveMap: carpet,
      emissiveIntensity: 0.05,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.06;
  // The key light's shadow frustum is sized to the playfield, so letting the
  // floor receive it would slice a hard-edged polygon across the room where
  // the frustum ends. The cabinet gets a painted contact shadow instead.
  floor.receiveShadow = false;
  g.add(floor);

  // baked light pool so the floor still reads when GI lights are culled
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const x = c.getContext('2d');
  const grd = x.createRadialGradient(128, 128, 8, 128, 128, 128);
  grd.addColorStop(0, 'rgba(158,166,182,0.070)');
  grd.addColorStop(0.22, 'rgba(118,126,142,0.034)');
  grd.addColorStop(0.48, 'rgba(72,80,92,0.014)');
  grd.addColorStop(0.78, 'rgba(34,40,48,0.005)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = grd;
  x.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(9.5, 11.0),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, -1.05, -0.7);
  g.add(pool);

  // painted contact shadow: dense directly under the cabinet, feathering out
  // along the key light's direction so the machine sits on the floor
  const sc = document.createElement('canvas');
  sc.width = 256;
  sc.height = 256;
  const sx = sc.getContext('2d');
  const sg = sx.createRadialGradient(128, 128, 4, 128, 128, 126);
  sg.addColorStop(0, 'rgba(0,0,0,0.92)');
  sg.addColorStop(0.42, 'rgba(0,0,0,0.66)');
  sg.addColorStop(0.72, 'rgba(0,0,0,0.24)');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  sx.fillStyle = sg;
  sx.fillRect(0, 0, 256, 256);
  // tight occlusion blobs directly under the four leg levellers: the broad
  // pool alone still lets the machine look like it is hovering
  for (const [fx, fy] of [[91, 75], [205, 75], [91, 207], [205, 207]]) {
    const fg = sx.createRadialGradient(fx, fy, 1, fx, fy, 26);
    fg.addColorStop(0, 'rgba(0,0,0,1)');
    fg.addColorStop(0.34, 'rgba(0,0,0,0.72)');
    fg.addColorStop(1, 'rgba(0,0,0,0)');
    sx.fillStyle = fg;
    sx.beginPath();
    sx.arc(fx, fy, 26, 0, 7);
    sx.fill();
  }
  const stex = new THREE.CanvasTexture(sc);
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(1.28, 1.95),
    new THREE.MeshBasicMaterial({ map: stex, transparent: true, depthWrite: false, opacity: 0.9 })
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.set(-0.10, -1.045, -0.62);
  contact.renderOrder = 1;
  g.add(contact);

  return g;
}

/* ------------------------------------------------------------------ */
/* Neighbouring arcade cabinets. The hero camera is pitched below the  */
/* horizon, so the backdrop sphere is never in shot — the room has to  */
/* be built from real geometry standing on the floor.                  */
/* ------------------------------------------------------------------ */

function marqueeTexture(hue, title) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 72;
  const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 256, 72);
  gr.addColorStop(0, `hsl(${hue},46%,18%)`);
  gr.addColorStop(0.5, `hsl(${(hue + 14) % 360},54%,40%)`);
  gr.addColorStop(1, `hsl(${(hue + 340) % 360},44%,20%)`);
  x.fillStyle = gr;
  x.fillRect(0, 0, 256, 72);
  x.fillStyle = 'rgba(0,0,0,0.42)';
  for (let i = 0; i < 26; i++) x.fillRect(i * 10, 0, 4, 72);
  x.fillStyle = '#fff';
  x.font = '900 34px "Arial Black", Impact, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.shadowColor = `hsl(${hue},70%,52%)`;
  x.shadowBlur = 14;
  x.fillText(title, 128, 38);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* A CRT running an attract mode. Deliberately dark and monochromatic: these
 * sit behind the machine and any high-frequency colour here reads as broken
 * static and steals contrast from the table. One hue family, big shapes. */
function screenTexture(hue) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 160;
  const x = c.getContext('2d');
  x.fillStyle = '#03040a';
  x.fillRect(0, 0, 128, 160);

  const H = hue / 360;
  const hs = (l, a) => `hsla(${hue},52%,${l}%,${a})`;

  // horizon glow
  const gl = x.createLinearGradient(0, 160, 0, 40);
  gl.addColorStop(0, hs(30, 0.55));
  gl.addColorStop(0.45, hs(20, 0.18));
  gl.addColorStop(1, hs(14, 0));
  x.fillStyle = gl;
  x.fillRect(0, 0, 128, 160);

  // perspective grid receding to a vanishing point — classic attract screen
  x.strokeStyle = hs(56, 0.5);
  x.lineWidth = 1;
  const vy = 92;
  for (let i = -7; i <= 7; i++) {
    x.beginPath();
    x.moveTo(64 + i * 9, vy);
    x.lineTo(64 + i * 46, 160);
    x.stroke();
  }
  for (let i = 1; i <= 7; i++) {
    const t = i / 7;
    const yy = vy + (160 - vy) * t * t;
    x.globalAlpha = 0.55 - t * 0.3;
    x.beginPath();
    x.moveTo(0, yy);
    x.lineTo(128, yy);
    x.stroke();
  }
  x.globalAlpha = 1;

  // a couple of big sprite blocks up top
  x.fillStyle = hs(62, 0.85);
  for (let i = 0; i < 5; i++) {
    const w = 10 + ((i * 7) % 14);
    x.fillRect(16 + i * 22, 26 + ((i * 13) % 22), w, 6);
  }
  x.fillStyle = hs(70, 0.95);
  x.fillRect(54, 62, 20, 8);
  x.fillRect(48, 70, 32, 5);

  // scanlines + tube vignette
  x.globalAlpha = 0.5;
  x.fillStyle = '#000';
  for (let y = 0; y < 160; y += 3) x.fillRect(0, y, 128, 1);
  x.globalAlpha = 1;
  const vg = x.createRadialGradient(64, 80, 20, 64, 80, 96);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.85)');
  x.fillStyle = vg;
  x.fillRect(0, 0, 128, 160);

  void H;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let _puddle = null;
function puddleTex() {
  if (_puddle) return _puddle;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 2, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0.85)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.28)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 128, 128);
  _puddle = new THREE.CanvasTexture(c);
  return _puddle;
}

/** A row of upright arcade cabinets standing in the room. */
export function buildNeighbours(env) {
  const g = new THREE.Group();
  const FLOOR = -1.06;

  const body = new THREE.MeshStandardMaterial({
    color: 0x0d1116,
    roughness: 0.30,
    metalness: 0.55,
    envMap: env || null,
    envMapIntensity: 0.22,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: 0x1d2530,
    roughness: 0.22,
    metalness: 0.85,
    envMap: env || null,
    envMapIntensity: 0.42,
  });

  // Service racks along the bay wall. Restricted to the station palette:
  // amber, signal red, deck green and steel blue.
  const defs = [
    { x: -3.10, z: -3.35, ry: 0.42, hue: 34, t: 'DOCK 1' },
    { x: -4.35, z: -1.85, ry: 0.62, hue: 206, t: 'NAV' },
    { x: -5.15, z: -0.10, ry: 0.80, hue: 32, t: 'FUEL' },
    { x: 3.35, z: -2.85, ry: -0.42, hue: 8, t: 'ALERT' },
    { x: 4.65, z: -1.15, ry: -0.66, hue: 140, t: 'LIFE' },
    { x: -1.75, z: -5.05, ry: 0.16, hue: 206, t: 'ORBIT' },
    { x: 0.85, z: -5.35, ry: -0.12, hue: 34, t: 'CARGO' },
    { x: -6.05, z: 1.60, ry: 0.96, hue: 206, t: 'COMMS' },
    { x: 2.55, z: -4.65, ry: -0.24, hue: 140, t: 'SCAN' },
  ];

  for (const d of defs) {
    const c = new THREE.Group();
    const W = 0.66;
    const D = 0.80;
    const H = 1.80;

    const cab = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), body);
    cab.position.y = FLOOR + H / 2;
    c.add(cab);

    // black bezel + glowing CRT
    const bez = new THREE.Mesh(new THREE.BoxGeometry(W * 0.88, 0.60, 0.02), trim);
    bez.position.set(0, FLOOR + 1.20, D / 2 + 0.012);
    c.add(bez);
    const scr = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 0.74, 0.50),
      new THREE.MeshBasicMaterial({ map: screenTexture(d.hue), color: 0x3d4650, toneMapped: true })
    );
    scr.position.set(0, FLOOR + 1.20, D / 2 + 0.026);
    c.add(scr);

    // marquee
    const mq = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 0.92, 0.24),
      new THREE.MeshBasicMaterial({ map: marqueeTexture(d.hue, d.t), color: 0x525a63, toneMapped: true })
    );
    mq.position.set(0, FLOOR + 1.62, D / 2 + 0.014);
    c.add(mq);
    const mqBox = new THREE.Mesh(new THREE.BoxGeometry(W * 0.96, 0.28, 0.06), trim);
    mqBox.position.set(0, FLOOR + 1.62, D / 2 - 0.012);
    c.add(mqBox);

    // control panel
    const cp = new THREE.Mesh(new THREE.BoxGeometry(W * 0.96, 0.07, 0.30), trim);
    cp.position.set(0, FLOOR + 0.90, D / 2 + 0.13);
    cp.rotation.x = -0.22;
    c.add(cp);

    // side neon strips — the practicals that make an arcade an arcade
    for (const sgn of [-1, 1]) {
      const neon = new THREE.Mesh(
        new THREE.BoxGeometry(0.018, H * 0.78, 0.018),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color().setHSL(d.hue / 360, 0.42, 0.20),
        })
      );
      neon.position.set(sgn * (W / 2 + 0.006), FLOOR + H * 0.52, D / 2 - 0.03);
      c.add(neon);
    }

    // coin door + kick plate
    const kick = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 0.34, 0.03), trim);
    kick.position.set(0, FLOOR + 0.26, D / 2 + 0.016);
    c.add(kick);

    // light puddle on the carpet in front of each cabinet
    const pud = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({
        map: puddleTex(),
        color: new THREE.Color().setHSL(d.hue / 360, 0.6, 0.46),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.08,
      })
    );
    pud.rotation.x = -Math.PI / 2;
    pud.position.set(0, FLOOR + 0.006, D / 2 + 0.35);
    c.add(pud);

    c.position.set(d.x, 0, d.z);
    c.rotation.y = d.ry;
    g.add(c);
  }

  return g;
}

/* ------------------------------------------------------------------ */
/* Room shell: walls, ceiling, signage, pendant lamps.                 */
/* The backdrop sphere sits at r=26 and reads as a flat gradient at the */
/* elevations the hero camera actually looks through. Real walls close */
/* to the machine give the frame architecture, occlusion and bounce.   */
/* ------------------------------------------------------------------ */

/** Painted breeze-block wall with a dado rail, grime and stencilled marks. */
function wallTexture(seed = 1) {
  const W = 1024;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);

  const gr = x.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#232c34');
  gr.addColorStop(0.30, '#323e48');
  gr.addColorStop(0.62, '#39454f');
  gr.addColorStop(0.88, '#1f272e');
  gr.addColorStop(1, '#12171c');
  x.fillStyle = gr;
  x.fillRect(0, 0, W, H);

  // breeze-block courses, half-offset per row
  const bw = 128;
  const bh = 42;
  for (let row = 0; row * bh < H; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col * bw < W + bw; col++) {
      const bx = col * bw + off;
      const by = row * bh;
      const v = (rnd() - 0.5) * 26;
      x.fillStyle = `rgba(${Math.round(60 + v)},${Math.round(72 + v)},${Math.round(84 + v)},0.5)`;
      x.fillRect(bx + 1.5, by + 1.5, bw - 3, bh - 3);
      x.fillStyle = 'rgba(0,0,0,0.44)';
      x.fillRect(bx, by, bw, 1.5);
      x.fillRect(bx, by, 1.5, bh);
      x.fillStyle = 'rgba(200,214,226,0.11)';
      x.fillRect(bx + 1.5, by + bh - 2.5, bw - 3, 1);
    }
  }

  // dado rail + skirting
  x.fillStyle = '#4a5560';
  x.fillRect(0, H * 0.60, W, 10);
  x.fillStyle = 'rgba(210,222,232,0.3)';
  x.fillRect(0, H * 0.60, W, 2);
  x.fillStyle = 'rgba(0,0,0,0.55)';
  x.fillRect(0, H * 0.60 + 10, W, 5);
  x.fillStyle = '#1a2129';
  x.fillRect(0, H - 34, W, 34);
  x.fillStyle = 'rgba(0,0,0,0.6)';
  x.fillRect(0, H - 36, W, 3);

  // grime creeping up from the skirting, scuff marks
  const gg = x.createLinearGradient(0, H, 0, H - 150);
  gg.addColorStop(0, 'rgba(0,0,0,0.55)');
  gg.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gg;
  x.fillRect(0, H - 150, W, 150);
  for (let i = 0; i < 90; i++) {
    x.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.12})`;
    x.fillRect(rnd() * W, H - 80 + rnd() * 70, 6 + rnd() * 60, 2 + rnd() * 7);
  }

  // stencilled service text and a conduit run
  x.save();
  x.globalAlpha = 0.24;
  x.fillStyle = '#93a4b2';
  x.font = '700 15px "Helvetica Neue", Arial, sans-serif';
  x.fillText('PRESSURE DOOR  ·  BAY 04', 44, H * 0.52);
  x.fillText('AIRLOCK →', W - 260, H * 0.52);
  x.restore();
  x.strokeStyle = 'rgba(96,110,124,0.35)';
  x.lineWidth = 5;
  x.beginPath();
  x.moveTo(0, 52);
  x.lineTo(W, 52);
  x.stroke();
  for (let i = 0; i < 9; i++) {
    x.fillStyle = 'rgba(62,74,86,0.55)';
    x.fillRect(i * 128 + 30, 44, 12, 18);
  }

  // wash from the ceiling troughs: real rooms are brightest where the
  // fixtures are, and a flat-lit wall is the classic 'untextured box' tell
  const wash = x.createLinearGradient(0, 0, 0, H * 0.62);
  wash.addColorStop(0, 'rgba(206,200,180,0.26)');
  wash.addColorStop(0.35, 'rgba(160,158,148,0.11)');
  wash.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = wash;
  x.fillRect(0, 0, W, H * 0.62);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A framed arcade poster: bold shapes, a title, a strapline. */
function posterTexture(hue, title, sub) {
  const W = 256;
  const H = 384;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');

  const gr = x.createLinearGradient(0, 0, W * 0.4, H);
  gr.addColorStop(0, `hsl(${hue},40%,8%)`);
  gr.addColorStop(0.55, `hsl(${(hue + 12) % 360},48%,22%)`);
  gr.addColorStop(1, `hsl(${(hue + 340) % 360},38%,7%)`);
  x.fillStyle = gr;
  x.fillRect(0, 0, W, H);

  // starburst
  x.save();
  x.translate(W * 0.5, H * 0.42);
  for (let i = 0; i < 22; i++) {
    x.rotate((Math.PI * 2) / 22);
    x.fillStyle = i % 2 ? `hsla(${(hue + 16) % 360},56%,52%,0.11)` : 'rgba(0,0,0,0)';
    x.beginPath();
    x.moveTo(0, 0);
    x.lineTo(200, -26);
    x.lineTo(200, 26);
    x.closePath();
    x.fill();
  }
  x.restore();

  // planet / ring motif
  const rg = x.createRadialGradient(W * 0.5, H * 0.40, 6, W * 0.5, H * 0.40, 74);
  rg.addColorStop(0, `hsl(${(hue + 20) % 360},58%,62%)`);
  rg.addColorStop(0.7, `hsl(${(hue + 10) % 360},52%,32%)`);
  rg.addColorStop(1, `hsla(${hue},48%,12%,0)`);
  x.fillStyle = rg;
  x.beginPath();
  x.arc(W * 0.5, H * 0.40, 74, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = `hsla(${(hue + 24) % 360},56%,70%,0.75)`;
  x.lineWidth = 5;
  x.save();
  x.translate(W * 0.5, H * 0.40);
  x.rotate(-0.35);
  x.scale(1, 0.28);
  x.beginPath();
  x.arc(0, 0, 96, 0, Math.PI * 2);
  x.stroke();
  x.restore();

  // title block
  x.fillStyle = 'rgba(4,5,12,0.82)';
  x.fillRect(0, H * 0.68, W, H * 0.20);
  x.fillStyle = '#fff';
  x.textAlign = 'center';
  x.font = '900 34px "Arial Black", Impact, sans-serif';
  x.shadowColor = `hsl(${(hue + 16) % 360},62%,50%)`;
  x.shadowBlur = 12;
  x.fillText(title, W / 2, H * 0.78);
  x.shadowBlur = 0;
  x.fillStyle = `hsl(${(hue + 20) % 360},52%,60%)`;
  x.font = '700 12px "Helvetica Neue", Arial, sans-serif';
  x.fillText(sub, W / 2, H * 0.845);

  // print border + aged paper edge
  x.strokeStyle = 'rgba(255,255,255,0.16)';
  x.lineWidth = 6;
  x.strokeRect(3, 3, W - 6, H - 6);
  const vg = x.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  x.fillStyle = vg;
  x.fillRect(0, 0, W, H);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Big neon wall sign, drawn as glowing tube strokes on transparent black. */
function neonSignTexture(text, hue) {
  const W = 1024;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  x.clearRect(0, 0, W, H);
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = '900 128px "Arial Black", Impact, sans-serif';
  const core = `hsl(${hue},60%,86%)`;
  const halo = `hsl(${hue},72%,46%)`;
  x.lineJoin = 'round';
  // outer bloom passes
  for (const [w, a] of [[38, 0.10], [26, 0.16], [16, 0.26], [9, 0.5]]) {
    x.strokeStyle = halo;
    x.globalAlpha = a;
    x.lineWidth = w;
    x.strokeText(text, W / 2, H / 2);
  }
  x.globalAlpha = 1;
  x.strokeStyle = halo;
  x.lineWidth = 11;
  x.strokeText(text, W / 2, H / 2);
  x.strokeStyle = core;
  x.lineWidth = 4.5;
  x.strokeText(text, W / 2, H / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildRoomDressing(env) {
  const g = new THREE.Group();
  const FLOOR = -1.06;
  const CEIL = 2.05;

  const wallMat = (seed, rx, ry) => {
    const t = wallTexture(seed);
    t.repeat.set(rx, ry);
    return new THREE.MeshStandardMaterial({
      map: t,
      color: 0xffffff,
      roughness: 0.94,
      metalness: 0.0,
      envMap: env || null,
      envMapIntensity: 0.55,
    });
  };

  const wallH = CEIL - FLOOR;
  const walls = [
    { w: 22, p: [0, FLOOR + wallH / 2, -7.4], ry: 0, seed: 1, rx: 6 },
    { w: 16, p: [-7.6, FLOOR + wallH / 2, -1.0], ry: Math.PI / 2, seed: 5, rx: 4.5 },
    { w: 16, p: [7.8, FLOOR + wallH / 2, -1.0], ry: -Math.PI / 2, seed: 9, rx: 4.5 },
  ];
  for (const wd of walls) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wd.w, wallH), wallMat(wd.seed, wd.rx, 1));
    m.position.set(wd.p[0], wd.p[1], wd.p[2]);
    m.rotation.y = wd.ry;
    m.receiveShadow = false;
    g.add(m);
  }

  // ceiling with recessed light troughs
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 16),
    new THREE.MeshStandardMaterial({ color: 0x161c22, roughness: 0.96, metalness: 0 })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, CEIL, -1.0);
  g.add(ceil);

  for (let i = 0; i < 5; i++) {
    const z = -6.2 + i * 1.55;
    const trough = new THREE.Mesh(
      new THREE.BoxGeometry(9.5, 0.10, 0.20),
      new THREE.MeshStandardMaterial({ color: 0x10141a, roughness: 0.5, metalness: 0.7 })
    );
    trough.position.set(0, CEIL - 0.06, z);
    g.add(trough);
    const tube = new THREE.Mesh(
      new THREE.PlaneGeometry(9.2, 0.13),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xbcc8d2).multiplyScalar(1.35) })
    );
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, CEIL - 0.115, z);
    g.add(tube);
  }

  // hanging pendant lamps over the row — visible fixtures with a warm cone
  for (const px of [-4.3, 2.6]) {
    const z = -4.4;
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.62, 6),
      new THREE.MeshStandardMaterial({ color: 0x080a12, roughness: 0.8, metalness: 0.3 })
    );
    cord.position.set(px, CEIL - 0.31, z);
    g.add(cord);
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.30, 0.24, 24, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x1a2028,
        roughness: 0.35,
        metalness: 0.75,
        side: THREE.DoubleSide,
        envMap: env || null,
        envMapIntensity: 0.5,
      })
    );
    shade.position.set(px, CEIL - 0.70, z);
    g.add(shade);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 12, 10),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc98a).multiplyScalar(2.2) })
    );
    bulb.position.set(px, CEIL - 0.78, z);
    g.add(bulb);
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({
        map: puddleTex(),
        color: 0xffc07a,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.16,
      })
    );
    halo.position.set(px, CEIL - 0.79, z);
    halo.renderOrder = 3;
    g.add(halo);
  }

  // framed posters on the walls
  const posters = [
    { p: [-7.54, 0.28, -3.30], ry: Math.PI / 2, hue: 206, t: 'ND-7', s: 'ORBITAL DEFENCE COMMAND' },
    { p: [-7.54, 0.24, -1.05], ry: Math.PI / 2, hue: 34, t: 'CADET', s: 'FLEET TRAINING PROGRAMME' },
    { p: [-3.90, 0.30, -7.33], ry: 0, hue: 26, t: 'FUEL', s: 'HANDLE WITH CARE' },
    { p: [3.60, 0.30, -7.33], ry: 0, hue: 140, t: 'DECK 3', s: 'LIFE SUPPORT NOMINAL' },
    { p: [7.74, 0.26, -2.60], ry: -Math.PI / 2, hue: 8, t: 'ALERT', s: 'HULL BREACH DRILL' },
  ];
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x0c1014,
    roughness: 0.34,
    metalness: 0.6,
    envMap: env || null,
    envMapIntensity: 0.4,
  });
  for (const pd of posters) {
    const grp = new THREE.Group();
    const fr = new THREE.Mesh(new THREE.BoxGeometry(0.70, 1.02, 0.045), frameMat);
    grp.add(fr);
    const art = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.94),
      new THREE.MeshBasicMaterial({ map: posterTexture(pd.hue, pd.t, pd.s), toneMapped: true })
    );
    art.position.z = 0.026;
    grp.add(art);
    grp.position.set(pd.p[0], pd.p[1], pd.p[2]);
    grp.rotation.y = pd.ry;
    g.add(grp);
  }

  // the big neon room sign
  const signs = [
    { p: [-7.48, 0.96, -3.6], ry: Math.PI / 2, w: 3.2, h: 0.8, txt: 'BAY 04', hue: 34 },
    { p: [0.4, 1.02, -7.28], ry: 0, w: 3.0, h: 0.75, txt: 'DOCK', hue: 24 },
  ];
  for (const sd of signs) {
    const backer = new THREE.Mesh(
      new THREE.BoxGeometry(sd.w, sd.h, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x06090c, roughness: 0.6, metalness: 0.4 })
    );
    backer.position.set(sd.p[0], sd.p[1], sd.p[2]);
    backer.rotation.y = sd.ry;
    g.add(backer);
    const neon = new THREE.Mesh(
      new THREE.PlaneGeometry(sd.w * 0.94, sd.h * 0.94),
      new THREE.MeshBasicMaterial({
        map: neonSignTexture(sd.txt, sd.hue),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    neon.position.set(
      sd.p[0] + Math.sin(sd.ry) * 0.05,
      sd.p[1],
      sd.p[2] + Math.cos(sd.ry) * 0.05
    );
    neon.rotation.y = sd.ry;
    g.add(neon);
  }

  // a change machine and a bin so the floor line is not an empty sweep
  const boxMat = new THREE.MeshStandardMaterial({
    color: 0x141a20,
    roughness: 0.42,
    metalness: 0.55,
    envMap: env || null,
    envMapIntensity: 0.3,
  });
  const change = new THREE.Mesh(new THREE.BoxGeometry(0.52, 1.30, 0.34), boxMat);
  change.position.set(-7.28, FLOOR + 0.65, -5.1);
  g.add(change);
  const changeFace = new THREE.Mesh(
    new THREE.PlaneGeometry(0.40, 0.22),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb04a).multiplyScalar(1.3) })
  );
  changeFace.position.set(-7.00, FLOOR + 0.98, -5.1);
  changeFace.rotation.y = Math.PI / 2;
  g.add(changeFace);

  const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.17, 0.62, 14), boxMat);
  bin.position.set(-5.9, FLOOR + 0.31, -6.4);
  g.add(bin);

  return g;
}
