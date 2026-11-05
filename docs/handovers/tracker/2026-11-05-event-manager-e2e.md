# Event-manager e2e in CI — 2026-11-05

Slug: `event-manager-e2e`. Handover: `HANDOVER-event-manager-e2e-2026-11-05.md`. Doc snapshot: `15TfpUuwCFC4YAmi_5aW4dBWYSpORgWMcPABvj3QQbS8`.
PR #523 → `dev` as `9fe3802a`; not promoted (a separate session will promote). Migration: none.

The test proving an event manager cannot read another event now runs in CI. A `dev` run containing the work (`2443fb9b`, run `41968184945`) shows 232 tests, 189 passed, 43 skipped, against 187 passed and 45 skipped before.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| event-manager-e2e.1 | Promote #523 | On `dev` only. CI and test files only, no app code. | The owner's separate promotion carries it. | ☐ |
| event-manager-e2e.2 | Test named as passed | Proven by counts only: the CI reporter prints dots. Two tests moved from skipped to passed, matching the sign-in and the boundary test. | Read the test's result in a run's `playwright-report` if name-level proof is wanted. | ☐ |
| event-manager-e2e.3 | Session-expiry cause | Inferred from the failure pattern, never measured. The failure did not recur in the PR run or the `2443fb9b` run. | If a saved-session API call returns 401 again, compare the session cookie's expiry with the test's start time. | ☐ |
| event-manager-e2e.4 | Dev fixture rows are hand-applied | The `event_manager_assignments` row and the `members.clerk_user_id` link were applied to the dev database by hand. `seed.sql` can't hold the instance-specific Clerk ID. A new or reseeded database loses them and the test fails at the exact-200 check. | Any move to a per-run database must supply both. | ☐ |
| event-manager-e2e.5 | The secret is now only a gate | #527 made fixture sign-in passwordless. `E2E_EVENT_MANAGER_PASSWORD` now only decides the skip and "Check configuration", so a wrong value no longer fails sign-in. The same applies to the other three fixture passwords. Read from `e2e/fixtures/sign-in.ts` and `e2e/auth.setup.ts` on `dev`. | Owner decides whether to rename the variables or leave them. | ☐ |
| event-manager-e2e.6 | OSV advisories | `osv-scanner` fails on `dev`: `deepmerge`, `glob`, `minimatch`. Report-only. A card was proposed and not started. | Start the card, or decide to accept them. | ☐ |

## Closes

- `deep-review-v2.19`: the fixture is provisioned and the spec is enabled. The `dev` run at `2443fb9b` shows skips down from 45 to 43, with no failures.
