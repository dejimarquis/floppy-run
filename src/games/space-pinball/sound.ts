export interface PinballAudio {
  ctx: AudioContext;
  masterGain: GainNode;
  muted: boolean;
}

export function createPinballAudio(): PinballAudio {
  const ctx = new AudioContext();
  const masterGain = ctx.createGain();
  masterGain.connect(ctx.destination);
  return { ctx, masterGain, muted: false };
}

function ensureRunning(audio: PinballAudio): void {
  if (audio.ctx.state === "suspended") audio.ctx.resume();
}

function createNoiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function createNoise(
  audio: PinballAudio,
  duration: number,
): AudioBufferSourceNode {
  const node = audio.ctx.createBufferSource();
  node.buffer = createNoiseBuffer(audio.ctx, duration);
  return node;
}

// Quick "thwack" — noise burst + sine click
export function playFlipperSound(audio: PinballAudio): void {
  ensureRunning(audio);
  const { ctx, masterGain } = audio;
  const now = ctx.currentTime;

  // Noise burst 50ms
  const noise = createNoise(audio, 0.05);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.3, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  noise.connect(noiseGain).connect(masterGain);
  noise.start(now);
  noise.stop(now + 0.05);

  // Sine click at 200Hz
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(200, now);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.4, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  osc.connect(oscGain).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.05);
}

// Bright "ding" — sine sweep 800→1200Hz + harmonic
export function playBumperSound(
  audio: PinballAudio,
  velocity: number,
): void {
  ensureRunning(audio);
  const { ctx, masterGain } = audio;
  const now = ctx.currentTime;
  const vol = Math.min(1, Math.max(0.2, velocity));

  // Fundamental 800→1200Hz
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(800, now);
  osc.frequency.linearRampToValueAtTime(1200, now + 0.1);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.4 * vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  osc.connect(gain).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.1);

  // Harmonic at 1.5x
  const harm = ctx.createOscillator();
  harm.type = "sine";
  harm.frequency.setValueAtTime(1200, now);
  harm.frequency.linearRampToValueAtTime(1800, now + 0.1);
  const harmGain = ctx.createGain();
  harmGain.gain.setValueAtTime(0.15 * vol, now);
  harmGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  harm.connect(harmGain).connect(masterGain);
  harm.start(now);
  harm.stop(now + 0.1);
}

// Sharp "snap" — white noise burst 30ms + triangle 500Hz 60ms
export function playSlingSound(audio: PinballAudio): void {
  ensureRunning(audio);
  const { ctx, masterGain } = audio;
  const now = ctx.currentTime;

  const noise = createNoise(audio, 0.03);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.4, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
  noise.connect(noiseGain).connect(masterGain);
  noise.start(now);
  noise.stop(now + 0.03);

  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(500, now);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.3, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  osc.connect(oscGain).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.06);
}

// Ascending "swoosh" — filtered noise sweep + sine undertone
export function playRampSound(audio: PinballAudio): void {
  ensureRunning(audio);
  const { ctx, masterGain } = audio;
  const now = ctx.currentTime;

  // Filtered noise sweep 200→2000Hz over 300ms
  const noise = createNoise(audio, 0.3);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(200, now);
  filter.frequency.exponentialRampToValueAtTime(2000, now + 0.3);
  filter.Q.setValueAtTime(2, now);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.3, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  noise.connect(filter).connect(noiseGain).connect(masterGain);
  noise.start(now);
  noise.stop(now + 0.3);

  // Sine undertone 400→800Hz
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(800, now + 0.3);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.1, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  osc.connect(oscGain).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.3);
}

// Solid "clunk" — low sine 150Hz 80ms + click noise 40ms
export function playDropTargetSound(audio: PinballAudio): void {
  ensureRunning(audio);
  const { ctx, masterGain } = audio;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, now);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.5, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  osc.connect(oscGain).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.08);

  const noise = createNoise(audio, 0.04);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.3, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
  noise.connect(noiseGain).connect(masterGain);
  noise.start(now);
  noise.stop(now + 0.04);
}

// Soft "bloop" — sine 600Hz 50ms, gentle envelope
export function playRolloverSound(audio: PinballAudio): void {
  ensureRunning(audio);
  const { ctx, masterGain } = audio;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(600, now);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.2, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  osc.connect(gain).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.05);
}

// Quick "tick" — tiny noise click + sine 1000Hz, 20ms
export function playSpinnerSound(audio: PinballAudio): void {
  ensureRunning(audio);
  const { ctx, masterGain } = audio;
  const now = ctx.currentTime;

  const noise = createNoise(audio, 0.02);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.1, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
  noise.connect(noiseGain).connect(masterGain);
  noise.start(now);
  noise.stop(now + 0.02);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(1000, now);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.1, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
  osc.connect(oscGain).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.02);
}

// Descending "bong" — sine 300→100Hz over 500ms + delayed echo
export function playDrainSound(audio: PinballAudio): void {
  ensureRunning(audio);
  const { ctx, masterGain } = audio;
  const now = ctx.currentTime;

  // Primary tone
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(300, now);
  osc.frequency.exponentialRampToValueAtTime(100, now + 0.5);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.4, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  osc.connect(gain).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.5);

  // Delayed echo at lower volume
  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(280, now + 0.03);
  osc2.frequency.exponentialRampToValueAtTime(90, now + 0.53);
  const gain2 = ctx.createGain();
  gain2.gain.setValueAtTime(0, now);
  gain2.gain.setValueAtTime(0.2, now + 0.03);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.53);
  osc2.connect(gain2).connect(masterGain);
  osc2.start(now);
  osc2.stop(now + 0.53);
}

// Spring sound — sawtooth sweep 200→800Hz, duration based on power
export function playLaunchSound(
  audio: PinballAudio,
  power: number,
): void {
  ensureRunning(audio);
  const { ctx, masterGain } = audio;
  const now = ctx.currentTime;
  const p = Math.min(1, Math.max(0, power));
  const duration = p * 0.2;
  const endFreq = 200 + p * 600;

  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(200, now);
  osc.frequency.linearRampToValueAtTime(endFreq, now + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration + 0.01);
  osc.connect(gain).connect(masterGain);
  osc.start(now);
  osc.stop(now + duration + 0.01);
}

// Ascending arpeggio: 400, 500, 600, 800Hz, each 80ms apart, 60ms duration
export function playBonusSound(audio: PinballAudio): void {
  ensureRunning(audio);
  const { ctx, masterGain } = audio;
  const now = ctx.currentTime;
  const notes = [400, 500, 600, 800];

  notes.forEach((freq, i) => {
    const t = now + i * 0.08;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(gain).connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.06);
  });
}

// Triumphant fanfare — C-E-G chord (523, 659, 784Hz) 300ms sawtooth
export function playAllTargetsSound(audio: PinballAudio): void {
  ensureRunning(audio);
  const { ctx, masterGain } = audio;
  const now = ctx.currentTime;
  const freqs = [523, 659, 784];

  freqs.forEach((freq) => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.03);
    gain.gain.setValueAtTime(0.15, now + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain).connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.3);
  });
}

// Dramatic ascending gliss + sparkle
export function playSkillShotSound(audio: PinballAudio): void {
  ensureRunning(audio);
  const { ctx, masterGain } = audio;
  const now = ctx.currentTime;

  // Sine sweep 400→2000Hz over 400ms
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(2000, now + 0.4);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  osc.connect(gain).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.4);

  // Sparkle — high-frequency noise at 3000Hz, 200ms
  const noise = createNoise(audio, 0.2);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(3000, now);
  filter.Q.setValueAtTime(5, now);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.08, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  noise.connect(filter).connect(noiseGain).connect(masterGain);
  noise.start(now);
  noise.stop(now + 0.2);
}

// Harsh buzz — square 100Hz 500ms with tremolo at 10Hz
export function playTiltSound(audio: PinballAudio): void {
  ensureRunning(audio);
  const { ctx, masterGain } = audio;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(100, now);

  // Tremolo via amplitude modulation at 10Hz
  const tremoloOsc = ctx.createOscillator();
  tremoloOsc.type = "sine";
  tremoloOsc.frequency.setValueAtTime(10, now);
  const tremoloGain = ctx.createGain();
  tremoloGain.gain.setValueAtTime(0.15, now);

  const mainGain = ctx.createGain();
  mainGain.gain.setValueAtTime(0.3, now);
  mainGain.gain.setValueAtTime(0.3, now + 0.4);
  mainGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

  tremoloOsc.connect(tremoloGain);
  tremoloGain.connect(mainGain.gain);
  osc.connect(mainGain).connect(masterGain);

  osc.start(now);
  tremoloOsc.start(now);
  osc.stop(now + 0.5);
  tremoloOsc.stop(now + 0.5);
}

// Descending 3-note phrase: 400, 300, 200Hz, each 200ms, last held longer
export function playGameOverSound(audio: PinballAudio): void {
  ensureRunning(audio);
  const { ctx, masterGain } = audio;
  const now = ctx.currentTime;
  const notes: [number, number][] = [
    [400, 0.2],
    [300, 0.2],
    [200, 0.5],
  ];

  let offset = 0;
  notes.forEach(([freq, dur]) => {
    const t = now + offset;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.01);
    gain.gain.setValueAtTime(0.3, t + dur * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(masterGain);
    osc.start(t);
    osc.stop(t + dur);
    offset += dur;
  });
}

export function toggleMute(audio: PinballAudio): void {
  audio.muted = !audio.muted;
  audio.masterGain.gain.setValueAtTime(audio.muted ? 0 : 1, audio.ctx.currentTime);
}
