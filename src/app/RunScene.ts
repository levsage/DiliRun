/**
 * The run, painted.
 *
 * `RunScene` is a *view*: it calls `world.step()` once per simulation tick and then draws what
 * the world says. It never decides anything — no collision, no scoring, no spawn logic — which
 * is what lets the whole game be tested without a canvas (see `tests/unit/RunWorld.test.ts`) and
 * keeps the renderer free to change.
 *
 * Draw order is far-to-near so hazards occlude each other correctly; the hero is always last.
 */
import { HERO_CONFIG } from "../game/entities/Hero";
import type { Coin, Obstacle } from "../game/entities/Spawner";
import type { RunView, RunWorld } from "../game/systems/RunWorld";
import type { Stage } from "../render/Stage";
import { DEFAULT_TRACK, depthFor, laneX, project, type TrackView } from "../render/Perspective";
import { SpriteAnimator, frameRect, type SheetManifest } from "../render/SpriteAnimator";
import { color } from "../render/Theme";
import type { CoinStrip } from "./AttractScene";

export interface RunSceneDeps {
  stage: Stage;
  world: RunWorld;
  hero: { image: HTMLImageElement; manifest: SheetManifest };
  coin?: CoinStrip;
  view?: TrackView;
  /** Drawn on the horizon band; the brand line from data/strings.json. */
  caption?: string;
}

const HERO_PX = 168;
const PPM = HERO_PX / HERO_CONFIG.heroHeightMeters; // logical px per metre at the near plane

export class RunScene {
  readonly view: TrackView;
  private readonly animator: SpriteAnimator;
  private readonly world: RunWorld;
  private scroll = 0;
  private celebration = false;
  /** Reused every frame: depth sorting without allocating, because this runs 60x/second. */
  private readonly zbuf: ZItem[] = [];
  private last: RunView;

  constructor(private readonly deps: RunSceneDeps) {
    this.view = deps.view ?? DEFAULT_TRACK;
    this.world = deps.world;
    this.last = deps.world.view();
    this.animator = new SpriteAnimator(deps.hero.manifest, "run");
  }

  /** Set when the finished run beat the record: the hero celebrates instead of stumbling. */
  setCelebration(on: boolean): void {
    this.celebration = on;
  }

  get heroState(): string {
    return this.animator.state;
  }

  debugInfo(): RunView & { sprite: { state: string; frame: number } } {
    return {
      ...this.last,
      sprite: { state: this.animator.state, frame: this.animator.frameIndex() },
    };
  }

  update(dt: number): void {
    this.world.step(dt);
    const view = (this.last = this.world.view());
    this.scroll += view.speed * dt;

    const wanted =
      view.phase === "over"
        ? this.celebration
          ? "victory"
          : "stumble"
        : view.phase === "ready"
          ? "idle"
          : this.world.hero.spriteState;
    if (wanted !== this.animator.state) {
      // One-shots (land, stumble, slide) must be allowed to finish; run/dash loop forever.
      this.animator.play(wanted);
    }
    // The run cycle is tied to velocity so the feet match the road at every speed.
    this.animator.speed = wanted === "run" || wanted === "dash" ? 0.55 + view.speed / 22 : 1;
    this.animator.advance(dt);
  }

  render(): void {
    const { stage } = this.deps;
    const ctx = stage.ctx;
    const view = this.last;
    const track = this.view;

    ctx.save();
    if (view.shake > 0.1) {
      const a = view.shake;
      ctx.translate((Math.random() - 0.5) * a, (Math.random() - 0.5) * a * 0.6);
    }

    this.paintSky(ctx, track, view);
    this.paintTrack(ctx, track, view);

    // Far to near, so a gantry correctly hides the crates under it.
    const z = this.zbuf;
    z.length = 0;
    for (const obstacle of this.world.obstacles) {
      if (obstacle.meters < -2 || obstacle.meters > this.world.viewLength) continue;
      z.push({ meters: obstacle.meters, obstacle });
    }
    for (const coin of this.world.coins) {
      if (coin.taken || coin.meters < -1 || coin.meters > this.world.viewLength) continue;
      z.push({ meters: coin.meters, coin });
    }
    z.sort((a, b) => b.meters - a.meters);
    for (const item of z) {
      if (item.obstacle) this.paintObstacle(ctx, track, item.obstacle, view);
      else if (item.coin) this.paintCoin(ctx, track, item.coin, view);
    }

    this.paintHero(ctx, stage, track, view);
    if (view.speed > 14) this.paintStreaks(ctx, track, view);
    ctx.restore();

    if (view.hitStop > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.45, view.hitStop * 2.2);
      ctx.fillStyle = color("danger");
      ctx.fillRect(0, 0, track.width, track.height);
      ctx.restore();
    }
    if (view.phase === "ready") {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = color("navyDeep");
      ctx.fillRect(0, 0, track.width, track.height);
      ctx.restore();
    }
  }

  private paintSky(ctx: CanvasRenderingContext2D, track: TrackView, view: RunView): void {
    const sky = ctx.createLinearGradient(0, 0, 0, track.height);
    sky.addColorStop(0, color("navyDeep"));
    sky.addColorStop(0.36, color("skyDeep"));
    sky.addColorStop(0.62, color("sky"));
    sky.addColorStop(1, color("cyan"));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, track.width, track.height);

    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.beginPath();
    ctx.arc(track.width * 0.5, track.horizonY - 40, 74, 0, Math.PI * 2);
    ctx.fill();

    // Dliicom City: three parallax bands, the near one moving with the run.
    const speed = Math.min(view.speed, 21);
    for (let band = 0; band < 3; band++) {
      ctx.fillStyle = `rgba(9,28,64,${0.4 - band * 0.11})`;
      const h = 46 - band * 12;
      const base = track.horizonY - h + band * 7;
      const shift = this.scroll * (0.35 + band * 0.5) * (0.6 + speed * 0.02);
      for (let i = 0; i < 13; i++) {
        const w = 24 + ((i * 7 + band * 13) % 34);
        const x = ((i * 57 + shift) % (track.width + 140)) - 70;
        ctx.fillRect(x, base - ((i * 37 + band * 11) % 30), w, h + ((i * 13) % 26));
      }
    }

    if (this.deps.caption) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "600 13px var(--dili-font-ui, system-ui)";
      ctx.textAlign = "center";
      ctx.fillText(this.deps.caption.toUpperCase(), track.width / 2, track.horizonY - 62);
    }
  }

  private paintTrack(ctx: CanvasRenderingContext2D, track: TrackView, _view: RunView): void {
    const near = project(0, track);
    const far = project(1, track);
    ctx.fillStyle = color("track");
    ctx.beginPath();
    ctx.moveTo(track.width / 2 - near.half, track.groundY + 4);
    ctx.lineTo(track.width / 2 + near.half, track.groundY + 4);
    ctx.lineTo(track.width / 2 + far.half, far.y);
    ctx.lineTo(track.width / 2 - far.half, far.y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    for (let i = 0; i <= track.laneCount; i++) {
      const offset = i - track.laneCount / 2;
      ctx.lineWidth = i === 0 || i === track.laneCount ? 2.4 : 1.2;
      ctx.beginPath();
      ctx.moveTo(track.width / 2 + offset * near.laneStep, track.groundY + 4);
      ctx.lineTo(track.width / 2 + offset * far.laneStep, far.y);
      ctx.stroke();
    }

    // Sleepers: the scrolling dashes are what sells the speed.
    const spacing = 3.4;
    const offset = (this.scroll % spacing) / spacing;
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    for (let i = 0; i < 18; i++) {
      const depth = depthFor(i * spacing - offset * spacing, this.world.viewLength);
      if (depth >= 1) continue;
      const p = project(depth, track);
      ctx.lineWidth = Math.max(1, 5 * p.scale);
      ctx.globalAlpha = 0.1 + 0.4 * (1 - depth);
      ctx.beginPath();
      ctx.moveTo(track.width / 2 - p.half, p.y);
      ctx.lineTo(track.width / 2 + p.half, p.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private paintObstacle(ctx: CanvasRenderingContext2D, track: TrackView, o: Obstacle, _view: RunView): void {
    const length = o.kind.lengthMeters;
    const spanNear = depthFor(o.meters, this.world.viewLength);
    const spanFar = depthFor(o.meters + length, this.world.viewLength);
    const pN = project(spanNear, track);
    const pF = project(spanFar, track);
    const clearance = o.kind.vertical === "overhead" ? o.kind.heightMeters : 0;
    const top = clearance + o.kind.bodyMeters;
    const halfNear = pN.laneStep / 2;
    const halfFar = pF.laneStep / 2;
    const cxN = laneX(o.lane, spanNear, track);
    const cxF = laneX(o.lane, spanFar, track);

    const yN0 = pN.y - clearance * PPM * pN.scale;
    const yN1 = pN.y - top * PPM * pN.scale;
    const yF0 = pF.y - clearance * PPM * pF.scale;
    const yF1 = pF.y - top * PPM * pF.scale;

    // top / far face first so the near face sits on it
    ctx.fillStyle = color(o.kind.top);
    ctx.beginPath();
    ctx.moveTo(cxN - halfNear, yN1);
    ctx.lineTo(cxN + halfNear, yN1);
    ctx.lineTo(cxF + halfFar, yF1);
    ctx.lineTo(cxF - halfFar, yF1);
    ctx.closePath();
    ctx.fill();

    if (o.kind.vertical === "overhead") {
      // The underside is the readable face of a beam: you are about to slide under it.
      ctx.fillStyle = "rgba(6,16,40,0.5)";
      ctx.beginPath();
      ctx.moveTo(cxN - halfNear, yN0);
      ctx.lineTo(cxN + halfNear, yN0);
      ctx.lineTo(cxF + halfFar, yF0);
      ctx.lineTo(cxF - halfFar, yF0);
      ctx.closePath();
      ctx.fill();
    }

    const alpha = o.hit ? 0.6 : 1;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color(o.kind.front);
    ctx.strokeStyle = "rgba(11,22,44,0.85)";
    ctx.lineWidth = Math.max(1, 2.2 * pN.scale);
    ctx.beginPath();
    ctx.moveTo(cxN - halfNear, yN0);
    ctx.lineTo(cxN + halfNear, yN0);
    ctx.lineTo(cxN + halfNear, yN1);
    ctx.lineTo(cxN - halfNear, yN1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (o.hit) {
      ctx.fillStyle = color("danger");
      ctx.fillRect(cxN - halfNear, yN1, halfNear * 2, Math.max(3, 6 * pN.scale));
    }
    ctx.globalAlpha = 1;
  }

  private paintCoin(ctx: CanvasRenderingContext2D, track: TrackView, coin: Coin, _view: RunView): void {
    const strip = this.deps.coin;
    const depth = depthFor(Math.max(0, coin.meters), this.world.viewLength);
    const p = project(depth, track);
    const size = Math.max(6, 44 * p.scale);
    const cx = laneX(coin.lane, depth, track);
    const cy = p.y - (coin.height + 0.25) * PPM * p.scale;
    if (!strip) {
      ctx.fillStyle = color("gold");
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const frames = strip.frames;
    const index = (Math.floor(this.scroll * 2.4) + Math.floor(coin.meters)) % frames;
    const src = frameRect((index + frames) % frames, { cell: strip.cell, columns: frames });
    this.deps.stage.drawSpriteCell(
      strip.image,
      { sx: src.sx, sy: src.sy, sw: src.sw, sh: src.sh },
      { x: 0.5, y: 0.5 },
      cx,
      cy,
      size,
    );
  }

  private paintHero(ctx: CanvasRenderingContext2D, stage: Stage, track: TrackView, view: RunView): void {
    const rect = this.animator.rect();
    const anchor = this.animator.anchor();
    const hopPx = view.hero.hop * HERO_CONFIG.jumpPeakMeters * PPM;
    const x =
      track.width / 2 + (view.hero.laneEased - (track.laneCount - 1) / 2) * project(0, track).laneStep;
    const y = track.groundY - hopPx;
    stage.drawShadow(
      x,
      track.groundY + 6,
      HERO_PX * (0.26 - Math.min(0.12, hopPx / 900)),
      HERO_PX * (0.055 - Math.min(0.03, hopPx / 2600)),
      Math.max(0.08, 0.3 - hopPx / 380),
    );
    // Height is constant: the crouch is a different animation on the sheet, not a squash.
    ctx.save();
    if (view.invulnerable > 0) ctx.globalAlpha = 0.55 + 0.45 * Math.sin(view.invulnerable * 26);
    stage.drawSpriteCell(this.deps.hero.image, rect, anchor, x, y, HERO_PX);
    ctx.restore();
  }

  private paintStreaks(ctx: CanvasRenderingContext2D, track: TrackView, view: RunView): void {
    const intensity = (Math.min(view.speed, 21) - 14) / 7;
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${0.14 + intensity * 0.3})`;
    ctx.lineWidth = 2;
    const count = Math.round(4 + intensity * 9);
    for (let i = 0; i < count; i++) {
      const t = (i * 0.618 + this.scroll * 0.05) % 1;
      const side = i % 2 === 0 ? -1 : 1;
      const x = track.width / 2 + side * (track.width * 0.42 - t * 70);
      const y = track.horizonY + t * (track.height - track.horizonY);
      const len = 40 + t * 90;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + len);
      ctx.stroke();
    }
    ctx.restore();
  }

  dispose(): void {
    // The world outlives the scene (the shell owns it), so nothing to free but the listeners
    // this class would otherwise add. Kept explicit so a future audio hook has a home.
  }
}

interface ZItem {
  meters: number;
  obstacle?: Obstacle;
  coin?: Coin;
}
