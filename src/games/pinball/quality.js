/**
 * Global quality flags. Set once at boot from the detected tier; every module
 * reads from here so a single switch reconfigures materials, shadows,
 * texture resolution and post cost.
 */

export const Q = {
  tier: 'ultra',
  softwareGL: false, // set at boot; forces cheap material lobes on CPU rasterisers
  transmission: true, // MeshPhysicalMaterial.transmission (costs a full extra scene pass)
  shadows: true,
  artRes: 2048,
  cubeReflect: false,
  particles: 900,
  pixelRatio: 1,
  bloomMips: 5,
  aniso: 16,
  envRes: 256,
  giLights: true,
  washSpot: true,
  sceneGI: 4,
  eventLights: true,
  practicalLights: false, // lamps are emissive + bloom, never real lights (see main.js)
};

const TIERS = {
  low: {
    transmission: false,
    shadows: true,
    artRes: 1024,
    cubeReflect: false,
    particles: 260,
    pixelRatio: 0.7,
    bloomMips: 3,
    aniso: 4,
    envRes: 128,
    giLights: false,
    washSpot: true,
    sceneGI: 2,
    eventLights: false,
  },
  med: {
    transmission: false,
    shadows: true,
    artRes: 1536,
    cubeReflect: false,
    particles: 500,
    pixelRatio: 1,
    bloomMips: 4,
    aniso: 8,
    envRes: 256,
    giLights: false,
    washSpot: true,
    sceneGI: 3,
    eventLights: true,
  },
  high: {
    transmission: true,
    shadows: true,
    artRes: 2048,
    cubeReflect: false,
    particles: 900,
    pixelRatio: 1.1,
    bloomMips: 5,
    aniso: 16,
    envRes: 256,
    giLights: true,
    washSpot: true,
    sceneGI: 4,
    eventLights: true,
  },
  ultra: {
    transmission: true,
    shadows: true,
    artRes: 2560,
    cubeReflect: false,
    particles: 900,
    pixelRatio: 1.25,
    bloomMips: 5,
    aniso: 16,
    envRes: 512,
    giLights: true,
    washSpot: true,
    sceneGI: 4,
    eventLights: true,
  },
};

export function setTier(t) {
  const cfg = TIERS[t] || TIERS.high;
  const soft = Q.softwareGL;
  Q.tier = TIERS[t] ? t : 'high';
  Object.assign(Q, cfg);
  Q.softwareGL = soft;
  // Never negotiable, on any tier: real per-lamp lights are what put this
  // table at 13fps. Lamps glow through emissive + bloom instead.
  Q.practicalLights = false;
  Q.cubeReflect = false;
  Q.giLights = false;
  Q.washSpot = false;
  // MeshPhysicalMaterial.transmission makes three.js render the ENTIRE scene a
  // second time into a back-buffer, every frame. Two plastics and a ball
  // ramp are not worth doubling the frame. physicalParams() approximates it
  // with plain alpha, which on a saturated stylised table is indistinguishable.
  Q.transmission = false;
  if (soft) {
    // A CPU rasteriser JIT-compiles and executes the physical-material lobes
    // roughly 20x slower than the standard one. Keep every light, lamp, mesh
    // and texture of the requested tier, but drop the lobes that only a GPU
    // can afford so the frame still lands.
    Q.transmission = false;
    Q.cubeReflect = false;
    Q.pixelRatio = Math.min(Q.pixelRatio, 1);
    Q.artRes = Math.min(Q.artRes, 1536);
    Q.envRes = Math.min(Q.envRes, 128);
    Q.bloomMips = Math.min(Q.bloomMips, 4);
    Q.sceneGI = Math.min(Q.sceneGI, 2);
    Q.particles = Math.min(Q.particles, 420);
    Q.aniso = Math.min(Q.aniso, 4);
    Q.sceneGI = 0;
    Q.washSpot = false;
    Q.giLights = false;
    Q.practicalLights = false;
  }
  return Q;
}

/** True when the physical-material lobes must be swapped for standard ones. */
export function cheapMaterials() {
  return Q.tier === 'low' || Q.softwareGL;
}

/**
 * Build a PBR material for the current tier. On software renderers the
 * clearcoat / sheen / transmission lobes roughly triple the fragment shader
 * (and its JIT compile time), so they are dropped and approximated.
 */
export function mkMat(THREE, p, opts = {}) {
  const q = physicalParams(p);
  if (cheapMaterials() && !opts.keepCoat) {
    const o = Object.assign({}, q);
    if (o.clearcoat) {
      o.roughness = Math.max(0.02, (o.roughness ?? 0.5) * (1 - o.clearcoat * 0.35));
      o.envMapIntensity = (o.envMapIntensity ?? 1) * (1 + o.clearcoat * 0.22);
    }
    delete o.clearcoat;
    delete o.clearcoatRoughness;
    delete o.clearcoatMap;
    delete o.sheen;
    delete o.sheenColor;
    delete o.sheenRoughness;
    delete o.ior;
    delete o.reflectivity;
    delete o.specularIntensity;
    return new THREE.MeshStandardMaterial(o);
  }
  return new THREE.MeshPhysicalMaterial(q);
}

/** Strip cost-heavy params from a MeshPhysicalMaterial spec on low tiers. */
export function physicalParams(p) {
  if (Q.transmission) return p;
  const o = Object.assign({}, p);
  if (o.transmission) {
    // approximate the look with plain alpha so the plastics still read as
    // translucent lenses without the extra full-screen transmission pass
    o.opacity = Math.min(1, (o.opacity ?? 1) * (1 - o.transmission * 0.72));
    o.transparent = true;
    o.emissiveIntensity = (o.emissiveIntensity ?? 0) + o.transmission * 0.05;
    delete o.transmission;
    delete o.thickness;
    delete o.attenuationColor;
    delete o.attenuationDistance;
  }
  return o;
}
