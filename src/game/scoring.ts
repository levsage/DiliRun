/**
 * Pure scoring rules for a single run.
 *
 * Kept free of DOM and canvas so the scoreboard, the leaderboard and the tests all
 * agree on what a run is worth. The game state machine feeds these functions; they
 * never reach back into the engine.
 */
import balance from "./data/balance.json";

export interface ScoringConfig {
  pointsPerMeter: number;
  coinValue: number;
  comboStep: number;
  comboMax: number;
  comboWindowSeconds: number;
  nearMissBonus: number;
  perfectLaneChangeBonus: number;
}

export const SCORING = (balance as { scoring: ScoringConfig }).scoring;

export interface RunSnapshot {
  score: number;
  coins: number;
  meters: number;
  multiplier: number;
  bestCombo: number;
  nearMisses: number;
  crashes: number;
}

/** Accumulates one player run: distance, coins, combo streak, bonuses. */
export class RunAccumulator {
  private _meters = 0;
  private _coins = 0;
  private _combo = 0;
  private _bestCombo = 0;
  private _nearMisses = 0;
  private _crashes = 0;
  private _comboTimer = 0;
  private _finished = false;

  constructor(private readonly cfg: ScoringConfig = SCORING) {}

  get combo(): number {
    return this._combo;
  }

  /** Multiplier applied to distance and coin income, 1.0 .. comboMax. */
  get multiplier(): number {
    return Math.min(this.cfg.comboMax, 1 + this._combo * this.cfg.comboStep);
  }

  get coins(): number {
    return this._coins;
  }

  get meters(): number {
    return Math.floor(this._meters);
  }

  get score(): number {
    return Math.floor(this._meters * this.cfg.pointsPerMeter + this._coins * this.cfg.coinValue);
  }

  get finished(): boolean {
    return this._finished;
  }

  snapshot(): RunSnapshot {
    return {
      score: this.score,
      coins: this._coins,
      meters: this.meters,
      multiplier: round2(this.multiplier),
      bestCombo: this._bestCombo,
      nearMisses: this._nearMisses,
      crashes: this._crashes,
    };
  }

  addDistance(meters: number, dt: number): void {
    if (this._finished || meters <= 0) return;
    this._meters += meters;
    this._comboTimer += dt;
    if (this._comboTimer >= this.cfg.comboWindowSeconds && this._combo > 0) {
      this._combo = 0;
      this._comboTimer = 0;
    }
  }

  addCoin(count = 1): void {
    if (this._finished) return;
    this._coins += count;
    this._combo += count;
    this._bestCombo = Math.max(this._bestCombo, this._combo);
    this._comboTimer = 0;
  }

  addNearMiss(): void {
    if (this._finished) return;
    this._nearMisses++;
    this._meters += this.cfg.nearMissBonus;
    this._combo++;
    this._bestCombo = Math.max(this._bestCombo, this._combo);
  }

  addPerfectChange(): void {
    if (this._finished) return;
    this._meters += this.cfg.perfectLaneChangeBonus;
  }

  crash(): void {
    if (this._finished) return;
    this._crashes++;
    this._combo = 0;
    this._comboTimer = 0;
  }

  finish(): RunSnapshot {
    this._finished = true;
    return this.snapshot();
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Ranking comparator used by both the leaderboard and the "new best" banner. */
export function compareRuns(a: RunSnapshot, b: RunSnapshot): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.meters !== a.meters) return b.meters - a.meters;
  if (b.coins !== a.coins) return b.coins - a.coins;
  return a.crashes - b.crashes;
}
