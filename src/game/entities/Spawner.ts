/**
 * Deterministic spawner: builds obstacle rows and coin strips ahead of the runner, and guarantees
 * the two rules the genre lives by — the opening stretch is clear, and every row leaves at least one
 * lane you can actually survive.
 *
 * Hazards and coins are emitted by **two independent schedules**. A coin strip advances on its own
 * frontier (`coinGapMeters` + jitter + a speed term) and is not attached to any obstacle row, so
 * coins keep arriving whether or not a block is due. The one coupling that survives is safety:
 * a strip is only laid in a lane that is clear of hazards for its whole length, because a coin that
 * sits *inside* a block is not a reward, it is a death with a sparkle on it.
 */
import balance from "../data/balance.json";
import obstacleData from "../data/obstacles.json";
import { clampLane } from "./Hero";
import type { Rng } from "../../core/Random";
import { createRng, pick, randInt, weighted } from "../../core/Random";

export type Vertical = "ground" | "overhead";
export type ClearKind = "jump" | "slide" | "roll";
/** What the hazard tells the player to do about it. `none` means "move out of the way". */
export type HazardSignal = "jump" | "duck" | "roll" | "none";

export interface ObstacleKind {
  id: string;
  label: string;
  lanes: number;
  lengthMeters: number;
  /**
   * Ground hazards: how tall they are. Overhead hazards: how much clearance is left *under* them.
   * Only used for drawing and telegraphing — the gameplay answer is `clearWith`.
   */
  heightMeters: number;
  /** Thickness of the drawn body, in metres. */
  bodyMeters: number;
  vertical: Vertical;
  clearWith: ClearKind[];
  /** The arrow painted on the hazard: ↑ for a jump, ↓ for a duck, ⟳ for a roll. */
  signal: HazardSignal;
  front: string;
  top: string;
  tier: number;
}

export type CoinPattern = "line" | "arc" | "zigzag" | "cluster";

export interface Pattern {
  id: string;
  tiers: number[];
  rows: number;
  /** Each entry is one row: the kind ids to place, one per blocked lane. */
  obstacles: string[][];
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
   * Set while this hazard is aimed at the hero's lane, so a swerve out of the way and a clear over
   * the top both count as a close call, and free points from scenery do not.
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
   * Rows emitted together (the `double` pattern is two rows) share a group. The breather promise is
   * per group: consecutive groups are `gapFor(speed)` apart, rows inside one group are
   * `max(ROW_STAGGER, speed * ROW_REACTION_SECONDS)` apart — that is the combo, not an unfairness.
   */
  group: number;
  obstacles: Obstacle[];
  coins: Coin[];
}

export interface SpawnConfig {
  safeStartMeters: number;
  minGapMeters: number;
  gapSpeedFactor: number;
  viewLengthMeters: number;
  cullBehindMeters: number;
  nearMissWindowMeters: number;
  tiers: { maxSpeed: number; tier: number }[];
  laneCount: number;
  /** Distance between the *starts* of consecutive coin strips, before jitter and speed. */
  coinGapMeters: number;
  coinGapJitterMeters: number;
  /** Coins are paced up with speed too, or they stop feeling like a stream at 21 m/s. */
  coinGapSpeedFactor: number;
  /** Coins may start before the first hazard, so the run opens with something to chase. */
  coinSafeStartMeters: number;
  coinSpacingMeters: number;
  coinsPerPattern: number;
  /** A coin is never laid closer than this to a hazard's span in the same lane. */
  coinClearanceMeters: number;
  coinPatternWeights: [CoinPattern, number][];
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
 * Minimum spacing between the rows of one pattern, in metres… and a floor on the *time* between them
 * (`ROW_REACTION_SECONDS`), because at 21 m/s nine metres is four tenths of a second and a combo
 * stops being readable. Both are applied: whichever is larger.
 */
const ROW_STAGGER = 9;
const ROW_REACTION_SECONDS = 0.55;

/** A hazard's danger span, widened by the coin clearance, so a strip can be tested against it. */
interface LaneSpan {
  lane: number;
  from: number;
  to: number;
}

/**
 * The spawner only ever emits things at a distance; the world integrates them backwards (meters
 * shrink with speed) and asks for more when the far edge is close. That keeps the generator pure,
 * seedable and testable — a whole kilometre fits in a millisecond.
 */
export class Spawner {
  private frontier: number;
  private coinFrontier: number;
  readonly rng: Rng;
  private rowsBuilt = 0;
  private groups = 0;
  private readonly spans: LaneSpan[] = [];

  constructor(
    seed = 20260922,
    private readonly cfg: SpawnConfig = SPAWN_CONFIG,
  ) {
    this.rng = createRng(seed);
    this.frontier = 0;
    this.coinFrontier = Math.max(0, this.cfg.coinSafeStartMeters);
  }

  get built(): number {
    return this.rowsBuilt;
  }

  /** Gap between row centres, widened with speed so reactions stay human. */
  gapFor(speed: number): number {
    return this.cfg.minGapMeters + Math.max(0, speed - 9) * this.cfg.gapSpeedFactor;
  }

  /** The same promise for coins, on its own clock: never synced to a hazard row. */
  coinGapFor(speed: number): number {
    return (
      this.cfg.coinGapMeters +
      this.rng() * this.cfg.coinGapJitterMeters +
      Math.max(0, speed - 9) * this.cfg.coinGapSpeedFactor
    );
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
   * A lane is survivable when it is empty, or when **one single action** beats everything standing
   * in it. That distinction matters: a crate (jump) and a gantry (slide) in the same lane are two
   * fair hazards and no fair answer, so the row must not be built that way — the repair loop below is
   * what keeps `patterns` free to mix them.
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
   * The arrow a hazard owes the player, derived from what beats it. Data declares it (so a designer
   * can overrule) and `tests/unit/signals.test.ts` asserts the two agree.
   */
  static signalFor(kind: Pick<ObstacleKind, "clearWith">): HazardSignal {
    // Collapse the stances into the two shapes a player can read at 30 px: crouching (slide or roll) and
    // leaving the ground. A hazard you could clear *either* way gets no glyph, because naming one of the
    // two answers would be a half-truth painted where people look for the whole one.
    const families = new Set(kind.clearWith.map((a) => (a === "jump" ? "jump" : "duck")));
    if (families.size !== 1) return "none";
    const family = [...families][0];
    if (family === "jump") return "jump";
    // Distinguish a roll-only hazard from a duck one, in case a future kind asks for the barrel roll.
    return kind.clearWith.every((a) => a === "roll") ? "roll" : "duck";
  }

  /**
   * Emit rows until the horizon is stocked. `metersRun` is how far the player has come; nothing is
   * ever placed inside `safeStartMeters` (hazards) or `coinSafeStartMeters` (coins).
   */
  fillUntil(metersRun: number, speed: number): SpawnRow[] {
    const horizon = metersRun + this.cfg.viewLengthMeters;
    const rows: SpawnRow[] = [];
    let guard = 0;
    while (this.frontier < horizon && guard++ < 32) {
      const at = Math.max(this.frontier, this.cfg.safeStartMeters);
      const tier = this.tierFor(speed);
      const pattern = pick(this.rng, this.patternsFor(tier));
      const group = ++this.groups;
      let cursor = at;
      const stagger = Math.max(ROW_STAGGER, speed * ROW_REACTION_SECONDS);
      for (let r = 0; r < Math.max(1, pattern.rows); r++) {
        const row = this.buildRow(pattern, cursor, r, group);
        rows.push(row);
        cursor += stagger;
      }
      // The breather is measured from the last row of the group, so a double never lands a third
      // hazard right behind it.
      this.frontier = cursor + this.gapFor(speed);
      this.rowsBuilt += pattern.rows;
    }
    guard = 0;
    while (this.coinFrontier < horizon && guard++ < 32) {
      const at = this.coinFrontier;
      const strip = this.buildCoinStrip(at);
      const length = strip ? strip.coins.length * this.cfg.coinSpacingMeters : 0;
      if (strip) rows.push(strip);
      // Even an empty slot advances the frontier, or a busy stretch would re-ask forever.
      this.coinFrontier = at + length + this.coinGapFor(speed);
    }
    this.pruneSpans(metersRun);
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

    const clr = this.cfg.coinClearanceMeters;
    for (const o of obstacles) {
      this.spans.push({ lane: o.lane, from: o.meters - clr, to: o.meters + o.kind.lengthMeters + clr });
    }
    return { meters, pattern: pattern.id, group, obstacles, coins: [] };
  }

  /**
   * A coin strip, or `null` when no lane is free for its whole length. Lanes are chosen from what is
   * clear *now*, which is what keeps a coin from pushing the player into a block.
   */
  private buildCoinStrip(meters: number): SpawnRow | null {
    const step = this.cfg.coinSpacingMeters;
    const clr = this.cfg.coinClearanceMeters;
    const longest = (this.cfg.coinsPerPattern - 1) * step;
    // Nudge the whole strip out of any hazard window first. This is the rule the player asked for by
    // name: coins keep coming, but never at the moment a block arrives — the push is what makes that
    // true in *every* lane, while the lane test below still stops a coin sitting inside a hazard.
    const start = this.pushPastHazards(meters, longest);
    if (start === null) return null;
    const from = start;
    // Only lay coins on ground that is already stocked and known clear. Rather than skip a strip that
    // reaches past the frontier, it is trimmed to fit: dropping the whole strip is what turned a busy
    // stretch into a 100 m coin desert, and "coins keep coming" is the promise being made here.
    const room = this.frontier - clr - from;
    const count = Math.max(0, Math.min(this.cfg.coinsPerPattern, Math.floor(room / step) + 1));
    if (count < 2) return null;
    const to = from + (count - 1) * step;

    const free: number[] = [];
    for (let lane = 0; lane < this.cfg.laneCount; lane++) {
      const blocked = this.spans.some((s) => s.lane === lane && s.from <= to + clr && s.to >= from - clr);
      if (!blocked) free.push(lane);
    }
    if (free.length === 0) return null;

    const kind = weighted(this.rng, this.cfg.coinPatternWeights);
    const home = pick(this.rng, free);
    const coins: Coin[] = [];
    for (let i = 0; i < count; i++) {
      // Zigzag and cluster walk the free lanes, so greed never costs a life.
      const lane =
        kind === "zigzag"
          ? (free[i % free.length] ?? home)
          : kind === "cluster"
            ? (free[Math.floor(i / 2) % free.length] ?? home)
            : home;
      const at = from + i * step;
      const height = kind === "arc" ? Math.max(0.2, 1.05 * Math.sin((Math.PI * (i + 0.5)) / count)) : 0.55;
      if (this.laneClearAt(lane, at)) coins.push({ lane, meters: at, height, taken: false });
    }
    if (coins.length < 2) return null;
    return { meters: from, pattern: `coins:${kind}`, group: 0, obstacles: [], coins };
  }

  /**
   * Move a strip start forward until `[from - clearance, to + clearance]` holds no hazard at all, in
   * any lane. Returns `null` when the horizon runs out first, which just means this slot is skipped
   * and the next one is tried at the usual cadence — never a hole in the coin flow.
   */
  private pushPastHazards(from: number, length: number): number | null {
    const clr = this.cfg.coinClearanceMeters;
    let cursor = from;
    for (let attempt = 0; attempt < 5; attempt++) {
      const to = cursor + length;
      let pushed = cursor;
      for (const s of this.spans) {
        if (s.from <= to + clr && s.to >= cursor - clr) pushed = Math.max(pushed, s.to + clr);
      }
      if (pushed === cursor) return cursor;
      cursor = pushed;
    }
    return null;
  }

  private laneClearAt(lane: number, meters: number): boolean {
    const clr = this.cfg.coinClearanceMeters;
    return !this.spans.some((s) => s.lane === lane && s.from - clr <= meters && s.to + clr >= meters);
  }

  /** Spans the player has already passed cannot block anything; drop them or the list grows all run. */
  private pruneSpans(metersRun: number): void {
    const keepFrom = metersRun - this.cfg.cullBehindMeters - 8;
    const keepTo = metersRun + this.cfg.viewLengthMeters + 60;
    const kept = this.spans.filter((s) => s.to >= keepFrom && s.from <= keepTo);
    this.spans.length = 0;
    // The window is a few dozen spans, so a plain push is cheaper and safer than an index compaction.
    for (const s of kept) this.spans.push(s);
  }
}
