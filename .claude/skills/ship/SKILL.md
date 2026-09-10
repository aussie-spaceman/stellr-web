---
name: ship
description: Ship a session's work from a worktree onto the `dev` integration branch — isolate the session, verify against what was asked, let CI gate it, open a PR, land it. Use when the user says ship it, raise a PR, merge this, or asks to get the session's work onto dev. For dev → production, use `promote`.
---

# Ship (session → `dev`)

Takes work from a session's worktree onto `dev`. **This never touches
production** — `promote` does that, deliberately as a separate act.

`main` is PR-only and admin-enforced, so no path skips review. That is the
mechanism; this skill is the sequence.

## Rules that exist because something went wrong

1. **One worktree per session.** Not a style preference: on 9 Sept two sessions
   shared a checkout, one switched branches and rebased mid-commit, and the
   other's commit landed on the wrong branch. Recovery worked only because the
   tree happened to be clean.
2. **Never `vercel --prod`, `vercel deploy`, `--force`, or `--no-verify`.**
   Deployment happens by git push. A production deploy once came from a dirty
   working tree via the CLI — precisely what `check-deploy-ready.mjs` existed to
   prevent, bypassed because it was optional.
3. **Trust CI, not a local run.** Local gates are advisory; `verify` decides.
4. **Squash into `dev`, then abandon the branch.** Feature branches squash;
   `promote` merges (the reason is in that skill). The corollary matters as much
   as the rule: **never keep committing to a branch after it has been
   squash-merged.** The squash puts a *different* commit on `dev`, so git sees
   the squashed copy and your original commits as unrelated additions of the
   same files, and the next merge is a wall of `add/add` conflicts. Branch fresh
   from `dev` for the next piece of work — Phase 5 removes the old worktree so
   this is the path of least resistance.
5. **A green suite is not evidence until it identifies its target.** The E2E
   suite twice reported "21 passed" against a Vercel page that was not the app —
   a login wall, then a "Deployment is building" placeholder. Both have an `<h1>`
   and log no app errors. `e2e/global-setup.ts` now refuses unless the target
   says "Stellr".

## Phase 0 — Isolate the session

Skip only if already in a dedicated worktree for this work.

```bash
git fetch origin
git worktree add -b <type>/<slug> ../stellr-web-<name> origin/dev
cd ../stellr-web-<name>
npm ci                                   # worktrees do NOT share node_modules
cp ../stellr-web/.env.local .env.local   # `npm run dev` then claims a free port
```

`npm ci` is easy to forget and its failure is unrecognisable: `vitest`, `tsx`
and `next` are simply absent, which reads as a broken repo.

Branch names follow the repo: `feat/`, `fix/`, `chore/`, `docs/`.

## Phase 1 — Establish the contract

You cannot check "does this match the spec" without naming the spec.

1. **The session itself** — what was actually asked, including mid-session
   corrections and anything explicitly declined. **Corrections outrank the
   original ask.**
2. **`docs/`** — a matching `PLAN-*`, `REC-*`, `*-HANDOVER*`, `RUNBOOK-*`. These
   are this repo's PRDs.
3. **Project rules** — `CLAUDE.md` (Design System V2, tokens, `@stellr/web-ui`,
   `@stellr/icons`, no raw hex or font names) and `VOICE.md` for user-facing
   copy.

Produce a numbered checklist where every line is checkable against the diff. If
there was no stated spec, say so and derive it from the user's messages — do not
invent scope.

⛔ Show the checklist. Ask whether anything is missing.

## Phase 2 — Migrations, if the change has any

Database work leads the code, and the order is not negotiable.

```bash
npm run migration:new -- <name>     # timestamped; sequential numbers collide
npm run db:status                   # what dev actually has
```

Never hand-write `149_…`. `lint:migrations` runs in `prebuild` and fails the
build, because two sessions both writing `149_` silently loses one — which has
happened here.

**Apply to `dev` first, verify, then write the code that depends on it.** Old
code against a new schema is safe; new code against an old schema is an outage.
Production's migration comes later, in `promote`, before the code merges.

## Phase 3 — Let CI decide

Push early and read `verify`:

```bash
git push -u origin HEAD
gh pr create --base dev --title "<title>" --body-file <file>
gh pr checks <n> --watch
```

`verify` runs typecheck, design-system lint, migration-name lint, the unit
suite, and a full build.

For anything a browser can observe:

```bash
npm run test:e2e:smoke
```

Against a deployment, pass `E2E_BASE_URL` **and** set
`VERCEL_AUTOMATION_BYPASS_SECRET` — the dev project is behind Vercel
Authentication, and without it every request lands on a login page.

**Never weaken a test to make it pass.** If the app does not do what the spec
says, that is a finding to report, not a test to soften.

## Phase 4 — Review against the contract

A summary is not a review. For each requirement:

| # | Requirement | Met / Partial / Not met | Evidence |
|---|---|---|---|

Then separately: anything built that was **not** asked for, and anything
breaching `CLAUDE.md` — hard-coded hex, off-scale spacing, re-implemented
components, raw SVG, Norwester or Aileron in site UI, copy ignoring `VOICE.md`.

`/code-review high` complements this: it hunts bugs, this hunts spec drift.
Neither substitutes for the other.

⛔ Anything Partial or Not met is the user's call — fix now, or land and track.

## Phase 5 — Land on `dev`

```bash
gh pr merge <n> --squash --delete-branch
```

If GitHub reports `BEHIND` (protection is strict), update rather than rebase:

```bash
gh pr update-branch <n>
```

Then tidy up. This is not housekeeping — it is what stops the branch being
reused after its squash:

```bash
git worktree remove ../stellr-web-<name>   # --force if node_modules remain
git branch -d <type>/<slug>
```

**More work on the same subject starts a NEW branch from `dev`.** Reusing the
merged one produces `add/add` conflicts on every file it touched, because the
squash on `dev` shares no ancestry with the commits still on your branch. If you
are already in that state, merge `dev` in (never rebase), keep your side for the
files you own, and regenerate `package-lock.json` with
`npm install --package-lock-only` rather than resolving it by hand.

`git worktree remove` refuses on ignored files, and `git branch -d` compares
against the branch's **upstream**, not `main` — both have wasted time here. If
`-d` refuses, confirm with `git merge-base --is-ancestor <branch> origin/main`
before reaching for `-D`.

## Phase 6 — Hand over

State plainly: what landed on `dev`, what CI proved, what is still open, and
whether it is ready to `promote`. If a phase was skipped, say which and why.

**Do not promote from this skill.** Production is a separate, deliberate act.
