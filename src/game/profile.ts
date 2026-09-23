/**
 * The player's own settings: a name for the Runner Board and the language they read.
 *
 * Deliberately tiny and independent of `records.ts`: the leaderboard is a list of runs, this is about
 * the person who ran them. Keeping them apart is what lets "erase the board" leave the name alone, and
 * lets a name exist before the first run has ever been recorded — the home screen offers the field
 * immediately, and the record is stamped from it the moment a run ends.
 */
import type { Store } from "../core/Storage";

export const NAME_MAX = 16;
const NAME_KEY = "player.name";
const LOCALE_KEY = "player.locale";

/**
 * What the field actually accepts. Trimmed, one line, no control characters, at most NAME_MAX code
 * points (spread over `Array.from` so an emoji counts as one, not two, and cannot cut itself in half).
 * Returns `""` for anything that would leave an invisible row on the board.
 */
export function sanitizeName(raw: string): string {
  const flat = String(raw ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const points = Array.from(flat).slice(0, NAME_MAX);
  const name = points.join("").trim();
  // A name made only of combining marks is not a name: the marks have nothing to sit on.
  return /^[\u0300-\u036f\ufe20-\ufe2f]+$/u.test(name) ? "" : name;
}

export interface ProfileData {
  name: string;
  locale: string | null;
}

export class Profile {
  constructor(private readonly store: Store) {}

  get name(): string {
    const saved = this.store.read<string>(NAME_KEY, "");
    return typeof saved === "string" ? sanitizeName(saved) : "";
  }

  /** `""` (stored, not removed) means "show me as Unnamed". Returns what was kept. */
  setName(raw: string): string {
    const name = sanitizeName(raw);
    this.store.write(NAME_KEY, name);
    return name;
  }

  /** The language chosen on the home screen, or `null` for "whatever the browser asked for". */
  get locale(): string | null {
    const saved = this.store.read<string>(LOCALE_KEY, "");
    return typeof saved === "string" && saved ? saved : null;
  }

  setLocale(next: string | null): void {
    if (next === null) this.store.remove(LOCALE_KEY);
    else this.store.write(LOCALE_KEY, next);
  }

  data(): ProfileData {
    return { name: this.name, locale: this.locale };
  }
}
