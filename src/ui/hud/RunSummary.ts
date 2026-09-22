/**
 * The card that sits over the canvas between runs: "tap to run", the paused note, and the
 * game-over receipt (score, distance, coins, rank, personal-best flag).
 *
 * It is one component with three tones instead of three screens — fewer states to lose track
 * of, and the same focus handling for all of them. Everything is a callback, so the shell owns
 * the flow and this stays DOM-only.
 */
export interface SummaryLine {
  label: string;
  value: string;
  emphasis?: boolean;
}

export interface SummaryContent {
  tone: "ready" | "paused" | "over";
  title: string;
  kicker?: string;
  lines?: SummaryLine[];
  note?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
}

export interface SummaryHandlers {
  onPrimary?: () => void;
  onSecondary?: () => void;
}

export class RunSummary {
  private root!: HTMLElement;
  private title!: HTMLElement;
  private kicker!: HTMLElement;
  private lines!: HTMLElement;
  private note!: HTMLElement;
  private primary!: HTMLButtonElement;
  private secondary!: HTMLButtonElement;
  private visible = false;

  constructor(private readonly handlers: SummaryHandlers = {}) {
    this.build();
  }

  private build(): void {
    const el = document.createElement("section");
    el.className = "dili-summary";
    el.dataset.diliHud = "summary";
    el.setAttribute("aria-live", "polite");
    el.hidden = true;
    el.innerHTML = `
      <div class="dili-summary__card">
        <p class="dili-summary__kicker"></p>
        <h1 class="dili-summary__title"></h1>
        <dl class="dili-summary__lines"></dl>
        <p class="dili-summary__note"></p>
        <div class="dili-summary__actions">
          <button type="button" class="dili-summary__primary"></button>
          <button type="button" class="dili-summary__secondary" hidden></button>
        </div>
      </div>
    `;
    this.root = el;
    this.title = el.querySelector(".dili-summary__title") as HTMLElement;
    this.kicker = el.querySelector(".dili-summary__kicker") as HTMLElement;
    this.lines = el.querySelector(".dili-summary__lines") as HTMLElement;
    this.note = el.querySelector(".dili-summary__note") as HTMLElement;
    this.primary = el.querySelector(".dili-summary__primary") as HTMLButtonElement;
    this.secondary = el.querySelector(".dili-summary__secondary") as HTMLButtonElement;
    this.primary.addEventListener("click", () => this.handlers.onPrimary?.());
    this.secondary.addEventListener("click", () => this.handlers.onSecondary?.());
    // A tap anywhere on the veil also starts/resumes: it is a runner, not a form.
    el.addEventListener("pointerup", (event) => {
      if (event.target === el) this.handlers.onPrimary?.();
    });
  }

  get element(): HTMLElement {
    return this.root;
  }

  get shown(): boolean {
    return this.visible;
  }

  show(content: SummaryContent): void {
    this.root.dataset.tone = content.tone;
    this.title.textContent = content.title;
    this.kicker.textContent = content.kicker ?? "";
    this.kicker.hidden = !content.kicker;
    this.note.textContent = content.note ?? "";
    this.note.hidden = !content.note;
    this.lines.replaceChildren(
      ...(content.lines ?? []).map((line) => {
        const row = document.createElement("div");
        row.className = "dili-summary__line";
        if (line.emphasis) row.classList.add("is-emphasis");
        const dt = document.createElement("dt");
        dt.textContent = line.label;
        const dd = document.createElement("dd");
        dd.textContent = line.value;
        row.append(dt, dd);
        return row;
      }),
    );
    this.lines.hidden = this.lines.childElementCount === 0;
    this.primary.textContent = content.primaryLabel ?? "";
    this.primary.hidden = !content.primaryLabel;
    this.secondary.textContent = content.secondaryLabel ?? "";
    this.secondary.hidden = !content.secondaryLabel;
    this.root.hidden = false;
    this.visible = true;
    if (content.primaryLabel) this.primary.focus({ preventScroll: true });
  }

  hide(): void {
    this.root.hidden = true;
    this.visible = false;
  }

  mount(parent: HTMLElement): this {
    parent.appendChild(this.root);
    return this;
  }

  dispose(): void {
    this.root.remove();
  }
}
