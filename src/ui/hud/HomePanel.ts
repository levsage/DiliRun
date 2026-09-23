/**
 * The home stage: who you are, how far you have got, and the one button that starts a run.
 *
 * Like the rest of `src/ui/` this knows nothing about the game — no `game/**` import. The shell reads
 * strings and records and hands the numbers down, so the panel can be mounted over the attract loop,
 * over a frozen crash scene, or in a test with nothing but a jsdom document.
 *
 * Two details are load-bearing rather than decorative:
 *  - `pointerdown` inside the card stops propagating, because the input controller listens on `window`
 *    and a tap anywhere else is "jump" — which would start a run the instant you reached for the
 *    language button.
 *  - while the name field has focus, `isTyping` is true and the shell refuses to start a run, so
 *    typing "Space" in a name cannot send you off.
 */
export interface HomeLabels {
  kicker: string;
  title: string;
  tagline: string;
  play: string;
  nameLabel: string;
  nameSave: string;
  nameHint: string;
  best: string;
  distance: string;
  runs: string;
  bank: string;
  language: string;
  reset: string;
  resetSure: string;
  controls: string;
  saved: string;
}

export interface HomeStats {
  best: string;
  distance: string;
  runs: string;
  bank: string;
}

export interface HomeHandlers {
  onPlay?: () => void;
  onName?: (name: string) => void;
  onLanguage?: () => void;
  onReset?: () => void;
}

const ARMS_MS = 4000;

export class HomePanel {
  private el!: HTMLElement;
  private card!: HTMLElement;
  private kicker!: HTMLElement;
  private title!: HTMLElement;
  private tagline!: HTMLElement;
  private controls!: HTMLElement;
  private best!: HTMLElement;
  private distance!: HTMLElement;
  private runs!: HTMLElement;
  private bank!: HTMLElement;
  private input!: HTMLInputElement;
  private saveBtn!: HTMLButtonElement;
  private playBtn!: HTMLButtonElement;
  private langBtn!: HTMLButtonElement;
  private resetBtn!: HTMLButtonElement;
  private saved!: HTMLElement;
  private labels!: HomeLabels;
  private unarming: ReturnType<typeof setTimeout> | null = null;
  private mounted: HTMLElement | null = null;
  private disposed = false;

  constructor(
    labels: HomeLabels,
    private readonly handlers: HomeHandlers = {},
  ) {
    this.labels = { ...labels };
  }

  get element(): HTMLElement {
    return this.el;
  }

  mount(parent: HTMLElement): this {
    this.mounted = parent;
    const el = document.createElement("div");
    el.className = "dili-home";
    el.setAttribute("role", "region");
    el.hidden = true;
    // No game text in here: every word arrives through the labels the shell passed in.
    el.innerHTML = `
      <div class="dili-home__card">
        <p class="dili-home__kicker"></p>
        <h1 class="dili-home__title"></h1>
        <p class="dili-home__tagline"></p>
        <dl class="dili-home__stats">
          <div class="dili-home__stat"><dt></dt><dd class="js-best">—</dd></div>
          <div class="dili-home__stat"><dt></dt><dd class="js-distance">—</dd></div>
          <div class="dili-home__stat"><dt></dt><dd class="js-runs">—</dd></div>
          <div class="dili-home__stat"><dt></dt><dd class="js-bank">—</dd></div>
        </dl>
        <form class="dili-home__name" autocomplete="off">
          <label class="dili-home__name-label" for="dili-name"></label>
          <div class="dili-home__name-row">
            <input class="dili-home__name-input" id="dili-name" type="text" spellcheck="false"
              maxlength="24" inputmode="text" />
            <button class="dili-home__name-save" type="submit"></button>
          </div>
          <p class="dili-home__name-hint"></p>
        </form>
        <p class="dili-home__saved" role="status" hidden></p>
        <div class="dili-home__actions">
          <button class="dili-home__play" type="button"></button>
          <div class="dili-home__minor">
            <button class="dili-home__ghost dili-home__lang" type="button"></button>
            <button class="dili-home__ghost dili-home__reset" type="button"></button>
          </div>
        </div>
        <p class="dili-home__controls"></p>
      </div>`;
    this.el = el;
    this.card = el.querySelector(".dili-home__card") as HTMLElement;
    this.kicker = el.querySelector(".dili-home__kicker") as HTMLElement;
    this.title = el.querySelector(".dili-home__title") as HTMLElement;
    this.tagline = el.querySelector(".dili-home__tagline") as HTMLElement;
    this.controls = el.querySelector(".dili-home__controls") as HTMLElement;
    this.best = el.querySelector(".js-best") as HTMLElement;
    this.distance = el.querySelector(".js-distance") as HTMLElement;
    this.runs = el.querySelector(".js-runs") as HTMLElement;
    this.bank = el.querySelector(".js-bank") as HTMLElement;
    this.input = el.querySelector(".dili-home__name-input") as HTMLInputElement;
    this.saveBtn = el.querySelector(".dili-home__name-save") as HTMLButtonElement;
    this.playBtn = el.querySelector(".dili-home__play") as HTMLButtonElement;
    this.langBtn = el.querySelector(".dili-home__lang") as HTMLButtonElement;
    this.resetBtn = el.querySelector(".dili-home__reset") as HTMLButtonElement;
    this.saved = el.querySelector(".dili-home__saved") as HTMLElement;

    // The taps and swipes that belong to the panel must not reach the game's window listeners.
    el.addEventListener("pointerdown", (event) => event.stopPropagation());
    el.addEventListener("keydown", (event) => event.stopPropagation());
    el.addEventListener("keyup", (event) => event.stopPropagation());

    this.playBtn.addEventListener("click", () => {
      this.blur();
      this.handlers.onPlay?.();
    });
    this.langBtn.addEventListener("click", () => this.handlers.onLanguage?.());
    this.resetBtn.addEventListener("click", () => this.onResetClick());
    const form = el.querySelector("form") as HTMLFormElement;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.handlers.onName?.(this.name);
      this.flashSaved();
    });
    this.input.addEventListener("focus", () => this.cancelReset());
    parent.appendChild(el);
    this.setLabels(this.labels);
    return this;
  }

  /** Every word the panel shows, in one call, so the shell can swap locales without rebuilding it. */
  setLabels(labels: Partial<HomeLabels>): void {
    this.labels = { ...this.labels, ...labels };
    const l = this.labels;
    if (this.disposed || !this.el) return;
    this.kicker.textContent = l.kicker;
    this.title.textContent = l.title;
    this.tagline.textContent = l.tagline;
    this.controls.textContent = l.controls;
    this.input.placeholder = "";
    this.input.setAttribute("aria-label", l.nameLabel);
    this.saveBtn.textContent = l.nameSave;
    this.playBtn.textContent = l.play;
    this.langBtn.textContent = l.language;
    this.resetBtn.textContent = l.reset;
    this.saved.textContent = l.saved;
    const dts = this.el.querySelectorAll(".dili-home__stat dt");
    const wanted = [l.best, l.distance, l.runs, l.bank];
    dts.forEach((dt, i) => {
      dt.textContent = wanted[i] ?? "";
    });
    const hint = this.el.querySelector(".dili-home__name-hint");
    if (hint) hint.textContent = l.nameHint;
    this.updateResetLabel();
  }

  setStats(stats: HomeStats): void {
    if (!this.best) return;
    this.best.textContent = stats.best;
    this.distance.textContent = stats.distance;
    this.runs.textContent = stats.runs;
    this.bank.textContent = stats.bank;
  }

  set name(value: string) {
    if (this.input) this.input.value = value;
  }

  get name(): string {
    return this.input ? this.input.value : "";
  }

  /** True while the name field owns the keyboard, so the shell can refuse to start a run. */
  get isTyping(): boolean {
    if (!this.input) return false;
    const active = this.el?.ownerDocument?.activeElement;
    return active === this.input;
  }

  show(): void {
    if (!this.el) return;
    this.el.hidden = false;
    this.el.classList.add("is-visible");
  }

  hide(): void {
    if (!this.el) return;
    this.el.hidden = true;
    this.el.classList.remove("is-visible");
    this.cancelReset();
    this.blur();
  }

  focusName(): void {
    this.input?.focus();
  }

  private blur(): void {
    this.input?.blur();
    this.playBtn?.blur();
  }

  private flashSaved(): void {
    if (!this.saved) return;
    this.saved.hidden = false;
    this.saved.classList.remove("is-blip");
    // Force a reflow so re-clicking Save replays the animation rather than sitting at its end.
    void this.saved.offsetWidth;
    this.saved.classList.add("is-blip");
  }

  /**
   * Erasing the board is destructive and only costs a few keystrokes to redo, so it asks twice. The
   * second tap must land within the window or the button forgets; it never sits armed.
   */
  private onResetClick(): void {
    if (this.resetBtn.dataset.armed === "1") {
      this.cancelReset();
      this.handlers.onReset?.();
      return;
    }
    this.resetBtn.dataset.armed = "1";
    this.updateResetLabel();
    if (this.unarming) clearTimeout(this.unarming);
    this.unarming = setTimeout(() => this.cancelReset(), ARMS_MS);
  }

  private updateResetLabel(): void {
    if (!this.resetBtn) return;
    const armed = this.resetBtn.dataset.armed === "1";
    this.resetBtn.textContent = armed ? this.labels.resetSure : this.labels.reset;
    this.resetBtn.classList.toggle("is-armed", armed);
  }

  private cancelReset(): void {
    if (this.unarming) {
      clearTimeout(this.unarming);
      this.unarming = null;
    }
    if (this.resetBtn) {
      delete this.resetBtn.dataset.armed;
      this.updateResetLabel();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.unarming) clearTimeout(this.unarming);
    this.unarming = null;
    if (this.el && this.mounted && this.el.parentNode === this.mounted) this.mounted.removeChild(this.el);
  }
}
