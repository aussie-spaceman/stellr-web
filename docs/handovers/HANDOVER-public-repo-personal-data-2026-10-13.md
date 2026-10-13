# Handover: personal data in the public repo (13 Oct 2026)

Tracker: `tracker/2026-10-13-public-repo-personal-data.md` (rows `public-repo-personal-data.1–9`).
Related: `docs/REC-git-history-purge-2026-10-05.md` (the deferred video purge).

## Context

`aussie-spaceman/stellr-web` is public. Handovers, tracker files and release
records had been naming real people, students (mostly minors) among them,
along with their contact details and mailbox IDs. David asked for three things:
1. a read-only inventory;
2. a rule for the close-out, ship and promote skills;
3. options for what is already published, with no history rewriting without
   David's approval.

This file follows the rule it describes. **No person is named here.** The
inventory itself, with names, file:line and values, is in the session's Doc
snapshot (private, in Drive), under "People". It is not in the repo.

## What the inventory found

Scope: `docs/` and `.claude/` on `origin/dev` at `9c0df029`. Method:
- `git archive` produced a scratch copy (263 files, 27.7k lines);
- six readers read every file in full;
- all 263 files were confirmed read, and 1,205 of 1,330 rows were
  machine-checked against their stated line;
- a regex pass for emails, credential numbers and draft IDs was cross-checked
  against the readers' output.

- **365 references to real people outside staff, in 45 files.** By kind: names
  203, IDs 58 (member, registration, DocuSign envelope, Clerk), emails 54,
  other 31 (payment, scholarship and refund details, an employer, a
  background-check status), schools 11, Gmail draft IDs 4, credential numbers 3,
  inferred birth year 1.
- **Minors and their families: 204 of those, in 26 files.** That is 11 named
  families, plus 7 more students named in one consent-audit list. The densest
  files:
  - `HANDOVER-docusign-shared-inbox-2026-09-29.md`
  - `HANDOVER-member-delete-clerk-login-2026-09-24.md`
  - `HANDOVER-registration-resume-2026-09-17.md`
  - `PLAN-scholarship-offers-2026-10-02.md` and its handover and tracker
  - `REC-docusign-remediation-2026-09-04.md`
  - `TRACKER.md`
- **Adults:**
  - three mentors with DocuSign envelope IDs, one with a Checkr status;
  - three educators with school, district email and member UUID;
  - university and vendor contacts;
  - testimonial video filenames.
- **Smaller than feared:**
  - No real dates of birth. The DOB-shaped data is Checkr mock candidates.
  - The only phone number is the published privacy line.
  - The two real credential numbers on `dev` at audit time sat next to no name.
- **Fixtures:** 384 rows (Checkr mock candidates, the design-handoff seed, the
  e2e personas). These are believed fictional. Confirm while doing row `.5`.
- **Outside the files:**
  - 20 PR titles and bodies name a member or teacher.
  - Some commit messages on `dev` do too. Commit messages are history, so only
    a purge reaches them.

## What changed

| PR | What | State |
|---|---|---|
| #409 → `dev` `b3c35d5e` | `close-out`: new section "People: the repo is public", with pointers in steps 4 and 5. `ship`: rule 6. `promote`: Step 1 covers the record and the PR body. The section requires role + `members.id`, never a credential number as an ID (`/credentials/<number>` shows the holder's name once public), no mailbox or vendor IDs, care with combinations that identify someone, and names in the Doc. It ends with a pre-push grep. | Promoted in #411 (`d64276d0`), 13 Oct 16:19Z |

How it was checked:
- The pre-push grep prints nothing on #409's diff, commit messages and body.
- The same grep catches the personal emails already in the scholarship plan
  and handover.
- `git merge-tree` against #408 was clean.
- `verify` passed and e2e was skipped (docs-only), per the #411 promotion body.

## Not verified, and gaps

- **The rule is not in force yet** (row `.2`). Project skills load from the
  main checkout, not from a session's worktree. This close-out loaded a
  `close-out` skill with no "People" section, because the main checkout is 15
  commits behind `origin/dev`.
- **#408 published more minor data to `main`** (row `.3`). It merged at
  15:55:34Z, 71 s before #409 was opened. This session had noticed it about ten
  minutes earlier but only mentioned it in a progress note and did not stop for
  a decision. #411 promoted it.
- **Classifications are readers' judgements**, especially whether someone is a
  student or a guardian, and minor or adult. 125 rows (descriptive "other"
  values and short tokens) were not machine-checked to a line. Testimonial
  subjects' ages are unknown.
- **The CI cost figures for option A** come from a sample of 40 runs.
  Per-minute prices were not checked.

## Options for what is already published (the decision is David's)

| | Option | Effect | Cost |
|---|---|---|---|
| A | Make the repo private | Stops all exposure at once: files, history, `refs/pull`, PR bodies. Reversible. Copies third parties already took are out of reach. | GitHub Free private repos get no branch protection or rulesets, so it needs Pro. CI is about 6,500 min/month against Pro's 3,000 included. |
| B | Redact going forward | Clean tree and PR bodies; SHAs untouched. | One docs PR plus PR-body edits. History still holds it. |
| C | `git filter-repo` purge | Clears history; `refs/pull/*` only after GitHub Support acts. | Breaks the 271 SHAs cited in docs, including rollback targets. Every clone must be re-cloned. |

**Recommended: A, then B. C only on a request,** bundled with the video purge so SHAs change once.

## Open items

See the tracker file. In short:
1. `.2`: fast-forward the main checkout so the rule is in force.
2. `.3`: redact #408's three files.
3. `.4`: David decides A.
4. `.5`: B.
5. `.6`: C only on request.
6. `.7`: the `lint:pii` CI guard, started in a separate session.
