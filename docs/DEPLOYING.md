# Deploying DiliRun

Two environments, one codebase:

| Branch     | URL                                     | Purpose                        |
| ---------- | --------------------------------------- | ------------------------------ |
| `main`     | https://levsage.github.io/DiliRun/      | stable, what beta is merged to |
| `beta`     | same URL (when deployed from beta)      | playtest build for feedback    |
| PR preview | `https://<fork>/…` or `npm run preview` | contributor checks             |

The build is path-independent (`base: './'` in `vite.config.ts`), so it works at the domain root
or under `/DiliRun/`, from any repo name.

## 0. Current state (recorded as of M0–M3)

| Thing    | State                                                                                      |
| -------- | ------------------------------------------------------------------------------------------ |
| Repo     | https://github.com/levsage/DiliRun — **public**, default branch `main`                     |
| Branches | `main` (stable) · `beta` (integration) · `gh-pages` (build snapshot, never edited by hand) |
| Pages    | enabled, **legacy** source = `gh-pages` / `https://levsage.github.io/DiliRun/`             |
| Actions  | **not enabled yet** — see §1                                                               |

`gh-pages` holds a plain `vite build` output. That is a deliberate stopgap: pushing build artefacts
needs only Contents permission, while the workflow-based pipeline needs the token scope below.

## 1. Token permissions this repo needs (one-time, owner)

| Action                                 | Permission                   | Status                                                   |
| -------------------------------------- | ---------------------------- | -------------------------------------------------------- |
| push code, docs, art                   | Contents: Read & write       | ✅ working                                               |
| push `.github/workflows/**`            | **Workflows: Read & write**  | ❌ rejected → mirror lives in [`docs/ci/`](ci/README.md) |
| configure Pages                        | **Pages: Read & write**      | ⚠️ partially; the Settings toggle always works           |
| repo settings (topics, merges, issues) | Administration: Read & write | ✅ working                                               |

Grant the missing scopes on the fine-grained PAT, then:

```bash
git push origin main && git push origin beta     # carries the "ci:" commit with the workflows
git rm -r docs/ci && git commit -m "chore: drop the CI mirror (Actions are live)"
```

## 2. What CI does

`.github/workflows/ci.yml` runs on every push/PR to `main` and `beta`:

1. `npm ci` → typecheck → lint → `prettier --check` → `vitest run` → `npm run build`
2. reports the gzipped bundle sizes of the largest chunks
3. **assets job** — installs `tools/asset-pipeline/requirements.txt`, runs
   `python tools/asset-pipeline/build.py --debug`, and fails if the rig's rest-pose
   reconstruction IoU drops below the gate or if the regenerated manifests no longer match
   what is committed (i.e. someone hand-edited a sheet)

If it goes red, the fix is always one of: `npm run check`, `npm run assets`, or a documented
exception. Never `--force` past a red check on `main`.

## 3. Publishing a build today (legacy branch source)

```bash
npm run build
sha=$(git rev-parse --short HEAD)                      # from the source repo, before cd-ing away
tmp=$(mktemp -d) && cp -r dist/* "$tmp" && cd "$tmp"
git init -q -b gh-pages
git config user.name "DiliRun bot" && git config user.email "dev@dliicom.com"   # the temp repo has no identity
git add -A && git commit -qm "build: dilirun@$sha"
git push --force origin gh-pages:gh-pages
```

Read the snippet rather than pasting it: `$(git rev-parse --short HEAD)` inside the fresh temp repo is
the snapshot commit's own hash, not the source build's, and a `mktemp -d` repo inherits no
`user.name`, so `commit` fails with "Author identity unknown" until you set it. Over HTTPS the push
URL needs a `Contents:write` token — `git push --force "https://<owner>:${TOKEN}@github.com/levsage/DiliRun.git" gh-pages:gh-pages`.

Replaces the whole site in one commit; Pages rebuilds in ~30 s. Keep the branch build-clean:
`gh-pages` must contain only `dist/`.

## 4. Switching to the Actions pipeline (recommended once CI is live)

```bash
gh api -X PUT /repos/levsage/DiliRun/pages -f build_type=workflow   # Settings → Pages → Source: GitHub Actions
git push origin main                                                # pages.yml builds + deploys
git push origin --delete gh-pages                                   # retire the snapshot branch
```

`actions/deploy-pages` **fails** while Pages is configured for branch builds, so flip the source in
the same change that starts using the workflow.

Beta playtests share the one slot:

```bash
gh workflow run "Deploy to GitHub Pages" --ref beta
# or promote/rollback by moving the branch pointer
git push --force origin <sha>:beta
```

## 5. Versioning the deployment

`__DILI_VERSION__` is defined at build time from `package.json`, and `index.html` bakes
`%GAME_VERSION%` (see `vite.config.ts`). Both show up in the HUD footer, so a tester's screenshot
identifies the exact build. Use tags for releases:

```bash
git tag -a v1.0.0-beta.1 -m "first playable beta"
git push origin v1.0.0-beta.1
```

## 6. PWA install

`public/manifest.webmanifest` is wired up (icons in `public/icons/`, theme colours from
`src/game/data/theme.json`). Installing from a Pages URL works over HTTPS; on a LAN dev server
pass `--host` and use Chrome's `chrome://flags/#allow-insecure-localhost` for install testing.

Service-worker caching (an `Offline` milestone item) is **not** implemented yet — the game needs
the network on first load. Documented in `docs/ROADMAP.md`.

## 7. Rollback

```bash
git log --oneline main                    # find the last good build
git revert --no-commit <sha1> <sha2>      # or reset a beta pointer
git push origin main
```

Because the artefacts in `public/` are generated and committed, a revert of source _and_ art moves
together — there is no "the sheet no longer matches the code" state to clean up.

## 8. Hosting elsewhere (if Pages is too slow or you want a custom domain)

- **Cloudflare Pages / Netlify** — build command `npm run build`, output `dist`, no base path needed
  (set `base: "/"` there; keep `'./'` for Pages).
- **Any static host / intranet** — `dist/` is self-contained; `npm run preview` proves it locally.
- **itch.io** — zip `dist/` and upload as an HTML file; the game has no backend, so it works offline
  after the first load, and records stay in the browser's `localStorage`.

Nothing in the app calls a server, so no secrets, CORS or HTTPS exceptions are needed anywhere.
