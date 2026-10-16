# Worktree sweep — 2026-10-16

Slug: `worktree-sweep`. Handover: none; the PR #433 body is the record. Doc snapshot: none.
PR #433 → `dev`. Migration: none.

`npm run worktrees` (`scripts/worktree-sweep.mjs`) removes a linked worktree only when its branch tip is a merged PR's head, its tree is clean, and no process is using it. It explains every one it keeps. ship, promote and close-out run it with `--apply` from the main checkout at the start and after their merge. It removed the 14–15 Oct leftovers of #420, #421 and #424.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| worktree-sweep.1 | Land the check-in-banner close-out | #425 is open: verify passed on 15 Oct, it merges cleanly into `dev` (16 Oct), `lint:pii` passes on its lines, body and commits | Merge #425 into `dev` | ☐ |
| worktree-sweep.2 | Three app-managed worktrees in `.claude/worktrees/` | `dreamy-heyrovsky-07398d`, `mobile-phase0` (locked by pid 10200, which is no longer running) and `nervous-hellman-edabb9`. The sweep leaves them alone by design | Archive those sessions in the Claude app | ☐ |
| worktree-sweep.3 | First sweep run by a skill | Run by hand on 16 Oct, when the user asked for it. Not yet run by ship, promote or close-out, and auto mode has blocked self-proposed worktree removal before | On the next ship, check that `npm run worktrees -- --apply` ran and what it printed | ☐ |

## Closes

- `check-in-banner.7`: on 16 Oct, `../stellr-web-check-in-banner` was removed. Its only untracked file was the `AGENTS.md` that `next dev` generated, and `docs/close-out-check-in-banner` (`2104ee50`) equals the tip of `origin/docs/close-out-check-in-banner` (#425). The local `feat/check-in-banner` (`608247b1`, the head of merged #422) was deleted. `git worktree list` no longer shows either.
