/**
 * Affordance glyphs: the arrow painted on a hazard to say what to do about it.
 *
 * Geometry only, in plain point arrays — no canvas state, no theme, no game knowledge. That keeps it
 * unit-testable and lets the renderer decide colour, thickness and how hard to pulse. It also keeps a
 * promise the design doc makes: the glyph is *derived* from the same `clearWith` data collision uses, so
 * an arrow can never lie about what survives a hazard.
 */
export type SignalShape = "up" | "down" | "spin";

/** The dark octagon behind a glyph. Exported so the render test can look for exactly this paint. */
export const PLATE_COLOUR = "rgba(6,16,40,0.9)";
export type Point = [number, number];

/** Which glyph a hazard's data asks for. `none` (or a missing signal) draws nothing at all. */
export function shapeFor(signal: string | undefined): SignalShape | null {
  switch (signal) {
    case "jump":
      return "up";
    case "duck":
      return "down";
    case "roll":
      return "spin";
    default:
      return null;
  }
}

/**
 * One or more chevrons pointing along `dir` (-1 = up the screen, +1 = down).
 *
 * They are stacked *behind* each other along the direction of travel, so the nearest chevron is the
 * one furthest along: a pair reads as "keep going that way" rather than as two unrelated ticks.
 */
export function chevrons(dir: -1 | 1, cx: number, cy: number, width: number, count = 2): Point[][] {
  const half = Math.max(3, width / 2);
  const rise = half * 0.62;
  const step = half * 0.78;
  const out: Point[][] = [];
  for (let i = 0; i < count; i++) {
    // i = 0 is the trailing chevron — the one nearest the hazard — so a pair reads as a path leading
    // away from the block rather than as two ticks. Hence the negative: `dir` points outward.
    const shift = -(count - 1 - i) * step * dir;
    const base = cy + shift;
    // Arms on one line, apex pushed along `dir`: with dir = -1 the apex is the smaller y, i.e. up.
    out.push([
      [cx - half, base],
      [cx, base + rise * dir],
      [cx + half, base],
    ]);
  }
  return out;
}

/** A circular arrow for a roll: an open arc plus a head at its leading end. */
export function spinArrow(cx: number, cy: number, radius: number, turns = 0.72): Point[][] {
  const r = Math.max(3, radius / 2);
  const start = Math.PI * 0.15;
  const sweep = Math.PI * 2 * turns;
  const arc: Point[] = [];
  const segments = 14;
  for (let i = 0; i <= segments; i++) {
    const a = start + (sweep * i) / segments;
    arc.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  const tip = arc[arc.length - 1] ?? [cx + r, cy];
  const tangent = start + sweep + Math.PI / 2;
  const head = Math.max(2.5, r * 0.42);
  const back: Point = [tip[0] - Math.cos(tangent) * head, tip[1] - Math.sin(tangent) * head];
  const side: Point = [tip[0] + Math.cos(tangent) * head * 0.55, tip[1] + Math.sin(tangent) * head * 0.55];
  return [arc, [side, tip, back]];
}

/**
 * A flat octagon around a box — the plate that keeps a thin white arrow readable over a busy hazard.
 * Octagon rather than `roundRect`, because that is a path like everything else here and so needs no
 * new canvas API in the render path (or in its recording stub).
 */
export function plate(cx: number, cy: number, w: number, h: number): Point[] {
  const x = cx - w / 2;
  const y = cy - h / 2;
  const k = Math.min(w, h) * 0.28;
  return [
    [x + k, y],
    [x + w - k, y],
    [x + w, y + k],
    [x + w, y + h - k],
    [x + w - k, y + h],
    [x + k, y + h],
    [x, y + h - k],
    [x, y + k],
  ];
}

/** Fade-in for a glyph, in metres of runway: invisible far away, solid once it is actionable. */
export function signalAlpha(meters: number, from = 26, over = 8): number {
  const t = (from - meters) / over;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/** Every point finite, or the whole canvas path is dropped by the browser. Cheap enough to assert. */
export function isSane(shapes: Point[][]): boolean {
  return shapes.every(
    (line) => line.length >= 2 && line.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
  );
}
