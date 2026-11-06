# Handover: e2e on a disposable Supabase stack, 2026-11-05

Tracker: `tracker/2026-11-05-e2e-local-stack.md`. PR #526, squash-merged to `dev` as `abd7a9f1`. Not promoted. No migration.

## Context

All e2e runs share one dev Supabase project, so they queue behind the repo-wide `e2e-dev-supabase` lock and collide over shared rows. On 4 Nov, 5 of 14 runs waited 7.6–22.6 minutes for the lock. This session asked whether the suite can run on a throwaway stack on the runner, and built that as a report-only job.

## What changed

- **`e2e-local` job in `.github/workflows/ci.yml`:** report-only (`continue-on-error`), not in the `e2e` gate's `needs`, no lock, no Supabase secret, no report artifact. It skips docs-only changes and repeat trees, as `e2e-tests` does, and uses the same browser install action.
- **Seed:** `scripts/e2e-stack-db.sh`, `scripts/seed-e2e-stack.ts` and `supabase/seed-e2e-stack.sql`. Blank agreement PDFs with the real field maps, survey definitions, Clerk links and the event-manager assignment. The seed refuses anything but loopback and an `sk_test_` Clerk key.
- **Guards:** `lib/testing/e2e-supabase-target.ts` replaces the hard-coded dev-project checks in the specs and fixtures, and compares the whole hostname. `global-setup` now checks the database as well as the app.
- **Silent skip fixed:** `check-in-desk` now fails on an unrecognised database instead of skipping.
- **Report:** CI writes a JSON Playwright report, and `scripts/e2e-report-summary.mjs` lists `e2e-local`'s skips in the job summary.

How the job is built, and the conditions for removing the lock, are in `docs/RUNBOOK-ci-database.md`, "The e2e-local job".

## What CI proved

| Commit | `e2e-tests` | `e2e-local` | Notes |
|---|---|---|---|
| `71bca6e8` | 187 passed, 45 skipped, 4.4 min | 184 passed, 1 failed, 2 did not run, 45 skipped, 3.2 min | The failure was a hard-coded guard in a spec from `dev` |
| `5ee4b565` | Evicted from the lock queue, no steps | 188 passed, 1 flaky, 43 skipped, 3.4 min | |
| `749c7ca0` | Evicted from the lock queue, no steps | 189 passed, 43 skipped, 2.7 min | |
| `73830a33` (merged) | 204 passed, 43 skipped, 5.1 min | 203 passed, 1 flaky, 43 skipped, 3.5 min | 247 tests each |

Start-up on the stack is about 1.5 minutes: stack 75 s, database 6–7 s, schema wait 2 s, seed 4–5 s.

## Things that took a run to learn

- `supabase start` stops the stack if PostgREST is told to serve a schema that doesn't exist yet. So `entitlements` is set on the `authenticator` role after the baseline loads, not in `config.toml`.
- `supabase status` reports the API keys only when Auth is running, so GoTrue stays in the stack although the app uses Clerk.
- A spec that lands on `dev` with its own hard-coded project check fails only on `e2e-local`. New specs should use `assertE2eSupabase()`.
- `e2e-local` must follow changes to `e2e-tests` by hand. #523, #525 and #527 each changed something it had to copy.

## Not verified

- Why `training-builder` gets a 403 on `e2e-local` (.1).
- That the two jobs skip the same tests: only the counts match (.3).
- Two `e2e-local` runs at once, so Clerk's rate limits are unknown (.4).
- `e2e-local` doesn't test the hosted dev project, the real agreement documents, Realtime or certificate artwork. The runbook lists these.
- `queue: max` from #541 landed about the same time as this PR, so whether it stops the evictions #526 hit is not shown by anything here.

## Good to know

- The `e2e-local` log is public and prints the Supabase CLI's local default keys, because they aren't GitHub secrets. They mean nothing outside the runner.
- The job shows a green check even when tests fail, because it is `continue-on-error`. Read its steps and summary.

## Open items

Rows `e2e-local-stack.1` to `.8` in the tracker. The first is the flaky test, and `.2` to `.5` are what stand between this job and removing the lock, which is the owner's decision (`.7`).
