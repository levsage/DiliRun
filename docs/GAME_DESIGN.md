# DiliRun — Game Design (v1.0.0)

## 1. Fantasy and tone

You are the **Dliicom hero** — glass-domed helmet, navy cape, thumbs-up confidence — sprinting an
endless rail line through the Dliicom district, scooping coins, and turning near-misses into a
score multiplier. Bright, cartoon, fast, forgiving. Never grimdark.

## 2. Session loop

```
Title → Run (start) → [dodge / collect / combo] → Crash or 3rd stumble → Run summary
   ↑                                                                              ↓
   └───────────────────── Leaderboard shows your rank, tap Run ───────────────────┘
```

Target first-run time: **under 3 seconds** from page load to running (no login, no tutorial wall).
Target average run: **60–120 s**. One-hand playable on a phone.

## 3. Controls

| Action             | Keyboard            | Touch/mouse           | Gamepad (later) |
| ------------------ | ------------------- | --------------------- | --------------- |
| Lane left          | `A` / `←`           | swipe left            | dpad left       |
| Lane right         | `D` / `→`           | swipe right           | dpad right      |
| Jump               | `W` / `↑` / `Space` | swipe up / tap        | A               |
| Slide (roll under) | `S` / `↓`           | swipe down            | B               |
| Roll (tuck)        | hold `Shift` + jump | second quick swipe up | X               |
| Pause              | `Esc` / `P`         | pause button          | Start           |

Input is **buffered** for 160 ms (`InputController`) so a press slightly early still lands after a
landing — this is the single biggest "feels good" item in a runner.

## 4. Track model

- **3 lanes.** Lane change is a lerp over `laneChangeSeconds` (0.16 s), never instantaneous.
- **Depth**: objects live at a `metersAhead` distance; `project(depth)` maps that to
  `y`, `scale` and `laneStep`. Everything (hero, coins, obstacles, shadows) uses the same function.
- **Hero** is pinned at `depth 0` (near plane). Only the world moves. This is what keeps a 2D
  canvas readable and is how the original works under the hood.
- **Vertical states**: `grounded`, `airborne` (jump arc), `sliding`, `rolling`. Collision heights
  per state: standing 1.0, jumping varies with the arc, sliding 0.42, rolling 0.45.

## 5. Obstacles

| Type          | Blocks           | Counter        | Notes                                                   |
| ------------- | ---------------- | -------------- | ------------------------------------------------------- |
| `barrierLow`  | 1 lane, ground   | jump           | 0.9 m tall crate/scaffold, brand navy + cyan            |
| `barrierHigh` | 1 lane, overhead | slide / roll   | beam at 1.2 m — jumping into it is a fail               |
| `trainLow`    | 1 lane, 6 m long | lane change    | must change lane; can be landed on top (v1.0.0: not)    |
| `trainTall`   | 2 lanes, 10 m    | lane change    | forces a specific lane, telegraphed one pattern earlier |
| `beamRow`     | 3 lanes overhead | slide anywhere | the "greedy" pattern: punish if the player jumps        |

Spawn rules (`systems/Spawner.ts`, tuning in `game/data/balance.json`):

- First `safeStartMeters` (55 m) is empty — the player gets their feet under them.
- Every pattern leaves **at least one solvable lane** and a `minGapMeters` (14 m) breather.
- Difficulty tiers by speed: T1 single obstacles → T2 two-lane blocks → T3 coin-line bait +
  `beamRow` → T4 double trains with a coin arc reward in the safe lane.
- Coin patterns are placed **through the solution**, so the correct path is also the profitable path.
  This is the core design trick of the genre and it is non-negotiable.

## 6. Coins, scoring, combo

- Coin = **+25 score**, `+1 coin` to the bar, `+1` combo step.
- **Multiplier** = `min(comboMax, 1 + combo × 0.1)` → up to ×5 shown in the score board.
- Combo window: 2.6 s without a pickup/near-miss → combo resets (shown by the multiplier cooling).
- **Near miss** (passing an obstacle in the adjacent lane within a small x/y window): +40 m of score
  and keeps the combo alive. This rewards aggressive play over passive play.
- Distance: 1 point per metre.
- Crash on the last life ends the run; a stumble (lives > 1) costs the combo, 0.5 s of invulnerability
  and a screen shake.
- Final score = floor(metres × pointsPerMeter + coins × coinValue).

## 7. HUD spec (the three meta-systems from the brief)

```
┌──────────────────────────────────────────────┐
│ [Dliicom logo] DiliRun        ┌──────────── │
│  v1.0.0 · single player       │  SCORE     │ │  ← ScoreBoard: score, distance,
│                               │  1 240     │ │     multiplier, personal best
│                               │  320 m  ×1.4│ │
│                               └────────────┘ │
│                                              │
│              (track + hero)                  │
│                                              │
│  ┌────────────────────┐   ╭─────────────╮    │
│  │ Top runs (this device)│  │ 🪙 128 │ 3 402 │ ← CoinBar: run coins | bank |
│  │ 1 … 10 rows        │   ╰─────────────╯    │     milestone fill
│  └────────────────────┘                      │
└──────────────────────────────────────────────┘
```

- **Coin bar**: run coins (big, tabular) + banked total + a 3 px milestone track that fills toward the
  next 25-coin bonus; the icon is the actual 12-frame spinning coin sprite from the pipeline.
- **Score board**: never reflows (digit width reserved), highlights at ×2+ multiplier.
- **Leaderboard**: top 10 on the device, gold outline on your new entry, `1.2k m · 84 🪙 · 3m ago`
  metadata rows. Empty state is a call to action, not a shrug.

## 8. Game over card

Score (counting up), distance, coins, best combo, near misses, and **rank delta**
("new #2 on this device"). Two actions: `Run again` (Space/tap) and `Leaderboard`. A run that beats
the personal best shows a `PB` flag and reorders the panel behind the card.

## 9. Audio (M5)

Synthesised with WebAudio — no audio files, no autoplay problem (armed on first input):
coin ping (rising with combo), jump whoosh, slide air, stumble thud, crash + detuned "aw",
menu blip, and a 2-bar loop for the title. Every sound has a `sfx` toggle in settings.

## 10. Accessibility and fairness

- `prefers-reduced-motion` → no screen shake, slower coin spin, static menu background.
- Colours are checked so obstacles read in greyscale (shape carries the meaning: low beam vs tall train).
- All actions available on keyboard; no timing minigame requires sound.
- Text sizes use `clamp()`; the HUD never overlaps the play area's centre 60 %.

## 11. Explicit non-goals for v1.0.0

Multiplayer, characters/skins store, missions, ads, backend accounts, level editor, 3D, keyboard
remapping UI, cloud saves.
