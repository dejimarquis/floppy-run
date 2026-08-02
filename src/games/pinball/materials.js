/**
 * PBR material library. Everything the table is made of lives here so the
 * look stays consistent and materials can be swapped per quality tier.
 */

import * as THREE from 'three';
import { Q, mkMat } from './quality.js';
import { makeRng } from './rng.js';

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Brushed metal roughness map — fine circumferential streaks. */
export function brushedRoughness(size = 512, base = 0.28, amp = 0.16) {
  const c = mkCanvas(size, size);
  const g = c.getContext('2d');
  const rnd = makeRng(0x51e1);
  g.fillStyle = `rgb(${(base * 255) | 0},${(base * 255) | 0},${(base * 255) | 0})`;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 5200; i++) {
    const y = rnd() * size;
    const v = Math.max(0, Math.min(1, base + (rnd() - 0.5) * 2 * amp));
    g.strokeStyle = `rgba(${(v * 255) | 0},${(v * 255) | 0},${(v * 255) | 0},0.6)`;
    g.lineWidth = 0.5 + rnd() * 1.6;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(size, y + (rnd() - 0.5) * 3);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Fingerprints + dust for the playfield glass. */
export function glassSmudge(size = 1024) {
  const c = mkCanvas(size, Math.round(size * 2));
  const g = c.getContext('2d');
  const rnd = makeRng(0x9d5);
  g.fillStyle = '#000000';
  g.fillRect(0, 0, c.width, c.height);
  // broad haze
  for (let i = 0; i < 40; i++) {
    const x = rnd() * c.width;
    const y = rnd() * c.height;
    const r = (40 + rnd() * 260) * (size / 1024);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(255,255,255,${0.02 + rnd() * 0.05})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, 7);
    g.fill();
  }
  // fingerprints: concentric ridges
  for (let f = 0; f < 7; f++) {
    const x = rnd() * c.width;
    const y = rnd() * c.height;
    const s = (26 + rnd() * 22) * (size / 1024);
    const rot = rnd() * 3;
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.scale(1, 1.35);
    for (let i = 0; i < 13; i++) {
      g.strokeStyle = `rgba(255,255,255,${0.05 + rnd() * 0.05})`;
      g.lineWidth = 1.1 * (size / 1024) + 0.6;
      g.beginPath();
      g.arc(0, 0, s * (0.14 + i * 0.075), 0.4 + rnd() * 0.4, 4.2 + rnd() * 0.5);
      g.stroke();
    }
    g.restore();
  }
  // dust specks
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(255,255,255,${0.05 + rnd() * 0.18})`;
    g.beginPath();
    g.arc(rnd() * c.width, rnd() * c.height, rnd() * 1.6 + 0.3, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Lacquered wood for the cabinet rails. */
export function woodTexture(size = 512) {
  const c = mkCanvas(size, size);
  const g = c.getContext('2d');
  const rnd = makeRng(0x0d);
  const base = g.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, '#241a12');
  base.addColorStop(0.5, '#33241a');
  base.addColorStop(1, '#1c130d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 700; i++) {
    const y = rnd() * size;
    g.strokeStyle = `rgba(${60 + rnd() * 60},${40 + rnd() * 40},${24 + rnd() * 26},${0.1 + rnd() * 0.2})`;
    g.lineWidth = 0.6 + rnd() * 2.6;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(size * 0.3, y + (rnd() - 0.5) * 22, size * 0.7, y + (rnd() - 0.5) * 22, size, y + (rnd() - 0.5) * 14);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function createMaterials(renderer, env) {
  const aniso = Math.min(Q.aniso, renderer.capabilities.getMaxAnisotropy());
  const brushed = brushedRoughness(512, 0.3, 0.18);
  brushed.repeat.set(3, 1);
  brushed.anisotropy = aniso;

  const wood = woodTexture(512);
  wood.anisotropy = aniso;

  const M = {};

  M.chrome = mkMat(THREE, {
    color: 0xf2f4f8,
    metalness: 1.0,
    roughness: 0.035,
    envMap: env,
    envMapIntensity: 1.9,
    clearcoat: 0.4,
    clearcoatRoughness: 0.02,
  });

  M.steel = mkMat(THREE, {
    color: 0xc4ccd8,
    metalness: 1.0,
    roughness: 0.19,
    roughnessMap: brushed,
    envMap: env,
    envMapIntensity: 1.45,
  });

  // Ball guides / lane rails. Real guides are thin polished-steel strip: a
  // bright *edge* highlight and a dark body. A wide, bright, low-roughness
  // band here sweeps a cream specular along every curve and reads as painted
  // wood, which is the single most amateur-looking thing on a table.
  M.steelDark = mkMat(THREE, {
    color: 0x5d6675,
    metalness: 0.95,
    roughness: 0.33,
    roughnessMap: brushed,
    envMap: env,
    envMapIntensity: 0.85,
  });

  M.rampBed = mkMat(THREE, {
    color: 0x8e97a6,
    metalness: 1.0,
    roughness: 0.42,
    roughnessMap: brushed,
    envMap: env,
    envMapIntensity: 1.05,
    side: THREE.DoubleSide,
  });

  // habitrail / wireform stock: real machines use polished nickel-plated rod,
  // so this has to read as chrome, not as matte plastic
  M.wire = mkMat(THREE, {
    color: 0x9aa6b8,
    metalness: 1.0,
    roughness: 0.36,
    envMap: env,
    envMapIntensity: 1.25,
  });

  // Moulded flipper bat. Modern machines run a pearl-white bat under red
  // rubber: against a dark playfield it is the only part of the lower third
  // with a light value, so the flippers stay legible from the hero angle and
  // give the chrome ball something bright to pick up on every save.
  M.flipperBat = mkMat(THREE, {
    color: 0xe9ecf2,
    metalness: 0.08,
    roughness: 0.17,
    envMap: env,
    envMapIntensity: 1.05,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });

  // Bracketry and mounting plates. Kept deliberately reflective: at the low
  // ball-cam angle a matte dark plate reads as a hole punched in the frame,
  // and a real powder-coated bracket always picks up the room.
  M.blackMetal = mkMat(THREE, {
    color: 0x333b4e,
    metalness: 0.88,
    roughness: 0.26,
    envMap: env,
    envMapIntensity: 1.75,
  });

  M.rubberRed = mkMat(THREE, {
    color: 0xc41f34,
    metalness: 0.0,
    roughness: 0.62,
    clearcoat: 0.5,
    clearcoatRoughness: 0.4,
    sheen: 0.4,
    sheenColor: new THREE.Color(0xff8090),
    envMap: env,
    envMapIntensity: 0.7,
  });

  M.rubberWhite = mkMat(THREE, {
    color: 0xf0f2f4,
    metalness: 0,
    roughness: 0.55,
    clearcoat: 0.4,
    envMap: env,
    envMapIntensity: 0.7,
  });

  M.rubberBlack = mkMat(THREE, {
    color: 0x14161c,
    metalness: 0,
    roughness: 0.7,
    envMap: env,
    envMapIntensity: 0.5,
  });

  const plastic = (color, opts = {}) =>
    mkMat(THREE, {
      color,
      metalness: 0,
      roughness: opts.roughness ?? 0.12,
      transmission: opts.transmission ?? 0.72,
      thickness: opts.thickness ?? 0.006,
      ior: 1.48,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      attenuationColor: new THREE.Color(color),
      attenuationDistance: opts.att ?? 0.03,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      envMap: env,
      envMapIntensity: 1.25,
      emissive: new THREE.Color(color),
      emissiveIntensity: opts.emissive ?? 0.06,
    });

  // Space Cadet's plastics are amber, signal red, deck green and smoked
  // blue-grey. There is no cyan or magenta anywhere on the machine.
  M.plasticRed = plastic(0xd8402c);
  M.plasticAmber = plastic(0xffb02a);
  M.plasticGreen = plastic(0x4fbf6e);
  M.plasticSteel = plastic(0x7fa4c4);
  M.plasticClear = plastic(0xdfe8f5, { transmission: 0.9, emissive: 0.0, att: 0.08 });

  M.cabWood = mkMat(THREE, {
    map: wood,
    color: 0xffffff,
    metalness: 0.05,
    roughness: 0.35,
    clearcoat: 0.7,
    clearcoatRoughness: 0.12,
    envMap: env,
    envMapIntensity: 0.9,
  });

  // Stainless side rail / lockdown bar. Must be a *true* metal: as a
  // dielectric with a clearcoat the coat's white specular lobe covers the
  // whole rail evenly and it reads as a painted cream noodle. At
  // metalness 1 the reflectance is the rail's own colour and it mirrors the
  // dark arcade, so it goes near-black with bright neon streaks.
  M.railWood = mkMat(THREE, {
    // Deliberately a dark, satin stainless rather than bright chrome. The IBL
    // has five ceiling tubes in it, and any up-facing polished bar mirrors
    // them through a blurred mip as one flat cream flood across the whole
    // front of the cabinet. Satin turns that flood back into a streak.
    color: 0x5a616e,
    metalness: 1.0,
    roughness: 0.30,
    envMap: env,
    envMapIntensity: 0.34,
  });

  // Playfield glass: a thin, mostly-specular sheet. Deliberately *not*
  // transmissive — a transmission pass on a full-screen quad is far too
  // expensive and a physical reflection layer reads better anyway.
  M.glass = mkMat(THREE, {
    color: 0x8fa0b6,
    metalness: 0.0,
    roughness: 0.035,
    transparent: true,
    opacity: 0.022,
    envMap: env,
    // At a 3/4 viewing angle the sheet is near grazing, so Fresnel drives the
    // reflection to ~1 across the whole quad. Any real env intensity here
    // lays a flat cream sheen over the entire playfield and the apron.
    envMapIntensity: 0.17,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    side: THREE.FrontSide,
    depthWrite: false,
    premultipliedAlpha: false,
  });

  M.brushed = brushed;
  M.wood = wood;
  return M;
}
