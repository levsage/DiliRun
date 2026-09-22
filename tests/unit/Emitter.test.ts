import { describe, expect, it, vi } from "vitest";
import { Emitter } from "../../src/core/Emitter";

interface Events extends Record<string, unknown> {
  "run:coin": { coins: number };
  ready: void;
}

describe("Emitter", () => {
  it("delivers payloads and unsubscribes", () => {
    const bus = new Emitter<Events>();
    const fn = vi.fn();
    const off = bus.on("run:coin", fn);
    bus.emit("run:coin", { coins: 3 });
    off();
    bus.emit("run:coin", { coins: 4 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ coins: 3 });
  });

  it("once() fires exactly once even when two events are emitted", () => {
    const bus = new Emitter<Events>();
    const fn = vi.fn();
    bus.once("ready", fn);
    bus.emit("ready", undefined);
    bus.emit("ready", undefined);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount("ready")).toBe(0);
  });

  it("applies an unsubscribe that happened during the same emit", () => {
    // Registration order matters: the remover runs first, so the later listener
    // must be skipped even though we iterate a snapshot of the set.
    const bus = new Emitter<Events>();
    const late = vi.fn();
    let offLate = (): void => {};
    bus.on("run:coin", () => offLate());
    offLate = bus.on("run:coin", late);
    expect(() => bus.emit("run:coin", { coins: 1 })).not.toThrow();
    expect(late).not.toHaveBeenCalled();
    expect(bus.listenerCount("run:coin")).toBe(1);
  });
});
