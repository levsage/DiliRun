// @vitest-environment jsdom
/**
 * The home stage: the card the run starts and ends on.
 *
 * Three things get checked because they are the three that would silently break a player: the name
 * round-trips through storage and lands on the board, the panel never leaks a tap or a keystroke into
 * the game's input controller (a language button that starts a run is worse than no button), and every
 * word on it is a label the shell passed in — so switching locale changes the card, not the layout.
 */
import { describe, expect, it, vi } from "vitest";
import { HomePanel, type HomeHandlers, type HomeLabels } from "../../src/ui/hud/HomePanel";
import { LeaderboardPanel, toRows } from "../../src/ui/hud/LeaderboardPanel";
import { InputController } from "../../src/core/Input";
import { MemoryDriver, Store } from "../../src/core/Storage";
import { Profile, sanitizeName } from "../../src/game/profile";
import type { RunRecord } from "../../src/game/records";

const LABELS: HomeLabels = {
  kicker: "Dliicom City",
  title: "DiliRun",
  tagline: "Run Dliicom City",
  play: "Run",
  nameLabel: "Runner name",
  nameSave: "Save",
  nameHint: "Shown on the Runner Board",
  best: "Best score",
  distance: "Best metres",
  runs: "Runs",
  bank: "Coin bank",
  language: "বাংলা",
  reset: "Clear board",
  resetSure: "Tap again",
  controls: "Swipe up to jump",
  saved: "Name saved",
};

const host = (): HTMLElement => {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
};

const mountPanel = (handlers: HomeHandlers = {}) => {
  const panel = new HomePanel(LABELS, handlers).mount(host());
  panel.show();
  return panel;
};

describe("Profile — the name on the board", () => {
  const store = () => new Store({ driver: new MemoryDriver(), prefix: "profile-test", version: 1 });

  it("trims, flattens and caps what the field accepts", () => {
    expect(sanitizeName("  Rafi   Islam \n")).toBe("Rafi Islam");
    expect(sanitizeName("a".repeat(40))).toHaveLength(16);
    expect(sanitizeName("বাংলা জন্তি")).toBe("বাংলা জন্তি");
    expect(sanitizeName("🚀 runner")).toBe("🚀 runner");
    expect(sanitizeName("   ")).toBe("");
    expect(sanitizeName("\u0301\u0302")).toBe("");
  });

  it("keeps a name across stores and lets a blank one stick", () => {
    const s = store();
    const profile = new Profile(s);
    expect(profile.name).toBe("");
    profile.setName("  Sadia  ");
    expect(profile.name).toBe("Sadia");
    expect(new Profile(s).name).toBe("Sadia");
    // Clearing is a choice, not a missing value: the board then shows the fallback, not a ghost.
    profile.setName("");
    expect(profile.name).toBe("");
    expect(s.read("player.name", "gone")).toBe("");
  });

  it("remembers a language separately from a run record", () => {
    const s = store();
    const profile = new Profile(s);
    expect(profile.locale).toBeNull();
    profile.setLocale("bn");
    expect(new Profile(s).locale).toBe("bn");
    profile.setLocale(null);
    expect(new Profile(s).locale).toBeNull();
  });
});

describe("HomePanel", () => {
  it("shows the words it was given, in the places they belong", () => {
    const panel = mountPanel();
    const root = panel.element;
    expect(root.querySelector(".dili-home__title")?.textContent).toBe("DiliRun");
    expect(root.querySelector(".dili-home__kicker")?.textContent).toBe("Dliicom City");
    expect(root.querySelector(".dili-home__play")?.textContent).toBe("Run");
    const captions = [...root.querySelectorAll(".dili-home__stat dt")].map((n) => n.textContent);
    expect(captions).toEqual(["Best score", "Best metres", "Runs", "Coin bank"]);
    panel.setStats({ best: "12,480", distance: "940", runs: "7", bank: "310" });
    expect(root.querySelector(".js-best")?.textContent).toBe("12,480");
    expect(root.querySelector(".js-bank")?.textContent).toBe("310");
    panel.dispose();
  });

  it("starts a run from the button and hands the typed name to the shell", () => {
    const onPlay = vi.fn();
    const onName = vi.fn();
    const panel = mountPanel({ onPlay, onName });
    (panel.element.querySelector(".dili-home__play") as HTMLButtonElement).click();
    expect(onPlay).toHaveBeenCalledTimes(1);

    panel.name = "  Nusrat ";
    (panel.element.querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    expect(onName).toHaveBeenCalledWith("  Nusrat ");
    expect((panel.element.querySelector(".dili-home__saved") as HTMLElement | null)?.hidden).toBe(false);
    panel.dispose();
  });

  it("asks twice before clearing the board, and forgets if you wait too long", () => {
    vi.useFakeTimers();
    try {
      const onReset = vi.fn();
      const panel = mountPanel({ onReset });
      const btn = panel.element.querySelector(".dili-home__reset") as HTMLButtonElement;
      btn.click();
      expect(onReset).not.toHaveBeenCalled();
      expect(btn.textContent).toBe("Tap again");
      expect(btn.classList.contains("is-armed")).toBe(true);
      vi.advanceTimersByTime(4100);
      expect(btn.textContent).toBe("Clear board");
      btn.click();
      expect(onReset).not.toHaveBeenCalled(); // a stale arm must never wipe the board
      btn.click();
      expect(onReset).toHaveBeenCalledTimes(1);
      panel.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("relabels in place when the locale changes", () => {
    const panel = mountPanel();
    panel.setLabels({ play: "দৌড়ান", language: "English", best: "সেরা স্কোর" });
    expect(panel.element.querySelector(".dili-home__play")?.textContent).toBe("দৌড়ান");
    expect(panel.element.querySelector(".dili-home__lang")?.textContent).toBe("English");
    expect([...panel.element.querySelectorAll(".dili-home__stat dt")][0]?.textContent).toBe("সেরা স্কোর");
    panel.dispose();
  });

  it("hides itself and drops focus when the run starts", () => {
    const panel = mountPanel();
    panel.focusName();
    expect(panel.isTyping).toBe(true);
    panel.hide();
    expect(panel.element.hidden).toBe(true);
    expect(panel.isTyping).toBe(false);
    panel.show();
    expect(panel.element.hidden).toBe(false);
    panel.dispose();
  });
});

describe("the home card and the game's input", () => {
  it("does not turn a tap on a control into a jump", () => {
    const input = new InputController({ target: window });
    const seen: string[] = [];
    input.onChange = (action) => seen.push(action);
    const panel = mountPanel({ onPlay: () => seen.push("play") });
    const button = panel.element.querySelector(".dili-home__play") as HTMLButtonElement;

    // jsdom has no PointerEvent, so the shape the controller reads is built by hand.
    for (const [type, target] of [
      ["pointerdown", button],
      ["pointerup", window],
    ] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
      Object.assign(event, { clientX: 40, clientY: 40, pointerId: 1 });
      target.dispatchEvent(event);
    }
    expect(seen).toEqual([]); // no jump; the button's own click is what acts

    button.click();
    expect(seen).toEqual(["play"]);
    panel.dispose();
    input.detach();
  });

  it("lets a name be typed without the hero jumping", () => {
    const input = new InputController({ target: window });
    const seen: string[] = [];
    input.onChange = (action) => seen.push(action);
    const panel = mountPanel();
    const field = panel.element.querySelector(".dili-home__name-input") as HTMLInputElement;
    field.focus();
    field.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }));
    field.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowUp", bubbles: true, cancelable: true }));
    expect(seen).toEqual([]);
    // The same keys on the canvas are still the game's.
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }));
    expect(seen).toEqual(["jump"]);
    panel.dispose();
    input.detach();
  });
});

describe("the board shows who ran", () => {
  const record = (over: Partial<RunRecord>): RunRecord => ({
    id: "a",
    at: Date.now(),
    mode: "solo",
    score: 100,
    coins: 3,
    meters: 200,
    multiplier: 1,
    bestCombo: 2,
    nearMisses: 0,
    crashes: 0,
    ...over,
  });

  it("credits a row to its runner, and to the fallback when there is no name", () => {
    const panel = new LeaderboardPanel({ unnamed: "Runner", you: "You" }).mount(host());
    panel.render(
      toRows([record({ id: "a", name: "Rafi" }), record({ id: "b" }), record({ id: "c", name: "  " })], "b"),
    );
    const names = [...panel.element.querySelectorAll(".dili-board__name")].map((n) =>
      (n.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    // Row b is the highlight: no name of its own, so the fallback and the "You" chip share it.
    expect(names).toEqual(["Rafi", "Runner You", "Runner"]);
    const self = [...panel.element.querySelectorAll(".dili-board__row")].find((r) =>
      r.classList.contains("is-self"),
    );
    expect(self?.querySelector(".dili-board__you")?.textContent).toBe("You");
  });

  it("relabels the whole board, including the rows, when the locale changes", () => {
    const panel = new LeaderboardPanel({ title: "Runner Board", empty: "No runs yet" }).mount(host());
    panel.render(toRows([record({ id: "a", name: "Rafi" })], null));
    panel.setLabels({ empty: "এখনো কোনো রান নেই", unnamed: "দৌড়ানো", title: "রানার বোর্ড" });
    expect(panel.element.querySelector(".dili-board__title")?.textContent).toBe("রানার বোর্ড");
    panel.render([]);
    expect(panel.element.querySelector(".dili-board__empty")?.textContent).toBe("এখনো কোনো রান নেই");
    expect((panel.element.querySelector(".dili-board__empty") as HTMLElement | null)?.hidden).toBe(false);
  });
});
