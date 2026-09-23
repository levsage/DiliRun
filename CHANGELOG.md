# Changelog

All notable changes to DiliRun are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — unreleased (beta)

### Added

- **Playtest pass (owner feedback, 2026-09-23)** — four fixes to how the run reads: the hero animates from
  drawn key poses, coins arrive on their own schedule, every hazard advertises its answer, and the game
  opens and closes on a home stage.

- **Home stage and identity (M6, early)** — `ShellMode` is now `home | run`: the menu is the attract
  world with a card over it carrying the four numbers worth reading twice, the runner-name field and the
  language toggle. `src/game/profile.ts` owns the name (trimmed, one line, ≤ 16 code points, combining
  marks alone rejected) and the chosen locale, both versioned in `localStorage` and independent of the
  records store, so "clear board" leaves the name alone. `RunRecord.name` is stamped at submit time, the
  Runner Board shows it per row with a `You` chip and an `label.unnamed` fallback, and the receipt ends on
  **[Run again]** / **[Home]**. The pause card offers **[Resume]** / **[Home]**. `InputController` now
  ignores events whose target is a control, so a tap on the language button cannot start a run and a space
  typed into a name cannot make the hero jump.
- **Action arrows on hazards** — `src/render/Glyphs.ts` draws pure geometry (chevrons, a circular arrow,
  an octagon plate) and `RunScene.paintSignal` puts ↑ on a jumpable block, ↓ in the gap under a beam and
  nothing at all on a train, whose answer is a lane change. `Spawner.signalFor` derives the glyph from
  `clearWith` and refuses to pick one when a hazard answers two ways; `tests/unit/signals.test.ts` pins
  the promise in both directions and checks the geometry stays finite at every sprite size.
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

### Changed

- **Coins are an independent stream.** Obstacle rows no longer carry a
  `coins` field; a `Spawner` frontier lays strips of 2–5 on its own cadence, pushed out of every hazard's
  time window and trimmed rather than dropped when the horizon runs out. `data/obstacles.json` loses the
  per-pattern `coins` key and gains a per-kind `signal`; `data/balance.json` gains `coinGapMeters`,
  `coinGapJitterMeters`, `coinGapSpeedFactor`, `coinSafeStartMeters` and `coinClearanceMeters`.
- **The four in-view states come from generated key poses** (`run 6, jump 2, fall 2, slide 3, land 3`);
  the sheet is 3072×2304 with 47 frames and 10 states, and the rig still owns the rest. `rebuilds differ
  only in generatedAt`.
- **Locale coverage** — `data/strings.json` now ships a complete `bn` bundle (41 keys) and every HUD caption
  reaches it: `ScoreBoard`, `CoinBar`, `Lives` and `LeaderboardPanel` take labels in and can relabel in
  place, so switching language is instant rather than a reload. `run.ready` and `over.board` retired with
  the card they belonged to.

### Still open

- **M5 — feel & polish**: hit-stop, screen shake, near-miss flashes and the pose pass are in; WebAudio SFX,
  coin pickup FX and score pop-ups are not.
- **M6 — screens**: the home stage, runner name, locale switcher and the receipt actions shipped early;
  a settings sheet (sound and quality), a how-to card and the PWA install affordance are still to do.
- **M7 — ship**: mobile pass, Lighthouse, README GIF, `beta` → `main`, tag and deploy.

## [0.1.0] — 2026-09-22

- Project created: repo layout, brand assets imported, plan agreed.
