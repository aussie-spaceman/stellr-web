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

## Session 4 — 15 Sept 2026 (open-items pass; PRs #78–#81)

| # | Item | State | Next | Done |
|---|---|---|---|---|
| 4.1 | `.env.local` secrets on production | URLs and `APP_ENV` on dev; the four secret values and three `E2E_*_PASSWORD` still production/absent. `npm run dev` refuses in the main checkout until fixed. | Maintainer: replace the values; verify `grep -oE '^NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_(test\|live)' .env.local` prints `pk_test`; `npx playwright test` → 45 passed / 1 skipped. | ☐ |
| 4.2 | Sign-out test 10× locally | Fix landed (#79); CI ran it once, green, no retry. | After 4.1: `npx playwright test e2e/core/member-account.spec.ts --repeat-each=10 -g "signing out"`. | ☐ |
| 4.3 | Read a delivered tier-family email | Mapping proved against all 12 dev tier names. Dev had **zero** grant rules (built from `baseline.sql`, schema only), so every dev sign-up would have got the neutral copy — fixed in #81 (`seed.sql`), applied to dev 15 Sept, verified 8 signup rules. No email read yet. | Two sign-ups on the dev deployment per `HANDOVER-close-out-2026-09-15c.md` §Addendum; read both in `hello@stellreducation.org`. | ☐ |
| 4.4 | Dev Vercel project → track `dev` | Decided 15 Sept: do the switch. Vercel MCP reads but cannot change settings; CLI token expired. `ENV-MATRIX.md` says "`main`, for now". | Maintainer, in order: Production scope populated → `NEXT_PUBLIC_APP_ENV=dev` there → Production Branch `dev` → crons on → flip ENV-MATRIX cell in the same PR. | ☐ |
| 4.5 | Promote #78–#81 | On `dev`, not `main`. No migrations, crons or `lib/email` in the delta. | `promote` after 4.1–4.4 (maintainer's call, 15 Sept). | ☐ |
| 4.6 | Migration-inserted data missing from dev | Dev was built from `baseline.sql` + `seed.sql`; anything a migration *inserted* (not just grant rules — any `INSERT` in `supabase/migrations/`) is absent unless `seed.sql` carries it. Grant rules are now carried; nothing else has been audited. | `grep -ln "INSERT INTO\|insert into" supabase/migrations/*` and compare each table's row count dev vs production; add to `seed.sql` what dev needs. | ☐ |

## Session 3 — 15 Sept 2026 (deploy confirmation, worktree and branch audit; PRs #70–#77)

Source: Google Doc `1bIyYNP7WarCH70LOVwoobGW0V4xZsvfggSjs28QFjPM`. Ticks below applied by session 4.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| 3.A5 | Mirror the ship Phase 6 rule into `close-out` | Done 15 Sept (session 4): step 5 requires the handover PR merged before step 6; step 4c now points at this file. | — | ☑ |
| 3.B1 | Tier-family welcome copy unobserved | Mapping proved; delivery unobserved. → 4.3 | — | ☐ |
| 3.B2 | `a0e9c67` production deploy | `Vercel – stellr-web` "Deployment has completed" 15:22Z; superseded by `b18af0c` 15:45Z; www 200. | — | ☑ |
| 3.B3 | Flaky sign-out test | Fixed as prescribed (#79). 10× run → 4.2 | — | ☑ fix / ☐ 10× |
| 3.B4 | `.claude/releases/` not gitignored | Committed via #79; skill text corrected. | — | ☑ |
| 3.C1 | Main checkout runs local dev against production | Template and guard landed (#78); `.env.local` secrets → 4.1 | — | ☑ control / ☐ secrets |
| 3.C2 | Dev Vercel tracks `main` | → 4.4 | — | ☐ |
| 3.C3 | rego→DocuSign E2E covers the admin view only | Unchanged. | Registration-form spec asserting the `docusign_envelopes` insert; needs a real Sanity event slug in the seed. | ☐ |
| 3.C4 | `dev` protection `enforce_admins:false` | Set `true` 15 Sept (session 4). `strict` still `false` on `dev`; not asked. | — | ☑ |
