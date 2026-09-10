# HANDOVER — deploy environments, E2E, and the deploy skills

**Session:** 7–10 Sept 2026 · **Status: phases 1–6 shipped and on `main`; six
items genuinely incomplete, listed in §3**

Started as "write me a skill for deploying code". Reviewing the repo showed the
skill was the smaller half of the problem: everything was tested and deployed on
production, with no dev environment and nothing preventing two sessions
colliding. That became `docs/REC-deploy-environments-2026-09-07.md`, and this
records what shipped, what did not, and what to check first.

---

## 1. What shipped

15 PRs, 10 promotions through `session → dev → main`.

| Phase | Delivered |
|---|---|
| 1 | `lib/env.ts`, `guardCron()` on all 12 cron routes, GitHub Actions CI, branch protection with `enforce_admins` |
| 2 | `dev` branch, dev Supabase (`xvxlhbxtiwxpopoqjygm`), dev Vercel project, `supabase/baseline.sql`, fixtures, email safelist |
| 3 | Per-worktree ports, timestamped migrations + `lint:migrations`, `db:status` |
| 4 | Playwright: 21 smoke + 3 auth + 13 core, green in CI |
| 6 | `.claude/skills/ship` and `.claude/skills/promote` |

Phase 5 in the REC was folded into Phase 4.

### Defects found and fixed

- **`proxy.ts` redirect loop.** The www/app split assumed two hostnames. A
  single-host dev or preview deployment matched `APP_HOST` on every request, so
  `/about` redirected to itself and every public page was unreachable.
  `IS_SINGLE_HOST` fixes it; production has two hosts so it is inert there.
- **`fetchpriority` → `fetchPriority`** in `ResponsivePhoto`. React rejected the
  raw HTML attribute, so the `high` hint on above-the-fold images had never been
  applied. The `@ts-expect-error` above it was stale.

### Discovered about the database

- **The production schema existed in exactly one place.** `public.members` had no
  DDL anywhere in the repo; seven migrations carry "run in the SQL editor".
- **An entire `entitlements` schema** (11 tables, 27 functions) was missing from
  the first baseline — `--schema=public` omitted it.
- **The migration ledger disagreed with reality** on 11 versions; `142` and `143`
  had no record in any format despite being applied.

---

## 2. Traps worth knowing

Each of these cost real time and will again.

| Trap | What happens |
|---|---|
| **Loading `baseline.sql` without `--set ON_ERROR_STOP=1`** | psql continues past errors; the DB matched on table count while `participants`/`registrations` were 31 columns short |
| **Comparing table counts, not column counts** | A table count matches long before a schema does |
| **Clerk keyless mode** | With no publishable key, Clerk starts a throwaway app and fails as "Couldn't find your account" |
| **Continuing on a squash-merged branch** | The squash puts a different commit on `dev`; every touched file becomes an `add/add` conflict |
| **`git worktree remove`** | Refuses on ignored files (`node_modules`); needs `--force` |
| **`git branch -d`** | Compares against the branch's **upstream**, not `main` |
| **A fresh worktree** | Has no `node_modules`; `vitest`/`tsx`/`next` are absent and it reads as a broken repo |
| **A green E2E run** | Proved nothing three times — see §4 |

---

## 3. NOT done — the honest list

### 3.1 `npm run db:status` has never successfully connected

Built, and only its **refusal paths** were exercised. It needs
`DEV_DATABASE_URL` / `PROD_DATABASE_URL` in `.env.local` and neither is set, so
the happy path is **unproven**.

### 3.2 `npm run seed:dev` has never run end to end

The dev database was seeded by executing the SQL through the Supabase MCP, not
by the script. The script's guards were tested; its success path was not. Same
missing `DEV_DATABASE_URL`.

### 3.3 The dev Vercel project tracks `main`, not `dev`

Branch Tracking could not be edited (the control appeared disabled). The
adopted workaround: dev credentials live in the **Preview** scope, reached via
the stable branch alias `stellr-web-dev-git-dev-stellreducation.vercel.app`, and
the **Production scope is deliberately empty** — verified empty on 10 Sept. If
anything is ever added there, merging to `main` would deploy a second production
and run all 12 crons.

### 3.4 Registration → DocuSign consent has no E2E coverage

The flow with the most incident history in these handovers. The most valuable
next spec.

### 3.5 The Cowork-built deploy skill was never located

The session opened by asking for a review of "the deploy skill built in Claude
Cowork". It could not be found on this machine — `~/Downloads/skills.zip` was
the Farmshare bundle. The rewrite proceeded from the draft in this repo instead,
so if that skill exists it has still not been reviewed.

### 3.6 Smaller items

- **`.nvmrc` says 22; Vercel and CI run 24.** Flagged in #28, never reconciled.
- **An empty probe commit `95a4db9`** sits in `main`'s history — mine, from
  testing branch protection badly. Left rather than force-pushed.
- **Two merged remote branches** remain on origin:
  `feat/event-flyers-2026-09-01`, `feat/event-space-provisioning-2026-08-27`.
- **`stellr-entitlements-dev`** (Supabase, INACTIVE since June) is unused.
- **`apollo-hubspot-bridge`** (Vercel) has `link: null` — no Git repository
  connected, which may not be intended.
- **`HUBSPOT_DRY_RUN`** is recommended in `ENV-MATRIX.md` §4 but not implemented;
  dev safety currently relies on the token being absent.
- **`e2e` is not a required status check.** Only `verify` is. Deliberate while
  the job was unproven — now that it is green, worth requiring.

---

## 4. Three false greens, and what changed because of them

The E2E suite reported confident passes three times while testing nothing.

1. **Vercel's login page.** The dev project sits behind Vercel Authentication;
   every request 302'd to a login page that has an `<h1>` and logs no app errors.
   21 "passed".
2. **Vercel's "Deployment is building" placeholder.** The preview sat `QUEUED`
   and never built. 21 "passed" again — and the CORS errors from
   `instant-preview-site.vercel.app` were the placeholder's own assets saying so,
   filtered away as third-party noise instead of read.
3. **The CI job itself.** Three runs reported `e2e: pass` while every test step
   was `skipped`, because the missing-secrets path exits cleanly.

**What changed:** `e2e/global-setup.ts` now requires **positive identification** —
the target must contain "Stellr" before any spec runs — and placeholder pages,
redirect loops and SSO walls each fail with their own diagnosis. Enumerating
known-bad pages would only have waited for a fourth.

**The lesson for a future session:** check the `npx playwright test` **step
outcome**, never the job's conclusion. `gh api
repos/aussie-spaceman/stellr-web/actions/runs/<id>/jobs` shows it.

---

## 5. A misdiagnosis worth recording

Three `auth.setup` tests failed in the first real CI run. It was called a
cold-runner timeout and the CI timeouts were raised. **That was wrong** — the
second run failed identically at 30s.

The real cause: `DEV_CLERK_PUBLISHABLE_KEY` held a **production** key. The trace
showed the browser calling `clerk.stellreducation.org` while the testing token
had been minted for the development instance, so Clerk never reached `loaded`.

**Still worth checking:** a production key was stored under a `DEV_` name. If it
was copied while Clerk's instance switcher sat on Production, the same slip could
have put live keys into the **Vercel dev project's Preview scope** — which would
mean the dev environment authenticating against real user accounts. `.env.local`
was confirmed `_test`; the Vercel Preview scope was not.

---

## 6. If you pick this up

```bash
# Where things are
git log --oneline origin/main -5
gh pr list --state open

# The suite, locally (worktree needs its own npm ci)
cd ~/Documents/GitHub/stellr-web-e2e && npx playwright test

# Whether a CI e2e run actually ran, rather than skipped
gh api repos/aussie-spaceman/stellr-web/actions/runs/<id>/jobs \
  --jq '.jobs[] | select(.name=="e2e") | .steps[] | "\(.conclusion)  \(.name)"'
```

Reference: `docs/REC-deploy-environments-2026-09-07.md` (the plan),
`docs/ENV-MATRIX.md` (which variable belongs where),
`docs/SCHEMA-BASELINE.md` (the database), `docs/CONCURRENT-SESSIONS.md`
(worktrees, ports, migrations), `.claude/skills/{ship,promote}`.
