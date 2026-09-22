# DiliRun — Roadmap & Branching

## Versioning

SemVer for the game, `1.0.0` for the first shipped build. `package.json` is the only place the number
lives; `src/version.ts` bakes it into the bundle (`__DILI_VERSION__`) and the README/PWA read it from
there.

## Branches

| Branch | Purpose                                      | Rules                                                        |
| ------ | -------------------------------------------- | ------------------------------------------------------------ |
| `main` | Always shippable. Tagged releases live here. | PRs from `beta` only, CI green required, squash-merge        |
| `beta` | Integration branch for all feature work.     | `feature/*` and `fix/*` merge here via PR; CI green to merge |

```
feature/m4-run-scene ──► beta ──(release cut)──► main  (tag v1.0.0)
                              ◄──(hotfix back-merge after release)──
```

- `beta` deploys automatically to GitHub Pages as the **beta channel** once Pages is enabled
  (`docs/DEPLOYING.md`); `main` deploys to the same Pages site as the stable build.
- Every merged PR to `main` should be tagged (`v1.0.0`, `v1.0.1`), with a `CHANGELOG.md` entry.

## Milestones

| #   | Milestone             | Contents                                                                                | Status                 |
| --- | --------------------- | --------------------------------------------------------------------------------------- | ---------------------- |
| M0  | Repo foundation       | structure, TS/Vite/Vitest/ESLint/Prettier, CI, Pages workflow, docs                     | ✅ done                |
| M1  | Brand + art pipeline  | logo tints, icons, hero segmentation + rig + pose library + sheet bake, QA gates        | ✅ done                |
| M2  | Engine primitives     | loop, assets, storage, input, rng, emitter, animator, perspective, theme                | ✅ done                |
| M3  | Shell + HUD + records | stage, attract scene, score board, coin bar, leaderboard, pose lab                      | ✅ done                |
| M4  | The run               | lanes, jump/slide/roll FSM, spawner, collisions, lives, speed curve, game over → submit | ✅ sim + scene shipped |
| M5  | Feel & polish         | parallax, coin FX, shake/hit-stop, WebAudio SFX, score pop-ups                          | ⏳                     |
| M6  | Screens               | title, how-to, settings (sound/quality/controls), pause, game-over card                 | ⏳                     |
| M7  | Ship v1.0.0           | mobile pass, Lighthouse, README/GIF, `beta` → `main`, tag + deploy                      | ⏳                     |

## Post-1.0 candidates (parked, not promised)

- Daily challenge (seeded runs already fall out of `Random.ts`).
- Ghost of your best run (replay data is a snapshot stream, tiny).
- Hosted leaderboard (the `RunRecord` shape is API-ready).
- Second playable character, power-ups (magnet, jetpack, shield), districts/themes.
- Bengali locale + locale switcher.
