"""Quality gates for the generated art.

``reconstruction_iou`` is the important one: posing every rig part at identity and
compositing must reproduce the source silhouette almost exactly. If a cut lands in
the wrong place, a pivot is off, or two parts fight over the same pixels, this
number drops — so it doubles as a regression test for ``config/rig.json``.
"""

from __future__ import annotations

import numpy as np
import cv2


def _mask_alpha(a: np.ndarray, thresh: int = 64) -> np.ndarray:
    return (a[..., 3] >= thresh).astype(np.uint8)


def reconstruction_iou(frame: np.ndarray, expected: np.ndarray, thresh: int = 64) -> tuple[float, np.ndarray]:
    """IoU between the composed rest pose and the source silhouette at cell size."""
    got = _mask_alpha(frame, thresh)
    want = _mask_alpha(expected, thresh)
    inter = float(np.logical_and(got, want).sum())
    union = float(np.logical_or(got, want).sum()) or 1.0
    diff = cv2.absdiff(got * 255, want * 255)
    vis = cv2.cvtColor(np.maximum(diff, (1 - got) * 20 + 235).astype(np.uint8), cv2.COLOR_GRAY2BGR)
    vis[..., 0] = np.clip(vis[..., 0] - diff, 0, 255)
    vis[..., 2] = np.clip(vis[..., 2] - diff, 0, 255)
    return inter / union, vis


def part_overlaps(parts: dict[str, np.ndarray]) -> dict[str, float]:
    """How much each part's opaque area exceeds the silhouette (double-claiming)."""
    acc = np.zeros(next(iter(parts.values())).shape[:2], np.uint8)
    out: dict[str, float] = {}
    for name, img in parts.items():
        m = (img[..., 3] > 64).astype(np.uint8)
        if m.shape != acc.shape:
            m = cv2.resize(m, (acc.shape[1], acc.shape[0]), interpolation=cv2.INTER_NEAREST)
        out[name] = float((m & acc).sum() / max(1, m.sum()))
        acc = np.clip(acc + m, 0, 255).astype(np.uint8)
    return out


def frame_is_finite(frames: list[np.ndarray]) -> bool:
    return all(np.isfinite(f).all() and f.shape[2] == 4 for f in frames)
