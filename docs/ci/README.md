# GitHub Actions definitions (mirror)

These are the real workflow files, copied out of `.github/workflows/` so they can be
**read and enabled without a token that has the `workflow` scope**.

GitHub rejects any push that touches `.github/workflows/**` unless the PAT used for the
push has the **Workflows / write** permission. Two ways to get CI running:

**A. Web UI (no token changes needed)** — in this repo: *Add file → Create new file*,
paste the contents of [`ci.yml`](ci.yml) at path `.github/workflows/ci.yml`, commit;
repeat with [`pages.yml`](pages.yml). ~2 minutes.

**B. Fix the token, then push the proper commit** —
GitHub → Settings → Developer settings → Personal access tokens → your fine-grained token
→ *Repository permissions* → **Workflows: Read and write**. Then:

```bash
git push origin main          # includes the "ci:" commit that adds .github/workflows/
git push origin beta
```

and delete this mirror folder.

| File      | Trigger                       | Does                                                          |
| --------- | ----------------------------- | ------------------------------------------------------------- |
| `ci.yml`  | push/PR on `main`, `beta`     | typecheck · lint · prettier · vitest · build · bundle report · re-runs `tools/asset-pipeline` (fails if the rig drifts from the source art or the committed manifests go stale) |
| `pages.yml` | push on `main`, manual dispatch | builds `dist/` and deploys it to GitHub Pages (needs Pages enabled: Source = GitHub Actions) |
