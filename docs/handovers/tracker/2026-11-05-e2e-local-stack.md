# E2E on a disposable Supabase stack — 2026-11-05

Slug: `e2e-local-stack`. Handover: `HANDOVER-e2e-local-stack-2026-11-05.md`. Doc snapshot: `1SWV80SgD354v9akqOudciCPwqi8aS0cuzWdiTjAaRVo`.
PR #526 → `dev` as `abd7a9f1`; not promoted (promotion happens separately). Migration: none.

A report-only `e2e-local` job runs the Playwright suite on a Supabase stack on the runner, with no lock and no Supabase secret. The `e2e` gate, its lock and the required check are unchanged. Removing the lock is not done.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| e2e-local-stack.1 | Flaky `training-builder` test on `e2e-local` | "the drop line moves nothing" gets `403 {"error":"Forbidden"}` creating its course as admin, then passes on retry. Seen on 2 of the last 3 `e2e-local` runs (`5ee4b565`, `73830a33`), never on `e2e-tests`. Cause unknown. The owner chose not to look at it yet | Find why an admin request gets a 403 only on this job. Until then, a run showing it doesn't count as agreeing | ☐ |
| e2e-local-stack.2 | About 10 PR runs where both jobs agree | One so far with both jobs aligned: `73830a33`, 247 tests each, `e2e-tests` 204 passed and 43 skipped, `e2e-local` 203 passed, 1 flaky and 43 skipped. `e2e-local` skips repeat trees on `dev` pushes, so only PRs add runs | Read both jobs on PRs as they run. Record the evidence in `docs/RUNBOOK-ci-database.md` | ☐ |
| e2e-local-stack.3 | Skip lists compared | Counts match at 43. `e2e-local` lists its skips: 42 mobile axe tests and the apex redirect. `e2e-tests` doesn't list them, so the lists have never been compared | Run `scripts/e2e-report-summary.mjs` in `e2e-tests` as well | ☐ |
| e2e-local-stack.4 | Two `e2e-local` runs overlapping | Not done, so Clerk's rate limits are still unknown. On `73830a33` it overlapped `e2e-tests` for about 3.5 min with no failure, which is related evidence and not this test | Force two overlapping runs and read both | ☐ |
| e2e-local-stack.5 | Start-up times in the runbook | Measured on `71bca6e8` and `73830a33`: stack 75 s both, database 6–7 s, schema wait 2 s, seed 4–5 s, so about 1.5 min. Recorded here and in the PR body, not in the runbook section that asks for them | Copy to `docs/RUNBOOK-ci-database.md` with the next change there | ☐ |
| e2e-local-stack.6 | Owner review of #526 | Merged on the owner's instruction to ship. It touches CODEOWNERS files (`.github/workflows/ci.yml`, `test/baselines/**`) and GitHub records no review | Owner reads those two diffs before promoting | ☐ |
| e2e-local-stack.7 | Removing the `e2e-dev-supabase` lock | Not done, and not part of #526. Depends on .1 to .5 | Owner decides once those are closed. Steps are in the runbook, "Removing the lock" | ☐ |
| e2e-local-stack.8 | Session worktrees | `.claude/worktrees/e2e-local-stack` and `.claude/worktrees/close-out-e2e-local-stack` remain, because the session can't reach the main checkout. The remote feature branch is gone | Archive the session in the app, then confirm with `npm run worktrees` | ☐ |
| e2e-local-stack.9 | Everything on `dev` | `abd7a9f1` is on `origin/dev`, and the e2e files match the head CI tested (`73830a33`). Its push run 42091421403 passed, with the suite skipped as a repeat tree. Worktree clean | None | ☑ |

## Closes

- `e2e-apt-cache.4` (another PR restores from `dev`'s cache, and a WebKit hit): run 42047378554 on #526, `e2e-local`, logged `Cache hit for: playwright-apt-Linux-ubuntu24-1.64.1-chromium-webkit-2026-W45` and `Need to get 0 B/114 MB of archives`. It also logged `Fetched 10.5 MB`, which is apt's package index and not archives.
