import { describe, expect, it, vi } from "vitest";
import { InputController, swipeAction } from "../../src/core/Input";

describe("swipeAction", () => {
  it("uses the dominant axis past the threshold", () => {
    expect(swipeAction(-60, 8)).toBe("left");
    expect(swipeAction(60, -8)).toBe("right");
    expect(swipeAction(4, -70)).toBe("jump");
    expect(swipeAction(4, 70)).toBe("slide");
  });

  it("ignores flicks shorter than the threshold", () => {
    expect(swipeAction(10, -6)).toBeNull();
    expect(swipeAction(0, 0)).toBeNull();
  });
});

describe("InputController", () => {
  it("buffers an action and consumes it once", () => {
    const input = new InputController({ bufferSeconds: 1 });
    input.swipe(0, -80);
    expect(input.pendingCount).toBe(1);
    expect(input.take("jump")).toBe(true);
    expect(input.take("jump")).toBe(false);
    expect(input.pendingCount).toBe(0);
  });

  it("drops buffered actions once they expire", () => {
    let clock = 1000;
    const input = new InputController({ bufferSeconds: 0.05, now: () => clock });
    input.swipe(-80, 0);
    expect(input.take("left")).toBe(true); // still inside the window

    clock = 1000;
    input.swipe(-80, 0);
    clock = 1000 + 60; // 60ms later: past the 50ms window
    expect(input.take("left")).toBe(false);
    expect(input.pendingCount).toBe(1); // a failed take leaves the entry alone
    expect(input.prune()).toBe(1); // ...and prune sweeps it
  });

  it("prune() clears everything that went stale without being consumed", () => {
    let clock = 0;
    const input = new InputController({ bufferSeconds: 0.1, now: () => clock });
    input.swipe(-80, 0);
    input.swipe(0, -80);
    expect(input.pendingCount).toBe(2);
    clock = 150;
    expect(input.prune()).toBe(2);
    expect(input.pendingCount).toBe(0);
  });

  it("notifies listeners so the pause key can reach the loop", () => {
    const input = new InputController();
    const spy = vi.fn();
    input.onChange = spy;
    const target = new EventTarget();
    input.attach(target);
    target.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    expect(spy).toHaveBeenCalledWith("pause");
    expect(input.held.size).toBe(0); // pause is not a held action
    input.detach();
  });

  it("holds movement keys while pressed", () => {
    const input = new InputController();
    const target = new EventTarget();
    input.attach(target);
    target.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
    expect(input.held.has("right")).toBe(true);
    target.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowRight" }));
    expect(input.held.has("right")).toBe(false);
    input.detach();
  });
});
