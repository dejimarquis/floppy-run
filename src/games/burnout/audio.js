// 100% procedural WebAudio: RPM-driven engine synthesis, turbo, tyres, wind,
// metal crunches, glass, explosions, whooshes, and a slow-motion filter sweep.
import { clamp } from './rng.js';

export class Audio {
  constructor() {
    this.ok = false;
    this.enabled = true;
    this.started = false;
    this.slowmo = 0;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.build();
      this.ok = true;
    } catch (e) {
      this.ok = false;
    }
  }

  build() {
    const ctx = this.ctx;
    // ---- master chain
    this.master = ctx.createGain();
    this.master.gain.value = 0.0;

    this.slowFilter = ctx.createBiquadFilter();
    this.slowFilter.type = 'lowpass';
    this.slowFilter.frequency.value = 20000;
    this.slowFilter.Q.value = 0.6;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 7;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.22;

    this.master.connect(this.slowFilter);
    this.slowFilter.connect(this.comp);
    this.comp.connect(ctx.destination);

    // ---- reverb send
    this.conv = ctx.createConvolver();
    this.conv.buffer = this.makeIR(1.9, 2.6);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.20;
    this.send = ctx.createGain();
    this.send.gain.value = 1.0;
    this.send.connect(this.conv);
    this.conv.connect(this.wet);
    this.wet.connect(this.slowFilter);

    this.noiseBuf = this.makeNoise(2.0);

    // ---- engine
    this.engine = ctx.createGain();
    this.engine.gain.value = 0.0;
    this.engine.connect(this.master);
    this.engine.connect(this.send);

    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 1400;
    this.engFilter.Q.value = 2.2;
    this.engFilter.connect(this.engine);

    this.engDrive = ctx.createWaveShaper();
    this.engDrive.curve = this.makeDistortion(28);
    this.engDrive.oversample = '2x';
    this.engDrive.connect(this.engFilter);

    this.oscs = [];
    const harmonics = [
      { mul: 0.5, type: 'sawtooth', gain: 0.34 },
      { mul: 1.0, type: 'sawtooth', gain: 0.5 },
      { mul: 2.0, type: 'square', gain: 0.18 },
      { mul: 3.0, type: 'sawtooth', gain: 0.1 },
      { mul: 4.02, type: 'square', gain: 0.06 },
    ];
    for (const h of harmonics) {
      const o = ctx.createOscillator();
      o.type = h.type;
      o.frequency.value = 60 * h.mul;
      const g = ctx.createGain();
      g.gain.value = h.gain;
      o.connect(g); g.connect(this.engDrive);
      o.start();
      this.oscs.push({ o, g, mul: h.mul, base: h.gain });
    }
    // induction noise
    this.indNoise = ctx.createBufferSource();
    this.indNoise.buffer = this.noiseBuf;
    this.indNoise.loop = true;
    this.indFilter = ctx.createBiquadFilter();
    this.indFilter.type = 'bandpass';
    this.indFilter.frequency.value = 420;
    this.indFilter.Q.value = 1.1;
    this.indGain = ctx.createGain();
    this.indGain.gain.value = 0.0;
    this.indNoise.connect(this.indFilter);
    this.indFilter.connect(this.indGain);
    this.indGain.connect(this.engine);
    this.indNoise.start();

    // ---- turbo whistle
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turbo.frequency.value = 3400;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain);
    this.turboGain.connect(this.master);
    this.turbo.start();

    // ---- tyre screech
    this.screech = ctx.createBufferSource();
    this.screech.buffer = this.noiseBuf;
    this.screech.loop = true;
    this.screechF = ctx.createBiquadFilter();
    this.screechF.type = 'bandpass';
    this.screechF.frequency.value = 1250;
    this.screechF.Q.value = 8;
    this.screechG = ctx.createGain();
    this.screechG.gain.value = 0;
    this.screech.connect(this.screechF);
    this.screechF.connect(this.screechG);
    this.screechG.connect(this.master);
    this.screechG.connect(this.send);
    this.screech.start();

    // ---- wind
    this.wind = ctx.createBufferSource();
    this.wind.buffer = this.noiseBuf;
    this.wind.loop = true;
    this.windF = ctx.createBiquadFilter();
    this.windF.type = 'lowpass';
    this.windF.frequency.value = 700;
    this.windG = ctx.createGain();
    this.windG.gain.value = 0;
    this.wind.connect(this.windF);
    this.windF.connect(this.windG);
    this.windG.connect(this.master);
    this.wind.start();

    // ---- scrape (metal on concrete)
    this.scrapeSrc = ctx.createBufferSource();
    this.scrapeSrc.buffer = this.noiseBuf;
    this.scrapeSrc.loop = true;
    this.scrapeF = ctx.createBiquadFilter();
    this.scrapeF.type = 'bandpass';
    this.scrapeF.frequency.value = 2600;
    this.scrapeF.Q.value = 4;
    this.scrapeG = ctx.createGain();
    this.scrapeG.gain.value = 0;
    this.scrapeSrc.connect(this.scrapeF);
    this.scrapeF.connect(this.scrapeG);
    this.scrapeG.connect(this.master);
    this.scrapeG.connect(this.send);
    this.scrapeSrc.start();
    this._scrapeTarget = 0;

    // ---- boost roar
    this.roar = ctx.createBufferSource();
    this.roar.buffer = this.noiseBuf;
    this.roar.loop = true;
    this.roarF = ctx.createBiquadFilter();
    this.roarF.type = 'lowpass';
    this.roarF.frequency.value = 380;
    this.roarG = ctx.createGain();
    this.roarG.gain.value = 0;
    this.roar.connect(this.roarF);
    this.roarF.connect(this.roarG);
    this.roarG.connect(this.master);
    this.roarG.connect(this.send);
    this.roar.start();
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = 0.86 * last + 0.14 * w;
        d[i] = w * 0.7 + last * 0.6;
      }
    }
    return buf;
  }

  makeIR(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
      // early reflections
      for (const [tap, amp] of [[0.011, 0.5], [0.023, 0.35], [0.037, 0.28], [0.061, 0.2]]) {
        const idx = Math.floor(tap * ctx.sampleRate) + c * 37;
        if (idx < len) d[idx] += amp;
      }
    }
    return buf;
  }

  makeDistortion(amount) {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + amount) * x * 20 * Math.PI) / (Math.PI + amount * Math.abs(x));
      curve[i] = Math.tanh(curve[i] * 0.06);
    }
    return curve;
  }

  resume() {
    if (!this.ok) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.started) {
      this.started = true;
      this.master.gain.setTargetAtTime(0.85, this.ctx.currentTime, 0.6);
    }
  }

  setMuted(m) {
    if (!this.ok) return;
    this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.1);
  }

  // ------------------------------------------------------------ continuous
  updateEngine(rpm, throttle, speed, boost, load) {
    if (!this.ok || !this.started) return;
    const t = this.ctx.currentTime;
    const f = clamp(rpm, 700, 7800) / 60 * 2; // firing frequency-ish
    for (const h of this.oscs) {
      h.o.frequency.setTargetAtTime(f * h.mul, t, 0.03);
      h.g.gain.setTargetAtTime(h.base * (0.35 + throttle * 0.85), t, 0.05);
    }
    this.engFilter.frequency.setTargetAtTime(500 + throttle * 2400 + (rpm / 7800) * 2600, t, 0.04);
    this.engine.gain.setTargetAtTime(0.13 + throttle * 0.18 + boost * 0.12, t, 0.05);
    this.indGain.gain.setTargetAtTime(throttle * 0.055 + boost * 0.05, t, 0.06);
    this.indFilter.frequency.setTargetAtTime(300 + (rpm / 7800) * 1600, t, 0.06);
    this.turboGain.gain.setTargetAtTime(clamp((rpm - 3200) / 5200, 0, 1) * throttle * 0.028 + boost * 0.02, t, 0.08);
    this.turbo.frequency.setTargetAtTime(2200 + (rpm / 7800) * 4200 + boost * 900, t, 0.08);
    this.windG.gain.setTargetAtTime(clamp(speed / 100, 0, 1) * 0.16, t, 0.12);
    this.windF.frequency.setTargetAtTime(320 + clamp(speed / 100, 0, 1) * 1500, t, 0.12);
    this.roarG.gain.setTargetAtTime(boost * 0.22, t, 0.12);
    this.roarF.frequency.setTargetAtTime(240 + boost * 620, t, 0.1);
    void load;
  }

  updateTyres(skid) {
    if (!this.ok || !this.started) return;
    const t = this.ctx.currentTime;
    this.screechG.gain.setTargetAtTime(clamp(skid, 0, 1) * 0.13, t, 0.06);
    this.screechF.frequency.setTargetAtTime(900 + clamp(skid, 0, 1) * 900, t, 0.08);
  }

  scrape(intensity) {
    if (!this.ok || !this.started) return;
    this._scrapeTarget = clamp(intensity, 0, 1);
  }

  tick(dt) {
    if (!this.ok || !this.started) return;
    const t = this.ctx.currentTime;
    this.scrapeG.gain.setTargetAtTime(this._scrapeTarget * 0.16, t, 0.05);
    this._scrapeTarget *= Math.exp(-8 * dt);
    // slow-mo filter sweep
    const target = 20000 * Math.pow(0.035, this.slowmo);
    this.slowFilter.frequency.setTargetAtTime(target, t, 0.08);
    for (const h of this.oscs) h.o.detune.setTargetAtTime(-this.slowmo * 900, t, 0.1);
  }

  setSlowmo(v) { this.slowmo = clamp(v, 0, 1); }

  // -------------------------------------------------------------- one-shots
  _burst({ dur = 0.25, freq = 900, q = 3, type = 'bandpass', gain = 0.5, sweep = 0, curve = 3, delay = 0 }) {
    if (!this.ok || !this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); g.connect(this.send);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
    void curve;
  }

  _thump(freq, dur, gain) {
    if (!this.ok || !this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(24, freq * 0.28), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); g.connect(this.send);
    o.start(t); o.stop(t + dur + 0.02);
  }

  crunch(energy, pos, wall = false) {
    if (!this.ok || !this.started) return;
    const e = clamp(energy, 0, 1);
    this._burst({ dur: 0.10 + e * 0.30, freq: (wall ? 1500 : 900) + e * 900, q: 1.6, gain: 0.35 + e * 0.5, sweep: 0.2 });
    this._burst({ dur: 0.05 + e * 0.1, freq: 3400, q: 3, gain: 0.12 + e * 0.25, sweep: 0.4 });
    this._thump(70 + e * 60, 0.16 + e * 0.35, 0.35 + e * 0.55);
    if (e > 0.35) this.glass(e);
    void pos;
  }

  glass(e = 0.6) {
    if (!this.ok || !this.started) return;
    const n = Math.floor(4 + e * 10);
    // Scheduled on the audio clock, not setTimeout: a software-GL frame can
    // block the main thread for 15s, which would collapse the whole tinkle
    // into one stacked click the moment the thread unblocks.
    for (let i = 0; i < n; i++) {
      this._burst({
        dur: 0.05 + Math.random() * 0.09, freq: 4200 + Math.random() * 4500,
        q: 12, gain: 0.06 + Math.random() * 0.1, sweep: 0.7, delay: Math.random() * 0.26,
      });
    }
  }

  explosion() {
    if (!this.ok || !this.started) return;
    this._burst({ dur: 1.4, freq: 900, q: 0.8, type: 'lowpass', gain: 0.85, sweep: 0.08 });
    this._thump(95, 0.9, 0.9);
    this._burst({ dur: 0.35, freq: 5200, q: 1.2, gain: 0.3, sweep: 0.2 });
  }

  whoosh(strength = 1) {
    if (!this.ok || !this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 2.4;
    f.frequency.setValueAtTime(380, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.16);
    f.frequency.exponentialRampToValueAtTime(320, t + 0.42);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22 * strength, t + 0.14);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.48);
    src.connect(f); f.connect(g); g.connect(this.master); g.connect(this.send);
    src.start(t, Math.random());
    src.stop(t + 0.55);
  }

  blowoff() {
    if (!this.ok || !this.started) return;
    this._burst({ dur: 0.22, freq: 5200, q: 1.6, gain: 0.18, sweep: 0.25 });
  }

  boostHit() {
    if (!this.ok || !this.started) return;
    this._thump(150, 0.5, 0.5);
    this._burst({ dur: 0.5, freq: 620, q: 1.0, type: 'lowpass', gain: 0.35, sweep: 0.35 });
  }

  takedownSting() {
    if (!this.ok || !this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const [f0, f1, d, gain] of [[220, 110, 0.9, 0.28], [330, 165, 0.9, 0.18], [880, 440, 0.6, 0.1]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + d);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0008, t + d);
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass'; flt.frequency.value = 2400;
      o.connect(flt); flt.connect(g); g.connect(this.master); g.connect(this.send);
      o.start(t); o.stop(t + d + 0.05);
    }
  }
}
