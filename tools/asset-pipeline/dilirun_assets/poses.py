"""Hand-authored pose library for the DiliRun hero.

Everything animation-related lives in this file, so tweaking a jump arc or a run
cycle never requires touching the renderer. Values are per rig part:

``rot``    degrees, clockwise on screen (image space, y grows downwards)
``pos``    ``[dx, dy]`` offset in *final sprite pixels* (positive y = down)
``scale``  ``[sx, sy]`` squash & stretch around the part's hinge

``g=`` sets a whole-character transform (used for the slide pitch and the roll
spin, which rotate the composed body rather than individual limbs).

Looping states repeat their first key at ``at == count`` so cycles close cleanly.
"""

from __future__ import annotations

from typing import Any


def K(at: float, g: dict[str, Any] | None = None, **parts: dict[str, Any]) -> dict[str, Any]:
    return {"at": at, "global": g or {}, "parts": parts}


#: Shared starting stance per state. The illustration is a T-pose, so locomotion
#: states begin from an arms-down runner's stance and the keyframes below are
#: *deltas* on top of it. `idle` and `victory` keep the heroic spread arms.
BASE: dict[str, dict[str, dict[str, object]]] = {
    "arms_down": {
        "arm_left": {"rot": -34},
        "arm_right": {"rot": 34},
        "cape_left": {"rot": 5},
        "cape_right": {"rot": -5},
    },
    "arms_soft": {
        "arm_left": {"rot": -10},
        "arm_right": {"rot": 10},
    },
}


#: Order matters: it defines the row-major layout of the baked sheet.
STATES: dict[str, dict[str, Any]] = {
    # ---------------------------------------------------------------- standing
    "idle": {
        "fps": 8,
        "loop": True,
        "count": 6,
        "base": "arms_soft",
        "hold": 0,
        "keys": [
            K(0, torso={"scale": (1.0, 1.0)}, head={"pos": (0, 0)}, cape_left={"rot": 0}, cape_right={"rot": 0}),
            K(
                3,
                torso={"scale": (0.994, 1.014), "pos": (0, -1)},
                head={"pos": (0, -2.5), "rot": -1.5},
                arm_left={"rot": 3.5},
                arm_right={"rot": -3.5},
                cape_left={"rot": -5},
                cape_right={"rot": 5},
            ),
            K(6, torso={"scale": (1.0, 1.0)}, head={"pos": (0, 0)}, arm_left={"rot": 0}, arm_right={"rot": 0}),
        ],
    },
    # ------------------------------------------------------------------ ground
    "run": {
        # A runner leans into the wind and his arms pump past his hips, so both the
        # whole-body pitch and the arm angles are pushed much further than a first pass
        # at this pose assumed. Frames alternate contact / pass / contact.
        "fps": 17,
        "loop": True,
        "count": 8,
        "base": "arms_down",
        "hold": None,
        "keys": [
            # contact: near leg reaches forward, body at its lowest
            K(
                0,
                g={"rot": 6, "pivot": (0.5, 0.94), "pos": (0, 3)},
                leg_left={"rot": 30, "pos": (-2, 0)},
                leg_right={"rot": -30, "pos": (2, 0)},
                arm_left={"rot": -16},
                arm_right={"rot": 18},
                torso={"rot": 4, "scale": (1.04, 0.965), "pos": (0, 2)},
                head={"rot": -3, "pos": (1, -1)},
                cape_left={"rot": 24},
                cape_right={"rot": 20},
            ),
            # pass: support leg under the hips, body at its highest
            K(
                2,
                g={"rot": 3, "pivot": (0.5, 0.94), "pos": (0, -5)},
                leg_left={"rot": 6},
                leg_right={"rot": -14},
                arm_left={"rot": 2},
                arm_right={"rot": -2},
                torso={"rot": 2, "scale": (0.99, 1.02)},
                head={"rot": -1, "pos": (0, -2)},
                cape_left={"rot": 10},
                cape_right={"rot": 8},
            ),
            # contact: legs swap
            K(
                4,
                g={"rot": 6, "pivot": (0.5, 0.94), "pos": (0, 3)},
                leg_left={"rot": -30, "pos": (2, 0)},
                leg_right={"rot": 30, "pos": (-2, 0)},
                arm_left={"rot": 18},
                arm_right={"rot": -16},
                torso={"rot": 4, "scale": (1.04, 0.965), "pos": (0, 2)},
                head={"rot": -3, "pos": (1, -1)},
                cape_left={"rot": 20},
                cape_right={"rot": 24},
            ),
            K(
                6,
                g={"rot": 3, "pivot": (0.5, 0.94), "pos": (0, -5)},
                leg_left={"rot": -14},
                leg_right={"rot": 6},
                arm_left={"rot": -2},
                arm_right={"rot": 2},
                torso={"rot": 2, "scale": (0.99, 1.02)},
                head={"rot": -1, "pos": (0, -2)},
                cape_left={"rot": 8},
                cape_right={"rot": 10},
            ),
            K(
                8,
                g={"rot": 6, "pivot": (0.5, 0.94), "pos": (0, 3)},
                leg_left={"rot": 30, "pos": (-2, 0)},
                leg_right={"rot": -30, "pos": (2, 0)},
                arm_left={"rot": -16},
                arm_right={"rot": 18},
                torso={"rot": 4, "scale": (1.04, 0.965), "pos": (0, 2)},
                head={"rot": -3, "pos": (1, -1)},
                cape_left={"rot": 24},
                cape_right={"rot": 20},
            ),
        ],
    },
    "dash": {
        "fps": 14,
        "loop": True,
        "count": 3,
        "hold": 1,
        "keys": [
            K(
                0,
                arm_left={"rot": -52},
                arm_right={"rot": 52},
                leg_left={"rot": -18},
                leg_right={"rot": 16},
                torso={"rot": 10, "scale": (1.03, 0.97), "pos": (0, 1)},
                head={"rot": -6, "pos": (0, -1)},
                cape_left={"rot": 26},
                cape_right={"rot": 26},
            ),
            K(
                1,
                arm_left={"rot": -46},
                arm_right={"rot": 46},
                leg_left={"rot": -12},
                leg_right={"rot": 10},
                torso={"rot": 9, "scale": (1.02, 0.98)},
                cape_left={"rot": 30},
                cape_right={"rot": 30},
            ),
            K(
                2,
                arm_left={"rot": -52},
                arm_right={"rot": 52},
                leg_left={"rot": -18},
                leg_right={"rot": 16},
                torso={"rot": 10, "scale": (1.03, 0.97), "pos": (0, 1)},
                head={"rot": -6, "pos": (0, -1)},
                cape_left={"rot": 26},
                cape_right={"rot": 26},
            ),
            K(
                3,
                arm_left={"rot": -52},
                arm_right={"rot": 52},
                cape_left={"rot": 28},
                cape_right={"rot": 28},
            ),
        ],
    },
    # ------------------------------------------------------------------- air
    "jump": {
        "fps": 15,
        "loop": False,
        "count": 5,
        "base": "arms_soft",
        "hold": 3,  # apex frame is held while the hero is still airborne
        "keys": [
            K(
                0,
                leg_left={"rot": 12},
                leg_right={"rot": -12},
                arm_left={"rot": -18},
                arm_right={"rot": 18},
                torso={"scale": (1.06, 0.93), "pos": (0, 6)},
                head={"pos": (0, 4), "rot": 3},
            ),
            K(
                1,
                leg_left={"rot": -14},
                leg_right={"rot": 12},
                arm_left={"rot": 72},
                arm_right={"rot": -72},
                torso={"scale": (0.95, 1.09), "pos": (0, -16)},
                head={"pos": (0, -4), "rot": -4},
                cape_left={"rot": 18},
                cape_right={"rot": 18},
            ),
            K(
                2.4,
                leg_left={"rot": 44},
                leg_right={"rot": 30},
                arm_left={"rot": 56},
                arm_right={"rot": -56},
                torso={"scale": (1.0, 1.04), "pos": (0, -22), "rot": 4},
                head={"pos": (0, -3), "rot": -6},
                cape_left={"rot": 24},
                cape_right={"rot": 22},
            ),
            K(
                3.6,
                leg_left={"rot": 30},
                leg_right={"rot": 44},
                arm_left={"rot": 40},
                arm_right={"rot": -44},
                torso={"scale": (1.01, 1.02), "pos": (0, -24), "rot": 2},
                head={"rot": 2},
                cape_left={"rot": 30},
                cape_right={"rot": 32},
            ),
            K(
                5,
                leg_left={"rot": -20},
                leg_right={"rot": 20},
                arm_left={"rot": -34},
                arm_right={"rot": 34},
                torso={"scale": (1.03, 0.98), "pos": (0, -6), "rot": -4},
                head={"rot": 6, "pos": (0, 1)},
                cape_left={"rot": -14},
                cape_right={"rot": -12},
            ),
        ],
    },
    "fall": {
        # Airborne and behind the jump's apex: legs trail, arms fly up, cape streams.
        # Held (hold=0) while the hero is falling, so it reads as a pose, not a loop.
        "fps": 10,
        "loop": True,
        "count": 3,
        "base": "arms_soft",
        "hold": 0,
        "keys": [
            K(
                0,
                g={"rot": -8, "pivot": (0.5, 0.62)},
                leg_left={"rot": 26},
                leg_right={"rot": 16},
                arm_left={"rot": -56},
                arm_right={"rot": 56},
                torso={"rot": -4, "scale": (0.99, 1.03)},
                head={"rot": 10, "pos": (0, -1)},
                cape_left={"rot": -26},
                cape_right={"rot": -22},
            ),
            K(
                1.5,
                g={"rot": -5, "pivot": (0.5, 0.62)},
                leg_left={"rot": 18},
                leg_right={"rot": 10},
                arm_left={"rot": -44},
                arm_right={"rot": 44},
                torso={"rot": -2, "pos": (0, -2)},
                head={"rot": 6},
                cape_left={"rot": -32},
                cape_right={"rot": -28},
            ),
            K(
                3,
                g={"rot": -8, "pivot": (0.5, 0.62)},
                leg_left={"rot": 26},
                leg_right={"rot": 16},
                arm_left={"rot": -56},
                arm_right={"rot": 56},
                torso={"rot": -4, "scale": (0.99, 1.03)},
                head={"rot": 10, "pos": (0, -1)},
                cape_left={"rot": -26},
                cape_right={"rot": -22},
            ),
        ],
    },
    "land": {
        # Absorb: knees out, hips low, arms thrown up for balance, body squashed. The
        # one-shot plays from the landing frame, so the squash has to be unmistakable.
        "fps": 16,
        "loop": False,
        "count": 4,
        "base": "arms_down",
        "hold": 3,
        "keys": [
            K(
                0,
                g={"rot": 4, "pivot": (0.5, 0.95), "scale": (1.06, 0.86), "pos": (0, 14)},
                torso={"rot": 16, "scale": (1.03, 0.95)},
                leg_left={"rot": -22, "pos": (-3, 0)},
                leg_right={"rot": 20, "pos": (3, 0)},
                arm_left={"rot": -50},
                arm_right={"rot": 46},
                head={"rot": -10, "pos": (0, -3)},
                cape_left={"rot": -18},
                cape_right={"rot": -16},
            ),
            K(
                1,
                g={"rot": 2, "pivot": (0.5, 0.95), "scale": (1.03, 0.93), "pos": (0, 8)},
                torso={"rot": 9, "scale": (1.01, 0.98)},
                leg_left={"rot": -10},
                leg_right={"rot": 8},
                arm_left={"rot": -24},
                arm_right={"rot": 22},
                head={"rot": -4},
                cape_left={"rot": -8},
                cape_right={"rot": -6},
            ),
            K(
                2,
                g={"rot": 0, "pivot": (0.5, 0.95), "scale": (1.0, 0.99), "pos": (0, 2)},
                torso={"rot": 3},
                leg_left={"rot": -2},
                leg_right={"rot": 2},
                arm_left={"rot": -6},
                arm_right={"rot": 6},
                head={"rot": 0},
                cape_left={"rot": 2},
                cape_right={"rot": 2},
            ),
            K(
                4,
                torso={"scale": (1.0, 1.0)},
                leg_left={"rot": 6},
                leg_right={"rot": -6},
                arm_left={"rot": 10},
                arm_right={"rot": -10},
            ),
        ],
    },
    # ------------------------------------------------------------------- tech
    "slide": {
        # Feet-first board slide. Two things make this read at 60 px: the body pitches
        # BACK and the legs shoot FORWARD — and a leg pointing forward is a *negative*
        # rotation in image space, which an earlier pass had inverted, so the pose looked
        # like a trip. The silhouette also has to be short, so the whole body is squashed.
        "fps": 18,
        "loop": False,
        "count": 4,
        "base": "arms_down",
        "hold": 2,
        "keys": [
            K(
                0,
                g={"rot": -14, "pivot": (0.5, 0.9), "scale": (1.02, 0.9), "pos": (0, 8)},
                torso={"rot": -14, "pos": (-4, 6)},
                leg_left={"rot": -34},
                leg_right={"rot": -20},
                arm_left={"rot": -26},
                arm_right={"rot": 22},
                head={"rot": 10, "pos": (3, 1)},
            ),
            K(
                1,
                g={"rot": -32, "pivot": (0.5, 0.92), "scale": (1.05, 0.74), "pos": (0, 34)},
                torso={"rot": -18, "pos": (-6, 4)},
                leg_left={"rot": -62},
                leg_right={"rot": -46},
                arm_left={"rot": 52},
                arm_right={"rot": -40},
                head={"rot": 26, "pos": (6, -3)},
                cape_left={"rot": 40},
                cape_right={"rot": 34},
            ),
            K(
                2,
                g={"rot": -30, "pivot": (0.5, 0.92), "scale": (1.05, 0.75), "pos": (0, 32)},
                torso={"rot": -16, "pos": (-5, 4)},
                leg_left={"rot": -58},
                leg_right={"rot": -42},
                arm_left={"rot": 46},
                arm_right={"rot": -36},
                head={"rot": 24, "pos": (5, -3)},
                cape_left={"rot": 46},
                cape_right={"rot": 40},
            ),
            K(
                3,
                g={"rot": -8, "pivot": (0.5, 0.9), "scale": (1.01, 0.94), "pos": (0, 8)},
                torso={"rot": -4, "pos": (-2, 2)},
                leg_left={"rot": -20},
                leg_right={"rot": -8},
                arm_left={"rot": 6},
                arm_right={"rot": -6},
                head={"rot": 6},
                cape_left={"rot": 16},
                cape_right={"rot": 12},
            ),
        ],
    },
    "roll": {
        # Forward roll: the whole body spins around its mid-mass. The pivot is kept
        # near the centre of mass and the body scaled down, so the head can sweep a
        # full circle without ever leaving the sprite cell.
        "fps": 24,
        "loop": False,
        "count": 8,
        "hold": None,
        "keys": [
            K(
                0,
                g={"rot": 0, "pivot": (0.5, 0.6), "scale": (0.74, 0.74), "pos": (0, 26)},
                leg_left={"rot": 56},
                leg_right={"rot": 44},
                arm_left={"rot": 44},
                arm_right={"rot": -40},
                head={"rot": -10},
                torso={"scale": (0.99, 0.96)},
                cape_left={"rot": 26},
                cape_right={"rot": 22},
            ),
            K(1, g={"rot": -45, "pivot": (0.5, 0.6), "scale": (0.72, 0.72), "pos": (0, 26)}, leg_left={"rot": 58}, leg_right={"rot": 46}, arm_left={"rot": 46}, arm_right={"rot": -42}, cape_left={"rot": 30}, cape_right={"rot": 26}),
            K(2, g={"rot": -90, "pivot": (0.5, 0.6), "scale": (0.7, 0.7), "pos": (2, 26)}, leg_left={"rot": 60}, leg_right={"rot": 48}, arm_left={"rot": 48}, arm_right={"rot": -44}, cape_left={"rot": 32}, cape_right={"rot": 28}),
            K(3, g={"rot": -135, "pivot": (0.5, 0.6), "scale": (0.72, 0.72), "pos": (4, 24)}, leg_left={"rot": 58}, leg_right={"rot": 46}, arm_left={"rot": 46}, arm_right={"rot": -42}, cape_left={"rot": 30}, cape_right={"rot": 30}),
            K(4, g={"rot": -180, "pivot": (0.5, 0.6), "scale": (0.74, 0.74), "pos": (2, 22)}, leg_left={"rot": 54}, leg_right={"rot": 44}, arm_left={"rot": 44}, arm_right={"rot": -40}, cape_left={"rot": 28}, cape_right={"rot": 26}),
            K(5, g={"rot": -225, "pivot": (0.5, 0.6), "scale": (0.76, 0.76), "pos": (0, 20)}, leg_left={"rot": 50}, leg_right={"rot": 40}, arm_left={"rot": 40}, arm_right={"rot": -36}, cape_left={"rot": 24}, cape_right={"rot": 22}),
            K(6, g={"rot": -270, "pivot": (0.5, 0.6), "scale": (0.8, 0.8), "pos": (-2, 16)}, leg_left={"rot": 44}, leg_right={"rot": 34}, arm_left={"rot": 34}, arm_right={"rot": -30}, cape_left={"rot": 20}, cape_right={"rot": 18}),
            K(7, g={"rot": -315, "pivot": (0.5, 0.6), "scale": (0.86, 0.86), "pos": (-2, 8)}, leg_left={"rot": 30}, leg_right={"rot": 22}, arm_left={"rot": 20}, arm_right={"rot": -16}, cape_left={"rot": 12}, cape_right={"rot": 10}),
            K(8, g={"rot": -360, "pivot": (0.5, 0.6), "scale": (0.94, 0.94), "pos": (0, 2)}, leg_left={"rot": 10}, leg_right={"rot": 6}, arm_left={"rot": 4}, arm_right={"rot": -4}, torso={"scale": (1.0, 1.0)}),
        ],
    },
    # ------------------------------------------------------------------ states
    "stumble": {
        "fps": 16,
        "loop": False,
        "count": 6,
        "base": "arms_soft",
        "hold": None,
        "keys": [
            K(
                0,
                torso={"rot": -16, "pos": (-2, -2), "scale": (1.02, 1.0)},
                head={"rot": -14, "pos": (-4, -5)},
                arm_left={"rot": 66},
                arm_right={"rot": -60},
                leg_left={"rot": -22},
                leg_right={"rot": 26},
                cape_left={"rot": 22},
                cape_right={"rot": 18},
            ),
            K(
                2,
                torso={"rot": 14, "pos": (3, 2), "scale": (0.98, 1.02)},
                head={"rot": 12, "pos": (3, 2)},
                arm_left={"rot": -44},
                arm_right={"rot": 40},
                leg_left={"rot": 18},
                leg_right={"rot": -20},
                cape_left={"rot": -14},
                cape_right={"rot": -10},
            ),
            K(
                4,
                torso={"rot": -6, "pos": (0, -1)},
                head={"rot": -5},
                arm_left={"rot": 26},
                arm_right={"rot": -22},
                leg_left={"rot": -8},
                leg_right={"rot": 8},
            ),
            K(6),
        ],
    },
    "victory": {
        "fps": 13,
        "loop": True,
        "count": 8,
        "hold": None,
        "keys": [
            K(
                0,
                arm_left={"rot": 64},
                arm_right={"rot": -66},
                leg_left={"rot": -10},
                leg_right={"rot": 10},
                torso={"pos": (0, -8), "scale": (0.99, 1.03)},
                head={"rot": -4, "pos": (0, -3)},
                cape_left={"rot": 20},
                cape_right={"rot": 20},
            ),
            K(
                2,
                arm_left={"rot": 84},
                arm_right={"rot": -40},
                leg_left={"rot": 8},
                leg_right={"rot": -8},
                torso={"pos": (0, 2), "rot": 2},
                head={"rot": 6},
                cape_left={"rot": -12},
                cape_right={"rot": -14},
            ),
            K(
                4,
                arm_left={"rot": 78},
                arm_right={"rot": -70},
                leg_left={"rot": -6},
                leg_right={"rot": 6},
                torso={"pos": (0, -6)},
                head={"rot": -3},
                cape_left={"rot": 16},
                cape_right={"rot": 18},
            ),
            K(
                6,
                arm_left={"rot": 88},
                arm_right={"rot": -30},
                torso={"pos": (0, 1), "rot": -2},
                head={"rot": -6},
                cape_left={"rot": -8},
                cape_right={"rot": -10},
            ),
            K(
                8,
                arm_left={"rot": 64},
                arm_right={"rot": -66},
                torso={"pos": (0, -8)},
            ),
        ],
    },
}


#: Baked sheet layout: row-major cell order.
SHEET_ORDER: list[str] = list(STATES.keys())

#: Which state each animation tag the game asks for maps to (aliasing keeps the
#: runtime free of special cases).
ALIASES: dict[str, tuple[str, float]] = {
    "start": ("jump", 0.0),
    "hurt": ("stumble", 0.0),
    "coin": ("victory", 2.0),
    "menu": ("idle", 0.0),
}
