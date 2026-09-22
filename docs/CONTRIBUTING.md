# Contributing to DiliRun

Thanks for caring about structure — this repo is deliberately boring to work in, on purpose.

## Setup

```bash
nvm use                 # node 20
npm ci
npm run dev             # http://localhost:5173   (add ?lab=1 for the animation bench)
npm run check           # typecheck + lint + prettier-check + tests + build
```

Optional (only when you touch the art): `pip install -r tools/asset-pipeline/requirements.txt`.

## Branches & commits

- Branch from `beta`: `feature/m4-spawner`, `fix/hud-reflow`, `art/hero-roll-poses`, `chore/...`.
- Conventional commits, one logical change each: `feat:`, `fix:`, `art:`, `perf:`, `refactor:`,
  `docs:`, `test:`, `chore:`. Scope is welcome: `feat(hud): coin bar milestone fill`.
- Squash-merge to `beta`; `beta` → `main` only at a release cut (see `docs/ROADMAP.md`).

## House rules (the ones that actually matter)

1. **No new runtime dependencies** without a written case in a PR. The bundle is ~12 KB today.
2. **Layers**: `core` ← `game`/`render`/`ui` ← `app`. `core` never imports project code; `game`
   never touches the DOM. If a change needs to break this, the design is wrong — open an issue first.
3. **Tuning lives in `src/game/data/balance.json`, colour lives in `src/game/data/theme.json`.**
   No hex codes or magic seconds inside logic. This is what keeps the art and the UI in sync.
4. **Generated art is committed but never hand-edited.** Change the pipeline, run `npm run assets`.
   If the QA gate (`--min-iou`) fails, the rig change is wrong.
5. **Every mechanic gets a unit test next to it** if it is a pure rule (scoring, records, input,
   timing). Rendering is reviewed in the browser; use `?lab=1` and `docs/preview/`.
6. **Perf**: nothing allocates per frame in `update()`. If you add a system, say in the PR how many
   draws it costs.
7. Run `npm run format` before pushing; the lint job is not a formatting police — it is for bugs.

## PR template

`.github/PULL_REQUEST_TEMPLATE.md` asks for: what changed, how it was verified (the exact command and
its output), screenshots/GIF for anything visual, and the perf/DOM-write note. Fill the verification
line — "CI was green" is not a substitute for "I ran `npm run check` and `?lab=1`".

## Issue templates

`bug-report.yml`, `feature-request.yml`, `art-asset.yml` (the last one exists because most DiliRun
work is art-in-data, and it forces the frame/pose/hinge questions up front).
