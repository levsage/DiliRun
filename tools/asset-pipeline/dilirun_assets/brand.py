"""Brand asset generation: logo variants, app icons and the in-game coin.

The logo is used exactly as uploaded (it is a white mark on transparency), so the
pipeline emits tinted variants instead of redrawing it. Tinting keeps the source
alpha and swaps the RGB, which is all the game needs to place the mark on light or
dark surfaces.
"""

from __future__ import annotations

import math
import os

import cv2
import numpy as np

from .util import load_rgba, save_rgba, trim


def tint(rgba: np.ndarray, rgb: tuple[int, int, int]) -> np.ndarray:
    out = np.zeros_like(rgba)
    out[..., 0] = rgb[0]
    out[..., 1] = rgb[1]
    out[..., 2] = rgb[2]
    out[..., 3] = rgba[..., 3]
    return out


def hex_rgb(value: str) -> tuple[int, int, int]:
    v = value.lstrip("#")
    return (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16))


def logo_variants(src_path: str, out_dir: str, theme: dict) -> dict[str, int]:
    os.makedirs(out_dir, exist_ok=True)
    logo, _ = trim(load_rgba(src_path), pad=6)
    info = {"width": int(logo.shape[1]), "height": int(logo.shape[0])}
    colors = theme["colors"]
    variants = {
        "logo-white.png": hex_rgb(colors["white"]),
        "logo-navy.png": hex_rgb(colors["navy"]),
        "logo-cyan.png": hex_rgb(colors["cyan"]),
        "logo-gold.png": hex_rgb(colors["gold"]),
    }
    for name, rgb in variants.items():
        save_rgba(tint(logo, rgb), os.path.join(out_dir, name))
    info["variants"] = sorted(variants)
    return info


def rounded_rect_mask(w: int, h: int, radius: int) -> np.ndarray:
    m = np.zeros((h, w), np.uint8)
    cv2.rectangle(m, (radius, 0), (w - radius, h), 255, -1)
    cv2.rectangle(m, (0, radius), (w, h - radius), 255, -1)
    cv2.circle(m, (radius, radius), radius, 255, -1)
    cv2.circle(m, (w - radius, radius), radius, 255, -1)
    cv2.circle(m, (radius, h - radius), radius, 255, -1)
    cv2.circle(m, (w - radius, h - radius), radius, 255, -1)
    return m


def app_icon(logo: np.ndarray, size: int, theme: dict, padding: float = 0.19, maskable: bool = False) -> np.ndarray:
    """Gradient squircle tile carrying the Dliicom mark — used for icons + favicon."""
    c = theme["colors"]
    top = np.array(hex_rgb(c["sky"]), np.float32)
    bot = np.array(hex_rgb(c["navy"]), np.float32)
    ramp = np.linspace(0.0, 1.0, size, dtype=np.float32)[:, None]
    grad = (top[None, None, :] * (1 - ramp[..., None]) + bot[None, None, :] * ramp[..., None]).astype(np.uint8)
    img = np.dstack([np.broadcast_to(grad[0], (size, size, 3)), np.full((size, size, 1), 255, np.uint8)])

    # soft diagonal light sweep so flat icons still read as "premium"
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    sweep = np.clip(1.0 - np.abs((xx + yy) / (2 * size) - 0.42) * 5.0, 0, 1)
    img[..., :3] = np.clip(img[..., :3].astype(np.float32) + sweep[..., None] * 26.0, 0, 255).astype(np.uint8)

    scale = 1.0 - 2 * padding
    side = int(size * scale)
    mark = cv2.resize(logo, (side, max(1, int(side * logo.shape[0] / logo.shape[1]))), interpolation=cv2.INTER_AREA)
    x = (size - mark.shape[1]) // 2
    y = (size - mark.shape[0]) // 2
    region = img[y : y + mark.shape[0], x : x + mark.shape[1]].astype(np.float32)
    a = mark[..., 3:4].astype(np.float32) / 255.0
    img[y : y + mark.shape[0], x : x + mark.shape[1], :3] = (mark[..., :3] * a + region[..., :3] * (1 - a)).astype(np.uint8)

    mask = rounded_rect_mask(size, size, int(size * (0.0 if maskable else 0.22)))
    out = img.copy()
    out[..., 3] = mask
    return out


def write_icons(logo_src: str, out_dir: str, theme: dict) -> None:
    os.makedirs(out_dir, exist_ok=True)
    logo, _ = trim(load_rgba(logo_src), pad=4)
    for size in (512, 192, 96, 64, 32):
        save_rgba(app_icon(logo, size, theme), os.path.join(out_dir, f"icon-{size}.png"), optimize=False)
    save_rgba(app_icon(logo, 512, theme, padding=0.28, maskable=True), os.path.join(out_dir, "icon-maskable-512.png"), optimize=False)


def coin_frames(cell: int, frames: int, logo: np.ndarray, theme: dict) -> list[np.ndarray]:
    """Spinning coin with the brand mark engraved, one frame per rotation step."""
    c = theme["colors"]
    gold, gold_deep, gold_dark = hex_rgb(c["gold"]), hex_rgb(c["goldDeep"]), hex_rgb(c["goldEdge"])
    ink = hex_rgb(c["ink"])
    out: list[np.ndarray] = []
    for i in range(frames):
        phase = i / frames
        sx = math.cos(phase * math.tau)
        w = max(0.10, abs(sx))
        face = _coin_face(cell, gold, gold_deep, gold_dark, ink, logo, 1.0 if abs(sx) > 0.35 else 0.55)
        tw = max(3, int(round(cell * w)))
        squashed = cv2.resize(face, (tw, cell), interpolation=cv2.INTER_AREA)
        canvas = np.zeros((cell, cell, 4), np.uint8)
        x = (cell - tw) // 2
        canvas[:, x : x + tw] = squashed
        if sx < 0:  # back side: slightly darker, mark mirrored
            canvas[..., :3] = (canvas[..., :3].astype(np.float32) * 0.86).astype(np.uint8)
            canvas = cv2.flip(canvas, 1)
        out.append(canvas)
    return out


def _coin_face(
    cell: int,
    gold: tuple[int, int, int],
    gold_deep: tuple[int, int, int],
    gold_dark: tuple[int, int, int],
    ink: tuple[int, int, int],
    logo: np.ndarray,
    mark_alpha: float,
) -> np.ndarray:
    img = np.zeros((cell, cell, 4), np.uint8)
    r = int(cell * 0.46)
    yy, xx = np.mgrid[0:cell, 0:cell].astype(np.float32)
    cx = cy = cell / 2
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / r
    shade = np.clip(1.18 - 0.42 * d, 0, 1.35)
    base = np.array(gold, np.float32)[None, None, :] * shade[..., None]
    ring = (np.abs(d - 0.80) < 0.075)[..., None]
    base = base * (1 - ring) + np.array(gold_deep, np.float32)[None, None, :] * ring
    edge = (np.abs(d - 1.0) < 0.06)[..., None]
    base = base * (1 - edge) + np.array(gold_dark, np.float32)[None, None, :] * edge
    disc = (d <= 1.0).astype(np.float32)
    base *= disc[..., None]
    # specular streak on the upper-left
    spec = np.clip(1.0 - np.sqrt(((xx - cell * 0.34) ** 2 + (yy - cell * 0.30) ** 2)) / (cell * 0.30), 0, 1)
    base = base + spec[..., None] * np.array([70, 62, 30], np.float32) * disc[..., None]
    img[..., :3] = np.clip(base, 0, 255).astype(np.uint8)
    img[..., 3] = (disc * 255).astype(np.uint8)

    # engraved brand mark (square-padded so a wide lockup still centres on the disc)
    size = int(cell * 0.5)
    side = max(logo.shape[:2])
    padded = np.zeros((side, side, 4), np.uint8)
    y0 = (side - logo.shape[0]) // 2
    x0 = (side - logo.shape[1]) // 2
    padded[y0 : y0 + logo.shape[0], x0 : x0 + logo.shape[1]] = logo
    mark = cv2.resize(padded, (size, size), interpolation=cv2.INTER_AREA)
    mx, my = (cell - mark.shape[1]) // 2, (cell - mark.shape[0]) // 2
    a = (mark[..., 3:4].astype(np.float32) / 255.0) * disc[my : my + mark.shape[0], mx : mx + mark.shape[1]][..., None] * mark_alpha
    region = img[my : my + mark.shape[0], mx : mx + mark.shape[1], :3].astype(np.float32)
    inked = np.array(ink, np.float32)[None, None, :]
    img[my : my + mark.shape[0], mx : mx + mark.shape[1], :3] = (inked * a + region * (1 - a)).astype(np.uint8)
    return img


def write_coin_sheet(logo_src: str, out_dir: str, theme: dict, cell: int = 128, frames: int = 12) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    logo, _ = trim(load_rgba(logo_src), pad=4)
    fr = coin_frames(cell, frames, logo, theme)
    strip = np.hstack(fr)
    save_rgba(strip, os.path.join(out_dir, "coin-sheet.png"), optimize=False)
    manifest = {
        "format": "dilirun-strip-v1",
        "image": "coin-sheet.png",
        "cell": cell,
        "frames": frames,
        "fps": 14,
        "loop": True,
    }
    from .util import write_json

    write_json(os.path.join(out_dir, "coin-sheet.json"), manifest)
    return manifest
