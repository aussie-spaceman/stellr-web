# Handover — 10 Sept 2026, session 2

**For:** the next Claude Code session touching environments, E2E, or local dev.
**Follows:** `HANDOVER-deploy-environments-2026-09-10.md` (session 1, PR #60).
**Tracker with a manually-updatable Complete column:**
https://docs.google.com/document/d/1eCDJc1b1nNFFHtESSLsN0FrLs6GphNz_Rkr11lm-xXQ/edit

Repo state at close: `main` = `febee5b`, `dev` in sync, production READY.
PRs #61–#66 merged.

---

## 0. Read this first — the one thing that is actually dangerous

**Two worktrees run local dev against PRODUCTION**, and one of them is an
active session:

| worktree | Clerk | Supabase | origins | activity |
|---|---|---|---|---|
| `stellr-web` | `pk_live` | **production**, with `service_role` | production | main checkout |
| `stellr-web-co-grades` | `pk_live` | **production**, with `service_role` | production | commit 89 min before close |

`service_role` bypasses RLS. `npm run dev` in either worktree is a local server
with full write access to live member data, and `proxy.ts` redirects its public
routes to `www.stellreducation.org`. This is the pre-session state the entire
deploy-environments project set out to eliminate, surviving in the worktrees
that predate it. It is also what was found serving a `pk_live` build on port
3000 during this session.

Root cause: **`.env.local.example` defaults to production.** Line 35 gives the
production Supabase URL, line 17 the live site as `SITE_URL`. Every worktree
created by copying the template starts pointed at production.

`scripts/dev.mjs`'s `pinLocalOrigins` does not help here — it only *adds*
missing origin vars and never overrides an explicit production value.

**Recommended:**
1. Repoint both worktrees at the dev project and `http://localhost:<PORT>`.
2. Change `.env.local.example` to default to dev (`xvxlhbxtiwxpopoqjygm`),
   `http://localhost:3000` for both origins, and add `PORT=` and
   `PROD_DATABASE_URL=`. Production values belong only in Vercel.
3. Make `dev.mjs` **refuse to start** when `NEXT_PUBLIC_SUPABASE_URL` names
   `hwtzpfrnksksxlwwabqz` unless `ALLOW_PROD_LOCALLY=1`. A control, not a
   convention — conventions are what allowed this to persist.

---

## 1. What was asked, and what was actually done

### Done as asked
- **Apollo reconciler** — window rotates daily instead of re-processing the same
  first 200; alerts on truncation. 8 tests. (#61)
- **`assertLiveCredentials`** — now called at 8 Stripe write sites and Clerk
  `createUser`; previously detected but only enforced for DocuSign. (#61)
- **Dev Preview scope Clerk keys** — verified `sandbox` from *inside* the
  deployment via `/api/admin/health/integrations` with an admin E2E session.
  The only way: `vercel env pull` redacts secrets.
- **`e2e` required** — already on `main`; `dev` had **no** protection and now
  requires `verify` + `e2e` (`enforce_admins:false`, see §2).
- **`db:status`**, **`seed:dev`** — first successful runs ever. See §4.

### NOT done as asked — deliberately
- **"Dev Vercel project tracking → `dev`."** Still tracks `main`. Switching
  makes dev-branch deploys a *Production* target, which reads the **Production
  scope — and it is empty**. The dev environment would break instantly and
  could not be repopulated (Vercel never returns secret values). Instead an
  **Ignored Build Step** skips `main` builds on that project:
  `if [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then exit 0; else exit 1; fi`.
  Demonstrated `CANCELED` on both promotions since.
  To do it properly: populate the Production scope from the Preview scope, set
  `NEXT_PUBLIC_APP_ENV=dev` there, *then* switch the branch, then re-enable that
  project's crons so `guardCron` is exercised.

### Narrower than the name implies
- **"E2E → rego/DocuSign."** What shipped: assertions on the admin
  consent-forms **STATUS cell** for a seeded part-signed envelope, mutation-
  checked (inverting to the pre-fix "Awaiting Grace Teacher" fails). What did
  **not** ship: the registration form, envelope creation, the DocuSign hand-off.
  The "member view" spec is a smoke check (`/account` doesn't surface the
  envelope); the "registration entry point" spec asserts a bad slug 404s. Next
  step: submit the form for a fixture event and assert the `docusign_envelopes`
  insert, with `createEnvelope` stubbed. Needs a real Sanity slug in the seed —
  the current one deliberately matches nothing.

---

## 2. The E2E harness — four false greens, all fixed in #62

Every one had the same shape: a guard that asked *"is this the app?"* where the
question needed was *"is this **my** app?"*. Production is genuinely the same
app with the same content; content cannot distinguish it.

| what | cause | fix |
|---|---|---|
| Local smoke tested **production** | `NEXT_PUBLIC_SITE_URL` unset → `lib/env.ts` falls back to production origins → `proxy.ts` redirects off localhost. Smoke asserts status<400 and one `<h1>`; the live site satisfies both. **CI was never affected** — its e2e job pins both to localhost. | `global-setup` asserts the final host equals the target host; `dev.mjs` pins origins |
| Suite ran against a **sibling worktree's** server | `reuseExistingServer` attached to whatever held port 3000 — a `pk_live` build. Gating on a claimed `PORT` doesn't help: the claimed port *is* 3000. | `reuseExistingServer: false`, always |
| `auth.setup` couldn't reach a protected deployment | uses Playwright's own `test` (must, to write storage state) → never got bypass headers → Clerk never loaded → opaque `clerk.loaded()` timeout | shared `e2e/fixtures/vercel-bypass.ts`, origin-scoped |
| My own first DocuSign spec | asserted `Ada Student` visible — the PARTICIPANT column, identical whether complete, untouched, or role-swapped | assert the STATUS cell; mutation-check |

Also: `global-setup` no longer sends `x-vercel-set-bypass-cookie` (Vercel answers
`307 → /`, `fetch` keeps no cookies, loops; was misreported as "never built").
Console errors now include the resource URL — that is how the production
redirect was found.

**`e2e/core/admin-nav.spec.ts`** reads every sidebar href and requests it. 404
= dead link = hard fail (it found `/admin/delegations`, orphaned since
`e2d42cf`). Its `KNOWN_SERVER_ERRORS` list is **self-cleaning**: an entry that
starts passing also fails the spec. This fired exactly as designed when the
`entitlements` schema was exposed mid-promotion (#63 → #64).

Protection: `main` strict + enforce_admins; `dev` requires the same two
contexts but `enforce_admins:false` — chosen to avoid lock-out on the
integration branch. Decide whether that should tighten.

---

## 3. Dev environment reconciliation

| | state |
|---|---|
| `entitlements` schema | Now exposed in dev Data API. Verified identical to prod: 11 tables, `SELECT` for `service_role` × 11 only. Was the cause of `/admin/members/access` 500. |
| Dev project crons | Disabled 21:14 UTC (13 definitions). Production still enabled. Re-enable only if tracking moves. |
| Dev project `main` builds | Cancelled by Ignored Build Step. `stellr-web-dev.vercel.app` points at an old env-less build behind SSO — harmless. |
| Dev Preview scope | `deployment:preview`, clerk/stripe `sandbox`, docusign `unconfigured`, dev Supabase ref. Clean. |

---

## 4. `db:status` and `seed:dev`

Neither had ever run: they read `process.env` but never loaded `.env.local`,
**while their own error messages said to put the URI in `.env.local`**. Fixed
in #65.

First results:

    dev         local 147   ledger 147   nothing pending
    production  local 147   ledger 156   nothing pending
                ledger-only 9 = migrations 138-148 recorded by timestamp; historical

**This confirms the 9 Sept production ledger backfill was correct** — never
actually checked until now.

`seed:dev`: idempotent (`on conflict (id) do update`), no destructive
statements, single transaction. Fixture verified intact afterwards and the
suite passed (45) against the reseeded DB.

**Two traps that cost time:**
- **Session pooler host differs per project:** dev `aws-0-us-east-2`, prod
  `aws-1-us-east-2`. Wrong host → "Tenant or user not found", which reads like
  a credential error.
- A literal `%` in a password must be `%25`, or psql rejects the URI **and
  echoes the password into the error**.
- `read -rs` prompts cannot work through the app's Run button (no stdin) —
  they silently write empty values.

---

## 5. Waived exposures (user's call, recorded)

- `VERCEL_AUTOMATION_BYPASS_SECRET` — printed in a `Set-Cookie` JWT while
  diagnosing the redirect loop. "Ignore rotation, low risk."
- Dev database password — echoed by psql's percent-encoding error. "Ignore the
  password, low risk." Production password never exposed.

Rotate both if the transcript is ever shared.

---

## 6. Housekeeping

- `stellr-web-e2e` worktree: stale branch, holds a `PORT=3000` claim. Remove.
- `.env.local` in the main worktree now carries `DEV_DATABASE_URL` and
  `PROD_DATABASE_URL`. Gitignored; confirmed untracked.

---

## 7. How to verify anything in this document

- CI: read **step outcomes**, never the job badge —
  `gh run view <run> --job <job>` and look for `✓ Run npx playwright test` plus
  the `N passed` line. The badge was green with every step skipped, three
  times, in session 1.
- Deployments: `curl -s "https://api.vercel.com/v6/deployments?app=<proj>&limit=1&target=production"`
  — look for `READY` on `stellr-web`, `CANCELED` on `stellr-web-dev`.
- Which environment a deployment holds: `/api/admin/health/integrations` with
  an admin session. Nothing outside the deployment can answer this.
