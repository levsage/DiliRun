/**
 * Asset loading with a base path that works from any sub-directory.
 *
 * DiliRun is served from GitHub Pages (`/dilirun/`) and from the dev server (`/`),
 * so every lookup goes through {@link joinUrl}: absolute URLs stay untouched,
 * everything else is resolved relative to the page.
 */
export function joinUrl(base: string, path: string): string {
  if (/^(https?:)?\/\//.test(path) || path.startsWith("data:") || path.startsWith("blob:")) return path;
  const clean = path.replace(/^\/+/, "");
  if (!base || base === "./" || base === "/") return `./${clean}`;
  return `${base.replace(/\/+$/, "")}/${clean}`;
}

export type Progress = (done: number, total: number, key: string) => void;

export interface AssetManifest {
  /** key -> path relative to the asset root */
  [key: string]: string;
}

export class AssetLoader {
  private images = new Map<string, HTMLImageElement>();
  private json = new Map<string, unknown>();

  constructor(
    private readonly base: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  url(path: string): string {
    return joinUrl(this.base, path);
  }

  cached<T>(path: string): T | undefined {
    return (this.json.get(path) as T | undefined) ?? undefined;
  }

  image(path: string): HTMLImageElement | undefined {
    return this.images.get(path);
  }

  async loadJson<T>(path: string): Promise<T> {
    const hit = this.json.get(path);
    if (hit !== undefined) return hit as T;
    const res = await this.fetchImpl(this.url(path), { cache: "force-cache" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} while loading ${path}`);
    const data = (await res.json()) as T;
    this.json.set(path, data);
    return data;
  }

  loadImage(path: string): Promise<HTMLImageElement> {
    const hit = this.images.get(path);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        this.images.set(path, img);
        resolve(img);
      };
      img.onerror = () => reject(new Error(`could not decode ${path}`));
      img.src = this.url(path);
    });
  }

  /**
   * Load every entry of a manifest, resolving in insertion order-independent
   * fashion but reporting progress deterministically.
   */
  async loadAll<M extends AssetManifest>(
    manifest: M,
    onProgress?: Progress,
  ): Promise<{ [K in keyof M]: HTMLImageElement }> {
    const entries = Object.entries(manifest) as [keyof M & string, string][];
    const out = {} as { [K in keyof M]: HTMLImageElement };
    let done = 0;
    await Promise.all(
      entries.map(async ([key, path]) => {
        out[key] = await this.loadImage(path);
        done++;
        onProgress?.(done, entries.length, key);
      }),
    );
    return out;
  }
}

/** The path the game uses for the asset index emitted by the pipeline. */
export const ASSET_INDEX = "assets/manifest.json";

export interface AssetIndex {
  format: string;
  hero: { sprite: string; meta: string };
  coin: { sprite: string; meta: string; cell: number; frames: number; fps: number };
  logo: { white: string; navy: string; cyan: string; sourceSize: number[] };
  heroCuts: { idle: string; portrait: string };
  icons: string[];
  sources: Record<string, string>;
}
