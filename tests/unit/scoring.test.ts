import { describe, expect, it } from "vitest";
import { compareRuns, RunAccumulator, SCORING } from "../../src/game/scoring";

const step = 1 / 60;

describe("RunAccumulator", () => {
  it("scores distance and coins from the balance file", () => {
    const run = new RunAccumulator();
    run.addDistance(100, 10);
    expect(run.score).toBe(Math.floor(100 * SCORING.pointsPerMeter));
    run.addCoin(4);
    expect(run.score).toBe(Math.floor(100 * SCORING.pointsPerMeter + 4 * SCORING.coinValue));
    expect(run.coins).toBe(4);
  });

  it("grows the multiplier with the combo and caps it", () => {
    const run = new RunAccumulator();
    expect(run.multiplier).toBe(1);
    for (let i = 0; i < 6; i++) run.addCoin();
    expect(run.combo).toBe(6);
    expect(run.multiplier).toBeCloseTo(Math.min(SCORING.comboMax, 1 + 6 * SCORING.comboStep), 6);
    for (let i = 0; i < 400; i++) run.addCoin();
    expect(run.multiplier).toBe(SCORING.comboMax);
  });

  it("drops the combo when the player stops collecting inside the window", () => {
    const run = new RunAccumulator();
    run.addCoin();
    run.addCoin();
    expect(run.combo).toBe(2);
    const idle = Math.ceil((SCORING.comboWindowSeconds + 0.2) / step);
    for (let i = 0; i < idle; i++) run.addDistance(0.15, step);
    expect(run.combo).toBe(0);
  });

  it("resets the streak on a crash and stops counting after finish()", () => {
    const run = new RunAccumulator();
    run.addCoin();
    run.crash();
    expect(run.combo).toBe(0);
    const final = run.finish();
    const meters = run.meters;
    run.addCoin();
    expect(run.meters).toBe(meters);
    expect(run.snapshot()).toEqual(final);
    expect(run.finished).toBe(true);
  });

  it("awards bonuses that show up as extra metres", () => {
    const run = new RunAccumulator();
    const before = run.score;
    run.addNearMiss();
    run.addPerfectChange();
    expect(run.score).toBeGreaterThan(before);
  });
});

describe("compareRuns", () => {
  const base = { score: 100, coins: 1, meters: 50, multiplier: 1, bestCombo: 0, nearMisses: 0, crashes: 0 };

  it("orders by score, then distance, then coins, then fewer crashes (negative = a ranks above b)", () => {
    expect(compareRuns({ ...base, score: 90 }, base)).toBeGreaterThan(0); // worse score -> after
    expect(compareRuns({ ...base, score: 110 }, base)).toBeLessThan(0);
    expect(compareRuns({ ...base, meters: 20 }, base)).toBeGreaterThan(0); // same score, shorter run
    expect(compareRuns({ ...base, coins: 5 }, base)).toBeLessThan(0); // same score, more coins
    expect(compareRuns({ ...base, crashes: 2 }, { ...base, crashes: 1 })).toBeGreaterThan(0);
  });
});
