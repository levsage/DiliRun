#!/usr/bin/env python3
"""Crop states out of the baked sprite sheet, at real sprite size, on the in-game background.

A pose that looks correct in a contact sheet can still be unreadable at 60 px on a phone, which
is the size it actually ships at. This is the review tool for that gap:

    python3 tools/asset-pipeline/inspect.py                 # every state, one file per row
    python3 tools/asset-pipeline/inspect.py --states run,slide,land
    python3 tools/asset-pipeline/inspect.py --scale 1.0 --bg "#1a2c56"
    python3 tools/asset-pipeline/inspect.py --open          # also write out/inspect.html (a grid)

Output goes to ``tools/asset-pipeline/out/inspect-<state>.png`` (git-ignored scratch).
"""

from __future__ import annotations

import argparse
import json
import os
from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SPRITES = os.path.join(REPO, "public", "assets", "sprites")
OUT = os.path.join(REPO, "tools", "asset-pipeline", "out")


def parse_hex(value: str) -> tuple[int, int, int, int]:
    v = value.lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    if len(v) != 6:
        raise argparse.ArgumentTypeError(f"expected #rrggbb, got {value!r}")
    return (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16), 255)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sheet", default=os.path.join(SPRITES, "dilirun-hero-sheet.webp"))
    ap.add_argument("--manifest", default=os.path.join(SPRITES, "dilirun-hero-sheet.json"))
    ap.add_argument("--states", default="", help="comma separated; default is every state in the manifest")
    ap.add_argument("--scale", type=float, default=0.62, help="0.62 ≈ the size a 384 px cell draws at on a phone")
    ap.add_argument("--bg", type=parse_hex, default=(26, 44, 86, 255), help="track colour from theme.json")
    ap.add_argument("--gap", type=int, default=8)
    ap.add_argument("--open", action="store_true", help="also write out/inspect.html embedding every strip")
    args = ap.parse_args()

    with open(args.manifest, encoding="utf8") as fh:
        man = json.load(fh)
    sheet = Image.open(args.sheet).convert("RGBA")
    cell, cols = int(man["cell"]), int(man["columns"])
    wanted = [s.strip() for s in args.states.split(",") if s.strip()] or list(man["states"].keys())
    unknown = [s for s in wanted if s not in man["states"]]
    if unknown:
        print(f"unknown states: {', '.join(unknown)}\navailable: {', '.join(man['states'])}")
        return 2

    os.makedirs(OUT, exist_ok=True)
    written: list[str] = []
    for state in wanted:
        spec = man["states"][state]
        count, hold = int(spec["count"]), spec.get("hold")
        w, h = int(cell * args.scale), int(cell * args.scale)
        canvas = Image.new("RGBA", (w * count + args.gap, h + 26), args.bg)
        for i in range(count):
            index = int(spec["from"]) + i
            x, y = (index % cols) * cell, (index // cols) * cell
            frame = sheet.crop((x, y, x + cell, y + cell)).resize((w, h), Image.LANCZOS)
            ox = args.gap // 2 + i * w
            canvas.alpha_composite(frame, (ox, 24))
            # frame index, with * on the held frame: "which frame does this state park on?" is
            # the question you always want answered while reviewing
            from PIL import ImageDraw

            d = ImageDraw.Draw(canvas)
            label = f"{i}" + ("*" if hold is not None and i == int(hold) else "")
            d.text((ox + 4, 6), label, fill=(255, 255, 255, 210))
        path = os.path.join(OUT, f"inspect-{state}.png")
        canvas.convert("RGB" if args.bg[3] == 255 else "RGBA").save(path, optimize=True)
        written.append(path)
        print(f"  {state:9s} {count} frames @ {spec['fps']}fps  → {os.path.relpath(path, REPO)}")

    if args.open:
        rows = "".join(
            f'<figure><img src="{os.path.basename(p)}"><figcaption>{os.path.basename(p)[8:-4]}</figcaption></figure>'
            for p in written
        )
        html = (
            "<!doctype html><meta charset=utf-8><title>DiliRun sheet review</title>"
            "<style>body{background:#0a1c4f;color:#fff;font:13px system-ui;margin:24px}"
            "figure{margin:0 0 22px}img{width:100%;image-rendering:auto;border-radius:10px}"
            "figcaption{text-transform:uppercase;letter-spacing:.14em;opacity:.7;margin-bottom:6px}</style>"
            + rows
        )
        out = os.path.join(OUT, "inspect.html")
        with open(out, "w", encoding="utf8") as fh:
            fh.write(html)
        print(f"  grid → {os.path.relpath(out, REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
