/**
 * Build-time scene optimiser.
 *
 * The table is authored as ~550 individually-placed meshes because that is the
 * only sane way to model a pinball machine. That authoring shape is a disaster
 * at runtime: 550 draw calls, 550 matrix updates, 550 frustum tests.
 *
 * Nothing here changes how the table is authored. It runs once after build and
 * folds everything that never moves into one mesh per material, leaving the
 * handful of objects the game actually animates untouched.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Walk an object graph and collect every Object3D reachable from it, so the
 * merger knows which meshes the game still holds a live reference to (and
 * therefore may animate, recolour or toggle at any moment).
 */
export function collectLive(root, { skip = new Set(), maxDepth = 7 } = {}) {
  const out = new Set();
  const seen = new Set();
  const walk = (v, d) => {
    if (!v || d > maxDepth) return;
    if (typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);
    if (v.isObject3D) {
      if (!skip.has(v)) out.add(v);
      return; // do not descend into children; the graph walk handles those
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, d + 1);
      return;
    }
    if (v instanceof Map) {
      for (const x of v.values()) walk(x, d + 1);
      return;
    }
    if (v.isVector3 || v.isColor || v.isMaterial || v.isBufferGeometry || v.isTexture) return;
    for (const k in v) {
      if (k.startsWith('_')) continue;
      walk(v[k], d + 1);
    }
  };
  walk(root, 0);
  return out;
}

const ATTRS = ['position', 'normal', 'uv'];

/**
 * A BoxGeometry with a decal on one face is authored as a six-material mesh:
 * six draw calls for one 12-triangle box. Forty of those (targets, inserts,
 * standups, the apron, the cabinet) were 246 of the table's draw calls.
 *
 * This rewrites the index buffer so all faces sharing a material are
 * contiguous, then emits one group per *distinct* material. The decal box
 * drops from six calls to two, and anything that turns out to be uniform
 * collapses to a plain single-material mesh that the merger can then eat.
 */
export function coalesceGroups(root) {
  let saved = 0;
  let touched = 0;
  root.traverse((o) => {
    if (!o.isMesh || !Array.isArray(o.material)) return;
    const geo = o.geometry;
    if (!geo || !geo.index || !geo.groups || geo.groups.length < 2) return;

    // Identity, never value: the game mutates these material objects at
    // runtime, and collapsing two look-alike instances would weld two
    // independently-animated parts together.
    const uniq = [];
    const remap = o.material.map((m) => {
      let i = uniq.indexOf(m);
      if (i < 0) { i = uniq.length; uniq.push(m); }
      return i;
    });

    const src = geo.index.array;
    const buckets = uniq.map(() => []);
    for (const g of geo.groups) {
      const mi = remap[g.materialIndex ?? 0] ?? 0;
      const end = g.start + g.count;
      const b = buckets[mi];
      for (let i = g.start; i < end; i++) b.push(src[i]);
    }

    const total = buckets.reduce((a, b) => a + b.length, 0);
    const out = new (src.constructor)(total);
    geo.clearGroups();
    let off = 0;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (!b.length) continue;
      out.set(b, off);
      geo.addGroup(off, b.length, i);
      off += b.length;
    }
    geo.setIndex(new THREE.BufferAttribute(out, 1));

    saved += geo.groups.length - o.material.length;
    touched++;
    if (uniq.length === 1) {
      geo.clearGroups();
      o.material = uniq[0];
    } else {
      o.material = uniq;
    }
  });
  return { touched, saved: -saved };
}

const R = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
const HEX = (c) => (c && c.getHexString ? c.getHexString() : '-');
const TEX = (t) => (t ? t.uuid : '-');

/**
 * Two materials built from the same recipe in two different call sites are two
 * separate GPU states as far as three.js is concerned, and two separate merge
 * buckets. The table authors ~200 of them. This collapses everything that is
 * byte-for-byte equivalent onto one shared instance.
 */
export function materialKey(m) {
  return [
    m.type,
    HEX(m.color), R(m.roughness), R(m.metalness),
    HEX(m.emissive), R(m.emissiveIntensity),
    R(m.opacity), m.transparent ? 1 : 0, m.side, m.depthWrite ? 1 : 0, m.depthTest ? 1 : 0,
    m.blending, R(m.alphaTest), m.toneMapped ? 1 : 0, m.flatShading ? 1 : 0, m.wireframe ? 1 : 0,
    TEX(m.map), TEX(m.normalMap), TEX(m.roughnessMap), TEX(m.metalnessMap),
    TEX(m.emissiveMap), TEX(m.aoMap), TEX(m.alphaMap), TEX(m.envMap), TEX(m.bumpMap),
    R(m.envMapIntensity), R(m.clearcoat), R(m.clearcoatRoughness), R(m.transmission),
    R(m.thickness), R(m.ior), R(m.sheen), R(m.iridescence), R(m.reflectivity),
    R(m.specularIntensity), R(m.normalScale && m.normalScale.x), R(m.aoMapIntensity),
    R(m.bumpScale), R(m.displacementScale),
  ].join('|');
}

function normalise(geo, withColor) {
  const g = new THREE.BufferGeometry();
  const list = withColor ? ATTRS.concat('color') : ATTRS;
  for (const a of list) {
    if (geo.attributes[a]) g.setAttribute(a, geo.attributes[a].clone());
  }
  if (withColor && !g.attributes.color && geo.attributes.position) {
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3).fill(1);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  if (!g.attributes.normal && g.attributes.position) {
    g.computeVertexNormals();
  }
  if (!g.attributes.uv && g.attributes.position) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
  }
  // Buckets mix indexed and non-indexed sources; mergeGeometries refuses that,
  // so everything is normalised to indexed.
  if (geo.index) g.setIndex(geo.index.clone());
  else if (g.attributes.position) {
    const n = g.attributes.position.count;
    const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) arr[i] = i;
    g.setIndex(new THREE.BufferAttribute(arr, 1));
  }
  return g;
}

/**
 * Merge every static mesh under `root` into one mesh per (material, flags)
 * bucket. Returns a small report so the caller can log the win.
 */
export function mergeStatics(root, live) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();

  // Protected = referenced by the game, or a descendant of something that is.
  const protectedSet = new Set();
  const markTree = (o) => {
    protectedSet.add(o);
    for (const c of o.children) markTree(c);
  };
  for (const o of live) {
    if (o === root || o.userData.mergeContainer) continue;
    if (o.isMesh || o.isGroup || o.isObject3D) markTree(o);
  }

  let protectedMeshes = 0;
  const buckets = new Map();
  const candidates = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isInstancedMesh || o.isSkinnedMesh || o.isSprite || o.isPoints || o.isLine) return;
    if (protectedSet.has(o)) { protectedMeshes++; return; }
    if (o.userData.noMerge) return;
    if (Array.isArray(o.material)) return;
    if (!o.geometry || !o.geometry.attributes.position) return;
    if (o.geometry.morphAttributes && Object.keys(o.geometry.morphAttributes).length) return;
    // anything hidden at build time is conditional; leave it alone
    let p = o;
    let ok = true;
    while (p && p !== root) {
      if (!p.visible) { ok = false; break; }
      p = p.parent;
    }
    if (!ok || !o.visible) return;
    candidates.push(o);
  });

  // A material still worn by something the game animates must not be swapped
  // out from under it, so those are excluded from the shared pool.
  const liveMats = new Set();
  root.traverse((o) => {
    if (o.isMesh && o.material && !Array.isArray(o.material) && protectedSet.has(o)) {
      liveMats.add(o.material.uuid);
    }
  });
  const pool = new Map();
  let deduped = 0;
  for (const o of candidates) {
    if (liveMats.has(o.material.uuid)) continue;
    const k = materialKey(o.material);
    const hit = pool.get(k);
    if (hit) {
      if (hit !== o.material) { o.material = hit; deduped++; }
    } else pool.set(k, o.material);
  }

  for (const o of candidates) {
    const key = `${o.material.uuid}|${o.castShadow ? 1 : 0}|${o.receiveShadow ? 1 : 0}|${o.renderOrder}|${o.layers.mask}`;
    let b = buckets.get(key);
    if (!b) { b = { mesh: o, list: [] }; buckets.set(key, b); }
    b.list.push(o);
  }

  let merged = 0;
  let removed = 0;
  for (const b of buckets.values()) {
    if (b.list.length < 2) continue;
    const geos = [];
    for (const o of b.list) {
      const g = normalise(o.geometry, !!o.material.vertexColors);
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      g.applyMatrix4(m);
      geos.push(g);
    }
    let out = null;
    try {
      out = mergeGeometries(geos, false);
    } catch (e) {
      void e;
      out = null;
    }
    for (const g of geos) g.dispose();
    if (!out) continue;
    const proto = b.mesh;
    const mesh = new THREE.Mesh(out, proto.material);
    mesh.castShadow = proto.castShadow;
    mesh.receiveShadow = proto.receiveShadow;
    mesh.renderOrder = proto.renderOrder;
    mesh.layers.mask = proto.layers.mask;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'merged:' + (proto.material.name || proto.material.type);
    root.add(mesh);
    merged++;
    for (const o of b.list) {
      if (o.parent) o.parent.remove(o);
      o.geometry.dispose();
      removed++;
    }
  }

  // strip now-empty groups so the matrix-update walk stays short
  const prune = (o) => {
    for (let i = o.children.length - 1; i >= 0; i--) prune(o.children[i]);
    if (o !== root && o.type === 'Group' && o.children.length === 0 && !protectedSet.has(o)) {
      o.parent && o.parent.remove(o);
    }
  };
  prune(root);

  return { merged, removed, deduped, protectedMeshes, buckets: buckets.size, candidates: candidates.length };
}

/** Replace lit materials with unlit ones. Used for the background room, which
 *  is pure set dressing and must not pay for the playfield's light rig. */
export function flattenToBasic(root) {
  const cache = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
    const m = o.material;
    if (m.isMeshBasicMaterial || m.isShaderMaterial || m.isRawShaderMaterial) return;
    const c0 = new THREE.Color(0x000000);
    if (m.color) c0.copy(m.color);
    if (m.emissive && (m.emissiveIntensity ?? 1) > 0) {
      c0.add(new THREE.Color().copy(m.emissive).multiplyScalar(m.emissiveIntensity ?? 1));
    }
    const key = [c0.getHexString(), m.map ? m.map.uuid : '-', m.transparent ? 1 : 0,
      Math.round((m.opacity ?? 1) * 100), m.side, m.depthWrite ? 1 : 0].join('|');
    let n = cache.get(key);
    if (!n) {
      n = new THREE.MeshBasicMaterial({
        color: c0,
        map: m.map || null,
        transparent: m.transparent,
        opacity: m.opacity,
        side: m.side,
        depthWrite: m.depthWrite,
        toneMapped: m.toneMapped !== false,
        fog: false,
      });
      n.name = (m.name || 'room') + ':flat';
      cache.set(key, n);
    }
    o.material = n;
    o.castShadow = false;
    o.receiveShadow = false;
  });
}

/** Bake per-mesh flat colour into vertex colours so an entire set of unlit,
 *  untextured props collapses onto ONE shared material — and therefore one
 *  draw call once merged. This is how the background room becomes free. */
export function bakeFlatColors(root) {
  const shared = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
    const m = o.material;
    if (!m.isMeshBasicMaterial || m.map || m.vertexColors) return;
    const g = o.geometry;
    if (!g || !g.attributes.position) return;
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    const c = m.color;
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    const key = `${m.transparent ? 1 : 0}|${Math.round((m.opacity ?? 1) * 100)}|${m.side}|${m.depthWrite ? 1 : 0}`;
    let sm = shared.get(key);
    if (!sm) {
      sm = new THREE.MeshBasicMaterial({
        color: 0xffffff, vertexColors: true, transparent: m.transparent,
        opacity: m.opacity, side: m.side, depthWrite: m.depthWrite, fog: false,
      });
      sm.name = 'roomFlat';
      shared.set(key, sm);
    }
    o.material = sm;
  });
  return shared.size;
}

/** Count what the renderer actually has to chew through. Cheap sanity probe. */
export function census(scene) {
  let lights = 0;
  let meshes = 0;
  let casters = 0;
  scene.traverse((o) => {
    if (!o.visible) return;
    if (o.isLight) lights++;
    if (o.isMesh) {
      meshes++;
      if (o.castShadow) casters++;
    }
  });
  return { lights, meshes, casters };
}
