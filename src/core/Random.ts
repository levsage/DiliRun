/** Deterministic RNG — a seeded run is reproducible, which makes spawner tests sane. */
export type Rng = () => number;

/** mulberry32: tiny, fast, good enough for game randomness. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: Rng, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError("pick() needs a non-empty list");
  return items[Math.floor(rng() * items.length)] as T;
}

/** Weighted choice: `[[lane, weight], ...]`. Weights are re-normalised per call. */
export function weighted<T>(rng: Rng, options: readonly [T, number][]): T {
  const total = options.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  if (total <= 0) throw new RangeError("weighted() needs a positive total weight");
  let roll = rng() * total;
  for (const [value, w] of options) {
    roll -= Math.max(0, w);
    if (roll <= 0) return value;
  }
  return options[options.length - 1]![0];
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
