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

## 7. Authoring poses that read at 60 px

Three rules, each learned by reviewing the baked sheet and finding a pose that was mathematically
fine and visually wrong:

1. **Keyframe values are _deltas_ on top of the state's `base` stance** (`_compose` adds them). A run
   frame with `arm_left: -52` is really `-34 - 52 = -86°` from the drawing's T-pose — which is why the
   first run cycle flapped: the arms swept 100° instead of a runner's ~35°.
2. **Legs forward is a negative rotation** (image space, y grows down). The first `slide` used positive
   values, so the legs kicked behind the body and the pose read as a trip.
3. **A crouch has to change the silhouette height, not only the joints.** `slide` and `land` use the
   whole-body transform (`g={"rot", "pivot", "scale", "pos"}`) to squash the figure to ~0.74 of its
   height; limb angles alone never bring the helmet down to the 0.85 m hitbox the game promises.
4. **Never name a module in `tools/asset-pipeline/` after a stdlib module.** CI runs
   `python tools/asset-pipeline/build.py` from the repo root, so that directory is `sys.path[0]`; a file
   called `inspect.py` shadowed stdlib `inspect` and killed `import numpy` in CI only. This is why the
   review tool is `pose_review.py`.

### Reviewing a pose

```bash
npm run assets:debug          # rebuild the sheet + contact sheets in tools/asset-pipeline/out
npm run assets:inspect        # crop each state at real sprite size, on the track colour
npm run assets:inspect -- --states run,slide,land --open
npm run dev -- --open "/?lab=1"   # then watch it move
```

`tools/asset-pipeline/pose_review.py` draws the frame index above every cell and marks the **held**
frame with `*`, because "which frame does this state park on?" is the question a one-shot animation
lives or dies by. If a pose looks right in a contact sheet and wrong in an inspect strip, it is
wrong — the strip is what ships.

## 8. Generated key poses (the four states in view)

The rig is honest work for a pose that holds, but it could not sell a sprint: two passes of limb angles
still read as a mannequin sliding on a treadmill. So the four states a player actually watches — `run`,
`jump`, `fall`, `slide`, `land` — are **drawn key poses, generated from the uploaded mascot**, and the
rig keeps the states nobody inspects frame by frame (`idle`, `dash`, `roll`, `stumble`, `victory`, plus
the `start`/`hurt`/`coin`/`menu` aliases).

| State   | Frames | Where they come from                                              |
| ------- | -----: | ----------------------------------------------------------------- |
| `run`   |      6 | `gen-run.png`, a 3×2 grid: contact → down → pass → mid → contact′ |
| `jump`  |      2 | `gen-air.png` cells 0–1 (take-off, tuck)                          |
| `fall`  |      2 | `gen-air.png` cells 2–3 (extend, reach for ground)                |
| `slide` |      3 | `gen-slide.png`, one row, held on the last                        |
| `land`  |      3 | `gen-land.png`, one row, held two frames                          |

The four sheets in `assets/source/generated/` are **committed inputs**, not scratch: they were painted on
a flat green screen against `images: uploads/…mascot.png` so the helmet, face, suit colours and cape are
the same character the rest of the repo was built from. `npm run assets` re-derives the sheet from them
byte-for-byte (only `generatedAt` moves), so a rebuild in CI produces the same art without a network call
and without an image model in the loop.

### How a sheet becomes frames

`tools/asset-pipeline/dilirun_assets/genframes.py`, configured by `config/frames.json`:

1. **Key by flooding, not by colour.** A flat green screen is not one colour — compression leaves bands
   of subtly different green — so `foreground_mask` floods in from the border and then fills enclosed
   pockets. A straight chroma key eats the highlights of the art.
2. **Heal the separator bars.** The generator draws dark grid lines between cells. Deleting them cuts
   every figure in half and leaves a bar where the line crossed artwork, so `repair_lines` copies the
   nearest non-line neighbour into each line row/column, per pixel. Averaging the two sides of a bar
   paints a pale stripe through a limb; copying does not.
3. **Let the authored count cluster the pieces.** Grouping torn limbs by a proximity threshold is a dead
   end (6 px splits a figure, 14 px fuses two neighbours and drops a frame). Instead `expect` — the frame
   count in `frames.json` — drives `cluster_by_gaps`, which cuts the widest centre-to-centre gaps. That is
   scale-free, and it works across grid rows because a figure and the one under it share an x.
4. **`clip` and `cells` handle the grids.** `gen-run.png` is read as two rows of three, `gen-air.png` as
   four cells of which two pairs are used.
5. **`figureHeight` normalises scale.** Generated cells vary in how much of the frame the figure fills;
   each state scales to a fraction of the cell (`run` 0.86, `land` 0.84) so the feet meet `ANCHOR_Y` and
   the silhouette does not pump up and down between poses.

### Gates that fail the build

- a state whose detected cell count is not its `expect`;
- any figure touching an image edge (`clipped > 0`) — that is a crop, not a pose;
- coverage outside 0.08–0.85 of the cell, or a raw height spread above 2.2.

Height spread has a wide tolerance on purpose: normalising by design makes the raw numbers differ, and a
tight gate here once failed a sheet that looked perfect. `build.py` prints
`coverage / raw height spread / width spread / clipped / lines healed` for every state.

### The one review that counts

`npm run assets:inspect -- --states run` composites each frame at **real sprite size on the track
colour**. A pose that looks good on a contact sheet and wrong there is wrong. That is how a regenerated
`run` sheet got rejected — the helmet faces had turned into brains and the middle pose was standing — and
how the pale limb stripe from the averaging version of `repair_lines` was caught.
