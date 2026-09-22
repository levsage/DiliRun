/**
 * Sprite-sheet playback for the baked hero animation.
 *
 * The asset pipeline emits `dilirun-hero-sheet.json` describing where each state
 * lives in the sheet (frame index, fps, loop, hold frame). This module turns that
 * into a current frame per entity, with speed scaling for a run cycle and support
 * for the "hold" frame the game parks on while an action is still in progress
 * (airborne, sliding).
 */
export interface SheetState {
  from: number;
  count: number;
  fps: number;
  loop: boolean;
  /** Frame index to freeze on when the state must be held. */
  hold?: number;
}

export interface SheetManifest {
  format: string;
  /** file name inside `sprites/`, kept for tooling */
  image: string;
  /** path relative to the assets root, what the game loads */
  imagePath: string;
  fallbackImage?: string;
  fallbackImagePath?: string;
  cell: number;
  columns: number;
  rows: number;
  frameCount: number;
  anchor: { x: number; y: number };
  states: Record<string, SheetState>;
  aliases: Record<string, { state: string; frame: number }>;
}

export interface FrameRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Pure geometry: index -> source rectangle inside the sheet. */
export function frameRect(index: number, manifest: Pick<SheetManifest, "cell" | "columns">): FrameRect {
  const cell = manifest.cell;
  const col = index % manifest.columns;
  const row = Math.floor(index / manifest.columns);
  return { sx: col * cell, sy: row * cell, sw: cell, sh: cell };
}

export function resolveState(
  manifest: SheetManifest,
  name: string,
): { state: string; startFrame: number } | null {
  if (manifest.states[name]) return { state: name, startFrame: 0 };
  const alias = manifest.aliases[name];
  if (alias && manifest.states[alias.state]) return { state: alias.state, startFrame: alias.frame };
  return null;
}

export class SpriteAnimator {
  private elapsed = 0;
  private current: string;
  private done = false;
  private _speed = 1;

  constructor(
    private readonly manifest: SheetManifest,
    start: string,
    private readonly onFinished?: (state: string) => void,
  ) {
    this.current = this.seekTo(start);
  }

  private resolve(name: string): string {
    const found = resolveState(this.manifest, name);
    if (!found) throw new Error(`unknown animation state "${name}"`);
    return found.state;
  }

  /** Jump to a state (or an alias) and fast-forward to the aliased frame. */
  private seekTo(name: string): string {
    const found = resolveState(this.manifest, name);
    if (!found) throw new Error(`unknown animation state "${name}"`);
    const fps = Math.max(1e-4, this.manifest.states[found.state]?.fps ?? 12);
    this.elapsed = found.startFrame / fps;
    this.done = false;
    return found.state;
  }

  get state(): string {
    return this.current;
  }

  /** 1 = authored fps. Below 1 slows the cycle (used for speed-scaled runs). */
  get speed(): number {
    return this._speed;
  }

  set speed(v: number) {
    this._speed = Math.max(0.05, v);
  }

  get finished(): boolean {
    return this.done;
  }

  play(name: string, options: { restart?: boolean } = {}): void {
    const next = this.seekTo(name);
    if (next !== this.current || options.restart) {
      this.current = next;
      this.elapsed = 0;
      this.done = false;
    }
  }

  stateSpec(name = this.current): SheetState {
    const spec = this.manifest.states[name];
    if (!spec) throw new Error(`unknown animation state "${name}"`);
    return spec;
  }

  /** Absolute frame index into the sheet for the current animation time. */
  frameIndex(): number {
    const spec = this.stateSpec();
    if (this.done && spec.hold !== undefined) return spec.from + Math.min(spec.count - 1, spec.hold);
    if (spec.count <= 1) return spec.from;
    const dur = 1 / Math.max(1e-4, spec.fps * this._speed);
    const raw = Math.floor(this.elapsed / dur);
    if (spec.loop) return spec.from + (((raw % spec.count) + spec.count) % spec.count);
    if (raw >= spec.count) return spec.from + Math.min(spec.count - 1, spec.hold ?? spec.count - 1);
    return spec.from + raw;
  }

  rect(): FrameRect {
    return frameRect(this.frameIndex(), this.manifest);
  }

  advance(dt: number): void {
    if (this.done) return;
    this.elapsed += Math.max(0, dt);
    const spec = this.stateSpec();
    const dur = 1 / Math.max(1e-4, spec.fps * this._speed);
    if (!spec.loop && this.elapsed >= spec.count * dur) {
      this.done = true;
      this.onFinished?.(this.current);
    }
  }

  /** 0..1 through the current playback (clamped for one-shot states). */
  progress(): number {
    const spec = this.stateSpec();
    const dur = spec.count / Math.max(1e-4, spec.fps * this._speed);
    return dur > 0 ? Math.max(0, Math.min(1, this.elapsed / dur)) : 0;
  }

  /** Ground contact point as a fraction of the cell (from the manifest). */
  anchor(): { x: number; y: number } {
    return this.manifest.anchor;
  }

  reset(): void {
    this.elapsed = 0;
    this.done = false;
  }
}
