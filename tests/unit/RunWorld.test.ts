import { describe, expect, it } from "vitest";
import { RunWorld, WORLD_CONFIG, type RunEvent } from "../../src/game/systems/RunWorld";
import { ActionQueue, STEP, botAction, drive } from "./worldHarness";
import { Spawner } from "../../src/game/entities/Spawner";

const noInput = () => false;

function world(seed = 4242, take = noInput): RunWorld {
  const w = new RunWorld({ seed, take });
  w.start(seed);
  return w;
}

function run(w: RunWorld, seconds: number): void {
  for (let t = 0; t < seconds; t += STEP) w.step(STEP);
}

describe("RunWorld — the shape of a run", () => {
  it("does not move until the player starts it", () => {
    const w = new RunWorld({ take: noInput });
    run(w, 2);
    expect(w.phase).toBe("ready");
    expect(w.meters).toBe(0);
  });

  it("accelerates along the balance curve and stops at max speed", () => {
    // A life-generous config so the run outlives the acceleration test: the cap is a
    // property of the speed curve, not of dying.
    const w = new RunWorld({
      seed: 4242,
      take: noInput,
      world: { ...WORLD_CONFIG, lives: 9999, invulnerableSeconds: 600 },
    });
    w.start(4242);
    expect(w.speed).toBe(WORLD_CONFIG.startSpeed);
    run(w, 1);
    expect(w.speed).toBeGreaterThan(WORLD_CONFIG.startSpeed);
    run(w, 600);
    expect(w.speed).toBeCloseTo(WORLD_CONFIG.maxSpeed, 1);
    expect(w.phase).toBe("running");
  });

  it("fills the horizon with rows once the safe start is behind the player", () => {
    const w = world();
    expect(w.obstacles.length).toBe(0);
    run(w, 12); // ~110 m at 9 m/s
    expect(w.meters).toBeGreaterThan(WORLD_CONFIG.viewLengthMeters);
    expect(w.obstacles.length).toBeGreaterThan(0);
    expect(w.obstacles.every((o) => o.meters > -WORLD_CONFIG.cullBehindMeters)).toBe(true);
  });

  it("counts distance the world actually travelled, not the score's flattering version", () => {
    const w = world();
    run(w, 20);
    const view = w.view();
    expect(view.meters).toBe(Math.floor(w.meters));
    expect(view.snapshot.meters).toBe(view.meters);
    expect(view.snapshot.score).toBeGreaterThanOrEqual(view.meters); // multipliers and coins
  });
});

describe("RunWorld — crashes", () => {
  it("uses every life and then ends the run", () => {
    const events: RunEvent[] = [];
    const w = new RunWorld({ seed: 77, take: noInput, onEvent: (e) => events.push(e) });
    w.start(77);
    run(w, 90);
    expect(w.phase).toBe("over");
    expect(w.lives).toBe(0);
    expect(events.filter((e) => e.type === "crash")).toHaveLength(WORLD_CONFIG.lives);
    expect(w.result().crashes).toBe(WORLD_CONFIG.lives);
  });

  it("refuses to end the run on two hazards in the same beat", () => {
    const w = world(77);
    let crashed = 0;
    const before = w.lives;
    for (let t = 0; t < 90; t += STEP) {
      w.step(STEP);
      if (w.lives < before - crashed) {
        crashed = before - w.lives;
        // The invulnerability window must hold for its whole length.
        for (let i = 0; i < Math.floor(WORLD_CONFIG.invulnerableSeconds / STEP) - 2; i++) {
          w.step(STEP);
          expect(w.lives).toBe(before - crashed);
        }
        if (w.phase === "over") break;
      }
    }
    expect(crashed).toBeGreaterThanOrEqual(1);
  });

  it("stops the scroll for a beat on impact, then staggers", () => {
    const w = world(77);
    // Walk into the first hazard without answering it.
    let hitAt = -1;
    for (let t = 0; t < 60 && w.hitStop === 0; t += STEP) {
      if (hitAt < 0 && w.obstacles.some((o) => o.lane === w.hero.lane && o.meters < 2 && o.meters > 0.5)) {
        hitAt = t;
      }
      w.step(STEP);
    }
    expect(w.hitStop).toBeGreaterThan(0);
    const meters = w.meters;
    w.step(STEP);
    expect(w.meters).toBe(meters); // frozen during hit-stop
    run(w, WORLD_CONFIG.hitStopSeconds + 0.02);
    expect(w.phase).toBe("crashed");
    run(w, WORLD_CONFIG.crashStaggerSeconds + 0.05);
    expect(w.phase).toBe("running");
    expect(w.hero.spriteState).toBe("run");
    expect(hitAt).toBeGreaterThan(0);
  });

  it("eases to a halt after the run is over without scoring any more", () => {
    const w = world(77);
    run(w, 90);
    const snapshot = w.result();
    run(w, 3);
    expect(w.result()).toEqual(snapshot);
    expect(w.speed).toBe(0);
  });
});

describe("RunWorld — a played run", () => {
  it("lets a competent player survive a kilometre with nothing lost", () => {
    const queue = new ActionQueue();
    const w = new RunWorld({ seed: 4242, take: queue.take });
    w.start(4242);
    drive(w, queue, 200);
    expect(w.lastCrashLabel, `died on ${w.lastCrashLabel} after ${w.meters.toFixed(0)} m`).toBe("");
    expect(w.result().crashes).toBe(0);
    expect(w.meters).toBeGreaterThan(1000);
    expect(w.result().coins).toBeGreaterThan(10);
    expect(w.result().score).toBeGreaterThan(w.meters); // coins and combo must pay
  });

  it("rewards the close calls and pays the combo the coins build", () => {
    const queue = new ActionQueue();
    const w = new RunWorld({ seed: 90210, take: queue.take });
    w.start(90210);
    drive(w, queue, 120);
    // A bot that dodges early earns few close calls by design: the metric under test is
    // "does the rule fire at all in a live run", not the bot's nerve. The exact windows are
    // pinned in Collision.test.ts.
    expect(w.result().nearMisses).toBeGreaterThanOrEqual(1);
    // The live multiplier decays when coins dry up (that is the point of the window), so the
    // assertion is about the streak it reached and the score it left behind.
    expect(w.result().bestCombo).toBeGreaterThan(1);
    expect(w.result().score).toBeGreaterThan(w.result().meters);
  });

  it("is fully determined by seed and inputs", () => {
    const once = (): { meters: number; score: number; coins: number } => {
      const queue = new ActionQueue();
      const w = new RunWorld({ seed: 31337, take: queue.take });
      w.start(31337);
      for (let t = 0; t < 60; t += STEP) {
        queue.expire();
        queue.push(botAction(w));
        w.step(STEP);
      }
      const s = w.result();
      return { meters: s.meters, score: s.score, coins: s.coins };
    };
    expect(once()).toEqual(once());
  });

  it("keeps the generator's fairness promise inside the live world", () => {
    const queue = new ActionQueue();
    const w = new RunWorld({ seed: 5, take: queue.take });
    w.start(5);
    for (let t = 0; t < 60; t += STEP) {
      queue.expire();
      queue.push(botAction(w));
      w.step(STEP);
      const upcoming = w.obstacles.filter((o) => o.meters > 0 && o.meters < 12);
      if (upcoming.length) {
        expect(
          Spawner.solvableLanes(upcoming, 3).length,
          upcoming.map((o) => o.kind.id).join("+"),
        ).toBeGreaterThan(0);
      }
    }
  });

  it("gives up on request and hands the same run back to a new seed", () => {
    const w = world(11);
    run(w, 5);
    w.giveUp();
    expect(w.phase).toBe("over");
    expect(w.lives).toBe(0);
    const first = w.result();
    w.start(12);
    expect(w.phase).toBe("running");
    expect(w.invulnerable).toBe(0);
    expect(w.meters).toBe(0);
    expect(w.result().meters).toBe(0);
    expect(first.meters).toBeGreaterThan(0);
    expect(w.lives).toBe(WORLD_CONFIG.lives);
    expect(w.obstacles).toHaveLength(0);
  });
});
