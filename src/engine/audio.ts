/**
 * Web Audio API manager for Floppy.run
 *
 * GainNode chain:
 *   masterGain → sfxGain → individual source nodes
 *   masterGain → musicGain → background music (HTMLAudioElement via MediaElementSource)
 */

interface PlaySoundOptions {
  volume?: number;
  loop?: boolean;
  playbackRate?: number;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;

  private buffers = new Map<string, AudioBuffer>();
  private loopingSources = new Map<string, AudioBufferSourceNode>();

  private musicElement: HTMLAudioElement | null = null;
  private musicSource: MediaElementAudioSourceNode | null = null;

  private masterVolume = 1.0;
  private sfxVolume = 1.0;
  private musicVolume = 1.0;
  private muted = false;
  private previousMasterVolume = 1.0;

  private unlocked = false;
  private unlockHandler: (() => void) | null = null;

  constructor() {
    this.initContext();
  }

  // --- Initialisation & unlock ---

  private initContext(): void {
    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();

      this.sfxGain.connect(this.masterGain);
      this.musicGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.applyVolumes();

      if (this.ctx.state === "suspended") {
        this.registerUnlock();
      } else {
        this.unlocked = true;
      }
    } catch (e) {
      console.warn("[AudioManager] Web Audio API not supported:", e);
    }
  }

  private registerUnlock(): void {
    this.unlockHandler = () => {
      if (this.ctx && this.ctx.state === "suspended") {
        this.ctx.resume().then(() => {
          this.unlocked = true;
          this.removeUnlockListeners();
        });
      } else {
        this.unlocked = true;
        this.removeUnlockListeners();
      }
    };
    document.addEventListener("click", this.unlockHandler, { once: false });
    document.addEventListener("keydown", this.unlockHandler, { once: false });
  }

  private removeUnlockListeners(): void {
    if (this.unlockHandler) {
      document.removeEventListener("click", this.unlockHandler);
      document.removeEventListener("keydown", this.unlockHandler);
      this.unlockHandler = null;
    }
  }

  // --- Loading ---

  async loadSound(id: string, url: string): Promise<void> {
    if (this.buffers.has(id)) return;
    if (!this.ctx) {
      console.warn(`[AudioManager] No AudioContext – cannot load "${id}"`);
      return;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.buffers.set(id, audioBuffer);
    } catch (e) {
      console.warn(`[AudioManager] Failed to load sound "${id}" from ${url}:`, e);
    }
  }

  // --- Playback (one-shot & looped SFX) ---

  playSound(id: string, options?: PlaySoundOptions): AudioBufferSourceNode | null {
    const buffer = this.buffers.get(id);
    if (!buffer || !this.ctx || !this.sfxGain) {
      if (!buffer) console.warn(`[AudioManager] Sound "${id}" not loaded`);
      return null;
    }

    try {
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = options?.loop ?? false;
      source.playbackRate.value = options?.playbackRate ?? 1;

      // Per-sound volume via a transient gain node
      if (options?.volume !== undefined) {
        const gain = this.ctx.createGain();
        gain.gain.value = options.volume;
        source.connect(gain);
        gain.connect(this.sfxGain);
      } else {
        source.connect(this.sfxGain);
      }

      source.start(0);

      if (source.loop) {
        // Stop any previous loop with the same id
        this.stopSound(id);
        this.loopingSources.set(id, source);
        source.onended = () => {
          if (this.loopingSources.get(id) === source) {
            this.loopingSources.delete(id);
          }
        };
      }

      return source;
    } catch (e) {
      console.warn(`[AudioManager] Error playing sound "${id}":`, e);
      return null;
    }
  }

  stopSound(id: string): void {
    const source = this.loopingSources.get(id);
    if (source) {
      try {
        source.stop();
      } catch {
        // Already stopped
      }
      this.loopingSources.delete(id);
    }
  }

  // --- Background music (streamed via HTMLAudioElement) ---

  playMusic(url: string, volume?: number): void {
    this.stopMusic();

    if (!this.ctx || !this.musicGain) {
      console.warn("[AudioManager] No AudioContext – cannot play music");
      return;
    }

    try {
      const audio = new Audio(url);
      audio.crossOrigin = "anonymous";
      audio.loop = true;
      audio.volume = 1; // volume controlled through gain nodes

      this.musicElement = audio;
      this.musicSource = this.ctx.createMediaElementSource(audio);
      this.musicSource.connect(this.musicGain);

      if (volume !== undefined) {
        this.musicGain.gain.value = volume * this.musicVolume;
      }

      audio.play().catch((e) => {
        console.warn("[AudioManager] Music playback blocked:", e);
      });
    } catch (e) {
      console.warn("[AudioManager] Error starting music:", e);
    }
  }

  stopMusic(): void {
    if (this.musicElement) {
      this.musicElement.pause();
      this.musicElement.src = "";
      this.musicElement.load(); // release network resources
      this.musicElement = null;
    }
    if (this.musicSource) {
      try {
        this.musicSource.disconnect();
      } catch {
        // Already disconnected
      }
      this.musicSource = null;
    }
  }

  // --- Volume controls ---

  setMasterVolume(vol: number): void {
    this.masterVolume = clamp01(vol);
    this.applyVolumes();
  }

  setSfxVolume(vol: number): void {
    this.sfxVolume = clamp01(vol);
    this.applyVolumes();
  }

  setMusicVolume(vol: number): void {
    this.musicVolume = clamp01(vol);
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (this.masterGain) this.masterGain.gain.value = this.masterVolume;
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxVolume;
    if (this.musicGain) this.musicGain.gain.value = this.musicVolume;
  }

  // --- Mute ---

  isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): void {
    if (this.muted) {
      this.muted = false;
      this.masterVolume = this.previousMasterVolume;
    } else {
      this.muted = true;
      this.previousMasterVolume = this.masterVolume;
      this.masterVolume = 0;
    }
    this.applyVolumes();
  }

  // --- Cleanup ---

  destroy(): void {
    this.stopMusic();

    for (const [id] of this.loopingSources) {
      this.stopSound(id);
    }
    this.loopingSources.clear();
    this.buffers.clear();

    this.removeUnlockListeners();

    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }

    this.masterGain = null;
    this.sfxGain = null;
    this.musicGain = null;
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// Singleton instance
const audioManager = new AudioManager();
export default audioManager;
