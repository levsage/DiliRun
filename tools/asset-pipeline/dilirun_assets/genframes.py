"""Turns generated key-pose artwork into sprite-sheet cells.

The hero's locomotion poses used to be cut out of the single uploaded illustration and posed by
the rig (see ``rig.py``). That keeps the artist's pixels but can only *rotate* a limb about its
hinge, so a run cycle never gets a bending knee or a real contact frame. This module is the other
half of the pipeline: it takes flattened pose sheets (``assets/source/generated/``), keys out the
background, finds each figure and normalises it into a cell of the same size and baseline as the
rig's output — so ``spritesheet.pack_sheet`` and the runtime manifest do not care where a frame
came from.

Three things generated art always brings, all handled here:

* **Cast shadows, ground blobs, tinted bands.** A flat colour key is the obvious approach and it is
  wrong: these sheets paint the negative space in wide, subtly different bands of the key colour, so
  a global distance to "the background" declares them foreground and figures get sliced apart.
  Instead a pixel is background-*ish* when green clearly dominates, and only the greenish regions
  **connected to the image border** are removed. That is lighting-independent, so a shaded shadow and
  a flat background both go, and a green-ish colour inside the character stays.
* **Grid / baseline lines.** They are dark, so no key removes them: rows and columns that are almost
  entirely foreground are severed before labelling, otherwise every figure merges into one blob.
* **Inconsistent figure scale.** Each figure is rescaled to a common fraction of the cell and dropped
  onto the rig's ground anchor, which is what the rig does too.

Edge spill is desaturated (``despill``) because a hard key against green always leaves a green rim on
a 60 px sprite, and that rim is exactly what makes cut-out art look cut out.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

Box = tuple[int, int, int, int]


@dataclass
class CellSpec:
    """How one generated strip maps to one animation state."""

    state: str
    image: str
    fps: float
    loop: bool
    hold: int | None
    cells: tuple[int, ...] | None = None  # None = every figure found, in reading order
    expect: int | None = None  # fail the build unless exactly this many figures were found
    # Fractional box [x0, y0, x1, y1] to crop the sheet to before keying. A grid sheet holds one
    # animation row per band, and cropping is how a row becomes its own sequence: x-clustering cannot
    # tell a top-row figure from the bottom-row figure under it, because they share an x position.
    clip: tuple[float, float, float, float] | None = None


# ----------------------------------------------------------------------- keying
def background_colour(rgb: np.ndarray, border: int = 24) -> np.ndarray:
    """Median colour of the image border — only used to describe the key in logs."""
    h, w = rgb.shape[:2]
    b = max(2, min(border, h // 4, w // 4))
    band = np.concatenate(
        [
            rgb[:b].reshape(-1, 3),
            rgb[-b:].reshape(-1, 3),
            rgb[:, :b].reshape(-1, 3),
            rgb[:, -b:].reshape(-1, 3),
        ]
    )
    return np.median(band.astype(np.float32), axis=0)


def foreground_mask(rgb: np.ndarray, green_margin: float) -> np.ndarray:
    """Foreground = everything that is not greenish-background reachable from the border."""
    f = rgb.astype(np.int16)
    greenish = (f[..., 1] - np.maximum(f[..., 0], f[..., 2])) > green_margin
    count, labels = cv2.connectedComponents(greenish.astype(np.uint8), connectivity=4)[:2]
    if count <= 1:
        return np.ones(rgb.shape[:2], np.float32)
    border_labels = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])))
    border_labels.discard(0)
    if border_labels:
        bg = np.isin(labels, np.fromiter(border_labels, np.int32, count=len(border_labels)))
    else:  # the figure touches every edge; nothing is "outside"
        bg = np.zeros(labels.shape, bool)
    fg = ~bg
    # Enclosed pockets of background (the gap under a running arm) would otherwise render as holes
    # punched through the middle of the sprite, so fill anything the outside cannot reach.
    inv = (~fg).astype(np.uint8)
    n2, lab2 = cv2.connectedComponents(inv, connectivity=4)[:2]
    if n2 > 1:
        outside = set(np.unique(np.concatenate([lab2[0], lab2[-1], lab2[:, 0], lab2[:, -1]])))
        outside.discard(0)
        if outside:
            unreachable = ~np.isin(lab2, np.fromiter(outside, np.int32, count=len(outside)))
            fg = fg | (unreachable & inv.astype(bool))
    return fg.astype(np.float32)


def despill(rgb: np.ndarray, alpha: np.ndarray, strength: float = 0.85) -> np.ndarray:
    """Push green down to the max of red/blue wherever green dominates (the key's leftover rim)."""
    out = rgb.astype(np.float32).copy()
    g = out[..., 1]
    ceiling = np.maximum(out[..., 0], out[..., 2])
    excess = np.clip(g - ceiling, 0.0, None)
    out[..., 1] = g - excess * strength * (0.35 + 0.65 * alpha)
    return np.clip(out, 0, 255)


def line_rows_cols(mask: np.ndarray, fill: float) -> tuple[set[int], set[int]]:
    """Rows and columns that are almost entirely foreground: the sheet's drawn separator lines."""
    h, w = mask.shape
    rows = {int(r) for r in np.where(mask.sum(axis=1) / w > fill)[0]}
    cols = {int(c) for c in np.where(mask.sum(axis=0) / h > fill)[0]}
    return rows, cols


def repair_lines(
    rgb: np.ndarray, fg: np.ndarray, fill: float
) -> tuple[np.ndarray, np.ndarray, int, int]:
    """Heal the separator lines by copying the pixels around them, instead of deleting them.

    Deleting the line (the obvious move) is what forces all the regrouping machinery, and it still
    leaves a dark bar wherever the line ran *over* the character — the model draws a ground line
    straight through the legs, and no key removes it because it is not green. Healing each line row and
    column from its nearest non-line neighbour fixes both at once: over a figure the neighbour is
    figure colour, so the character comes back whole and stays *one* connected component; over empty
    background the neighbour is background, so the gap stays a gap and figures never fuse. Copying
    rather than averaging matters too — averaging the two sides of a bar that crossed a limb left a
    pale stripe exactly where the arm met the torso.
    """
    rows, cols = line_rows_cols(fg, fill)
    if not rows and not cols:
        return rgb, fg, 0, 0
    rows_set = rows
    out_rgb = rgb.astype(np.float32).copy()
    out_a = fg.astype(np.float32).copy()

    def nearest_map(flags: np.ndarray) -> np.ndarray:
        """For every index, the closest index that is *not* a line. Two passes, no allocation."""
        n = len(flags)
        out = np.arange(n)
        last = -1
        for i in range(n):
            if flags[i]:
                out[i] = last if last >= 0 else -1
            else:
                last = i
                out[i] = i
        last = -1
        for i in range(n - 1, -1, -1):
            if flags[i]:
                right = last
                left = out[i]
                if left < 0:
                    out[i] = right
                elif right >= 0 and (right - i) < (i - left):
                    out[i] = right
            else:
                last = i
        return np.clip(out, 0, n - 1)

    h, w = out_a.shape
    if rows:
        src = nearest_map(np.fromiter((np.isin(np.arange(h), list(rows))).ravel(), bool, count=h))
        blend = (out_a[src] + out_a[np.arange(h)]) * 0.5
        # Copy, never average, the colour: the bar is one pixel-row thick of *wrong* colour, and
        # averaging its two neighbours smeared a pale stripe across any limb it crossed.
        for r in range(h):
            if rows and r in rows_set:
                out_rgb[r] = out_rgb[src[r]]
                out_a[r] = np.maximum(out_a[src[r]], out_a[r])
        del blend
    if cols:
        src = np.arange(w)
        flags = np.zeros(w, bool)
        flags[sorted(cols)] = True
        src = nearest_map(flags)
        for c in range(w):
            if flags[c]:
                out_rgb[:, c] = out_rgb[:, src[c]]
                out_a[:, c] = np.maximum(out_a[:, src[c]], out_a[:, c])
    return out_rgb.astype(np.uint8), out_a, len(rows), len(cols)


# ---------------------------------------------------------------------- grouping
def _overlap(a: Box, b: Box, axis: int) -> float:
    """Shared extent of two boxes along ``axis`` (0 = x, 1 = y), over the shorter of the two."""
    lo = max(a[axis], b[axis])
    hi = min(a[axis] + a[2 + axis], b[axis] + b[2 + axis])
    if hi <= lo:
        return 0.0
    return (hi - lo) / max(1.0, float(min(a[2 + axis], b[2 + axis])))


def _gap(a: Box, b: Box, axis: int) -> int:
    """Separation along ``axis``; negative means the boxes already overlap there."""
    return max(a[axis], b[axis]) - min(a[axis] + a[2 + axis], b[axis] + b[2 + axis])


def _union(boxes: list[Box], group: list[int]) -> Box:
    xs = [boxes[i][0] for i in group]
    ys = [boxes[i][1] for i in group]
    x2 = [boxes[i][0] + boxes[i][2] for i in group]
    y2 = [boxes[i][1] + boxes[i][3] for i in group]
    x, y = min(xs), min(ys)
    return (x, y, max(x2) - x, max(y2) - y)


def group_pieces(
    boxes: list[Box],
    areas: list[int],
    width: int,
    height: int,
    max_gap_x: float = 0.1,
    max_gap_y: float = 0.03,
    min_overlap: float = 0.55,
    max_width_factor: float = 2.0,
) -> list[list[int]]:
    """Cluster component indices that are one figure torn apart by a severed line.

    Severing the sheet's grid and baseline lines is what makes per-figure labelling possible at all,
    and it inevitably cuts figures too — sideways when a vertical bar crosses a runner, *horizontally*
    when a drawn baseline slices heads from legs. So a merge is allowed along either axis, each with
    its own budget: side by side additionally has to fit inside one figure's width (that is what keeps
    two adjacent figures apart in a 3-column sheet), while stacked pieces only need to line up in x,
    since a head over its own legs overlaps almost completely and a neighbouring row is far away.

    A "the broken-off piece must be small" rule is deliberately absent: capes, heads and pairs of legs
    are not small, and requiring it produced six half-runners floating next to six capes.
    """
    # The width budget is measured against *figures*: the thin pieces that make up the interesting
    # cases drag a plain median down to their own size, which then rejects the merge it exists to allow.
    biggest = max(areas) if areas else 1
    solid = sorted(boxes[i][2] for i, _ in enumerate(boxes) if areas[i] >= biggest * 0.25)
    median_w = solid[len(solid) // 2] if solid else max(1, max((b[2] for b in boxes), default=1))
    groups = [[i] for i, _ in enumerate(boxes)]
    while True:
        best: tuple[float, int, int] | None = None
        for a in range(len(groups)):
            for b in range(a + 1, len(groups)):
                ba, bb = _union(boxes, groups[a]), _union(boxes, groups[b])
                side_by_side = (
                    _gap(ba, bb, 0) < width * max_gap_x
                    and _overlap(ba, bb, 1) > min_overlap
                    and _union(boxes, groups[a] + groups[b])[2] <= median_w * max_width_factor
                )
                stacked = _gap(ba, bb, 1) < height * max_gap_y and _overlap(ba, bb, 0) > min_overlap
                if not (side_by_side or stacked):
                    continue
                cost = float(max(_gap(ba, bb, 0), _gap(ba, bb, 1)))
                if best is None or cost < best[0]:
                    best = (cost, a, b)
        if best is None:
            break
        _cost, a, b = best
        groups[a] = groups[a] + groups[b]
        del groups[b]
    groups.sort(key=lambda gr: (min(boxes[i][1] for i in gr), min(boxes[i][0] for i in gr)))
    return groups


def cluster_by_gaps(boxes: list[Box], count: int) -> list[list[int]]:
    """Split components into exactly ``count`` figures at the widest gaps between their centres.

    This is the preferred path whenever ``frames.json`` states ``expect`` (which it does for every
    state), because it is scale-free: it asks nothing about how wide a figure is or how big a broken
    piece looks, it just cuts the empty space. Figures that belong together — a head over its own
    legs, a fist beside a body — sit close along x; separate figures sit far apart. A sheet laid out
    as rows works too, since the same column in two rows shares an x position, so the cluster holds
    both halves.
    """
    if count <= 0 or not boxes:
        return [[i] for i in range(len(boxes))]
    if len(boxes) <= count:
        return [[i] for i in sorted(range(len(boxes)), key=lambda i: boxes[i][0])]
    order = sorted(range(len(boxes)), key=lambda i: boxes[i][0] + boxes[i][2] / 2)
    cx = [boxes[i][0] + boxes[i][2] / 2 for i in order]
    gaps = [cx[k + 1] - cx[k] for k in range(len(order) - 1)]
    cuts = sorted(sorted(range(len(gaps)), key=lambda k: -gaps[k])[: count - 1])
    groups: list[list[int]] = []
    current = [order[0]]
    for k in range(1, len(order)):
        if k - 1 in cuts:
            groups.append(current)
            current = []
        current.append(order[k])
    groups.append(current)
    return [g for g in groups if g]


# ---------------------------------------------------------------------- cells
def to_cell(
    rgb: np.ndarray,
    alpha: np.ndarray,
    bbox: Box,
    cell: int,
    figure_height: float,
    anchor_y: float,
    feather: float = 0.7,
    keep: np.ndarray | None = None,
    ids: list[int] | None = None,
) -> np.ndarray:
    """Scale one figure into a ``cell x cell`` RGBA frame, feet on the shared anchor line.

    ``keep``/``ids`` restrict the pixels to the label ids of this figure: a *grouped* bbox is wider
    than any single component, and painting the whole rectangle would let a neighbour bleed in.
    """
    x, y, w, h = bbox
    crop_rgb = rgb[y : y + h, x : x + w].astype(np.float32)
    crop_a = alpha[y : y + h, x : x + w].astype(np.float32)
    if keep is not None and ids:
        sel = np.isin(keep[y : y + h, x : x + w], np.asarray(ids, keep.dtype))
        crop_a = crop_a * sel.astype(np.float32)
    scale = (cell * figure_height) / max(1.0, float(h))
    if w * scale > cell * 0.98:  # never let a wide pose (a slide) overflow the cell
        scale = (cell * 0.98) / float(w)
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
    # Composite on transparent black *before* resampling so the alpha edge never blends with a
    # leftover background colour — that halo is what made the old cut-out art look pasted on.
    prem = crop_rgb * crop_a[..., None]
    prem_img = cv2.resize(prem, (nw, nh), interpolation=interp)
    a_img = np.clip(cv2.resize(crop_a, (nw, nh), interpolation=interp), 0.0, 1.0)
    if feather > 0:
        k = max(3, int(feather * 2) | 1)
        a_img = cv2.GaussianBlur(a_img, (k, k), feather)
    a_img = np.clip(a_img - 0.04, 0.0, 1.0)  # drop the last translucent ring
    with np.errstate(divide="ignore", invalid="ignore"):
        colour = np.where(a_img[..., None] > 1e-3, prem_img / np.maximum(a_img[..., None], 1e-3), 0.0)
    out = np.zeros((cell, cell, 4), np.uint8)
    px, py = int(round((cell - nw) / 2.0)), int(round(cell * anchor_y - nh))
    px2, py2 = max(0, px), max(0, py)
    if py2 + nh > cell or px2 + nw > cell:
        ch, cw = cell - py2, cell - px2
        colour, a_img = colour[:ch, :cw], a_img[:ch, :cw]
    tile = np.dstack([np.clip(colour, 0, 255), a_img[..., None] * 255.0])
    out[py2 : py2 + tile.shape[0], px2 : px2 + tile.shape[1]] = tile.astype(np.uint8)
    return out


def extract(
    rgb: np.ndarray,
    spec: CellSpec,
    cell: int,
    figure_height: float,
    anchor_y: float,
    green_margin: float = 8.0,
    line_fill: float = 0.75,
    min_area: int = 900,
) -> tuple[list[np.ndarray], np.ndarray, dict[str, Any]]:
    """One pose sheet -> ``(cells, whole-image alpha, raw bbox sizes)``.

    The alpha is returned so a bad extraction is diagnosable: ``build.py --debug`` dumps it next to
    the contact sheet, which is where a clipped or over-merged figure becomes obvious.
    """
    if spec.clip is not None:
        ch, cw = rgb.shape[:2]
        cx0, cy0, cx1, cy1 = spec.clip
        rgb = rgb[int(round(cy0 * ch)) : int(round(cy1 * ch)), int(round(cx0 * cw)) : int(round(cx1 * cw))]
    fg = foreground_mask(rgb, green_margin)
    rgb, fg, healed_rows, healed_cols = repair_lines(rgb, fg, line_fill)
    mask = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    count, labels = cv2.connectedComponents(mask.astype(np.uint8), connectivity=8)[:2]
    alpha = np.clip(cv2.GaussianBlur(fg, (3, 3), 0.6), 0.0, 1.0)
    rgb_out = despill(rgb, alpha)
    comp_boxes: list[Box] = []
    comp_areas: list[int] = []
    comp_ids: list[int] = []  # label id, so a grouped figure can be masked back out of `labels`
    for i in range(1, count):
        ys, xs = np.where(labels == i)
        area = int(ys.size)
        if area < min_area:
            continue
        bbox = (int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1))
        if bbox[2] < 24 or bbox[3] < 24:
            continue
        comp_boxes.append(bbox)
        comp_areas.append(area)
        comp_ids.append(i)
    if not comp_boxes:
        raise ValueError(f"no figures found for state '{spec.state}' in {spec.image}")
    if spec.expect is not None:
        if len(comp_boxes) < spec.expect:
            raise ValueError(
                f"state '{spec.state}': {spec.image} holds {len(comp_boxes)} figures but the state asks "
                f"for {spec.expect} — either fix frames.json or supply a sheet with more poses"
            )
        groups = cluster_by_gaps(comp_boxes, spec.expect)
    else:
        groups = group_pieces(comp_boxes, comp_areas, rgb.shape[1], rgb.shape[0])
    boxes = [_union(comp_boxes, grp) for grp in groups]
    # Reading order is left to right, top to bottom within a row band (bands split on vertical centre,
    # because a loose strip of poses sits on a diagonal rather than a grid).
    entries = [(k, boxes[k], [comp_ids[c] for c in groups[k]]) for k in range(len(groups))]
    median_h = sorted(b[3] for b in boxes)[len(boxes) // 2]
    entries.sort(key=lambda e: e[1][1] + e[1][3] / 2)
    bands: list[list[tuple[int, Box, list[int]]]] = []
    for item in entries:
        cy = item[1][1] + item[1][3] / 2
        for band in bands:
            ref = band[0][1]
            if abs(cy - (ref[1] + ref[3] / 2)) < median_h * 0.6:
                band.append(item)
                break
        else:
            bands.append([item])
    ordered: list[tuple[int, Box, list[int]]] = []
    for band in bands:
        band.sort(key=lambda item: item[1][0])
        ordered.extend(band)
    if spec.expect is not None and len(ordered) != spec.expect:
        raise ValueError(
            f"state '{spec.state}': expected {spec.expect} figures in {spec.image}, found {len(ordered)} "
            f"from {len(comp_boxes)} components — the key is eating a pose, or cells are touching; "
            "re-run with --debug and open tools/asset-pipeline/out/mask-*.png to see what it kept"
        )
    if spec.cells is not None:
        if any(i >= len(ordered) for i in spec.cells):
            raise ValueError(f"state '{spec.state}' asked for cells {list(spec.cells)}, only {len(ordered)} found")
        ordered = [ordered[i] for i in spec.cells]
    cells = [
        to_cell(rgb_out, alpha, bbox, cell, figure_height, anchor_y, keep=labels, ids=ids)
        for _k, bbox, ids in ordered
    ]
    hh, ww = rgb.shape[:2]
    # A figure whose bbox touches the crop edge is a figure the sheet clipped mid-limb: that is the
    # defect worth failing on. A size difference between poses is not, because every cell is rescaled
    # to one height by design, so normalisation already corrects it.
    clipped = [
        i
        for i, (_k, b, _g) in enumerate(ordered)
        if b[0] <= 1 or b[1] <= 1 or b[0] + b[2] >= ww - 2 or b[1] + b[3] >= hh - 2
    ]
    raw = {
        "figure_heights": [int(b[3]) for _i, b, _g in ordered],
        "figure_widths": [int(b[2]) for _i, b, _g in ordered],
        "clipped": clipped,
        "healed_rows": healed_rows,
        "healed_cols": healed_cols,
    }
    return cells, (alpha * 255.0).astype(np.uint8), raw


# ------------------------------------------------------------------- inspection
def review_strip(frames: list[np.ndarray], cell: int, bg: tuple[int, int, int] = (26, 44, 86)) -> np.ndarray:
    """Frames side by side on the track colour — what ``pose_review`` and the QA dump use."""
    canvas = np.zeros((cell, cell * max(1, len(frames)), 4), np.uint8)
    canvas[..., :3] = bg
    canvas[..., 3] = 255
    for i, f in enumerate(frames):
        a = f[..., 3:4].astype(np.float32) / 255.0
        region = canvas[:, i * cell : (i + 1) * cell, :3]
        canvas[:, i * cell : (i + 1) * cell, :3] = (f[..., :3] * a + region * (1 - a)).astype(np.uint8)
    return canvas


def cell_stats(frames: list[np.ndarray]) -> dict[str, float]:
    """Coverage of the cell by the figure, and the pixel height it ends up with."""
    cov: list[float] = []
    heights: list[float] = []
    for f in frames:
        a = f[..., 3]
        cov.append(float((a > 128).mean()))
        rows = np.where((a > 128).any(axis=1))[0]
        heights.append(float(rows[-1] - rows[0] + 1) if rows.size else 0.0)
    hs = np.array(heights, np.float32)
    return {"coverage": float(np.mean(cov)) if cov else 0.0, "min_height": float(hs.min()) if hs.size else 0.0}
