# Changelog

All notable changes to DiliRun are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — unreleased (beta)

### Added

- **Repository foundation (M0)** — layered TypeScript/Vite project, strict `tsconfig`, flat
  ESLint config, Prettier, Vitest, `.editorconfig`, issue/PR templates, CI (`ci.yml`) and
  GitHub Pages deploy (`pages.yml`) workflows, branch policy (`main` stable, `beta` integration).
- **Asset pipeline (M1)** — `tools/asset-pipeline`: background/ink-aware segmentation of the
  uploaded hero illustration, an 8-part cut-out rig driven by `config/rig.json`, a keyframe pose
  library (`poses.py`) with 10 states / 55 frames, supersampled sprite-sheet baking with a JSON
  manifest, plus Dliicom logo tints, PWA/app icons and a spinning coin sprite engraved with the
  brand mark.
- **Quality gates** — the build fails if the rig's rest pose stops reproducing the source art
  (reconstruction IoU ≥ 0.96; currently 0.999). Contact sheets, rig-part sheets and a docs GIF are
  emitted with `--debug`.
- **Engine primitives (M2)** — fixed-timestep `Loop` with catch-up cap, base-path-safe `AssetLoader`
  (image + JSON cache, WebP with PNG fallback), versioned namespaced `Store`, buffered keyboard/swipe
  `InputController`, seeded `Random`, typed `Emitter`, manifest-driven `SpriteAnimator`
  (loop/hold/speed/aliases), `Perspective` projection and theme→CSS publishing.
- **Game shell (M3)** — canvas `Stage` with DPR + letterbox, attract scene (hero running on the
  track with coins), HUD: **coin bar** (run coins, bank, milestone fill, real coin sprite),
  **score board** (score, distance, multiplier, best), **leaderboard** panel (top 10, self-highlight);
  PWA manifest + icons; `?lab=1` pose bench for animation review.
- **Rules & records** — `RunAccumulator` scoring (distance + coins + combo multiplier + near-miss and
  perfect-change bonuses) and `Leaderboard` (top-N cut-off, rank, coin banking, session best,
  corruption-tolerant reads), all covered by unit tests.
- **Documentation** — `docs/PLAN.md`, `GAME_DESIGN.md`, `ARCHITECTURE.md`, `ASSETS.md`,
  `ROADMAP.md`, `DEPLOYING.md`, `CONTRIBUTING.md`.

### In progress

- **M4 — playable run**: lane state machine, obstacle spawner, collisions, lives, speed curve,
  game over → leaderboard submit.

## [0.1.0] — 2026-09-22

- Project created: repo layout, brand assets imported, plan agreed.
