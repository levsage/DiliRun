/**
 * Lives as pips. A runner only needs to communicate "one more hit and you are done", so this
 * is deliberately the simplest widget in the HUD: N dots, spent ones hollow, a shake when one
 * is lost.
 */
export interface LivesOptions {
  total?: number;
  label?: string;
}

export class Lives {
  private root!: HTMLElement;
  private pips: HTMLElement[] = [];
  private last = 0;
  private label: string;

  constructor(options: LivesOptions = {}) {
    this.label = options.label ?? "Lives";
    this.build(options.total ?? 3);
  }

  private build(total: number): void {
    const el = document.createElement("div");
    el.className = "dili-lives";
    el.setAttribute("role", "status");
    el.setAttribute("aria-label", this.label);
    el.dataset.diliHud = "lives";
    for (let i = 0; i < total; i++) {
      const pip = document.createElement("i");
      pip.className = "dili-lives__pip";
      el.appendChild(pip);
      this.pips.push(pip);
    }
    this.root = el;
    this.last = total;
  }

  get element(): HTMLElement {
    return this.root;
  }

  get total(): number {
    return this.pips.length;
  }

  update(remaining: number): void {
    const value = Math.max(0, Math.min(this.pips.length, remaining));
    this.pips.forEach((pip, index) => pip.classList.toggle("is-spent", index >= value));
    if (value < this.last) {
      this.root.classList.remove("is-hit");
      // Force a reflow so the shake replays on consecutive hits.
      void this.root.offsetWidth;
      this.root.classList.add("is-hit");
    }
    this.last = value;
    this.root.setAttribute("aria-valuenow", String(value));
  }

  reset(): void {
    this.last = this.pips.length;
    this.update(this.pips.length);
  }

  mount(parent: HTMLElement): this {
    parent.appendChild(this.root);
    return this;
  }

  dispose(): void {
    this.root.remove();
    this.pips = [];
  }
}
