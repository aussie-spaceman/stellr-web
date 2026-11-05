# Handover: E2E CI speedups, 5 Nov 2026

Tracker: `tracker/2026-11-05-e2e-speedups.md`. Status: #525 is on `dev` as `0106e78f`, not on `main`. Promotion happens separately.

## Context

Deployments were slow because every push took 14.4 min from push to done, and all of it held the single `e2e-dev-supabase` lock. A third of successful e2e runs repeated a tree that had already passed. The brief was to speed this up without weakening security, stability or deployment quality.

## What changed (#525)

- `verify` and `e2e` are now gate jobs with the same required names, and they fail closed.
  - `verify` gates `verify-build` and `unit`.
  - `e2e` gates `e2e-tests` and `storybook`.
- Only `e2e-tests` holds the lock. `lighthouse` is off the lock and report-only.
- A `dev`/`main` push skips the suite when an `e2e-passed-tree-<tree>` marker artifact shows that exact tree passed. PRs always run the suite.
- `e2e-nightly.yml` is new, to catch database drift the skip would otherwise hide.
- Secrets are per step through the `&e2e-secrets` anchor, so they no longer reach `npm ci` or the `npx` tools. A new step that needs a secret must be given it.
- Playwright browsers and apt packages are cached through `.github/actions/playwright-browsers`, with a retry for mirror stalls.
- Unit tests run as Vitest `node` and `dom` projects. Coverage was identical across 708 files.
- No test was weakened or removed. `playwright.config.ts` is unchanged and stays at 2 workers in CI.

## Results against the estimates

| | Before | Estimate | Measured (one run each) |
|---|---|---|---|
| Push that repeats a tested tree | 14.4 min | Skipped | 5.8 min (run 41972238689) |
| Run that needs the suite | 14.4 min | About 11 min | About 14.4 min |
| Non-Playwright time in `e2e-tests` | 4.9 min | About 2.5 min less | 3.9 min, 1 min less |
| Lock time overall | n/a | About 55% less | Not measured |

The full-suite figure is one run, on a day when 189 tests passed against 180 in the 4 Nov trial and `npm ci` was slow. It neither confirms nor rules out the 11-minute estimate.

## Not verified

- A full run being faster than before (`.1`), and the lock reduction (`.2`).
- `e2e-nightly.yml`, which only starts once it is on `main` (`.3`). Until then a skipped repeat tree has no scheduled drift check behind it.
- Any `main` push under the new jobs (`.4`).
- The apt retry, which needs a slow mirror (`.5`).

## Open items

Rows `.1` to `.7` in the tracker. `.6` (Lighthouse 404) and `.7` (queue cancellations) each have their own session, still running when this was written.

## For the next session

- Read the suite's result on `e2e-tests`, step `npx playwright test`. The `e2e` job is only a gate.
- A skipped `e2e-tests` on a push is legitimate only if the `changes` log says the tree already passed and names a run.
- A trial branch that fakes or skips Playwright still writes a marker. Delete that marker.
- Run 42030301231 on `0106e78f` was a `workflow_dispatch` this session did not start, in progress at the time of writing. It may give a second sample for `.1`.
