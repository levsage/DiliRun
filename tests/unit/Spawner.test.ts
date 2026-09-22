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
  it("keeps the opening stretch empty", () => {
    for (const row of simulate(7, 400)) {
      expect(row.meters).toBeGreaterThanOrEqual(SPAWN_CONFIG.safeStartMeters - 0.001);
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
    const rows: SpawnRow[] = [];
    for (let m = 0; m < 3000; m += 2) rows.push(...spawner.fillUntil(m, 20));
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

  it("lays the coins through the lane you are allowed to be in", () => {
    for (const row of simulate(3, 2000, 15)) {
      if (!row.coins.length) continue;
      const solvable = Spawner.solvableLanes(row.obstacles, SPAWN_CONFIG.laneCount);
      for (const coin of row.coins) {
        const blockedByOwnLane = row.obstacles.some(
          (o) => o.lane === coin.lane && Math.abs(o.meters - coin.meters) < o.kind.lengthMeters * 0.8,
        );
        expect(blockedByOwnLane, `${row.pattern} coin sits inside a hazard`).toBe(false);
        expect(solvable, `${row.pattern} coin lures you into an unsurvivable lane`).toContain(coin.lane);
      }
    }
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
