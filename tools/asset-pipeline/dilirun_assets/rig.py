"""Cut-out rig: turns static character pieces into an animated sprite sheet.

The rig is *data driven*. ``rig.json`` (in ``config/``) describes the pieces and
their hinges, ``poses.py`` describes keyframes per animation state, and this
module renders any pose into a supersampled RGBA frame. The game only ever sees
the baked sheet, so the runtime stays cheap while the art pipeline stays tweakable.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import cv2
import numpy as np

from .util import Part, warp_part

IDENTITY = {"rot": 0.0, "pos": (0.0, 0.0), "scale": (1.0, 1.0)}


@dataclass
class RigPart:
    part: Part
    img: np.ndarray  # RGBA float 0..1, already in render space
    origin: tuple[float, float]  # top-left of img in render space
    pivot: tuple[float, float]  # hinge in render space
    joints: list[tuple[float, float, float]]  # patches (render space)
    fill: tuple[int, int, int]


@dataclass
class Stage:
    """Maps source-image pixels to the supersampled render canvas."""

    size: int  # square canvas side in render px
    cell: int  # final sprite cell in px
    k: float  # source px -> render px
    ground: tuple[float, float]  # source px point that lands on the anchor
    anchor_y: float = 0.955  # where the ground contact sits inside a cell

    @property
    def ratio(self) -> float:
        return self.size / self.cell

    @property
    def anchor(self) -> tuple[float, float]:
        return (self.size / 2.0, self.size * self.anchor_y)

    def to_render(self, x: float, y: float) -> tuple[float, float]:
        """Source-pixel coordinates -> render canvas."""
        ax, ay = self.anchor
        gx, gy = self.ground
        return ((x - gx) * self.k + ax, (y - gy) * self.k + ay)

    def place(self, sx: float, sy: float) -> tuple[float, float]:
        """Already-scaled coordinates (source px * k) -> render canvas."""
        ax, ay = self.anchor
        gx, gy = self.ground
        return (sx - gx * self.k + ax, sy - gy * self.k + ay)

    def unit(self, v: float) -> float:
        """Authored values are in final-cell px; convert to render px."""
        return v * self.ratio


class Rig:
    def __init__(self, parts: list[RigPart], stage: Stage, body_fill: tuple[int, int, int]):
        self.parts = sorted(parts, key=lambda p: p.part.z)
        self.stage = stage
        self.body_fill = body_fill

    # ---------------------------------------------------------------- rendering
    def render_pose(self, pose: dict, global_tf: dict | None = None) -> np.ndarray:
        """Return an RGBA uint8 frame of ``cell x cell`` (already downscaled)."""
        s = self.stage
        layer = np.zeros((s.size, s.size, 4), np.float32)
        for rp in self.parts:
            p = {**IDENTITY, **(pose or {}).get(rp.part.name, {})}
            angle = float(p["rot"])
            off = (s.unit(float(p["pos"][0])), s.unit(float(p["pos"][1])))
            sc = tuple(float(v) for v in p["scale"])
            # patch the hinge first so a swinging limb never reveals background
            if rp.joints and (abs(angle) > 0.5 or max(abs(off[0]), abs(off[1])) > 0.5):
                for jx, jy, jr in rp.joints:
                    v = np.array([jx - rp.pivot[0], jy - rp.pivot[1]], np.float32)
                    v = _rot(angle) @ v
                    cx, cy = rp.pivot[0] + v[0] + off[0], rp.pivot[1] + v[1] + off[1]
                    cv2.circle(layer, (int(cx), int(cy)), int(max(1, jr * sc[0])), (*rp.fill, 1.0), -1, cv2.LINE_AA)
            warped = warp_part(
                (rp.img * 255).astype(np.uint8),
                rp.origin,
                rp.pivot,
                (s.size, s.size),
                angle=angle,
                offset=off,
                scale=sc,
            )
            a = warped[..., 3:4]
            layer[..., :3] = warped[..., :3] * a + layer[..., :3] * (1.0 - a)
            layer[..., 3:4] = np.clip(a + layer[..., 3:4] * (1.0 - a), 0, 1)

        if global_tf:
            layer = self._apply_global(layer, global_tf)
        out = cv2.resize((np.clip(layer, 0, 1) * 255).astype(np.uint8), (s.cell, s.cell), interpolation=cv2.INTER_AREA)
        return out

    def _apply_global(self, layer: np.ndarray, g: dict) -> np.ndarray:
        s = self.stage
        # `pivot` is a fraction of the canvas: place the hinge at the body's mid-mass
        pivot_src = g.get("pivot", (0.5, 0.66))
        ang = float(g.get("rot", 0.0))
        off = (s.unit(float(g.get("pos", (0, 0))[0])), s.unit(float(g.get("pos", (0, 0))[1])))
        sc = tuple(float(v) for v in g.get("scale", (1.0, 1.0)))
        pivot = (s.size * float(pivot_src[0]), s.size * float(pivot_src[1]))
        R = _rot(ang)
        S = np.diag(np.array(sc, np.float32))
        A = S @ R
        t = np.array(pivot, np.float32)
        M = np.zeros((2, 3), np.float32)
        M[:2, :2] = A
        M[:, 2] = t - A @ t + off
        return cv2.warpAffine(layer, M, (s.size, s.size), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))


def _rot(angle_deg: float) -> np.ndarray:
    a = math.radians(angle_deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s], [s, c]], np.float32)


# ------------------------------------------------------------------- keyframing
def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _ease(t: float) -> float:
    """Smoothstep: cartoon poses read better than a linear blend would."""
    return t * t * (3.0 - 2.0 * t)


def _get(d: dict | None, path: str, default):
    cur = d or {}
    for key in path.split("."):
        if not isinstance(cur, dict) or key not in cur:
            return default
        cur = cur[key]
    return cur


def _lerp_value(a, b, t: float):
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return tuple(_lerp(float(x), float(y), t) for x, y in zip(a, b))
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return _lerp(float(a), float(b), t)
    return b if t >= 0.5 else a


def _blend_dict(a: dict, b: dict, t: float, keys: tuple[str, ...]) -> dict:
    out = {}
    for k in keys:
        out[k] = _lerp_value(a.get(k, IDENTITY[k] if k in IDENTITY else 0), b.get(k, IDENTITY[k] if k in IDENTITY else 0), t)
    return out


def sample_pose(keys: list[dict], frame: float, loop: bool) -> tuple[dict, dict]:
    """Interpolate keyframes at a fractional frame index.

    A key looks like ``{"at": 3, "parts": {"head": {"rot": -6, "pos": [0, -2]}},
    "global": {"rot": -60, "pivot": [0.5, 0.6]}}``. Looping states should repeat
    their first key as the last one (``at == frame count``) so the cycle closes.
    """
    ordered = sorted(keys, key=lambda k: float(k["at"]))
    first, last = float(ordered[0]["at"]), float(ordered[-1]["at"])
    span = (last - first) or 1.0
    if loop:
        frame = first + (frame - first) % span
    frame = max(first, min(last, float(frame)))

    idx = 0
    for i in range(len(ordered) - 1):
        if float(ordered[i]["at"]) <= frame <= float(ordered[i + 1]["at"]):
            idx = i
            break
    else:
        idx = max(0, len(ordered) - 2)
    a, b = ordered[idx], ordered[min(idx + 1, len(ordered) - 1)]
    seg = (float(b["at"]) - float(a["at"])) or 1.0
    t = _ease(max(0.0, min(1.0, (frame - float(a["at"])) / seg)))

    part_names = set(a.get("parts", {})) | set(b.get("parts", {}))
    pose = {n: _blend_dict(a["parts"].get(n, {}), b["parts"].get(n, {}), t, ("rot", "pos", "scale")) for n in part_names}
    glob = _blend_global(a.get("global", {}), b.get("global", {}), t)
    return pose, glob


_GKEYS = ("rot", "pos", "scale")


def _blend_global(a: dict, b: dict, t: float) -> dict:
    out: dict = {}
    if "pivot" in b or "pivot" in a:
        out["pivot"] = _lerp_value(a.get("pivot", (0.5, 0.66)), b.get("pivot", (0.5, 0.66)), t)
    for k in _GKEYS:
        if k in a or k in b:
            out[k] = _lerp_value(a.get(k, IDENTITY.get(k, 0)), b.get(k, IDENTITY.get(k, 0)), t)
    return out
