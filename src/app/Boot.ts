/**
 * Startup: build (or find) the DOM skeleton, preload the baked assets, then hand
 * control to the {@link GameShell}.
 *
 * Loading is explicit and recoverable: a missing sprite sheet shows a readable
 * error with a retry button instead of a blank canvas, which is exactly what a
 * stale GitHub Pages deploy looks like.
 */
import { AssetLoader, type AssetIndex } from "../core/Assets";
import { GameShell, type ShellElements } from "./GameShell";
import type { SheetManifest } from "../render/SpriteAnimator";
import type { CoinStrip } from "./AttractScene";

export interface BootOptions {
  /** Open the dev animation bench (?lab=1). */
  lab?: boolean;
  /** Skip the menu and start a run immediately (?run=1). */
  run?: boolean;
}

export interface BootResult {
  shell: GameShell;
  manifest: SheetManifest;
}

function query<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function ensureElements(): ShellElements {
  let root = query<HTMLElement>("#dilirun");
  if (!root) {
    root = document.createElement("div");
    root.id = "dilirun";
    document.body.append(root);
  }
  let canvas = query<HTMLCanvasElement>("#dilirun-canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "dilirun-canvas";
    root.prepend(canvas);
  }
  let hud = query<HTMLElement>("#dilirun-hud");
  if (!hud) {
    hud = document.createElement("div");
    hud.id = "dilirun-hud";
    hud.className = "dili-hud";
    root.append(hud);
  }
  return { root, canvas, hud };
}

function setStatus(node: HTMLElement | null, text: string, tone: "info" | "error" = "info"): void {
  if (!node) return;
  const label = node.querySelector<HTMLElement>("[data-boot-status]");
  if (label) label.textContent = text;
  node.classList.toggle("is-error", tone === "error");
}

/** WebP first, PNG if the browser (or a broken deploy) refuses it. */
async function loadSheetImage(loader: AssetLoader, manifest: SheetManifest): Promise<HTMLImageElement> {
  try {
    return await loader.loadImage(`assets/${manifest.imagePath}`);
  } catch (error) {
    if (!manifest.fallbackImagePath) throw error;
    return await loader.loadImage(`assets/${manifest.fallbackImagePath}`);
  }
}

export async function boot(options: BootOptions = {}): Promise<BootResult> {
  const status = query<HTMLElement>("#dilirun-boot");
  const loader = new AssetLoader(import.meta.env.BASE_URL);
  setStatus(status, "Reading asset index…");
  const index = await loader.loadJson<AssetIndex>("assets/manifest.json");

  setStatus(status, "Decoding hero sheet manifest…");
  const heroManifest = await loader.loadJson<SheetManifest>(`assets/${index.hero.meta}`);

  setStatus(status, "Decoding hero sprite sheet…");
  const heroImage = await loadSheetImage(loader, heroManifest);

  setStatus(status, "Decoding coins…");
  let coin: CoinStrip | undefined;
  try {
    const meta = await loader.loadJson<{ cell: number; frames: number; fps: number }>(
      `assets/${index.coin.meta}`,
    );
    coin = {
      image: await loader.loadImage(`assets/${index.coin.sprite}`),
      cell: meta.cell,
      frames: meta.frames,
      fps: meta.fps,
    };
  } catch {
    coin = undefined; // coins are decorative in attract mode
  }

  setStatus(status, "Mounting HUD…");
  const shell = new GameShell(
    ensureElements(),
    loader,
    index,
    { image: heroImage, manifest: heroManifest },
    coin,
  );
  shell.mount();
  status?.classList.add("is-done");
  requestAnimationFrame(() => status?.remove());

  if (options.run) shell.startRun();

  if (options.lab) {
    const { mountPoseLab } = await import("./PoseLab");
    mountPoseLab(shell.hudRoot, shell.scene, heroManifest);
  }
  return { shell, manifest: heroManifest };
}

export async function bootWithFailureUI(options: BootOptions = {}): Promise<BootResult | null> {
  try {
    return await boot(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dilirun] boot failed", error);
    const status = query<HTMLElement>("#dilirun-boot");
    setStatus(status, `Could not start DiliRun: ${message}`, "error");
    status
      ?.querySelector<HTMLButtonElement>("[data-boot-retry]")
      ?.removeEventListener("click", () => location.reload());
    const retry = status?.querySelector<HTMLButtonElement>("[data-boot-retry]");
    if (retry) retry.addEventListener("click", () => location.reload());
    if (retry) retry.hidden = false;
    return null;
  }
}
