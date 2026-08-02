// Post-processing: scene -> HDR target -> bright prefilter -> separable blur
// -> single grade pass (bloom composite, ACES tonemap, sRGB encode, radial
// motion blur, chromatic aberration, speed streaks, vignette, grain, flashes).
//
// This replaces an EffectComposer stack of UnrealBloomPass + OutputPass +
// grade + SMAAPass. That stack cost 19 shader programs — 19 compile stalls at
// boot — and it tone-mapped twice (once via renderer.toneMapping during the
// scene render, once again in OutputPass), which is what flattened every
// midtone into the washed-out look. The whole chain is now three programs and
// tone-maps exactly once, at the end, in linear HDR.
//
// Antialiasing comes from a 4x multisampled scene target instead of SMAA:
// cheaper, three fewer programs, and it resolves before anything reads it.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }`;

// ---------------------------------------------------------------- prefilter
// Bright-pass + 4-tap box downsample in one go. Soft knee so the bloom ramps
// in rather than popping on when a highlight crosses the threshold.
const PrefilterShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
    uThreshold: { value: 0.75 },
    uKnee: { value: 0.45 },
  },
  vertexShader: QUAD_VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uThreshold, uKnee;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D( tDiffuse, vUv + uTexel * vec2( -1.0, -1.0 ) ).rgb
             + texture2D( tDiffuse, vUv + uTexel * vec2(  1.0, -1.0 ) ).rgb
             + texture2D( tDiffuse, vUv + uTexel * vec2( -1.0,  1.0 ) ).rgb
             + texture2D( tDiffuse, vUv + uTexel * vec2(  1.0,  1.0 ) ).rgb;
      c *= 0.25;
      float b = max( c.r, max( c.g, c.b ) );
      float soft = clamp( b - uThreshold + uKnee, 0.0, 2.0 * uKnee );
      soft = soft * soft / ( 4.0 * uKnee + 1e-4 );
      float w = max( soft, b - uThreshold ) / max( b, 1e-4 );
      gl_FragColor = vec4( c * w, 1.0 );
    }`,
};

// --------------------------------------------------------------------- blur
// One 9-tap gaussian material driven by a direction uniform, so the horizontal
// and vertical halves share a single compiled program.
const BlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    uDir: { value: new THREE.Vector2(1 / 512, 0) },
  },
  vertexShader: QUAD_VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uDir;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D( tDiffuse, vUv ).rgb * 0.2270270270;
      c += texture2D( tDiffuse, vUv + uDir * 1.3846153846 ).rgb * 0.3162162162;
      c += texture2D( tDiffuse, vUv - uDir * 1.3846153846 ).rgb * 0.3162162162;
      c += texture2D( tDiffuse, vUv + uDir * 3.2307692308 ).rgb * 0.0702702703;
      c += texture2D( tDiffuse, vUv - uDir * 3.2307692308 ).rgb * 0.0702702703;
      gl_FragColor = vec4( c, 1.0 );
    }`,
};

export const GradeShader = {
  name: 'AsphaltFuryGrade',
  uniforms: {
    tDiffuse: { value: null },
    tBloom: { value: null },
    uBloom: { value: 0.55 },
    uExposure: { value: 1.0 },
    uHorizon: { value: 0.5 },
    uTime: { value: 0 },
    uAspect: { value: 1.777 },
    uBlur: { value: 0.0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uCA: { value: 0.0009 },
    uVignette: { value: 0.9 },
    uGrain: { value: 0.055 },
    uDamage: { value: 0.0 },
    uFlash: { value: 0.0 },
    uSlowmo: { value: 0.0 },
    uSat: { value: 1.1 },
    uContrast: { value: 1.06 },
    uWarm: { value: 1.0 },
    uSpeed: { value: 0.0 },
    uLift: { value: 0.0 },
    uTeal: { value: 1.0 },
  },
  vertexShader: QUAD_VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    uniform float uTime, uAspect, uBlur, uCA, uVignette, uGrain, uDamage, uFlash, uSlowmo, uSat, uContrast, uWarm, uSpeed, uLift, uTeal;
    uniform float uHorizon, uBloom, uExposure;
    uniform vec2 uCenter;
    varying vec2 vUv;

    float hash( vec2 p ) {
      p = fract( p * vec2( 443.897, 441.423 ) );
      p += dot( p, p.yx + 19.19 );
      return fract( ( p.x + p.y ) * p.x );
    }

    vec3 sampleRadial( vec2 uv, vec2 dir, vec2 ca ) {
      float r = texture2D( tDiffuse, uv + dir + ca ).r;
      float g = texture2D( tDiffuse, uv + dir ).g;
      float b = texture2D( tDiffuse, uv + dir - ca ).b;
      return vec3( r, g, b );
    }

    // ACES filmic, fitted. Applied ONCE, here, on linear HDR input.
    vec3 aces( vec3 x ) {
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp( ( x * ( a * x + b ) ) / ( x * ( c * x + d ) + e ), 0.0, 1.0 );
    }

    vec3 toSRGB( vec3 c ) {
      return mix( c * 12.92, 1.055 * pow( max( c, vec3( 0.0 ) ), vec3( 0.41666 ) ) - 0.055, step( 0.0031308, c ) );
    }

    void main() {
      vec2 uv = vUv;
      vec2 toC = uv - uCenter;
      float radial = length( toC * vec2( uAspect, 1.0 ) );

      // chromatic aberration grows toward the frame edge, along the radius.
      vec2 caDir = toC * ( uCA * ( 0.10 + radial * radial * 1.6 ) );

      // Radial motion blur, masked to the ground plane by the projected screen
      // Y of the true horizon (uHorizon, recomputed on the CPU each frame).
      // Sky, ridgeline and cloud must stay razor sharp or the whole frame reads
      // as a screen filter rather than speed.
      float depthMask = clamp( ( uHorizon - uv.y ) / 0.26, 0.0, 1.0 );
      depthMask *= depthMask;
      float blurMask = smoothstep( 0.14, 0.80, radial ) * depthMask;

      vec3 col = vec3( 0.0 );
      float total = 0.0;
      const int TAPS = 14;
      float jitter = hash( uv * 733.0 + fract( uTime ) * 61.0 ) * 0.6;
      for ( int i = 0; i < TAPS; i++ ) {
        float f = ( float( i ) + jitter ) / float( TAPS - 1 );
        float w = 1.0 - f * 0.55;
        vec2 dir = -toC * uBlur * blurMask * f;
        col += sampleRadial( uv, dir, caDir ) * w;
        total += w;
      }
      col /= total;

      // ---- bloom ----------------------------------------------------------
      col += texture2D( tBloom, uv ).rgb * uBloom;

      // ---- screen-space speed streaks -------------------------------------
      // Thin bright radial slivers seeded from the angle around the focal
      // point: the classic Road Rash "rush" read, legible even on a still.
      if ( uSpeed > 0.01 ) {
        float notSky = step( uv.y, uHorizon - 0.01 );
        float ang = atan( toC.y, toC.x * uAspect );
        float seedA = floor( ang * 13.0 );
        float rnd = hash( vec2( seedA, 3.7 ) );
        float lane = fract( ang * 13.0 );
        float sliver = smoothstep( 0.5, 0.0, abs( lane - 0.5 ) * 2.0 );
        sliver = pow( sliver, 3.0 );
        float travel = fract( rnd * 7.13 + uTime * ( 2.4 + rnd * 3.0 ) );
        // Confined to the extreme outer edge of the frame: streaks across the
        // tarmac the player is aiming at read as scan-lines, not as velocity,
        // and at the previous strength they laid a white grid over the grass,
        // the guardrail and the road at ordinary cruising speed.
        float band = smoothstep( 0.62, 0.95, radial ) * ( 1.0 - smoothstep( 1.02, 1.45, radial ) );
        float streak = sliver * band * smoothstep( 0.0, 0.30, travel ) * ( 1.0 - travel ) * notSky;
        col += vec3( 0.85, 0.94, 1.0 ) * streak * uSpeed * 0.75;
      }

      // ---- exposure + tonemap (linear HDR in, display linear out) ---------
      col = aces( col * uExposure );
      col = toSRGB( col );

      // ---- grade: teal shadows / warm highlights, punched up --------------
      float lum = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      vec3 shadowTint = mix( vec3( 1.0 ), vec3( 0.90, 0.985, 1.10 ), uTeal );
      vec3 highTint = mix( vec3( 1.0 ), vec3( 1.09, 1.015, 0.92 ), uWarm );
      vec3 tint = mix( shadowTint, highTint, smoothstep( 0.10, 0.70, lum ) );
      col *= tint;
      col = ( col - 0.5 ) * uContrast + 0.5;
      col = mix( vec3( lum ), col, uSat );

      col = clamp( col, 0.0, 1.0 );
      vec3 sc = col * col * ( 3.0 - 2.0 * col );
      col = mix( col, sc, 0.42 );
      // Black point: guarantee the darkest part of the frame reaches near-black
      // instead of sitting in milky mud.
      col = max( vec3( 0.0 ), ( col - 0.030 ) / 0.970 );
      col = min( vec3( 1.0 ), col * 1.09 );
      col += uLift;

      // slow-motion: desaturate + push blue
      float lum2 = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      col = mix( col, mix( vec3( lum2 ), col * vec3( 0.8, 0.9, 1.25 ), 0.55 ), uSlowmo );

      // damage: a narrow edge gel only - it must never wash the sky or road
      float dmgV = smoothstep( 0.70, 1.26, radial );
      col = mix( col, mix( col, vec3( 0.62, 0.05, 0.03 ), 0.42 ), dmgV * uDamage );

      float vig = 1.0 - uVignette * smoothstep( 0.42, 1.28, radial ) * 0.55;
      col *= vig;

      float g = hash( uv * vec2( 1920.0, 1080.0 ) + fract( uTime ) * 137.0 ) - 0.5;
      col += g * uGrain * ( 1.25 - lum * 0.8 );

      col += uFlash;

      gl_FragColor = vec4( max( col, 0.0 ), 1.0 );
    }`,
};

function makeQuad(def) {
  return new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(def.uniforms),
      vertexShader: def.vertexShader,
      fragmentShader: def.fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    })
  );
}

export class PostFX {
  constructor(renderer, scene, camera, quality = 'ultra') {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());

    const samples = quality === 'low' ? 0 : quality === 'med' ? 2 : 4;
    // `low` keeps the entire grade and buys the cost back with a 0.72x internal
    // buffer instead. Deleting the art direction is not a quality tier.
    this.scale = quality === 'low' ? 0.72 : 1;
    this.bloomDiv = quality === 'low' ? 8 : 4;

    const bw = Math.max(2, Math.round(size.x * this.scale));
    const bh = Math.max(2, Math.round(size.y * this.scale));

    this.rt = new THREE.WebGLRenderTarget(bw, bh, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      samples,
    });
    const bopts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.bloomA = new THREE.WebGLRenderTarget(2, 2, bopts);
    this.bloomB = new THREE.WebGLRenderTarget(2, 2, bopts);

    this.prefilter = makeQuad(PrefilterShader);
    this.blur = makeQuad(BlurShader);
    this.grade = makeQuad(GradeShader);
    // main.js pokes uniforms through post.grade.uniforms
    this.grade.uniforms = this.grade.material.uniforms;

    this.setSize(size.x, size.y);
  }

  setSize(w, h) {
    const bw = Math.max(2, Math.round(w * this.scale));
    const bh = Math.max(2, Math.round(h * this.scale));
    this.rt.setSize(bw, bh);
    const d = this.bloomDiv;
    this.bw = Math.max(2, Math.round(bw / d));
    this.bh = Math.max(2, Math.round(bh / d));
    this.bloomA.setSize(this.bw, this.bh);
    this.bloomB.setSize(this.bw, this.bh);
    this.prefilter.material.uniforms.uTexel.value.set(1 / bw, 1 / bh);
    this.grade.uniforms.uAspect.value = w / h;
  }

  setParams(p) {
    const u = this.grade.uniforms;
    for (const k of Object.keys(p)) {
      if (u[k]) u[k].value = p[k];
    }
  }

  render(dt) {
    const r = this.renderer;
    this.grade.uniforms.uTime.value += dt;

    r.setRenderTarget(this.rt);
    r.render(this.scene, this.camera);

    // bright prefilter + downsample
    this.prefilter.material.uniforms.tDiffuse.value = this.rt.texture;
    r.setRenderTarget(this.bloomA);
    this.prefilter.render(r);

    // separable blur, two passes through the one material
    const bu = this.blur.material.uniforms;
    bu.tDiffuse.value = this.bloomA.texture;
    bu.uDir.value.set(1 / this.bw, 0);
    r.setRenderTarget(this.bloomB);
    this.blur.render(r);

    bu.tDiffuse.value = this.bloomB.texture;
    bu.uDir.value.set(0, 1 / this.bh);
    r.setRenderTarget(this.bloomA);
    this.blur.render(r);

    // composite + tonemap + grade straight to the screen
    this.grade.uniforms.tDiffuse.value = this.rt.texture;
    this.grade.uniforms.tBloom.value = this.bloomA.texture;
    r.setRenderTarget(null);
    this.grade.render(r);
  }

  // Warm all three post programs so none of them stalls on the first frame.
  precompile() {
    this.render(0);
  }

  dispose() {
    this.rt.dispose();
    this.bloomA.dispose();
    this.bloomB.dispose();
    this.prefilter.dispose();
    this.blur.dispose();
    this.grade.dispose();
  }
}
