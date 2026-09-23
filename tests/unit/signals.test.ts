/**
 * The arrow promise.
 *
 * The glyph is the only place the game tells the player *in words* (well, in shape) what a hazard wants.
 * If it ever disagrees with `clearWith` — the data collision actually uses — the arrow becomes a lie
 * people die for, so the relationship is pinned here in both directions: the signal must follow the
 * answer, the answer must be readable from the signal, and the geometry must never be nonsense.
 */
import { describe, expect, it } from "vitest";
import { KINDS, PATTERNS, Spawner, type ClearKind, type ObstacleKind } from "../../src/game/entities/Spawner";
import { chevrons, isSane, plate, shapeFor, signalAlpha, spinArrow } from "../../src/render/Glyphs";

const ALL = Object.values(KINDS);

/** The one and only rule: a signal names a stance that clears every hazard of that kind. */
function answersFor(kind: ObstacleKind): ClearKind[] {
  return [...kind.clearWith].sort();
}

describe("hazard signals — the arrow must not lie", () => {
  it("derives every signal from the answer, never from taste", () => {
    for (const kind of ALL) {
      const answers = answersFor(kind);
      if (answers.length === 0) {
        expect(kind.signal, `${kind.id}: no stance clears it, so it must not wear an arrow`).toBe("none");
      }
      if (kind.signal === "jump") expect(answers, kind.id).toEqual(["jump"]);
      if (kind.signal === "duck") {
        expect(answers, kind.id).toEqual(expect.arrayContaining(["slide"]));
        for (const a of answers) expect(["slide", "roll"], kind.id).toContain(a);
      }
      if (kind.signal === "roll") expect(answers, kind.id).toEqual(["roll"]);
    }
    // A kind may never offer an answer with no shape to advertise it.
    for (const kind of ALL) {
      if (kind.clearWith.length > 0) {
        expect(kind.signal, `${kind.id} has an answer but no arrow`).not.toBe("none");
      }
    }
  });

  it("promises a move that actually works on a lone hazard of that kind", () => {
    for (const kind of ALL.filter((k) => k.signal !== "none")) {
      const obstacle = { kind, lane: 1, meters: 6, hit: false, scored: false, threatened: false };
      expect(
        Spawner.laneIsSolvable([obstacle], 1),
        `${kind.id} wears a ${kind.signal} arrow that no stance in its own lane answers`,
      ).toBe(true);
      // …and the row as a whole stays survivable, which is the spawner's other promise.
      expect(Spawner.solvableLanes([obstacle], 3).length).toBeGreaterThan(0);
    }
  });

  it("asks for nothing on the trains, whose answer is a lane change", () => {
    const trains = ALL.filter((k) => k.lanes > 1 && k.vertical === "ground");
    expect(trains.length).toBeGreaterThan(0);
    for (const kind of trains) expect(kind.signal, kind.id).toBe("none");
  });

  it("is spelled the same way by the code as by the data", () => {
    for (const kind of ALL) expect(Spawner.signalFor(kind), kind.id).toBe(kind.signal);
    expect(Spawner.signalFor({ clearWith: [] })).toBe("none");
    expect(Spawner.signalFor({ clearWith: ["jump"] })).toBe("jump");
    expect(Spawner.signalFor({ clearWith: ["slide", "roll"] })).toBe("duck");
    expect(Spawner.signalFor({ clearWith: ["roll"] })).toBe("roll");
    // A mixed answer (jump OR duck) has no single honest glyph, so it must advertise nothing.
    expect(Spawner.signalFor({ clearWith: ["jump", "slide"] })).toBe("none");
  });

  it("is only ever set on kinds that patterns actually use, or on purpose", () => {
    const used = new Set(PATTERNS.flatMap((p) => p.obstacles.flat()));
    for (const id of used) expect(KINDS[id], id).toBeDefined();
    expect(used.size).toBeGreaterThan(2);
  });
});

describe("glyph geometry", () => {
  it("maps the three actions to the three shapes and nothing else", () => {
    expect(shapeFor("jump")).toBe("up");
    expect(shapeFor("duck")).toBe("down");
    expect(shapeFor("roll")).toBe("spin");
    expect(shapeFor("none")).toBeNull();
    expect(shapeFor(undefined)).toBeNull();
  });

  it("points the chevrons the way the player has to go", () => {
    const up = chevrons(-1, 100, 100, 24, 2);
    const down = chevrons(1, 100, 100, 24, 2);
    expect(up.length).toBe(2);
    // Shape first: an up chevron is a ∧ (apex above the arms), a down one is a ∨.
    for (const [left, apex, right] of up) {
      expect(apex![1]).toBeLessThan(left![1]);
      expect(left![1]).toBe(right![1]);
    }
    for (const [left, apex, right] of down) {
      expect(apex![1]).toBeGreaterThan(left![1]);
      expect(left![1]).toBe(right![1]);
    }
    // Stacked along the direction of travel: the leading chevron of an up-pair is the higher one.
    expect(up[1]![1]![1]).toBeLessThan(up[0]![1]![1]);
    expect(down[1]![1]![1]).toBeGreaterThan(down[0]![1]![1]);
  });

  it("keeps every shape finite at every plausible sprite size", () => {
    for (const size of [6, 9, 14, 22, 30, 40, 48]) {
      for (const count of [2, 3]) {
        expect(isSane(chevrons(-1, 160, 90, size, count)), `up ${size}`).toBe(true);
        expect(isSane(chevrons(1, 160, 90, size, count)), `down ${size}`).toBe(true);
      }
      expect(isSane(spinArrow(160, 90, size)), `spin ${size}`).toBe(true);
      expect(isSane([plate(160, 90, size * 1.5, size * 1.25)]), `plate ${size}`).toBe(true);
    }
    // Degenerate inputs must still be drawable, since scale can approach zero at the horizon.
    expect(isSane(chevrons(-1, 0, 0, 0, 1))).toBe(true);
    expect(isSane(spinArrow(0, 0, 0))).toBe(true);
  });

  it("keeps the plate wrapped around the glyph it belongs to", () => {
    const box = plate(100, 100, 40, 30);
    const xs = box.map((p) => p[0]);
    const ys = box.map((p) => p[1]);
    expect(Math.min(...xs)).toBe(80);
    expect(Math.max(...xs)).toBe(120);
    expect(Math.min(...ys)).toBe(85);
    expect(Math.max(...ys)).toBe(115);
    expect(box.length).toBe(8);
  });

  it("fades in over the last stretch of runway and never goes out of range", () => {
    expect(signalAlpha(60)).toBe(0);
    expect(signalAlpha(26)).toBe(0);
    expect(signalAlpha(20)).toBeGreaterThan(0);
    expect(signalAlpha(12)).toBe(1);
    let previous = -1;
    for (let m = 40; m > -5; m -= 0.5) {
      const a = signalAlpha(m);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      expect(a).toBeGreaterThanOrEqual(previous); // nearer is never dimmer
      previous = a;
    }
  });
});
