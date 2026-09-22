/**
 * Deterministic spawner: builds obstacle rows + coin patterns ahead of the runner and
 * guarantees the two rules the genre lives by — the opening stretch is clear, and every
 * row leaves at least one lane you can actually survive.
 */
import balance from "../data/balance.json";
import obstacleData from "../data/obstacles.json";
import { clampLane } from "./Hero";
import type { Rng } from "../../core/Random";
import { createRng, pick, randInt, weighted } from "../../core/Random";

export type Vertical = "ground" | "overhead";
export type ClearKind = "jump" | "slide" | "roll";

export interface ObstacleKind {
  id: string;
  label: string;
  lanes: number;
  lengthMeters: number;
  /**
   * Ground hazards: how tall they are. Overhead hazards: how much clearance is left *under*
   * them. Only used for drawing and telegraphing — the gameplay answer is `clearWith`.
   */
  heightMeters: number;
  /** Thickness of the drawn body, in metres. */
  bodyMeters: number;
  vertical: Vertical;
  clearWith: ClearKind[];
  front: string;
  top: string;
  tier: number;
}

export type CoinPattern = "line" | "arc" | "zigzag" | "cluster" | "none";

export interface Pattern {
  id: string;
  tiers: number[];
  rows: number;
  /** Each entry is one row: the kind ids to place, one per blocked lane. */
  obstacles: string[][];
  coins: CoinPattern;
}

export interface Obstacle {
  kind: ObstacleKind;
  lane: number;
  /** Distance from the hero to the near face, in metres. Shrinks as the run progresses. */
  meters: number;
  hit: boolean;
  /** Awarded once, for whatever kind of close call it turned out to be. */
  scored: boolean;
  /**
   * Set while this hazard is aimed at the hero's lane, so a swerve out of the way and a
   * clear over the top both count as a close call, and free points from scenery do not.
   */
  threatened: boolean;
}

export interface Coin {
  lane: number;
  meters: number;
  /** Height above the track; `arc` patterns sit where a jump apex is. */
  height: number;
  taken: boolean;
}

export interface SpawnRow {
  meters: number;
  pattern: string;
  /**
   * Rows emitted together (the `double` pattern is two rows) share a group. The breather
   * promise is per group: consecutive groups are `gapFor(speed)` apart, rows inside one
   * group are `ROW_STAGGER` apart — that is the combo, not an unfairness.
   */
  group: number;
  obstacles: Obstacle[];
  coins: Coin[];
}

export interface SpawnConfig {
  safeStartMeters: number;
  minGapMeters: number;
  gapSpeedFactor: number;
  coinSpacingMeters: number;
  coinsPerPattern: number;
  viewLengthMeters: number;
  cullBehindMeters: number;
  nearMissWindowMeters: number;
  coinPatternWeights: [CoinPattern, number][];
  tiers: { maxSpeed: number; tier: number }[];
  laneCount: number;
}

const b = balance as unknown as {
  spawn: Omit<SpawnConfig, "laneCount" | "coinPatternWeights"> & { coinPatternWeights: [string, number][] };
  lanes: { count: number };
};

export const SPAWN_CONFIG: SpawnConfig = {
  ...b.spawn,
  coinPatternWeights: b.spawn.coinPatternWeights as unknown as [CoinPattern, number][],
  laneCount: b.lanes.count,
};

export const KINDS: Record<string, ObstacleKind> = Object.fromEntries(
  (obstacleData as { kinds: ObstacleKind[] }).kinds.map((k) => [k.id, k]),
);

export const PATTERNS: Pattern[] = (obstacleData as { patterns: Pattern[] }).patterns;

/**
 * Minimum spacing between the rows of one pattern, in metres… and a floor on the *time*
 * between them (`ROW_REACTION_SECONDS`), because at 21 m/s nine metres is four tenths of a
 * second and a combo stops being readable. Both are applied: whichever is larger.
 */
const ROW_STAGGER = 9;
const ROW_REACTION_SECONDS = 0.55;

/**
 * The spawner only ever emits things at a distance; the world integrates them backwards
 * (meters shrink with speed) and asks for more when the far edge is close. That keeps the
 * generator pure, seedable and testable — a whole kilometre fits in a millisecond.
 */
export class Spawner {
  private frontier: number;
  readonly rng: Rng;
  private rowsBuilt = 0;
  private groups = 0;

  constructor(
    seed = 20260922,
    private readonly cfg: SpawnConfig = SPAWN_CONFIG,
  ) {
    this.rng = createRng(seed);
    this.frontier = 0;
  }

  get built(): number {
    return this.rowsBuilt;
  }

  /** Gap between row centres, widened with speed so reactions stay human. */
  gapFor(speed: number): number {
    return this.cfg.minGapMeters + Math.max(0, speed - 9) * this.cfg.gapSpeedFactor;
  }

  tierFor(speed: number): number {
    for (const t of this.cfg.tiers) if (speed <= t.maxSpeed) return t.tier;
    return this.cfg.tiers.at(-1)?.tier ?? 4;
  }

  patternsFor(tier: number): Pattern[] {
    const options = PATTERNS.filter((p) => p.tiers.includes(tier));
    return options.length ? options : PATTERNS;
  }

  /**
   * A lane is survivable when it is empty, or when **one single action** beats everything
   * standing in it. That distinction matters: a crate (jump) and a gantry (slide) in the same
   * lane are two fair hazards and no fair answer, so the row must not be built that way — the
   * repair loop below is what keeps `patterns` free to mix them.
   */
  static laneIsSolvable(obstacles: readonly Obstacle[], lane: number): boolean {
    return Spawner.answerForLane(obstacles.filter((o) => o.lane === lane)) !== null;
  }

  /** The action that survives this set of hazards, `null` when none exists, `"none"` when empty. */
  static answerForLane(obstacles: readonly Obstacle[]): ClearKind | "none" | null {
    if (obstacles.length === 0) return "none";
    const actions: ClearKind[] = ["jump", "slide", "roll"];
    for (const action of actions) {
      if (obstacles.every((o) => o.kind.clearWith.includes(action))) return action;
    }
    return null;
  }

  static solvableLanes(obstacles: readonly Obstacle[], laneCount: number): number[] {
    const out: number[] = [];
    for (let lane = 0; lane < laneCount; lane++) if (Spawner.laneIsSolvable(obstacles, lane)) out.push(lane);
    return out;
  }

  /**
   * Emit rows until the horizon is stocked. `metersRun` is how far the player has come;
   * nothing is ever placed inside `safeStartMeters`.
   */
  fillUntil(metersRun: number, speed: number): SpawnRow[] {
    const rows: SpawnRow[] = [];
    let guard = 0;
    while (this.frontier < metersRun + this.cfg.viewLengthMeters && guard++ < 32) {
      const at = Math.max(this.frontier, this.cfg.safeStartMeters);
      const tier = this.tierFor(speed);
      const pattern = pick(this.rng, this.patternsFor(tier));
      const group = ++this.groups;
      let cursor = at;
      const stagger = Math.max(ROW_STAGGER, speed * ROW_REACTION_SECONDS);
      for (let r = 0; r < Math.max(1, pattern.rows); r++) {
        rows.push(this.buildRow(pattern, cursor, r, group));
        cursor += stagger;
      }
      // The breather is measured from the last row of the group, so a double never lands a
      // third hazard right behind it.
      this.frontier = cursor + this.gapFor(speed);
      this.rowsBuilt += pattern.rows;
    }
    return rows;
  }

  private buildRow(pattern: Pattern, meters: number, variantIndex: number, group: number): SpawnRow {
    const variants = pattern.obstacles;
    const variant =
      variants[(variantIndex + randInt(this.rng, 0, variants.length - 1)) % variants.length] ?? [];
    const obstacles: Obstacle[] = [];
    const want = variant.length;
    const maxStart = this.cfg.laneCount - Math.min(want, this.cfg.laneCount) + 1;
    const start = randInt(this.rng, 0, Math.max(0, maxStart - 1));
    variant.forEach((id, i) => {
      const kind = KINDS[id];
      if (!kind) return;
      const anchor = clampLane(start + i, this.cfg.laneCount);
      const span = Math.min(kind.lanes, this.cfg.laneCount);
      for (let s = 0; s < span; s++) {
        const lane = clampLane(anchor + s, this.cfg.laneCount);
        if (obstacles.some((o) => o.lane === lane && Math.abs(o.meters - meters) < 0.001)) continue;
        obstacles.push({ kind, lane, meters, hit: false, scored: false, threatened: false });
      }
    });

    let solvable = Spawner.solvableLanes(obstacles, this.cfg.laneCount);
    if (solvable.length === 0) {
      // Repair by opening a lane: the pattern is never allowed to be unsurvivable.
      while (obstacles.length > 1 && solvable.length === 0) {
        obstacles.pop();
        solvable = Spawner.solvableLanes(obstacles, this.cfg.laneCount);
      }
    }

    const lanes = solvable.length ? solvable : [clampLane(1, this.cfg.laneCount)];
    const safeLane = pick(this.rng, lanes);
    return {
      meters,
      pattern: pattern.id,
      group,
      obstacles,
      coins: this.buildCoins(pattern.coins, meters, safeLane, obstacles, lanes),
    };
  }

  /**
   * Coins go *through the solution*: the profitable line is the survivable one. That is the
   * core teaching trick of this genre. A coin that would sit inside a hazard is dropped,
   * never nudged into the wrong lane.
   */
  private buildCoins(
    requested: CoinPattern,
    meters: number,
    safeLane: number,
    obstacles: Obstacle[],
    solvable: number[],
  ): Coin[] {
    if (requested === "none") return [];
    // Most rows keep the authored pattern; the rest roll from the weights for variety.
    const kind: CoinPattern = this.rng() < 0.75 ? requested : weighted(this.rng, this.cfg.coinPatternWeights);
    if (kind === "none") return [];
    const count = this.cfg.coinsPerPattern;
    const step = this.cfg.coinSpacingMeters;
    const coins: Coin[] = [];
    for (let i = 0; i < count; i++) {
      // Zigzag and cluster walk the *survivable* lanes only, so greed never costs a life.
      let lane = safeLane;
      if (kind === "zigzag") lane = solvable[i % solvable.length] ?? safeLane;
      if (kind === "cluster") lane = solvable[Math.floor(i / 2) % solvable.length] ?? safeLane;
      const at = meters + i * step - (count * step) / 2;
      const height = kind === "arc" ? Math.max(0.2, 1.05 * Math.sin((Math.PI * (i + 0.5)) / count)) : 0.55;
      const blocked = obstacles.some(
        (o) => o.lane === lane && Math.abs(o.meters - at) < o.kind.lengthMeters * 0.8,
      );
      if (!blocked) coins.push({ lane, meters: at, height, taken: false });
    }
    return coins;
  }
}
