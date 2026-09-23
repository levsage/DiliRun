#!/usr/bin/env python3
"""DiliRun asset pipeline — turns the uploaded brand art into game sprites.

Usage
-----
    python tools/asset-pipeline/build.py                      # use sources in assets/source
    python tools/asset-pipeline/build.py --character c.png --logo l.png --copy-sources
    python tools/asset-pipeline/build.py --debug              # extra contact sheets + GIF

Outputs (committed, so the site works with no local tooling):
    public/assets/sprites/dilirun-hero-sheet.png|.json
    public/assets/sprites/coin-sheet.png|.json
    public/assets/ui/logo-*.png, hero-cutout.png
    public/icons/icon-*.png
    public/assets/manifest.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dilirun_assets import brand, genframes, qa, spritesheet  # noqa: E402
from dilirun_assets.util import contact_sheet, load_rgba, save_rgba, upscale_preview  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PATHS = {
    "character_src": os.path.join(REPO, "assets", "source", "hero_source.png"),
    "logo_src": os.path.join(REPO, "assets", "source", "dliicom_logo.png"),
    "rig_cfg": os.path.join(REPO, "tools", "asset-pipeline", "config", "rig.json"),
    "frames_cfg": os.path.join(REPO, "tools", "asset-pipeline", "config", "frames.json"),
    "generated": os.path.join(REPO, "assets", "source", "generated"),
    "theme": os.path.join(REPO, "src", "game", "data", "theme.json"),
    "sprites": os.path.join(REPO, "public", "assets", "sprites"),
    "ui": os.path.join(REPO, "public", "assets", "ui"),
    "icons": os.path.join(REPO, "public", "icons"),
    "manifest": os.path.join(REPO, "public", "assets", "manifest.json"),
    "debug": os.path.join(REPO, "tools", "asset-pipeline", "out"),
    "docs_preview": os.path.join(REPO, "docs", "preview"),
}


def sha(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


def copy_sources(character: str, logo: str, max_width: int = 1400, quantize_to: int = 0) -> None:
    """Store a compact, resolution-independent copy of the uploads in the repo.

    The master is stored as opaque RGB (the uploads are art on a solid background) and
    capped at ``max_width``: rig coordinates are normalised, so downsizing never changes
    the cut. ``--quantize 256`` additionally squeezes a flat-colour master into a palette
    PNG for a lighter repo — it costs a little gradient fidelity, hence opt-in.
    """
    os.makedirs(os.path.dirname(PATHS["character_src"]), exist_ok=True)
    img = Image.open(character).convert("RGB")
    if img.width > max_width:
        img = img.resize((max_width, int(img.height * max_width / img.width)), Image.LANCZOS)
    if quantize_to:
        img = img.quantize(colors=quantize_to, method=Image.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
    img.save(PATHS["character_src"], optimize=True)

    lg = Image.open(logo).convert("RGBA")
    if lg.width > 900:
        lg = lg.resize((900, int(lg.height * 900 / lg.width)), Image.LANCZOS)
    lg.save(PATHS["logo_src"], optimize=True)
    print(f"sources copied -> {PATHS['character_src']} ({img.width}x{img.height}), {PATHS['logo_src']} ({lg.width}x{lg.height})")


def _extract_state(rgb: np.ndarray, name: str, spec: dict, cfg: dict, cell: int) -> tuple[list, np.ndarray, dict]:
    """Cells, the diagnostic mask and raw sizes for one part of one state."""
    return genframes.extract(
        rgb,
        genframes.CellSpec(
            state=name,
            image=spec.get("image", ""),
            fps=float(spec["fps"]),
            loop=bool(spec.get("loop", False)),
            hold=spec.get("hold"),
            cells=tuple(spec["cells"]) if spec.get("cells") else None,
            expect=spec.get("expect"),
            clip=tuple(spec["clip"]) if spec.get("clip") else None,
        ),
        cell=cell,
        figure_height=float(spec.get("figureHeight", cfg.get("figureHeight", 0.82))),
        anchor_y=spritesheet.ANCHOR_Y,
        green_margin=float(cfg.get("greenMargin", 8.0)),
        line_fill=float(cfg.get("lineFill", 0.75)),
        min_area=int(cfg.get("minArea", 900)),
    )


def frame_overrides(cfg_path: str, cell: int, debug_dir: str) -> tuple[dict, dict, dict]:
    """Pre-rendered cells for the states that need real key poses, plus their timing metadata.

    The rig can only rotate a limb about its hinge; a run cycle needs a bending knee, a contact
    frame and a pass frame. Those states come from generated artwork instead (see
    ``dilirun_assets/genframes.py``), keyed, split and normalised into the same cells the rig emits.
    Every other state stays animated from the uploaded illustration. A state may be assembled from
    several sheets (``parts``), which is how a 6-frame cycle is authored as two 3-pose rows.
    """
    cfg = json.load(open(cfg_path, encoding="utf-8"))
    frames: dict[str, list] = {}
    meta: dict[str, dict] = {}
    stats: dict[str, dict] = {}
    if not cfg.get("states"):
        return frames, meta, stats
    root = os.path.join(REPO, cfg.get("dir", "assets/source/generated"))
    if not os.path.isdir(root):
        raise SystemExit(f"frames.json asks for generated poses but {root} does not exist")
    for name, spec in cfg["states"].items():
        parts = spec["parts"] if spec.get("parts") else [spec]
        cells: list = []
        heights: list[int] = []
        widths: list[int] = []
        clipped: list[int] = []
        healed: tuple[int, ...] = ()
        for n, part in enumerate(parts):
            path = os.path.join(root, part["image"])
            if not os.path.exists(path):
                raise SystemExit(
                    f"generated pose sheet missing for state '{name}': {path}\n"
                    "Either restore it (docs/ASSETS.md \u00a78 says how these are made) or drop that state "
                    "from config/frames.json to fall back to the rig."
                )
            merged = {**spec, **part}
            sub_cells, mask, raw = _extract_state(load_rgba(path)[..., :3].copy(), name, merged, cfg, cell)
            cells.extend(sub_cells)
            heights += raw["figure_heights"]
            widths += raw["figure_widths"]
            clipped += raw.get("clipped", [])
            healed += (raw.get("healed_rows", 0), raw.get("healed_cols", 0))
            if len(parts) > 1:
                cv2.imwrite(os.path.join(debug_dir, f"mask-{name}-{n}.png"), mask)
        frames[name] = cells
        meta[name] = {
            "fps": float(spec["fps"]),
            "loop": bool(spec.get("loop", False)),
            "hold": spec.get("hold"),
        }
        st = genframes.cell_stats(cells)
        # Measured on the *raw* bboxes: once a figure is normalised into a cell every frame is the
        # same height by construction, so only the pre-scale numbers can reveal a clipped pose.
        st["raw_spread"] = (max(heights) / max(1, min(heights))) if heights else 1.0
        st["width_spread"] = (max(widths) / max(1, min(widths))) if widths else 1.0
        st["healed"] = sum(healed)
        st["clipped"] = len(clipped)
        st["consistency"] = bool(spec.get("consistency", True))
        stats[name] = st
    return frames, meta, stats


def write_debug(bake: spritesheet.HeroBake, out_dir: str, docs_preview: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    # 1. rig parts (QA: are the cuts where they should be?)
    parts = bake.parts_debug
    cell = bake.stage.cell
    tiles = []
    for name, img in parts.items():  # noqa: B007
        t = np.zeros((cell, cell, 4), np.uint8)
        fit = min(cell / max(1, img.shape[1]), cell / max(1, img.shape[0]))
        if fit != 1.0:
            img = cv2.resize(img, (max(1, int(img.shape[1] * fit)), max(1, int(img.shape[0] * fit))), interpolation=cv2.INTER_AREA)
        t[: img.shape[0], : img.shape[1]] = img
        tiles.append(t)
    if tiles:
        sheet = contact_sheet(tiles, cols=4)
        Image.fromarray(sheet).save(os.path.join(out_dir, "rig-parts.png"))
    # 2. every state, one row per state
    rows = []
    for name, frames in bake.state_frames.items():
        for f in frames:
            rows.append(cv2.resize(f, (160, 160), interpolation=cv2.INTER_AREA))
    if rows:
        big = contact_sheet(rows, cols=max(len(v) for v in bake.state_frames.values()))
        Image.fromarray(big).save(os.path.join(out_dir, "frames-contact-sheet.png"))
    # 3. animated preview for the docs
    preview_states = ["idle", "run", "jump", "slide", "roll", "victory", "dash", "stumble"]
    states = [s for s in preview_states if s in bake.state_frames]
    frames = [bake.state_frames[s] for s in states]
    n = max(len(f) for f in frames)
    size = 150
    cols = 4
    gif_frames = []
    for i in range(n):
        tiles = []
        for fr in frames:
            src = fr[min(i, len(fr) - 1)]
            tiles.append(cv2.resize(src, (size, size), interpolation=cv2.INTER_AREA))
        while len(tiles) < len(frames):
            tiles.append(np.zeros((size, size, 4), np.uint8))
        grid_rows = (len(tiles) + cols - 1) // cols
        canvas = np.full((grid_rows * (size + 22) + 8, cols * (size + 8) + 8, 4), 246, np.uint8)
        canvas[:] = (246, 248, 252, 255)
        for j, tile in enumerate(tiles):
            r, c = divmod(j, cols)
            y, x = 22 + r * (size + 22), 8 + c * (size + 8)
            a = tile[..., 3:4].astype(np.float32) / 255.0
            canvas[y : y + size, x : x + size, :3] = (
                tile[..., :3] * a + canvas[y : y + size, x : x + size, :3] * (1 - a)
            ).astype(np.uint8)
            cv2.putText(canvas, states[j], (x + 2, y - 6), 0, 0.46, (30, 40, 60, 255), 1, cv2.LINE_AA)
        gif_frames.append(Image.fromarray(canvas[..., :3]).convert("P", palette=Image.ADAPTIVE))
    if gif_frames:
        os.makedirs(docs_preview, exist_ok=True)
        gif_frames[0].save(
            os.path.join(docs_preview, "animation-preview.gif"),
            save_all=True,
            append_images=gif_frames[1:],
            duration=110,
            loop=0,
            optimize=True,
        )
        gif_frames[0].save(os.path.join(docs_preview, "animation-preview.png"))
    print(f"debug artefacts -> {out_dir}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Build DiliRun game art from the uploaded brand assets.")
    ap.add_argument("--character", default=PATHS["character_src"], help="hero illustration (PNG/JPG)")
    ap.add_argument("--logo", default=PATHS["logo_src"], help="Dliicom logo (white-on-transparent PNG)")
    ap.add_argument("--cell", type=int, default=384, help="sprite cell size in px")
    ap.add_argument("--copy-sources", action="store_true", help="normalise the given uploads into assets/source first")
    ap.add_argument("--quantize", type=int, default=0, metavar="COLORS", help="palette-quantise the stored hero master (e.g. 256) to shrink the repo")
    ap.add_argument("--debug", action="store_true", help="also write contact sheets + docs GIF")
    ap.add_argument("--min-iou", type=float, default=0.96, help="fail the build if the rest pose drifts from the source art")
    ap.add_argument("--frames-config", default=PATHS["frames_cfg"], help="JSON describing generated key-pose sheets")
    ap.add_argument("--no-frames", action="store_true", help="rig-only build: ignore config/frames.json")
    args = ap.parse_args()

    if args.copy_sources:
        copy_sources(args.character, args.logo, quantize_to=args.quantize)

    theme = json.load(open(PATHS["theme"], encoding="utf-8"))
    character = args.character if os.path.isabs(args.character) else os.path.join(REPO, args.character)
    logo = args.logo if os.path.isabs(args.logo) else os.path.join(REPO, args.logo)

    overrides: dict[str, list] = {}
    override_meta: dict[str, dict] = {}
    if not args.no_frames and os.path.exists(args.frames_config):
        print(":: generated key poses")
        overrides, override_meta, stats = frame_overrides(args.frames_config, args.cell, PATHS["debug"])
        os.makedirs(PATHS["debug"], exist_ok=True)
        strip_rows = []
        for name, cells in overrides.items():
            s = stats[name]
            print(
                f"   {name:6s} {len(cells)} cells  coverage {s['coverage']:.2f}  "
                f"raw height spread {s['raw_spread']:.2f}  width spread {s['width_spread']:.2f}  "
                f"clipped {s['clipped']}  "
                f"lines healed {s['healed']}"
            )
            strip_rows.append(genframes.review_strip(cells, args.cell))
            # Coverage catches the two silent failures: a cell that is mostly empty (the figure was
            # eaten by the key or clipped by a grid line) and a cell that overflows (wrong scale).
            if not (0.08 <= s["coverage"] <= 0.85):
                print(f"   FAIL: '{name}' covers {s['coverage']:.2f} of each cell \u2014 the key is eating the art or the pose is clipped. See {PATHS['debug']}/mask-{name}.png", file=sys.stderr)
                return 1
            # Height consistency only makes sense for states that must not change silhouette; a slide
            # or a landing is *supposed* to get shorter, so those opt out via frames.json.
            # A figure touching the crop edge lost a limb to the sheet's own frame; that is a real
            # defect. A plain size difference between poses is not, because normalisation equalises it.
            if s["clipped"]:
                print(
                    f"   FAIL: '{name}' has {s['clipped']} figure(s) touching the crop edge \u2014 the sheet "
                    "clips a pose, or two poses are close enough that grouping swallowed one",
                    file=sys.stderr,
                )
                return 1
            if s.get("consistency", True) and s["raw_spread"] > 2.2:
                print(f"   FAIL: '{name}' figures differ in height by {s['raw_spread']:.2f}x before normalisation \u2014 a pose is clipped or the sheet is inconsistent", file=sys.stderr)
                return 1
        if strip_rows:
            wide = max(r.shape[1] for r in strip_rows)
            tall = sum(r.shape[0] for r in strip_rows) + 8 * (len(strip_rows) - 1)
            canvas = np.zeros((tall, wide, 4), np.uint8)
            y0 = 0
            for r in strip_rows:
                canvas[y0 : y0 + r.shape[0], : r.shape[1]] = r
                y0 += r.shape[0] + 8
            save_rgba(canvas, os.path.join(PATHS["debug"], "frames-raw.png"), optimize=True)

    print(":: hero rig -> sprite sheet")
    bake = spritesheet.bake(
        character, PATHS["rig_cfg"], PATHS["sprites"], cell=args.cell,
        frame_overrides=overrides or None, override_meta=override_meta or None,
    )
    print(f"   sheet {bake.sheet.shape[1]}x{bake.sheet.shape[0]} px, "
          f"{bake.manifest['frameCount']} frames, {len(bake.manifest['states'])} states")

    print(":: quality gates")
    iou, diff = qa.reconstruction_iou(bake.rig.render_pose({}, None), np.dstack([np.zeros_like(bake.expected_rest)] * 3 + [bake.expected_rest]))
    overlap = qa.part_overlaps(bake.parts_debug)
    worst = max(overlap, key=lambda k: overlap[k]) if overlap else "-"
    print(f"   rest-pose reconstruction IoU: {iou:.4f} (gate >= {args.min_iou})")
    print(f"   max joint overlap between parts: {overlap[worst]:.3f} on '{worst}'")
    if iou < args.min_iou:
        print(f"   FAIL: the rig does not reproduce the source art. See {PATHS['debug']}/qa-diff.png", file=sys.stderr)
        os.makedirs(PATHS["debug"], exist_ok=True)
        cv2.imwrite(os.path.join(PATHS["debug"], "qa-diff.png"), diff)
        return 1
    cv2.imwrite(os.path.join(PATHS["debug"], "qa-diff.png"), diff)

    print(":: brand marks + icons")
    logo_info = brand.logo_variants(logo, PATHS["ui"], theme)
    brand.write_icons(logo, PATHS["icons"], theme)
    coin = brand.write_coin_sheet(logo, PATHS["sprites"], theme, cell=128, frames=12)

    print(":: hero cut-out for menus")
    idle = bake.state_frames["idle"][0]
    save_rgba(idle, os.path.join(PATHS["ui"], "hero-idle.png"), optimize=True)
    head = cv2.resize(idle, (idle.shape[1] // 2, idle.shape[0] // 2), interpolation=cv2.INTER_AREA)
    save_rgba(np.ascontiguousarray(head), os.path.join(PATHS["ui"], "hero-portrait.png"), optimize=True)

    manifest = {
        "format": "dilirun-assets-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generator": "tools/asset-pipeline/build.py",
        "hero": {"sprite": "sprites/dilirun-hero-sheet.webp", "meta": "sprites/dilirun-hero-sheet.json"},
        "coin": {"sprite": "sprites/coin-sheet.png", "meta": "sprites/coin-sheet.json", **coin},
        "logo": {"white": "ui/logo-white.png", "navy": "ui/logo-navy.png", "cyan": "ui/logo-cyan.png",
                 "sourceSize": [logo_info["width"], logo_info["height"]]},
        "heroCuts": {"idle": "ui/hero-idle.png", "portrait": "ui/hero-portrait.png"},
        "icons": ["icons/icon-512.png", "icons/icon-192.png", "icons/icon-96.png", "icons/icon-64.png",
                  "icons/icon-32.png", "icons/icon-maskable-512.png"],
        "sources": {"hero": f"assets/source/hero_source.png#{sha(character)}",
                     "logo": f"assets/source/dliicom_logo.png#{sha(logo)}"},
    }
    os.makedirs(os.path.dirname(PATHS["manifest"]), exist_ok=True)
    with open(PATHS["manifest"], "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print(f":: manifest -> {os.path.relpath(PATHS['manifest'], REPO)}")

    if args.debug:
        write_debug(bake, PATHS["debug"], PATHS["docs_preview"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
