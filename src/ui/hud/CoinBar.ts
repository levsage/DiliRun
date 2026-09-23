/**
 * Coin bar — the always-visible "how many coins did I get" strip.
 *
 * Two numbers matter in a runner: coins from *this* run (they drive the combo and
 * the score) and the banked total (the long-term progression hook). The bar shows
 * both, with a milestone tick that fills up as you approach the next 25-coin
 * bonus, and the coin icon is the real spinning sprite from the asset pipeline.
 */
export interface CoinBarState {
  runCoins: number;
  bank: number;
  milestoneSize?: number;
}

export class CoinBar {
  private root!: HTMLElement;
  private count!: HTMLElement;
  private bankEl!: HTMLElement;
  private fill!: HTMLElement;
  private milestone: number;
  private label: string;

  constructor(options: { milestoneSize?: number; label?: string } = {}) {
    this.milestone = options.milestoneSize ?? 25;
    this.label = options.label ?? "Coins";
    this.build();
  }

  /** The currency's name is brand copy, so the shell hands it in (and can change it). */
  setLabel(text: string): void {
    this.label = text;
    this.root?.setAttribute("aria-label", text);
    const bank = this.root?.querySelector(".dili-coinbar__bank");
    if (bank) bank.setAttribute("title", text);
  }

  private build(): void {
    const el = document.createElement("div");
    el.className = "dili-coinbar";
    el.setAttribute("role", "status");
    el.setAttribute("aria-label", this.label);
    el.innerHTML = `
      <span class="dili-coinbar__icon" aria-hidden="true"></span>
      <span class="dili-coinbar__count">0</span>
      <span class="dili-coinbar__divider" aria-hidden="true"></span>
      <span class="dili-coinbar__bank">0</span>
      <span class="dili-coinbar__track" aria-hidden="true"><i></i></span>
    `;
    this.root = el;
    this.count = el.querySelector(".dili-coinbar__count") as HTMLElement;
    this.bankEl = el.querySelector(".dili-coinbar__bank") as HTMLElement;
    this.fill = el.querySelector(".dili-coinbar__track i") as HTMLElement;
  }

  get element(): HTMLElement {
    return this.root;
  }

  update(state: CoinBarState): void {
    this.count.textContent = String(state.runCoins);
    this.bankEl.textContent = String(state.bank);
    const size = state.milestoneSize ?? this.milestone;
    const into = size > 0 ? state.runCoins % size : 0;
    this.fill.style.width = `${size > 0 ? Math.round((into / size) * 100) : 0}%`;
    this.root.classList.toggle("is-bumped", into === 0 && state.runCoins > 0);
  }

  mount(parent: HTMLElement): this {
    parent.appendChild(this.root);
    return this;
  }
}
