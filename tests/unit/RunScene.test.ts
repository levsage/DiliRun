/**
 * The render path, without a browser.
 *
 * `RunScene.render()` only ever calls a dozen Canvas2D methods, so a recording stub proves the
 * important things for free: no exceptions, no NaN geometry, the sprite states the scene asks for
 * actually exist on the baked sheet, and the painter's list stays bounded. A real pixel test
 * belongs in the e2e pass (docs/ROADMAP.md M6); this is the regression net that stops a
 * "works in the sim, crashes on the canvas" commit from reaching beta.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RunScene } from "../../src/app/RunScene";
import { RunWorld } from "../../src/game/systems/RunWorld";
import type { Stage } from "../../src/render/Stage";
import type { SheetManifest } from "../../src/render/SpriteAnimator";
import { PLATE_COLOUR } from "../../src/render/Glyphs";

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), "public/assets/sprites/dilirun-hero-sheet.json"), "utf8"),
) as SheetManifest;

interface DrawCall {
  name: string;
  args: unknown[];
}

/** A CanvasRenderingContext2D that records calls and never touches pixels. */
function recordingCtx(calls: DrawCall[], bad: string[]) {
  const target: Record<string, unknown> = {
    canvas: { width: 480, height: 800 },
    createLinearGradient: () => ({
      addColorStop: (stop: number, colour: string) => {
        if (!Number.isFinite(stop)) bad.push(`gradient stop ${stop}`);
        if (typeof colour !== "string") bad.push(`gradient colour ${String(colour)}`);
      },
    }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    globalAlpha: 1,
    lineWidth: 1,
    font: "",
    textAlign: "left",
  };
  return new Proxy(target, {
    get(obj, key: string) {
      if (key in obj) return obj[key];
      return (...args: unknown[]) => {
        calls.push({ name: key, args });
        for (const a of args) {
          if (typeof a === "number" && !Number.isFinite(a)) bad.push(`${key}(${args.join(",")})`);
        }
        return undefined;
      };
    },
    set(obj, key: string, value: unknown) {
      if (typeof value === "number" && !Number.isFinite(value)) bad.push(`${key}=${value}`);
      calls.push({ name: `set:${key}`, args: [value] });
      obj[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function makeScene(seed = 4242) {
  const calls: DrawCall[] = [];
  const bad: string[] = [];
  const ctx = recordingCtx(calls, bad);
  const stage = {
    ctx,
    drawSpriteCell: vi.fn(),
    drawShadow: vi.fn(),
  } as unknown as Stage;
  const image = { width: 3072, height: 2688 } as unknown as HTMLImageElement;
  const world = new RunWorld({ seed, take: () => false });
  const scene = new RunScene({ stage, world, hero: { image, manifest } });
  return { scene, world, calls, bad, stage };
}

describe("RunScene — the canvas contract", () => {
  it("asks the animator only for states the baked sheet actually has", () => {
    const { scene, world } = makeScene(99);
    world.start(99);
    const requested = new Set<string>();
    for (let i = 0; i < 3600; i++) {
      if (i === 900) world.hero.jump();
      if (i === 1200) world.hero.slide();
      if (i === 1500) world.hero.move(1);
      scene.update(1 / 60);
      requested.add(scene.heroState);
    }
    for (const state of requested) {
      expect(manifest.states[state], `sheet is missing "${state}"`).toBeDefined();
    }
    // The interesting ones must be reachable, or the test above is vacuous.
    expect([...requested]).toEqual(expect.arrayContaining(["run", "jump"]));
  });

  it("paints a whole run without a single NaN or undefined reaching the context", () => {
    const { scene, world, calls, bad } = makeScene(4242);
    world.start(4242);
    for (let i = 0; i < 5400 && world.phase !== "over"; i++) {
      if (i % 90 === 0) world.hero.jump();
      if (i % 140 === 0) world.hero.slide();
      if (i % 60 === 0) world.hero.move(i % 120 === 0 ? 1 : -1);
      scene.update(1 / 60);
      scene.render();
    }
    expect(bad, bad.slice(0, 3).join("; ")).toEqual([]);
    expect(calls.length).toBeGreaterThan(200);
    expect(world.phase).toBe("over"); // it really did play a whole run
  });

  it("only ever has the horizon in front of the camera, so the loop stays bounded", () => {
    const { scene, world } = makeScene(7);
    world.start(7);
    let peak = 0;
    for (let i = 0; i < 5400; i++) {
      scene.update(1 / 60);
      peak = Math.max(peak, world.obstacles.length + world.coins.length);
      if (world.phase === "over") break;
    }
    expect(peak, "entity list grew without bound").toBeGreaterThan(0);
    expect(peak).toBeLessThan(90);
    // Everything still in the list is reachable by the projection: no ghost entities behind us.
    for (const o of world.obstacles) expect(o.meters).toBeGreaterThan(-world.viewLength);
  });

  it("paints the action arrow on a hazard that has one", () => {
    const { scene, world, calls } = makeScene(31);
    world.start(31);
    let painted = 0;
    for (let i = 0; i < 2400 && painted === 0; i++) {
      scene.update(1 / 60);
      const signalled = world.obstacles.some(
        (o) => o.meters > 2 && o.meters < 20 && o.kind.signal !== "none",
      );
      if (!signalled) continue;
      const from = calls.length;
      scene.render();
      // The plate colour is only ever set by paintSignal, so this counts glyphs — not scenery.
      painted = calls
        .slice(from)
        .filter((c) => c.name === "set:fillStyle" && c.args[0] === PLATE_COLOUR).length;
    }
    expect(painted, "no glyph plate was painted for a hazard that asks for one").toBeGreaterThan(0);
  });

  it("shows the celebration only when the shell says the record fell", () => {
    const { scene, world } = makeScene(21);
    world.start(21);
    world.giveUp();
    scene.update(1 / 60);
    expect(scene.heroState).toBe("stumble");
    scene.setCelebration(true);
    scene.update(1 / 60);
    expect(scene.heroState).toBe("victory");
  });

  it("idles on the menu and runs in the world", () => {
    const { scene, world } = makeScene(3);
    for (let i = 0; i < 30; i++) scene.update(1 / 60);
    expect(scene.heroState).toBe("idle");
    world.start(3);
    scene.update(1 / 60);
    expect(scene.heroState).toBe("run");
  });
});
