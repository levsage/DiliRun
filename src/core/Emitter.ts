/**
 * Minimal typed event emitter.
 *
 * The game uses this instead of DOM events for internal signals (score changed,
 * run finished, asset loaded) so systems stay decoupled and testable in node.
 */
export type Listener<T> = (payload: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set<Listener<never>>();
    set.add(fn as Listener<never>);
    this.listeners.set(event, set);
    return () => this.off(event, fn);
  }

  once<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    const off = this.on(event, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(fn as Listener<never>);
    if (set.size === 0) this.listeners.delete(event);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): number {
    const set = this.listeners.get(event);
    if (!set) return 0;
    // Snapshot first (a listener may unsubscribe while we iterate), but re-check
    // membership so a listener removed during this emit is genuinely skipped.
    for (const fn of [...set]) {
      if (set.has(fn)) (fn as Listener<Events[K]>)(payload);
    }
    return set.size;
  }

  listenerCount(event: keyof Events): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}
