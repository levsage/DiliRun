/**
 * Cheap pseudo-3D projection for the 3-lane track.
 *
 * A Subway-Surfers-style runner only needs a monotonic depth mapping: lane centre,
 * screen y and a scale factor that shrinks toward the horizon. Everything else in
 * the game (obstacles, coins, hero) shares this one function so nothing can drift
 * out of alignment.
 */
export interface TrackView {
  /** Logical canvas size. */
  width: number;
  height: number;
  /** Screen y of the horizon line, in logical px. */
  horizonY: number;
  /** Screen y of the near ground line (where the hero's feet live). */
  groundY: number;
  laneCount: number;
  /** Half width of the track at the near plane, in logical px. */
  nearHalf: number;
  /** Half width of the track at the horizon. */
  farHalf: number;
  /** Sprite scale at depth 1 (far). */
  farScale: number;
}

export const DEFAULT_TRACK: TrackView = {
  width: 480,
  height: 800,
  horizonY: 250,
  groundY: 690,
  laneCount: 3,
  nearHalf: 300,
  farHalf: 46,
  farScale: 0.18,
};

export interface Projected {
  y: number;
  scale: number;
  half: number;
  /** Distance between lane centres at this depth. */
  laneStep: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** `depth` is 0 at the near plane and 1 at the horizon. */
export function project(depth: number, view: TrackView = DEFAULT_TRACK): Projected {
  const t = clamp01(depth);
  // Ease so objects spend more time in the readable near field, like the original.
  const eased = Math.pow(t, 0.72);
  return {
    y: view.groundY + (view.horizonY - view.groundY) * eased,
    scale: 1 + (view.farScale - 1) * eased,
    half: view.nearHalf + (view.farHalf - view.nearHalf) * eased,
    laneStep: ((view.nearHalf + (view.farHalf - view.nearHalf) * eased) * 2) / view.laneCount,
  };
}

/** Lane index 0..laneCount-1 (0 = leftmost). Returns the screen x at that depth. */
export function laneX(lane: number, depth: number, view: TrackView = DEFAULT_TRACK): number {
  const p = project(depth, view);
  const centre = view.width / 2;
  const offset = (lane - (view.laneCount - 1) / 2) * p.laneStep;
  return centre + offset;
}

/** World metres -> depth in [0,1]; objects past the horizon are invisible. */
export function depthFor(metersAhead: number, viewLength: number): number {
  if (viewLength <= 0) return 1;
  return clamp01(metersAhead / viewLength);
}
