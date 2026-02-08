/**
 * Road Rage — synthesized sound system (Web Audio API, no audio files).
 *
 * Layered engine, combat hits, countdown beeps, and 160 BPM driving rock music.
 */

// ── Shared state ────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;

// Persistent layered engine nodes
let engineNodes: {
  base: OscillatorNode;
  harmonic: OscillatorNode;
  sub: OscillatorNode;
  gain: GainNode;
} | null = null;

// Music state
let musicGain: GainNode | null = null;
let musicIntervalId: ReturnType<typeof setInterval> | null = null;
let musicPlaying = false;
let musicNextBar = 0; // audioCtx time of next bar to schedule

function getCtx(): AudioContext | null {
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// ── Init ────────────────────────────────────────────────────────

/** Initialize audio context and start the engine loop. */
export function initSounds(): void {
  getCtx();
  startEngine();
}

// ── Layered engine ──────────────────────────────────────────────

function startEngine(): void {
  const c = getCtx();
  if (!c || engineNodes) return;

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.10, c.currentTime);
  gain.connect(c.destination);

  // Base — sawtooth, 60 Hz idle
  const base = c.createOscillator();
  base.type = 'sawtooth';
  base.frequency.setValueAtTime(60, c.currentTime);
  base.connect(gain);

  // Harmonic — square at 1.5× base, −12 dB (≈ 0.25 gain)
  const harmonic = c.createOscillator();
  harmonic.type = 'square';
  harmonic.frequency.setValueAtTime(90, c.currentTime);
  const harmGain = c.createGain();
  harmGain.gain.setValueAtTime(0.25, c.currentTime);
  harmonic.connect(harmGain);
  harmGain.connect(gain);

  // Sub-bass — sine at 0.5× base, −6 dB (≈ 0.5 gain)
  const sub = c.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(30, c.currentTime);
  const subGain = c.createGain();
  subGain.gain.setValueAtTime(0.5, c.currentTime);
  sub.connect(subGain);
  subGain.connect(gain);

  base.start();
  harmonic.start();
  sub.start();

  engineNodes = { base, harmonic, sub, gain };
}

/** Smoothly lerp engine frequencies each frame. */
export function updateEngine(speed: number, maxSpeed: number): void {
  if (!engineNodes || !audioCtx) return;
  const ratio = Math.max(0, Math.min(1, speed / maxSpeed));
  const baseFreq = 60 + ratio * 240; // 60 → 300 Hz
  const t = audioCtx.currentTime;

  engineNodes.base.frequency.setTargetAtTime(baseFreq, t, 0.05);
  engineNodes.harmonic.frequency.setTargetAtTime(baseFreq * 1.5, t, 0.05);
  engineNodes.sub.frequency.setTargetAtTime(baseFreq * 0.5, t, 0.05);
  engineNodes.gain.gain.setTargetAtTime(0.08 + ratio * 0.12, t, 0.05);
}

function stopEngine(): void {
  if (!engineNodes) return;
  try { engineNodes.base.stop(); } catch { /* */ }
  try { engineNodes.harmonic.stop(); } catch { /* */ }
  try { engineNodes.sub.stop(); } catch { /* */ }
  try { engineNodes.gain.disconnect(); } catch { /* */ }
  engineNodes = null;
}

// ── Noise helper ────────────────────────────────────────────────

function createNoiseBurst(c: AudioContext, duration: number): AudioBufferSourceNode {
  const len = Math.max(1, Math.floor(c.sampleRate * duration));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

// ── Punch hit ───────────────────────────────────────────────────

/** 50 ms noise burst (bandpass 800 Hz) + 80 Hz sine thump. */
export function playPunchHit(): void {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;

  // Noise burst
  const noise = createNoiseBurst(c, 0.05);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(800, t);
  bp.Q.setValueAtTime(2, t);
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.4, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  noise.connect(bp);
  bp.connect(ng);
  ng.connect(c.destination);
  noise.start(t);
  noise.stop(t + 0.05);

  // Thump
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(80, t);
  const og = c.createGain();
  og.gain.setValueAtTime(0.35, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  osc.connect(og);
  og.connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.06);
}

// ── Kick hit ────────────────────────────────────────────────────

/** 80 ms noise burst (bandpass 600 Hz) + 60 Hz sine, louder than punch. */
export function playKickHit(): void {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;

  const noise = createNoiseBurst(c, 0.08);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(600, t);
  bp.Q.setValueAtTime(1.5, t);
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.55, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  noise.connect(bp);
  bp.connect(ng);
  ng.connect(c.destination);
  noise.start(t);
  noise.stop(t + 0.08);

  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(60, t);
  const og = c.createGain();
  og.gain.setValueAtTime(0.5, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  osc.connect(og);
  og.connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.1);
}

// ── Crash / wipeout ─────────────────────────────────────────────

/** 100 ms noise impact + 300 ms filtered sweep + 3 diminishing thuds. */
export function playCrash(): void {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;

  // Impact noise burst (100 ms)
  const impact = createNoiseBurst(c, 0.1);
  const impG = c.createGain();
  impG.gain.setValueAtTime(0.5, t);
  impG.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  impact.connect(impG);
  impG.connect(c.destination);
  impact.start(t);
  impact.stop(t + 0.1);

  // Filtered sweep (300 ms)
  const sweep = createNoiseBurst(c, 0.3);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(3000, t + 0.05);
  bp.frequency.exponentialRampToValueAtTime(300, t + 0.35);
  bp.Q.setValueAtTime(6, t);
  const sg = c.createGain();
  sg.gain.setValueAtTime(0.4, t + 0.05);
  sg.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  sweep.connect(bp);
  bp.connect(sg);
  sg.connect(c.destination);
  sweep.start(t + 0.05);
  sweep.stop(t + 0.35);

  // 3 diminishing thuds
  for (let i = 0; i < 3; i++) {
    const offset = 0.1 + i * 0.12;
    const vol = 0.35 - i * 0.1;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120 - i * 25, t + offset);
    osc.frequency.exponentialRampToValueAtTime(40, t + offset + 0.08);
    const g = c.createGain();
    g.gain.setValueAtTime(Math.max(vol, 0.05), t + offset);
    g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.1);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.1);
  }
}

// ── Chain hit (metallic clink) ───────────────────────────────────

/** Short high-freq sine ping + tiny noise burst — metallic clink. */
export function playChainHit(): void {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;

  // High sine ping
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(2400, t);
  osc.frequency.exponentialRampToValueAtTime(1200, t + 0.06);
  const og = c.createGain();
  og.gain.setValueAtTime(0.35, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  osc.connect(og);
  og.connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.08);

  // Tiny noise burst (highpass for metallic shimmer)
  const noise = createNoiseBurst(c, 0.04);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(4000, t);
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.25, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  noise.connect(hp);
  hp.connect(ng);
  ng.connect(c.destination);
  noise.start(t);
  noise.stop(t + 0.04);
}

// ── Club hit (deep thud) ────────────────────────────────────────

/** Low sine thump + short mid-freq noise — heavy wooden thud. */
export function playClubHit(): void {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;

  // Deep thump
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(50, t);
  osc.frequency.exponentialRampToValueAtTime(30, t + 0.12);
  const og = c.createGain();
  og.gain.setValueAtTime(0.5, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  osc.connect(og);
  og.connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.14);

  // Mid-freq noise burst
  const noise = createNoiseBurst(c, 0.07);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(400, t);
  bp.Q.setValueAtTime(1, t);
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.4, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  noise.connect(bp);
  bp.connect(ng);
  ng.connect(c.destination);
  noise.start(t);
  noise.stop(t + 0.07);
}

// ── Grunt (player takes damage) ─────────────────────────────────

/** Brief low formant-like grunt — two detuned oscillators. */
export function playGrunt(): void {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;

  // Fundamental
  const osc1 = c.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(120, t);
  osc1.frequency.exponentialRampToValueAtTime(80, t + 0.1);
  const g1 = c.createGain();
  g1.gain.setValueAtTime(0.25, t);
  g1.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc1.connect(g1);
  g1.connect(c.destination);
  osc1.start(t);
  osc1.stop(t + 0.12);

  // Formant
  const osc2 = c.createOscillator();
  osc2.type = 'square';
  osc2.frequency.setValueAtTime(220, t);
  osc2.frequency.exponentialRampToValueAtTime(140, t + 0.08);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.12, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  osc2.connect(g2);
  g2.connect(c.destination);
  osc2.start(t);
  osc2.stop(t + 0.1);
}

// ── Police siren (brief burst) ──────────────────────────────────

let sirenOsc: OscillatorNode | null = null;
let sirenGain: GainNode | null = null;

/** Play a brief 0.6 s siren burst (600→800→600 Hz). */
export function playSirenBurst(): void {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, t);
  osc.frequency.linearRampToValueAtTime(800, t + 0.3);
  osc.frequency.linearRampToValueAtTime(600, t + 0.6);
  const g = c.createGain();
  g.gain.setValueAtTime(0.25, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.6);
}

/** Start a continuous quiet background siren. */
export function startSirenLoop(): void {
  if (sirenOsc) return;
  const c = getCtx();
  if (!c) return;
  sirenGain = c.createGain();
  sirenGain.gain.setValueAtTime(0.06, c.currentTime);
  sirenGain.connect(c.destination);
  sirenOsc = c.createOscillator();
  sirenOsc.type = 'sine';
  sirenOsc.frequency.setValueAtTime(600, c.currentTime);
  // Use LFO to oscillate between 600-800 Hz
  const lfo = c.createOscillator();
  lfo.frequency.setValueAtTime(1.5, c.currentTime); // 1.5 Hz wobble
  const lfoGain = c.createGain();
  lfoGain.gain.setValueAtTime(100, c.currentTime);
  lfo.connect(lfoGain);
  lfoGain.connect(sirenOsc.frequency);
  lfo.start();
  sirenOsc.connect(sirenGain);
  sirenOsc.start();
}

/** Stop the continuous background siren. */
export function stopSirenLoop(): void {
  if (sirenOsc) {
    try { sirenOsc.stop(); } catch { /* */ }
    sirenOsc = null;
  }
  if (sirenGain) {
    try { sirenGain.disconnect(); } catch { /* */ }
    sirenGain = null;
  }
}

// ── Countdown beeps ─────────────────────────────────────────────

/** Sine 440 Hz × 100 ms, or 880 Hz × 300 ms for GO. */
export function playCountdownBeep(isFinal: boolean): void {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  const freq = isFinal ? 880 : 440;
  const dur = isFinal ? 0.3 : 0.1;

  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t);
  const g = c.createGain();
  g.gain.setValueAtTime(0.35, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t);
  osc.stop(t + dur);
}

// ── Background music (160 BPM driving rock) ─────────────────────

const BPM = 160;
const BEAT = 60 / BPM;           // ~0.375 s
const BAR = BEAT * 4;            // ~1.5 s
const BARS_AHEAD = 4;            // schedule 4 bars ahead
const LOOP_BARS = 4;             // 4-bar loop
const EIGHTH = BEAT / 2;

// Bass pattern — E2 G2 A2 E2 (one note per bar)
const BASS_ROOTS = [82.41, 98.0, 110.0, 82.41];

// Chord roots for power 5ths — same progression
const CHORD_ROOTS = [82.41, 98.0, 110.0, 82.41];
const FIFTH_RATIO = 1.5; // power fifth

// Lead melody — simple pentatonic over 4 bars (one note per beat)
const LEAD_NOTES = [
  329.63, 392.0, 440.0, 392.0,   // bar 1: E4 G4 A4 G4
  440.0, 523.25, 440.0, 392.0,   // bar 2: A4 C5 A4 G4
  523.25, 587.33, 523.25, 440.0, // bar 3: C5 D5 C5 A4
  392.0, 329.63, 392.0, 440.0,   // bar 4: G4 E4 G4 A4
];

function scheduleMusicBars(c: AudioContext, mg: GainNode): void {
  const now = c.currentTime;
  const scheduleUntil = now + BARS_AHEAD * BAR;

  while (musicNextBar < scheduleUntil) {
    const barIndex = Math.round(musicNextBar / BAR) % LOOP_BARS;
    const barStart = musicNextBar;

    // ── Bass (square wave, one note per bar, staccato eighths)
    const bassFreq = BASS_ROOTS[barIndex];
    for (let e = 0; e < 8; e++) {
      const t = barStart + e * EIGHTH;
      const dur = EIGHTH * 0.7;
      const bass = c.createOscillator();
      bass.type = 'square';
      bass.frequency.setValueAtTime(bassFreq, t);
      const bg = c.createGain();
      bg.gain.setValueAtTime(0.10, t);
      bg.gain.exponentialRampToValueAtTime(0.001, t + dur);
      bass.connect(bg);
      bg.connect(mg);
      bass.start(t);
      bass.stop(t + dur);
    }

    // ── Chords (detuned squares, power 5ths, staccato on beats)
    const chordRoot = CHORD_ROOTS[barIndex];
    for (let b = 0; b < 4; b++) {
      const t = barStart + b * BEAT;
      const dur = BEAT * 0.5;

      const r = c.createOscillator();
      r.type = 'square';
      r.frequency.setValueAtTime(chordRoot * 2, t); // octave up
      r.detune.setValueAtTime(-8, t);
      const rg = c.createGain();
      rg.gain.setValueAtTime(0.05, t);
      rg.gain.exponentialRampToValueAtTime(0.001, t + dur);
      r.connect(rg);
      rg.connect(mg);
      r.start(t);
      r.stop(t + dur);

      const f = c.createOscillator();
      f.type = 'square';
      f.frequency.setValueAtTime(chordRoot * 2 * FIFTH_RATIO, t);
      f.detune.setValueAtTime(8, t);
      const fg = c.createGain();
      fg.gain.setValueAtTime(0.04, t);
      fg.gain.exponentialRampToValueAtTime(0.001, t + dur);
      f.connect(fg);
      fg.connect(mg);
      f.start(t);
      f.stop(t + dur);
    }

    // ── Lead (triangle, pentatonic melody)
    for (let b = 0; b < 4; b++) {
      const noteIdx = barIndex * 4 + b;
      const t = barStart + b * BEAT;
      const dur = BEAT * 0.6;
      const lead = c.createOscillator();
      lead.type = 'triangle';
      lead.frequency.setValueAtTime(LEAD_NOTES[noteIdx], t);
      const lg = c.createGain();
      lg.gain.setValueAtTime(0.06, t);
      lg.gain.exponentialRampToValueAtTime(0.001, t + dur);
      lead.connect(lg);
      lg.connect(mg);
      lead.start(t);
      lead.stop(t + dur);
    }

    // ── Drums
    for (let b = 0; b < 4; b++) {
      const beatTime = barStart + b * BEAT;

      // Kick on beats 1, 3
      if (b === 0 || b === 2) {
        const kick = c.createOscillator();
        kick.type = 'sine';
        kick.frequency.setValueAtTime(60, beatTime);
        kick.frequency.exponentialRampToValueAtTime(30, beatTime + 0.06);
        const kg = c.createGain();
        kg.gain.setValueAtTime(0.18, beatTime);
        kg.gain.exponentialRampToValueAtTime(0.001, beatTime + 0.08);
        kick.connect(kg);
        kg.connect(mg);
        kick.start(beatTime);
        kick.stop(beatTime + 0.08);
      }

      // Snare on beats 2, 4
      if (b === 1 || b === 3) {
        const snLen = Math.max(1, Math.floor(c.sampleRate * 0.06));
        const snBuf = c.createBuffer(1, snLen, c.sampleRate);
        const sd = snBuf.getChannelData(0);
        for (let j = 0; j < snLen; j++) sd[j] = Math.random() * 2 - 1;
        const sn = c.createBufferSource();
        sn.buffer = snBuf;
        const sg = c.createGain();
        sg.gain.setValueAtTime(0.12, beatTime);
        sg.gain.exponentialRampToValueAtTime(0.001, beatTime + 0.06);
        sn.connect(sg);
        sg.connect(mg);
        sn.start(beatTime);
        sn.stop(beatTime + 0.06);
      }

      // Hi-hat on every 8th note
      for (let e = 0; e < 2; e++) {
        const ht = beatTime + e * EIGHTH;
        const hLen = Math.max(1, Math.floor(c.sampleRate * 0.02));
        const hBuf = c.createBuffer(1, hLen, c.sampleRate);
        const hd = hBuf.getChannelData(0);
        for (let j = 0; j < hLen; j++) hd[j] = Math.random() * 2 - 1;
        const hat = c.createBufferSource();
        hat.buffer = hBuf;
        const hp = c.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(8000, ht);
        const hg = c.createGain();
        hg.gain.setValueAtTime(0.05, ht);
        hg.gain.exponentialRampToValueAtTime(0.001, ht + 0.02);
        hat.connect(hp);
        hp.connect(hg);
        hg.connect(mg);
        hat.start(ht);
        hat.stop(ht + 0.02);
      }
    }

    musicNextBar += BAR;
  }
}

/** Start the driving background music loop. */
export function startMusic(): void {
  if (musicPlaying) return;
  const c = getCtx();
  if (!c) return;

  musicPlaying = true;

  if (!musicGain) {
    musicGain = c.createGain();
    musicGain.gain.value = 0.15;
    musicGain.connect(c.destination);
  }

  musicNextBar = c.currentTime + 0.05;
  scheduleMusicBars(c, musicGain);

  musicIntervalId = setInterval(() => {
    if (!musicPlaying || !musicGain) return;
    const ctx = getCtx();
    if (ctx) scheduleMusicBars(ctx, musicGain!);
  }, 100);
}

/** Stop the background music. */
export function stopMusic(): void {
  musicPlaying = false;
  if (musicIntervalId !== null) {
    clearInterval(musicIntervalId);
    musicIntervalId = null;
  }
  if (musicGain) {
    try { musicGain.disconnect(); } catch { /* */ }
    musicGain = null;
  }
}

// ── Cleanup ─────────────────────────────────────────────────────

/** Stop all sounds and close audio context. */
export function stopAllSounds(): void {
  stopEngine();
  stopMusic();
  stopSirenLoop();
  if (audioCtx) {
    audioCtx.close().catch(() => { /* */ });
    audioCtx = null;
  }
}
