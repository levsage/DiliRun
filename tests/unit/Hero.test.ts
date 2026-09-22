import { describe, expect, it } from "vitest";
import { Hero, HERO_CONFIG } from "../../src/game/entities/Hero";

const step = 1 / 60;

/** Run the state machine for `seconds`, one fixed step at a time. */
function run(hero: Hero, seconds: number, dt = step): void {
  for (let t = 0; t < seconds; t += dt) hero.step(dt);
}

describe("Hero — lanes", () => {
  it("starts in the middle lane and cannot walk off the track", () => {
    const hero = new Hero();
    expect(hero.lane).toBe(1);
    hero.move(-1);
    hero.move(-1);
    hero.move(-1);
    run(hero, 1);
    expect(hero.lane).toBe(0);
    expect(hero.laneTarget).toBe(0);
  });

  it("flips the collision lane at the midpoint of the visual slide", () => {
    const hero = new Hero();
    const stepsToMidpoint = Math.ceil((HERO_CONFIG.laneChangeSeconds / step) * 0.5);
    hero.move(1);
    expect(hero.lane).toBe(1); // not committed yet
    run(hero, step * (stepsToMidpoint - 1));
    expect(hero.lane).toBe(1);
    expect(hero.laneEased).toBeGreaterThan(1); // but the sprite is already leaning right
    hero.step(step);
    expect(hero.lane).toBe(2);
    run(hero, 0.5);
    expect(hero.laneEased).toBeCloseTo(2, 6);
  });

  it("reports every lane change to its listener", () => {
    const seen: [number, number][] = [];
    const hero = new Hero(HERO_CONFIG, { onLaneChange: (from, to) => seen.push([from, to]) });
    hero.move(-1);
    run(hero, 0.4);
    expect(seen).toEqual([[1, 0]]);
  });
});

describe("Hero — airtime", () => {
  it("traces a parabola: up, apex, back on the ground after exactly jumpSeconds", () => {
    const hero = new Hero();
    expect(hero.hop).toBe(0);
    expect(hero.jump()).toBe(true);
    run(hero, HERO_CONFIG.jumpSeconds / 2);
    expect(hero.hop).toBeGreaterThan(0.95); // near the apex
    expect(hero.heightMeters).toBeGreaterThan(HERO_CONFIG.jumpPeakMeters * 0.95);
    run(hero, HERO_CONFIG.jumpSeconds / 2 + 0.02);
    expect(hero.airborne).toBe(false);
    expect(hero.hop).toBe(0);
    expect(hero.spriteState).toBe("land"); // the impact frame, only after a real landing
    run(hero, 0.3);
    expect(hero.spriteState).toBe("run");
  });

  it("refuses a second jump in mid-air but allows one inside the coyote window", () => {
    const hero = new Hero();
    hero.jump();
    run(hero, 0.2);
    expect(hero.jump()).toBe(false);
    run(hero, HERO_CONFIG.jumpSeconds);
    expect(hero.jump()).toBe(true);
    run(hero, HERO_CONFIG.jumpSeconds);
    run(hero, HERO_CONFIG.coyoteSeconds * 0.5);
    expect(hero.jump()).toBe(true);
  });

  it("counts the airtime it spent off the ground", () => {
    let landed = 0;
    const hero = new Hero(HERO_CONFIG, { onLand: (air) => (landed = air) });
    hero.jump();
    run(hero, HERO_CONFIG.jumpSeconds + 0.05);
    expect(landed).toBeCloseTo(HERO_CONFIG.jumpSeconds, 1);
  });
});

describe("Hero — stances as answers to hazards", () => {
  it("grants `jump` only once the hop is real, so a mistimed tap still clips a crate", () => {
    const hero = new Hero();
    hero.jump();
    expect(hero.clears).toBeNull(); // frame 1: still on the way up, a low ceiling would take the head
    run(hero, 0.1);
    expect(hero.clears).toBe("jump");
    run(hero, HERO_CONFIG.jumpSeconds);
    expect(hero.clears).toBeNull();
  });

  it("grants `slide` while ducking and drops it the moment the slide ends", () => {
    const hero = new Hero();
    expect(hero.slide()).toBe(true);
    run(hero, 0.05);
    expect(hero.clears).toBe("slide");
    expect(hero.heightMeters).toBe(HERO_CONFIG.slideHeightMeters);
    run(hero, HERO_CONFIG.slideSeconds);
    expect(hero.clears).toBeNull();
  });

  it("lets a dive from the top of a jump turn into a roll", () => {
    const hero = new Hero();
    hero.jump();
    run(hero, 0.2);
    expect(hero.roll()).toBe(true);
    expect(hero.spriteState).toBe("roll");
    run(hero, 0.05);
    expect(hero.clears).toBe("roll");
    run(hero, HERO_CONFIG.rollSeconds + 0.02);
    expect(hero.clears).toBeNull();
  });

  it("does not show the landing frame at the start of a run", () => {
    const hero = new Hero();
    hero.reset();
    expect(hero.spriteState).toBe("run");
    hero.jump();
    run(hero, HERO_CONFIG.jumpSeconds + 0.02);
    expect(hero.spriteState).toBe("land");
  });

  it("stumbles after a crash, and the sheet knows it", () => {
    const hero = new Hero();
    hero.stumble(0.3);
    expect(hero.spriteState).toBe("stumble");
    run(hero, 0.35);
    expect(hero.spriteState).toBe("run");
  });

  it("reset() puts the runner back in the middle of the track on foot", () => {
    const hero = new Hero();
    hero.move(1);
    hero.jump();
    hero.stumble(1);
    run(hero, 0.1);
    hero.reset();
    expect(hero.lane).toBe(1);
    expect(hero.action).toBe("run");
    expect(hero.stumbleT).toBe(0);
    expect(hero.hop).toBe(0);
  });
});
