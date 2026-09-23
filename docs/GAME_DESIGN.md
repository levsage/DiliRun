# DiliRun — Game Design (v1.0.0)

## 1. Fantasy and tone

You are the **Dliicom hero** — glass-domed helmet, navy cape, thumbs-up confidence — sprinting an
endless rail line through the Dliicom district, scooping coins, and turning near-misses into a
score multiplier. Bright, cartoon, fast, forgiving. Never grimdark.

## 2. Session loop

```
Home (name · board · Run) → Run (start) → [dodge / collect / combo] → Crash or 3rd stumble → Receipt
   ↑                                                                                        ↓
   └────────────────────────── [Run again] loops straight back in; [Home] returns ──────────┘
```

Home is a real stage, not a modal over a dead screen: the attract world keeps running behind the card,
so the first thing a player sees is the hero already sprinting through Dliicom City. It carries the four
numbers worth looking at twice (best score, best metres, runs, coin bank), the name that goes on the
Runner Board, and one button. The run ends on a receipt with **[Run again]** and **[Home]** — the score
is over there, and the identity is over here, so nothing about "who am I" ever sits in the middle of a
run. Target: two taps from a cold page to running.

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

Heights come from `game/data/obstacles.json`, where `heightMeters` means _how tall a ground hazard
is_ and, for an overhead one, _how much clearance is left under it_. Collision never measures
pixels: a hazard is beaten by whatever is in its `clearWith` list, matched against the hero's
stance — which is why the art can be re-posed without changing any rule.

Spawn rules (`systems/Spawner.ts`, tuning in `game/data/balance.json`):

- First `safeStartMeters` (55 m) is empty — the player gets their feet under them.
- Every pattern leaves **at least one solvable lane**, and _solvable_ is strict: there must be
  **one single action** that beats everything standing in that lane. A crate (jump) and a gantry
  (slide) in the same lane are two fair hazards and no fair answer, so `Spawner.answerForLane`
  returns `null` and the row is repaired by opening a lane. Asserted in `Spawner.test.ts`.
- Consecutive patterns are `minGapMeters` (14 m) apart, widened by `gapSpeedFactor` with speed;
  rows _inside_ one pattern (the `double` combo) are spaced by `max(9 m, 0.55 s)`, so a combo at
  21 m/s is still readable. Also asserted.
- Difficulty tiers by speed: T1 single obstacles → T2 two-lane blocks → T3 coin-line bait +
  `beamRow` → T4 double trains with a coin arc reward in the safe lane.
- **Coins and hazards are on separate schedules.** A coin strip is emitted by its own frontier
  (`coinGapMeters` + jitter + a speed term), never attached to an obstacle row, so coins keep arriving
  while the blocks are taking a breath. Two safety rules survive the split, both asserted in
  `Spawner.test.ts`: a strip is nudged out of any hazard's time window — **a coin never arrives at the
  same moment as the block that is trying to kill you** — and it is only laid in a lane that is clear for
  its whole length. A coin _inside_ a hazard is not a reward, it is a death with a sparkle on it.
- A strip that would reach past ground the spawner has not stocked yet is **trimmed**, not dropped:
  dropping made busy stretches turn into 100 m coin deserts, and "coins keep coming" is the promise.

### 5.1 Action arrows

Every hazard wears the shape of its own answer, painted on the face the player is looking at:

| Signal | Glyph | Appears                 | Meaning                      |
| ------ | ----- | ----------------------- | ---------------------------- |
| `jump` | ↑↑    | above a ground block    | jump it                      |
| `duck` | ↓↓    | in the gap under a beam | slide (or roll) under        |
| `roll` | ⟳     | centred on the body     | barrel roll (nothing in v1)  |
| `none` | —     | trains                  | change lane; do not trust it |

The arrow is **derived from `clearWith`, never authored alongside it**: `Spawner.signalFor` collapses
the stance list into the two shapes a player can read at 30 px, and a hazard that could be cleared
_either_ way gets no glyph at all, because naming one of two answers is a half-truth painted where
people look for the whole one. `tests/unit/signals.test.ts` pins both directions — signal implies
answer, answer implies signal — and that a lone hazard with an arrow is actually solvable in its own lane.
They fade in over the last 26 m and pulse in brand gold once the hazard is aimed at your lane, so the
information is in the busy foreground and not in the distance.

## 6. Coins, scoring, combo

- Coin = **+25 score**, `+1 coin` to the bar, `+1` combo step.
- **Multiplier** = `min(comboMax, 1 + combo × 0.1)` → up to ×5 shown in the score board.
- Combo window: 2.6 s without a pickup/near-miss → combo resets (shown by the multiplier cooling).
- **Near miss** (passing an obstacle in the adjacent lane within a small x/y window): +40 m of score
  and keeps the combo alive. This rewards aggressive play over passive play.
- Distance: 1 point per metre.
- Coin cadence (data, not code): `coinGapMeters` 13 + up to 7 m jitter + `0.35 × (speed − 9)` metres
  between strip starts, `coinSpacingMeters` 1.5 apart inside a strip, up to `coinsPerPattern` 5, opened
  at `coinSafeStartMeters` 30 — 25 m before the first hazard, so the run starts with something to chase.
  Measured over 3 km at 15 m/s that is a strip every ~26 m and no coin-free stretch over ~60 m.
- Crash on the last life ends the run; a stumble (lives > 1) costs the combo, 0.5 s of invulnerability
  and a screen shake.
- Final score = floor(metres × pointsPerMeter + coins × coinValue).

## 7. HUD spec (the three meta-systems from the brief)

The Runner Board is a home-stage object: it lists rank, **who ran it**, score, metres, coins and age,
and is hidden during a live run (`[data-mode="run"]`) where the only numbers that matter are the ones
you are moving.

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

Score (counting up), distance, coins, best combo, near misses, and **rank** ("#2 on the Runner Board").
Two actions: **[Run again]** (Space/tap, restarts in place) and **[Home]**. A run that beats the personal
best celebrates the hero and reorders the board behind the card. The row it adds is stamped with the
name from the profile _at that moment_, so renaming yourself afterwards cannot rewrite history.

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
