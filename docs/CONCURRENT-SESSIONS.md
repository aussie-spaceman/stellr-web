# Running several sessions at once

Phase 3 of `REC-deploy-environments-2026-09-07.md`. Four things collide when two
sessions work on this repository at the same time: the checkout, the dev server
port, migration filenames, and knowledge of what is applied where. Each has a
mechanism now rather than a convention.

## 1. One worktree per session

**Never share a checkout.** On 9 Sept two sessions shared this one: the second
switched branches and rebased while the first was committing, so a commit landed
on the wrong branch and had to be moved. Nothing was lost, but only because the
tree happened to be clean.

```bash
git worktree add -b <branch> ../stellr-web-<name> origin/dev
cd ../stellr-web-<name>
npm ci                      # worktrees do NOT share node_modules
cp ../stellr-web/.env.local .env.local
```

`npm ci` is not optional and is easy to forget: a fresh worktree has no
`node_modules`, so `vitest`, `tsx` and `next` are all missing and the failure
looks like a broken repo rather than a missing install.

Remove it when the branch is merged:

```bash
git worktree remove ../stellr-web-<name>
```

## 2. A port per worktree

`npm run dev` allocates one automatically and records it as `PORT=` in that
worktree's `.env.local`.

Allocation reads the `PORT` claims of **every sibling worktree**, not just the
ports currently listening. A live probe cannot see a dev server that has not
been started yet, so two idle worktrees would otherwise both be handed 3000 —
and the second to start would either fail or silently attach to the first,
serving another branch's code.

The main worktree keeps 3000 whenever it is free, so `.claude/launch.json` and
bookmarked `localhost:3000` links still work. An explicit `PORT` in the
environment always wins; the script allocates a default, it does not overrule a
deliberate choice.

## 3. Timestamped migrations

```bash
npm run migration:new -- add_thing     # → 20260910143022_add_thing.sql
```

Sequential numbers work for one person and fail silently for two: both write
`149_…`, one is lost, and nothing notices until production and a branch disagree
about the schema. It has happened here — `GO-LIVE-CHECKLIST.md` records a `019_`
collision that had to be renumbered.

`npm run lint:migrations` rejects any new sequentially-numbered file and runs in
`prebuild`, so it gates the build rather than relying on memory. Files up to
`148` are the existing history and stay exactly as they are; timestamps sort
after them lexicographically (`148` < `2026`), so ordering is preserved.

## 4. Knowing what is applied where

```bash
npm run db:status              # dev
npm run db:status -- --prod    # production, read-only
```

Requires `DEV_DATABASE_URL` / `PROD_DATABASE_URL` (Supabase → Connect → Session
pooler). Both are refused unless the connection string names the expected
project, because a status report about the wrong environment is worse than none.

This was tribal knowledge until 9 Sept, and it was wrong: production's ledger
was missing eleven versions that had in fact been applied, so the CLI would have
tried to re-run them. Production also carries nine rows recorded as timestamps
rather than file numbers, from migrations applied through a different path —
`db:status` reports those as "ledger-only" and they are a historical record, not
a problem.

## What is still convention rather than mechanism

- **Branch naming.** `feat/`, `fix/`, `chore/` — nothing enforces it.
- **Claiming a piece of work.** Two sessions can still choose the same file.
  Worktrees stop them corrupting each other's commits; they do not stop a merge
  conflict.
- **`.env.local` drift.** Copied per worktree, so a variable added in one is
  missing in the others. `.env.local.example` is the reference.
