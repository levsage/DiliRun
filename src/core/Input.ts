/**
 * Input: keyboard + touch swipe, normalised into game actions.
 *
 * The runner only ever needs four verbs (left, right, jump, slide) plus pause, so
 * the controller buffers *intents* for a short window instead of exposing raw keys.
 * That buffering is what makes an early jump press still feel responsive when the
 * hero is about to land.
 */
export type GameAction = "left" | "right" | "jump" | "slide" | "pause";

export interface InputOptions {
  /** How long an un-consumed action stays valid, in seconds. */
  bufferSeconds?: number;
  /** Minimum swipe distance in CSS px. */
  swipeThreshold?: number;
  target?: EventTarget;
  /** Clock override (ms). Tests need a deterministic one. */
  now?: () => number;
}

const KEY_MAP: Record<string, GameAction> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "jump",
  KeyW: "jump",
  Space: "jump",
  ArrowDown: "slide",
  KeyS: "slide",
  Escape: "pause",
  KeyP: "pause",
};

/** Direction of a swipe, decided on the dominant axis. */
export function swipeAction(dx: number, dy: number, threshold = 24): GameAction | null {
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "slide" : "jump";
}

export class InputController {
  private readonly buffer: { action: GameAction; at: number }[] = [];
  private readonly bufferSeconds: number;
  private readonly swipeThreshold: number;
  private pointer: { x: number; y: number; id: number } | null = null;
  private readonly clock: () => number;
  private attached: EventTarget | null = null;
  private listeners: [EventTarget, string, EventListener][] = [];

  onChange: ((action: GameAction) => void) | null = null;

  constructor(options: InputOptions = {}) {
    this.bufferSeconds = options.bufferSeconds ?? 0.16;
    this.swipeThreshold = options.swipeThreshold ?? 24;
    this.clock = options.now ?? performanceNow;
    if (options.target) this.attach(options.target);
  }

  attach(target: EventTarget): void {
    this.attached = target;
    const add = (node: EventTarget, type: string, fn: EventListener) => {
      node.addEventListener(type, fn, { passive: false });
      this.listeners.push([node, type, fn]);
    };
    add(target, "keydown", ((e: KeyboardEvent) => this.onKey(e)) as EventListener);
    add(target, "keyup", ((e: KeyboardEvent) => this.onKeyUp(e)) as EventListener);
    add(target, "pointerdown", ((e: PointerEvent) => this.onPointerDown(e)) as EventListener);
    add(target, "pointerup", ((e: PointerEvent) => this.onPointerUp(e)) as EventListener);
  }

  detach(): void {
    for (const [node, type, fn] of this.listeners) node.removeEventListener(type, fn);
    this.listeners = [];
    this.buffer.length = 0;
    this.pointer = null;
    this.attached = null;
  }

  /** Down state for movement-hold actions (used for continuous lane nudging). */
  readonly held = new Set<GameAction>();

  private press(action: GameAction, at: number): void {
    this.buffer.push({ action, at });
    this.onChange?.(action);
  }

  private onKey(event: KeyboardEvent): void {
    const action = KEY_MAP[event.code];
    if (!action) return;
    if (action !== "pause") {
      event.preventDefault?.();
      this.held.add(action);
    }
    if (event.repeat) return;
    this.press(action, this.clock());
  }

  private onKeyUp(event: KeyboardEvent): void {
    const action = KEY_MAP[event.code];
    if (action) this.held.delete(action);
  }

  private onPointerDown(event: PointerEvent): void {
    this.pointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.pointer || this.pointer.id !== event.pointerId) return;
    const dx = event.clientX - this.pointer.x;
    const dy = event.clientY - this.pointer.y;
    this.pointer = null;
    const action = swipeAction(dx, dy, this.swipeThreshold);
    if (action) this.press(action, this.clock());
    else this.press("jump", this.clock()); // a tap jumps, like the mobile original
  }

  /** Feed a swipe manually (also used by on-screen buttons and by tests). */
  swipe(dx: number, dy: number): GameAction | null {
    const action = swipeAction(dx, dy, this.swipeThreshold);
    if (action) this.press(action, this.clock());
    return action;
  }

  /** Consume the freshest buffered action of a given kind, if any is still valid. */
  take(action: GameAction, now = this.clock()): boolean {
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const entry = this.buffer[i];
      if (!entry) continue;
      if (entry.action === action && now - entry.at <= this.bufferSeconds * 1000 && now >= entry.at) {
        this.buffer.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /** Drop expired entries; called once per frame by the input system. */
  prune(now = this.clock()): number {
    let removed = 0;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (now - (this.buffer[i]?.at ?? 0) > this.bufferSeconds * 1000) {
        this.buffer.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  get pendingCount(): number {
    return this.buffer.length;
  }

  get target(): EventTarget | null {
    return this.attached;
  }
}

function performanceNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
