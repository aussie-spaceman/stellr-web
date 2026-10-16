# Handover — Worktree sweep — 16 Oct 2026

Slug `worktree-sweep`. Tracker: `tracker/2026-10-16-worktree-sweep.md`.
Builds on the 13 Oct worktree cleanup (`tracker/2026-10-13-worktree-cleanup.md`, #408/#410).

## Context

David asked why five extra folders sat in `Documents/GitHub` beside the repo, three days after #408/#410 moved every merge in ship, promote and close-out to the main checkout. He asked for the five to be fixed and for the process to be fixed.

What they were:

| Folder | What it was | Why it stayed |
|---|---|---|
| `stellr-web-content-refresh` | worktree, #420 merged | merged from the main checkout, but without `--delete-branch`. The session wrote its own merge commands. |
| `stellr-web-content-refresh-2` | worktree, #421 merged | same |
| `stellr-web-promote-2026-10-15-record` | worktree, #424 merged | same |
| `stellr-web-check-in-banner` | worktree, #425 **open** | The session was worktree-isolated, so the harness refused `cd` and `git -C` to the main checkout. It also blocked `rm` of the untracked `AGENTS.md` that `next dev` writes, and that file blocks an unforced `git worktree remove`. The close-out PR ended on "merge once verify passes?", which nobody answered. |
| the fifth | not a worktree | a separate project folder, left alone (row `.6`) |

GitHub's `delete_branch_on_merge` deleted the remote branches, so on GitHub each merged one looked finished. The underlying flaw was that cleanup only happened as a side effect of one exact command, run from one place, and it failed silently whenever a session did anything else.

## What changed

- **#433 → `dev` (`e169eca5`), promoted in #434 (`ecc65639`).**
  - `scripts/worktree-sweep.mjs`, run as `npm run worktrees` (with `scripts/worktree-sweep.test.ts`, 15 tests). It removes a linked worktree only when all of these hold:
    - a branch is checked out and the worktree is not locked;
    - `git status --porcelain` is empty;
    - a MERGED PR's `headRefOid` equals the tip;
    - no process has its cwd inside the worktree (`lsof`).

    It then runs `git worktree remove` (never `--force`) and `git branch -D`, re-reading the tip just before. Every worktree it keeps is listed with the reason. A fact it can't read never leads to a removal. It never touches `.claude/worktrees/`. It reports by default, and `--apply` exits 2 when run from a linked worktree.
  - Ship Phase 0, promote Step 1 and close-out step 3 run `npm run worktrees -- --apply` first, from the main checkout. Ship Phase 5, promote Step 8 and close-out step 6 run it after their merge, in place of `git worktree list`. Each also says what a worktree-isolated session does instead: report, and leave the worktree to the next sweep.
  - Close-out step 6 says that asking for a close-out is the go-ahead to merge its own docs PR. See row `.4`: this rule can't be followed as written in the desktop app.
  - `.gitignore` gains `/AGENTS.md`.
- **Leftovers removed (16 Oct):**
  - The three merged worktrees were removed by the sweep with `--apply` from the main checkout, along with their local branches.
  - `check-in-banner` was removed by hand. Its close-out branch tip was on origin under #425, and `feat/check-in-banner` equalled merged #422's head.
- **#425 merged** (`7ce0ef19`), at David's request.
- **Promotion 2026-10-16:**
  - #434 was merged into `main` (`ecc65639`). Production deployment `dpl_7kWW5B8X6YjzcYRnhUaeNtiWX79F` is READY and aliased to www.
  - The rollback target is `dpl_t9jBAeGpi7QYYC1txRW53Bkq3wcZ`.
  - The record plus the `main` → `dev` sync is #435 (`5b010889`).
  - No runtime code shipped.

## Verified (and how)

- **Unit tests:** 15 pass. **CI on #433:** after one fix, every `verify` and `e2e` step succeeded. The first run failed only at Typecheck: the `.mjs` parser's return type inferred as `{}`, so the parser now has a JSDoc type.
- **Real runs:**
  - In report mode, the sweep listed exactly the three merged worktrees as `remove`, and it kept the right ones: check-in-banner (untracked `AGENTS.md`), the #433 worktree (in use, which the `lsof` check found) and the three app worktrees.
  - `--apply` removed the three. From a linked worktree it refused, as designed.
  - After the #433, #435 and close-out merges from the main checkout, gh removed each worktree, and the sweep found nothing.
- **Production after #434:**
  - www returns 200, app returns 307 to `/sign-in`, and the cron guard returns 401 `Unauthorized`.
  - The `Vercel – stellr-web` status on `ecc65639` reads success.
  - The alias points at the new deployment.

## Not verified / known limits

- A sweep run by a skill that actually removes something (row `.3`).
- Code paths only unit-tested (row `.5`).
- **Observation, not this session's row:** at 20:0x UTC on 16 Oct, production `/check-in` served "Check-in isn't open yet". On 15 Oct it 307'd to Colorado's form. This promotion carried no runtime code, so the change is in the data. `check-in-banner.1` stays open until a production `event_settings` read confirms it.

## Session review (gaps)

- The ship skill wasn't followed as written for #433. No Phase 1 checklist was shown, and no Phase 4 requirement table was produced; the PR body's "Verified" section stood in for both.
- #433 was pushed before a local `tsc`. "Local checks pass" covered vitest and the PII lint only, and CI caught the type error.
- The rule this session added to close-out step 6 can't be followed in the desktop app (row `.4`).

## Open items

`tracker/2026-10-16-worktree-sweep.md`, rows `worktree-sweep.2` to `.6`.
