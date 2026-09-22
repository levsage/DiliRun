"""Segment the uploaded hero illustration into rigid pieces for the 2D rig.

Strategy
--------
The source art is hand-drawn cartoon with heavy dark outlines. That gives a very
reliable segmentation signal:

1. ``stroke mask``  = pixels that are locally much darker than their neighbourhood
   (robust: the suit and the background have nearly identical luminance, so an
   absolute threshold would fail) OR a strong luminance gradient.
2. Everything *enclosed* by strokes is a part interior. The background, the flat
   gradient and the cast shadow are reachable from the image border without
   crossing a stroke, so a flood fill on ``~stroke`` yields the silhouette.
3. Connected components inside the silhouette give natural part boundaries; the
   rig config then groups components into named parts by geometric rectangles.

The result is a cut-out plus one PNG per rig part, each with its own outline, so
limbs keep their ink lines when the rig rotates them.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .util import Part, trim


@dataclass
class Silhouette:
    fg: np.ndarray  # uint8 0/1 character silhouette (no cast shadow)
    stroke: np.ndarray  # uint8 0/255 outline/barrier mask
    bbox: tuple[int, int, int, int]


def fill_holes(mask: np.ndarray) -> np.ndarray:
    """Fill interior cavities so anti-aliased gaps never punch holes in a part."""
    out = mask.astype(np.uint8).copy()
    contours, hier = cv2.findContours(out, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hier is None:
        return out
    for i, contour in enumerate(contours):
        if hier[0][i][3] != -1:  # has a parent contour -> it is a hole
            cv2.drawContours(out, [contour], -1, 1, -1)
    return out


def _odd(v: float, minimum: int = 3) -> int:
    n = max(minimum, int(round(v)))
    return n if n % 2 else n + 1


def stroke_mask(img: np.ndarray, dark_delta: int = 28, grad_thresh: float = 50.0, dilate_px: int = 2, scale: float = 1.0) -> np.ndarray:
    rgb = img[..., :3]
    gray = cv2.cvtColor(rgb, np.uint8) if rgb.dtype != np.uint8 else cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    neighbourhood = _odd(31 * scale)
    local = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (neighbourhood, neighbourhood)))
    dark = ((local.astype(np.int16) - gray.astype(np.int16)) > dark_delta).astype(np.uint8) * 255
    sx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    sy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad = (cv2.magnitude(sx, sy) > grad_thresh).astype(np.uint8) * 255
    mask = cv2.bitwise_or(dark, grad)
    # Dilating + closing the ink is what makes the enclosure test survive
    # anti-aliased gaps; without it the flood leaks into the character.
    if dilate_px:
        kernel = _odd(3 * scale)
        mask = cv2.dilate(mask, np.ones((kernel, kernel), np.uint8), iterations=max(1, round(dilate_px * scale)))
    bridge = _odd(7 * scale)
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (bridge, bridge)))


def build_silhouette(img: np.ndarray, stroke: np.ndarray) -> Silhouette:
    h, w = stroke.shape
    free = (stroke == 0).astype(np.uint8)
    ff = np.zeros((h + 2, w + 2), np.uint8)
    probes = free.copy()
    seeds = [
        (0, 0),
        (w - 1, 0),
        (0, h - 1),
        (w - 1, h - 1),
        (w // 2, 0),
        (w // 2, h - 1),
        (0, h // 2),
        (w - 1, h // 2),
        (w // 4, h // 4),
        (3 * w // 4, h // 4),
        (w // 4, 3 * h // 4),
        (3 * w // 4, 3 * h // 4),
    ]
    for s in seeds:
        if probes[s[1], s[0]] == 1:
            cv2.floodFill(probes, ff, s, 2, flags=4)
    bg = (probes == 2).astype(np.uint8)
    fg = 1 - bg
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

    n, lab, stats, cent = cv2.connectedComponentsWithStats(fg.astype(np.uint8), 8)
    keep = np.zeros_like(fg)
    if n > 1:
        for i in range(1, n):
            area = int(stats[i, cv2.CC_STAT_AREA])
            bw, bh = int(stats[i, cv2.CC_STAT_WIDTH]), int(stats[i, cv2.CC_STAT_HEIGHT])
            cx, cy = float(cent[i][0]), float(cent[i][1])
            # The cast shadow is a very wide, very flat blob sitting under the feet.
            if area < 900:
                continue
            if bw > 0.42 * w and bh < 0.14 * h and cy > 0.80 * h:
                continue
            keep[lab == i] = 1
    fg = keep
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    fg = drop_flat_bottom_regions(fg, stroke)
    fg = fill_holes(fg)
    ys, xs = np.nonzero(fg)
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    return Silhouette(fg=fg, stroke=stroke, bbox=bbox)


def drop_flat_bottom_regions(fg: np.ndarray, stroke: np.ndarray, max_area_ratio: float = 0.25) -> np.ndarray:
    """Remove the cast shadow the artist drew under the boots.

    It has no ink of its own, so it forms an enclosed component that is much wider
    than it is tall and sits at the very bottom of the figure. Anything matching is
    subtracted together with a little dilate, which also eats its anti-aliased ring.
    """
    h, w = fg.shape
    inside = ((fg == 1) & (stroke == 0)).astype(np.uint8)
    n, lab, stats, cent = cv2.connectedComponentsWithStats(inside, 8)
    drop = np.zeros_like(fg)
    for i in range(1, n):
        bw = int(stats[i, cv2.CC_STAT_WIDTH])
        bh = int(stats[i, cv2.CC_STAT_HEIGHT])
        area = int(stats[i, cv2.CC_STAT_AREA])
        cy = float(cent[i][1])
        if bw > 0.40 * w and bh < 0.16 * h and cy > 0.80 * h and area < max_area_ratio * w * h:
            drop[lab == i] = 1
    if not drop.any():
        return fg
    drop = cv2.dilate(drop, np.ones((9, 9), np.uint8))
    return (fg * (1 - drop)).astype(np.uint8)


def interior_components(img: np.ndarray, sil: Silhouette, min_area: int = 700) -> list[int]:
    """Component ids that make up the silhouette interior (used for QA prints)."""
    inside = (sil.fg == 1) & (sil.stroke == 0)
    n, _lab, stats, _cent = cv2.connectedComponentsWithStats(inside.astype(np.uint8), 8)
    return [int(stats[i, cv2.CC_STAT_AREA]) for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= min_area]


def scaled_canvas(img: np.ndarray, fg: np.ndarray, k: float) -> tuple[np.ndarray, np.ndarray]:
    """Resample the *whole* hero once before cutting parts out of it.

    Every part is then a crop of the identical pixel grid, so overlapping rects
    never produce a sub-pixel seam at rest pose — a bug that is invisible in the
    editor and screams once the rig starts moving.
    """
    h, w = img.shape[:2]
    nw, nh = max(1, int(round(w * k))), max(1, int(round(h * k)))
    rgb = cv2.resize(img[..., :3], (nw, nh), interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_LANCZOS4)
    alpha = cv2.resize((fg * 255).astype(np.uint8), (nw, nh), interpolation=cv2.INTER_NEAREST)
    return np.dstack([rgb, (alpha > 127).astype(np.uint8) * 255]), np.zeros((nh, nw), np.uint8)


def extract_part(canvas: np.ndarray, src_w: int, src_h: int, rect: tuple[float, float, float, float], k: float) -> tuple[np.ndarray, tuple[float, float]]:
    """Crop one part out of the pre-scaled canvas.

    ``rect`` is normalised against the *source* image, so the same rig config works
    at any resolution; the crop itself is taken in scaled pixels.
    """
    x0, y0, x1, y1 = Part.rect_px_static(rect, src_w, src_h)
    sx0, sy0 = int(round(x0 * k)), int(round(y0 * k))
    sx1, sy1 = int(round(x1 * k)), int(round(y1 * k))
    region = canvas[sy0:sy1, sx0:sx1]
    cropped, off = trim(region)
    return cropped, (sx0 + off[0], sy0 + off[1])


def mean_suit_colour(img: np.ndarray, mask: np.ndarray, around: tuple[float, float] | None = None, radius: int = 26) -> tuple[int, int, int]:
    """Median colour of a part, optionally only near the hinge.

    Joint patches are painted with this so a swinging limb never shows a hole;
    sampling near the hinge keeps the patch the colour of the *skin/suit* there
    instead of an average that is muddied by boots or gloves.
    """
    sel = mask == 1
    if around is not None and sel.any():
        h, w = sel.shape
        yy, xx = np.mgrid[0:h, 0:w]
        near = ((xx - around[0]) ** 2 + (yy - around[1]) ** 2) <= radius * radius
        if (sel & near).any():
            sel = sel & near
    px = img[sel][:, :3]
    if len(px) == 0:
        return (105, 179, 233)
    med = np.median(px, axis=0)
    return tuple(int(v) for v in med)  # type: ignore[return-value]
