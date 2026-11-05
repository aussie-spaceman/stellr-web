# e2e lock: queue instead of drop — 2026-11-05

Slug: `e2e-lock-queue`. Handover: `HANDOVER-e2e-lock-queue-2026-11-05.md`. Doc snapshot: `1rxDtYAWYt-pIuW_05shwvHPbzzRiSpQpO9lnd48MDu4`.
#541 → `dev` as `bed84259`; not promoted, promotion is separate. Migration: none.

`e2e-tests` now waits for the `e2e-dev-supabase` lock with `queue: max` instead of being dropped when a third job arrives. The gate is unchanged: anything but `success` on `e2e-tests` turns `e2e` red.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| e2e-lock-queue.1 | How often the lock dropped jobs | Read per attempt, 4 Nov to 5 Nov 12:50 UTC: 7 of 59 lock requests evicted, 8 more cancelled by a PR's own newer push, 0 evicted by a re-run. Full tables in the handover | None | ☑ |
| e2e-lock-queue.2 | `queue: max` on `dev` | `bed84259` is an ancestor of `origin/dev`, and the file there has the key. `dev` run 42091473547 passed: `npx playwright test` step success, `e2e` success | None | ☑ |
| e2e-lock-queue.3 | Fail-closed gate kept | Trial: a job cancelled while queued read `cancelled` with zero steps and its gate failed. Real run: #541's own eviction turned `e2e` red. Guard test pins the key and the gate's check | None | ☑ |
| e2e-lock-queue.4 | Promotion to `main` | Not on `main`. Owner is promoting separately. `main` pushes keep the old setting until then | Confirm `bed84259` is in `origin/main` after the next promotion | ☐ |
| e2e-lock-queue.5 | The queue under real load | Not proven. Two suite runs since the merge, neither evicted; whether either waited was not read | On the first busy day, read `e2e-tests` for zero-step cancels with the "higher priority waiting request" annotation. Count one only if every queued job started after 5 Nov 19:11 UTC | ☐ |
| e2e-lock-queue.6 | Mixed queue behaviour | One sample: #541's `queue: max` job was cancelled when the lock released to an older job on the old setting. The evictor is inferred from timing; the annotation does not name it | Close with .5; reopen if a job is evicted with every queued job on the key | ☐ |
| e2e-lock-queue.7 | Long waits and PR wait time | Longest trial wait about 5 min; docs state no limit. The replay predicts mean wait 2.4 → 7.1 min and longest 19.1 → 40.5 min, but it is a model | Compare with real waits during .5 | ☐ |
| e2e-lock-queue.8 | Newer PR push removes a queued job | Trial covered a manual cancel only. Same mechanism, not observed on the real lock | Read the first case during .5 | ☐ |
| e2e-lock-queue.9 | Owner review of CODEOWNERS files | #541 was squash-merged by this session on the owner's instruction. GitHub records no review. `dev` branch protection requires no reviews; repository rulesets were not checked | Owner decides whether `CLAUDE.md`'s review rule should be enforced on `dev`, after checking rulesets | ☐ |
| e2e-lock-queue.10 | Docs that still describe one pending job | `docs/CONCURRENT-SESSIONS.md:90` and `.claude/skills/ship/SKILL.md:130`. `.claude/skills/close-out/SKILL.md:21` is history and is correct as written | Update both once .5 holds | ☐ |
| e2e-lock-queue.11 | `osv-scanner` failing | Failed on #541 and on `dev` at `4c81a771`. Non-blocking: `continue-on-error` unless `OSV_ENFORCE` is set. Findings not read | Read the job's findings | ☐ |
| e2e-lock-queue.12 | Remove `queue: max` with the lock | #526 is on `dev` as a report-only `e2e-local` job. The lock and `e2e-tests` remain | When per-run databases replace the lock, remove the group and update the guard test | ☐ |
