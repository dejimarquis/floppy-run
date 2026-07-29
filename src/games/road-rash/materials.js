// Shared PBR material library. One instance per game; everything reuses these
// so the renderer keeps program switches (and draw calls) low.
import * as THREE from 'three';
import { ROAD_TEX_METERS } from './textures.js';

export class Materials {
  constructor(T, env, envIntensity = 1.0) {
    this.T = T;
    this.env = env;
    const E = envIntensity;

    // ---- road ------------------------------------------------------------
    const road = new THREE.MeshStandardMaterial({
      map: T.road.map,
      normalMap: T.road.normalMap,
      roughnessMap: T.road.roughnessMap,
      roughness: 1.0,
      metalness: 0.0,
      envMapIntensity: E * 0.55,
      normalScale: new THREE.Vector2(0.55, 0.55),
      dithering: true,
    });
    road.onBeforeCompile = (shader) => {
      shader.uniforms.uDetail = { value: T.roadDetail };
      shader.uniforms.uMacro = { value: T.roadMacro };
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform sampler2D uDetail;
           uniform sampler2D uMacro;`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           float dtlA = texture2D( uDetail, vMapUv * vec2( 3.1, 2.3 ) ).r;
           float dtlB = texture2D( uDetail, vMapUv * vec2( 0.41, 0.29 ) + 0.317 ).r;
           float mac  = texture2D( uMacro,  vMapUv * vec2( 0.055, 0.0165 ) ).r;
           diffuseColor.rgb *= ( 0.74 + dtlA * 0.52 ) * ( 0.82 + dtlB * 0.38 );
           diffuseColor.rgb *= mix( 0.82, 1.14, mac );
           float wet = smoothstep( 0.66, 0.93, mac );
           diffuseColor.rgb *= mix( 1.0, 0.55, wet );

           // ---- wear layer -------------------------------------------------
           // vMapUv.x spans the carriageway 0..1, vMapUv.y advances 1 unit per
           // 16m, so everything below is authored in real road coordinates.
           float u = vMapUv.x;
           float sMet = vMapUv.y * 16.0;
           // protect the painted lines: paint is the brightest thing on the
           // surface, and scrubbing wear over it makes the road look muddy
           float paint = smoothstep( 0.34, 0.62, dot( diffuseColor.rgb, vec3( 0.33 ) ) );
           float wearK = 1.0 - paint;

           // polished wheel tracks - four bands, tyres never track dead centre
           float trk = 0.0;
           trk += 1.0 - smoothstep( 0.0, 0.052, abs( u - 0.255 ) );
           trk += 1.0 - smoothstep( 0.0, 0.052, abs( u - 0.415 ) );
           trk += 1.0 - smoothstep( 0.0, 0.052, abs( u - 0.585 ) );
           trk += 1.0 - smoothstep( 0.0, 0.052, abs( u - 0.745 ) );
           // wander the tracks so they are not ruler-straight over a hill
           trk *= 0.75 + 0.25 * dtlB;
           trk = clamp( trk, 0.0, 1.0 ) * wearK;
           diffuseColor.rgb *= mix( 1.0, 0.72, trk );

           // grease line down each lane centre where sumps drip at the lights
           float oil = ( 1.0 - smoothstep( 0.0, 0.030, abs( u - 0.335 ) ) )
                     + ( 1.0 - smoothstep( 0.0, 0.030, abs( u - 0.665 ) ) );
           oil *= smoothstep( 0.42, 0.86, texture2D( uMacro, vMapUv * vec2( 0.02, 0.006 ) + 0.61 ).r );
           oil = clamp( oil, 0.0, 1.0 ) * wearK;
           diffuseColor.rgb *= mix( 1.0, 0.52, oil );

           // tar-band repairs: thresholded low-frequency noise, stretched along
           // the road so they read as strips a crew laid, not as blobs
           float pn = texture2D( uMacro, vMapUv * vec2( 0.17, 0.031 ) + 0.44 ).r;
           float rpatch = smoothstep( 0.70, 0.79, pn ) * wearK;
           diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.66 + vec3( 0.012 ), rpatch );

           // crack network: two ridged bands from the detail sheet, thin and dark
           float cA = texture2D( uDetail, vMapUv * vec2( 0.9, 0.16 ) + 0.19 ).r;
           float cB = texture2D( uDetail, vMapUv * vec2( 1.7, 0.34 ) + 0.77 ).r;
           float crack = ( 1.0 - smoothstep( 0.0, 0.030, abs( cA - 0.5 ) ) )
                       * ( 0.35 + 0.65 * smoothstep( 0.40, 0.72, cB ) );
           crack *= 0.35 + 0.65 * smoothstep( 0.30, 0.62, mac );
           crack *= wearK * ( 1.0 - rpatch );
           diffuseColor.rgb *= mix( 1.0, 0.34, clamp( crack, 0.0, 1.0 ) );

           // broken verge: the outer 6% of the slab crumbles into the shoulder
           float edge = 1.0 - smoothstep( 0.0, 0.062, min( u, 1.0 - u ) );
           float bite = smoothstep( 0.42, 0.78, texture2D( uDetail, vec2( sMet * 0.31, u * 6.0 ) ).r );
           float verge = clamp( edge * ( 0.35 + 0.65 * bite ), 0.0, 1.0 );
           diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.58 + vec3( 0.02, 0.019, 0.017 ), verge );`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
           float macR = texture2D( uMacro, vMapUv * vec2( 0.055, 0.0165 ) ).r;
           float dtlR = texture2D( uDetail, vMapUv * vec2( 3.1, 2.3 ) ).r;
           roughnessFactor *= mix( 1.02, 0.34, smoothstep( 0.62, 0.94, macR ) );
           roughnessFactor *= 0.9 + dtlR * 0.2;
           // wheel tracks are burnished by a million tyres: they are the
           // smoothest thing on the road and catch a long specular streak
           float uR = vMapUv.x;
           float trkR = 0.0;
           trkR += 1.0 - smoothstep( 0.0, 0.052, abs( uR - 0.255 ) );
           trkR += 1.0 - smoothstep( 0.0, 0.052, abs( uR - 0.415 ) );
           trkR += 1.0 - smoothstep( 0.0, 0.052, abs( uR - 0.585 ) );
           trkR += 1.0 - smoothstep( 0.0, 0.052, abs( uR - 0.745 ) );
           roughnessFactor *= mix( 1.0, 0.62, clamp( trkR, 0.0, 1.0 ) );
           // fresh tar patches are glossier than the aged surface around them
           float pnR = texture2D( uMacro, vMapUv * vec2( 0.17, 0.031 ) + 0.44 ).r;
           roughnessFactor *= mix( 1.0, 0.70, smoothstep( 0.70, 0.79, pnR ) );
           // cracks and the crumbled verge are matte
           float edgeR = 1.0 - smoothstep( 0.0, 0.062, min( uR, 1.0 - uR ) );
           roughnessFactor *= mix( 1.0, 1.22, edgeR );
           roughnessFactor = clamp( roughnessFactor, 0.06, 1.0 );`
        );
    };
    road.customProgramCacheKey = () => 'af-road-wear';
    this.road = road;

    // ---- terrain / gravel -------------------------------------------------
    this.terrain = new THREE.MeshStandardMaterial({
      map: T.terrain.map,
      normalMap: T.terrain.normalMap,
      roughness: 0.97,
      metalness: 0.0,
      vertexColors: true,
      envMapIntensity: E * 0.5,
      normalScale: new THREE.Vector2(1.0, 1.0),
    });

    // Triplanar + slope blend. The verge banks hard into cuttings and up onto
    // embankments; a single planar projection smears the grass sheet into
    // vertical streaks on every one of those faces, which is the single most
    // obvious "flat ground plane with a picture on it" tell. Project on all
    // three axes, weight by the world normal, and swap in the rock sheet as
    // the slope steepens so cut faces read as exposed ground, not stretched turf.
    this.terrain.onBeforeCompile = (shader) => {
      shader.uniforms.uRock = { value: T.rock.map };
      shader.uniforms.uRockN = { value: T.rock.normalMap };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n varying vec3 vWPos; varying vec3 vWNrm;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
           vWNrm = normalize( mat3( modelMatrix ) * objectNormal );`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vWPos; varying vec3 vWNrm;
           uniform sampler2D uRock; uniform sampler2D uRockN;
           vec4 triplanar( sampler2D t, vec3 p, vec3 w, float sc ) {
             return texture2D( t, p.zy * sc ) * w.x
                  + texture2D( t, p.xz * sc ) * w.y
                  + texture2D( t, p.xy * sc ) * w.z;
           }`
        )
        .replace(
          '#include <map_fragment>',
          `vec3 tpN = abs( normalize( vWNrm ) );
           tpN = pow( tpN, vec3( 5.0 ) );
           tpN /= max( tpN.x + tpN.y + tpN.z, 1e-4 );
           // two octaves at incommensurate scales kills the visible repeat
           vec4 gA = triplanar( map, vWPos, tpN, 0.11 );
           vec4 gB = triplanar( map, vWPos, tpN, 0.0287 );
           vec4 grnd = gA * 0.62 + gB * 0.58;
           vec4 rkA = triplanar( uRock, vWPos, tpN, 0.085 );
           vec4 rkB = triplanar( uRock, vWPos, tpN, 0.021 );
           vec4 rk = rkA * 0.6 + rkB * 0.6;
           float slope = 1.0 - clamp( normalize( vWNrm ).y, 0.0, 1.0 );
           float rockW = smoothstep( 0.16, 0.42, slope );
           // height-based break-up so the transition is not a clean contour
           rockW = clamp( rockW + ( gB.r - 0.5 ) * 0.55, 0.0, 1.0 );
           vec4 sampledDiffuseColor = mix( grnd, rk, rockW );
           diffuseColor *= sampledDiffuseColor;
           float vTri = rockW;`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `vec3 mapNt = mix(
             triplanar( normalMap, vWPos, tpN, 0.11 ).xyz,
             triplanar( uRockN, vWPos, tpN, 0.085 ).xyz, vTri ) * 2.0 - 1.0;
           mapNt.xy *= normalScale;
           normal = normalize( normal + vec3( mapNt.x, mapNt.y, 0.0 ) * 0.85 );`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = roughness * mix( 1.0, 0.86, vTri );`
        );
    };
    this.terrain.customProgramCacheKey = () => 'af-terrain-tri';

    this.rock = new THREE.MeshStandardMaterial({
      map: T.rock.map,
      normalMap: T.rock.normalMap,
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: E * 0.5,
    });

    this.distant = new THREE.MeshStandardMaterial({
      color: 0x6d7d92,
      roughness: 1.0,
      metalness: 0.0,
      vertexColors: true,
      envMapIntensity: E * 0.8,
    });

    // ---- metal ------------------------------------------------------------
    this.rail = new THREE.MeshStandardMaterial({
      map: T.rail.map,
      normalMap: T.rail.normalMap,
      roughnessMap: T.rail.roughnessMap,
      roughness: 1.0,
      metalness: 0.34,
      envMapIntensity: E * 0.3,
    });

    this.darkMetal = new THREE.MeshStandardMaterial({
      color: 0x2a2d33,
      roughness: 0.55,
      metalness: 0.9,
      envMapIntensity: E,
    });

    this.chrome = new THREE.MeshStandardMaterial({
      color: 0xd6dae0,
      roughness: 0.16,
      metalness: 1.0,
      envMapIntensity: E * 0.85,
    });

    this.brushed = new THREE.MeshStandardMaterial({
      color: 0x9aa0a8,
      roughness: 0.34,
      metalness: 1.0,
      envMapIntensity: E * 1.15,
    });

    // radiator core: very dark, rough, almost no reflection
    // dark anodised wheel alloy + almost-black brake rotor: the old bright
    // chrome versions read as one solid white disc from any distance
    this.wheelAlloy = new THREE.MeshStandardMaterial({
      color: 0x3b3f46,
      roughness: 0.38,
      metalness: 0.95,
      envMapIntensity: E * 0.6,
    });
    this.rotor = new THREE.MeshStandardMaterial({
      color: 0x53585f,
      roughness: 0.48,
      metalness: 0.9,
      envMapIntensity: E * 0.45,
      side: THREE.DoubleSide,
    });

    // heat-tinted titanium: exhaust cans and fork sliders
    this.titanium = new THREE.MeshStandardMaterial({
      color: 0x6d6a68,
      roughness: 0.42,
      metalness: 1.0,
      envMapIntensity: E * 0.6,
    });

    this.rad = new THREE.MeshStandardMaterial({
      color: 0x0c0e11,
      roughness: 0.85,
      metalness: 0.7,
      envMapIntensity: E * 0.25,
    });

    this.concrete = new THREE.MeshStandardMaterial({
      map: T.concrete.map,
      normalMap: T.concrete.normalMap,
      roughnessMap: T.concrete.roughnessMap,
      roughness: 1.0,
      metalness: 0.0,
      envMapIntensity: E * 0.55,
    });

    // ---- rubber / plastic -------------------------------------------------
    this.rubber = new THREE.MeshStandardMaterial({
      color: 0x0e0f11,
      roughness: 0.88,
      metalness: 0.0,
      normalMap: T.tireNormal,
      normalScale: new THREE.Vector2(1.4, 1.4),
      envMapIntensity: E * 0.45,
    });
    this.rubberSmooth = new THREE.MeshStandardMaterial({
      color: 0x111214,
      roughness: 0.7,
      metalness: 0.0,
      envMapIntensity: E * 0.5,
    });
    this.plastic = new THREE.MeshStandardMaterial({
      color: 0x1a1c20,
      roughness: 0.45,
      metalness: 0.05,
      envMapIntensity: E * 0.8,
    });

    // ---- rider ------------------------------------------------------------
    this.leather = new THREE.MeshPhysicalMaterial({
      color: 0x1b1d22,
      map: T.leather.map,
      normalMap: T.leather.normalMap,
      roughness: 0.52,
      metalness: 0.0,
      sheen: 0.85,
      sheenRoughness: 0.42,
      sheenColor: new THREE.Color(0x9fb6d8),
      clearcoat: 0.28,
      clearcoatRoughness: 0.4,
      envMapIntensity: E * 0.9,
    });
    this.skin = new THREE.MeshStandardMaterial({ color: 0x8a5f45, roughness: 0.7, envMapIntensity: E * 0.6 });

    this.visor = new THREE.MeshPhysicalMaterial({
      color: 0x101318,
      roughness: 0.06,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
      envMapIntensity: E * 1.6,
      iridescence: 0.0,
      transmission: 0.0,
      side: THREE.DoubleSide,
    });

    this.glass = new THREE.MeshPhysicalMaterial({
      color: 0x8fa6bd,
      roughness: 0.05,
      metalness: 0.0,
      transmission: 0.0,
      opacity: 0.20,
      transparent: true,
      depthWrite: false,
      clearcoat: 1.0,
      envMapIntensity: E * 0.75,
      side: THREE.DoubleSide,
    });

    this.emissiveWhite = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfff3d6,
      emissiveIntensity: 2.6,
      roughness: 0.3,
      toneMapped: true,
    });
    this.emissiveRed = new THREE.MeshStandardMaterial({
      color: 0x330000,
      emissive: 0xff1606,
      emissiveIntensity: 2.4,
      roughness: 0.4,
    });
    this.emissiveAmber = new THREE.MeshStandardMaterial({
      color: 0x331500,
      emissive: 0xff9a2a,
      emissiveIntensity: 2.2,
      roughness: 0.4,
    });
    this.emissiveBlue = new THREE.MeshStandardMaterial({
      color: 0x001133,
      emissive: 0x2a7bff,
      emissiveIntensity: 3.0,
      roughness: 0.4,
    });
    this.tunnelLight = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffe6b0,
      emissiveIntensity: 2.6,
      roughness: 0.5,
    });

    // ---- foliage ----------------------------------------------------------
    this.grass = new THREE.MeshStandardMaterial({
      map: T.grass,
      alphaTest: 0.4,
      transparent: false,
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0,
      envMapIntensity: E * 0.7,
    });
    this.foliage = new THREE.MeshStandardMaterial({
      map: T.foliage,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0,
      envMapIntensity: E * 0.7,
      vertexColors: true,
    });
    this.bark = new THREE.MeshStandardMaterial({ color: 0x3b2f26, roughness: 0.95, envMapIntensity: E * 0.4 });
    this.canopy = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: T.needles,
      alphaTest: 0.42,
      roughness: 0.9,
      metalness: 0,
      vertexColors: true,
      side: THREE.DoubleSide,
      envMapIntensity: E * 0.6,
      // Backlit against a low sun, foliage receives only blue sky IBL and goes
      // navy. Real leaves scatter transmitted light, so a faint warm-green term
      // stands in for subsurface and keeps a silhouetted stand reading as trees.
      emissive: 0x16220e,
      emissiveIntensity: 0.9,
    });
    this.canopyLeaf = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: T.leaves,
      alphaTest: 0.42,
      roughness: 0.92,
      metalness: 0,
      vertexColors: true,
      side: THREE.DoubleSide,
      envMapIntensity: E * 0.6,
      emissive: 0x1a2610,
      emissiveIntensity: 1.0,
    });

    // ---- vertex wind -------------------------------------------------------
    // Foliage that does not move is the single loudest "this is a game from
    // 2006" tell. Two summed sine bands (a slow bough sway + a fast leaf
    // flutter) displaced in world X/Z, weighted by height above the instance
    // origin so trunks stay planted. Phase is derived from the instance's own
    // world position so no two trees are in sync.
    this.wind = { value: 0 };
    const applyWind = (mat, sway, flutter, hRef, key) => {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uWind = this.wind;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\n uniform float uWind;')
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             #ifdef USE_INSTANCING
               vec3 wOrigin = instanceMatrix[3].xyz;
             #else
               vec3 wOrigin = vec3( 0.0 );
             #endif
             float wPhase = wOrigin.x * 0.21 + wOrigin.z * 0.17;
             float wH = clamp( transformed.y / ${hRef.toFixed(2)}, 0.0, 1.6 );
             float gust = 0.62 + 0.38 * sin( uWind * 0.23 + wPhase * 0.11 );
             float bough = sin( uWind * 1.05 + wPhase ) * ${sway.toFixed(3)};
             float leaf  = sin( uWind * 3.7 + wPhase * 2.3 + transformed.y * 0.9 ) * ${flutter.toFixed(3)};
             float amp = ( bough + leaf ) * wH * wH * gust;
             transformed.x += amp;
             transformed.z += amp * 0.55;
             transformed.y -= abs( amp ) * 0.18;`
          );
      };
      mat.customProgramCacheKey = () => key;
    };
    applyWind(this.canopy, 0.34, 0.09, 9.0, 'af-canopy');
    applyWind(this.canopyLeaf, 0.46, 0.14, 8.0, 'af-canopyleaf');
    applyWind(this.grass, 0.16, 0.07, 1.0, 'af-grass');
    applyWind(this.foliage, 0.2, 0.08, 1.4, 'af-foliage');

    this.lightCone = new THREE.MeshBasicMaterial({
      color: 0xffdca8,
      transparent: true,
      opacity: 0.09,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.skid = new THREE.MeshBasicMaterial({
      map: T.skid,
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    this.signMats = {};
    for (const k of Object.keys(T.signs)) {
      this.signMats[k] = new THREE.MeshStandardMaterial({
        map: T.signs[k],
        roughness: 0.42,
        metalness: 0.1,
        transparent: true,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
        envMapIntensity: E * 1.2,
      });
    }
    this.billboardMats = T.billboards.map(
      (m) =>
        new THREE.MeshStandardMaterial({
          map: m,
          roughness: 0.6,
          metalness: 0.05,
          envMapIntensity: E * 0.9,
          side: THREE.FrontSide,
        })
    );
  }

  // Painted bodywork with clearcoat — one per unique colour.
  paint(color, { flake = 0.0, roughness = 0.24, clearcoat = 1.0, env = 0.86 } = {}) {
    const m = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color),
      roughness,
      metalness: flake > 0 ? 0.75 : 0.15,
      clearcoat,
      clearcoatRoughness: 0.13,
      envMapIntensity: (this.envIntensity || 1) * env,
      reflectivity: 0.32,
    });
    return m;
  }

  roadUVRepeatFor(lengthMeters) {
    return lengthMeters / ROAD_TEX_METERS;
  }
}
