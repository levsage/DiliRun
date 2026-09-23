/**
 * Persistent records: the scoreboard (this session + personal best) and the
 * leaderboard (top runs on this device).
 *
 * Single-player, so the store is local. The shape is deliberately serialisable and
 * versioned — if a hosted leaderboard is added later it can post these exact
 * objects without a migration.
 */
import type { Store } from "../core/Storage";
import { compareRuns, type RunSnapshot } from "./scoring";

export interface RunRecord extends RunSnapshot {
  id: string;
  /** epoch ms */
  at: number;
  mode: "solo";
  /** cosmetic: which hero skin / powerups were active */
  tags?: string[];
  /**
   * Who ran it, from `profile.ts`, stamped in at submit time rather than read back later — a board row
   * keeps the name the run was made under even after the player renames themselves. Absent on records
   * written before the field existed, which is why the UI renders a fallback rather than "".
   */
  name?: string;
}

export interface ScoreboardState {
  best: RunRecord | null;
  sessionBest: RunRecord | null;
  runs: number;
  coinsBank: number;
  coinsThisRun: number;
  totalCoins: number;
}

export interface LeaderboardOptions {
  limit?: number;
  recentLimit?: number;
}

const SCOREBOARD = "scoreboard";
const RECENT = "runs.recent";

function makeId(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID();
  return `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function isRunRecord(value: unknown): value is RunRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<RunRecord>;
  return (
    typeof v.id === "string" &&
    typeof v.score === "number" &&
    Number.isFinite(v.score) &&
    v.score >= 0 &&
    typeof v.coins === "number" &&
    typeof v.meters === "number" &&
    typeof v.at === "number"
  );
}

export class Leaderboard {
  readonly limit: number;
  private readonly recentLimit: number;

  constructor(
    private readonly store: Store,
    options: LeaderboardOptions = {},
  ) {
    this.limit = Math.max(1, options.limit ?? 10);
    this.recentLimit = Math.max(1, options.recentLimit ?? 20);
  }

  /** Top runs, best first. Bad rows are dropped instead of crashing the UI. */
  top(n = this.limit): RunRecord[] {
    const raw = this.store.read<unknown[]>(SCOREBOARD, []);
    const rows = (Array.isArray(raw) ? raw : []).filter(isRunRecord);
    rows.sort((a, b) => compareRuns(a, b));
    return rows.slice(0, Math.min(n, this.limit));
  }

  recent(n = 10): RunRecord[] {
    const raw = this.store.read<unknown[]>(RECENT, []);
    const rows = (Array.isArray(raw) ? raw : []).filter(isRunRecord);
    return rows.slice(-Math.min(n, this.recentLimit)).reverse();
  }

  best(): RunRecord | null {
    return this.top(1)[0] ?? null;
  }

  totalRuns(): number {
    return this.store.read<number>("runs.count", 0);
  }

  coinsBank(): number {
    return Math.max(0, Math.floor(this.store.read<number>("coins.bank", 0)));
  }

  addCoins(amount: number): number {
    const next = this.coinsBank() + Math.max(0, Math.floor(amount));
    this.store.write("coins.bank", next);
    return next;
  }

  /**
   * Persist one finished run. Returns its 1-based rank (0 = below the cut-off) so
   * the game over screen can celebrate a genuine placement.
   */
  submit(run: RunSnapshot, tags: string[] = [], name?: string): { record: RunRecord; rank: number } {
    const record: RunRecord = {
      ...run,
      id: makeId(),
      at: Date.now(),
      mode: "solo",
      ...(tags.length ? { tags } : {}),
      ...(name ? { name } : {}),
    };
    const rows = this.top(this.limit + 1);
    const withNew = [...rows, record].sort((a, b) => compareRuns(a, b));
    const kept = withNew.slice(0, this.limit);
    const rank = kept.findIndex((r) => r.id === record.id) + 1;
    this.store.write(SCOREBOARD, kept);

    const recent = this.recent(this.recentLimit);
    this.store.write(RECENT, [...recent.reverse(), record].slice(-this.recentLimit));
    this.store.write("runs.count", this.totalRuns() + 1);
    this.addCoins(record.coins);
    return { record, rank: Math.max(0, rank) };
  }

  /** Merge a legacy/partial scoreboard blob into the current shape. */
  summary(): ScoreboardState {
    const saved = this.store.read<Partial<ScoreboardState>>("scoreboard.state", {});
    const top = this.top();
    const best = this.best();
    return {
      best: best ?? null,
      sessionBest: saved.sessionBest ?? best ?? null,
      runs: this.totalRuns(),
      coinsBank: this.coinsBank(),
      coinsThisRun: 0,
      totalCoins: saved.totalCoins ?? top.reduce((sum, r) => sum + r.coins, 0),
    };
  }

  noteSessionBest(candidate: RunRecord | null): void {
    if (!candidate) return;
    const saved = this.store.read<Partial<ScoreboardState>>("scoreboard.state", {});
    const current = saved.sessionBest ?? null;
    if (!current || compareRuns(candidate, current) < 0) {
      this.store.write("scoreboard.state", { ...saved, sessionBest: candidate });
    }
  }

  reset(): void {
    this.store.remove(SCOREBOARD);
    this.store.remove(RECENT);
    this.store.remove("runs.count");
    this.store.remove("scoreboard.state");
    this.store.write("coins.bank", 0);
  }
}
