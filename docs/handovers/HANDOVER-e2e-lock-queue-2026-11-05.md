# Handover: e2e lock queue — 2026-11-05

Tracker: `tracker/2026-11-05-e2e-lock-queue.md`. PR: #541, on `dev` as `bed84259`, not on `main`. Promotion is separate.

## Context

All e2e runs share the dev Supabase project, so `e2e-tests` holds a repo-wide concurrency group, `e2e-dev-supabase`. By default GitHub keeps one pending job per group, so a third arrival cancels the waiting job with zero steps. The `e2e` gate then stays red until someone re-runs it or pushes.

## What changed

- `.github/workflows/ci.yml`: `queue: max` on the group, plus comments.
- `test/ci-e2e-fail-closed.test.ts`: pins the key and the gate's "only success passes" check.
- The gate job did not change.

`queue: max` has been available since May 2026: up to 100 pending jobs, roughly FIFO, not allowed with `cancel-in-progress: true`. GitHub's docs only show it at workflow level, so it was trialled at job level first.

## Numbers

From 81 CI runs and 89 attempts, 4 Nov to 5 Nov about 12:50 UTC. Read per attempt, because a re-run overwrites the cancelled result.

| | |
|---|---|
| Lock jobs cancelled with zero steps | 15 |
| Evicted, with the annotation | 7 of 59 lock requests (11.9%) |
| The PR's own newer push, no annotation | 8; don't re-run these |
| Time to a re-run or new push after eviction | 14 to 274 min, mean 90 |
| Evictions caused by re-runs | 0 of 7; all were first attempts: 5 PR runs, 2 `dev` pushes |
| `dev` pushes cancelled with 0 jobs | 4, by the workflow-level group. Each is contained in a later push |

Two more jobs read `cancelled` with steps run. That is the 20-minute timeout, not this problem. `timeout-minutes` does not count time waiting for the lock.

## Trial

Five runs on throwaway tags from an orphan commit, with no secrets. The tags are deleted; the runs stay in Actions history as `queue-trial`.

- `queue: max`: a, b, c, d ran in push order with no overlap.
- Default (control): b, c, e were evicted.
- e cancelled by hand while queued: zero steps, gate failed, d still ran.

## Options rejected

- **External lock:** holds a runner while polling and adds stale-lock risk, for what GitHub now does itself.
- **Automatic re-run:** needs a write token, has to tell evictions from newer pushes, and a re-run can be evicted again.
- **Per-run database (#526):** still the long-term fix, not ready to replace the lock. It is on `dev` as the report-only `e2e-local` job.

## What was missed, and what is not verified

- **The trial never mixed settings.** #541's own first run was then evicted: its `queue: max` job was cancelled at the moment the lock released to `s5/lane-a`, an older job on the old setting. The evictor is inferred from timing. So expect some evictions until runs from before the merge have drained and `main` is promoted.
- **Real load is unproven.** Since the merge, two suite runs passed with no eviction, but their waits were not read. Rows `.5` to `.8`.
- **The wait figures are a model.** A FIFO replay of 54 arrivals, not a measurement.
- **Review.** GitHub records no review of #541, which touches a CODEOWNERS file. This session merged it on the owner's instruction. `dev` branch protection requires no reviews, and rulesets were not checked. Row `.9`.
- **Two merge reports did not match GitHub.** The PR stayed open after two "merged" replies, with no merge events. The cause was not found. The merge then went through first time from this session.
- **`osv-scanner` findings were not read.** It fails on `dev` too and does not block. Row `.11`.

## Reading a zero-step cancel

Read the job's annotation. "higher priority waiting request for e2e-dev-supabase" means evicted, so run `gh run rerun <id> --failed`. No annotation means the PR's own newer push, so don't re-run. Cancelled with steps means the 20-minute timeout.

## Open items

Rows `e2e-lock-queue.4` to `.12`. The one that matters most is `.5`, on the first busy day after the merge, counting only jobs started after 5 Nov 19:11 UTC.
