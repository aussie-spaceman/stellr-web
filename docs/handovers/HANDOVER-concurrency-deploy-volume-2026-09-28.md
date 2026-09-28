# Handover: concurrent close-outs, and the Vercel deployment volume (28 Sept 2026)

Tracker: `docs/handovers/tracker/2026-09-28-concurrency-deploy-volume.md` (rows `concurrency-deploy-volume.N`).

## Context

David asked two things. Why do concurrent sessions' close-outs block each other?
And why does the account keep hitting Vercel's deployment rate limit? The usual
day runs several sessions → `/ship` to `dev` → one `/promote` → `/close-out` in
each session, all close together in time. That pattern made both problems
worse.

## What was wrong

**Close-outs (seen live: #235 went DIRTY, #235 and #236 had cancelled e2e runs).**
1. Every docs PR, and the push to `dev` each one caused, ran the full e2e suite.
   All of them shared the one repo-wide `e2e-dev-supabase` queue, which holds
   one running job plus one pending, and a newer arrival cancels the pending
   one. Four close-outs at 19:46Z queued about 8 serial runs, and two of those
   were cancelled.
2. Every close-out inserted its section at the same line of `TRACKER.md`, so
   any two open at once conflicted.
3. "Session N" was numbered from what was on `dev`, so concurrent sessions
   collided or landed out of order.
4. Close-outs edited other sessions' rows.

**Vercel (limit hit 24 Sept and 28 Sept).** Vercel creates a deployment for
every push, on every branch, in both projects, and only *then* runs
`vercel-ignore-build.sh`. A cancelled deployment still counts toward Hobby's
100 a day. On 28 Sept there were 100 deployments between 15:40Z and 20:05Z, 75
of them cancelled, and the next push was refused.
- 51 were feature- or docs-branch pushes.
- 43 were pushes to `dev`. Of the 22 real `dev` builds, 10 were docs-only and 3
  were promote Step 8's fast-forward.
- 6 were pushes to `main`.

## What changed (all on `dev`, none promoted; none needs production)

- **#237 (`90a9ee5`):**
  - `ci.yml`: a new `changes` job. `e2e` is skipped when every changed path is
    under `docs/**` or `.claude/**`, or is a root `*.md`.
  - `TRACKER.md` is frozen as history, with the new rules at the top.
  - `docs/handovers/tracker/_TEMPLATE.md` is the per-session file template.
  - `scripts/tracker.mjs` backs `npm run tracker`.
  - `.claude/skills/close-out/SKILL.md` is the repo-level close-out skill.
  - The ship skill's Phase 6 and `docs/CONCURRENT-SESSIONS.md` §5 point at it.
- **#239 (`b54c0a1`):**
  - `vercel.json` `git.deploymentEnabled` is `"**": false, "main": true,
    "dev": true`. The reason is documented in the header of
    `vercel-ignore-build.sh`.
  - Promote skill Step 1: the record lives in the promotion PR body during the
    run, and an in-progress promotion is detected with
    `gh pr list --base main --head dev`.
  - Promote skill Step 8: one record PR, branched from `main`'s merge commit
    and merged into `dev` with `--merge`. It replaces both the separate
    "Promoted" record PR and the direct fast-forward.
  - `docs/REC-vercel-deployment-volume-2026-09-28.md` has the numbers and the
    fix-4 decision.
- The main checkout was fast-forwarded from `75f03d2` to `b54c0a1` (it was 19
  behind and had neither new skill).

## Verified

- **#237 as a code PR:** `changes` output `code=true`, and e2e ran: 56 passed.
- **Docs-only PR (#238, a probe, closed unmerged):** `e2e` was reported
  *skipping* the moment `verify` finished. It did **not** wait, even though a
  `dev` push run held the e2e queue.
- **Tracker script:** it counts 129 open rows, which equals the ☐ count in
  `TRACKER.md`. A sample `## Closes` entry removed the matching row.
- **Fix 1 on a branch:** #239's branch commit `1db79d3` got no Vercel status,
  and `list_deployments` by that SHA returned 0. The control was #237's branch
  commit, which got two "rate limited" statuses.
- **`dev` deploy of `b54c0a1`:** stellr-web-dev "Deployment has completed", and
  stellr-web "Canceled by Ignored Build Step".

## Not verified / not done

- **A docs-only *push to `dev`* skipping e2e.** The push path diffs
  `github.event.before..sha`. This close-out's own merge is the first real
  case.
- **Two new tracker files merging back to back** (plan step 4). Not run. It is
  expected to work because new files cannot conflict and `dev` is
  `strict: false`.
- **The new promote Step 1 and Step 8 flow** is only text in the skill until
  the next promotion runs it.
- **Fix 4 (Pro, or merging the two projects) was asked to be "built" but was not
  built.** It is a billing change or a dashboard migration: David's decision,
  and outside what the connectors can do. It is written up with a
  recommendation instead.
- **Claims in the REC that were not re-checked against Vercel's docs:** Pro's
  deployments/day figure (a figure of about 6,000 was given in chat), crons
  running on production deployments only, and Custom Environments being
  Pro-only.
- **Optional, deliberately not done:** skipping `npm run build` in `verify` for
  docs-only changes.
- **A known gap in the e2e skip.** A code push to `dev` whose run is cancelled
  by a following docs push is not re-tested on `dev`. It was already tested on
  its PR, and the promotion PR diffs everything.

## Open items

See the tracker file.
