# Handover — Skills: CI waits in the desktop app — 16 Oct 2026

Slug `skills-ci-waits`. Tracker: `tracker/2026-10-16-skills-ci-waits.md`.
The worktree-sweep session started this one to close its row `worktree-sweep.4` (`HANDOVER-worktree-sweep-2026-10-16.md`).

## Context

ship Phase 3, promote Steps 5 and 8 and close-out step 6 each said to run `gh pr checks <n> --watch`. The Claude desktop app's Code tab forbids polling CI: no `--watch`, no `gh` loop, no Monitor, ScheduleWakeup, cron or `/loop`. So in the app those lines could not be followed. On 16 Oct the worktree-sweep session ended three turns on "has CI finished?", with nothing in the skills saying that was the way to wait. Close-out step 6 also said "do not end the turn on 'merge #n once verify passes?'", which in the app read as a ban on ending the turn at all. And a docs PR that an earlier session left open (#425, for a day) was found only because a session went looking for leftover worktrees.

## What changed

**#440 → `dev` as `77f04c45`**, squash-merged from the main checkout on 16 Oct. Only the three skills and this session's tracker file changed.

- **ship Phase 3** holds the whole rule for the desktop app:
  1. Read the checks once (`gh pr checks <n>`).
  2. If any are pending, end the turn on the next-step box with exactly one button, "CI finished". Its message carries the next command, so the click resumes the sequence.
  3. On the click, read every step's outcome before anything else. The two commands are `gh pr checks <n> --json name,state,link` and `gh run view <run-id> --json jobs`, both tested against #438 and #440.
- **promote Step 5**: the click resumes the CI read only. Step 6's confirmation is still its own question (rule 1).
- **promote Step 8 and close-out step 6**: the click resumes the merge (`--merge` for the record PR, `--squash` for a close-out), run from the main checkout.
- **close-out step 6** keeps "asking for a close-out is the go-ahead to merge its own docs PR". What it rules out is now named: a yes/no merge question, not the button. The 15 Oct #425 story stays as the WHY.
- **Stranded-PR check**, beside `npm run worktrees -- --apply` in ship Phase 0, promote Step 1 and close-out step 3. It runs `gh pr list --state open --base dev` and keeps titles starting `Close-out` or `Promotion record`. Each PR it lists is reported to the user and is not merged without their say-so. In ship it runs even when Phase 0's worktree step is skipped.

The check was run against the live repo before it went into the skills, and it listed #438, open at the time. Of every close-out and record PR opened against `dev` (matched by branch name), the title filter misses only #89, #95 and #155. All three are from September, before the skills fixed those titles.

## How this session ran (useful next time)

- The work was in a sibling worktree (`../stellr-web-skills-ci-waits`), not the app's own worktree. Run from the main checkout, `gh pr merge --delete-branch` removes whichever worktree holds the branch, and here that would have been the directory the session runs in. gh removed the sibling worktree and its branch, and the sweep afterwards listed only app-managed worktrees.
- This app session was not worktree-isolated: `cd` to the main checkout, `git worktree add`, the sweep with `--apply` and `gh pr merge` all ran.
- #440's own wait used the new rule: one read, one "CI finished" button, then on the click every step's outcome, then the merge. The box shows a button only with a question (`ask`), so the question was "Tell me when CI on #440 has finished."
- **This close-out PR was held until promotion #441 merged.** `ci.yml` runs with `concurrency: ci-${{ github.ref }}` and `cancel-in-progress: true`. A merge into `dev` moves an open promotion PR's head, which cancels its running checks (e2e included, because a promotion's diff is not docs-only) and starts them again. #441 was opened at 21:54 UTC with e2e running when this close-out began. The skills don't mention this yet (row `.4`).

## Not verified

- **The new text, followed from a loaded skill.** Skills load from the main checkout, which was fast-forwarded to `77f04c45` on 16 Oct. This close-out is the first run of the text loaded as a skill (row `.1`).
- **gh removing an app worktree.** I warned David that merging #437 with `--delete-branch` from the main checkout would remove the image session's app worktree, because that worktree had the branch checked out. That comes from gh's source (`deleteLocalBranch`) and was not tried. #437 merged as `590599c7`. Afterwards the worktree was still there, on a close-out branch.
- **Promotion.** This session did not promote. #440 rides in #441 (`dev` → `main`), which another session opened and which was open when this was written (row `.2`). Skills load from the main checkout on `dev`, so the promotion changes no behaviour for #440.

## Open items

| ID | Item | Next |
|---|---|---|
| `skills-ci-waits.1` | New text followed from a loaded skill | Check that this close-out, or the next ship, promote or close-out, read the checks once, ended on one button and read every step before merging |
| `skills-ci-waits.2` | #440 not yet promoted | None from this session: #441's promoter merges it |
| `skills-ci-waits.3` | This session's app worktree `.claude/worktrees/busy-meitner-4bda1f` | Archive this session in the Claude app once the close-out has merged |
| `skills-ci-waits.4` | Merging into `dev` restarts an open promotion's CI | Add a line to close-out step 6 (and ship Phase 5): if `gh pr list --base main --head dev --state open` shows a promotion, merge after it |
