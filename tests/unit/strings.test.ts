import { describe, expect, it } from "vitest";
import {
  availableLocales,
  FALLBACK_LOCALE,
  getLocale,
  keys,
  overrideString,
  setLocale,
  t,
} from "../../src/game/strings";
import raw from "../../src/game/data/strings.json";

describe("strings", () => {
  it("keeps every locale free of missing or empty values", () => {
    const bundle = raw as unknown as Record<string, Record<string, string>>;
    for (const locale of availableLocales()) {
      const table = bundle[locale] ?? {};
      for (const key of keys()) {
        const value = table[key] ?? "";
        expect(value, `${locale}.${key} is missing`).toBeTruthy();
        expect(value.trim(), `${locale}.${key} is blank`).not.toBe("");
      }
    }
  });

  it("keeps copy clean enough for a phone button", () => {
    const bundle = (raw as unknown as { en: Record<string, string> }).en;
    const offenders = Object.entries(bundle).filter(([, value]) => {
      return /<[a-z]/i.test(value) || /\s{2,}/.test(value) || /TODO|FIXME|lorem/i.test(value);
    });
    expect(offenders).toEqual([]);
    // Buttons and kickers live in a 16px pill: anything longer than this wraps badly.
    for (const [key, value] of Object.entries(bundle)) {
      if (!/\.(ready|again|resume|board|title)$/.test(key) || key.startsWith("hud.")) continue;
      if (value.includes("{{")) continue;
      expect(value.length, `${key} is ${value.length} chars: "${value}"`).toBeLessThan(22);
    }
  });

  it("interpolates tokens and leaves unknown ones visible instead of blank", () => {
    expect(t("over.rank", { rank: 4 })).toBe("Rank #4 on the Runner Board");
    expect(t("run.crash", { hazard: "Express" })).toContain("Express");
    expect(t("over.rank")).toContain("{{rank}}");
  });

  it("numbers are grouped so a long run reads correctly", () => {
    expect(t("over.outOfBoard", { score: 12480 })).toContain("12,480");
  });

  it("falls back to en per key, and refuses an unknown locale", () => {
    expect(getLocale()).toBe(FALLBACK_LOCALE);
    expect(setLocale("de")).toBe(false);
    expect(getLocale()).toBe(FALLBACK_LOCALE);
    expect(setLocale("en")).toBe(true);
  });

  it("supports a dev override and can undo it", () => {
    overrideString("hud.score", "POINTS");
    expect(t("hud.score")).toBe("POINTS");
    overrideString("hud.score", null);
    expect(t("hud.score")).toBe("Score");
  });

  it("returns the key in brackets when it does not exist, so typos are loud", () => {
    expect(t("nope.not.here")).toBe("[nope.not.here]");
  });

  it("carries the brand vocabulary the design asked for", () => {
    expect(t("currency.name")).toBe("Dlii Coins");
    expect(t("leaderboard.title")).toBe("Runner Board");
    expect(t("brand.city")).toBe("Dliicom City");
  });
});
