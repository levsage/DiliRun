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
import { Profile } from "../game/profile";
import { RunAccumulator } from "../game/scoring";
import { Stage } from "../render/Stage";
import { applyThemeCss, color } from "../render/Theme";
import type { AssetLoader, AssetIndex } from "../core/Assets";
import type { SheetManifest } from "../render/SpriteAnimator";
import { AttractScene, type CoinStrip } from "./AttractScene";
import { RunScene } from "./RunScene";
import { CoinBar } from "../ui/hud/CoinBar";
import { ScoreBoard } from "../ui/hud/ScoreBoard";
import { LeaderboardPanel, toRows } from "../ui/hud/LeaderboardPanel";
import { Lives } from "../ui/hud/Lives";
import { RunSummary } from "../ui/hud/RunSummary";
import { HomePanel, type HomeLabels } from "../ui/hud/HomePanel";
import type { RunRecord } from "../game/records";
import { compareRuns, type RunSnapshot } from "../game/scoring";
import { formatValue, getLocale, setLocale, t } from "../game/strings";
import { RunWorld, type RunEvent } from "../game/systems/RunWorld";

export interface ShellElements {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  hud: HTMLElement;
}

export interface ShellEvents extends Record<string, unknown> {
  "run:coin": { coins: number };
  "run:frame": { fps: number };
  "run:over": { record: RunRecord | null; rank: number };
  "mode:change": { mode: ShellMode };
  ready: void;
}

/**
 * Which scene owns the canvas. `home` is the stage the run starts and ends on — the hero running in the
 * attract world with the name field and the Runner Board laid over it; `run` is a live `RunWorld`.
 * Keeping both on one shell means one loop, one HUD and one asset preload, and the home stage is already
 * the game renderer behind a card, so it costs nothing to look like part of the game.
 */
export type ShellMode = "home" | "run";

export class GameShell {
  readonly events = new Emitter<ShellEvents>();
  readonly store: Store;
  readonly leaderboard: Leaderboard;
  readonly run = new RunAccumulator();
  private stage!: Stage;
  private loop!: Loop;
  /** The menu scene. Public so the pose lab and (later) e2e tests can inspect it. */
  scene!: AttractScene;
  private runScene!: RunScene;
  private coinBar!: CoinBar;
  private board!: ScoreBoard;
  private panel!: LeaderboardPanel;
  private lives!: Lives;
  private summary!: RunSummary;
  private home!: HomePanel;
  readonly profile!: Profile;
  readonly world: RunWorld;
  mode: ShellMode = "home";
  private lastRecord: RunRecord | null = null;
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
    this.profile = new Profile(this.store);
    // The saved language is applied before any label is read, which happens in mount() — so the whole
    // HUD comes up in the player's locale instead of flickering from English.
    const saved = this.profile.locale;
    if (saved) setLocale(saved);
    this.world = new RunWorld({
      seed: (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
      take: (action) => this.input.take(action),
      onEvent: (event) => this.onWorldEvent(event),
    });
  }

  mount(): void {
    const { root, canvas, hud } = this.els;
    root.dataset.dilirun = "1";
    root.style.setProperty("--dili-coin-sheet", `url("${this.assets.url("assets/sprites/coin-sheet.png")}")`);
    this.stage = new Stage(canvas, { width: 480, height: 800, maxDpr: 2.5 });
    this.coinBar = new CoinBar({ label: t("currency.name") }).mount(hud);
    this.board = new ScoreBoard({
      score: t("hud.score"),
      distance: t("hud.distance"),
      best: t("hud.best"),
    }).mount(hud);
    this.lives = new Lives({ total: this.world.view().maxLives, label: t("hud.lives") }).mount(hud);
    this.panel = new LeaderboardPanel({
      title: t("leaderboard.title"),
      empty: t("label.empty"),
      you: t("label.you"),
      unnamed: t("label.unnamed"),
    }).mount(hud);
    this.home = new HomePanel(this.homeLabels(), {
      onPlay: () => this.startRun(),
      onName: (raw) => {
        this.profile.setName(raw);
        this.home.name = this.profile.name;
        this.refreshBoard();
      },
      onLanguage: () => this.toggleLocale(),
      onReset: () => {
        this.leaderboard.reset();
        this.refreshBoard();
      },
    }).mount(hud);
    this.summary = new RunSummary({
      onPrimary: () =>
        this.mode === "run" && this.world.phase === "over" ? this.startRun() : this.togglePause(),
      onSecondary: () => this.goHome(),
    }).mount(hud);
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
    this.runScene = new RunScene({
      stage: this.stage,
      world: this.world,
      hero: this.hero,
      coin: this.coin,
      caption: t("brand.city"),
    });
    this.loop.start();
    document.documentElement.lang = getLocale();
    this.showHome();
    window.addEventListener("resize", this.resized);
    window.addEventListener("orientationchange", this.resized);
    document.addEventListener("visibilitychange", this.visibility);
    this.input.attach(window);
    this.input.onChange = (action) => this.onAction(action);
    this.refreshBoard();
    this.events.emit("ready", undefined);
  }

  private onAction(action: string): void {
    if (action === "pause") {
      if (this.mode === "run" && this.world.phase === "running") this.togglePause();
      else if (this.loop.paused) this.togglePause();
      return;
    }
    if (this.mode === "home") {
      // Typing a name is not an intent to run, and the home card has its own Run button.
      if (this.home.isTyping) return;
      if (action === "jump" || action === "slide") this.startRun();
      else this.scene.forceJump();
      return;
    }
    if (this.world.phase === "over" && (action === "jump" || action === "slide")) this.startRun();
  }

  /** All the words on the home card, in the current locale. One function, so switching is one call. */
  private homeLabels(): HomeLabels {
    return {
      kicker: t("brand.city"),
      title: t("game.title"),
      tagline: t("game.tagline"),
      play: t("home.play"),
      nameLabel: t("home.name"),
      nameSave: t("home.nameSave"),
      nameHint: t("home.nameHint"),
      best: t("home.best"),
      distance: t("home.distance"),
      runs: t("home.runs"),
      bank: t("home.bank"),
      language: t("home.language"),
      reset: t("home.reset"),
      resetSure: t("home.resetSure"),
      controls: t("run.hint"),
      saved: t("home.saved"),
    };
  }

  /** Every label the shell owns, rebuilt from the bundle — the only way a locale swap looks instant. */
  private refreshLabels(): void {
    this.home.setLabels(this.homeLabels());
    this.board.setLabels({ score: t("hud.score"), distance: t("hud.distance"), best: t("hud.best") });
    this.lives.setLabel(t("hud.lives"));
    this.coinBar.setLabel(t("currency.name"));
    this.panel.setLabels({
      title: t("leaderboard.title"),
      empty: t("label.empty"),
      you: t("label.you"),
      unnamed: t("label.unnamed"),
    });
    document.documentElement.lang = getLocale();
  }

  private toggleLocale(): void {
    const all = ["en", "bn"];
    const next = all[(all.indexOf(getLocale()) + 1) % all.length] ?? "en";
    if (!setLocale(next)) return;
    this.profile.setLocale(next);
    this.refreshLabels();
    this.refreshBoard();
    if (this.mode === "run") this.lives.update(this.world.view().lives);
  }

  /** The world's event stream is the only place the shell learns about a run. */
  private onWorldEvent(event: RunEvent): void {
    switch (event.type) {
      case "coin":
        this.events.emit("run:coin", { coins: event.coins });
        break;
      case "over":
        this.onRunOver(event.snapshot);
        break;
      default:
        break;
    }
  }

  /** Enter the live run: fresh world, HUD reset, loop unpaused. */
  startRun(): void {
    this.mode = "run";
    this.lastRecord = null;
    this.home.hide();
    this.world.start();
    this.lives.reset();
    this.summary.hide();
    this.loop.paused = false;
    this.els.root.classList.remove("is-paused");
    this.els.root.dataset.mode = "run";
    this.events.emit("mode:change", { mode: "run" });
  }

  /** The stage the run starts and ends on: attract scene running behind a card, no hazards. */
  showHome(): void {
    this.mode = "home";
    this.els.root.dataset.mode = "home";
    this.summary.hide();
    this.home.name = this.profile.name;
    this.home.show();
    this.refreshBoard();
    this.events.emit("mode:change", { mode: "home" });
  }

  goHome(): void {
    this.loop.paused = false;
    this.els.root.classList.remove("is-paused");
    this.showHome();
  }

  /** The board and the four numbers on the home card, from the records layer. */
  private refreshBoard(): void {
    const summary = this.leaderboard.summary();
    const best = summary.best;
    this.home.setStats({
      best: best ? formatValue(best.score) : "—",
      distance: best ? formatValue(best.meters) : "—",
      runs: formatValue(summary.runs),
      bank: formatValue(summary.coinsBank),
    });
    this.panel.render(toRows(this.leaderboard.top(), this.lastRecord?.id ?? null));
  }

  private togglePause(): void {
    if (this.mode !== "run") return;
    const paused = !this.loop.paused;
    this.loop.paused = paused;
    this.els.root.classList.toggle("is-paused", paused);
    if (paused) {
      this.summary.show({
        tone: "paused",
        title: t("run.paused"),
        note: t("run.hint"),
        primaryLabel: t("run.resume"),
        secondaryLabel: t("over.home"),
      });
    } else {
      this.summary.hide();
    }
  }

  /** Bank the coins, write the record, show the receipt. Everything the design doc promises. */
  private onRunOver(snapshot: RunSnapshot): void {
    const previous = this.leaderboard.best();
    // The name is stamped in here rather than looked up when the board renders, so renaming yourself
    // later cannot rewrite history.
    const { record, rank } = this.leaderboard.submit(snapshot, ["solo"], this.profile.name || undefined);
    const isBest = !previous || compareRuns(record, previous) < 0;
    this.lastRecord = record;
    this.runScene.setCelebration(isBest);
    this.refreshLeaderboard(record.id);
    const lines = [
      { label: t("hud.score"), value: String(record.score), emphasis: true },
      { label: t("hud.distance"), value: String(record.meters) },
      { label: t("currency.name"), value: String(record.coins) },
      { label: t("hud.best"), value: String(this.leaderboard.best()?.score ?? record.score) },
    ];
    this.summary.show({
      tone: "over",
      title: isBest ? t("over.record") : t("over.title"),
      kicker: rank > 0 ? t("over.rank", { rank }) : t("over.outOfBoard", { score: record.score }),
      lines,
      note: t("over.coins", { coins: record.coins, currency: t("currency.name") }),
      primaryLabel: t("over.again"),
      secondaryLabel: t("over.home"),
    });
    this.home.name = this.profile.name;
    this.events.emit("run:over", { record: isBest ? record : null, rank });
  }

  private update(dt: number): void {
    if (this.loop.paused) return;
    if (this.mode === "run") {
      this.runScene.update(dt);
      const view = this.world.view();
      this.board.update({
        score: view.snapshot.score,
        meters: view.snapshot.meters,
        multiplier: view.snapshot.multiplier,
        best: this.leaderboard.best()?.score ?? 0,
        combo: view.snapshot.bestCombo,
      });
      this.coinBar.update({ runCoins: view.snapshot.coins, bank: this.leaderboard.coinsBank() });
      this.lives.update(view.lives);
    } else {
      this.scene.update(dt);
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
    // Expire buffered intents the frame after they would have been used.
    this.input.prune();
  }

  private render(): void {
    this.stage.begin(color("navyDeep"));
    if (this.mode === "run") this.runScene.render();
    else this.scene.render();
  }

  /** Exposed for the dev pose lab. */
  get hudRoot(): HTMLElement {
    return this.els.hud;
  }

  /** Kept as the seam the pose lab and any future screen use; the home card goes through refreshBoard. */
  refreshLeaderboard(highlightId: string | null): void {
    this.panel.render(toRows(this.leaderboard.top(), highlightId));
  }

  private onResize(): void {
    this.stage.resize();
  }

  private onVisibility(): void {
    if (document.hidden) this.loop.paused = true;
    else if (this.mode === "home") this.loop.paused = false;
  }

  dispose(): void {
    this.loop?.stop();
    this.home?.dispose();
    window.removeEventListener("resize", this.resized);
    window.removeEventListener("orientationchange", this.resized);
    document.removeEventListener("visibilitychange", this.visibility);
    this.input.detach();
    this.scene?.dispose();
    this.runScene?.dispose();
    this.events.clear();
  }
}
