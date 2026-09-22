/**
 * One run, in one object.
 *
 * `RunWorld` is the whole simulation — speed curve, scroll, spawner, collisions, lives,
 * scoring — driven by `step(dt)` and a callback that drains buffered input. It knows nothing
 * about canvas or DOM, which is why the game's rules can be tested by running a thousand
 * simulated metres in a millisecond. The scene in `src/app/RunScene.ts` only renders it.
 */
import balance from "../data/balance.json";
import { Hero, HERO_CONFIG, type HeroConfig } from "../entities/Hero";
import { SPAWN_CONFIG, Spawner, type Coin, type Obstacle, type SpawnConfig } from "../entities/Spawner";
import { resolveContacts, type Contact } from "./Collision";
import { RunAccumulator, type RunSnapshot } from "../scoring";
import type { GameAction } from "../../core/Input";
import type { ClearKind } from "../entities/Hero";

export type RunPhase = "ready" | "running" | "crashed" | "over";

export interface WorldConfig {
  startSpeed: number;
  maxSpeed: number;
  accelPerSecond: number;
  lives: number;
  invulnerableSeconds: number;
  crashSpeedFloor: number;
  hitStopSeconds: number;
  shakeOnCrash: number;
  crashStaggerSeconds: number;
  viewLengthMeters: number;
  cullBehindMeters: number;
  nearMissWindowMeters: number;
  coinWindowMeters: number;
  coinHeightWindow: number;
  heroDepthMeters: number;
}

const raw = balance as unknown as {
  run: Record<string, number>;
  feel: { hitStopSeconds: number; shakeOnCrash: number };
  spawn: { viewLengthMeters: number; cullBehindMeters: number; nearMissWindowMeters: number };
};

export const WORLD_CONFIG: WorldConfig = {
  ...raw.run,
  hitStopSeconds: raw.feel.hitStopSeconds,
  shakeOnCrash: raw.feel.shakeOnCrash,
  crashStaggerSeconds: 0.42,
  viewLengthMeters: raw.spawn.viewLengthMeters,
  cullBehindMeters: raw.spawn.cullBehindMeters,
  nearMissWindowMeters: raw.spawn.nearMissWindowMeters,
  coinWindowMeters: 0.85,
  coinHeightWindow: 0.75,
  heroDepthMeters: raw.run.heroDepthMeters,
} as WorldConfig;

export type RunEvent =
  | { type: "start" }
  | { type: "coin"; coins: number; total: number }
  | { type: "nearMiss"; label: string }
  | { type: "crash"; lives: number; label: string }
  | { type: "landed"; hard: boolean }
  | { type: "laneChange"; lane: number }
  | { type: "over"; snapshot: RunSnapshot };

export interface RunView {
  phase: RunPhase;
  meters: number;
  speed: number;
  lives: number;
  maxLives: number;
  invulnerable: number;
  shake: number;
  hitStop: number;
  snapshot: RunSnapshot;
  hero: {
    lane: number;
    laneEased: number;
    hop: number;
    heightMeters: number;
    spriteState: string;
    clears: ClearKind | null;
  };
}

export interface WorldOptions {
  seed?: number;
  world?: WorldConfig;
  hero?: HeroConfig;
  spawn?: SpawnConfig;
  onEvent?: (event: RunEvent) => void;
  /** Injected so tests can drive the world without an InputController. */
  take?: (action: GameAction) => boolean;
}

export class RunWorld {
  readonly hero: Hero;
  /** Replaced on start(): a finished accumulator must not leak into the next run. */
  score = new RunAccumulator();
  /** Replaced on restart so a fresh seed can be handed to the same world object. */
  spawner: Spawner;
  obstacles: Obstacle[] = [];
  coins: Coin[] = [];

  phase: RunPhase = "ready";
  meters = 0;
  speed = 0;
  lives: number;
  invulnerable = 0;
  hitStop = 0;
  shake = 0;
  elapsed = 0;
  /** Set by the scene so a new personal best can celebrate instead of stumbling. */
  lastCrashLabel = "";

  private readonly cfg: WorldConfig;
  private readonly spawnCfg: SpawnConfig;
  private readonly take: (action: GameAction) => boolean;
  private lastLaneChangeAtMeters = -Infinity;
  private stagger = 0;
  private emit: (event: RunEvent) => void;

  constructor(options: WorldOptions = {}) {
    this.cfg = options.world ?? WORLD_CONFIG;
    this.take = options.take ?? (() => false);
    this.spawnCfg = options.spawn ?? SPAWN_CONFIG;
    this.emit = options.onEvent ?? (() => {});
    this.lives = this.cfg.lives;
    this.hero = new Hero(options.hero ?? HERO_CONFIG, {
      onLand: (air) => this.emit({ type: "landed", hard: air > 0.4 }),
      onLaneChange: (from, to) => this.onLaneChange(from, to),
    });
    this.spawner = new Spawner(options.seed ?? 20260922, this.spawnCfg);
    this.speed = this.cfg.startSpeed;
  }

  get viewLength(): number {
    return this.cfg.viewLengthMeters;
  }

  /** Begin (or restart) a run: same object, fresh state, so the scene keeps its listeners. */
  start(seed = 20260922): void {
    this.phase = "running";
    this.score = new RunAccumulator();
    this.meters = 0;
    this.elapsed = 0;
    this.speed = this.cfg.startSpeed;
    this.lives = this.cfg.lives;
    this.invulnerable = 0;
    this.hitStop = 0;
    this.shake = 0;
    this.obstacles = [];
    this.coins = [];
    this.lastLaneChangeAtMeters = -Infinity;
    this.hero.reset();
    this.spawner = new Spawner(seed, this.spawnCfg);
    this.stagger = 0;
    this.lastCrashLabel = "";
    this.emit({ type: "start" });
  }

  /** Advance the simulation by one fixed step. `dt` is the loop's fixed step, never wall clock. */
  step(dt: number): void {
    if (this.phase === "ready") {
      this.hero.step(dt);
      return;
    }

    this.shake = Math.max(0, this.shake - dt * 26);
    this.invulnerable = Math.max(0, this.invulnerable - dt);

    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dt);
      this.hero.step(dt * 0.25);
      return;
    }

    if (this.phase === "over") {
      // The world keeps easing to a stop behind the summary card.
      this.speed = Math.max(0, this.speed - dt * 14);
      this.scroll(this.speed * dt);
      this.hero.step(dt);
      this.cull();
      return;
    }

    this.elapsed += dt;
    this.readInput();

    if (this.phase === "crashed") {
      this.speed = Math.max(this.cfg.crashSpeedFloor, this.speed - dt * 18);
      this.stagger -= dt;
      if (this.stagger <= 0) this.phase = "running";
    } else {
      this.speed = Math.min(this.cfg.maxSpeed, this.speed + this.cfg.accelPerSecond * dt);
    }

    const advance = this.speed * dt;
    this.scroll(advance);
    this.hero.step(dt);
    this.score.addDistance(advance, dt);

    const contacts = resolveContacts(this.hero, this.obstacles, this.coins, {
      heroDepthMeters: this.cfg.heroDepthMeters,
      coinWindowMeters: this.cfg.coinWindowMeters,
      coinHeightWindow: this.cfg.coinHeightWindow,
      nearMissWindowMeters: this.cfg.nearMissWindowMeters,
    });
    for (const contact of contacts) this.handleContact(contact);

    this.payPerfectDodge();
    this.spawnAhead();
    this.cull();
  }

  /**
   * Buffered input, read once per step. A dive (down while airborne) becomes a roll so the
   * fast recovery is available mid-jump; up is only consumed when take-off is legal.
   */
  private readInput(): void {
    if (this.phase !== "running") return;
    if (this.take("left")) this.hero.move(-1);
    if (this.take("right")) this.hero.move(1);
    if (this.take("jump")) this.hero.jump();
    if (this.take("slide")) {
      if (this.hero.airborne) this.hero.roll();
      else this.hero.slide();
    }
  }

  private onLaneChange(_from: number, to: number): void {
    this.lastLaneChangeAtMeters = this.meters;
    this.emit({ type: "laneChange", lane: to });
  }

  /**
   * The extra sliver of the reward: a swerve inside the reaction window also pays the
   * perfect-change bonus. The near miss itself is Collision's call, so the two can never
   * double-count the same hazard.
   */
  private payPerfectDodge(): void {
    if (this.meters - this.lastLaneChangeAtMeters > this.cfg.nearMissWindowMeters) return;
    for (const obstacle of this.obstacles) {
      if (obstacle.hit || !obstacle.threatened) continue;
      if (obstacle.lane === this.hero.lane) continue;
      if (obstacle.meters > 0) continue;
      this.score.addPerfectChange();
      this.lastLaneChangeAtMeters = -Infinity;
      return;
    }
  }

  private handleContact(contact: Contact): void {
    switch (contact.type) {
      case "coin": {
        this.score.addCoin(1);
        this.emit({ type: "coin", coins: this.score.coins, total: this.score.coins });
        break;
      }
      case "nearMiss": {
        this.score.addNearMiss();
        this.emit({ type: "nearMiss", label: contact.obstacle.kind.label });
        break;
      }
      case "hit": {
        if (this.invulnerable > 0) break;
        this.lastCrashLabel = contact.obstacle.kind.label;
        this.lives -= 1;
        this.score.crash();
        this.hitStop = this.cfg.hitStopSeconds;
        this.shake = this.cfg.shakeOnCrash;
        this.invulnerable = this.cfg.invulnerableSeconds;
        this.emit({ type: "crash", lives: this.lives, label: contact.obstacle.kind.label });
        if (this.lives <= 0) this.finish();
        else {
          this.phase = "crashed";
          this.stagger = this.cfg.crashStaggerSeconds;
          this.hero.stumble(this.cfg.crashStaggerSeconds);
        }
        break;
      }
    }
  }

  private scroll(advance: number): void {
    for (const obstacle of this.obstacles) obstacle.meters -= advance;
    for (const coin of this.coins) coin.meters -= advance;
    this.meters += advance;
  }

  private spawnAhead(): void {
    for (const row of this.spawner.fillUntil(this.meters, this.speed)) {
      this.obstacles.push(...row.obstacles);
      this.coins.push(...row.coins);
    }
  }

  private cull(): void {
    const behind = -this.cfg.cullBehindMeters;
    if (this.obstacles.some((o) => o.meters < behind)) {
      this.obstacles = this.obstacles.filter((o) => o.meters >= behind);
    }
    if (this.coins.some((c) => c.meters < behind)) this.coins = this.coins.filter((c) => c.meters >= behind);
  }

  private finish(): void {
    this.phase = "over";
    const snapshot = this.score.finish();
    this.emit({ type: "over", snapshot });
  }

  /** Hand the player out of a crash by force (used by the pause menu's "end run"). */
  giveUp(): void {
    if (this.phase !== "over") {
      this.lives = 0;
      this.finish();
    }
  }

  view(): RunView {
    return {
      phase: this.phase,
      meters: Math.floor(this.meters),
      speed: this.speed,
      lives: this.lives,
      maxLives: this.cfg.lives,
      invulnerable: this.invulnerable,
      shake: this.shake,
      hitStop: this.hitStop,
      snapshot: this.score.snapshot(),
      hero: {
        lane: this.hero.lane,
        laneEased: this.hero.laneEased,
        hop: this.hero.hop,
        heightMeters: this.hero.heightMeters,
        spriteState: this.hero.spriteState,
        clears: this.hero.clears,
      },
    };
  }

  result(): RunSnapshot {
    return this.score.snapshot();
  }
}
