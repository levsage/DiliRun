import { describe, expect, it } from "vitest";
import { KINDS, PATTERNS, SPAWN_CONFIG, Spawner, type SpawnRow } from "../../src/game/entities/Spawner";

/** Everything a spawner produces over `metres` of running. */
function simulate(seed: number, metres = 1200, speed = 12): SpawnRow[] {
  const spawner = new Spawner(seed);
  const rows: SpawnRow[] = [];
  for (let m = 0; m < metres; m += 4) rows.push(...spawner.fillUntil(m, speed));
  return rows;
}

describe("obstacle data", () => {
  it("knows the five hazards from the design table, with a stated answer for each", () => {
    expect(Object.keys(KINDS).sort()).toEqual([
      "barrierHigh",
      "barrierLow",
      "beamRow",
      "trainLow",
      "trainTall",
    ]);
    expect(KINDS.barrierLow?.clearWith).toEqual(["jump"]);
    expect(KINDS.barrierHigh?.clearWith).toEqual(["slide", "roll"]);
    expect(KINDS.beamRow?.lanes).toBe(3);
    expect(KINDS.trainTall?.lanes).toBe(2);
    // Trains are the "move lane" hazard: no stance saves you.
    expect(KINDS.trainLow?.clearWith).toEqual([]);
    expect(KINDS.trainTall?.clearWith).toEqual([]);
  });

  it("only references patterns that exist", () => {
    for (const pattern of PATTERNS) {
      for (const row of pattern.obstacles) {
        for (const id of row) expect(KINDS[id], `${pattern.id} -> ${id}`).toBeDefined();
      }
    }
  });
});

describe("Spawner — fairness rules", () => {
  it("keeps the opening stretch empty, while coins may start earlier", () => {
    for (const row of simulate(7, 400)) {
      const floor = row.obstacles.length ? SPAWN_CONFIG.safeStartMeters : SPAWN_CONFIG.coinSafeStartMeters;
      expect(row.meters, row.pattern).toBeGreaterThanOrEqual(floor - 0.001);
    }
  });

  it("never builds a row without a survivable lane", () => {
    const rows = simulate(11, 2400, 18);
    expect(rows.length).toBeGreaterThan(40);
    for (const row of rows) {
      expect(
        Spawner.solvableLanes(row.obstacles, SPAWN_CONFIG.laneCount).length,
        row.pattern,
      ).toBeGreaterThan(0);
    }
  });

  it("gives a real breather between patterns and a readable combo inside one", () => {
    const spawner = new Spawner(5);
    // Only hazard rows carry the breather promise; coin strips interleave on purpose.
    const rows = ((): SpawnRow[] => {
      const out: SpawnRow[] = [];
      for (let m = 0; m < 3000; m += 2) out.push(...spawner.fillUntil(m, 20));
      return out.filter((r) => r.obstacles.length > 0);
    })();
    const gap = spawner.gapFor(20);
    let worstBetween = Infinity;
    let worstWithin = Infinity;
    for (let i = 1; i < rows.length; i++) {
      const delta = rows[i]!.meters - rows[i - 1]!.meters;
      if (rows[i]!.group === rows[i - 1]!.group) worstWithin = Math.min(worstWithin, delta);
      else worstBetween = Math.min(worstBetween, delta);
    }
    expect(worstBetween).toBeGreaterThanOrEqual(gap - 0.001);
    expect(worstBetween).toBeGreaterThanOrEqual(SPAWN_CONFIG.minGapMeters);
    // Inside a group the promise is "you get about half a second per row", so the spacing
    // grows with speed instead of staying a constant number of metres.
    expect(worstWithin).toBeGreaterThanOrEqual(8);
    expect(worstWithin).toBeGreaterThanOrEqual(gap * 0.45);
  });

  it("never lets a coin arrive at the same moment as a block", () => {
    const rows = simulate(3, 3000, 15);
    const hazards = rows.flatMap((r) => r.obstacles);
    const coins = rows.flatMap((r) => r.coins);
    expect(coins.length, "coins should exist").toBeGreaterThan(40);
    const clr = SPAWN_CONFIG.coinClearanceMeters;
    for (const coin of coins) {
      const overlap = hazards.find(
        (o) => coin.meters >= o.meters - clr && coin.meters <= o.meters + o.kind.lengthMeters + clr,
      );
      expect(overlap, `coin at ${coin.meters.toFixed(1)} lands on a ${overlap?.kind.id}`).toBeUndefined();
    }
  });

  it("keeps coins flowing between the hazards", () => {
    const rows = simulate(17, 3000, 15);
    const starts = rows.filter((r) => r.coins.length).map((r) => r.meters);
    expect(starts.length, "a coin strip every ~40 m over 3 km").toBeGreaterThan(60);
    // The longest coin-free stretch is the thing that would make the run feel empty.
    let worst = 0;
    let previous = SPAWN_CONFIG.coinSafeStartMeters;
    for (const at of starts) {
      worst = Math.max(worst, at - previous);
      previous = at;
    }
    expect(worst, "coins never stop for longer than a screen").toBeLessThan(70);
  });
});

describe("Spawner — determinism and difficulty", () => {
  it("produces exactly the same level from the same seed", () => {
    const fingerprint = (rows: SpawnRow[]) =>
      rows
        .map(
          (r) =>
            `${r.meters.toFixed(2)}:${r.obstacles.map((o) => `${o.kind.id}@${o.lane}`).join(",")}:${r.coins.length}`,
        )
        .join("|");
    expect(fingerprint(simulate(99))).toBe(fingerprint(simulate(99)));
    expect(fingerprint(simulate(98))).not.toBe(fingerprint(simulate(99)));
  });

  it("escalates the pattern mix with speed", () => {
    const spawner = new Spawner(1);
    expect(spawner.tierFor(9)).toBe(1);
    expect(spawner.tierFor(12)).toBe(2);
    expect(spawner.tierFor(15)).toBe(3);
    expect(spawner.tierFor(21)).toBe(4);
    expect(spawner.patternsFor(1).map((p) => p.id)).toEqual(["single"]);
    expect(spawner.patternsFor(4).map((p) => p.id)).toContain("double");
    // Every tier resolves to at least one pattern, so the generator can never starve.
    for (const speed of [9, 11, 13, 16, 21, 40]) {
      expect(spawner.patternsFor(spawner.tierFor(speed)).length).toBeGreaterThan(0);
    }
  });

  it("widens the gap as the runner gets faster", () => {
    const spawner = new Spawner(1);
    expect(spawner.gapFor(21)).toBeGreaterThan(spawner.gapFor(9));
  });
});
