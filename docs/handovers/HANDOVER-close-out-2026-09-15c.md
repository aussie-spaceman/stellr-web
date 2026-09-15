# Handover — session 4, 15 Sept 2026: closing the open items

Picks up `HANDOVER-open-items-2026-09-15.md` (in this directory) and works it
in order. Everything below was verified against the repo, GitHub, the dev
Supabase project, or the Vercel API on 15 Sept 2026. Where a step was not
done, it says so in those words.

**Repo state at close:** `dev` = `a10523c` + this docs PR; `main` = `b18af0c`
(unchanged — nothing was promoted this session). One worktree. Rollback
target for `main` is unchanged from the 15 Sept record: `8e22017`.

## Standing rules (unchanged, still true)

1. A green badge is not evidence — read the `e2e` job's step outcomes.
   Expected: **45 passed, 1 skipped**.
2. Never rebase a squash-merged branch — cherry-pick onto fresh `dev`.
3. Vercel CLI token is expired; the **Vercel MCP** reads projects and
   deployments fine (`get_project` on `prj_Nd2kmpMj3bBuXbSjc6teUdwh9gPO`,
   team `stellreducation`) but has no "update project" call. Branch/cron
   settings are dashboard-only until someone runs `npx vercel login`.
4. Do not print secrets. Check key *types* with prefix tests.
5. `dev` branch protection now has `enforce_admins: true` (set 15 Sept, this
   session). `strict` is still `false` on `dev` (`true` on `main`) — so `dev`
   PRs are not required to be up to date with `dev` before merging. Not
   changed; decision not asked.
6. `npm run dev` in ANY worktree now refuses to start on production
   credentials (`scripts/production-guard.mjs`). `ALLOW_PROD_LOCALLY=1`
   overrides, deliberately, as a shell variable.

## What landed

| # | Item | Outcome | Where |
|---|---|---|---|
| 1 | `.env.local` on production | **Partial.** `NEXT_PUBLIC_SUPABASE_URL` → dev ref, `SITE_URL`/`AUTH_APP_URL` → `http://localhost:3000`, `NEXT_PUBLIC_APP_ENV=dev` added — done by the session. The four secret values (`SUPABASE_ANON_KEY`, `SERVICE_ROLE_KEY`, Clerk `pk_test_`/`sk_test_`) are the maintainer's to paste; see §Open. Until then the file is *inert* (dev URL + production keys cannot authenticate) and `npm run dev` refuses on the `pk_live_` key. | local only |
| 2 | `.env.local.example` steered to production | **Done.** Dev ref, localhost origins (both), `PORT=`, `PROD_DATABASE_URL=` with the pooler-host note. | #78 → `9ad818b` |
| 3 | `dev.mjs` refuses production | **Done.** Guard in `main()` before port work; pure check in `scripts/production-guard.mjs`; 10 unit tests; exercised by hand against two scratch files (exit 1, message names the variable). | #78 → `9ad818b` |
| 4 | #73 email copy unobserved | **Half done.** The mapping is proved against the real tier names: all 12 `membership_tiers.name` rows in dev (`xvxlhbxtiwxpopoqjygm`) run through `confirmationCopyFor()` — 10 resolve to their family copy, `Parent/Guardian` and `Subscriber` to `NEUTRAL_COPY` (correct: no family). **Not done:** reading a delivered email. No registration has been made on the dev deployment (the safelist mailbox holds no `[dev → …]` subjects in 14 days). | this doc |
| 5 | Flaky sign-out test | **Fixed as prescribed** (`waitForURL`, 15 s). **Not done:** the local `--repeat-each=10` run — needs the dev secrets from item 1. CI ran it once per PR. | #79 → `a10523c` |
| 6 | `.claude/releases/` untracked | **Decided: commit.** Both records tracked; promote skill Step 1 no longer says "(gitignored)". | #79 → `a10523c` |
| 7 | `close-out` skill | **Done** (approved). Step 5 now requires the handover PR to be merged before step 6. File is outside the repo: `~/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/0feaaf3f-…/32f688f5-…/skills/close-out/SKILL.md`. | outside repo |
| 8 | Dev Vercel tracks `main` | **Decided: do the proper switch.** Re-verified `b18af0c` → "Canceled by Ignored Build Step" (4 of 4). Steps 1–2 (populate Production scope, `NEXT_PUBLIC_APP_ENV=dev`) are the maintainer's; steps 3–4 need dashboard or a logged-in CLI. See §Open. | — |
| 9 | `dev` `enforce_admins` | **Done** — `true`. | GitHub |
| B2 | `a0e9c67` production deploy | **Confirmed** — `Vercel – stellr-web` "Deployment has completed" 15:22Z; superseded by `b18af0c` 15:45Z; www 200. | GitHub statuses |

## Open — in order

1. **Finish item 1 (maintainer).** `open -e .env.local`; replace the four
   secret values with the dev ones; add `E2E_MEMBER_PASSWORD`,
   `E2E_TEACHER_PASSWORD`, `E2E_ADMIN_PASSWORD` (the GitHub Actions values).
   Verify:
   ```bash
   grep -oE '^NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_(test|live)|^NEXT_PUBLIC_SUPABASE_URL=https://[a-z]+' .env.local
   ```
   must print `pk_test` and `xvxlhbxtiwxpopoqjygm`. Then `npx playwright test`
   must pass (45 passed, 1 skipped) — `global-setup` asserts the host, so a
   pass is meaningful.
2. **Item 5's 10× run**, once 1 is done:
   ```bash
   npx playwright test e2e/core/member-account.spec.ts --repeat-each=10 -g "signing out"
   ```
3. **Item 4's real email.** Register once on a High School tier and once on a
   College tier on `https://stellr-web-dev-git-dev-stellreducation.vercel.app`
   (needs the Vercel bypass cookie — the E2E fixtures show how). Read both in
   `hello@stellreducation.org`, subject prefixed `[dev → <intended>]`. Each
   must carry its family copy. The mapping is proved; this checks the
   delivery path end to end.
4. **Item 8 — the switch**, in this order, or dev breaks:
   1. Vercel → `stellr-web-dev` → Settings → Environment Variables: every
      Preview-scope variable also set in **Production** scope.
   2. `NEXT_PUBLIC_APP_ENV=dev` in Production scope.
   3. Settings → Git → Production Branch → `dev`.
   4. Settings → Cron Jobs → enable (disabled 10 Sept). `guardCron` declines
      because `APP_ENV=dev`; this exercises the guard, not the crons.
   5. Keep the Ignored Build Step (`main` → exit 0); it is still right.
   6. Then update `docs/ENV-MATRIX.md` §The environments — "Tracked branch:
      dev" becomes true rather than aspirational; add a line that the dev
      project's Production scope mirrors Preview.
   Verify with the Vercel MCP `get_project`: `latestDeployment.target` on a
   `dev` push should read `production`.
5. **Tracker Complete column** (session-3 doc) — see §Tracker.
6. Carried, unchanged: rego→DocuSign E2E covers the admin view only; a
   registration-form spec asserting the `docusign_envelopes` insert needs a
   real Sanity event slug in the seed.

## Tracker

Session-3 tracker (Google Doc `1bIyYNP7…`): the Drive connector cannot edit
document content (title/move only), so the Complete column was not ticked by
the session. Tick: A5 (close-out rule) ☑ · B1 mapping proved, email unread ☐ ·
B2 ☑ · B3 fix landed, 10× not run ☐ · B4 ☑ · C1 partial ☐ · C2 decided,
pending maintainer ☐ · C4 ☑.

## Close-out

- PRs this session: #78 (items 1–3 + source handover), #79 (items 5–6), and
  this one. Each `e2e` read by step outcome: `✓ Run npx playwright test`,
  45 passed / 1 skipped, no retries — including #79's own sign-out test.
- Unit suite: 593 (was 583; +10 for the guard).
- **Not promoted.** `main..dev` carries #78, #79 and this PR. Blast radius of
  a promotion: no migrations, no crons, no `lib/email`; runtime code is
  `scripts/dev.mjs` (local only, not shipped by Next), one E2E spec, the
  example env file, docs and skill text. `promote` when convenient; nothing
  here is urgent for production.
- `.env.local` in the main checkout: URLs and `APP_ENV` on dev, secrets still
  production — `npm run dev` there refuses until the four values are replaced.
- Worktree `../stellr-web-guards` was removed by `gh pr merge --delete-branch`
  (it deletes the local branch, and the worktree went with it). Harmless here
  — nothing was left uncommitted — but do not rely on it: `git worktree
  remove` explicitly, as the `ship` skill says.
