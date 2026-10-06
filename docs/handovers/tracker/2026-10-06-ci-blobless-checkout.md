# CI `changes` job: blobless checkout, e2e fails closed — 2026-10-06

Slug: `ci-blobless-checkout`. Handover: `HANDOVER-ci-blobless-checkout-2026-10-06.md`. Doc snapshot: `1WpV2D-CtbHmrXvZE4BggzmgeE0A3JjajM5lNW_5Bsl8`.
PR #286 → `dev` as `e29b687`; not promoted. The change is CI-only, with no app or runtime effect. Migration: none.

The `changes` job checks out with `filter: blob:none`, which dropped its checkout from 20 s – 5 min+ to about 3 s. Its diff uses `--no-renames`. `e2e` now skips only when `changes` explicitly reports `code=false`; if `changes` fails or times out, e2e runs.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| ci-blobless-checkout.1 | Docs-only change still skips e2e on the new workflow | Close-out PR #290 run 37487093926, the first docs-only PR on the new workflow: `changes` 6 s (blobless fetch ~2 s), listed only the three `docs/` files, so `code=false`; `verify` passed; `e2e` **skipped**. | — | ☑ |
| ci-blobless-checkout.2 | Code change runs e2e; checkout fast | PR #286 run 37345644065: `changes` 8 s (blobless fetch ~2 s), listed `.github/workflows/ci.yml`, `code=true`; `e2e` ran and passed in 4 min 54 s. | — | ☑ |
| ci-blobless-checkout.3 | Fail-closed when `changes` fails | PR #286 run 37344939883, with a temporary `exit 1` in `changes` (reverted before merge): `changes` = failure, `verify` = success, `e2e` **started**. It was cancelled in its build step, before Playwright, when the revert superseded the run. | — | ☑ |
| ci-blobless-checkout.4 | `main` still has the old `ci.yml` | Pushes to `main` use `main`'s workflow until the next promote. A promotion PR runs on the dev→main merge commit, so it already has the new one. | Next `promote`: check that the post-merge `main` run shows `changes` in seconds. | ☐ |
| ci-blobless-checkout.5 | Purge old videos from git history? | Not done. `docs/REC-git-history-purge-2026-10-05.md` recommends not now: ~954 MB of the 1,017 MiB pack is `public/videos/**`, and the rewrite would break the 271 commit SHAs cited in `docs/` and `.claude/`, including the rollback targets in 34 release records. | David decides. If yes, follow the REC checklist in a quiet window. | ☐ |
| ci-blobless-checkout.6 | Commits that reached `dev` while e2e was silently skipped | Every CI run since 5 Oct 16:00Z checked. Three had `changes` cancelled: 37339900393 (dev, ed95f95 #284), 37339934097 (PR #282, docs), 37340672371 (dev, 0b0b404, docs). ed95f95's PR run 37336995300 passed e2e. No code reached `dev` without e2e. | — | ☑ |
