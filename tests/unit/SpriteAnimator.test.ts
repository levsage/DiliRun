import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { frameRect, resolveState, SpriteAnimator, type SheetManifest } from "../../src/render/SpriteAnimator";

/**
 * The real manifest emitted by tools/asset-pipeline is parsed here, so a rig or
 * packing change that would draw outside the sheet fails the test suite instead of
 * showing up as corrupted sprites in the browser.
 */
// Vitest runs from the repo root, and `import.meta.url` is not a file: URL under
// jsdom, so resolve the artefact from cwd.
const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), "public/assets/sprites/dilirun-hero-sheet.json"), "utf8"),
) as SheetManifest;

describe("frameRect", () => {
  it("maps an index to a row-major cell", () => {
    expect(frameRect(0, { cell: 100, columns: 8 })).toEqual({ sx: 0, sy: 0, sw: 100, sh: 100 });
    expect(frameRect(9, { cell: 100, columns: 8 })).toEqual({ sx: 100, sy: 100, sw: 100, sh: 100 });
  });
});

describe("baked hero sheet", () => {
  it("keeps every state inside the image bounds", () => {
    for (const [name, spec] of Object.entries(manifest.states)) {
      const last = spec.from + spec.count - 1;
      const rect = frameRect(last, manifest);
      expect(rect.sx + rect.sw, `${name} right edge`).toBeLessThanOrEqual(manifest.columns * manifest.cell);
      expect(rect.sy + rect.sh, `${name} bottom edge`).toBeLessThanOrEqual(manifest.rows * manifest.cell);
      expect(spec.count, name).toBeGreaterThan(0);
    }
    const totalFrames = Object.values(manifest.states).reduce((sum, s) => sum + s.count, 0);
    expect(totalFrames).toBe(manifest.frameCount);
    expect(manifest.rows * manifest.columns).toBeGreaterThanOrEqual(manifest.frameCount);
  });

  it("resolves aliases to a real state and frame", () => {
    for (const [alias, target] of Object.entries(manifest.aliases)) {
      const found = resolveState(manifest, alias);
      expect(found, alias).not.toBeNull();
      expect(found?.state).toBe(target.state);
      expect(target.frame).toBeLessThan(manifest.states[target.state]!.count);
    }
  });

  it("exposes the anchor the renderer uses to place the feet", () => {
    expect(manifest.anchor.x).toBeGreaterThan(0.4);
    expect(manifest.anchor.y).toBeGreaterThan(0.8);
    expect(manifest.anchor.y).toBeLessThanOrEqual(1);
  });
});

describe("SpriteAnimator", () => {
  it("loops a cycling state and clamps a one-shot to its hold frame", () => {
    const animator = new SpriteAnimator(manifest, "run");
    const run = manifest.states.run!;
    const step = 1 / run.fps;
    const first = animator.frameIndex();
    for (let i = 0; i < run.count; i++) animator.advance(step);
    expect(animator.frameIndex()).toBe(first); // wrapped
    expect(animator.state).toBe("run");

    animator.play("jump");
    const jump = manifest.states.jump!;
    for (let i = 0; i < jump.count + 4; i++) animator.advance(step);
    expect(animator.finished).toBe(true);
    const held = jump.from + (jump.hold ?? jump.count - 1);
    expect(animator.frameIndex()).toBe(held);
    expect(animator.progress()).toBe(1);
  });

  it("slows playback below 1x speed (run cycle tied to run velocity)", () => {
    const fps = manifest.states.run!.fps;
    const slow = new SpriteAnimator(manifest, "run");
    const fast = new SpriteAnimator(manifest, "run");
    slow.speed = 0.5;
    // Two authored frames of wall-clock time: the fast cycle is 2 frames along,
    // the half-speed cycle only 1.
    for (let i = 0; i < 2; i++) {
      slow.advance(1 / fps);
      fast.advance(1 / fps);
    }
    expect(fast.frameIndex() - manifest.states.run!.from).toBe(2);
    expect(slow.frameIndex() - manifest.states.run!.from).toBe(1);
    expect(slow.progress()).toBeCloseTo(fast.progress() / 2, 5);
  });

  it("throws for an unknown state instead of silently drawing frame 0", () => {
    expect(() => new SpriteAnimator(manifest, "cartwheel")).toThrow(/unknown animation state/);
  });
});
