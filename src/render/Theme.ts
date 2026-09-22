/**
 * Brand theme accessors.
 *
 * `src/game/data/theme.json` is the single source of truth shared with the Python
 * asset pipeline, so a colour change is one file edit for both code and art.
 */
import raw from "../game/data/theme.json";

export type ThemeColors = Record<string, string>;

export interface Theme {
  name: string;
  tagline: string;
  colors: ThemeColors;
  fonts: { display: string; ui: string; note?: string };
  logo: { clearSpace: number; minWidthRatio: number };
}

export const theme = raw as Theme;

export function color(name: keyof ThemeColors & string): string {
  const value = theme.colors[name];
  if (!value) throw new Error(`unknown theme colour "${name}"`);
  return value;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const v = hex.replace("#", "");
  const full = v.length === 3 ? [...v].map((c) => c + c).join("") : v;
  const n = Number.parseInt(full.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const k = Math.max(0, Math.min(1, t));
  const ch = (p: number, q: number) => Math.round(p + (q - p) * k);
  return `rgb(${ch(x.r, y.r)}, ${ch(x.g, y.g)}, ${ch(x.b, y.b)})`;
}

/** Publish the palette as CSS custom properties for the DOM overlay (HUD, menus). */
export function applyThemeCss(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--dili-${kebab(name)}`, value);
  }
  root.style.setProperty("--dili-font-display", theme.fonts.display);
  root.style.setProperty("--dili-font-ui", theme.fonts.ui);
}

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
