/**
 * Attract scene: the hero running on the track behind the menu.
 *
 * This is the same renderer path the gameplay scene will use (perspective ground,
 * sprite-sheet hero, coin sprites), so the art, the animator and the HUD can be
 * validated long before the spawner exists. It also gives the menu life.
 */
import { color } from "../render/Theme";
import type { Stage } from "../render/Stage";
import { DEFAULT_TRACK, laneX, project, type TrackView } from "../render/Perspective";
import { SpriteAnimator, frameRect, type SheetManifest } from "../render/SpriteAnimator";

export interface CoinStrip {
  image: HTMLImageElement;
  cell: number;
  frames: number;
  fps: number;
}

export interface AttractDeps {
  stage: Stage;
  hero: { image: HTMLImageElement; manifest: SheetManifest };
  coin?: CoinStrip;
  logo?: HTMLImageElement;
  onCoin?: () => void;
}

interface DriftingCoin {
  lane: number;
  meters: number;
  taken: boolean;
}

export class AttractScene {
  readonly view: TrackView = DEFAULT_TRACK;
  private animator: SpriteAnimator;
  private scroll = 0;
  private time = 0;
  private speed = 9;
  private nextTrickAt = 3.2;
  private coins: DriftingCoin[] = [];
  private frame = 0;
  private pinned: string | null = null;

  constructor(private readonly deps: AttractDeps) {
    this.animator = new SpriteAnimator(deps.hero.manifest, "run");
    for (let i = 0; i < 7; i++) {
      this.coins.push({ lane: (i % 3) as number, meters: 6 + i * 4.5, taken: false });
    }
  }

  get heroState(): string {
    return this.animator.state;
  }

  /** Pose-lab hook: pin the hero to one animation instead of the attract cycle. */
  setPose(name: string | null): void {
    this.pinned = name;
    if (name) this.animator.play(name, { restart: true });
    else this.animator.play("run", { restart: true });
  }

  get poseName(): string {
    return this.animator.state;
  }

  debugInfo(): { state: string; frame: number; index: number; finished: boolean; progress: number } {
    const spec = this.animator.stateSpec();
    const index = this.animator.frameIndex();
    return {
      state: this.animator.state,
      frame: index - spec.from,
      index,
      finished: this.animator.finished,
      progress: this.animator.progress(),
    };
  }

  forceJump(): void {
    if (this.animator.state !== "run") return;
    this.animator.play("jump");
  }

  update(dt: number): void {
    this.time += dt;
    this.scroll += this.speed * dt;
    this.animator.speed = 0.72 + this.speed / 34;
    this.animator.advance(dt);

    // Show off the jump animation on a timer, the way an attract loop should.
    if (this.pinned) {
      if (this.animator.finished && this.pinned !== this.animator.state) {
        this.animator.play(this.pinned, { restart: true });
      }
      return;
    }
    if (this.time > this.nextTrickAt && this.animator.state === "run") {
      this.animator.play("jump");
      this.nextTrickAt = this.time + 4.6;
    }
    if (this.animator.state === "jump" && this.animator.finished) this.animator.play("run");

    for (const coin of this.coins) {
      coin.meters -= this.speed * dt;
      if (coin.meters < 0.6 && !coin.taken) {
        coin.taken = true;
        this.deps.onCoin?.();
      }
      if (coin.meters < -1.5) {
        coin.meters = 26 + Math.random() * 8;
        coin.lane = Math.floor(Math.random() * 3);
        coin.taken = false;
      }
    }
    this.frame++;
  }

  render(): void {
    const { stage } = this.deps;
    const ctx = stage.ctx;
    const view = this.view;

    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, view.height);
    sky.addColorStop(0, color("navyDeep"));
    sky.addColorStop(0.42, color("skyDeep"));
    sky.addColorStop(1, color("cyan"));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, view.width, view.height);

    // sun disc + city silhouette bands for depth
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.beginPath();
    ctx.arc(view.width * 0.5, view.horizonY - 34, 68, 0, Math.PI * 2);
    ctx.fill();
    for (let band = 0; band < 3; band++) {
      ctx.fillStyle = `rgba(9,28,64,${0.34 - band * 0.09})`; // skyline bands, darkest nearest the horizon
      const h = 42 - band * 10;
      const y = view.horizonY - h + band * 6;
      for (let i = 0; i < 12; i++) {
        const w = 26 + ((i * 7 + band * 13) % 30);
        const x = ((i * 53 + band * 29 + this.scroll * (0.4 + band * 0.35)) % (view.width + 120)) - 60;
        ctx.fillRect(x, y - ((i * 37 + band * 11) % 26), w, h + ((i * 13) % 22));
      }
    }

    // ground: track trapezoid + scrolling lane separators
    const near = project(0, view);
    const far = project(1, view);
    ctx.fillStyle = "#20304c";
    ctx.beginPath();
    ctx.moveTo(view.width / 2 - near.half, view.groundY);
    ctx.lineTo(view.width / 2 + near.half, view.groundY);
    ctx.lineTo(view.width / 2 + far.half, far.y);
    ctx.lineTo(view.width / 2 - far.half, far.y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    for (let i = 0; i <= view.laneCount; i++) {
      const lanePos = i - 0.5;
      ctx.lineWidth = i === 0 || i === view.laneCount ? 2 : 1.2;
      ctx.beginPath();
      const a = laneX(0, 0, view) + (lanePos - 0) * near.laneStep;
      const b = laneX(0, 1, view) + (lanePos - 0) * far.laneStep;
      ctx.moveTo(a, view.groundY);
      ctx.lineTo(b, far.y);
      ctx.stroke();
    }

    // scrolling dashes give the illusion of speed
    ctx.strokeStyle = "rgba(255,255,255,0.72)";
    for (let i = 0; i < 16; i++) {
      const depth = (((i * 0.0625 + (this.scroll % 4) * 0.04) % 1) + 1) % 1;
      const p = project(depth, view);
      const w = Math.max(1.5, p.laneStep * 0.16);
      ctx.lineWidth = w;
      const len = Math.max(3, 26 * p.scale);
      ctx.globalAlpha = 0.16 + 0.5 * (1 - depth);
      for (let lane = 0; lane < view.laneCount; lane++) {
        const x = laneX(lane, depth, view);
        ctx.beginPath();
        ctx.moveTo(x, p.y);
        ctx.lineTo(x, p.y - len * 0.5);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // coins
    const coin = this.deps.coin;
    if (coin) {
      for (const c of this.coins) {
        if (c.taken || c.meters < 0 || c.meters > 26) continue;
        const depth = Math.min(1, c.meters / 26);
        const p = project(depth, view);
        const size = Math.max(6, 46 * p.scale);
        const idx = Math.floor(this.time * coin.fps + c.meters) % coin.frames;
        const src = frameRect(idx, { cell: coin.cell, columns: coin.frames });
        stage.drawSpriteCell(
          coin.image,
          { sx: src.sx, sy: src.sy, sw: src.sw, sh: src.sh },
          { x: 0.5, y: 0.5 },
          laneX(c.lane, depth, view),
          p.y - 40 * p.scale,
          size,
        );
      }
    }

    // hero
    const hero = this.deps.hero;
    const rect = this.animator.rect();
    const anchor = this.animator.anchor();
    const height = 168;
    // Height follows a parabola over the jump animation, so the sprite and the
    // shadow always agree even if the frame rate wobbles.
    const hop =
      this.animator.state === "jump" ? 4 * this.animator.progress() * (1 - this.animator.progress()) : 0;
    stage.drawShadow(
      view.width / 2,
      view.groundY + 6,
      height * (0.26 - hop * 0.07),
      height * (0.055 - hop * 0.015),
      0.3 - hop * 0.12,
    );
    stage.drawSpriteCell(hero.image, rect, anchor, view.width / 2, view.groundY - hop * 46, height);

    // speed streaks when the demo is "fast"
    if (this.speed > 10) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const y = 320 + ((i * 71 + this.frame * 9) % 340);
        const x = ((i * 137 + this.frame * 22) % (view.width + 200)) - 100;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 60, y);
        ctx.stroke();
      }
    }
  }

  dispose(): void {
    this.coins = [];
  }
}
