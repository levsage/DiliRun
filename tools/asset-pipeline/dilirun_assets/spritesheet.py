"""Bakes rig poses into the sprite sheet + manifest consumed by the game."""

from __future__ import annotations

import math
import os
from dataclasses import dataclass

import cv2
import numpy as np

from .poses import ALIASES, BASE, SHEET_ORDER, STATES
from .rig import Rig, RigPart, Stage, sample_pose
from .segment import build_silhouette, extract_part, mean_suit_colour, scaled_canvas, stroke_mask
from .util import Part, load_rgba, read_json, write_json

# The hero art is resampled to this height before any ink detection happens, so
# stroke thresholds behave identically for a 600px upload and a 6000px upload.
ANALYSIS_HEIGHT = 1600.0

#: Where the ground contact sits inside a cell. Generated pose cells are placed on the *same*
#: line, which is the only reason the two sources can share one sheet.
ANCHOR_Y = 0.955


@dataclass
class HeroBake:
    sheet: np.ndarray
    manifest: dict
    parts_debug: dict[str, np.ndarray]
    state_frames: dict[str, list[np.ndarray]]
    stage: Stage
    rig: Rig
    expected_rest: np.ndarray  # silhouette the rest pose must reproduce (QA gate)


def load_rig(
    source_img: np.ndarray,
    rig_cfg: dict,
    final_cell: int,
    supersample: float = 2.0,
) -> tuple[Rig, dict[str, np.ndarray], Stage, np.ndarray]:
    """Cut the hero into rig parts, ready to be posed in render space.

    Two resamples total, both intentional: the source is normalised to
    ``ANALYSIS_HEIGHT`` for reliable ink detection, then downscaled into the
    supersampled canvas. Parts are crops of that single canvas, so overlapping
    joints stay pixel-identical and the rest pose matches the drawing exactly.
    """
    h0, w0 = source_img.shape[:2]
    ah = float(rig_cfg.get("analysis_height", ANALYSIS_HEIGHT))
    a_scale = ah / h0
    img = cv2.resize(
        source_img,
        (max(1, int(round(w0 * a_scale))), int(ah)),
        interpolation=cv2.INTER_AREA if a_scale < 1 else cv2.INTER_LANCZOS4,
    )
    h, w = img.shape[:2]
    stroke = stroke_mask(img, scale=w / 1773.0)
    sil = build_silhouette(img, stroke)

    gx = rig_cfg["ground_point"][0] * w
    gy = rig_cfg["ground_point"][1] * h
    box = rig_cfg["character_box"]
    char_h_px = (box[3] - box[1]) * h
    cell = int(final_cell)
    headroom = 1.42  # square canvas big enough that a 360-degree roll never clips
    size = int(round(cell * supersample * headroom))
    char_h_frac = 0.88
    k = size * char_h_frac / char_h_px
    stage = Stage(size=size, cell=cell, k=k, ground=(gx, gy), anchor_y=ANCHOR_Y)

    canvas, _ = scaled_canvas(img, sil.fg, k)
    # The silhouette mapped exactly like a rig part, so the rest pose can be
    # compared against it pixel for pixel (see qa.reconstruction_iou).
    ox, oy = stage.place(0.0, 0.0)
    shifted = cv2.warpAffine(
        (canvas[..., 3] > 127).astype(np.uint8) * 255,
        np.float32([[1, 0, ox], [0, 1, oy]]),
        (stage.size, stage.size),
    )
    expected_rest = cv2.resize(shifted, (stage.cell, stage.cell), interpolation=cv2.INTER_AREA)
    parts: list[RigPart] = []
    debug: dict[str, np.ndarray] = {}
    for spec in rig_cfg["parts"]:
        part = Part(
            name=spec["name"],
            rect=tuple(spec["rect"]),  # type: ignore[arg-type]
            pivot=tuple(spec["pivot"]),  # type: ignore[arg-type]
            z=int(spec["z"]),
            joints=[tuple(j) for j in spec.get("joints", [])],  # type: ignore[misc]
        )
        crop, offset = extract_part(canvas, w, h, part.rect, k)
        if crop.shape[0] < 4 or crop.shape[1] < 4:
            raise ValueError(f"rig part '{part.name}' came out empty - check its rect / the silhouette")
        mask = (crop[..., 3] > 8).astype(np.uint8)
        pivot = stage.place(part.pivot[0] * w * k, part.pivot[1] * h * k)
        origin_render = stage.place(offset[0], offset[1])
        pivot_local = (pivot[0] - origin_render[0], pivot[1] - origin_render[1])
        fill = mean_suit_colour(crop, mask, around=pivot_local, radius=stage.unit(16))

        joints = [
            (*stage.place(jx * w * k, jy * h * k), stage.unit(jr)) for (jx, jy, jr) in part.joints
        ]
        parts.append(
            RigPart(
                part=part,
                img=crop.astype(np.float32) / 255.0,
                origin=stage.place(offset[0], offset[1]),
                pivot=pivot,
                joints=joints,  # type: ignore[arg-type]
                fill=fill,
            )
        )
        debug[part.name] = crop

    rig = Rig(parts, stage, body_fill=(105, 179, 233))
    return rig, debug, stage, expected_rest


def _compose(base: dict, pose: dict) -> dict:
    """Keyframes are authored as deltas on top of the state's base stance."""
    out = {name: dict(vals) for name, vals in pose.items()}
    for name, bvals in (base or {}).items():
        cur = out.setdefault(name, {"rot": 0.0, "pos": (0.0, 0.0), "scale": (1.0, 1.0)})
        cur["rot"] = float(cur.get("rot", 0.0)) + float(bvals.get("rot", 0.0))
        pos = cur.get("pos", (0.0, 0.0))
        bpos = bvals.get("pos", (0.0, 0.0))
        cur["pos"] = (float(pos[0]) + float(bpos[0]), float(pos[1]) + float(bpos[1]))
        sc = cur.get("scale", (1.0, 1.0))
        bsc = bvals.get("scale", (1.0, 1.0))
        cur["scale"] = (float(sc[0]) * float(bsc[0]), float(sc[1]) * float(bsc[1]))
    return out


def bake_state(rig: Rig, spec: dict) -> list[np.ndarray]:
    base = BASE.get(spec.get("base"), {}) if spec.get("base") else {}
    frames: list[np.ndarray] = []
    for i in range(int(spec["count"])):
        pose, glob = sample_pose(spec["keys"], float(i), bool(spec.get("loop", False)))
        frames.append(rig.render_pose(_compose(base, pose), glob or None))
    return frames


def pack_sheet(state_frames: dict[str, list[np.ndarray]], cell: int, cols: int) -> tuple[np.ndarray, dict, int]:
    """Place every state's frames back to back, row major, into one sheet."""
    names = list(state_frames)
    total = sum(len(state_frames[n]) for n in names)
    rows = math.ceil(total / cols)
    sheet = np.zeros((rows * cell, cols * cell, 4), np.uint8)
    layout: dict[str, dict] = {}
    i = 0
    for name in names:
        start = i
        for frame in state_frames[name]:
            c, r = i % cols, i // cols
            patch = np.zeros((cell, cell, 4), np.uint8)
            patch[: frame.shape[0], : frame.shape[1]] = frame
            sheet[r * cell : (r + 1) * cell, c * cell : (c + 1) * cell] = patch
            i += 1
        layout[name] = {"from": start, "count": len(state_frames[name])}
    return sheet, layout, rows


def write_sheet(sheet: np.ndarray, out_dir: str, base: str, quality: int = 96) -> dict:
    """Save the packed sheet as WebP (small, full alpha) plus a PNG sidecar."""
    os.makedirs(out_dir, exist_ok=True)
    from PIL import Image

    img = Image.fromarray(sheet, "RGBA")
    webp = os.path.join(out_dir, f"{base}.webp")
    png = os.path.join(out_dir, f"{base}.png")
    img.save(webp, format="WEBP", lossless=False, exact=True, quality=quality, method=6)
    img.save(png, optimize=True, compress_level=9)
    return {
        "webp": {"path": os.path.basename(webp), "bytes": os.path.getsize(webp)},
        "png": {"path": os.path.basename(png), "bytes": os.path.getsize(png)},
    }


def bake(
    source_path: str,
    rig_cfg_path: str,
    out_dir: str,
    cell: int = 384,
    keep_png: bool = False,
    frame_overrides: dict[str, list[np.ndarray]] | None = None,
    override_meta: dict[str, dict] | None = None,
) -> HeroBake:
    """Bake the hero sheet.

    ``frame_overrides`` replaces whole states with pre-rendered cells (see ``genframes``) —
    normally the generated key poses for run/jump/fall/slide/land. Anything not overridden is
    animated from the rig, and both paths land in the same cell size on the same anchor, which is
    why nothing downstream has to know the difference.
    """
    os.makedirs(out_dir, exist_ok=True)
    rig_cfg = read_json(rig_cfg_path)
    img = load_rgba(source_path)[..., :3].copy()
    rig, parts_debug, stage, expected_rest = load_rig(img, rig_cfg, cell)

    state_frames = {name: bake_state(rig, STATES[name]) for name in SHEET_ORDER}
    overrides = {k: v for k, v in (frame_overrides or {}).items() if k in state_frames}
    state_frames.update(overrides)
    sheet, layout, rows = pack_sheet(state_frames, stage.cell, cols=8)
    for name in layout:
        spec = (override_meta or {}).get(name) if name in overrides else None
        spec = spec or STATES[name]
        fps = float(spec["fps"])
        layout[name]["fps"] = int(fps) if fps.is_integer() else fps
        layout[name]["loop"] = bool(spec.get("loop", False))
        if spec.get("hold") is not None:
            layout[name]["hold"] = int(spec["hold"])
        layout[name]["source"] = "generated" if name in overrides else "rig"

    formats = write_sheet(sheet, out_dir, "dilirun-hero-sheet")
    png_path = os.path.join(out_dir, "dilirun-hero-sheet.png")
    if not keep_png and os.path.exists(png_path):
        os.remove(png_path)  # WebP only in the repo: 1.4 MB instead of 5 MB
    manifest = {
        "format": "dilirun-spritesheet-v1",
        "image": "dilirun-hero-sheet.webp",
        "imagePath": "sprites/dilirun-hero-sheet.webp",
        "fallbackImage": "dilirun-hero-sheet.png" if keep_png else None,
        "fallbackImagePath": "sprites/dilirun-hero-sheet.png" if keep_png else None,
        "cell": stage.cell,
        "columns": 8,
        "rows": rows,
        "frameCount": sum(v["count"] for v in layout.values()),
        "anchor": {"x": 0.5, "y": stage.anchor_y},
        "anchorNote": "fraction of the cell where the hero's ground contact sits",
        "states": layout,
        "aliases": {k: {"state": v[0], "frame": v[1]} for k, v in ALIASES.items()},
        "formats": formats,
    }
    # Authoring order matters for the manifest (the pose lab lists states in it),
    # so it is written unsorted while every other artefact stays diff friendly.
    write_json(os.path.join(out_dir, "dilirun-hero-sheet.json"), {k: v for k, v in manifest.items() if v is not None}, sort_keys=False)
    return HeroBake(
        sheet=sheet,
        manifest=manifest,
        parts_debug=parts_debug,
        state_frames=state_frames,
        stage=stage,
        rig=rig,
        expected_rest=expected_rest,
    )
