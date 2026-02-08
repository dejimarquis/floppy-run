type UpdateFn = (dt: number) => void;
type RenderFn = (interp: number) => void;

const FIXED_DT = 1 / 60;
const MAX_ACCUMULATOR = FIXED_DT * 5;

export class GameLoop {
  private rafId: number | null = null;
  private running = false;
  private paused = false;
  private lastTime = 0;
  private accumulator = 0;

  start(updateFn: UpdateFn, renderFn: RenderFn): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.accumulator = 0;
    this.lastTime = 0;

    const tick = (timestamp: number): void => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);

      if (this.lastTime === 0) {
        this.lastTime = timestamp;
        return;
      }

      const delta = (timestamp - this.lastTime) / 1000;
      this.lastTime = timestamp;

      if (this.paused) return;

      this.accumulator = Math.min(this.accumulator + delta, MAX_ACCUMULATOR);

      while (this.accumulator >= FIXED_DT) {
        updateFn(FIXED_DT);
        this.accumulator -= FIXED_DT;
      }

      renderFn(this.accumulator / FIXED_DT);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isRunning(): boolean {
    return this.running;
  }
}
