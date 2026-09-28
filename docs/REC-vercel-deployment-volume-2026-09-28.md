# Vercel deployment volume: why we hit the limit, and what to do

28 Sept 2026. The account is on the Hobby plan, whose limit is 100 deployments
a day. It was hit on 24 Sept and again on 28 Sept, and while it is hit,
nothing deploys: not `dev`, and not a promotion to `main`.

## What happened on 28 Sept

Between 15:40Z and 20:05Z there were exactly 100 deployments across
`stellr-web` and `stellr-web-dev`. The next push (#237, 20:06Z) was refused
with "Deployment rate limited — retry in 24 hours".

| Source | Deployments | Built | Why |
|---|---|---|---|
| Feature and docs branch pushes | 51 | 0 | Each push made a deployment on both projects; both were cancelled |
| Pushes to `dev` | 43 | 22 | One real build on `stellr-web-dev`, one cancelled on `stellr-web` |
| Pushes to `main` | 6 | 3 | One real build on `stellr-web`, one cancelled on `stellr-web-dev` |

**75 of the 100 were cancelled by our own `scripts/vercel-ignore-build.sh`.**
The ignore step runs *after* Vercel creates the deployment, so it saves build
time and storage but not the daily count. The 15 Sept fix (#92) solved the
storage meters and never touched this one.

Of the 22 real `dev` builds:
- 10 were docs-only: close-outs and promotion records.
- 3 were promote Step 8 fast-forwarding `dev` to `main`, which rebuilds an
  identical tree.

## What is done (PR for this document)

1. **Only `main` and `dev` create deployments.** `vercel.json` now sets
   `git.deploymentEnabled`: `"**": false, "main": true, "dev": true`. Per
   Vercel's docs, a branch deploys if any pattern that matches it is `true`.
   Feature-branch pushes now create nothing. That is about 51 of the 100, and
   it also removes the extra pushes from fix-up commits and `update-branch`.
2. **One record PR per promotion instead of 2–3.** During a promotion the
   record lives in the promotion PR body. The file is committed once, at the
   end (promote skill, Step 1 and Step 8).
3. **The `dev` sync happens in the same merge.** Step 8's record PR branches
   from `main`'s merge commit and merges into `dev` with `--merge`. That gives
   one push to `dev` instead of a record PR plus a separate fast-forward. It
   also ends the fast-forward overwriting the production commit status
   (TRACKER 20.3).

Estimate for a day like 28 Sept: 100 falls to about 49 with (1), and to about
33–37 with (2) and (3).

The remaining floor is 2 deployments per push to `dev` or `main`. One of each
pair is always a cancelled cross-project deployment, because both projects
read the same `vercel.json`, so no per-branch rule can separate them.

## Fix 4: the bigger levers, which are David's decision

**Neither is done. Recommendation: do neither yet.** Watch a busy week after
fixes 1–3 first. Read the counts with the Vercel MCP `list_deployments`
(slug `stellreducation`, both project IDs, `since` = 24 h ago). Only if a
normal day still goes above ~70 is a bigger lever worth it.

### 4a. Upgrade to Pro (billing change; David only)
Pro's daily deployment limit is far higher than Hobby's. See vercel.com/docs
→ Limits for the current figure; it has not been re-checked here. Pro also
adds instant rollback to any deployment, which the promote skill's rollback
target would use. Cost is per seat per month.

This is the fastest and lowest-risk lever. Nothing in the repo changes.

### 4b. Merge the two projects into one (not recommended)
This would halve every remaining deployment by removing the cancelled twin. It
would make `dev` a Preview (or Custom Environment) deployment of `stellr-web`,
with branch-scoped environment variables. It breaks the reasons the second
project exists:

- **Dev crons stop.** Vercel runs crons on production deployments only. The dev
  project's crons were re-enabled on 15 Sept so that the `APP_ENV=dev` guard
  is exercised on every schedule (`docs/ENV-MATRIX.md`).
- **The environment guards change meaning.** The dev project deploys as
  `VERCEL_ENV=production`, and `isRealProductionApp()` vs
  `isProductionDeployment()` (`lib/env-guards.ts`) was designed around that.
  Every guard would need re-auditing.
- **Environment variables move.** Every dev secret (Supabase, Clerk, Stripe
  test, DocuSign demo, `CRON_SECRET`) would have to become branch-scoped
  Preview variables. One mis-scoped variable points the dev branch at
  production services.
- **Custom Environments are, as far as known, Pro and above** (not re-checked here), so the clean version of 4b likely needs
  4a anyway.

Given that, 4a strictly dominates 4b.
