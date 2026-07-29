// 100% procedural WebAudio. Layered engine synthesis driven by RPM, wind,
// tyre screech, impacts, scrapes, sirens — through a compressor and a
// procedurally generated convolution reverb.
import { clamp, lerp } from './rng.js';

export class Audio {
  constructor() {
    this.ok = false;
    this.started = false;
    this.muted = false;
    this.masterVolume = 0.85;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = new AC();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = 0.0;
      this.master = master;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 22;
      comp.ratio.value = 7;
      comp.attack.value = 0.004;
      comp.release.value = 0.22;

      // procedural impulse response
      const len = Math.floor(ctx.sampleRate * 1.7);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < len; i++) {
          const t = i / len;
          const decay = Math.pow(1 - t, 2.6);
          const early = i < ctx.sampleRate * 0.06 ? 1.6 : 1.0;
          d[i] = (Math.random() * 2 - 1) * decay * early * 0.55;
        }
      }
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      const wet = ctx.createGain();
      wet.gain.value = 0.16;
      const dry = ctx.createGain();
      dry.gain.value = 1.0;
      this.wetGain = wet;

      master.connect(comp);
      comp.connect(dry);
      dry.connect(ctx.destination);
      comp.connect(conv);
      conv.connect(wet);
      wet.connect(ctx.destination);

      // shared noise buffer
      const nlen = Math.floor(ctx.sampleRate * 2);
      const nb = ctx.createBuffer(1, nlen, ctx.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
      this.noiseBuf = nb;

      this.buildEngine();
      this.buildWind();
      this.buildScreech();
      this.rivalVoices = [this.buildRival(), this.buildRival(), this.buildRival()];
      this.siren = this.buildSiren();
      this.ok = true;
    } catch (e) {
      this.ok = false;
    }
  }

  resume() {
    this.init();
    if (!this.ok) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.started) {
      this.started = true;
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.masterVolume, this.ctx.currentTime, 0.4);
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.ok && this.started) this.master.gain.setTargetAtTime(m ? 0 : this.masterVolume, this.ctx.currentTime, 0.1);
  }

  // ---------------------------------------------------------------- engine
  buildEngine() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    lp.Q.value = 3.2;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 55;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.6) * 0.85;
    }
    shaper.curve = curve;

    const oscs = [];
    const mk = (type, detune, gain) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 60;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g);
      g.connect(shaper);
      o.start();
      oscs.push({ o, g, mult: 1 });
      return { o, g };
    };
    mk('sawtooth', 0, 0.34);
    mk('sawtooth', -9, 0.28);
    mk('square', 7, 0.16);
    mk('sawtooth', 1200, 0.07); // upper harmonic bark
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 30;
    const subG = ctx.createGain();
    subG.gain.value = 0.4;
    sub.connect(subG);
    subG.connect(shaper);
    sub.start();

    // intake/exhaust noise texture
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 900;
    nf.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    n.connect(nf);
    nf.connect(ng);
    ng.connect(shaper);
    n.start();

    shaper.connect(hp);
    hp.connect(lp);
    lp.connect(out);
    out.connect(this.master);

    this.engine = { out, lp, oscs, sub, ng, nf };
  }

  updateEngine(rpm01, throttle, load, speed) {
    if (!this.ok || !this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const base = lerp(34, 128, Math.pow(rpm01, 1.02));
    const e = this.engine;
    const mults = [1, 2.0, 3.0, 5.0];
    e.oscs.forEach((v, i) => {
      v.o.frequency.setTargetAtTime(base * mults[i % mults.length], t, 0.035);
    });
    e.sub.frequency.setTargetAtTime(base * 0.5, t, 0.05);
    const cutoff = lerp(420, 5200, clamp(throttle * 0.65 + rpm01 * 0.55, 0, 1));
    e.lp.frequency.setTargetAtTime(cutoff, t, 0.05);
    e.ng.gain.setTargetAtTime(0.03 + throttle * 0.09 + rpm01 * 0.05, t, 0.06);
    e.nf.frequency.setTargetAtTime(700 + rpm01 * 2600, t, 0.06);
    const vol = clamp(0.10 + rpm01 * 0.20 + throttle * 0.12 + load * 0.05, 0, 0.5);
    e.out.gain.setTargetAtTime(vol, t, 0.05);
    void speed;
  }

  gearShift() {
    if (!this.ok || !this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // ignition cut: quick dip + pop
    this.engine.out.gain.setValueAtTime(this.engine.out.gain.value, t);
    this.engine.out.gain.linearRampToValueAtTime(0.02, t + 0.045);
    this.engine.out.gain.linearRampToValueAtTime(0.28, t + 0.11);
    this.burst({ freq: 260, dur: 0.09, gain: 0.35, type: 'bandpass', q: 1.5, sweep: -140 });
  }

  // ------------------------------------------------------------------ wind
  buildWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 480;
    bp.Q.value = 0.55;
    const hs = ctx.createBiquadFilter();
    hs.type = 'highshelf';
    hs.frequency.value = 2600;
    hs.gain.value = 6;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(bp);
    bp.connect(hs);
    hs.connect(g);
    g.connect(this.master);
    src.start();
    this.wind = { g, bp };
  }
  updateWind(speed) {
    if (!this.ok || !this.started) return;
    const t = this.ctx.currentTime;
    const s = clamp(speed / 85, 0, 1.3);
    this.wind.g.gain.setTargetAtTime(0.02 + s * 0.16, t, 0.12);
    this.wind.bp.frequency.setTargetAtTime(320 + s * 1500, t, 0.12);
  }

  // ---------------------------------------------------------------- screech
  buildScreech() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2100;
    bp.Q.value = 9;
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = 3400;
    bp2.Q.value = 14;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(bp);
    bp.connect(bp2);
    bp2.connect(g);
    g.connect(this.master);
    src.start();
    this.screech = { g, bp };
  }
  updateScreech(amount, speed) {
    if (!this.ok || !this.started) return;
    const t = this.ctx.currentTime;
    this.screech.g.gain.setTargetAtTime(clamp(amount, 0, 1) * 0.16, t, 0.06);
    this.screech.bp.frequency.setTargetAtTime(1500 + clamp(speed / 80, 0, 1) * 1800, t, 0.1);
  }

  // ---------------------------------------------------------------- rivals
  buildRival() {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 70;
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = 140;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.value = 0;
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    o.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    o.start();
    o2.start();
    return { o, o2, g, lp };
  }
  updateRival(i, rpm01, distance, closingSpeed) {
    if (!this.ok || !this.started) return;
    const v = this.rivalVoices[i];
    if (!v) return;
    const t = this.ctx.currentTime;
    const doppler = clamp(1 + closingSpeed / 340, 0.75, 1.3);
    const base = lerp(38, 118, rpm01) * doppler;
    v.o.frequency.setTargetAtTime(base, t, 0.06);
    v.o2.frequency.setTargetAtTime(base * 2, t, 0.06);
    const vol = distance > 90 ? 0 : 0.085 * (1 - distance / 90) * (1 - distance / 90);
    v.g.gain.setTargetAtTime(vol, t, 0.1);
    v.lp.frequency.setTargetAtTime(500 + rpm01 * 2600, t, 0.1);
  }

  // ---------------------------------------------------------------- siren
  buildSiren() {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 620;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.62;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 240;
    lfo.connect(lfoG);
    lfoG.connect(o.frequency);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200;
    bp.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    o.start();
    lfo.start();
    return { o, g };
  }
  updateSiren(active, distance) {
    if (!this.ok || !this.started) return;
    const t = this.ctx.currentTime;
    const vol = active ? clamp(1 - distance / 160, 0, 1) * 0.10 : 0;
    this.siren.g.gain.setTargetAtTime(vol, t, 0.2);
  }

  // ------------------------------------------------------------- one-shots
  burst({ freq = 200, dur = 0.2, gain = 0.4, type = 'lowpass', q = 1, sweep = 0, noise = true, tone = 0 }) {
    if (!this.ok || !this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t + dur);
    f.Q.value = q;
    if (noise) {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      n.loop = true;
      n.playbackRate.value = 0.6 + Math.random() * 0.9;
      n.connect(f);
      n.start(t);
      n.stop(t + dur + 0.05);
    }
    if (tone) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(tone, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(28, tone * 0.35), t + dur);
      const og = ctx.createGain();
      og.gain.setValueAtTime(gain * 1.2, t);
      og.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(og);
      og.connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    f.connect(g);
    g.connect(this.master);
  }

  punchWhoosh() {
    this.burst({ freq: 900, dur: 0.16, gain: 0.22, type: 'bandpass', q: 1.2, sweep: -700 });
  }
  punchHit() {
    this.burst({ freq: 400, dur: 0.22, gain: 0.5, type: 'lowpass', q: 1.0, sweep: -300, tone: 150 });
  }
  impact(strength = 1) {
    this.burst({ freq: 260 * strength, dur: 0.35, gain: 0.55 * strength, type: 'lowpass', q: 1.2, sweep: -200, tone: 90 });
    this.burst({ freq: 2200, dur: 0.14, gain: 0.25 * strength, type: 'bandpass', q: 2.0, sweep: -1400 });
  }
  scrape(amount) {
    if (!this.ok || !this.started) return;
    if (!this._scrape) {
      const ctx = this.ctx;
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      n.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3200;
      bp.Q.value = 6;
      const g = ctx.createGain();
      g.gain.value = 0;
      n.connect(bp);
      bp.connect(g);
      g.connect(this.master);
      n.start();
      this._scrape = { g, bp };
    }
    const t = this.ctx.currentTime;
    this._scrape.g.gain.setTargetAtTime(clamp(amount, 0, 1) * 0.2, t, 0.05);
    this._scrape.bp.frequency.setTargetAtTime(2200 + Math.random() * 2600, t, 0.05);
  }
  chime(up = true) {
    if (!this.ok || !this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const notes = up ? [523, 659, 880] : [440, 349, 262];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.07);
      g.gain.linearRampToValueAtTime(0.16, t + i * 0.07 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.4);
      o.connect(g);
      g.connect(this.master);
      o.start(t + i * 0.07);
      o.stop(t + i * 0.07 + 0.45);
    });
  }
}
