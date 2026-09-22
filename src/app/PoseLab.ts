/**
 * Dev-only animation bench (`?lab=1`).
 *
 * Lists every state the pipeline baked and lets you pin the hero to it, with the
 * live frame index + progress. It is how the sprite sheet gets eyeballed in the
 * browser before the gameplay scene exists, and it stays useful whenever a pose
 * is retuned.
 */
import type { SheetManifest } from "../render/SpriteAnimator";
import type { AttractScene } from "./AttractScene";

export interface LabHandle {
  dispose(): void;
}

export function mountPoseLab(parent: HTMLElement, scene: AttractScene, manifest: SheetManifest): LabHandle {
  const panel = document.createElement("div");
  panel.className = "dili-lab";
  const head = document.createElement("header");
  head.innerHTML = `<strong>Pose lab</strong><span>${manifest.frameCount} frames · cell ${manifest.cell}px</span>`;
  const grid = document.createElement("div");
  grid.className = "dili-lab__grid";
  const readout = document.createElement("output");
  readout.className = "dili-lab__readout";

  const buttons = new Map<string, HTMLButtonElement>();
  for (const [name, spec] of Object.entries(manifest.states)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = name;
    btn.title = `${spec.count} frames @ ${spec.fps}fps${spec.loop ? " · loop" : " · once"}`;
    btn.addEventListener("click", () => {
      scene.setPose(name);
      for (const [, other] of buttons) other.classList.toggle("is-active", other === btn);
    });
    buttons.set(name, btn);
    grid.append(btn);
  }
  const auto = document.createElement("button");
  auto.type = "button";
  auto.textContent = "attract";
  auto.className = "is-active";
  auto.addEventListener("click", () => {
    scene.setPose(null);
    for (const [, other] of buttons) other.classList.remove("is-active");
    auto.classList.add("is-active");
  });
  grid.prepend(auto);

  panel.append(head, grid, readout);
  parent.append(panel);

  let raf = 0;
  const tick = (): void => {
    raf = requestAnimationFrame(tick);
    const info = scene.debugInfo();
    readout.textContent = `${info.state} · frame ${info.frame} · sheet #${info.index} · ${(info.progress * 100) | 0}%${info.finished ? " · done" : ""}`;
  };
  tick();

  return {
    dispose(): void {
      cancelAnimationFrame(raf);
      panel.remove();
      scene.setPose(null);
    },
  };
}
