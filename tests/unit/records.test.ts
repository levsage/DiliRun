import { describe, expect, it } from "vitest";
import { MemoryDriver, Store } from "../../src/core/Storage";
import { isRunRecord, Leaderboard } from "../../src/game/records";

const run = (score: number, meters = 10, coins = 2) => ({
  score,
  coins,
  meters,
  multiplier: 1,
  bestCombo: 0,
  nearMisses: 0,
  crashes: 0,
});

function makeBoard(limit = 3): Leaderboard {
  return new Leaderboard(new Store({ driver: new MemoryDriver(), prefix: "dilirun-test", version: 1 }), {
    limit,
  });
}

describe("isRunRecord", () => {
  it("rejects junk rows instead of trusting stored JSON", () => {
    expect(isRunRecord(null)).toBe(false);
    expect(isRunRecord({ id: "x" })).toBe(false);
    expect(isRunRecord({ id: "x", score: Number.NaN, coins: 0, meters: 0, at: 1 })).toBe(false);
    expect(isRunRecord({ id: "x", score: 1, coins: 0, meters: 0, at: 1 })).toBe(true);
  });
});

describe("Leaderboard", () => {
  it("keeps only the top N runs, best first", () => {
    const board = makeBoard(3);
    for (const score of [50, 300, 120, 800, 10]) board.submit(run(score));
    const top = board.top();
    expect(top.map((r) => r.score)).toEqual([800, 300, 120]);
  });

  it("returns the 1-based rank of a submitted run and 0 when it misses the cut", () => {
    const board = makeBoard(2);
    expect(board.submit(run(100)).rank).toBe(1);
    expect(board.submit(run(50)).rank).toBe(2);
    expect(board.submit(run(10)).rank).toBe(0);
    expect(board.top().length).toBe(2);
  });

  it("banks coins and counts runs", () => {
    const board = makeBoard();
    board.submit(run(10, 5, 7));
    board.submit(run(20, 5, 3));
    expect(board.coinsBank()).toBe(10);
    expect(board.totalRuns()).toBe(2);
    expect(board.best()?.score).toBe(20);
    expect(board.summary().coinsBank).toBe(10);
  });

  it("tracks the session best separately and survives reset()", () => {
    const board = makeBoard();
    const { record } = board.submit(run(1000));
    board.noteSessionBest(record);
    expect(board.summary().sessionBest?.score).toBe(1000);
    board.reset();
    expect(board.top()).toEqual([]);
    expect(board.coinsBank()).toBe(0);
    expect(board.totalRuns()).toBe(0);
  });

  it("ignores corrupted rows that were written into storage by an older build", () => {
    const driver = new MemoryDriver();
    driver.setItem(
      "dilirun-test.v1.scoreboard",
      JSON.stringify([{ nonsense: true }, null, { id: "a", score: 5, coins: 0, meters: 1, at: 2 }]),
    );
    const board = new Leaderboard(new Store({ driver, prefix: "dilirun-test", version: 1 }), { limit: 5 });
    expect(board.top().map((r) => r.id)).toEqual(["a"]);
  });

  it("falls back to empty when the stored payload is not an array", () => {
    const driver = new MemoryDriver();
    driver.setItem("dilirun-test.v1.scoreboard", '"not-an-array"');
    const board = new Leaderboard(new Store({ driver, prefix: "dilirun-test", version: 1 }));
    expect(board.top()).toEqual([]);
  });
});
