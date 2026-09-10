---
name: promote
description: Promote `dev` to `main`, deploying to production — check what is shipping, apply any migration to production BEFORE the code merges, record a rollback target, merge with a merge commit, and verify the live site. Use when the user says promote, release, ship to prod, or deploy to production. For session → dev, use `ship`.
---

# Promote (`dev` → `main`)

Merging to `main` deploys to production. This skill is deliberately slower than
`ship`, and resumable, because a promotion spans waits — CI, a Vercel build,
sometimes a dashboard step someone else has to take.

## The four rules

1. **⛔ Never merge without the user saying yes in this session.** Approval for
   one promotion is not approval for the next.
2. **Merge commit, never squash.** `dev` is long-lived. Squashing gives `main` a
   commit with no parent link to `dev`, so `dev`'s SHAs never become ancestors
   of `main`, the merge-base freezes, and every later promotion re-conflicts
   against an ever-older base. (Feature branches into `dev` still squash.)
3. **Migrations reach production before the code that needs them.** Old code
   against a new schema is safe; new code against an old schema is an outage.
4. **Deployment happens by git push.** Never `vercel --prod`.

## Step 1 — See what is shipping

```bash
git fetch origin
git log --oneline origin/main..origin/dev
git diff --stat origin/main...origin/dev
```

If `dev` is **behind** `main` — a hotfix landed directly, or a previous
promotion's merge commit — sync before anything else, or the promotion will
carry a stale tree:

```bash
git checkout dev && git merge origin/main --no-edit && git push origin dev
```

Write the state to `.claude/releases/promote-<YYYY-MM-DD>.md` (gitignored) and
keep it current after every step. A promotion spans async gaps and `dev` keeps
moving; the doc is the source of truth for "where are we", not the conversation.

## Step 2 — Name the blast radius

Read the diff and answer explicitly. Guessing here is how surprises reach
production:

- **Migrations?** — `supabase/migrations/`, and see Step 3.
- **`vercel.json` crons?** — a schedule change starts or stops real mail.
- **New environment variables?** — they must exist in Vercel **before** the
  merge, or the deploy ships code reading `undefined`.
- **Webhook contracts?** — Clerk, Stripe, DocuSign, Apollo, Motion all post to
  routes in this repo.
- **Outbound volume?** — anything touching `lib/email.ts` or a cron.
- **Runtime code at all?** A docs-only promotion is a no-op deploy; say so
  rather than implying risk that is not there.

## Step 3 — Migrations, before the code

```bash
npm run db:status -- --prod      # read-only; refuses a non-production URL
```

If anything is pending:

1. Apply it to **dev** first and verify.
2. ⛔ Show the user the exact SQL and get explicit approval.
3. Apply to production.
4. Re-run `db:status -- --prod` and confirm it is recorded.

Only then merge the code. Production's ledger was missing eleven applied
versions until 9 Sept, so `db:status` reporting clean is worth more than memory.

## Step 4 — Record a rollback target

Before merging, capture the current production deployment id — the one marked
`isRollbackCandidate` — and put it in the PR body. Rolling back should be one
command, not archaeology.

## Step 5 — Open the promotion PR

```bash
gh pr create --base main --head dev --title "Promote dev to main: <summary>" --body-file <file>
```

The body should carry: what ships, the blast radius from Step 2, migration state,
the rollback target, and what was verified. Say plainly when production
behaviour is unchanged — most promotions here are documentation and test
infrastructure, and claiming risk that does not exist trains people to skim.

```bash
gh pr checks <n> --watch
```

`BEHIND` is common because protection is strict and `dev` moves. Update, never
rebase:

```bash
gh pr update-branch <n>
```

Vercel's bot posts a deployment-status comment on every PR. It is not review
feedback; do not treat it as something to address.

## Step 6 — Merge

⛔ **Confirm with the user. Every time.**

```bash
gh pr merge <n> --merge
```

`--merge`, not `--squash`. See rule 2.

## Step 7 — Verify production

Not optional, and not "the deploy went green". Check the site:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://www.stellreducation.org
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://app.stellreducation.org
curl -s https://www.stellreducation.org/api/cron/entitlements    # expect 401
```

Expect `200`, a `307` to `/sign-in`, and `{"error":"Unauthorized"}`. The cron
check confirms the guard is live — a `{"skipped":true}` there would mean
`NEXT_PUBLIC_APP_ENV` is wrong and **every cron is silently doing nothing**.

Then, depending on the blast radius: `npm run verify:prod` for Stripe and
DocuSign, Vercel runtime logs for a cron change, and a read-only E2E smoke run
against production if the change was user-facing.

## Step 8 — Close out

Report what shipped, what was verified and how, and what is still open. Then sync
`dev` so the branches do not drift:

```bash
git checkout dev && git merge origin/main --no-edit && git push origin dev
```

Mark the progress doc `Promoted`. If anything failed, say so with the output —
never round a partial success up to done.
