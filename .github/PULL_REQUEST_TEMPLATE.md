## What & why

<!-- One paragraph. What does this change, and which problem from docs/PLAN.md does it close? -->

Closes #

## Type

- [ ] feat — gameplay/engine behaviour
- [ ] fix
- [ ] art — pipeline/rig/pose change (regenerated assets included)
- [ ] perf
- [ ] refactor (no behaviour change)
- [ ] docs / test / chore

## How I verified it

```
# paste the exact commands you ran and their tail output
npm run check
```

- [ ] `npm run check` is green locally
- [ ] opened `http://localhost:5173/?lab=1` and watched the animation (art/pose changes)
- [ ] `npm run assets` re-run and its QA gate passed (art changes only)
- [ ] mobile viewport checked at 390×844 (HUD changes only)

## Screenshots / GIF

<!-- Required for anything visible. A runner that "feels fine" in text can still look broken. -->

## Notes for reviewers

- Does this add a per-frame allocation or extra draw calls? (budget in docs/ARCHITECTURE.md §7)
- Does a tuning number or colour need to move into `src/game/data/*.json` instead of code?
