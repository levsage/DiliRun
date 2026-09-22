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

export function formatWhen(at: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - at) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export class LeaderboardPanel {
  private root: HTMLElement;
  private list: HTMLElement;
  private empty: HTMLElement;
  private title: HTMLElement;

  constructor(options: { title?: string } = {}) {
    const el = document.createElement("section");
    el.className = "dili-board";
    el.innerHTML = `
      <header class="dili-board__head">
        <h2 class="dili-board__title">${options.title ?? "Top runs"}</h2>
        <span class="dili-board__hint">single player · this device</span>
      </header>
      <ol class="dili-board__list"></ol>
      <p class="dili-board__empty" hidden>No runs yet — go set the first one.</p>
    `;
    this.root = el;
    this.list = el.querySelector(".dili-board__list") as HTMLElement;
    this.empty = el.querySelector(".dili-board__empty") as HTMLElement;
    this.title = el.querySelector(".dili-board__title") as HTMLElement;
  }

  get element(): HTMLElement {
    return this.root;
  }

  setTitle(text: string): void {
    this.title.textContent = text;
  }

  render(rows: LeaderboardRow[]): void {
    this.list.replaceChildren(
      ...rows.map(({ rank, record, isSelf }) => {
        const li = document.createElement("li");
        li.className = isSelf ? "dili-board__row is-self" : "dili-board__row";
        li.innerHTML = `
          <span class="dili-board__rank">${rank}</span>
          <span class="dili-board__score">${Math.floor(record.score).toLocaleString("en-US")}</span>
          <span class="dili-board__meta">${Math.floor(record.meters).toLocaleString("en-US")} m</span>
          <span class="dili-board__coins">${record.coins}<i aria-hidden="true"></i></span>
          <span class="dili-board__when">${formatWhen(record.at)}</span>
        `;
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
