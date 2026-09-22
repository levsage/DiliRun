/**
 * Fixed-timestep game loop with a variable-rate render step.
 *
 * Simulation runs at a constant 1/60 s so physics and collision stay identical on
 * a 60 Hz laptop and a 144 Hz phone; rendering happens once per animation frame
 * with an interpolation alpha for smooth sprites. `advance()` is public so tests
 * can drive the loop without a browser.
 */
export interface LoopHooks {
  update(dt: number): void;
  render(alpha: number): void;
}

export interface LoopOptions {
  /** Simulation step in seconds. */
  step?: number;
  /** Clamp on catch-up steps, so an unfocused tab cannot stall the main thread. */
  maxSubSteps?: number;
  /** Longest delta we trust, in seconds (bigger = tab was hidden). */
  maxDelta?: number;
}

export class Loop {
  readonly step: number;
  private readonly maxSubSteps: number;
  private readonly maxDelta: number;
  private accumulator = 0;
  private last = 0;
  private raf = 0;
  private frames = 0;
  private fpsWindowStart = 0;
  private _fps = 0;
  private _running = false;
  private _time = 0;
  private _ticks = 0;
  timescale = 1;
  paused = false;

  constructor(
    private readonly hooks: LoopHooks,
    options: LoopOptions = {},
  ) {
    this.step = options.step ?? 1 / 60;
    this.maxSubSteps = options.maxSubSteps ?? 5;
    this.maxDelta = options.maxDelta ?? 0.25;
  }

  get running(): boolean {
    return this._running;
  }

  get fps(): number {
    return this._fps;
  }

  /** Simulated seconds since start (excludes wall-clock dead time while paused). */
  get time(): number {
    return this._time;
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    this.last = this.now();
    this.fpsWindowStart = this.last;
    const frame = (): void => {
      if (!this._running) return;
      this.raf = requestAnimationFrame(frame);
      this.tick(this.now());
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this._running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  /** One animation frame worth of work. Exposed for tests and manual stepping. */
  tick(nowMs: number): void {
    const rawDelta = Math.max(0, (nowMs - this.last) / 1000);
    this.last = nowMs;
    this.frames++;
    if (nowMs - this.fpsWindowStart >= 500) {
      this._fps = (this.frames * 1000) / (nowMs - this.fpsWindowStart);
      this.frames = 0;
      this.fpsWindowStart = nowMs;
    }
    if (this.paused) return;
    const delta = Math.min(rawDelta, this.maxDelta) * this.timescale;
    this.accumulator += delta;
    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxSubSteps) {
      this.hooks.update(this.step);
      this.accumulator -= this.step;
      this._time += this.step;
      this._ticks++;
      steps++;
    }
    // If we hit the sub-step cap, drop the backlog instead of exploding later.
    if (steps >= this.maxSubSteps) this.accumulator = Math.min(this.accumulator, this.step);
    this.hooks.render(this.accumulator / this.step);
  }

  /** Number of simulation updates performed so far. */
  get ticks(): number {
    return this._ticks;
  }
}
