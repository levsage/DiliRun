/**
 * Canvas plumbing: sizing for device pixel ratio and the handful of draw calls the
 * 2.5D track needs. Everything is drawn in *logical* pixels; the DPR scale lives
 * here only, so gameplay code never multiplies by pixel ratio.
 */
export interface StageOptions {
  /** Logical design size; the canvas is letterboxed to fit the viewport. */
  width: number;
  height: number;
  maxDpr?: number;
  letterbox?: "contain" | "cover";
}

export interface DestRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Stage {
  readonly ctx: CanvasRenderingContext2D;
  dpr = 1;
  scale = 1;
  offsetX = 0;
  offsetY = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly options: StageOptions,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2d canvas context unavailable");
    this.ctx = ctx;
    this.resize();
  }

  resize(
    viewport: { width: number; height: number } = { width: window.innerWidth, height: window.innerHeight },
  ): void {
    const maxDpr = this.options.maxDpr ?? 2.5;
    this.dpr = Math.min(maxDpr, Math.max(1, window.devicePixelRatio || 1));
    const fit = this.options.letterbox === "cover" ? Math.max : Math.min;
    this.scale = fit(viewport.width / this.options.width, viewport.height / this.options.height);
    const w = Math.max(1, Math.round(viewport.width * this.dpr));
    const h = Math.max(1, Math.round(viewport.height * this.dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.canvas.style.width = `${viewport.width}px`;
    this.canvas.style.height = `${viewport.height}px`;
    this.offsetX = (viewport.width - this.options.width * this.scale) / 2;
    this.offsetY = (viewport.height - this.options.height * this.scale) / 2;
  }

  /** Clears and applies the logical-pixel transform. Call at the start of a frame. */
  begin(background: string): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
  }

  clearLogical(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Draw one sprite-sheet cell by its ground anchor (the manifest's anchor point). */
  drawSpriteCell(
    image: CanvasImageSource & { width: number; height: number },
    src: { sx: number; sy: number; sw: number; sh: number },
    anchor: { x: number; y: number },
    feetX: number,
    feetY: number,
    height: number,
    options: { flipX?: boolean; alpha?: number; rotation?: number } = {},
  ): void {
    const { ctx } = this;
    const scale = height / src.sh;
    const w = src.sw * scale;
    const h = height;
    ctx.save();
    ctx.globalAlpha = options.alpha ?? 1;
    ctx.translate(feetX, feetY);
    if (options.rotation) ctx.rotate((options.rotation * Math.PI) / 180);
    if (options.flipX) ctx.scale(-1, 1);
    ctx.drawImage(image, src.sx, src.sy, src.sw, src.sh, -w * anchor.x, -h * anchor.y, w, h);
    ctx.restore();
  }

  drawShadow(cx: number, cy: number, rx: number, ry: number, alpha = 0.32, tint = "rgba(6,16,40,1)"): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
