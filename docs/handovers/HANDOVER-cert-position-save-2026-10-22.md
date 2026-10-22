# Handover — certificate "Save position" fix (22 Oct 2026)

**Shipped:** #453 landed on `dev` as `4a938b27` and was promoted in #454 (merge `8a61c7fe`, 22 Oct 18:34 UTC). Production deployment: `dpl_DWzaggcKRpvpVuBZDkPDi2u6Wwky`, READY. Rollback target: `dpl_2HFcjKfUArpnvrqptAt7Zu8MgQsX`.
**Migration:** none.
**Release record:** `.claude/releases/promote-2026-10-22.md` (#456, `f612e1d8`).
**Tracker:** `tracker/2026-10-22-cert-position-save.md`.

## What was asked
From the maintainer, with a screenshot of the Colorado competition's Settings tab: "receiving a db error when trying to upload artwork for the new Norm Chaffee certificates. Investigate and fix." Later in the session: ship it, then promote.

## What was actually wrong
The upload was fine. Prod has the Colorado `norm_chaffee` template row, created 16:23:05 UTC. The error came from the next two clicks on **Save position** (16:23:13 and 16:23:19). Prod's runtime log for both:

```
code: '23502'
message: 'null value in column "artwork_path" of relation "event_certificate_templates" violates not-null constraint'
```

- **Why:** Save position sends only `name_y`, `name_max_width` and `name_size`. The route (`app/api/admin/events/[slug]/certificate-templates/route.ts`) wrote them with `upsert(..., { onConflict: 'event_slug,award_type' })`. Postgres builds and checks the row an upsert would *insert* before it resolves `ON CONFLICT`, so the missing `artwork_path` fails NOT NULL even when the row exists.
- **Scope:** every award, not only Norm Chaffee. Every template on prod had the default placement with `created_at = updated_at`, so no position save had ever persisted since #201 (25 Sept).
- **Ruled out:** the new award's schema. Prod's `event_certificate_templates_award_type_check` already includes `norm_chaffee` (read from `pg_constraint`).

## What changed (#453)
- When the template exists, the route now runs `update` with only the fields sent, filtered by `event_slug` + `award_type`. The first artwork upload still upserts, and it always carries `artwork_path`. This is the shape `badge-templates/route.ts` already used.
- New `route.test.ts`: its Supabase mock fails an upsert without `artwork_path` the way Postgres does. All 4 tests pass with the fix; the 2 that save onto an existing template fail on the old route.

## What was verified
- **Dev, through the real UI:** the worktree's dev server against the dev database, using the core Playwright admin session and a throwaway spec, since deleted. On the Colorado Participation certificate: Position the name, height slider +6 steps, Save position. Result: `PUT 200`, "Name position saved" shown, no "Database error", `name_y` stored as 0.575, `artwork_path` unchanged. The row was reset to the defaults afterwards. Dev has no Norm Chaffee template, so Participation stood in; the code path is the same for every award.
- **CI:** #453 (`84a6ed03`), with every step read: `changes`, `verify` and `e2e` succeeded. #454 (`4a938b27`): the `pull_request` run succeeded throughout. The `dev` push run's first `e2e` was cancelled in the queue (#455 queued a third run in `e2e-dev-supabase`). The re-run succeeded: Playwright 169 passed, 45 skipped; Storybook 39 passed.
- **Production after #454:**
  - `dpl_DWzaggcKRpvpVuBZDkPDi2u6Wwky` for `8a61c7fe` built READY.
  - `www`, `app` and the apex domain resolve to it (`vercel inspect`).
  - `www` 200, `app` 307 to `/sign-in`, cron guard 401. The certificate route returns 401 when signed out.
  - No error, fatal or warning logs on the deployment in the first minutes.
  - `/manifest.webmanifest` is "Stellr Education" on `www` and "My Stellr" (`start_url` `/home`) on `app`.
- **Not verified:** a signed-in Save position on production (row `.1`).

## Promotion #454 also carried
- #451: Vercel Active CPU cuts.
- #452: apollo-reconcile 40 s budget and resume.
- #449/#450: docs.

Their post-promotion checks live in the `vercel-active-cpu` tracker (close-out #455): `.2` the meter, `.3` Stripe price events, `.5` apollo-reconcile's first finished run, `.7`/`.8` prefetch and the Studio slug check. They are not repeated here.

## Open items (tracker `2026-10-22-cert-position-save.md`)
- `.1` Save position on production, signed in.
- `.2` The Norm Chaffee artwork's wording does not match the award's label. This is found at close-out, and is a decision for David.

## Gotchas learned
- **An upsert with a partial row is not an update.** Any NOT NULL column without a default must be in the payload, even when the row exists. For partial saves, load the row and `update` it.
- **Read Vercel runtime logs within the hour.** Hobby keeps 1 hour. The route returned only "Database error"; the Postgres message was only in the log. A 6 h query returns an API error, not "no logs".
- **A cancelled `e2e` on a promotion's push run** means a third run queued in `e2e-dev-supabase`. Re-run that job (`gh run rerun <run> --job <job>`). `main` requires `e2e`, and #454 read `BLOCKED` until the re-run passed.
- **Dev has no Norm Chaffee certificate template**, and still no event companies (see the 19 Oct handover). Test certificate saves against Colorado's existing templates.

## Session gaps (honest review)
- The Norm Chaffee wording mismatch (`.2`) was visible in the first screenshot. It was not raised until close-out, and the session's earlier reports said only that the certificates print on the new artwork.
- Ship Phase 0's sweep and stranded-PR check ran at the start of ship, after the fix worktree already existed. Nothing collided.
- #454's own `pull_request` run never released its logs: the workflow stayed "in progress" after all three jobs completed. Its Playwright totals were taken from the `dev` push run on the same SHA.
