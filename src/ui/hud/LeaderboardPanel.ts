/**
 * Leaderboard panel (top runs on this device). Shared by the menu and the game over
 * screen so both show identical formatting, including the "you" highlight.
 */
import type { RunRecord } from "../../game/records";

export interface LeaderboardRow {
  rank: number;
  record: RunRecord;
  isSelf: boolean;
}

export function toRows(list: RunRecord[], highlightId?: string | null): LeaderboardRow[] {
  return list.map((record, i) => ({
    rank: i + 1,
    record,
    isSelf: !!highlightId && record.id === highlightId,
  }));
}

/**
 * Relative time, floored: "1m ago" must mean *at least* a minute has passed. Rounding here
 * used to make a 30-second-old run read as "1m ago", which is the one case a player checks.
 */
export function formatWhen(at: number, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - at) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export interface LeaderboardLabels {
  title: string;
  hint: string;
  empty: string;
  you: string;
  /** What a run made before names existed (or by a nameless player) is credited to. */
  unnamed: string;
}

export class LeaderboardPanel {
  private root: HTMLElement;
  private list: HTMLElement;
  private empty: HTMLElement;
  private title: HTMLElement;
  private hint: HTMLElement;
  private labels: LeaderboardLabels;

  constructor(options: Partial<LeaderboardLabels> = {}) {
    this.labels = {
      title: "Top runs",
      hint: "single player · this device",
      empty: "No runs yet — go set the first one.",
      you: "You",
      unnamed: "Runner",
      ...options,
    };
    const el = document.createElement("section");
    el.className = "dili-board";
    el.setAttribute("data-dili-ui", "");
    el.innerHTML = `
      <header class="dili-board__head">
        <h2 class="dili-board__title"></h2>
        <span class="dili-board__hint"></span>
      </header>
      <ol class="dili-board__list"></ol>
      <p class="dili-board__empty" hidden></p>
    `;
    this.root = el;
    this.list = el.querySelector(".dili-board__list") as HTMLElement;
    this.empty = el.querySelector(".dili-board__empty") as HTMLElement;
    this.title = el.querySelector(".dili-board__title") as HTMLElement;
    this.hint = el.querySelector(".dili-board__hint") as HTMLElement;
    // Text, not markup: these strings come from the bundle and a name never does.
    this.setTitle(this.labels.title);
    this.empty.textContent = this.labels.empty;
    this.hint.textContent = this.labels.hint;
  }

  setLabels(next: Partial<LeaderboardLabels>): void {
    this.labels = { ...this.labels, ...next };
    this.title.textContent = this.labels.title;
    this.hint.textContent = this.labels.hint;
    this.empty.textContent = this.labels.empty;
    this.render(this.lastRows);
  }

  private lastRows: LeaderboardRow[] = [];

  get element(): HTMLElement {
    return this.root;
  }

  setTitle(text: string): void {
    this.title.textContent = text;
  }

  render(rows: LeaderboardRow[]): void {
    this.lastRows = rows;
    this.list.replaceChildren(
      ...rows.map(({ rank, record, isSelf }) => {
        const li = document.createElement("li");
        li.className = isSelf ? "dili-board__row is-self" : "dili-board__row";
        li.innerHTML = `
          <span class="dili-board__rank">${rank}</span>
          <span class="dili-board__name"></span>
          <span class="dili-board__score">${Math.floor(record.score).toLocaleString("en-US")}</span>
          <span class="dili-board__meta">${Math.floor(record.meters).toLocaleString("en-US")} m</span>
          <span class="dili-board__coins">${record.coins}<i aria-hidden="true"></i></span>
          <span class="dili-board__when">${formatWhen(record.at)}</span>
        `;
        // The name is the only free-text field on this screen, so it goes in as textContent.
        const who = li.querySelector(".dili-board__name") as HTMLElement;
        who.textContent = record.name?.trim() || this.labels.unnamed;
        if (isSelf) {
          const chip = document.createElement("b");
          chip.className = "dili-board__you";
          chip.textContent = this.labels.you;
          who.appendChild(document.createTextNode(" "));
          who.appendChild(chip);
        }
        return li;
      }),
    );
    this.empty.hidden = rows.length > 0;
    this.list.hidden = rows.length === 0;
  }

  mount(parent: HTMLElement): this {
    parent.appendChild(this.root);
    return this;
  }
}
