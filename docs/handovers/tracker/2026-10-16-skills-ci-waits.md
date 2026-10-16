# Skills: CI waits in the desktop app — 2026-10-16

Slug: `skills-ci-waits`. Handover: none; the PR #440 body is the record. Doc snapshot: none.
PR #440 → `dev`. Migration: none.

ship, promote and close-out now say how to wait on CI in the Claude desktop app's Code tab, which forbids polling. Read the checks once; if they are pending, end the turn on one "CI finished" button whose message carries the next command (ship Phase 3, promote Steps 5 and 8, close-out step 6). Each skill also starts with a stranded-PR check that lists the close-out and promotion-record PRs still open against `dev` (ship Phase 0, promote Step 1, close-out step 3).

| # | Item | State | Next | Done |
|---|---|---|---|---|
| skills-ci-waits.1 | The "CI finished" wait, followed from a skill | New text. This PR's own wait followed it from the brief that asked for it, not from a loaded skill. Skills load from the main checkout, so the text applies once that checkout is fast-forwarded past this PR | On the next ship, promote or close-out in the app, check the session read the checks once, ended on the one button, and read every step's outcome before merging | ☐ |

## Closes

- `worktree-sweep.4`: ship Phase 3 now says how to wait on CI in the desktop app: read the checks once; if they are pending, end the turn on one "CI finished" button whose message carries the next command; on the click, read every step's outcome before merging. promote Steps 5 and 8 and close-out step 6 point to it, each with its own message. promote Step 5's click resumes the CI read only, so Step 6 still asks. close-out step 6 keeps "asking for a close-out is the go-ahead to merge its own docs PR" and rules out the yes/no merge question, with #425 as the WHY. The stranded-PR check sits beside `npm run worktrees -- --apply` in ship Phase 0, promote Step 1 and close-out step 3. Its exact command was run against the live repo on 16 Oct and listed `#438 Close-out worktree-sweep: handover + tracker`. Of the close-out and record PRs ever opened against `dev`, it misses only #89, #95 and #155, all from September, before the skills set those titles. The two step-outcome commands were run against #438's CI and printed every `verify` step as `success`.
