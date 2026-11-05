# Handover: Lighthouse URL list, 5 Nov 2026

Merged to `dev` as `6a655b3c` (#539). **Not promoted**: promotion happens separately. No migration. Tracker: `tracker/2026-11-05-lighthouse-url-list.md`.

## Context

CI's `lighthouse` job aborted on a 404 for `/events/nevada-space-design-challenge` and uploaded no report. The step is `continue-on-error`, so the job stayed green. The aim was a job that finishes and reports scores, without depending on one event. It was not to become a required gate, and it has not.

## Root cause

The event never changed: it was still published and readable. The job never had `NEXT_PUBLIC_SANITY_PROJECT_ID`, so `lib/sanity.ts` had no client, `getEventBySlug` returned null, and every event page 404ed. `/` and `/competitions` were also measured without CMS content. lhci stops the whole run at the first URL that fails.

I read this failure in one run from 5 Nov. The session brief says it dates from at least 4 Nov. I did not read older logs, so how far back it goes is unverified.

## What changed

- `.github/workflows/ci.yml`: a `Read the CMS` step sets the public project ID and dataset through `$GITHUB_ENV`, so the shared e2e env is unchanged. No token is used. A new `Lighthouse scores` step runs with `if: always()`.
- `lighthouserc.json`: lists only `/`, `/competitions` and `/lp/homeschool-students`.
- `scripts/lighthouse-urls.ts`: picks an event through `getAllEvents()` in `lib/events/repo`, preferring upcoming with registration open, then other upcoming, then most recent past. It checks every URL returns 200 and drops failures with a warning.
- `scripts/lighthouse-summary.ts`: prints scores to the log and run summary, and warns if there is no report. It never fails the job.
- `scripts/lighthouse-ci.test.ts`: covers the ranking and the summary, and pins that the step is report-only.

## Evidence

Step logs, both on the Minnesota event page and register page:

| Page | PR run 42043258512 (Perf / LCP / TBT) | `dev` run 42091473547 (Perf / LCP / TBT) |
| --- | --- | --- |
| `/` | 71 / 4651 ms / 376 ms | 73 / 3703 ms / 647 ms |
| `/competitions` | 92 / 3395 ms / 46 ms | 92 / 3315 ms / 43 ms |
| `/lp/homeschool-students` | 93 / 3035 ms / 83 ms | 93 / 3052 ms / 93 ms |
| `/events/minnesota-…` | 88 / 3945 ms / 36 ms | 88 / 3942 ms / 45 ms |
| `/register/minnesota-…/individual` | 72 / 4294 ms / 430 ms | 75 / 3802 ms / 482 ms |

Accessibility was 100 and CLS 0.000 on every page in both runs. The run on the merge commit itself was cancelled by a newer push, so the `dev` evidence is from the next commit, `bed84259`, which contains it.

## Not verified, or weaker than it looks

- **These are not production numbers.** The register page goes through a Clerk dev-instance redirect (about 1.7 s by Lighthouse's estimate), and `_vercel/*` scripts fail off Vercel, lowering Best practices. How far production differs has not been measured. `/`'s LCP moved by about 950 ms between the two runs, so one sample is noisy.
- **Public report contents.** I checked only the PR run's report, with a pattern search rather than a full review. It found no keys, passwords, user sessions or email addresses, but did find the handshake token in row `.2`. I did not open the `dev` run's report.
- **Warning paths.** The dropped-URL path has only run locally, with no server. The no-report warning has never run (row `.4`).
- **Event choice.** `getAllEvents()` returns no `status`, so a cancelled or postponed event can be chosen if its pages answer 200. This can't break the run, but it could measure a less typical page. The job also now depends on Sanity being reachable; if it isn't, the event pages are skipped with a warning.

## Gotcha for the next session

New scripts cannot hold raw `_type == "event"` GROQ. `test/events-facade-ratchet.test.ts` fails them, and a `unit` failure skips `lighthouse` altogether. My first push failed this way.

## Open items

`lighthouse-url-list.2` (owner decision), `.3`, `.4` and `.5`. See the tracker.
