# DiliRun asset pipeline

Turns the two uploads in `assets/source/` into every sprite the game ships.

```bash
python -m pip install -r requirements.txt      # numpy, opencv-python-headless, Pillow
python build.py                                # regenerate public/assets + public/icons
python build.py --debug                          # + contact sheets, rig sheet, docs GIF into out/
python build.py --character hero.png --logo logo.png --copy-sources
python build.py --cell 320 --min-iou 0.98        # smaller art, stricter gate
```

| Path                            | Role                                                       |
| ------------------------------- | ---------------------------------------------------------- |
| `build.py`                      | CLI: orchestration, quality gates, manifest writing        |
| `config/rig.json`               | the 8 rig parts: cut rects, hinges, z-order, joint patches |
| `dilirun_assets/segment.py`     | ink detection, silhouette, cast-shadow removal, part crops |
| `dilirun_assets/rig.py`         | cut-out renderer + keyframe interpolation                  |
| `dilirun_assets/poses.py`       | the animation library (edit this to change how it moves)   |
| `dilirun_assets/spritesheet.py` | supersampled bake, row-major packing, manifest             |
| `dilirun_assets/brand.py`       | logo tints, app icons, coin sprite                         |
| `dilirun_assets/qa.py`          | reconstruction IoU + overlap checks                        |
| `dilirun_assets/util.py`        | image/affine helpers shared by the above                   |

Exit code is non-zero when a gate fails, so CI can block a rig that no longer matches the source art.
`out/` is git-ignored scratch; `docs/preview/animation-preview.gif` is committed and regenerated.

Design notes and the "why": [`docs/ASSETS.md`](../../docs/ASSETS.md).
