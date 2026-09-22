# DiliRun — Project Plan (v1.0.0)

> Living document. This is where the design of the game is agreed before code is written.
> Owner: [@levsage](https://github.com/levsage) · Repo: https://github.com/levsage/DiliRun · Branches: `main` (stable), `beta` (integration)

## 1. One-line brief

A **2D Subway-Surfers-style endless runner** for a single player, starring the **Dliicom hero**
(the uploaded mascot), with real **poses and animation** rather than a static sprite, the
**Dliicom logo** as the brand mark, and the three meta-systems the brief calls out:
**score board**, **leaderboard** and **coin bar**.

## 2. What "like Subway Surfers" means here (the mechanics we are copying)

| Subway Surfers element     | DiliRun equivalent                                                            |
| -------------------------- | ----------------------------------------------------------------------------- |
| 3 lanes, forward scroll    | 3 lanes, pseudo-3D perspective on a 2D canvas (2D art, 3D-ish projection)     |
| Swipe left/right to change | Keys `A/D`/`←/→` + touch swipe                                                |
| Swipe up to jump/roll      | `W`/`↑`/`Space` jump (tap), `S`/`↓` slide, double-tap-ish = roll              |
| Trains/barriers to dodge   | Barriers (slide under), trains (lane block, jump on top), low beams           |
| Coins in patterns          | Coin lines/arcs/zigzags, engraved with the Dliicom mark                       |
| Crash = run over           | 3 lives, stumble → recover, crash ends the run                                |
| Speed ramps up over time   | 9 m/s → 21 m/s with a smooth curve, spawn gaps shrink with it                 |
| Score = distance + pickups | metres × 1 + coins × 25, with a combo multiplier up to ×5                     |
| HI-SCORE / friends         | On-device top-10 leaderboard + session scoreboard (single player, no account) |

**Deliberately not in v1.0.0:** multiplayer, accounts, stores/IAP, character upgrades, 3D,
backend services, level editors.

## 3. Hard requirements from the brief

1. **Main character = the uploaded illustration.** Not a look-alike drawn from scratch: the
   actual art is segmented and rigged. ✅ done — `tools/asset-pipeline` cuts the uploaded PNG into
   8 articulated parts (head, torso, 2 arms, 2 legs, 2 cape panels) and the rest pose reproduces
   the source art at **IoU 0.9993** (build-time QA gate).
2. **Poses + animation.** ✅ done — 10 states / 55 baked frames: `idle`, `run`, `dash`, `jump`,
   `fall`, `land`, `slide`, `roll`, `stumble`, `victory`, hand-authored as keyframed poses
   (`poses.py`), then baked into a sprite sheet the runtime just plays.
3. **Dliicom logo = the uploaded logo.** ✅ done — the white-on-transparent mark is used as uploaded,
   with tint variants (navy/cyan/gold), PWA/app icons and the mark engraved into the coin sprite.
4. **Single player.** ✅ no network calls at runtime; everything is local.
5. **Score board.** 🚧 HUD panel built (`src/ui/hud/ScoreBoard.ts`); needs live run wiring.
6. **Leaderboard.** ✅ data layer + panel + tests (`src/game/records.ts`, `src/ui/hud/LeaderboardPanel.ts`).
7. **Coin bar.** ✅ HUD component with the real spinning coin sprite + banked total + milestone
   progress (`src/ui/hud/CoinBar.ts`).
8. **Repo well structured and organised.** ✅ layered `src/`, docs, CI, tests, asset pipeline as a
   first-class tool with its own package, issue/PR templates, changelog.

## 4. Architecture decisions (and why)

| Decision            | Choice                                              | Why                                                                                                         |
| ------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Rendering           | Canvas 2D + sprite sheets, no WebGL                 | The brief says 2D. Canvas is universally supported, debuggable, and cheap to ship.                          |
| Framework           | **None** (vanilla TS)                               | A game loop fights React's render cycle. Bundle stays ~30 KB gz, no dependency risk.                        |
| Language            | TypeScript strict                                   | Collision/spawner math is where untyped JS games rot.                                                       |
| Build               | Vite (`base: './'`)                                 | Works from `localhost` and a GitHub Pages sub-path with zero config.                                        |
| Art pipeline        | Python + OpenCV, committed output                   | Segmentation/rig baking is a build-time job; committing the sheet keeps the site deployable without Python. |
| Animation authoring | Keyframed rig poses → baked frames                  | Poses stay editable as data (`poses.py`) while runtime playback is a trivial sheet blit.                    |
| Perspective         | Single `project(depth)` function                    | Hero, coins and obstacles share one mapping, so nothing can drift.                                          |
| Persistence         | Versioned `localStorage` (`Store`)                  | Single player, offline-first, testable; the record shape is already API-ready for a hosted board later.     |
| Tests               | Vitest unit tests + asset-manifest integration test | The sheet manifest test fails CI if the pipeline emits a sheet the renderer would draw outside.             |

## 5. Milestones

- [x] **M0 — Repo foundation**: structure, tooling, CI, docs, branch model, PWA shell.
- [x] **M1 — Brand & art pipeline**: logo variants, icons, hero segmentation, rig, pose library,
      sheet packing, QA gates, coin sprites.
- [x] **M2 — Engine primitives**: fixed-step loop, asset loader with cache + fallback, input
      (keys + swipe + buffering), deterministic RNG, storage, typed emitter, sprite animator,
      perspective, theme.
- [x] **M3 — Shell + HUD + records**: canvas stage with DPR/letterbox, score board, coin bar,
      leaderboard panel, attract scene showing the animated hero on the track, `?lab=1` pose bench.
- [ ] **M4 — The run (gameplay core)**: `RunScene` — lanes & lane changes, jump/slide/roll state
      machine, obstacle spawner with patterns, AABB collisions, lives/stumble, speed curve,
      scoring/combo, pause & resume, game-over → leaderboard submit.
- [ ] **M5 — Feel & polish**: parallax layers, coin magnet FX, screen shake, hit-stop, WebAudio SFX
      (synthesised, no audio files), score pop-ups, run summary card, replay hint.
- [ ] **M6 — Shell screens**: title/menu, how-to-play, settings (sound, quality, controls),
      game-over with rank highlight, `beta` features flag.
- [ ] **M7 — Ship v1.0.0**: mobile landscape/portrait pass, iOS Safari audio-unlock, Lighthouse
      performance pass, README/GIF refresh, tag `v1.0.0`, merge `beta` → `main`, Pages deploy.

## 6. Definition of done for v1.0.0

- A run starts, plays, ends and is recorded end-to-end on desktop and mobile Chrome/Safari.
- Hero visibly animates (run/jump/slide/roll/stumble/victory) at 60 fps on a mid-range phone.
- Score board, coin bar and leaderboard all show live, correct values; best run survives a reload.
- No console errors; `npm run check` (typecheck + lint + tests + build) is green on CI for `beta`.
- `npm run assets` reproduces the committed art and passes the IoU gate.

## 7. Open questions for you (the product owner)

Answered → ticked off here, then folded into the docs.

1. **Repo visibility** — `levsage/DiliRun` is **public** already, so GitHub Pages works at
   `levsage.github.io/DiliRun/` (enable the Source in Settings, see `docs/DEPLOYING.md`).
2. **Leaderboard scope** — on-device only (v1.0.0) vs. a free hosted board (e.g. a small
   REST/JSON store) for global ranks. The `RunRecord` shape is already portable.
3. **UI language** — English only, or English + বাংলা toggle? The font stack is already Bengali-safe
   (`Hind Siliguri` / system fallbacks), so a `bn` locale file is cheap.
4. **Art polish depth** — is the rigged cut-out of your illustration the final look (current), or do
   you also want a hand-drawn sprite sheet (e.g. 8-frame run) supplied later? The runtime can swap
   sheets without code changes; only `config/rig.json` + a `--sheet` flag matter.
5. **Names in the world** — what are the three lanes/the district called? ("Dliicom Docks",
   "Hero Line" …) Cosmetic, but it makes the loading screen and HUD feel owned rather than generic.
