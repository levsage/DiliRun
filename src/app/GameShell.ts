/**
 * Game shell: owns the canvas, the loop, the HUD and whichever scene is active.
 *
 * Today the only scene is the attract loop; the gameplay scene will be registered
 * here as `scene = new RunScene(...)`. Keeping asset loading, sizing, HUD wiring and
 * records in one place means the scene code stays about running.
 */
import { Loop } from "../core/Loop";
import { Store } from "../core/Storage";
import { InputController } from "../core/Input";
import { Emitter } from "../core/Emitter";
import { Leaderboard } from "../game/records";
import { RunAccumulator } from "../game/scoring";
import { Stage } from "../render/Stage";
import { applyThemeCss, color } from "../render/Theme";
import type { AssetLoader, AssetIndex } from "../core/Assets";
import type { SheetManifest } from "../render/SpriteAnimator";
import { AttractScene, type CoinStrip } from "./AttractScene";
import { CoinBar } from "../ui/hud/CoinBar";
import { ScoreBoard } from "../ui/hud/ScoreBoard";
import { LeaderboardPanel, toRows } from "../ui/hud/LeaderboardPanel";

export interface ShellElements {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  hud: HTMLElement;
}

export interface ShellEvents extends Record<string, unknown> {
  "run:coin": { coins: number };
  "run:frame": { fps: number };
  ready: void;
}

export class GameShell {
  readonly events = new Emitter<ShellEvents>();
  readonly store: Store;
  readonly leaderboard: Leaderboard;
  readonly run = new RunAccumulator();
  private stage!: Stage;
  private loop!: Loop;
  /** Active scene. Public so the pose lab and (later) e2e tests can inspect it. */
  scene!: AttractScene;
  private coinBar!: CoinBar;
  private board!: ScoreBoard;
  private panel!: LeaderboardPanel;
  readonly input = new InputController();
  private resized = (): void => this.onResize();
  private visibility = (): void => this.onVisibility();

  constructor(
    private readonly els: ShellElements,
    private readonly assets: AssetLoader,
    private readonly index: AssetIndex,
    private readonly hero: { image: HTMLImageElement; manifest: SheetManifest },
    private readonly coin: CoinStrip | undefined,
  ) {
    applyThemeCss();
    this.store = new Store({ prefix: "dilirun", version: 1 });
    this.leaderboard = new Leaderboard(this.store);
  }

  mount(): void {
    const { root, canvas, hud } = this.els;
    root.dataset.dilirun = "1";
    root.style.setProperty("--dili-coin-sheet", `url("${this.assets.url("assets/sprites/coin-sheet.png")}")`);
    this.stage = new Stage(canvas, { width: 480, height: 800, maxDpr: 2.5 });
    this.coinBar = new CoinBar().mount(hud);
    this.board = new ScoreBoard().mount(hud);
    this.panel = new LeaderboardPanel({ title: "Leaderboard" }).mount(hud);
    this.scene = new AttractScene({
      stage: this.stage,
      hero: this.hero,
      coin: this.coin,
      onCoin: () => {
        this.run.addCoin(1);
        this.events.emit("run:coin", { coins: this.run.coins });
      },
    });
    this.loop = new Loop(
      {
        update: (dt) => this.update(dt),
        render: () => this.render(),
      },
      { step: 1 / 60, maxSubSteps: 5 },
    );
    this.loop.start();
    window.addEventListener("resize", this.resized);
    window.addEventListener("orientationchange", this.resized);
    document.addEventListener("visibilitychange", this.visibility);
    this.input.attach(window);
    this.input.onChange = (action) => this.onAction(action);
    this.refreshLeaderboard(null);
    this.events.emit("ready", undefined);
  }

  private onAction(action: string): void {
    if (action === "pause") {
      this.loop.paused = !this.loop.paused;
      this.els.root.classList.toggle("is-paused", this.loop.paused);
      return;
    }
    // Attract mode only: let people poke the hero with the keyboard.
    if (action === "jump" && this.scene.heroState === "run") this.scene.forceJump();
  }

  private update(dt: number): void {
    this.scene.update(dt);
    this.input.prune();
    const snapshot = this.run.snapshot();
    this.board.update({
      score: snapshot.score,
      meters: snapshot.meters,
      multiplier: snapshot.multiplier,
      best: this.leaderboard.best()?.score ?? 0,
      combo: snapshot.bestCombo,
    });
    this.coinBar.update({ runCoins: snapshot.coins, bank: this.leaderboard.coinsBank() });
  }

  private render(): void {
    this.stage.begin(color("navyDeep"));
    this.scene.render();
  }

  /** Exposed for the dev pose lab. */
  get hudRoot(): HTMLElement {
    return this.els.hud;
  }

  refreshLeaderboard(highlightId: string | null): void {
    this.panel.render(toRows(this.leaderboard.top(), highlightId));
  }

  private onResize(): void {
    this.stage.resize();
  }

  private onVisibility(): void {
    if (document.hidden) this.loop.paused = true;
    else this.loop.paused = false;
  }

  dispose(): void {
    this.loop?.stop();
    window.removeEventListener("resize", this.resized);
    window.removeEventListener("orientationchange", this.resized);
    document.removeEventListener("visibilitychange", this.visibility);
    this.input.detach();
    this.scene?.dispose();
    this.events.clear();
  }
}
