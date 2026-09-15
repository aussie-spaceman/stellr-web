# Close-out tracker

The one rolling list of what each session left open, and whether it has since
been closed. **This file is canonical.** Each close-out appends its own
section and ticks any earlier row it closed — in the same docs PR as the
session handover, so a tick is reviewed and lands on `dev` like everything
else. A Google Doc snapshot may be created per session for reading away from
the repo; it is a copy, never the source (the Drive connector cannot edit an
existing document's body, which is why this file exists — 15 Sept 2026).

Columns: **State** is a fact about the repo or a service at the time of the
tick, not a promise. **Next** is the smallest step that closes the row.
**Done** is ☑ only when the State column says how it was verified.

## Session 4 — 15 Sept 2026 (open-items pass; PRs #78–#83, #85–#88; promoted #87)

| # | Item | State | Next | Done |
|---|---|---|---|---|
| 4.1 | `.env.local` secrets on production | **Closed 15 Sept 17:1xZ.** Maintainer replaced the four values and added the three `E2E_*_PASSWORD`s. Verified: `pk_test`, `sk_test`, dev ref, anon-key JWT payload `ref` = `xvxlhbxtiwxpopoqjygm`; `npx playwright test` locally against a server this run started → **45 passed, 1 skipped**. | — | ☑ |
| 4.2 | Sign-out test 10× locally | #79's `waitForURL` did **not** fix it (see #82 body: `/account` rendered signed in — `Clerk?.signOut()` was a no-op before Clerk loaded; a dev instance re-mints cookies from localStorage). #82: `clerk.signOut({ page })` + positive `/sign-in` assertion. CI green; **`--repeat-each=10` locally: 10/10 passed** (15 Sept). | — | ☑ |
| 4.3 | Read a delivered tier-family email | Dev had zero grant rules (#81 fixed and applied). Maintainer registered one new account on the dev deployment 15 Sept and confirmed the family copy arrived. Second profile type (College family, via **Mentor / Volunteer**) still to be checked. | Maintainer: the College sign-up per the -15c handover addendum, later 15 Sept. | ☑ HS / ☐ College |
| 4.4 | Dev Vercel project → track `dev` | **Closed 15 Sept.** Session extended all 20 variables to Preview+Production via `vercel api` (values untouched); maintainer set Production Branch `dev` (Settings → Environments → Production → Branch Tracking — it is no longer under Git) and enabled crons. API confirms `link.productionBranch: dev`, crons `disabledAt: null`. First Production build verified on this PR's merge (see 4.7). | — | ☑ |
| 4.5 | Promote #78–#86 | **Promoted 15 Sept 18:53Z** — #87 → `87f7ccb`, production `dpl_EucPmzWQLytAWDVFPZEgMgnZN5dN` READY, www 200 / app 307 / cron guard 401. #84 (Stripe promotion codes, another session) was open and is not included. | — | ☑ |
| 4.6 | Migration-inserted data missing from dev | Dev was built from `baseline.sql` + `seed.sql`; anything a migration *inserted* (not just grant rules — any `INSERT` in `supabase/migrations/`) is absent unless `seed.sql` carries it. Grant rules are now carried; nothing else has been audited. | `grep -ln "INSERT INTO\|insert into" supabase/migrations/*` and compare each table's row count dev vs production; add to `seed.sql` what dev needs. | ☐ |
| 4.7 | Verify the first Production build on the dev project | **Closed 15 Sept 18:0xZ.** `ece9909` (#83) → `dpl_E2CkumXGEyskyWweMNRgahx18k86`, `target: production`, `ref: dev`, READY; aliases `stellr-web-dev-stellreducation.vercel.app` + `…-git-dev-…`. Home page is the app (127 KB, "Stellr", no placeholder). `/account` and `/about` 307 to the **dev** Clerk instance (`brief-ox-79`) with `redirect_url` on the same host — no hop to `stellreducation.org`. `APP_ENV=dev` in Production scope is the same variable record Preview proved today (`[dev → …]` subject prefix); the first scheduled cron will log `skipped … APP_ENV=dev`. | Optional: read that cron log line once a schedule has fired. | ☑ |
| 4.8 | Production migration ledger names | `db:status --prod` reports `20260910140426/27` as pending; they were applied 10 Sept and are recorded under MCP timestamps `20260910230533/…0740`. Cosmetic, but every promotion now re-explains it. | Realign the two `supabase_migrations.schema_migrations` rows to the file versions (read the 10 Sept release record first). | ☐ |
| 4.9 | Two sessions in one checkout, again | At 17:59Z another session committed to local `dev` in the main checkout and switched it to `feat/checkout-promo-codes` (#84) while this session was running Playwright there. No loss — same commit as #84's branch — but the checkout was reset to `dev` by this session; that session must `git checkout feat/checkout-promo-codes` before continuing. | Enforce ship rule 1: a session that is not the main checkout's owner works in a worktree. | ☐ |
| 4.10 | `guardCron` exercised on the dev project | Crons enabled 15 Sept 17:55Z; all 13 are daily between 04:00 and 13:00 UTC, so none had fired by close (19:20Z). **Unverified.** | After 04:00Z 16 Sept: Vercel → stellr-web-dev → Logs, or the MCP `get_runtime_logs`, filter `/api/cron/hubspot-lifecycle` — expect `{"skipped":true,"reason":"APP_ENV=dev"}`. Any other body means Production scope's `APP_ENV` is wrong and a dev cron did real work. | ☐ |
| 4.11 | Session-3 Google Doc tracker Complete column | Never ticked — the Drive connector edits titles only. The ticks are in this file (rows 3.*) and in section D of the session-4 Doc. | Maintainer, if wanted: tick them by hand; otherwise treat this file as canonical and the Doc as historical. | ☐ |

## Session 3 — 15 Sept 2026 (deploy confirmation, worktree and branch audit; PRs #70–#77)

Source: Google Doc `1bIyYNP7WarCH70LOVwoobGW0V4xZsvfggSjs28QFjPM`. Ticks below applied by session 4.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| 3.A5 | Mirror the ship Phase 6 rule into `close-out` | Done 15 Sept (session 4): step 5 requires the handover PR merged before step 6; step 4c now points at this file. | — | ☑ |
| 3.B1 | Tier-family welcome copy unobserved | One real dev registration read 15 Sept; family copy confirmed. → 4.3 for the second family. | — | ☑ |
| 3.B2 | `a0e9c67` production deploy | `Vercel – stellr-web` "Deployment has completed" 15:22Z; superseded by `b18af0c` 15:45Z; www 200. | — | ☑ |
| 3.B3 | Flaky sign-out test | Root-caused and fixed (#82); 10/10 locally. | — | ☑ |
| 3.B4 | `.claude/releases/` not gitignored | Committed via #79; skill text corrected. | — | ☑ |
| 3.C1 | Main checkout runs local dev against production | Template + guard (#78); `.env.local` repointed and verified by a local 45/1 run (4.1). | — | ☑ |
| 3.C2 | Dev Vercel tracks `main` | Switched to `dev` 15 Sept → 4.4 | — | ☑ |
| 3.C3 | rego→DocuSign E2E covers the admin view only | Unchanged. | Registration-form spec asserting the `docusign_envelopes` insert; needs a real Sanity event slug in the seed. | ☐ |
| 3.C4 | `dev` protection `enforce_admins:false` | Set `true` 15 Sept (session 4). `strict` still `false` on `dev`; not asked. | — | ☑ |
