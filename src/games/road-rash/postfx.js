// Post-processing stack: bloom -> tonemap -> cinematic grade (radial motion
// blur, chromatic aberration, teal/orange grade, vignette, grain, hit flashes)
// -> SMAA.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

export const GradeShader = {
  name: 'AsphaltFuryGrade',
  uniforms: {
    tDiffuse: { value: null },
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
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAspect, uBlur, uCA, uVignette, uGrain, uDamage, uFlash, uSlowmo, uSat, uContrast, uWarm, uSpeed, uLift, uTeal;
    uniform float uHorizon;
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

    void main() {
      vec2 uv = vUv;
      vec2 toC = uv - uCenter;
      float radial = length( toC * vec2( uAspect, 1.0 ) );

      // chromatic aberration grows toward the frame edge, along the radius.
      // Kept low: at higher values 1px geometry (power lines, guardrail edges)
      // separates into rainbow moire.
      vec2 caDir = toC * ( uCA * ( 0.10 + radial * radial * 1.6 ) );

      // Radial motion blur, DEPTH MASKED. Streaking the clouds and the distant
      // ridgeline is the single loudest "this is a screen filter" tell; only
      // geometry rushing past the lens should smear, so blur is full under 40 m
      // and zero past 220 m.
      // Distance proxy: the horizon line. Everything the lens can smear is
      // ground rushing past below it, and everything above it is sky, ridge and
      // cloud, which must stay razor sharp. uHorizon is the projected screen Y
      // of the true horizon, recomputed on the CPU every frame, so this tracks
      // pitch, crests and camera shake exactly. (A DepthTexture was tried first
      // and is a trap here: EffectComposer clones the target it is given, so
      // the attached depth map never receives a write.)
      float depthMask = clamp( ( uHorizon - uv.y ) / 0.26, 0.0, 1.0 );
      depthMask *= depthMask;
      float blurMask = smoothstep( 0.22, 0.86, radial ) * depthMask;

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

      // ---- screen-space speed streaks -------------------------------------
      // Thin bright/dark radial slivers seeded from the angle around the focal
      // point. This is the classic Road Rash "rush" read and it works even on
      // a still frame with the HUD masked off.
      if ( uSpeed > 0.01 ) {
        float notSky = step( uv.y, uHorizon - 0.01 );
        float ang = atan( toC.y, toC.x * uAspect );
        float seedA = floor( ang * 26.0 );
        float rnd = hash( vec2( seedA, 3.7 ) );
        float lane = fract( ang * 26.0 );
        float sliver = smoothstep( 0.5, 0.0, abs( lane - 0.5 ) * 2.0 );
        sliver = pow( sliver, 6.0 );
        float travel = fract( rnd * 7.13 + uTime * ( 1.3 + rnd * 1.7 ) );
        float band = smoothstep( 0.30, 0.66, radial ) * ( 1.0 - smoothstep( 0.82, 1.30, radial ) );
        float streak = sliver * band * smoothstep( 0.0, 0.35, travel ) * ( 1.0 - travel ) * notSky;
        col += vec3( 0.85, 0.90, 1.0 ) * streak * uSpeed * 0.20;
        // and a matching darkening on the alternate lanes for grit
        col *= 1.0 - sliver * band * notSky * uSpeed * 0.12 * step( 0.5, rnd );
      }

      // ---- grade: filmic teal shadows / warm highlights --------------------
      float lum = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      vec3 shadowTint = mix( vec3( 1.0 ), vec3( 0.90, 0.985, 1.10 ), uTeal );
      vec3 highTint = mix( vec3( 1.0 ), vec3( 1.09, 1.015, 0.92 ), uWarm );
      vec3 tint = mix( shadowTint, highTint, smoothstep( 0.10, 0.70, lum ) );
      col *= tint;
      col = ( col - 0.5 ) * uContrast + 0.5;
      col = mix( vec3( lum ), col, uSat );

      // Contrast S-curve that is a true 0->0 / 1->1 mapping (the frame is
      // already ACES-tonemapped and sRGB-encoded by OutputPass, so a second
      // filmic curve here would just eat the highlights).
      col = clamp( col, 0.0, 1.0 );
      vec3 sc = col * col * ( 3.0 - 2.0 * col );
      col = mix( col, sc, 0.42 );
      // Black point: guarantee the darkest part of the frame actually reaches
      // near-black instead of sitting in milky mud.
      col = max( vec3( 0.0 ), ( col - 0.028 ) / 0.972 );
      // White point: lift the top so real speculars land above 0.9.
      col = min( vec3( 1.0 ), col * 1.075 );
      col += uLift;

      // slow-motion: desaturate + push blue
      float lum2 = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      col = mix( col, mix( vec3( lum2 ), col * vec3( 0.8, 0.9, 1.25 ), 0.55 ), uSlowmo );

      // damage: a narrow edge gel only - it must never wash the sky or the road
      float dmgV = smoothstep( 0.74, 1.30, radial );
      col = mix( col, mix( col, vec3( 0.52, 0.04, 0.03 ), 0.30 ), dmgV * uDamage );

      // vignette
      float vig = 1.0 - uVignette * smoothstep( 0.42, 1.28, radial ) * 0.55;
      col *= vig;

      // film grain
      float g = hash( uv * vec2( 1920.0, 1080.0 ) + fract( uTime ) * 137.0 ) - 0.5;
      col += g * uGrain * ( 1.25 - lum * 0.8 );

      col += uFlash;

      gl_FragColor = vec4( max( col, 0.0 ), 1.0 );
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, quality = 'ultra') {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());

    const samples = quality === 'ultra' ? 4 : quality === 'high' ? 2 : 0;
    // `low` keeps the entire grade - blur, vignette, teal/orange, grain - and
    // buys the cost back with a 0.72x internal buffer instead. Deleting the
    // art direction to save frames is not a quality tier, it is a different
    // looking game.
    this.scale = quality === 'low' ? 0.72 : 1;
    const bw = Math.max(2, Math.round(size.x * this.scale));
    const bh = Math.max(2, Math.round(size.y * this.scale));
    const rt = new THREE.WebGLRenderTarget(bw, bh, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      samples,
    });
    this.rt = rt;
    const composer = new EffectComposer(renderer, rt);
    composer.setSize(bw, bh);
    this.composer = composer;

    composer.addPass(new RenderPass(scene, camera));

    const bloomStrength = quality === 'low' ? 0.20 : 0.24;
    const bloom = new UnrealBloomPass(new THREE.Vector2(bw, bh), bloomStrength, 0.34, 1.25);
    this.bloom = bloom;
    composer.addPass(bloom);

    const out = new OutputPass();
    composer.addPass(out);

    const grade = new ShaderPass(
      quality === 'low' ? { ...GradeShader, fragmentShader: GradeShader.fragmentShader.replace('const int TAPS = 14;', 'const int TAPS = 5;') } : GradeShader
    );
    this.grade = grade;
    if (quality === 'low') grade.uniforms.uCA.value = 0;
    composer.addPass(grade);

    if (quality !== 'low') {
      const smaa = new SMAAPass();
      this.smaa = smaa;
      composer.addPass(smaa);
    }
    this.setSize(size.x, size.y);
  }

  setSize(w, h) {
    const bw = Math.max(2, Math.round(w * this.scale));
    const bh = Math.max(2, Math.round(h * this.scale));
    this.composer.setSize(bw, bh);
    this.grade.uniforms.uAspect.value = w / h;
    if (this.bloom) this.bloom.setSize(bw, bh);
    if (this.smaa) this.smaa.setSize(bw, bh);
  }

  setParams(p) {
    const u = this.grade.uniforms;
    for (const k of Object.keys(p)) {
      if (u[k]) u[k].value = p[k];
    }
  }

  render(dt) {
    this.grade.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
