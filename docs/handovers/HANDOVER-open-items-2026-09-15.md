# Handover — open items from the 10–15 Sept 2026 deploy-environment sessions

You are picking up a list of specific, verified defects and decisions left open
by three prior sessions on `stellr-web`. Every item below was confirmed against
the live repo or live services on 15 Sept 2026 — nothing here is a guess. Where
a fix is prescribed, the prescription was written by the session that found the
problem and has the context for it. Where a decision is needed, the two sides
are stated and the choice is the user's.

Work in this order. Items 1–3 are one change and should ship as one PR.

**Repo:** `/Users/david.shaw/Documents/GitHub/stellr-web`, GitHub
`aussie-spaceman/stellr-web`. Flow is `session branch → dev → main`. Use the
`ship` skill for session → `dev` and the `promote` skill for `dev` → `main`;
both are in `.claude/skills/`. `main` is protected: `verify` + `e2e` required,
`strict`, `enforce_admins`. `dev` requires the same two checks.

**First action:** save this document as
`docs/handovers/HANDOVER-open-items-2026-09-15.md` and include it in your first
PR, so it lives in the repo and not only in a chat.

---

## Standing rules from the prior sessions — read before doing anything

1. **A green CI badge is not evidence.** Read the job's step outcomes:
   `gh run view <run> --job <job>` must show `✓ Run npx playwright test` and a
   `N passed` line. The `e2e` job has reported green with every test step
   skipped, three times. Current expected count is **45 passed, 1 skipped**.
2. **Never run `npm run dev` in the main checkout until item 1 is done.** It is
   currently a local server with full write access to production member data.
3. **Never rebase a branch whose PR has squash-merged.** Cherry-pick the delta
   commits onto a fresh branch from `dev`. (`ship` skill, Phase 5.)
4. **The Vercel CLI token has expired.** Every `api.vercel.com` call 403s and
   `npx vercel` will prompt for login. Confirm deployments through GitHub:
   `gh api repos/aussie-spaceman/stellr-web/commits/<sha>/status` (the
   `Vercel – stellr-web` context) or
   `gh api repos/aussie-spaceman/stellr-web/deployments?sha=<sha>` (environment
   contains "Production"). Do not log the CLI in unless the user asks.
5. **Before merging a promotion, check the `Vercel – stellr-web` status on the
   PR** — not just the two required checks. On 10 Sept it read "Deployment rate
   limited — retry in 24 hours" while `verify`/`e2e` were green; merging would
   have left `main` ahead of what was serving. "Vercel is deploying your app"
   for 10+ minutes with no deployment record is the Hobby build queue, not the
   rate limit — check `created_at` on the status before worrying.
6. **A written handover lands before you report done.** `ship` Phase 6 (added
   15 Sept): docs on the branch before merge, or a docs PR that is merged before
   close-out. `gh pr list --state open --search handover` must be empty.
7. **Do not print secrets.** Two exposures happened in prior sessions from
   error output (a `Set-Cookie` JWT, a `psql` percent-encoding error). Check
   key *types* with prefix tests (`pk_test_`/`pk_live_`), never values.
8. Report outcomes faithfully. If a step was skipped or a check is unverified,
   say so in those words.

---

## 1. HIGH — the main checkout runs local dev against production

**Verified 15 Sept.** `stellr-web/.env.local` holds:
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_…` (production Clerk instance)
- `NEXT_PUBLIC_SUPABASE_URL=https://hwtzpfrnksksxlwwabqz.supabase.co`
  (**production** project) with its `SUPABASE_SERVICE_ROLE_KEY` — full write
  access, RLS bypassed
- `NEXT_PUBLIC_SITE_URL=https://www.stellreducation.org`,
  `NEXT_PUBLIC_AUTH_APP_URL=https://app.stellreducation.org`

`npm run dev` there is a local server with production credentials, and
`proxy.ts` redirects its public routes to the live site. This was the server
found serving a `pk_live` build on port 3000 during the E2E work. A second
worktree in the same state (`stellr-web-co-grades`) was removed on 15 Sept;
this one is unchanged.

**Fix — repoint `.env.local` at the dev environment:**

| variable | set to |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xvxlhbxtiwxpopoqjygm.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | dev project anon key (Supabase → dev project → Settings → API) |
| `SUPABASE_SERVICE_ROLE_KEY` | dev project service_role key |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | dev instance `pk_test_…` (Clerk → `brief-ox-79.clerk.accounts.dev`) |
| `CLERK_SECRET_KEY` | dev instance `sk_test_…` |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:<PORT>` |
| `NEXT_PUBLIC_AUTH_APP_URL` | `http://localhost:<PORT>` (same value — this is `proxy.ts`'s single-host branch) |
| `NEXT_PUBLIC_APP_ENV` | `dev` (add if absent) |
| `PORT` | claim one; `scripts/dev.mjs` will write it if absent |

Keep `DEV_DATABASE_URL` and `PROD_DATABASE_URL` exactly as they are — they are
correct and took time to get right (see item 9).

**The user must supply the dev secret values** — they are not retrievable from
any API and must not be pasted into chat. Instruct them to edit the file
directly (`open -e .env.local`). Do NOT use a `read -rs` prompt: it cannot work
through the app's Run button (no stdin) and silently writes empty values.

**Verify:**
```bash
grep -oE '^NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_(test|live)|^NEXT_PUBLIC_SUPABASE_URL=https://[a-z]+' .env.local
```
Must show `pk_test` and `xvxlhbxtiwxpopoqjygm`. Then `npx playwright test`
locally must pass — its `global-setup` refuses production hosts and asserts the
final host matches the target, so a pass is meaningful.

## 2. HIGH — `.env.local.example` steers every new worktree to production

**Root cause of item 1.** Verified 15 Sept:
- line 17: `NEXT_PUBLIC_SITE_URL=https://www.stellreducation.org`
- line 35: `NEXT_PUBLIC_SUPABASE_URL=https://hwtzpfrnksksxlwwabqz.supabase.co`
  (production ref)
- no `NEXT_PUBLIC_AUTH_APP_URL`, no `PORT`, no `PROD_DATABASE_URL`;
  `DEV_DATABASE_URL=` at line 267 is empty with no host guidance

Every worktree made by copying the template starts pointed at production.
`scripts/dev.mjs`'s `pinLocalOrigins()` only *adds* missing origin vars; it
never overrides an explicit production value, so it cannot save a worktree
created from this file.

**Fix:**
- line 35 → `https://xvxlhbxtiwxpopoqjygm.supabase.co`, with a comment that the
  production ref belongs only in Vercel's Production scope
- line 17 → `http://localhost:3000`; add `NEXT_PUBLIC_AUTH_APP_URL=http://localhost:3000`
  directly beneath, with a comment that both must be the same origin locally
- add `PORT=` (blank; `dev.mjs` claims one) near the top
- at line 267, add `PROD_DATABASE_URL=` beneath `DEV_DATABASE_URL=` with this
  comment, which cost real time to learn:
  ```
  # Session pooler URIs, port 5432 (NOT 6543). The pooler HOST differs per project:
  #   dev  -> aws-0-us-east-2.pooler.supabase.com
  #   prod -> aws-1-us-east-2.pooler.supabase.com
  # A wrong host fails as "Tenant or user not found", which looks like a bad password.
  # A literal % in the password must be written %25.
  ```

## 3. HIGH — `scripts/dev.mjs` must refuse to start on the production ref

Items 1–2 are conventions. This is the control.

In `main()` (starts line 65; `const here = process.cwd()` at line 66), before
any port work, add a guard: read `.env.local`, and if `NEXT_PUBLIC_SUPABASE_URL`
contains `hwtzpfrnksksxlwwabqz` **or** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
starts with `pk_live_`, print a clear refusal and `process.exit(1)` — unless
`process.env.ALLOW_PROD_LOCALLY === '1'`. The message should name which
variable tripped it and say what to do (item 1's table). Match the existing
file's comment style: it explains WHY with the incident date.

Add a unit test if the file has one; otherwise verify by hand with a scratch
`.env.local` in a temp worktree (never by editing the real one back to
production).

Ship 1–3 as one PR titled to the effect of "Stop local dev pointing at
production". `.env.local` itself is gitignored — the PR carries the example
file and `dev.mjs`; the user's own `.env.local` change is local.

## 4. MEDIUM — #73's email copy is live and nobody has read a real email

PR #73 (merged and promoted 15 Sept, `a0e9c67`) made
`lib/registration-notify.ts` vary the confirmation body by **tier family**:
`confirmationCopyFor(tierName)` (line 145) returns `FAMILY_COPY[group]` for
teacher / high school / college via `tierGroupOf()` from `lib/tiers.ts`
(`TIER_GROUPS`, line 27), or `NEUTRAL_COPY` when the tier has no family.

CI proved it compiles and its 7 unit tests pass. That is not the same as a real
registrant receiving the intended copy. Nobody has looked at a delivered email.

**Verify on the dev deployment**
(`https://stellr-web-dev-git-dev-stellreducation.vercel.app`, behind Vercel
protection — the E2E fixtures handle the bypass header):
- Complete one registration on a High School tier and one on a College tier.
- Outside production, `lib/email.ts` `routeRecipients()` sends everything to
  `DEV_EMAIL_SAFELIST` (default `hello@stellreducation.org`) with the intended
  recipient in the subject prefix. Read both emails there.
- Confirm each carries its family copy, not `NEUTRAL_COPY`. If either is
  neutral, `tierGroupOf()` is not matching the tier name as stored — compare
  `TIER_GROUPS` against `membership_tiers.name` in the dev database
  (`xvxlhbxtiwxpopoqjygm`, 12 rows).

If the user cannot do a registration, the fallback is a one-off script that
calls `confirmationCopyFor()` for every name in `membership_tiers` and prints
which family (or neutral) each resolves to. That proves the mapping against
real tier names, which the unit tests do not.

## 5. LOW — flaky sign-out test

`e2e/core/member-account.spec.ts`, test `signing out ends the session`
(line ~53–66). On PR #73 it failed once and passed on retry: after
`Clerk.signOut()` + `context.clearCookies()`, `page.goto('/account')` stayed
on `/account` for the full 5s `not.toHaveURL` window. Session revocation is
asynchronous server-side; the test asserts a negative on a fixed timeout.

**Fix:** replace the final two lines with a positive wait for the redirect:
```ts
await page.goto('/account')
await page.waitForURL((url) => !/\/account$/.test(url.pathname), { timeout: 15_000 })
```
A test that flakes gets ignored, which is worse than one that fails. Run it
10× locally (`--repeat-each=10`) before shipping.

## 6. LOW — `.claude/releases/` is not gitignored; two untracked files are waiting

`.claude/skills/promote/SKILL.md` line 40 says the release record is written to
`.claude/releases/promote-<date>.md` **"(gitignored)"**. It is not:
`git check-ignore .claude/releases/x` returns nothing and `.gitignore` has no
`.claude` entry.

**You will find two untracked files in the main checkout on arrival.** They
show as "2 changed files" in GitHub Desktop. The user has seen them and chosen
to leave them for you to decide — do not treat them as leftover mess:

| file | what it is |
|---|---|
| `.claude/releases/promote-2026-09-10.md` | rollback target and blast radius for the 14 Sept grades 7–12 promotion (#68/#69). **This is the only copy** — it was rescued from the `stellr-web-co-grades` worktree before that worktree was deleted. |
| `.claude/releases/promote-2026-09-15.md` | same for the 15 Sept promotion (#73–#75), rollback target `8e22017`. |

**Do not delete either. Do not commit them directly to `dev` from GitHub
Desktop** — that bypasses the PR flow and CI.

**Decide, then do one of:**
- add `.claude/releases/` to `.gitignore` (makes the skill true; records stay
  local and can be lost with a checkout — and the 10 Sept one already nearly
  was), or
- remove "(gitignored)" from the skill's line 40 and commit both records via a
  normal branch → PR → `dev` (durable rollback history in the repo).

The second is probably right for a solo-maintainer repo where the checkout is
the only copy. Either way the skill text and reality must agree, and either
way the two files stop showing as changes.

**Also on arrival:** GitHub Desktop showed the checkout on `dev` at the end of
the last session while the CLI had it on `main` at `b18af0c`. Run
`git status && git branch --show-current` first and `git checkout main` if
needed — this document assumes `main`. The two untracked files will follow you
across branches; that is expected.

## 7. LOW — mirror the `ship` Phase 6 rule into `close-out`

PR #74 (15 Sept) added to `ship` Phase 6: a written handover lands on the
branch before merge, or on a docs PR merged before close-out reports done. The
open-PR problem it addresses (#67 sat open five days) *originates* in the
`close-out` skill, which writes the handover and opens the PR.

`close-out` is a **plugin skill outside the repo**:
`/Users/david.shaw/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/0feaaf3f-7067-477f-8770-f5f47311e1b0/32f688f5-9a42-4aeb-8426-908a047880b0/skills/close-out/SKILL.md`

Add one instruction to its step 5: the handover PR is merged (and, if the
user's flow requires it, promoted) before step 6 runs. Confirm with the user
before editing a file outside the repo.

## 8. DECISION — dev Vercel project still tracks `main`

The user asked (10 Sept) for the dev project to track `dev`. It was not done,
deliberately: switching `productionBranch` makes dev-branch deploys a
*Production* target, which reads the dev project's **Production** scope, and
that scope is empty. The dev environment would break instantly and cannot be
repopulated from outside (Vercel never returns secret values). Instead an
Ignored Build Step skips `main` builds on that project:
`if [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then exit 0; else exit 1; fi`.
It reported `Canceled by Ignored Build Step` on three of four `main` merges
since; the fourth (`b18af0c`, 15 Sept 15:45Z) had not resolved when last
checked — **re-verify it did not build.**

To do it properly: (1) copy every Preview-scope variable into the dev project's
Production scope, (2) set `NEXT_PUBLIC_APP_ENV=dev` there, (3) change Production
Branch to `dev`, (4) re-enable that project's crons (disabled 10 Sept) so
`guardCron` is exercised. Only the user can supply step 1's values. Otherwise,
record the Preview-scope arrangement as permanent in `docs/ENV-MATRIX.md`.

## 9. CONTEXT — things that now work, do not re-derive

- `npm run db:status` / `npm run db:status -- --prod` — both work. dev
  `147/147`, production `147/156`, both "nothing pending". The 9 ledger-only
  rows are migrations 138–148 recorded by timestamp; historical.
- `npm run seed:dev` — works, idempotent (`on conflict (id) do update`),
  restores the partially-signed DocuSign fixture the E2E specs assert on.
- Dev Supabase exposes `entitlements` (11 tables, `service_role` × 11 grants),
  identical to production.
- Dev project crons disabled; production's 13 crons enabled.
- `dev` branch protection: `verify` + `e2e`, `enforce_admins:false` — an admin
  can merge past a red check there. **Decision pending** whether to tighten.
- E2E: 45 passed, 1 skipped is the baseline. `global-setup` refuses production
  hosts, asserts the final host, and detects Vercel placeholders.
  `reuseExistingServer` is `false` always. `admin-nav.spec.ts` audits every
  sidebar link; its `KNOWN_SERVER_ERRORS` list is empty and self-cleaning.
- rego→DocuSign E2E covers the **admin consent-forms view only**. A spec that
  submits the registration form and asserts the `docusign_envelopes` insert is
  still wanted; needs a real Sanity event slug in the seed.

## 10. Where the full record is

- `docs/handovers/HANDOVER-close-out-2026-09-15.md` — session 3
- `docs/handovers/HANDOVER-close-out-2026-09-10b.md` — session 2 (E2E false
  greens, the worktrees-on-production finding)
- `docs/handovers/HANDOVER-deploy-environments-2026-09-10.md` — session 1
- `docs/ENV-MATRIX.md`, `docs/SCHEMA-BASELINE.md`, `docs/CONCURRENT-SESSIONS.md`
- Trackers (Google Docs, manually-updatable Complete column):
  - session 3: https://docs.google.com/document/d/1bIyYNP7WarCH70LOVwoobGW0V4xZsvfggSjs28QFjPM/edit
  - session 2: https://docs.google.com/document/d/1eCDJc1b1nNFFHtESSLsN0FrLs6GphNz_Rkr11lm-xXQ/edit

Identifiers: dev Supabase `xvxlhbxtiwxpopoqjygm`, production `hwtzpfrnksksxlwwabqz`;
Vercel projects `stellr-web` (prod) and `stellr-web-dev`; Clerk dev instance
`brief-ox-79.clerk.accounts.dev`; E2E fixture users are
`{ada.student,grace.teacher,…}+clerk_test@example.com` with passwords in
`E2E_*_PASSWORD`.

When done, update the session-3 tracker's Complete column for each item, land
your own handover per rule 6, and confirm `gh pr list --state open` is empty.
