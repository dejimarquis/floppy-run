/**
 * 100% procedural WebAudio. No files.
 *
 * Solenoid thunks, bumper pops, slingshot snaps, drop-target clacks, metallic
 * rail pings whose pitch tracks impact velocity, a continuous rolling-ball
 * noise bed filtered by ball speed, plunger spring, knocker, chimes, and an
 * arpeggiated chiptune score that intensifies during multiball — all fed
 * through a procedurally generated convolution reverb (cabinet resonance).
 */

/** Clamp to a finite range — WebAudio throws on NaN/Infinity params. */
function fin(v, dflt, lo, hi) {
  v = +v;
  if (!Number.isFinite(v)) return dflt;
  return v < lo ? lo : v > hi ? hi : v;
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.master = null;
    this.rollNodes = [];
    this.musicIntensity = 0;
    this._musicT = 0;
    this._step = 0;
    this._noiseBuf = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.62;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;

    // --- procedural convolution reverb (cabinet + arcade room) ---
    const dur = 1.35;
    const len = Math.floor(ctx.sampleRate * dur);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let seed = 12345 + c * 777;
      const rnd = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, 3.1);
        // early reflections give it the plywood box character
        const er = i < ctx.sampleRate * 0.05 ? (Math.sin(i * 0.31) * 0.5 + 0.5) * 0.6 : 0;
        d[i] = (rnd() * 2 - 1) * env * (0.5 + er);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.26;
    conv.connect(wet);
    wet.connect(master);
    this.reverb = conv;

    this.dry = ctx.createGain();
    this.dry.gain.value = 1;
    this.dry.connect(master);

    // shared white noise buffer
    const nlen = ctx.sampleRate * 2;
    const nb = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    let s2 = 99;
    for (let i = 0; i < nlen; i++) {
      s2 = (s2 * 1103515245 + 12345) >>> 0;
      nd[i] = (s2 / 2147483648) - 1;
    }
    this._noiseBuf = nb;

    // --- continuous rolling bed ---
    this.rollSrc = ctx.createBufferSource();
    this.rollSrc.buffer = nb;
    this.rollSrc.loop = true;
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'bandpass';
    this.rollFilter.frequency.value = 320;
    this.rollFilter.Q.value = 1.1;
    this.rollFilter2 = ctx.createBiquadFilter();
    this.rollFilter2.type = 'lowpass';
    this.rollFilter2.frequency.value = 2600;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    this.rollSrc.connect(this.rollFilter);
    this.rollFilter.connect(this.rollFilter2);
    this.rollFilter2.connect(this.rollGain);
    this.rollGain.connect(this.dry);
    this.rollGain.connect(conv);
    this.rollSrc.start();

    // --- music bus ---
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.0;
    this.musicGain.connect(this.dry);
    this.musicGain.connect(conv);

    this.ready = true;
  }

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  get t() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  _noise(dur, gain, filter, dest) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const g = ctx.createGain();
    const t = this.t;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = src;
    if (filter) {
      src.connect(filter);
      node = filter;
    }
    node.connect(g);
    g.connect(dest || this.dry);
    g.connect(this.reverb);
    src.start(t);
    src.stop(t + dur + 0.02);
    return g;
  }

  _tone(freq, dur, gain, type = 'sine', detune = 0, decay = 4, when = 0) {
    if (!this.ready) return;
    freq = fin(freq, 440, 8, 20000);
    dur = fin(dur, 0.1, 0.01, 6);
    gain = fin(gain, 0.2, 0.0002, 1.6);
    detune = fin(detune, 0, -2400, 2400);
    when = fin(when, 0, 0, 30);
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    // `when` is an offset in seconds from now. Sequenced ladders (bonus
    // chimes, spinner clicks, the jackpot fanfare) are booked on the audio
    // clock rather than via setTimeout: under software GL the main thread can
    // stall for seconds and every queued callback would then fire at once.
    const t = this.t + Math.max(0, when);
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.dry);
    g.connect(this.reverb);
    o.start(t);
    o.stop(t + dur + 0.02);
    void decay;
    return { o, g };
  }

  /* ------------------------- events ------------------------- */

  flipper(up) {
    if (!this.ready || !this.enabled) return;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = up ? 220 : 150;
    f.Q.value = 1.4;
    this._noise(up ? 0.075 : 0.055, up ? 0.5 : 0.22, f);
    const s = this._tone(up ? 96 : 74, 0.09, 0.42, 'sine');
    if (s) s.o.frequency.exponentialRampToValueAtTime(up ? 52 : 44, this.t + 0.08);
  }

  bumper(v = 1) {
    if (!this.ready || !this.enabled) return;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 420 + v * 260;
    f.Q.value = 2.2;
    this._noise(0.1, 0.55, f);
    const s = this._tone(180 + v * 60, 0.16, 0.5, 'triangle');
    if (s) s.o.frequency.exponentialRampToValueAtTime(70, this.t + 0.15);
    this._tone(1180, 0.06, 0.16, 'square');
  }

  sling() {
    if (!this.ready || !this.enabled) return;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 900;
    this._noise(0.06, 0.5, f);
    const s = this._tone(240, 0.08, 0.35, 'sawtooth');
    if (s) s.o.frequency.exponentialRampToValueAtTime(90, this.t + 0.07);
  }

  clack(pitch = 1) {
    if (!this.ready || !this.enabled) return;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1500 * pitch;
    f.Q.value = 3.5;
    this._noise(0.045, 0.45, f);
    this._tone(520 * pitch, 0.05, 0.2, 'square');
  }

  ping(v) {
    if (!this.ready || !this.enabled) return;
    const base = 620 + Math.min(1, v / 5) * 1500;
    const g = 0.06 + Math.min(1, v / 4) * 0.16;
    this._tone(base, 0.13, g, 'sine');
    this._tone(base * 2.41, 0.09, g * 0.5, 'sine');
    this._tone(base * 3.83, 0.06, g * 0.25, 'sine');
  }

  thud(v) {
    if (!this.ready || !this.enabled) return;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400 + v * 200;
    this._noise(0.06, 0.1 + Math.min(0.3, v * 0.07), f);
  }

  spinner(n, when = 0) {
    if (!this.ready || !this.enabled) return;
    const i = Math.max(0, Math.floor(n));
    this._tone(700 + (i % 9) * 90, 0.05, 0.11, 'square', 0, 4, when);
  }

  plungerPull(power) {
    if (!this.ready || !this.enabled) return;
    const s = this._tone(60 + power * 90, 0.06, 0.1, 'sawtooth');
    if (s) s.o.frequency.linearRampToValueAtTime(60 + power * 160, this.t + 0.06);
  }

  plungerRelease(power) {
    if (!this.ready || !this.enabled) return;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 300 + power * 700;
    f.Q.value = 1.2;
    this._noise(0.18, 0.35 + power * 0.3, f);
    const s = this._tone(420 + power * 260, 0.28, 0.28, 'sawtooth');
    if (s) s.o.frequency.exponentialRampToValueAtTime(70, this.t + 0.26);
  }

  chime(step = 0, when = 0) {
    if (!this.ready || !this.enabled) return;
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.5];
    const i = Math.max(0, Math.floor(step));
    const f = scale[i % scale.length] * (i >= scale.length ? 2 : 1);
    this._tone(f, 0.5, 0.16, 'sine', 0, 4, when);
    this._tone(f * 2.0, 0.35, 0.06, 'sine', 0, 4, when);
    this._tone(f * 3.0, 0.2, 0.03, 'triangle', 0, 4, when);
  }

  knocker() {
    if (!this.ready || !this.enabled) return;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    this._noise(0.12, 0.85, f);
    const s = this._tone(120, 0.2, 0.7, 'sine');
    if (s) s.o.frequency.exponentialRampToValueAtTime(40, this.t + 0.18);
  }

  tilt() {
    if (!this.ready || !this.enabled) return;
    for (let i = 0; i < 4; i++) {
      const s = this._tone(200 - i * 30, 0.4, 0.3, 'sawtooth');
      if (s) s.o.detune.value = i * 40;
    }
  }

  jackpot() {
    if (!this.ready || !this.enabled) return;
    const notes = [523, 659, 784, 1046, 1319];
    notes.forEach((n, i) => this._tone(n, 0.4, 0.2, 'square', 0, 4, i * 0.055));
  }

  saucer() {
    if (!this.ready || !this.enabled) return;
    const s = this._tone(180, 0.7, 0.2, 'sine');
    if (s) s.o.frequency.exponentialRampToValueAtTime(1400, this.t + 0.65);
  }

  drain() {
    if (!this.ready || !this.enabled) return;
    const s = this._tone(300, 0.8, 0.25, 'sawtooth');
    if (s) s.o.frequency.exponentialRampToValueAtTime(60, this.t + 0.75);
  }

  /* ------------------------- ambience ------------------------- */

  setRolling(speed, onRamp) {
    if (!this.ready) return;
    const t = this.t;
    const target = Math.min(0.16, speed * 0.055) * (this.enabled ? 1 : 0);
    this.rollGain.gain.setTargetAtTime(target, t, 0.06);
    this.rollFilter.frequency.setTargetAtTime(200 + speed * 260, t, 0.06);
    this.rollFilter2.frequency.setTargetAtTime(onRamp ? 5200 : 2200 + speed * 700, t, 0.08);
    this.rollFilter.Q.setTargetAtTime(onRamp ? 3.2 : 1.1, t, 0.1);
  }

  /* ------------------------- music ------------------------- */

  setMusic(level) {
    this.musicIntensity = level;
    if (!this.ready) return;
    this.musicGain.gain.setTargetAtTime(this.enabled ? level * 0.16 : 0, this.t, 0.35);
  }

  updateMusic(dt) {
    if (!this.ready || this.musicIntensity <= 0.01) return;
    const bpm = 118 + this.musicIntensity * 42;
    const stepDur = 60 / bpm / 4;
    // A software-GL frame can be most of a second, which would otherwise dump
    // twenty sixteenth-notes onto the same audio timestamp as one atonal
    // cluster. Cap the catch-up and lay the recovered steps out forward on the
    // audio clock so the arpeggio keeps its groove instead of stuttering.
    this._musicT += Math.min(dt, stepDur * 8);
    let slot = 0;
    while (this._musicT > stepDur && slot < 8) {
      this._musicT -= stepDur;
      this._playStep(this._step++, slot * stepDur);
      slot++;
    }
  }

  _playStep(step, when = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    step = Number.isFinite(+step) ? Math.max(0, Math.floor(+step)) : 0;
    const t = this.t + Math.max(0, fin(when, 0, 0, 30));
    const root = 55; // A1
    const prog = [0, 0, 5, 5, 3, 3, 7, 7];
    const chordRoot = root * Math.pow(2, prog[Math.floor(step / 8) % 8] / 12);
    const arp = [0, 7, 12, 15, 19, 15, 12, 7];
    const n = arp[step % 8];
    const f = chordRoot * 4 * Math.pow(2, n / 12);
    const intensity = this.musicIntensity;

    const o = ctx.createOscillator();
    o.type = intensity > 0.7 ? 'square' : 'triangle';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16 * (0.5 + intensity * 0.5), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g);
    g.connect(this.musicGain);
    o.start(t);
    o.stop(t + 0.2);

    // bass on the down-beats
    if (step % 4 === 0) {
      const b = ctx.createOscillator();
      b.type = 'sawtooth';
      b.frequency.value = chordRoot;
      const bf = ctx.createBiquadFilter();
      bf.type = 'lowpass';
      bf.frequency.setValueAtTime(700 + intensity * 900, t);
      bf.frequency.exponentialRampToValueAtTime(180, t + 0.22);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, t);
      bg.gain.linearRampToValueAtTime(0.3, t + 0.01);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
      b.connect(bf);
      bf.connect(bg);
      bg.connect(this.musicGain);
      b.start(t);
      b.stop(t + 0.3);
    }
    // hats
    if (intensity > 0.55 && step % 2 === 1) {
      const hf = ctx.createBiquadFilter();
      hf.type = 'highpass';
      hf.frequency.value = 7000;
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      src.loop = true;
      const hg = ctx.createGain();
      hg.gain.setValueAtTime(0.06 * intensity, t);
      hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      src.connect(hf);
      hf.connect(hg);
      hg.connect(this.musicGain);
      src.start(t);
      src.stop(t + 0.06);
    }
  }
}
