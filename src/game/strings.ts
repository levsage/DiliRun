/**
 * The words, in one place.
 *
 * `data/strings.json` is the only place a player-visible string exists. The HUD components in
 * `src/ui/` deliberately do not import this module (layer rule: `ui` may not depend on `game`) —
 * `src/app/GameShell.ts` reads the labels here and passes them down, so a widget can be reused
 * with any wording and the UI stays free of game knowledge.
 *
 * A `bn` block can be added to the JSON without touching code: `t()` falls back to `en` per key,
 * so a partially translated locale ships safely.
 */
import strings from "./data/strings.json";

type Bundle = Record<string, string>;

const BUNDLES = strings as unknown as { locale: string; en: Bundle } & Record<string, Bundle>;

export const FALLBACK_LOCALE = "en";

export type StringKey = keyof typeof BUNDLES.en;

let locale: string = BUNDLES.locale ?? FALLBACK_LOCALE;
const overrides = new Map<string, string>();

export function availableLocales(): string[] {
  return Object.keys(BUNDLES).filter((k) => k !== "locale" && !k.startsWith("$"));
}

export function getLocale(): string {
  return locale;
}

/** Returns false (and keeps the old locale) when the bundle does not exist. */
export function setLocale(next: string): boolean {
  if (!availableLocales().includes(next)) return false;
  locale = next;
  return true;
}

/** Dev/test escape hatch: force wording without editing the JSON (used by the pose lab). */
export function overrideString(key: string, value: string | null): void {
  if (value === null) overrides.delete(key);
  else overrides.set(key, value);
}

function bundleFor(name: string): Bundle {
  return BUNDLES[name] ?? BUNDLES[FALLBACK_LOCALE];
}

/** `{{token}}` substitution; numbers are grouped so a score of 12480 reads as 12,480. */
export function formatValue(value: number | string): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(locale === "bn" ? "bn-BD" : "en")
    : String(value);
}

export function t(key: string, vars: Record<string, number | string> = {}): string {
  const raw = overrides.get(key) ?? bundleFor(locale)[key] ?? bundleFor(FALLBACK_LOCALE)[key];
  if (raw === undefined) return `[${key}]`;
  return raw.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : formatValue(value);
  });
}

/** Every key defined in `en`, for the completeness test. */
export function keys(): string[] {
  return Object.keys(BUNDLES[FALLBACK_LOCALE]);
}
