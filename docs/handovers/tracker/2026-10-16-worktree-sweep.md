# Worktree sweep — 2026-10-16

Slug: `worktree-sweep`. Handover: `HANDOVER-worktree-sweep-2026-10-16.md`. Doc snapshot: `1A6Ml5J68k4Kql2y0xVI2F0M_AArJbUrNF18LPk49KzE`.
PR #433 → `dev` as `e169eca5`; promoted in #434 (`ecc65639`, record #435). Migration: none.

`npm run worktrees` (`scripts/worktree-sweep.mjs`) removes a linked worktree only when its branch tip is a merged PR's head, its tree is clean, and no process is using it. It explains every one it keeps. ship, promote and close-out run it with `--apply` from the main checkout at the start and after their merge. It removed the 14–15 Oct leftovers of #420, #421 and #424.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| worktree-sweep.1 | Land the check-in-banner close-out | #425 merged into `dev` on 16 Oct as `7ce0ef19` (`gh pr view` reads MERGED, every verify step succeeded) and was promoted in #434 | — | ☑ |
| worktree-sweep.2 | Three app-managed worktrees in `.claude/worktrees/` | At close-out (16 Oct): `dreamy-heyrovsky-07398d` has `claude/modest-dewdney-98d13a` checked out, and `nervous-hellman-edabb9` has `claude/youthful-kare-5ee1b6`, so their sessions may be in use. `mobile-phase0` is detached and its stale lock is gone. The sweep leaves all three alone by design | Archive the idle ones in the Claude app | ☐ |
| worktree-sweep.3 | A sweep that removes something, run by a skill | promote Steps 1 and 8 and close-out step 3 ran `npm run worktrees -- --apply` on 16 Oct, and auto mode allowed it. Each run had nothing to remove (gh had already removed the record worktree). The only removals so far were run by hand, at the user's request | The next time a skill's sweep lists a `remove` row, check that it ran and what it printed | ☐ |
| worktree-sweep.4 | "Don't end the turn on a merge question" can't be followed in the desktop app | close-out step 6 now says to wait on `gh pr checks --watch` and merge. The desktop app's Code tab forbids polling CI, so this session ended three turns on "has CI finished?". A stranded docs PR (as #425 was) is again possible | Reword ship, promote and close-out: in the app, end the turn with a button that resumes the merge. Add a check at the start of each skill that lists open close-out and record PRs | ☐ |
| worktree-sweep.5 | Sweep paths covered only by unit tests | `prune`, `locked`, "branch moved since the check", "`git worktree remove` refused" and "lsof unavailable" have never run for real | Read the output the first time one occurs; no action until then | ☐ |
| worktree-sweep.6 | A project folder beside the repo has no version control | Seen 16 Oct: one of the five folders was not a worktree but a separate deployed project that is not a git repo, so its source has no history and no copy off this Mac. Details in the Doc | David decides: `git init` and push to a private repo, or move it out of `Documents/GitHub` | ☐ |

## Closes

- `check-in-banner.7`: on 16 Oct, `../stellr-web-check-in-banner` was removed. Its only untracked file was the `AGENTS.md` that `next dev` generated, and `docs/close-out-check-in-banner` (`2104ee50`) equals the tip of `origin/docs/close-out-check-in-banner` (#425). The local `feat/check-in-banner` (`608247b1`, the head of merged #422) was deleted. `git worktree list` no longer shows either.
