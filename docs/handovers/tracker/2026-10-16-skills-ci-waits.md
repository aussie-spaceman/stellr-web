# Skills: CI waits in the desktop app — 2026-10-16

Slug: `skills-ci-waits`. Handover: `HANDOVER-skills-ci-waits-2026-10-16.md`. Doc snapshot: `1xzbUdEmEY8NwNdUSQenqkPwd1mikw6XQIPVAwii29DM`.
PR #440 → `dev` as `77f04c45`; in promotion #441 (open at close-out). Migration: none.

ship, promote and close-out now say how to wait on CI in the Claude desktop app's Code tab, which forbids polling. Read the checks once; if they are pending, end the turn on one "CI finished" button whose message carries the next command (ship Phase 3, promote Steps 5 and 8, close-out step 6). Each skill also starts with a stranded-PR check that lists the close-out and promotion-record PRs still open against `dev` (ship Phase 0, promote Step 1, close-out step 3).

| # | Item | State | Next | Done |
|---|---|---|---|---|
| skills-ci-waits.1 | The "CI finished" wait, followed from a skill | #440's own wait followed the rule from the brief that asked for it: one read, one button, every step read on the click, then the merge. The main checkout was fast-forwarded to `77f04c45` on 16 Oct, so this session's close-out is the first run of the text loaded as a skill | Check that this close-out's PR, or the next ship, promote or close-out, read the checks once, ended on one button and read every step before merging | ☐ |
| skills-ci-waits.2 | #440 not yet promoted | It rides in #441 (`dev` → `main`), opened at 21:54 UTC on 16 Oct by another session, e2e running at close-out. Skills load from the main checkout on `dev`, so the promotion changes no behaviour | None from this session: #441's promoter merges it | ☐ |
| skills-ci-waits.3 | This session's app worktree | `.claude/worktrees/busy-meitner-4bda1f` stays: the sweep leaves app-managed worktrees alone | Archive this session in the Claude app once the close-out has merged | ☐ |
| skills-ci-waits.4 | Merging into `dev` restarts an open promotion's CI | `ci.yml` has `concurrency: ci-${{ github.ref }}`, `cancel-in-progress: true`. A merge into `dev` moves an open promotion PR's head, so its running checks, e2e included, are cancelled and start again. The skills don't say so. This close-out waited for #441 for that reason | Add a line to close-out step 6 and ship Phase 5: if `gh pr list --base main --head dev --state open` shows a promotion, merge after it | ☐ |

## Closes

- `worktree-sweep.4`: ship Phase 3 now says how to wait on CI in the desktop app: read the checks once; if they are pending, end the turn on one "CI finished" button whose message carries the next command; on the click, read every step's outcome before merging. promote Steps 5 and 8 and close-out step 6 point to it, each with its own message. promote Step 5's click resumes the CI read only, so Step 6 still asks. close-out step 6 keeps "asking for a close-out is the go-ahead to merge its own docs PR" and rules out the yes/no merge question, with #425 as the WHY. The stranded-PR check sits beside `npm run worktrees -- --apply` in ship Phase 0, promote Step 1 and close-out step 3. Its exact command was run against the live repo on 16 Oct and listed `#438 Close-out worktree-sweep: handover + tracker`. Of the close-out and record PRs ever opened against `dev`, it misses only #89, #95 and #155, all from September, before the skills set those titles. The two step-outcome commands were run against #438's CI and printed every `verify` step as `success`.
