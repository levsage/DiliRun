# DiliRun — Deploy (GitHub Pages)

The site is 100 % static, so Pages is the whole deployment story.

## One-time enablement (needs the repo to be public, or Pages on a paid private plan)

```bash
# flip the repo to public
gh repo edit levsage/DiliRun --visibility public

# create the Pages site (the CI workflow uploads the artifact)
gh api -X POST repos/levsage/DiliRun/pages -f 'source[branch]=main' -f 'source[path]=/'
```

Or via the API with a token (what `.github/workflows/pages.yml` assumes): **Settings → Pages →
Source: GitHub Actions**.

## Branch → URL

| Branch | URL                                                   | Notes                       |
| ------ | ----------------------------------------------------- | --------------------------- |
| `main` | `https://levsage.github.io/DiliRun/`                  | stable, production          |
| `beta` | preview artifact only (download from the Actions run) | keeps the public URL honest |

`vite.config.ts` sets `base: './'`, so the build works from any sub-path — no per-environment config.

## Manual build

```bash
npm ci
npm run build       # dist/ — upload this anywhere static
npm run preview     # serves dist/ locally on :4173
```

## Cache-busting

Asset file names are content-hashed by Vite except the generated art, which keeps stable names so
`docs/ASSETS.md` links survive. Pages serves `Cache-Control: max-age=600` for HTML, so a redeploy is
visible within ~10 minutes; hard-reload while iterating.

## Rollback

Re-run the Pages workflow for the previous tag: `gh run list --workflow=pages.yml` then
`gh run rerun <id>`. Nothing else is stateful (no server, no DB), so rollback is just files.
