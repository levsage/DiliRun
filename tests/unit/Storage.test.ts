import { describe, expect, it } from "vitest";
import { MemoryDriver, Store } from "../../src/core/Storage";

describe("Store", () => {
  it("namespaces keys by prefix and version", () => {
    const driver = new MemoryDriver();
    const store = new Store({ prefix: "dilirun", version: 1, driver });
    store.write("leaderboard", [{ score: 10 }]);
    expect(driver.keys()).toEqual(["dilirun.v1.leaderboard"]);
    expect(store.read("leaderboard", [])).toEqual([{ score: 10 }]);
  });

  it("returns the fallback for missing and corrupt values, and drops the bad entry", () => {
    const driver = new MemoryDriver();
    const store = new Store({ driver });
    expect(store.read("nothing", 42)).toBe(42);
    driver.setItem("dilirun.v1.broken", "{not json");
    expect(store.read("broken", "fallback")).toBe("fallback");
    expect(driver.keys()).not.toContain("dilirun.v1.broken");
  });

  it("reports write failure instead of throwing when storage is full", () => {
    const exploding: MemoryDriver & { setItem(): void } = Object.assign(new MemoryDriver(), {
      setItem() {
        throw new Error("QuotaExceededError");
      },
    });
    const store = new Store({ driver: exploding });
    expect(store.write("coins.bank", 12)).toBe(false);
  });

  it("clears only its own namespace", () => {
    const driver = new MemoryDriver();
    driver.setItem("other.app.key", "1");
    const store = new Store({ driver });
    store.write("a", 1);
    store.write("b", 2);
    expect(store.clearNamespace()).toBe(2);
    expect(driver.keys()).toEqual(["other.app.key"]);
  });
});
