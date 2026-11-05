# E2E CI speedups — 2026-11-05

Slug: `e2e-speedups`. Handover: `HANDOVER-e2e-speedups-2026-11-05.md`. Doc snapshot: `1dMUq6KJg_XdtPDzBgINkegjrU-raX-CwAdmEcdDgSWI`.
PR #525 → `dev` as `0106e78f`; not promoted (promotion happens separately). Migration: none.

CI is split so `e2e-tests` holds the `e2e-dev-supabase` lock only for the suite, and a `dev`/`main` push whose tree already passed skips the suite. Repeat-tree pushes are proven at 5.8 min against 14.4. Runs that need the suite are not shown to be faster.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| e2e-speedups.1 | Full-suite push-to-done time | One sample, the #525 run on `b4b9b6f6`: `verify` 5.7 + `e2e-tests` 8.7 = about 14.4 min, against an estimate of about 11. Playwright took 285 s (baseline 196 s) and `npm ci` 98 s (37 s in the first trial) | After a week of runs, compare `verify` and `e2e-tests` durations with the baseline. Read step timings, not just the job | ☐ |
| e2e-speedups.2 | Lock time held by e2e | Estimated about 55% less overall. Not measured. In the one sample, non-Playwright time in the lock was 3.9 min (baseline 4.9) and after-suite time about 6 s (baseline 98 s) | Measure over the same window as .1 | ☐ |
| e2e-speedups.3 | `e2e-nightly.yml` | On `dev` only: the contents API returns 404 for it on `main`, so it has never run. Until promotion, a skipped repeat tree has no scheduled drift check behind it | After promotion, read the first scheduled run | ☐ |
| e2e-speedups.4 | First promotion under the new layout | The skip is proven on one `dev` push (run 41972238689). No `main` push has run with the new jobs; the required check names `verify` and `e2e` are unchanged | During the promote, read the `main` push: the `e2e` gate result and the `changes` log | ☐ |
| e2e-speedups.5 | Apt mirror-stall retry | In the composite action, never triggered | Read the step log the next time a mirror is slow | ☐ |
| e2e-speedups.6 | Lighthouse aborts on a 404 at `/events/nevada-space-design-challenge` | A green `lighthouse` job says nothing. Another session was started on it and was still working at the time of writing | Close when that session's fix shows real scores | ☐ |
| e2e-speedups.7 | Queued `e2e-tests` cancelled by newer runs | GitHub's one-pending rule cancelled it four times on #525. Another session was started on it and was still working at the time of writing | Close when that session's fix lands, or re-run with `gh run rerun <id> --failed` until then | ☐ |
| e2e-speedups.8 | Batch 2: more Playwright workers | Left out. 3 workers took 223/224/240 s and 4 took 216/226 s, against 210–278 s (median about 240) at 2. Flaky or failed runs were 4 of 5 against 3 of 10. Five back-to-back runs on one database, so not conclusive | None. Retry only with new evidence | ☑ |
| e2e-speedups.9 | Batch 2: Turbopack cache | Left out. Build went from 85 s to 40 s, about 39 s net at best on a one-file change with a same-day cache. No suite run ever tested a cached build. Trial branch and cache deleted | None. Retry only with new evidence | ☑ |
