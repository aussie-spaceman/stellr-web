# Handover — 15 Sept 2026, session 3

**For:** the next session touching deploys, branches, or local environments.
**Follows:** `HANDOVER-close-out-2026-09-10b.md` (session 2).
**Tracker (manually-updatable Complete column):**
https://docs.google.com/document/d/1bIyYNP7WarCH70LOVwoobGW0V4xZsvfggSjs28QFjPM/edit

Repo at close: `main` = `a0e9c67`, `dev` in sync, PRs #70–#75 merged. Local
state is exactly `main` + `dev`, one worktree. Rollback target for today's one
runtime change: `8e22017`.

---

## 0. Still the most dangerous thing in the repo

**The main checkout runs local dev against production.** Re-verified at close:
`stellr-web/.env.local` holds `pk_live` Clerk and the production Supabase
project *with its `service_role` key*. Removing the `co-grades` worktree today
halved the exposure; the main checkout is unchanged. Cause is still
`.env.local.example` line 35 defaulting to the production ref. Fix is three
steps and is in session 2's handover §0; none of them happened today because
none were asked for.

---

## 1. What was asked, and what was actually done

| asked | done | note |
|---|---|---|
| Confirm everything deployed | ✅ | #67 had sat open 5 days; #70 was pushed but never PR'd. Both landed via #71. |
| Remove both worktrees | ✅ | Release record `promote-2026-09-10.md` (only copy of the 14 Sept rollback target) preserved first. |
| Audit older local branches | ✅ | 39 by **content**: 33 deleted with plain `-d` (git re-verified each), 2 content-identical, 3 orphaned docs landed (#72), 1 unshipped feature (#73). |
| **"Rebase and ship"** `feat/tier-welcome-drips` | ✅ **shipped, cherry-picked not rebased** | Branch was in the post-squash state where `ship` says a rebase gives `add/add` conflicts on every file. Two commits onto fresh `dev`: 0 conflicts, 583 unit tests. Same outcome. |
| Update `/ship` | ✅ #74 | Checked first: the legacy path (doc committed to a merged branch) is *structurally closed* by Phase 5. The residual (close-out docs PR left open) is real — #67. Added the two valid orderings and an open-PR check. |
| Merge + promote | ✅ | Each `e2e` read by step outcome; production-project Vercel check confirmed green before each promotion. |

## 2. Inferred complete, actually not

- **#73's copy change is live but unobserved.** It changes what real
  confirmation emails say for HS/College tiers. CI proves it compiles and 7
  unit tests pass; nobody has read an actual sent email. `DEV_EMAIL_SAFELIST`
  routes dev sends to `hello@stellreducation.org` — trigger one HS and one
  College registration on the dev deployment and read both.
- **`a0e9c67` production deploy** was still building at close. `8e22017`
  before it confirmed at 14:37Z. Check GitHub's deployments API for a
  Production record — the Vercel CLI token has expired and every
  `api.vercel.com` call 403s.
- **Flaky sign-out test** — `e2e/core/member-account.spec.ts:66`. After
  `Clerk.signOut()` + `clearCookies()`, `/account` stayed put for 5s once,
  passed on retry. Revocation timing; use `page.waitForURL` rather than a
  negative assertion on a fixed timeout.
- **`.claude/releases/` is not gitignored** though the `promote` skill says it
  is. Two records sit untracked in the main checkout.
- **`/ship` fixed, `close-out` not.** The open-PR problem originates in
  `close-out`; the same one-line "merge the handover PR before reporting done"
  belongs there too. This handover is landing that way by hand.

## 3. Patterns worth knowing

- **Audit branches by content, not name.** 33 of 39 had a merged PR under a
  *different* head name or none at all; `git diff --shortstat origin/dev...b`
  empty + `git branch -d` succeeding is the proof. Two more were content-
  identical despite diverged history. Only the last six needed a human look.
- **Handovers written after the merge never land.** Four found today — all
  committed to the feature branch after its PR squashed. Phase 5 deleting the
  branch now prevents the old form; #74 addresses the new form.
- **Hobby queues builds.** A `dev` push behind a prior build shows "deploying"
  for 10+ min with no deployment record. That is a queue, not the 10 Sept
  rate limit. Check `created_at` on the commit status before worrying.
- **Post-squash branches: cherry-pick the delta commits onto fresh `dev`.**
  Never rebase, never merge the old branch. Zero conflicts today across a
  month of drift.

## 4. Carried forward, unchanged

Dev Vercel tracks `main` (Ignored Build Step cancelled all three `main` builds
today — working). rego→DocuSign E2E covers the admin view only. `dev`
protection is `enforce_admins:false`.
