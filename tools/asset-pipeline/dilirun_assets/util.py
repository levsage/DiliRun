"""Shared helpers for the DiliRun asset pipeline.

The pipeline is intentionally dependency-light (numpy + Pillow + OpenCV) and
fully deterministic: given the same source images it always emits byte-identical
sprite sheets, so generated art can be reviewed in pull requests as a diff.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from typing import Any, Iterable

import cv2
import numpy as np
from PIL import Image

Image.registered_extensions()  # ensure png/jpeg handlers present


@dataclass
class Part:
    """One rigid piece of the character that the rig can move independently.

    Geometry is expressed in *normalised* source-image coordinates (0..1) so the
    same rig definition works at any source resolution.
    """

    name: str
    rect: tuple[float, float, float, float]  # x0, y0, x1, y1 normalised
    pivot: tuple[float, float]  # normalised rotation hinge
    z: int
    overlap: float = 0.0  # how far the piece extends past its rect (normalised)
    joints: list[tuple[float, float, float]] = field(default_factory=list)  # x, y, radius patches
    mirror_of: str | None = None

    def rect_px(self, w: int, h: int, grow: float = 0.0) -> tuple[int, int, int, int]:
        return self.rect_px_static(self.rect, w, h, grow)

    @staticmethod
    def rect_px_static(rect: tuple[float, float, float, float], w: int, h: int, grow: float = 0.0) -> tuple[int, int, int, int]:
        x0, y0, x1, y1 = rect
        x0, x1 = min(x0, x1) - grow, max(x0, x1) + grow
        y0, y1 = min(y0, y1) - grow, max(y0, y1) + grow
        return (
            max(0, int(round(x0 * w))),
            max(0, int(round(y0 * h))),
            min(w, int(round(x1 * w))),
            min(h, int(round(y1 * h))),
        )

    def pivot_px(self, w: int, h: int) -> tuple[float, float]:
        return (self.pivot[0] * w, self.pivot[1] * h)


def load_rgba(path: str | os.PathLike[str]) -> np.ndarray:
    """Load an image as ``H x W x 4`` uint8 RGBA array."""
    img = Image.open(path).convert("RGBA")
    return np.asarray(img, dtype=np.uint8)


def save_rgba(arr: np.ndarray, path: str | os.PathLike[str], optimize: bool = True) -> None:
    os.makedirs(os.path.dirname(str(path)), exist_ok=True)
    Image.fromarray(arr, "RGBA").save(path, optimize=optimize)


def to_float(arr: np.ndarray) -> np.ndarray:
    return arr.astype(np.float32) / 255.0


def alpha_composite(dst: np.ndarray, src: np.ndarray) -> np.ndarray:
    """Composite ``src`` (RGBA float 0..1) over ``dst`` in place-ish, premultiplied-free."""
    a = src[..., 3:4]
    out = dst.copy()
    out[..., :3] = src[..., :3] * a + dst[..., :3] * (1.0 - a)
    out[..., 3:4] = a + dst[..., 3:4] * (1.0 - a)
    return out


def trim(rgba: np.ndarray, pad: int = 0) -> tuple[np.ndarray, tuple[int, int]]:
    """Crop fully transparent borders, returning the image and the top-left offset."""
    alpha = rgba[..., 3]
    ys, xs = np.nonzero(alpha > 8)
    if len(xs) == 0:
        return rgba, (0, 0)
    x0, x1 = xs.min(), xs.max() + 1
    y0, y1 = ys.min(), ys.max() + 1
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(rgba.shape[1], x1 + pad), min(rgba.shape[0], y1 + pad)
    return rgba[y0:y1, x0:x1].copy(), (int(x0), int(y0))


def solid_rgba(size: tuple[int, int], color: tuple[int, int, int, int]) -> np.ndarray:
    w, h = size
    arr = np.zeros((h, w, 4), np.uint8)
    arr[:] = color
    return arr


def write_json(path: str | os.PathLike[str], data: Any, sort_keys: bool = True) -> None:
    os.makedirs(os.path.dirname(str(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, sort_keys=sort_keys)
        fh.write("\n")


def read_json(path: str | os.PathLike[str]) -> Any:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def rotation_matrix(angle_deg: float) -> np.ndarray:
    """Screen-space clockwise rotation (image coordinates, y grows downwards)."""
    a = math.radians(angle_deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s], [s, c]], dtype=np.float32)


def warp_part(
    part_img: np.ndarray,
    part_origin: tuple[float, float],
    pivot: tuple[float, float],
    canvas_wh: tuple[int, int],
    angle: float = 0.0,
    offset: tuple[float, float] = (0.0, 0.0),
    scale: tuple[float, float] = (1.0, 1.0),
) -> np.ndarray:
    """Transform a cropped part and paint it onto a ``canvas_wh`` sized RGBA layer.

    ``pivot`` and ``offset`` are in canvas coordinates. The rotation and scaling
    happen around ``pivot``; ``offset`` is applied afterwards.
    """
    R = rotation_matrix(angle)
    S = np.diag(np.array(scale, dtype=np.float32))
    A = S @ R  # rotate around the hinge first, then squash/stretch
    # Destination of a part-local point p:  A * (p + origin - pivot) + pivot + offset
    origin = np.array(part_origin, dtype=np.float32)
    piv = np.array(pivot, dtype=np.float32)
    b = A @ (origin - piv) + piv + np.array(offset, dtype=np.float32)
    M = np.hstack([A, b.reshape(2, 1)]).astype(np.float32)
    return cv2.warpAffine(
        part_img.astype(np.float32) / 255.0,
        M,
        (int(canvas_wh[0]), int(canvas_wh[1])),
        flags=cv2.INTER_LINEAR,
        borderValue=(0, 0, 0, 0),
    )


def draw_joints(
    canvas: np.ndarray,
    joints: Iterable[tuple[float, float, float]],
    color: tuple[int, int, int, int],
    scale: float,
    offset: tuple[float, float] = (0.0, 0.0),
    pivot: tuple[float, float] | None = None,
    angle: float = 0.0,
) -> None:
    """Paint soft patches under a part so rotating limbs never reveal a hole."""
    for jx, jy, jr in joints:
        x, y = jx * scale + offset[0], jy * scale + offset[1]
        if pivot is not None and abs(angle) > 1e-3:
            v = np.array([jx - pivot[0], jy - pivot[1]], dtype=np.float32) * scale
            v = rotation_matrix(angle) @ v
            x, y = pivot[0] + v[0], pivot[1] + v[1]
        cv2.circle(canvas.astype(np.uint8), (int(round(x)), int(round(y))), int(round(jr * scale)), color, -1)


def upscale_preview(img: np.ndarray, width: int) -> np.ndarray:
    return cv2.resize(img, (width, int(img.shape[0] * width / img.shape[1])), interpolation=cv2.INTER_AREA)


def contact_sheet(
    frames: list[np.ndarray],
    cols: int,
    label_each: bool = True,
    bg: tuple[int, int, int, int] = (250, 250, 252, 255),
) -> np.ndarray:
    """Lay frames out on a grid for quick visual QA (saved as a debug artefact)."""
    if not frames:
        raise ValueError("no frames")
    ch, cw = frames[0].shape[:2]
    rows = math.ceil(len(frames) / cols)
    sheet = np.zeros((rows * (ch + 26), cols * (cw + 6), 4), np.uint8)
    sheet[:] = bg
    for i, fr in enumerate(frames):
        r, c = divmod(i, cols)
        y, x = r * (ch + 26) + 26, c * (cw + 6)
        a = fr[..., 3:4].astype(np.float32) / 255.0
        region = sheet[y : y + ch, x : x + cw]
        region[..., :3] = (fr[..., :3] * a + region[..., :3] * (1 - a)).astype(np.uint8)
        if label_each:
            cv2.putText(sheet, str(i), (x + 4, y - 8), 0, 0.7, (20, 20, 30, 255), 2, cv2.LINE_AA)
    return sheet
