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

## Session 7 — 16 Sept 2026 (codebase cleanup; T1 + T2)

Handover: `HANDOVER-cleanup-2026-09-16.md`.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| 7.1 | T3 dedupe refactors | **Not started.** Owner approved eight items (admin-auth helper, Stripe client, HubSpot fetch, date/money/slug helpers, `emailSchema`, two swallowed errors, scripts' Supabase client, internal-only exports). List and constraints in the handover. | One PR per item, admin-auth first; skip the 5 routes on the July "retire later" list. | ☐ |
| 7.2 | `next-env.d.ts` churn | Tracked file that `next dev` rewrites on every run; dirtied the tree during smoke. | Decide whether to gitignore it (Next 16 default). | ☐ |
| 7.3 | `docs/campaign-registrations.md` | Lists components (`CampaignRegistrationModal`, `CampaignsBoard`) and `/api/campaigns/register` that no longer exist; only the entry-point-A lines were fixed. | Rewrite the Routes/APIs tables against the tree. | ☐ |
| 7.4 | `/admin/campaigns/[slug]` unreachable from nav | Documented admin surface; no `AdminSidebar` link; reachable by typed URL only. | Add a link under Competitions, or remove the page. | ☐ |
| 7.5 | Externally referenced `public/` assets | Three logo SVGs, `Bill.jpeg`, two poster JPGs removed on zero in-repo references; HubSpot/Sanity references are invisible from here. | If anything 404s on a marketing surface, restore from `68ac4ef^`. | ☐ (accepted) |

Rows touched from earlier sessions: none closed. 6.7 (`check-golive-config.mjs`)
was a deletion candidate and was **kept** because this row is open.

## Session 6 — 15 Sept 2026 (Vercel Function Storage; PRs #92–#94; promoted #93)

Handover: `HANDOVER-vercel-function-storage-2026-09-15.md` (§6 is the close-out).
Session 5 (#90, Stripe promotion codes close-out) was still open at this close and is
not represented here.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| 6.1 | Function Storage after-figure | **Not measured.** Chrome extension not connected; the Vercel usage page needs a browser session. Before: 7.5 GB (75%). 13 deployments retained after the purge, ≤ 63 MB each — arithmetic says < 0.8 GB, but that is inference. | Maintainer: read https://vercel.com/stellreducation/~/usage (may lag deletions by a day) and write the number into the handover §3. | ☐ |
| 6.2 | Google client swap exercised in production | Pre-merge: JWT, Drive `files.list`, Calendar `calendarList.list` all 200 against the real service account through the new packages. **Sheets API calls (`spreadsheets.values.get/update`, `create`) not executed** — the bare service account owns no sheets; production impersonates the owner. Type-checked identical; not run. | The next group registration (`register/group` creates a sheet) or a `sheet-sync` from a team page — confirm the sheet appears and rows land. Also `cron/motion-bookings` runtime log after its 12:00 UTC run 16 Sept. | ☐ |
| 6.3 | Rollback targets in older release records | The purge kept the 10 newest `main` builds (oldest 10 Sept). Any deployment id in a release record older than that (e.g. the 10 Sept record's `8e22017` build if it predates the kept set) **no longer exists** — deleted with consent, but the records still name them. | When reading an older record, treat its rollback id as historical; roll back by redeploying the commit instead. | ☐ (accepted) |
| 6.4 | Required `Vercel – stellr-web` check on `main` | Passes for a skipped build (`Canceled by Ignored Build Step` → SUCCESS, observed #92/#93/#94). Promotions are not blocked, but the check no longer proves a production build *before* the merge; the post-merge `main` build is the gate. Documented in ENV-MATRIX, promote skill, memory. | Decide whether to keep it required (harmless, informational) or drop it from `main`'s ruleset so nobody reads it as a build proof. | ☐ |
| 6.5 | Sanity Studio in the function bundle | `/studio/[[...tool]]` traces 10 MB, the largest remaining route after `/api/img` (17.5 MB, sharp — needed). Deferred. | If Function Storage climbs again: host Studio via `sanity deploy` and drop the route. | ☐ |
| 6.6 | Dashboard Ignored Build Step on `stellr-web-dev` | Superseded by `vercel.json` `ignoreCommand` (proven: dev project skipped a feature push and built `dev`). Left in place; inert. | Optional: clear it in the dashboard so the only rule is the one in git. | ☐ |
| 6.7 | `scripts/check-golive-config.mjs` after the swap | Edited to the per-API packages; `node --check` only. Manual-run utility, not in any script or cron. | Run it once before the next go-live check. | ☐ |
| 6.8 | Build rule live on both projects | **Closed 15 Sept.** Feature push: Canceled on both projects. `dev` merge (#92, #94): one build each, `stellr-web-dev`, READY. `main` merge (#93): one build, `stellr-web`, READY, `dpl_Gw8vgHxmo3p71vtrpAy14sNtEwoy`. 6 deployments per PR → 2. | — | ☑ |
| 6.9 | Purge | **Closed 15 Sept.** 34 branches deleted (each proven landed by content). Deployments: prod 229 → 10, dev 127 → 3; live ids asserted safe before and after; www 200 throughout. | — | ☑ |
| 6.10 | Bundle size | **Closed 15 Sept.** Local nft-trace union 62.7 → 47.6 MB; routes > 4 MB 9 → 2. OG card 200 on production, 1200×630, byte-identical to local. | — | ☑ |

Earlier rows closed by this session: grades-7-12 handover open item 2 ("Stop `dev`/feature
pushes building on the production Vercel project") — closed by 6.8. TRACKER rows 4.9
(worktree discipline: this session used one; the rule is unchanged) and 4.10 (`guardCron`
on the dev project: 04:00Z has not passed) remain open.
## Session 5 — 15 Sept 2026 (Stripe promotion codes; PRs #84, #90, #91; promoted #91)

Handover: `HANDOVER-stripe-promo-codes-2026-09-15.md`. Google Doc snapshot (copy, not source): https://docs.google.com/document/d/1T2jbfiZIX0zfw4XTP9k54MiZaR0XZBuTk06yRwAxJXc/edit

| # | Item | State | Next | Done |
|---|---|---|---|---|
| 5.1 | "Add promotion code" seen on a live registration Checkout | **Unverified.** Code is on production (`68cb24c`, `dpl_7gmENarddEb6mezMmeKmrqf23XjS` READY 20:32Z). The link only appears on a Checkout Session created *after* the deploy; the session did not create one because that writes a production registration. The maintainer's earlier `cs_live_…` page predates the fix and will not show it. | Maintainer: start the Colorado registration, reach Checkout, confirm the link under the total; optionally enter a code and confirm the total drops. Cancel before paying. | ☐ |
| 5.2 | Stripe-side code configuration | Taken on trust. A promotion code restricted to products that exclude the event's price product is rejected at entry even though the field now shows. | Maintainer: Stripe → Product catalog → Coupons → each promotion code: Active, applies to the event product or all products, not expired, usage limits as intended. | ☐ |
| 5.3 | Community / store / membership checkouts do not accept codes | **By decision** (maintainer, in session): registration flows only. 5 community + 2 store sites need the same one-liner if wanted; membership passes `discounts` (refund credit), which Stripe will not combine with `allow_promotion_codes` — needs a design choice. | Decide. If yes for community/store, one PR, same pattern as #84. | ☐ |
| 5.4 | Only `lib/individual-payment.ts` has a unit test asserting the flag | The four API routes (`register/individual`, `register/group`, `teams/[id]/payment-link`, `billing/payment-link`) have no route-level tests, before or after. | Optional; low value for a one-line param. | ☐ |
| 5.5 | Ship rule 1 breached (second time this week) | This session branched and committed in the main checkout while session 4 was running Playwright there (4.9 is the same incident, from the other side). No loss. The rule exists; nothing enforces it. | Make `ship` Phase 0 non-skippable: the skill refuses to continue unless `git rev-parse --git-dir` shows a worktree (`…/.git/worktrees/<name>`), i.e. not the main checkout. | ☐ |
| 5.6 | Sessions cannot reach the dev deployment | Both `stellr-web-dev` URLs 302 to Vercel SSO; `.env.local` has no `VERCEL_AUTOMATION_BYPASS_SECRET`. Plan step "verify on dev" was skipped for this reason. | Maintainer: Vercel → stellr-web-dev → Settings → Deployment Protection → Protection Bypass for Automation → copy into `.env.local`. | ☐ |
| 5.7 | #90 (release record + this handover) | Open at the time of writing; CI running on the last push. | Maintainer merges once green. Docs only; rides the next promotion. | ☐ |

## Session 4 — 15 Sept 2026 (open-items pass; PRs #78–#83, #85–#88; promoted #87)

| # | Item | State | Next | Done |
|---|---|---|---|---|
| 4.1 | `.env.local` secrets on production | **Closed 15 Sept 17:1xZ.** Maintainer replaced the four values and added the three `E2E_*_PASSWORD`s. Verified: `pk_test`, `sk_test`, dev ref, anon-key JWT payload `ref` = `xvxlhbxtiwxpopoqjygm`; `npx playwright test` locally against a server this run started → **45 passed, 1 skipped**. | — | ☑ |
| 4.2 | Sign-out test 10× locally | #79's `waitForURL` did **not** fix it (see #82 body: `/account` rendered signed in — `Clerk?.signOut()` was a no-op before Clerk loaded; a dev instance re-mints cookies from localStorage). #82: `clerk.signOut({ page })` + positive `/sign-in` assertion. CI green; **`--repeat-each=10` locally: 10/10 passed** (15 Sept). | — | ☑ |
| 4.3 | Read a delivered tier-family email | Dev had zero grant rules (#81 fixed and applied). Maintainer registered one new account on the dev deployment 15 Sept and confirmed the family copy arrived. Second profile type (College family, via **Mentor / Volunteer**) still to be checked. | Maintainer: the College sign-up per the -15c handover addendum, later 15 Sept. | ☑ HS / ☐ College |
| 4.4 | Dev Vercel project → track `dev` | **Closed 15 Sept.** Session extended all 20 variables to Preview+Production via `vercel api` (values untouched); maintainer set Production Branch `dev` (Settings → Environments → Production → Branch Tracking — it is no longer under Git) and enabled crons. API confirms `link.productionBranch: dev`, crons `disabledAt: null`. First Production build verified on this PR's merge (see 4.7). | — | ☑ |
| 4.5 | Promote #78–#86 | **Promoted 15 Sept 18:53Z** — #87 → `87f7ccb`, production `dpl_EucPmzWQLytAWDVFPZEgMgnZN5dN` READY, www 200 / app 307 / cron guard 401. #84 (Stripe promotion codes, another session) was open and is not included — promoted separately as #91 → `68cb24c` 20:29Z (session 5). | — | ☑ |
| 4.6 | Migration-inserted data missing from dev | Dev was built from `baseline.sql` + `seed.sql`; anything a migration *inserted* (not just grant rules — any `INSERT` in `supabase/migrations/`) is absent unless `seed.sql` carries it. Grant rules are now carried; nothing else has been audited. | `grep -ln "INSERT INTO\|insert into" supabase/migrations/*` and compare each table's row count dev vs production; add to `seed.sql` what dev needs. | ☐ |
| 4.7 | Verify the first Production build on the dev project | **Closed 15 Sept 18:0xZ.** `ece9909` (#83) → `dpl_E2CkumXGEyskyWweMNRgahx18k86`, `target: production`, `ref: dev`, READY; aliases `stellr-web-dev-stellreducation.vercel.app` + `…-git-dev-…`. Home page is the app (127 KB, "Stellr", no placeholder). `/account` and `/about` 307 to the **dev** Clerk instance (`brief-ox-79`) with `redirect_url` on the same host — no hop to `stellreducation.org`. `APP_ENV=dev` in Production scope is the same variable record Preview proved today (`[dev → …]` subject prefix); the first scheduled cron will log `skipped … APP_ENV=dev`. | Optional: read that cron log line once a schedule has fired. | ☑ |
| 4.8 | Production migration ledger names | `db:status --prod` reports `20260910140426/27` as pending; they were applied 10 Sept and are recorded under MCP timestamps `20260910230533/…0740`. Cosmetic, but every promotion now re-explains it. | Realign the two `supabase_migrations.schema_migrations` rows to the file versions (read the 10 Sept release record first). | ☐ |
| 4.9 | Two sessions in one checkout, again | At 17:59Z another session committed to local `dev` in the main checkout and switched it to `feat/checkout-promo-codes` (#84) while this session was running Playwright there. No loss — same commit as #84's branch — but the checkout was reset to `dev` by this session; that session must `git checkout feat/checkout-promo-codes` before continuing. | Enforce ship rule 1: a session that is not the main checkout's owner works in a worktree. Session 5 confirms it was the offender → 5.5. | ☐ |
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
