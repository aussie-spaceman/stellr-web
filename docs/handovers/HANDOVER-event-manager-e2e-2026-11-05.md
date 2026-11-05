# Handover: event-manager e2e in CI, 5 Nov 2026

Tracker: `tracker/2026-11-05-event-manager-e2e.md`. PR #523 is on `dev` as `9fe3802a` and has not been promoted. The owner is promoting separately.

## Context

The test proving an event manager cannot read another event always skipped in CI (deep review TEST-8, `deep-review-v2.19`). `lib/event-access.ts` enforces that boundary in server code, so only a test proves it.

## What changed

- **`.github/workflows/ci.yml`:** the `e2e` job passes `E2E_EVENT_MANAGER_PASSWORD` and fails closed if it is missing.
- **`e2e/core/access-control.spec.ts`:** the skip reads only the password. It used to check for the session file too, but Playwright decides skips while collecting tests, before the `auth` project writes that file. So the test stayed skipped even with the secret set. A minimal clean-run reproduction confirmed this.
- **Same spec:** the assigned event must answer exactly 200. Before, any status other than 401 or 403 passed, including a 500.
- **`pd-credentials`, `mentor-credentials` and `credentials` specs:** these load a page before signed-in API calls, the pattern `access-control.spec.ts` already used. `credentials` moved off the `request` fixture, which a page load can't renew.

## Outside the repo

- The owner created the Clerk dev user and added the repository secret. No agent handled the password.
- Applied to the **dev** database by hand: the fixture's `members` row from `seed.sql`, its `clerk_user_id` link, and an `event_manager_assignments` row for `seed-regional-challenge`. Production was not touched. The Clerk ID is not committed.

## What CI proved

| Run | Commit | Tests | Passed | Skipped |
|---|---|---|---|---|
| `dev`, before | `d6f0ee69` | 232 | 187 | 45 |
| PR #523 | `00da5fec` | 232 | 189 | 43 |
| `dev`, after | `2443fb9b` | 232 | 189 | 43 |

The merge commit's own CI run was cancelled because a newer push replaced it, so `2443fb9b` is the first `dev` run that contains this work.

## Not verified

- **The test by name (`.2`).** The CI reporter prints dots, so the proof is the counts.
- **Why `pd-credentials` failed (`.3`).** The first run with the new sign-in failed it with a 401. The two POSTs passed, then a GET came back without `credentials`, and the retry was refused at once. That fits a short-lived saved session cookie expiring, with the extra sign-in moving these specs later. It was never measured.

## Things to watch

- **A new or reseeded dev database (`.4`).** The assignment row and Clerk link aren't in `seed.sql`. A per-run database has to supply them, or the test fails at the exact-200 check.
- **#527 landed after this PR (`.5`).** Fixture sign-in no longer uses passwords, so the secret is now only a gate. The risk note in PR #523's body, that a wrong password fails the suite, no longer applies.
- **Now possible:** other sessions' rows that waited on this fixture, such as `norm-chaffee-award.3` and `checkr-report-export.3`, can now use a real event-manager session. They are not closed here.

## Open items

`event-manager-e2e.1` to `.6`, in the tracker file.
