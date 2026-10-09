# Security hotfix B — 9 Oct 2026

Fixes the remaining two Critical findings from the deep review: C-3 (anonymous
member overwrite) and C-5 (a minor's consent reused for a sibling). Finding
detail is in the local-only `code-review-report.md`.

Branch: `fix/security-hotfix-b` → `dev`. **Stacked on hotfix A (#346):** this
branch was cut from A's tip because C-3 edits the same registration files. The
two review-relevant commits are `C-3` and `C-5`; the first commit is A.
**Merge A (#346) first**, then this branch is updated onto `dev`.

## C-3 — anonymous callers must never modify an existing member (REG-2 + PUB-1)

The public registration, join-link and teacher-grant endpoints matched members
by email and PATCHed every submitted field onto an existing row — so an
anonymous POST naming someone else's email could rewrite their DOB, emergency/
guardian contact, role, age bracket and active flag. For a minor that turned off
the no-ads/minor protections and could redirect the next consent envelope.

- `lib/member-sync.ts`: `upsertMember(db, input, { onExisting })`. `'skip'` (for
  untrusted callers) returns the existing id and writes nothing; a brand-new
  email is still created. Default `'update'` keeps trusted callers (admin sheet
  sync, signed-in self-edit) unchanged.
- `register/group-join` + `teacher-grant`: pass `onExisting: 'skip'`.
  teacher-grant also runs its school-link and base-membership grant only when it
  created the member.
- `register/individual`: writes the members row only when it is new or the
  signed-in caller owns it (email is derived from the session). School link and
  ethnicity/dietary sync gated the same way.
- `register/group`: inserts new members only (`ON CONFLICT DO NOTHING`); existing
  emails are mapped to their id and left untouched; option sync restricted to
  newly-created members.

The submitted details always still land on the participant/registration rows for
staff to review — only the canonical `members` row is protected.

## C-5 — a minor's consent is reused only for the same child (DS-1 + DS-2)

- **DS-1** (`lib/docusign-agreements.ts`): `findValidAgreement` now filters a
  minor agreement on the stored `minor_name`, so a second child sharing the
  family email no longer inherits the first child's signed form — a guardian is
  actually asked to consent for them. A name mismatch errs toward issuing a fresh
  envelope (the safe direction). No schema change.
- **DS-2** (`register/group`): inserted participants are paired back to source
  rows by position instead of by email, so siblings sharing the family email get
  distinct participant ids (previously one child's row got no agreement and the
  other was dispatched twice).

## Tests

- `lib/member-sync.test.ts`: `onExisting:'skip'` writes nothing for an existing
  member, still creates a new one; default still updates. Mutation-checked.
- `app/api/teacher-grant/route.test.ts`: an existing member is not modified and
  the grant/side-effects are skipped. (The supabase mock now returns a chain.)
- `lib/docusign-agreements.test.ts`: a sibling's minor form is NOT reused; the
  same child's IS. Mutation-checked.
- Full gate green: `tsc`, `lint:tokens`, `lint:migrations`, 1,534 unit tests,
  `next build`.

**Test gap:** DS-2 is a group-route change without a dedicated unit test (the
route is a single large handler). It is covered functionally by the existing
registration e2e; a sibling-registration e2e is a recommended follow-up (aligns
with TEST-8).

## No migration

Batch B is code-only. No production database change.

## Still open (not in this PR)

The High findings (batches C–E): safeguarding (BG-2/3, MEM-3/4/9/10, ES-1/2),
privacy (MP-1/2, MEM-1/2), email/abuse (PUB-2/4, INT-1/3), and payments
(PAY-2/3/4/6, C-7). PAY-3 (renewals ignored on the `dahlia` webhook version) is
worth prioritising.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
