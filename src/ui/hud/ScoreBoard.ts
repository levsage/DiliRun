/**
 * Score board — the in-run readout (score, distance, multiplier, personal best).
 * Digits are monospaced and widths are pre-measured so the panel never jitters as
 * the numbers roll.
 */
export interface ScoreBoardState {
  score: number;
  meters: number;
  multiplier: number;
  best: number;
  combo?: number;
}

const PLACEHOLDER_WIDTH = "0000000";

/** The three captions. They are words, so they come from the strings layer, not from this file. */
export interface ScoreBoardLabels {
  score: string;
  distance: string;
  best: string;
}

export class ScoreBoard {
  private root!: HTMLElement;
  private score!: HTMLElement;
  private distance!: HTMLElement;
  private multiplier!: HTMLElement;
  private best!: HTMLElement;
  private last: ScoreBoardState | null = null;
  private labels: ScoreBoardLabels;
  private labelEls: Partial<Record<keyof ScoreBoardLabels, HTMLElement>> = {};

  constructor(labels: Partial<ScoreBoardLabels> = {}) {
    this.labels = { score: "Score", distance: "Distance", best: "Best", ...labels };
    this.build();
  }

  /** Swap the captions without rebuilding the panel, so a locale change is instant. */
  setLabels(next: Partial<ScoreBoardLabels>): void {
    this.labels = { ...this.labels, ...next };
    for (const key of Object.keys(this.labelEls) as (keyof ScoreBoardLabels)[]) {
      const el = this.labelEls[key];
      if (el) el.textContent = this.labels[key];
    }
  }

  private build(): void {
    const el = document.createElement("div");
    el.className = "dili-scoreboard";
    el.innerHTML = `
      <div class="dili-scoreboard__row dili-scoreboard__row--main">
        <span class="dili-scoreboard__label" data-label="score"></span>
        <span class="dili-scoreboard__score" data-value="${PLACEHOLDER_WIDTH}">0</span>
      </div>
      <div class="dili-scoreboard__row">
        <span class="dili-scoreboard__label" data-label="distance"></span>
        <span class="dili-scoreboard__meters">0 m</span>
      </div>
      <div class="dili-scoreboard__row">
        <span class="dili-scoreboard__label" data-label="best"></span>
        <span class="dili-scoreboard__best">0</span>
        <span class="dili-scoreboard__mult">x1.00</span>
      </div>
    `;
    this.root = el;
    this.score = el.querySelector(".dili-scoreboard__score") as HTMLElement;
    this.distance = el.querySelector(".dili-scoreboard__meters") as HTMLElement;
    this.multiplier = el.querySelector(".dili-scoreboard__mult") as HTMLElement;
    this.best = el.querySelector(".dili-scoreboard__best") as HTMLElement;
    for (const key of ["score", "distance", "best"] as const) {
      const node = el.querySelector(`[data-label="${key}"]`) as HTMLElement | null;
      if (node) {
        this.labelEls[key] = node;
        node.textContent = this.labels[key];
      }
    }
  }

  get element(): HTMLElement {
    return this.root;
  }

  update(state: ScoreBoardState): void {
    if (
      this.last &&
      this.last.score === state.score &&
      this.last.meters === state.meters &&
      this.last.multiplier === state.multiplier &&
      this.last.best === state.best
    ) {
      return; // skip DOM writes when nothing changed
    }
    this.last = state;
    const score = Math.floor(state.score).toLocaleString("en-US");
    this.score.textContent = score;
    this.score.dataset.value = PLACEHOLDER_WIDTH.slice(Math.min(PLACEHOLDER_WIDTH.length, score.length));
    this.distance.textContent = `${Math.floor(state.meters).toLocaleString("en-US")} m`;
    this.best.textContent = Math.floor(state.best).toLocaleString("en-US");
    this.multiplier.textContent = `x${state.multiplier.toFixed(2)}`;
    this.root.classList.toggle("is-hot", state.multiplier >= 2);
  }

  mount(parent: HTMLElement): this {
    parent.appendChild(this.root);
    return this;
  }
}
