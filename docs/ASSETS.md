# DiliRun — Asset Pipeline

The art in `public/` is **generated**, from the two uploads in `assets/source/`, by
`tools/asset-pipeline`. Nothing in the game is drawn by hand in a paint program, so the hero can be
re-posed, re-scaled or re-skinned from data.

```
assets/source/hero_source.png   ─┐
                                 ├─► build.py ─► public/assets/sprites/dilirun-hero-sheet.{webp,json}
assets/source/dliicom_logo.png  ─┘             public/assets/sprites/coin-sheet.{png,json}
                                               public/assets/ui/logo-{white,navy,cyan,gold}.png
                                               public/assets/ui/hero-{idle,portrait}.png
                                               public/icons/icon-*.png
                                               public/assets/manifest.json
```

## Run it

```bash
python3 -m pip install -r tools/asset-pipeline/requirements.txt   # numpy, opencv-headless, pillow
npm run assets            # regenerate everything, run the QA gates
npm run assets:debug       # + contact sheets, rig-part sheet, docs GIF in tools/asset-pipeline/out
```

Swap in new art (e.g. a replaced logo or a redrawn hero) with:

```bash
python3 tools/asset-pipeline/build.py \
  --character /path/to/hero.png --logo /path/to/logo.png --copy-sources --debug
```

`--copy-sources` normalises the uploads into `assets/source/` (max width 1400, PNG-optimised) so the
repo stays light while the pipeline stays reproducible.

## How the hero becomes animatable

1. **Ink detection** — the illustration is cartoon with heavy dark outlines, so "locally much darker
   than the neighbourhood" finds the linework even though the suit and the background share almost
   the same luminance (`segment.stroke_mask`).
2. **Silhouette** — the background, the flat gradient and the artist's cast shadow are all _reachable
   from the image border without crossing ink_, so a flood fill on `~stroke` isolates the figure.
   The cast shadow is then removed geometrically: an enclosed component that is very wide, very flat
   and at the bottom of the frame (`drop_flat_bottom_regions`).
3. **Parts** — 8 rectangles (normalised in `config/rig.json`) cut the silhouette into
   `head, torso, arm_left/right, leg_left/right, cape_left/right`. Overlap is deliberate: a limb
   carries a slice of its neighbour past the hinge, so rotation never reveals the background.
   Every part is cropped from **one pre-scaled canvas**, which is why the rest pose is pixel-exact.
4. **Poses** — `poses.py` is a keyframe library per rig part (`rot`, `pos`, `scale`, plus a
   whole-body `global` transform for the roll spin). Base stances (`BASE`) let locomotion states
   author deltas from an arms-down runner pose instead of the source T-pose.
5. **Bake** — each state is rendered supersampled (2×) and downscaled with `INTER_AREA`, then packed
   row-major into one sheet + JSON manifest. `anchor` in the manifest is where the feet sit, so the
   engine blits by anchor and never needs per-state offsets.

## QA gates (enforced, `exit 1` on failure)

| Gate                          | Threshold | Meaning                                                            |
| ----------------------------- | --------- | ------------------------------------------------------------------ |
| `reconstruction_iou`          | ≥ 0.96    | rig at identity reproduces the source silhouette (currently 0.999) |
| sheet bounds (in tests)       | —         | no state can read outside the packed image                         |
| `frameCount` == sum of counts | —         | manifest and sheet agree                                           |

```bash
python3 tools/asset-pipeline/build.py --min-iou 0.98   # tighten while iterating
```

## Editing the rig

- Move a hinge, change a cut, add a part → edit `config/rig.json` (`pivot`, `rect`, `z`, `joints`),
  then `npm run assets:debug` and look at `out/rig-parts.png`, `out/frames-contact-sheet.png`,
  `out/qa-diff.png`.
- Change an animation → edit `poses.py` only. Then check `docs/preview/animation-preview.gif`.
- The hero renders correctly in the browser at `http://localhost:5173/?lab=1` (pose bench, one button
  per state, live frame readout).

## Generated files are committed on purpose

Deploying to GitHub Pages must work without Python. So the _outputs_ are in git, the _inputs_ are in
git, and the tool is in git too — a contributor can reproduce every byte of art with one command, and
CI runs the pipeline to prove the committed output is not stale.

## Swapping to hand-drawn sprite sheets later

If a proper hand-drawn sheet ever replaces the rig: drop the PNG at
`public/assets/sprites/dilirun-hero-sheet.png`, rewrite the JSON manifest by hand (same `format`,
`states`, `cell`, `anchor`), and point `imagePath` at it. The runtime does not care how the frames were
made — the manifest is the whole contract.
