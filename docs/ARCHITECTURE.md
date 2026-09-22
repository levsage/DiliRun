# DiliRun — Architecture

## 1. Shape of the codebase

```
dilirun/
├── index.html                  static shell: canvas + brand + HUD + boot overlay
├── src/
│   ├── main.ts                 entry: reads ?lab=1, boots, exposes window.DILI for debugging
│   ├── version.ts              __DILI_VERSION__ (injected from package.json at build time)
│   ├── app/                    composition root — owns DOM, assets, loop, HUD wiring
│   │   ├── Boot.ts             find/build DOM, preload assets, failure UI with Retry
│   │   ├── GameShell.ts        Stage + Loop + HUD + records + active scene
│   │   ├── AttractScene.ts     menu/attract scene (also the art's live preview)
│   │   └── PoseLab.ts          dev-only animation bench (?lab=1)
│   ├── core/                   engine primitives, zero game knowledge
│   │   ├── Emitter.ts          typed events; unsubscribe during emit is honoured
│   │   ├── Loop.ts             fixed-step simulation + interpolated render, catch-up cap
│   │   ├── Assets.ts           joinUrl/base-path safe loader, image+json cache, typed manifest
│   │   ├── Storage.ts          Store(prefix, version) over a pluggable driver, quota-safe
│   │   ├── Input.ts            keys + swipes → buffered GameAction intents
│   │   └── Random.ts           mulberry32, weighted pick, shuffle (deterministic spawns)
│   ├── render/                 everything that touches the canvas
│   │   ├── Stage.ts            DPR + letterbox, sprite-cell blit by anchor, shadow ellipse
│   │   ├── Perspective.ts      project(depth), laneX(lane, depth): one mapping for all entities
│   │   ├── SpriteAnimator.ts   manifest-driven playback: loop, hold frame, speed, aliases
│   │   └── Theme.ts            theme.json accessor, CSS custom-property publishing, colour maths
│   ├── game/                   rules and data, no DOM
│   │   ├── data/
│   │   │   ├── theme.json      ★ palette + fonts (shared with the Python pipeline)
│   │   │   └── balance.json    ★ all gameplay tuning constants
│   │   ├── scoring.ts          RunAccumulator: distance, coins, combo, bonuses, snapshot
│   │   ├── records.ts         Leaderboard + Scoreboard over Store; RunRecord schema + guards
│   │   ├── entities/           (M4) Hero, Obstacle, Coin, ParticleField
│   │   └── systems/            (M4) Spawner, Collision, LaneController, Camera, Audio
│   ├── ui/
│   │   ├── hud/                CoinBar.ts · ScoreBoard.ts · LeaderboardPanel.ts
│   │   └── screens/            (M6) Title · Pause · GameOver · Settings · HowTo
│   └── styles/game.css         HUD + shell styling, driven by --dili-* variables
├── public/
│   ├── assets/                 generated art (see docs/ASSETS.md) + manifest.json index
│   ├── icons/                  generated app icons / favicon sizes
│   └── manifest.webmanifest    PWA metadata
├── assets/source/              the two uploaded masters (hero art, logo) — inputs, never loaded at runtime
├── tools/asset-pipeline/       Python rig/baker (its own package, own README, own requirements)
├── tests/unit/                 vitest suites (see §5)
└── docs/                       plan, design, architecture, assets, roadmap, deploying
```

★ = single source of truth. Nothing else may hard-code a colour or a tuning number.

## 2. Layers and allowed dependencies

```
index.html → app → { game, render, ui } → core
```

- `core/` imports nothing from the project (no canvas, no DOM beyond `Storage`'s default driver).
- `game/` is DOM-free: it can be unit tested in node and reused if the renderer changes.
- `render/` knows about canvas but not about rules.
- `ui/` is DOM, and is allowed to read `game` snapshots only — it never mutates them.
- `app/` is the only place that wires layers together (composition root).

ESLint enforces the style rules; layering is enforced by review + the fact that lower layers
import nothing upward (no cycles possible by construction).

## 3. Frame flow

```
requestAnimationFrame
  └─ Loop.tick(now)
       ├─ accumulator += min(delta, 0.25) × timescale
       ├─ ≤5 × update(1/60):  scene.update(dt) → systems → RunAccumulator → snapshot
       └─ render(alpha):      Stage.begin → scene.render → drawSpriteCell(...)
```

- **Simulation is fixed (1/60 s)**, so collision and speed are frame-rate independent.
- **Render interpolation** (`alpha`) is available for sprite smoothing; the scene passes the
  interpolated depth to `project()`.
- HUD DOM writes are skipped when the snapshot has not changed (`ScoreBoard.update` early-outs).

## 4. Asset contract (the important boundary)

The pipeline and the game talk through two JSON files and never through code:

```
public/assets/manifest.json                      what exists
public/assets/sprites/dilirun-hero-sheet.json    how to play it
```

Sheet manifest (excerpt):

```json
{
  "format": "dilirun-spritesheet-v1",
  "imagePath": "sprites/dilirun-hero-sheet.webp",
  "cell": 384,
  "columns": 8,
  "rows": 7,
  "frameCount": 55,
  "anchor": { "x": 0.5, "y": 0.955 },
  "states": {
    "run": { "from": 6, "count": 8, "fps": 17, "loop": true },
    "jump": { "from": 17, "count": 5, "fps": 15, "loop": false, "hold": 3 }
  },
  "aliases": { "hurt": { "state": "stumble", "frame": 0 } }
}
```

Rules:

- Frames are packed **row-major, back to back**; `frameRect(index)` is the only geometry the game needs.
- `anchor` is where the feet sit inside a cell; the renderer blits by anchor so no per-state offsets
  leak into gameplay code.
- `hold` says which frame to freeze on while an action is sustained (airborne, sliding).
- Adding an animation = add a state to `poses.py` + re-run `npm run assets`. **No TS changes.**
- `tests/unit/SpriteAnimator.test.ts` parses the real manifest and fails if any state would read
  outside the sheet — so the contract is verified, not documented-and-hoped.

## 5. Tests

| Suite                    | Protects                                                          |
| ------------------------ | ----------------------------------------------------------------- |
| `Loop.test.ts`           | fixed timestep, catch-up cap, pause does not bank time            |
| `Assets.test.ts`         | sub-path base resolution, caching, readable HTTP errors           |
| `Storage.test.ts`        | namespacing, corrupt payload recovery, quota failure              |
| `records.test.ts`        | top-N cut-off, rank math, coin banking, junk-row filtering        |
| `scoring.test.ts`        | multiplier/combo window/crash reset/bonuses, comparator order     |
| `Input.test.ts`          | dominant-axis swipes, buffer window + injectable clock            |
| `Emitter.test.ts`        | unsubscribe-during-emit semantics                                 |
| `SpriteAnimator.test.ts` | **sheet manifest integrity vs the real baked art**, playback/hold |

Run: `npm test`. Everything in one command: `npm run check` (typecheck + lint + tests + build).

## 6. Planned seams (M4/M5) — designed in, not yet built

- `game/entities/Spawner.ts` consumes `balance.json.spawn` + `Random.ts`; returns patterns, never
  canvas nodes. Deterministic per seed → replayable runs and a possible daily challenge for free.
- `game/systems/Collision.ts` is a pure function `(hero, obstacles, coins, cfg) → contacts`, and the
  only place a hazard can be marked `hit`, `scored` or `threatened`.
- `game/entities/Hero.ts` owns lanes, hop arc and stances; `game/systems/RunWorld.ts` owns speed,
  scroll, lives and the run's phase. Neither imports canvas, DOM or `src/render`, so the whole game
  is testable on a simulated clock — see `tests/unit/RunWorld.test.ts` and the bot in
  `tests/unit/worldHarness.ts`, which is also the level generator's fairness proof.
- `src/app/RunScene.ts` is a view: `world.step()`, then draw. If a rule shows up in there, move it.
- `render/Camera.ts` will own shake/hit-stop as a post-transform so no entity code needs to know.
- `platform/Audio.ts` behind an interface, so `AudioContext` unavailability is a no-op implementation.
- `Leaderboard` already takes a `Store`; a hosted board becomes a second implementation of the same
  `submit/top` pair, no UI change.

## 7. Performance budget

- JS: < 60 KB gz (currently ~12 KB + 0.7 KB engine chunk) — no dependencies.
- Draw calls per frame: < 120 (hero 1, coins ≤ 12, obstacles ≤ 12, ground ≤ 40, HUD is DOM).
- No allocation inside `update()`; entities are pooled in M4 (`core/Pool.ts`).
- Art budget: hero sheet 1.4 MB WebP, coin strip 56 KB, icons < 30 KB. Everything is cached by the
  service worker-less HTTP cache on Pages; revisit with a SW only if the Lighthouse pass demands it.
