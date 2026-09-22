import { describe, expect, it } from "vitest";
import { heroClears, isThreat, overlapsZ, resolveContacts } from "../../src/game/systems/Collision";
import { KINDS, type Coin, type Obstacle } from "../../src/game/entities/Spawner";
import { Hero } from "../../src/game/entities/Hero";

const CFG = {
  heroDepthMeters: 0.7,
  coinWindowMeters: 0.85,
  coinHeightWindow: 0.75,
  nearMissWindowMeters: 3.2,
};

function obstacle(
  id: keyof typeof KINDS,
  lane: number,
  meters: number,
  over: Partial<Obstacle> = {},
): Obstacle {
  return { kind: KINDS[id]!, lane, meters, hit: false, scored: false, threatened: false, ...over };
}

function coin(lane: number, meters: number, height = 0.55): Coin {
  return { lane, meters, height, taken: false };
}

describe("isThreat", () => {
  it("is true while any part of the body is still ahead of the feet line", () => {
    const train = obstacle("trainLow", 1, -0.5); // nose behind us, 5.5 m of flatbed to go
    expect(isThreat(train, 12)).toBe(true);
    expect(isThreat(obstacle("trainLow", 1, -6.2), 12)).toBe(false);
    expect(isThreat(obstacle("barrierLow", 1, 13), 12)).toBe(false);
  });
});

describe("overlapsZ", () => {
  it("treats the hero as a body with depth, not a point", () => {
    expect(overlapsZ(0.4, 1, 0.7)).toBe(true);
    expect(overlapsZ(0.8, 1, 0.7)).toBe(false); // just out of reach
    expect(overlapsZ(-0.5, 1, 0.7)).toBe(true); // straddling the feet line
    expect(overlapsZ(-0.5, 0.4, 0.7)).toBe(false); // fully behind
  });

  it("keeps a long train dangerous for its whole length", () => {
    const length = KINDS.trainLow!.lengthMeters; // 6 m of flatbed
    expect(overlapsZ(0.5, length, 0.7)).toBe(true); // nose is level with you
    expect(overlapsZ(-5.5, length, 0.7)).toBe(true); // ...and still is six metres later
    expect(overlapsZ(1.1, length, 0.7)).toBe(false); // not yet reached
    expect(overlapsZ(-length - 0.2, length, 0.7)).toBe(false); // finally behind you
  });
});

describe("heroClears", () => {
  it("matches a stance against the hazard's stated answer", () => {
    const hero = new Hero();
    expect(heroClears(hero, obstacle("barrierLow", 0, 0.3))).toBe(false); // standing into a crate
    hero.jump();
    hero.step(1 / 60);
    hero.step(1 / 60);
    hero.step(1 / 60);
    expect(heroClears(hero, obstacle("barrierLow", 0, 0.3))).toBe(true);
    expect(heroClears(hero, obstacle("barrierHigh", 0, 0.3))).toBe(false); // jumping into a beam fails
    expect(heroClears(hero, obstacle("trainLow", 0, 0.3))).toBe(false); // nothing beats a train
  });

  it("credits a slide for the overhead gantry that spans all three lanes", () => {
    const hero = new Hero();
    hero.slide();
    for (let i = 0; i < 4; i++) hero.step(1 / 60);
    expect(heroClears(hero, obstacle("beamRow", 2, 0.3))).toBe(true);
  });
});

const coinContacts = (list: ReturnType<typeof resolveContacts>) =>
  list.flatMap((c) => (c.type === "coin" ? [c.coin] : []));

describe("resolveContacts", () => {
  it("hits once per hazard, in the same lane only", () => {
    const hero = new Hero();
    const blockers = [obstacle("barrierLow", 1, 0.3), obstacle("barrierLow", 0, 0.3)];
    const first = resolveContacts(hero, blockers, [], CFG);
    expect(first.map((c) => c.type)).toEqual(["hit"]);
    expect(blockers[0]!.hit).toBe(true);
    expect(blockers[1]!.hit).toBe(false);
    expect(resolveContacts(hero, blockers, [], CFG)).toHaveLength(0); // no double crash
  });

  it("pays a near miss for clearing a hazard in your own lane", () => {
    const hero = new Hero();
    hero.jump();
    for (let i = 0; i < 6; i++) hero.step(1 / 60);
    const crate = obstacle("barrierLow", 1, 0.3);
    const contacts = resolveContacts(hero, [crate], [], CFG);
    expect(contacts.map((c) => c.type)).toEqual(["nearMiss"]);
    expect(crate.scored).toBe(true);
    expect(crate.threatened).toBe(true);
  });

  it("pays a swerve out of the way once the hazard has been left behind", () => {
    const hero = new Hero();
    // A train in lane 1 that we were aiming at, now that its whole body has passed.
    const train = obstacle("trainLow", 1, -6.4, { threatened: true });
    hero.lane = 2;
    const contacts = resolveContacts(hero, [train], [], CFG);
    expect(contacts.map((c) => c.type)).toEqual(["nearMiss"]);
    expect(train.scored).toBe(true);
  });

  it("does not pay for scenery you were never in danger from", () => {
    const hero = new Hero();
    const distant = obstacle("trainTall", 0, 20);
    const passed = obstacle("trainTall", 0, -11);
    expect(resolveContacts(hero, [distant, passed], [], CFG)).toHaveLength(0);
  });

  it("collects a coin in lane, at height, and only once", () => {
    const hero = new Hero();
    const low = coin(1, 0.2);
    const high = coin(1, 0.2, 1.4);
    const far = coin(0, 5);
    const coins = [low, high, far];
    expect(coinContacts(resolveContacts(hero, [], coins, CFG))).toEqual([low]);
    expect(low.taken).toBe(true);
    expect(resolveContacts(hero, [], coins, CFG)).toHaveLength(0);

    hero.jump();
    for (let i = 0; i < 10; i++) hero.step(1 / 60);
    expect(hero.heightMeters).toBeGreaterThan(1.2);
    expect(coinContacts(resolveContacts(hero, [], coins, CFG))).toEqual([high]);
  });

  it("ignores a coin at jump height while you are on the ground", () => {
    const hero = new Hero();
    const coins = [coin(1, 0, 1.45)];
    expect(resolveContacts(hero, [], coins, CFG)).toHaveLength(0);
  });
});
