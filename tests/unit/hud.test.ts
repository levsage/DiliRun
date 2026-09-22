// @vitest-environment jsdom
/**
 * The HUD widgets are the only place DiliRun touches the DOM for gameplay, so their state
 * handling — what gets written, what stays hidden, what is announced to a screen reader — is
 * worth a test even though nothing here paints.
 */
import { describe, expect, it, vi } from "vitest";
import { Lives } from "../../src/ui/hud/Lives";
import { RunSummary } from "../../src/ui/hud/RunSummary";
import { LeaderboardPanel, toRows, formatWhen } from "../../src/ui/hud/LeaderboardPanel";
import type { RunRecord } from "../../src/game/records";

const host = (): HTMLElement => {
  const el = document.createElement("div");
  document.body.replaceChildren(el);
  return el;
};

const record = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: "r1",
  at: Date.now(),
  mode: "solo",
  tags: [],
  score: 100,
  coins: 4,
  meters: 60,
  multiplier: 1.4,
  bestCombo: 3,
  nearMisses: 1,
  crashes: 1,
  ...over,
});

describe("Lives", () => {
  it("lights the pips it has and hollows the ones it lost", () => {
    const lives = new Lives({ total: 3 }).mount(host());
    expect(lives.element.querySelectorAll(".dili-lives__pip")).toHaveLength(3);
    lives.update(1);
    expect(lives.element.querySelectorAll(".dili-lives__pip.is-spent")).toHaveLength(2);
    lives.reset();
    expect(lives.element.querySelectorAll(".dili-lives__pip.is-spent")).toHaveLength(0);
  });

  it("clamps to the range and never shows negative pips", () => {
    const lives = new Lives({ total: 3 }).mount(host());
    lives.update(-4);
    expect(lives.element.querySelectorAll(".is-spent")).toHaveLength(3);
    lives.update(9);
    expect(lives.element.querySelectorAll(".is-spent")).toHaveLength(0);
  });

  it("is a status role so an assistive reader says the number out loud", () => {
    const lives = new Lives({ total: 3, label: "Lives" }).mount(host());
    lives.update(2);
    expect(lives.element.getAttribute("role")).toBe("status");
    expect(lives.element.getAttribute("aria-label")).toBe("Lives");
    expect(lives.element.getAttribute("aria-valuenow")).toBe("2");
  });
});

describe("RunSummary", () => {
  it("starts hidden and shows exactly the content it is given", () => {
    const summary = new RunSummary().mount(host());
    expect(summary.shown).toBe(false);
    summary.show({
      tone: "over",
      kicker: "Rank #2",
      title: "Run over",
      lines: [{ label: "Score", value: "1,240", emphasis: true }],
      primaryLabel: "Run again",
    });
    const el = summary.element;
    expect(summary.shown).toBe(true);
    expect(el.dataset.tone).toBe("over");
    expect(el.querySelector(".dili-summary__title")?.textContent).toBe("Run over");
    expect(el.querySelector(".dili-summary__line dd")?.textContent).toBe("1,240");
    expect(el.querySelector(".dili-summary__line")?.className).toContain("is-emphasis");
    expect((el.querySelector(".dili-summary__secondary") as HTMLButtonElement).hidden).toBe(true);
  });

  it("fires the primary handler from the button and from the veil, but not from the card", () => {
    const onPrimary = vi.fn();
    const summary = new RunSummary({ onPrimary }).mount(host());
    summary.show({ tone: "ready", title: "DiliRun", primaryLabel: "Tap to run" });
    summary.element.querySelector<HTMLButtonElement>(".dili-summary__primary")?.click();
    expect(onPrimary).toHaveBeenCalledTimes(1);

    const card = summary.element.querySelector<HTMLElement>(".dili-summary__card")!;
    // jsdom has no PointerEvent; the handler only looks at the type and the target.
    card.dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(onPrimary).toHaveBeenCalledTimes(1); // the card is not a button
    summary.element.dispatchEvent(new Event("pointerup", { bubbles: false }));
    expect(onPrimary).toHaveBeenCalledTimes(2); // the empty veil is
  });

  it("hides the optional blocks instead of leaving empty shells", () => {
    const summary = new RunSummary().mount(host());
    summary.show({ tone: "paused", title: "Paused", primaryLabel: "Resume" });
    expect((summary.element.querySelector(".dili-summary__kicker") as HTMLElement).hidden).toBe(true);
    expect((summary.element.querySelector(".dili-summary__lines") as HTMLElement).hidden).toBe(true);
    expect((summary.element.querySelector(".dili-summary__note") as HTMLElement).hidden).toBe(true);
    summary.hide();
    expect(summary.element.hidden).toBe(true);
    expect(summary.shown).toBe(false);
  });
});

describe("LeaderboardPanel", () => {
  it("marks the player's own row and keeps the ranking order", () => {
    const rows = toRows([record({ id: "a", score: 300 }), record({ id: "b", score: 100 })], "b");
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(rows[1]?.isSelf).toBe(true);
    const panel = new LeaderboardPanel({ title: "Runner Board" }).mount(host());
    panel.render(rows);
    const list = panel.element.querySelectorAll(".dili-board__row");
    expect(list).toHaveLength(2);
    expect(list[1]?.classList.contains("is-self")).toBe(true);
    expect(panel.element.textContent).toContain("Runner Board");
  });

  it("shows the empty state rather than a blank box", () => {
    const panel = new LeaderboardPanel().mount(host());
    panel.render([]);
    expect(panel.element.querySelectorAll(".dili-board__row")).toHaveLength(0);
    expect(panel.element.querySelector(".dili-board__empty")?.textContent?.length).toBeGreaterThan(2);
  });

  it("describes time in words a player can skim", () => {
    const now = new Date("2026-09-22T12:00:00Z").getTime();
    expect(formatWhen(now - 30_000, now)).toBe("just now");
    expect(formatWhen(now - 59_000, now)).toBe("just now");
    expect(formatWhen(now - 61_000, now)).toBe("1m ago"); // a minute means a full minute
    expect(formatWhen(now - 9 * 60_000, now)).toBe("9m ago");
    expect(formatWhen(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatWhen(now - 3 * 86_400_000, now)).toBe("3d ago");
    expect(formatWhen(now + 5_000, now)).toBe("just now"); // a clock in the future, from us
  });
});
