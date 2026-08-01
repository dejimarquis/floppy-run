/**
 * Post-processing chain.
 *
 * Hand-rolled rather than EffectComposer-based so the cost is controllable on
 * software renderers:
 *
 *   scene (HDR) → bright pass ¼ → blur ¼ (H,V) → blur ⅛ (H,V)
 *                → single fused composite pass:
 *                     tilt-shift DOF · bloom add · ACES · sRGB
 *                     chromatic aberration · colour grade · vignette · grain
 *                → optional SMAA
 */

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { Q } from './quality.js';

const VERT = /* glsl */ `
  precision highp float;
  in vec3 position; in vec2 uv; out vec2 vUv;
  uniform mat4 modelViewMatrix, projectionMatrix;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;

const brightMat = () =>
  new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      tSrc: { value: null },
      uThreshold: { value: 1.0 },
      uKnee: { value: 0.6 },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec2 vUv; out vec4 oCol;
      uniform sampler2D tSrc; uniform float uThreshold, uKnee;
      void main(){
        vec3 c = texture(tSrc, vUv).rgb;
        // hard energy clamp: one blown texel must never dominate the chain
        c = min(c, vec3(4.0));
        float l = max(c.r, max(c.g, c.b));
        float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
        soft = soft * soft / (4.0 * uKnee + 1e-5);
        float k = max(soft, l - uThreshold) / max(l, 1e-5);
        vec3 b = c * k;
        // pull 30% toward luma so saturated primaries cannot tint the frame
        float bl = dot(b, vec3(0.2126, 0.7152, 0.0722));
        b = mix(b, vec3(bl), 0.55);
        oCol = vec4(min(b, vec3(2.2)), 1.0);
      }
    `,
  });

const blurMat = () =>
  new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2(1, 0) } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec2 vUv; out vec4 oCol;
      uniform sampler2D tSrc; uniform vec2 uDir;
      void main(){
        vec3 c = texture(tSrc, vUv).rgb * 0.2270270270;
        vec2 o1 = uDir * 1.3846153846;
        vec2 o2 = uDir * 3.2307692308;
        c += (texture(tSrc, vUv + o1).rgb + texture(tSrc, vUv - o1).rgb) * 0.3162162162;
        c += (texture(tSrc, vUv + o2).rgb + texture(tSrc, vUv - o2).rgb) * 0.0702702703;
        oCol = vec4(c, 1.0);
      }
    `,
  });

const compositeMat = () =>
  new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      tScene: { value: null },
      tBloomA: { value: null },
      tBloomB: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uFocus: { value: 0.42 },
      uAperture: { value: 1.0 },
      uBloom: { value: 0.55 },
      uAberration: { value: 1.0 },
      uGrain: { value: 1.0 },
      uVignette: { value: 1.0 },
      uExposure: { value: 1.0 },
      uShake: { value: new THREE.Vector2(0, 0) },
      uFlash: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec2 vUv; out vec4 oCol;
      uniform sampler2D tScene, tBloomA, tBloomB;
      uniform vec2 uRes, uShake;
      uniform float uTime, uFocus, uAperture, uBloom, uAberration, uGrain, uVignette, uExposure, uFlash;

      vec3 aces(vec3 x){
        x *= 0.6;
        const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
        return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
      }
      vec3 toSRGB(vec3 c){
        return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666)) - 0.055, step(vec3(0.0031308), c));
      }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }

      void main(){
        vec2 uv = clamp(vUv + uShake, 0.0015, 0.9985);

        // ---- tilt-shift DOF: the table recedes up the screen -------------
        float dy = uv.y - uFocus;
        float coc = clamp((dy > 0.0 ? dy * 2.3 : -dy * 1.0) * uAperture, 0.0, 1.0);
        coc *= coc;
        vec3 c = texture(tScene, uv).rgb;
        if (coc > 0.02) {
          vec2 px = coc * 4.0 / uRes;
          vec3 acc = c;
          for (int i = 0; i < 6; i++) {
            float a = float(i) * 1.0471975 + uv.y * 12.0;
            vec2 o = vec2(cos(a), sin(a)) * px * (0.6 + 0.4 * fract(float(i) * 0.618));
            acc += texture(tScene, uv + o).rgb;
          }
          c = mix(c, acc / 7.0, coc);
        }

        // ---- bloom --------------------------------------------------------
        vec3 bl = texture(tBloomA, uv).rgb * 0.68 + texture(tBloomB, uv).rgb * 0.32;
        c += min(bl, vec3(2.0)) * uBloom;

        // ---- event flash ---------------------------------------------------
        c += min(uFlash, 1.0) * 0.28 * vec3(1.0, 0.94, 0.86);

        // ---- tone map + display encode --------------------------------------
        c = toSRGB(aces(c * uExposure));

        // ---- radial chromatic aberration ------------------------------------
        vec2 d = uv - 0.5;
        float r2 = dot(d, d);
        if (uAberration > 0.01) {
          vec2 off = d * r2 * 0.0015 * uAberration;
          float cr = toSRGB(aces(texture(tScene, uv + off).rgb * uExposure)).r;
          float cb = toSRGB(aces(texture(tScene, uv - off).rgb * uExposure)).b;
          c.r = mix(c.r, cr, 0.55 * uAberration);
          c.b = mix(c.b, cb, 0.55 * uAberration);
        }

        // ---- colour grade -----------------------------------------------------
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c *= mix(vec3(0.88, 0.94, 1.13), vec3(1.09, 1.02, 0.90), smoothstep(0.0, 0.8, l));
        c = mix(c, c * c * (3.0 - 2.0 * c), 0.12);
        c = clamp(mix(vec3(l), c, 1.24), 0.0, 1.0);

        // ---- vignette ----------------------------------------------------------
        c *= clamp(1.0 - uVignette * 0.62 * pow(r2 * 1.55, 1.45), 0.0, 1.0);

        // ---- film grain --------------------------------------------------------
        float g = hash(uv * uRes + uTime * 60.0) - 0.5;
        c += g * 0.030 * uGrain * (1.0 - 0.65 * l);

        oCol = vec4(c, 1.0);
      }
    `,
  });

export class PostFX {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quad = new FullScreenQuad(null);

    this.bright = brightMat();
    this.blur = blurMat();
    this.comp = compositeMat();

    this.smaa = new SMAAPass();
    this.smaa.renderToScreen = true;

    this._rt = [];
    const size = renderer.getSize(new THREE.Vector2());
    this.setQuality(quality);
    this.allocate(size.x, size.y);
  }

  allocate(w, h) {
    const dpr = this.renderer.getPixelRatio();
    const W = Math.max(8, Math.floor(w * dpr));
    const H = Math.max(8, Math.floor(h * dpr));
    for (const rt of this._rt) rt.dispose();
    this._rt = [];

    // MSAA on a CPU rasteriser multiplies the whole scene pass by the sample
    // count; SMAA already runs on every tier, so software GL takes the
    // post-process route only.
    // SMAA runs on every tier. Stacking 4x MSAA on top of it multiplies the
    // whole half-float scene pass by four for an edge quality nobody can see
    // past the bloom. One of them is enough, and SMAA is the cheap one.
    const msaa = 0;
    const mk = (ww, hh, samples = 0, depth = false) => {
      const rt = new THREE.WebGLRenderTarget(Math.max(2, ww), Math.max(2, hh), {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: depth,
        samples,
      });
      rt.texture.generateMipmaps = false;
      this._rt.push(rt);
      return rt;
    };

    this.sceneRT = mk(W, H, msaa, true);
    const w4 = W >> 2;
    const h4 = H >> 2;
    this.bA = mk(w4, h4);
    this.bB = mk(w4, h4);
    const w8 = W >> 3;
    const h8 = H >> 3;
    this.bC = mk(w8, h8);
    this.bD = mk(w8, h8);
    this.ldrRT = mk(W, H);

    this.comp.uniforms.uRes.value.set(W, H);
    this.W = W;
    this.H = H;
    this.smaa.setSize(W, H);
  }

  setQuality(q) {
    const cfg =
      {
        low: { bloom: 0.30, ab: 0.5, grain: 0.6, dof: 0.6, smaa: true, thr: 1.7 },
        med: { bloom: 0.30, ab: 0.7, grain: 0.75, dof: 0.8, smaa: true, thr: 1.8 },
        high: { bloom: 0.28, ab: 0.9, grain: 0.9, dof: 1.0, smaa: true, thr: 1.9 },
        ultra: { bloom: 0.28, ab: 0.9, grain: 0.9, dof: 1.05, smaa: true, thr: 1.9 },
      }[q] || {};
    const u = this.comp.uniforms;
    u.uBloom.value = cfg.bloom ?? 0.6;
    u.uAberration.value = cfg.ab ?? 1;
    u.uGrain.value = cfg.grain ?? 1;
    u.uAperture.value = cfg.dof ?? 1;
    this.bright.uniforms.uThreshold.value = cfg.thr ?? 1.0;
    this.smaaOn = !!cfg.smaa;
  }

  setSize(w, h) {
    this.allocate(w, h);
  }

  _draw(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  render(dt, t, focus, shake, flash) {
    const r = this.renderer;
    const u = this.comp.uniforms;
    u.uTime.value = t;
    u.uFocus.value = focus;
    u.uShake.value.set(shake.x, shake.y);
    u.uFlash.value = flash;
    u.uExposure.value = r.toneMappingExposure;

    // 1. scene → linear HDR target
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(this.scene, this.camera);

    // 2. bright pass at ¼
    this.bright.uniforms.tSrc.value = this.sceneRT.texture;
    this._draw(this.bright, this.bA);

    // 3. separable blur at ¼
    this.blur.uniforms.tSrc.value = this.bA.texture;
    this.blur.uniforms.uDir.value.set(1 / this.bA.width, 0);
    this._draw(this.blur, this.bB);
    this.blur.uniforms.tSrc.value = this.bB.texture;
    this.blur.uniforms.uDir.value.set(0, 1 / this.bA.height);
    this._draw(this.blur, this.bA);

    // 4. wider halo at ⅛
    this.blur.uniforms.tSrc.value = this.bA.texture;
    this.blur.uniforms.uDir.value.set(1.6 / this.bC.width, 0);
    this._draw(this.blur, this.bD);
    this.blur.uniforms.tSrc.value = this.bD.texture;
    this.blur.uniforms.uDir.value.set(0, 1.6 / this.bC.height);
    this._draw(this.blur, this.bC);

    // 5. fused composite (+ optional SMAA)
    u.tScene.value = this.sceneRT.texture;
    u.tBloomA.value = this.bA.texture;
    u.tBloomB.value = this.bC.texture;

    if (this.smaaOn) {
      this._draw(this.comp, this.ldrRT);
      this.smaa.renderToScreen = true;
      this.smaa.render(r, null, this.ldrRT, dt, false);
    } else {
      this._draw(this.comp, null);
    }
    r.setRenderTarget(null);
  }
}
