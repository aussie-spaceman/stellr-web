---
name: close-out
description: Close out a session in this repo — honest gap review, summary with next steps, Google Doc snapshot, handover, per-session tracker file, memory — and land it on `dev` without colliding with other sessions closing out at the same time. Use when the user says close out, close-out, wrap up the session, or invokes the global close-out skill in this repo.
---

# Close-out (session → handover on `dev`)

The same six steps as the global `close-out` skill, plus the mechanics this repo
needs so that **several sessions can close out at once**. The usual pattern is
parallel sessions → one `promote` → a close-out in each session, all within
minutes of each other.

## Why the mechanics look like this (28 Sept 2026)

Four close-outs ran together and blocked each other:
- Each one inserted its section at the same line of `docs/handovers/TRACKER.md`.
  The second to merge went `DIRTY` (#235).
- Each was numbered "Session N" from whatever was on `dev`, so 21, 22 and 23
  landed out of order. On 15 Sept two sessions both took "Session 6".
- Each docs PR, and each resulting push to `dev`, took a turn in the one
  repo-wide e2e queue. GitHub keeps one pending job per queue, so two runs were
  cancelled and sat blocked.

The fixes: one tracker file per session, IDs from a slug and not a number,
never editing another session's rows, and docs-only changes skipping e2e in CI.

## Steps

### 1. Review the session honestly
- What was directly asked and was missed, skipped or ignored?
- What was treated as done but never done or verified? A merged PR is not a
  deployment, and a green badge is not a passing suite.
- Mid-session corrections outrank the original ask.

### 2. Pick the slug
A short kebab-case name for the session's subject, e.g. `email-reminders`. It
names the branch, the handover file, the tracker file and the row IDs
(`email-reminders.1`). Check it is not already used:
`ls docs/handovers/tracker/ docs/handovers/ | grep <slug>`, plus
`gh pr list --state open`. There is no session number to allocate.

### 3. Work in a fresh worktree from `origin/dev`
```bash
git fetch origin
git worktree add -b docs/close-out-<slug> ../stellr-web-close-out-<slug> origin/dev
```
Never use the main checkout, and never reuse the session's merged feature
branch (ship rule 4). No `npm ci` is needed for a docs-only change.

### 4. Write exactly these files, and nothing else under `docs/handovers/`
- `docs/handovers/HANDOVER-<slug>-YYYY-MM-DD.md` is the package for a future
  session: context, what changed, what is not verified, and the open items with
  their tracker IDs.
- `docs/handovers/tracker/YYYY-MM-DD-<slug>.md` is created from
  `tracker/_TEMPLATE.md` and holds the table (State / Next / Done).
  - **State** is a fact at the time of writing.
  - **Next** is the smallest step that closes the row.
  - **Done** is ☑ only when State says how it was verified.
- If this session **closed another session's row**, list it under `## Closes`
  in your own file with the evidence. **Do not edit `TRACKER.md` or another
  session's tracker file.** Those lines belong to their authors, and editing
  them is what makes concurrent PRs conflict.
- If the session wrote a handover earlier, append a close-out section to it.
  That file is yours.

Summary rules, carried over from the global skill:
- Don't recommend pushing code or smoke tests. The code is assumed deployed,
  and smoke tests are only for high-criticality items.
- If the session never committed or never promoted, say so first.

### 5. Google Doc snapshot
Use the Drive `create_file` call with base64 HTML and `mimeType: text/html`.
The columns are Current state / Recommended next step / Complete. Read the Doc
back to check it, then put its ID in the tracker file's header line. The Doc is
a copy; the repo file is the source.

### 6. Land it on `dev` before reporting done
```bash
git add docs/handovers && git commit -m "Close-out <slug>: handover + tracker"
git push -u origin HEAD
gh pr create --base dev --title "Close-out <slug>: handover + tracker" --body-file <file>
gh pr checks <n> --watch      # docs-only: verify runs, e2e reports "skipped"
gh pr merge <n> --squash --delete-branch
```
- A docs-only PR needs only `verify`, so it runs in parallel with other
  sessions and never waits behind their e2e.
- If `e2e` actually *runs*, you touched something outside `docs/`, `.claude/`
  or root `*.md`. Find out what before merging.
- `--delete-branch` removes the worktree, so push everything first.
- Check `gh pr view <n> --json state` says `MERGED`, and
  `gh pr list --state open --search "close-out"` shows none of yours. A
  handover that is not on `dev` does not exist for the next session.

### 7. Memory
- Write this session's facts as their own memory file(s). Update an existing
  file rather than duplicating one.
- Re-read `MEMORY.md` **immediately before** adding the one index line. Other
  sessions append to it too, and an edit from a stale read either fails or
  duplicates a line.

### 8. Report
Tell the user:
- the gap findings (step 1)
- the tracker IDs and the most important next steps
- the handover path and the merged PR
- the Doc link

For the combined open list across all sessions, point them at `npm run tracker`.
