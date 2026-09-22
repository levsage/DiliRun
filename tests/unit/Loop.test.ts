import { describe, expect, it, vi } from "vitest";
import { Loop, type LoopOptions } from "../../src/core/Loop";

function makeLoop(options?: LoopOptions) {
  const updates: number[] = [];
  const renders: number[] = [];
  const loop = new Loop(
    {
      update: (dt) => void updates.push(dt),
      render: (alpha) => void renders.push(alpha),
    },
    options,
  );
  return { loop, updates, renders };
}

describe("Loop", () => {
  it("runs a fixed number of simulation steps per second regardless of frame rate", () => {
    const { loop, updates } = makeLoop();
    loop.tick(0);
    loop.tick(1000 / 120); // 120 fps frame: half a step, no update yet
    expect(updates.length).toBe(0);
    loop.tick(2 * (1000 / 120));
    expect(updates.length).toBe(1);
    expect(updates[0]).toBeCloseTo(1 / 60, 6);
  });

  it("catches up at most maxSubSteps frames to avoid a spiral of death", () => {
    const { loop, updates } = makeLoop({ maxSubSteps: 3 });
    loop.tick(0);
    loop.tick(10_000); // tab was hidden for ten seconds
    expect(updates.length).toBe(3);
  });

  it("freezes the simulation while paused, without losing the clock", () => {
    const { loop, updates, renders } = makeLoop();
    loop.tick(0);
    const rendersBefore = renders.length;
    loop.paused = true;
    loop.tick(1000);
    expect(updates.length).toBe(0);
    expect(renders.length).toBe(rendersBefore); // nothing drawn while paused
    loop.paused = false;
    loop.tick(1016); // one normal frame after resuming
    // The second spent paused must not come back as a burst of catch-up steps.
    expect(updates.length).toBeLessThanOrEqual(1);
  });

  it("reports time and stops requesting frames on stop()", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1);
    const cancel = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    const { loop } = makeLoop();
    loop.start();
    expect(loop.running).toBe(true);
    expect(raf).toHaveBeenCalled();
    loop.stop();
    expect(loop.running).toBe(false);
    expect(cancel).toHaveBeenCalled();
    raf.mockRestore();
    cancel.mockRestore();
  });
});
