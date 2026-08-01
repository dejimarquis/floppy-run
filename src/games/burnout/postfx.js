// Post-processing: a deliberately tiny hand-rolled stack.
//
// The previous version used EffectComposer + UnrealBloomPass + OutputPass +
// SMAAPass. That chain alone compiled ~25 shader programs (UnrealBloom builds
// one program per blur kernel radius, SMAA three more, and every pass gets a
// second variant for the render-target vs canvas colour space). Boot spent
// most of its budget in renderer.compile().
//
// This stack is three programs total:
//   1. bright   — threshold + 1/4-res downsample
//   2. blur     — separable gaussian, direction supplied by a uniform so the
//                 horizontal and vertical passes share one program
//   3. composite— bloom add, radial speed blur, boost streaks, chromatic
//                 aberration, colour grade, ACES, vignette, grain, flash
//
// It also moves tone mapping out of the renderer entirely
// (renderer.toneMapping = NoToneMapping). That is not cosmetic: `toneMapping`
// and `toneMapped` are part of every material's program cache key, so leaving
// ACES on the renderer meant every `toneMapped:false` material in the game
// compiled a second copy of its shader.
import * as THREE from 'three';

const QUAD_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// ------------------------------------------------- bright + blur (1 program)
// Prefilter and blur share a single program: `uPre` switches the first pass
// into threshold mode. Two shaders here would be two more compiled programs
// for no visual gain.
const BlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    uDir: { value: new THREE.Vector2(1, 0) },
    uTexel: { value: new THREE.Vector2() },
    uThreshold: { value: 0.9 },
    uClamp: { value: 8.0 },
    uExposure: { value: 0.3 },
    uPre: { value: 0.0 },
  },
  vertexShader: QUAD_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uDir, uTexel;
    uniform float uThreshold, uClamp, uExposure, uPre;
    varying vec2 vUv;
    vec3 tap(vec2 o){
      // Thresholding happens in EXPOSED space. Doing it on raw scene HDR meant
      // a 2..20 range sky passed the threshold wholesale and the blurred result
      // added several units of light back onto the road.
      vec3 c = texture2D(tDiffuse, vUv + o).rgb * uExposure;
      float m = max(max(c.r, c.g), c.b);
      if (m > uClamp) c *= uClamp / m;
      return c;
    }
    void main(){
      vec3 c;
      if (uPre > 0.5) {
        c = (tap(uTexel * vec2(-1.0, -1.0)) + tap(uTexel * vec2(1.0, -1.0))
           + tap(uTexel * vec2(-1.0,  1.0)) + tap(uTexel * vec2(1.0,  1.0))) * 0.25;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // keep the hue of the source so neon signs bloom coloured, not white
        c *= smoothstep(uThreshold, uThreshold * 2.0, l);
      } else {
        // 9-tap gaussian, linear-sampled pairs
        c = texture2D(tDiffuse, vUv).rgb * 0.227027;
        c += (texture2D(tDiffuse, vUv + uDir * 1.3846).rgb
            + texture2D(tDiffuse, vUv - uDir * 1.3846).rgb) * 0.316216;
        c += (texture2D(tDiffuse, vUv + uDir * 3.2308).rgb
            + texture2D(tDiffuse, vUv - uDir * 3.2308).rgb) * 0.070270;
      }
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};


// ------------------------------------------------------------- composite
export const GradeShader = {
  name: 'CrashoutGrade',
  uniforms: {
    tDiffuse: { value: null },
    tBloom: { value: null },
    uBloom: { value: 0.9 },
    uTime: { value: 0 },
    uSpeed: { value: 0 },        // 0..1 radial blur strength
    uBoost: { value: 0 },        // 0..1 boost look
    uCrash: { value: 0 },        // 0..1 crash-cam look
    uFlash: { value: 0 },        // impact white flash
    uFlashCol: { value: new THREE.Color(1.0, 0.94, 0.84) },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1.777 },
    uGrain: { value: 0.010 },
    uVignette: { value: 0.72 },
    uSat: { value: 1.46 },
    uTint: { value: new THREE.Color(1.02, 1.0, 1.04) },
    uBlack: { value: 0.028 },                          // hard black point
    uHero: { value: new THREE.Vector2(0.5, 0.42) },    // hero car in screen uv
    uHeroR: { value: 0.20 },                           // hero protection radius
    uShockC: { value: new THREE.Vector2(0.5, 0.5) },   // impact shockwave centre
    uShock: { value: 0 },                              // 0..1 shockwave life
    uShockR: { value: 0 },                             // current ring radius
    uExposure: { value: 0.86 },
  },
  vertexShader: QUAD_VERT,
  fragmentShader: /* glsl */`
    #ifndef TAPS
    #define TAPS 10
    #endif
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    uniform float uTime, uSpeed, uBoost, uCrash, uFlash, uAspect, uGrain, uVignette, uSat;
    uniform float uBlack, uHeroR, uShock, uShockR, uBloom, uExposure;
    uniform vec2 uCenter, uHero, uShockC;
    uniform vec3 uTint, uFlashCol;
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    // ACES filmic approximation (Narkowicz)
    vec3 aces(vec3 x){
      return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    }

    void main(){
      float boost = clamp(uBoost, 0.0, 1.0);
      float crash = clamp(uCrash, 0.0, 1.0);
      float spd = clamp(uSpeed, 0.0, 1.4);
      vec2 uv = vUv;

      // ---- impact shockwave: a screen-space radial pinch riding outward from
      // the impact point.
      if (uShock > 0.001) {
        vec2 sd = vec2((uv.x - uShockC.x) * uAspect, uv.y - uShockC.y);
        float sr = length(sd);
        float band = 1.0 - smoothstep(0.0, 0.16, abs(sr - uShockR));
        float amt = band * uShock * 0.026 * (1.0 - smoothstep(0.0, 1.1, uShockR));
        uv -= normalize(sd + 1e-5) * amt;
      }

      vec2 dir = uv - uCenter;
      float rad = length(vec2(dir.x * uAspect, dir.y));

      // ---- radial speed blur. The hero car is explicitly protected: real
      // racers keep the player razor-sharp and streak the world past it --
      // that contrast IS the sense of speed.
      vec2 hd = vec2((uv.x - uHero.x) * uAspect, uv.y - uHero.y);
      float heroMask = smoothstep(uHeroR * 0.85, uHeroR * 2.15, length(hd));
      // The replay camera is a locked-off cinematic rig, so the car's raw speed
      // must not smear the whole plate during a wreck.
      float blur = spd * 0.026 * (1.0 - crash * 0.78) + boost * 0.088 + crash * 0.012;
      blur *= smoothstep(0.04, 0.58, rad) * heroMask;
      float caAmt = (0.00042 + boost * 0.0026 + crash * 0.0009 + spd * 0.00060 * (1.0 - crash * 0.7))
                    * (0.30 + rad) * mix(0.35, 1.0, heroMask);
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

      // ---- boost: chromatic light-speed streaks plus bright radial filaments,
      // so a single still frame reads unmistakably as BOOSTING.
      if (boost > 0.01) {
        float sblur = boost * 0.34 * smoothstep(0.05, 0.78, rad) * heroMask;
        vec3 streak = vec3(0.0);
        float sw = 0.0;
        for (int i = 0; i < 8; i++) {
          float f = (float(i) + 0.5) / 8.0;
          float w = f;                                   // weight the far taps
          vec2 sd2 = dir * (-f * sblur);
          streak.r += texture2D(tDiffuse, uv + sd2 * 1.14).r * w;
          streak.g += texture2D(tDiffuse, uv + sd2 * 1.00).g * w;
          streak.b += texture2D(tDiffuse, uv + sd2 * 0.86).b * w;
          sw += w;
        }
        streak /= sw;
        float sl = dot(streak, vec3(0.2126, 0.7152, 0.0722));
        vec3 fil = streak * smoothstep(0.34, 0.92, sl);
        float ang = atan(dir.y, dir.x * uAspect);
        float comb = 0.55 + 0.45 * sin(ang * 46.0);
        // hard speed-lines: thin radial spokes scrolling outward
        float spoke = pow(max(0.0, sin(ang * 64.0 + hash(vec2(floor(ang * 20.4), 3.0)) * 6.28)), 24.0);
        float spokeMask = smoothstep(0.20, 0.95, rad) * heroMask;
        col = mix(col, streak, boost * 0.40 * smoothstep(0.08, 0.70, rad) * heroMask);
        col += fil * boost * (0.18 + comb * 0.46) * smoothstep(0.12, 0.92, rad) * heroMask;
        col += vec3(0.60, 0.78, 1.0) * spoke * spokeMask * boost * 1.55 / max(0.05, uExposure);
        col += vec3(0.34, 0.52, 1.0) * boost * 0.06 * smoothstep(0.40, 1.10, rad) * heroMask;
      }

      // ---- exposure + tone map. Done here rather than on the renderer so
      // materials do not fork a program per toneMapped flag.
      col *= uExposure * (1.0 + boost * 0.10 + uFlash * 0.55);

      // ---- bloom, added in exposed space and already thresholded there
      col += texture2D(tBloom, uv).rgb * uBloom * (1.0 + boost * 0.9 + uFlash * 1.6);

      col = aces(col);

      // ---- colour grade. Punchy arcade: strong saturation, cool shadows,
      // warm highlights, hard black point.
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = vec3(0.92, 0.965, 1.07);
      vec3 highTint   = vec3(1.06, 1.015, 0.95);
      vec3 grade = col * mix(shadowTint, highTint, smoothstep(0.008, 0.30, l));
      grade *= uTint;
      grade = max(grade - uBlack, vec3(0.0)) / max(1e-4, 1.0 - uBlack);
      // S-curve for contrast
      grade = grade * grade * (3.0 - 2.0 * grade) * 0.30 + grade * 0.70;
      float sat = uSat + boost * 0.34;
      float gl2 = dot(grade, vec3(0.2126, 0.7152, 0.0722));
      grade = mix(vec3(gl2), grade, sat);
      grade = mix(grade, grade * vec3(1.22, 0.96, 0.78), boost * 0.42);

      // ---- crash cam: cold, high contrast, crushed blacks
      vec3 crashCol = grade * vec3(0.88, 0.95, 1.20);
      crashCol = max(crashCol - 0.045, vec3(0.0)) * 1.14;
      float cl = dot(crashCol, vec3(0.2126, 0.7152, 0.0722));
      crashCol = mix(vec3(cl), crashCol, 0.92);
      grade = mix(grade, crashCol, crash);

      // ---- shockwave ring pulse
      if (uShock > 0.001) {
        vec2 sd = vec2((vUv.x - uShockC.x) * uAspect, vUv.y - uShockC.y);
        float band = 1.0 - smoothstep(0.0, 0.10, abs(length(sd) - uShockR));
        grade += band * uShock * vec3(0.34, 0.22, 0.10) * (1.0 - smoothstep(0.0, 1.0, uShockR));
      }

      // ---- vignette
      float vig = 1.0 - uVignette * smoothstep(0.34, 1.04, rad) * (0.46 + boost * 0.26 + crash * 0.48);
      grade *= vig;

      // ---- film grain
      float g = hash(uv * vec2(1920.0, 1080.0) + fract(abs(uTime)) * 137.0) - 0.5;
      grade += g * uGrain * (0.35 + 0.5 * (1.0 - smoothstep(0.0, 0.4, l)));

      // ---- impact flash
      grade += clamp(uFlash, 0.0, 1.0) * uFlashCol;

      gl_FragColor = vec4(max(grade, 0.0), 1.0);
      #include <colorspace_fragment>
    }
  `,
};

// A single fullscreen triangle-ish quad reused by every pass; the material is
// swapped per draw so the geometry never re-uploads.
class Quad {
  constructor() {
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0, 3, -1, 0, -1, 3, 0,
    ]), 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      0, 0, 2, 0, 0, 2,
    ]), 2));
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mesh = new THREE.Mesh(this.geo, null);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
  }
  draw(renderer, material, target) {
    this.mesh.material = material;
    renderer.setRenderTarget(target || null);
    renderer.render(this.scene, this.cam);
  }
  dispose() { this.geo.dispose(); }
}

function makeMat(def, defines) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(def.uniforms),
    vertexShader: def.vertexShader,
    fragmentShader: def.fragmentShader,
    defines: defines || {},
    depthTest: false,
    depthWrite: false,
  });
}

export class PostFX {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this.mode = new URLSearchParams(location.search).get('post') || 'full';

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      samples: quality.msaa || 0,
      depthBuffer: true,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    const bw = Math.max(2, Math.floor(size.x / 4));
    const bh = Math.max(2, Math.floor(size.y / 4));
    const rtOpts = {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    };
    this.rtA = new THREE.WebGLRenderTarget(bw, bh, rtOpts);
    this.rtB = new THREE.WebGLRenderTarget(bw, bh, rtOpts);

    this.quad = new Quad();
    this.blurMat = makeMat(BlurShader);
    this.brightMat = this.blurMat;
    this.gradeMat = makeMat(GradeShader, {
      TAPS: quality.tier === 'low' ? 6 : (quality.tier === 'med' ? 8 : 10),
    });

    this.u = this.gradeMat.uniforms;
    this.u.uAspect.value = size.x / Math.max(1, size.y);
    this.u.uBloom.value = quality.bloomStrength;
    // Tier thresholds are authored against raw scene HDR; the bright pass now
    // works in exposed space, so scale into that range.
    this.brightMat.uniforms.uThreshold.value = quality.bloomThreshold;

    // Compatibility shim: the game tunes bloom through `post.bloom.*`.
    const self = this;
    this.bloom = {
      get strength() { return self.u.uBloom.value; },
      set strength(v) { self.u.uBloom.value = v; },
      get threshold() { return self.brightMat.uniforms.uThreshold.value; },
      set threshold(v) { self.brightMat.uniforms.uThreshold.value = v; },
      get radius() { return self._radius || 1; },
      set radius(v) { self._radius = v; },
    };
    this._radius = quality.bloomRadius;
    this.setSize(size.x, size.y, true);
  }

  setSize(w, h, raw) {
    const size = raw
      ? new THREE.Vector2(w, h)
      : this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sceneRT.setSize(size.x, size.y);
    const bw = Math.max(2, Math.floor(size.x / 4));
    const bh = Math.max(2, Math.floor(size.y / 4));
    this.rtA.setSize(bw, bh);
    this.rtB.setSize(bw, bh);
    this.brightMat.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
    this.bw = bw; this.bh = bh;
    this.u.uAspect.value = size.x / Math.max(1, size.y);
  }

  _blur(src, dst, dx, dy) {
    const u = this.blurMat.uniforms;
    u.tDiffuse.value = src.texture;
    u.uPre.value = 0;
    u.uDir.value.set(dx / this.bw, dy / this.bh);
    this.quad.draw(this.renderer, this.blurMat, dst);
  }

  render() {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();

    // 1. scene -> HDR target (always; never straight to the canvas, so every
    //    material only ever compiles for one output colour space)
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(this.scene, this.camera);

    if (this.mode === 'raw') {
      this.u.tDiffuse.value = this.sceneRT.texture;
      this.u.tBloom.value = this.rtA.texture;
      this.u.uBloom.value = 0;
      this.quad.draw(r, this.gradeMat, null);
      r.setRenderTarget(prevTarget);
      return;
    }

    // 2. bright pass -> 1/4 res
    const bu = this.blurMat.uniforms;
    bu.tDiffuse.value = this.sceneRT.texture;
    bu.uExposure.value = this.u.uExposure.value;
    bu.uPre.value = 1;
    this.quad.draw(r, this.blurMat, this.rtA);

    // 3. separable blur, two widening iterations for a soft arcade halo
    const rad = this._radius || 1;
    this._blur(this.rtA, this.rtB, 1.0, 0);
    this._blur(this.rtB, this.rtA, 0, 1.0);
    this._blur(this.rtA, this.rtB, 2.6 * rad * 2.5, 0);
    this._blur(this.rtB, this.rtA, 0, 2.6 * rad * 2.5);

    // 4. composite -> canvas
    this.u.tDiffuse.value = this.sceneRT.texture;
    this.u.tBloom.value = this.rtA.texture;
    this.quad.draw(r, this.gradeMat, null);
    r.setRenderTarget(prevTarget);
  }

  dispose() {
    this.sceneRT.dispose(); this.rtA.dispose(); this.rtB.dispose();
    this.blurMat.dispose(); this.gradeMat.dispose();
    this.quad.dispose();
  }
}
