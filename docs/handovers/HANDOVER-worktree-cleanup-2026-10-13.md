# Handover: worktree cleanup (13 Oct 2026)

Tracker: `tracker/2026-10-13-worktree-cleanup.md` (rows `worktree-cleanup.1–6`).
Related: `tracker/2026-10-13-public-repo-personal-data.md` (row `.3` holds this session's worst gap), `tracker/2026-10-07-credential-family-link.md` (rescued here).

## Context

David asked why so many `stellr-web-*` worktrees were left in `~/Documents/GitHub` after ship, promote and close-out. Twelve were listed besides the main checkout. Nine of them were leftovers: six close-outs, one promotion record and one ship worktree, all from merged PRs, plus one close-out that had never been committed. A tenth, today's first promotion record (`-1013`), was removed by its own session once #406 merged. The rest were app session worktrees.

**Cause.** `gh pr merge --delete-branch` (gh v2.100.0, `deleteLocalBranch` in `pkg/cmd/pr/merge/merge.go`) does different things depending on where it runs:

| Where it runs | What it does |
|---|---|
| Main checkout, with the branch in a linked worktree | An unforced `git worktree remove`, then `git branch -D`, then deletes the remote branch |
| Inside that worktree | Deletes only the remote branch, and prints "skipping local delete" |
| With `--repo`/`-R` | Never touches local branches |

Close-out step 6 and promote Step 8 merged from inside their worktrees, and close-out's text claimed `--delete-branch` removed the worktree. Neither skill had a removal step. Ship had one, but it was skipped once (#212). Promote's record worktree used a fixed path, so the 6 Oct one blocked 13 Oct's, which then went to `-1013`.

Because the removal is unforced, a worktree holding untracked or modified files is left in place. Ignored files (`node_modules`, `.next`, `.env.local`) do not block it; this was tested on git 2.54 in a scratch repo.

## What changed

| PR | What | State |
|---|---|---|
| #408 → `dev` `49d688ed` | An explicit removal step in all three skills; a dated promote record path; the rescue (below) | Promoted in #411 |
| #410 → `dev` `faa46974` | Corrects #408. The skills now `cd ../stellr-web` before `gh pr merge`, and manual removal is the fallback | Promoted in #411 |
| #411 → `main` `d64276d0` | Promotion of #408, #409 and #410 | `dpl_DQgcPWPXxUkotRJUMcyJDZHvVmEx`, Ready, smoke-checked |
| #412 → `dev` | Record `promote-2026-10-13b.md` + sync | Merged |
| #407, #413, #415 → `dev` | Other sessions' PRs, merged at David's request ("merge everything on dev") | Merged |
| #416 → `main` `cb7aa7d6` | Promotion of `lint:pii` (#414, #415) and the #407 and #413 handovers | `dpl_rwdHtVjizUyhfvU2Uqj9rFg8tpVh`, Ready, smoke-checked |
| #418 → `dev` | Record `promote-2026-10-13c.md` + sync | Merged; the first docs PR through the new PII lint in CI |

**Rescue.** `.claude/worktrees/close-out-credential-family-link` held the 7 Oct close-out for #312, written but never committed: the handover, the tracker file, and the record of the #315 promotion. #408 landed all three as written, each with a "Rescued 13 Oct" note. The #315 record's Status was corrected from `gh pr view 315`. That record is named `promote-2026-10-07-pr315.md`, because #318 had already taken `promote-2026-10-07.md`.

**Cleanup.** All nine leftovers were removed after checking each one: status clean, and tip equal to its merged PR's head. The main checkout was fast-forwarded twice; it had fallen 15 commits behind, which meant `/promote` loaded a stale copy of the skill.

## Not verified / gaps

- **This session wrote a wrong claim into memory and into #408** ("gh never removes worktrees") before checking. It reasoned from eight leftovers without asking where those merges had run. #408's own merge, run from the main checkout, disproved the claim. #410 fixed it within the hour, and both were promoted together, so the wrong text never ran in a promote or close-out.
- **#408 published minors' family details** by landing the rescued files as written. This happened before #409's rule existed, and this session did not check the content against the people in it before pushing. Tracked as `public-repo-personal-data.3`, which waits on David.
- **The allow rules were not added.** Auto mode refused the settings edit (row `.5`).
- **The idle app sessions were not archived** (row `.6`).
- The rescued `credential-family-link.1`–`.7` rows were not re-checked. Their States are as of 7 Oct.

## Session notes

- Auto mode refused `git worktree remove` + `git branch -D` the first time, even after the clean and head checks. It allowed the same command once David asked for it directly ("let's get rid of the 8 worktrees").
- Two sessions wrote memory files with the same name, `skills-load-from-main-checkout.md`, within minutes of each other, and the later write won. Their content matched.
- `/promote` was called with "409 and 401". #401 was already in production (12 Oct), so it was read as #410, and the PR body says so.
