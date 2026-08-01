// Post-processing stack: HDR render -> threshold bloom -> cinematic grade
// (radial speed blur, chromatic aberration, vignette, grain, colour grade)
// -> ACES output -> SMAA.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

export const GradeShader = {
  name: 'CrashoutGrade',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSpeed: { value: 0 },        // 0..1 radial blur strength
    uBoost: { value: 0 },        // 0..1 boost look
    uCrash: { value: 0 },        // 0..1 crash-cam look
    uFlash: { value: 0 },        // impact white flash
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1.777 },
    uGrain: { value: 0.013 },
    uVignette: { value: 0.85 },
    uSat: { value: 1.16 },
    uTint: { value: new THREE.Color(0.98, 1.0, 1.10) },
    uBlack: { value: 0.021 },                          // hard black point
    uHero: { value: new THREE.Vector2(0.5, 0.42) },    // hero car in screen uv
    uHeroR: { value: 0.20 },                           // hero protection radius
    uShockC: { value: new THREE.Vector2(0.5, 0.5) },   // impact shockwave centre
    uShock: { value: 0 },                              // 0..1 shockwave life
    uShockR: { value: 0 },                             // current ring radius
  },
  vertexShader: `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    #ifndef TAPS
    #define TAPS 12
    #endif
    uniform sampler2D tDiffuse;
    uniform float uTime, uSpeed, uBoost, uCrash, uFlash, uAspect, uGrain, uVignette, uSat;
    uniform float uBlack, uHeroR, uShock, uShockR;
    uniform vec2 uCenter, uHero, uShockC;
    uniform vec3 uTint;
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main(){
      float boost = clamp(uBoost, 0.0, 1.0);
      float crash = clamp(uCrash, 0.0, 1.0);
      float spd = clamp(uSpeed, 0.0, 1.4);
      vec2 uv = vUv;

      // ---- impact shockwave: a screen-space radial pinch that rides outward
      // from the impact point. Replaces the old ground ring decal entirely.
      if (uShock > 0.001) {
        vec2 sd = vec2((uv.x - uShockC.x) * uAspect, uv.y - uShockC.y);
        float sr = length(sd);
        float band = 1.0 - smoothstep(0.0, 0.16, abs(sr - uShockR));
        float amt = band * uShock * 0.020 * (1.0 - smoothstep(0.0, 1.1, uShockR));
        uv -= normalize(sd + 1e-5) * amt;
      }

      vec2 dir = uv - uCenter;
      float rad = length(vec2(dir.x * uAspect, dir.y));

      // ---- radial speed blur. The hero car is explicitly protected: real
      // racers keep the player razor-sharp and streak the world past it --
      // that contrast IS the sense of speed.
      vec2 hd = vec2((uv.x - uHero.x) * uAspect, uv.y - uHero.y);
      float heroMask = smoothstep(uHeroR * 0.85, uHeroR * 2.15, length(hd));
      // The replay camera is a locked-off cinematic rig, not a chase cam, so
      // the car's raw speed must not smear the whole plate during a wreck --
      // that turned every crash frame into unreadable mush.
      float blur = spd * 0.030 * (1.0 - crash * 0.78) + boost * 0.072 + crash * 0.014;
      blur *= smoothstep(0.04, 0.58, rad) * heroMask;
      // Aberration has to stay sub-pixel-ish on thin geometry: at 0.013 uv the
      // R/B taps separated far enough that a 3px yellow lane line lost its red
      // channel entirely and rendered as a green laser.
      float caAmt = (0.00042 + boost * 0.0017 + crash * 0.0009 + spd * 0.00060 * (1.0 - crash * 0.7)) * (0.30 + rad) * mix(0.35, 1.0, heroMask);
      vec3 col = vec3(0.0);
      float wsum = 0.0;
      const int N = TAPS;
      for (int i = 0; i < N; i++) {
        float f = float(i) / float(N - 1);
        float w = 1.0 - f * 0.55;
        vec2 suv = uv + dir * (-f * blur);
        col.r += texture2D(tDiffuse, suv + dir * caAmt).r * w;
        col.g += texture2D(tDiffuse, suv).g * w;
        col.b += texture2D(tDiffuse, suv - dir * caAmt).b * w;
        wsum += w;
      }
      col /= wsum;

      // ---- boost streak field. A chromatic light-speed smear that only the
      // world gets (the hero mask keeps the car crisp) plus bright radial
      // filaments so a single still frame reads unmistakably as BOOSTING.
      if (boost > 0.01) {
        float sblur = boost * 0.26 * smoothstep(0.06, 0.78, rad) * heroMask;
        vec3 streak = vec3(0.0);
        float sw = 0.0;
        for (int i = 0; i < 8; i++) {
          float f = (float(i) + 0.5) / 8.0;
          float w = f;                                   // weight the far taps
          vec2 sd2 = dir * (-f * sblur);
          streak.r += texture2D(tDiffuse, uv + sd2 * 1.10).r * w;
          streak.g += texture2D(tDiffuse, uv + sd2 * 1.00).g * w;
          streak.b += texture2D(tDiffuse, uv + sd2 * 0.90).b * w;
          sw += w;
        }
        streak /= sw;
        float sl = dot(streak, vec3(0.2126, 0.7152, 0.0722));
        // filaments: only bright sources smear into visible lines
        vec3 fil = streak * smoothstep(0.42, 0.96, sl);
        float ang = atan(dir.y, dir.x * uAspect);
        float comb = 0.55 + 0.45 * sin(ang * 46.0);
        col = mix(col, streak, boost * 0.34 * smoothstep(0.08, 0.70, rad) * heroMask);
        col += fil * boost * (0.16 + comb * 0.38) * smoothstep(0.12, 0.92, rad) * heroMask;
        col += vec3(0.34, 0.52, 1.0) * boost * 0.045 * smoothstep(0.40, 1.10, rad) * heroMask;
      }

      // ---- colour grade. Cool shadows / warm highlights, then a hard black
      // point so the frame actually bottoms out instead of sitting on a
      // 15%-grey floor.
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = vec3(0.90, 0.955, 1.06);
      vec3 highTint   = vec3(1.07, 1.015, 0.94);
      vec3 grade = col * mix(shadowTint, highTint, smoothstep(0.008, 0.30, l));
      grade *= uTint;
      grade = max(grade - uBlack, vec3(0.0)) / max(1e-4, 1.0 - uBlack);
      // filmic toe + shoulder (Hill/Narkowicz style), applied before the
      // OutputPass ACES so it shapes contrast rather than re-tonemapping.
      grade = (grade * (1.28 * grade + 0.045)) / (grade * (1.16 * grade + 0.36) + 0.10);
      grade *= 0.94;
      // Toe crush, restricted to genuinely near-black pixels. A wide crush
      // window (0.36) was multiplying the red hero car by 0.35 and, with the
      // old cool shadow tint, turning it navy.
      float lo = dot(grade, vec3(0.2126, 0.7152, 0.0722));
      grade *= mix(0.42, 1.0, smoothstep(0.0, 0.11, lo));
      float sat = uSat + boost * 0.30;
      float gl2 = dot(grade, vec3(0.2126, 0.7152, 0.0722));
      grade = mix(vec3(gl2), grade, sat);
      grade = mix(grade, grade * vec3(1.20, 0.94, 0.78), boost * 0.50);

      // ---- crash cam: cold, high contrast, crushed blacks
      vec3 crashCol = grade * vec3(0.86, 0.94, 1.18);
      crashCol = max(crashCol - 0.055, vec3(0.0)) * 1.12;
      float cl = dot(crashCol, vec3(0.2126, 0.7152, 0.0722));
      crashCol = mix(vec3(cl), crashCol, 0.86);
      grade = mix(grade, crashCol, crash);

      // ---- shockwave bloom pulse on the ring itself
      if (uShock > 0.001) {
        vec2 sd = vec2((vUv.x - uShockC.x) * uAspect, vUv.y - uShockC.y);
        float band = 1.0 - smoothstep(0.0, 0.10, abs(length(sd) - uShockR));
        grade += band * uShock * vec3(0.20, 0.13, 0.07) * (1.0 - smoothstep(0.0, 1.0, uShockR));
      }

      // ---- vignette
      float vig = 1.0 - uVignette * smoothstep(0.34, 1.04, rad) * (0.46 + boost * 0.22 + crash * 0.48);
      grade *= vig;

      // ---- film grain
      float g = hash(uv * vec2(1920.0, 1080.0) + fract(abs(uTime)) * 137.0) - 0.5;
      grade += g * uGrain * (0.35 + 0.5 * (1.0 - smoothstep(0.0, 0.4, l)));

      // ---- impact flash
      grade += clamp(uFlash, 0.0, 1.0) * vec3(1.0, 0.92, 0.82);

      gl_FragColor = vec4(max(grade, 0.0), 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this.mode = new URLSearchParams(location.search).get('post') || 'full';
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      samples: quality.msaa,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // Clamp the HDR buffer before bloom. Overlapping additive VFX (sparks, fire,
    // beams) can push single pixels into the hundreds, and the bloom mip chain
    // then smears that across the whole frame as a white wash.
    this.clamp = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uMax: { value: 3.9 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uMax; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          float l = max(max(c.r, c.g), c.b);
          if (l > uMax) c.rgb *= uMax / l;
          gl_FragColor = vec4(c.rgb, 1.0);
        }`,
    });
    if (this.mode !== 'off') this.composer.addPass(this.clamp);

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      quality.bloomStrength, quality.bloomRadius, quality.bloomThreshold
    );
    if (this.mode !== 'nobloom' && this.mode !== 'off') this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.grade.material.defines = Object.assign({}, this.grade.material.defines, {
      TAPS: quality.tier === 'low' ? 6 : (quality.tier === 'med' ? 9 : 12),
    });
    this.grade.material.needsUpdate = true;
    if (this.mode === 'gradeflat') {
      this.grade.material.fragmentShader = 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }';
      this.grade.material.needsUpdate = true;
    } else if (this.mode === 'gradenoblur') {
      this.grade.material.fragmentShader = this.grade.material.fragmentShader
        .replace('const int N = 10;', 'const int N = 1;');
      this.grade.material.needsUpdate = true;
    }
    if (this.mode !== 'nograde' && this.mode !== 'off') this.composer.addPass(this.grade);

    this.output = new OutputPass();
    this.composer.addPass(this.output);

    if (quality.smaa && this.mode !== 'off') {
      this.smaa = new SMAAPass();
      this.composer.addPass(this.smaa);
    }
    this.u = this.grade.uniforms;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.u.uAspect.value = w / h;
  }

  render(dt) {
    if (this.mode === 'raw') {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.composer.render(dt);
  }
}
