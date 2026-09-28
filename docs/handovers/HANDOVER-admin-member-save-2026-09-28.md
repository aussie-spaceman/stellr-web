# Handover: admin member save fix (25–28 Sept 2026)

**Shipped:** #210 → `dev` as `22f5686`. Promoted in #214 → `main` @ `1c74f6b`, 28 Sept 16:01Z. This session opened #214; after the maintainer said yes, **a separate session ran the merge** and folded #215 in. Release record: `.claude/releases/promote-2026-09-25c.md` (Promoted, #217).
**Production:** `dpl_5SPmMPw9p2WG4XMiCfVWA9a4XWfg`, READY (Vercel `list_deployments`, sha `1c74f6b`). Rollback target: `dpl_Bora4pE4JroBdbz3eLVA3MDTHfTp` (`868a178`).
**Tracker:** `TRACKER.md` Session 20. Doc snapshot `1sjjYgozbcup3uM_0dp8v_9Vve2GcbNvKhf8xBlOGdGk`.

## What was asked
"Found a bug when updating member details and trying to select 'save changes'. Investigate and fix." There was a screenshot of David's own record: Adult / Teacher, no grade, with the banner "Save failed. Please try again." Then "ship it", then `/promote`.

## Cause (proven)
The admin form (`components/admin/AdminMemberDetail.tsx`) initialises `grade: member.grade ?? ''`. `PATCH /api/admin/members/[id]` copied body values straight into the update, and `members.grade` is the `grade_type` enum. Production Postgres, 25 Sept 22:11:33Z and 22:11:44Z: `invalid input value for enum grade_type: ""`. So no member without a grade (every Adult) could be saved, whatever field changed.

## Fix
`app/api/admin/members/[id]/route.ts`: `updates[key] = body[key] === '' ? null : body[key]`. This covers the other columns that reject `''` too (`tshirt_size`, `gender`, `date_of_birth`). Cleared text fields now store NULL rather than `''`. The audit diff's `norm()` already treats them as equal, so it logs no false changes.

## Not proven
- **The fix, in use.** It was never exercised in a browser (it needs a signed-in admin). Between the deploy and close-out, production `member_activity_log` had no `profile_updated` rows, and there were no enum errors in `postgres_logs` in the previous 24 h. → 20.1
- **No regression test.** → 20.2

## Found in passing
- **20.3:** On `1c74f6b` the GitHub commit status `Vercel – stellr-web` reads "Canceled by Ignored Build Step", but the production deployment is READY. The promote skill's Step 6 shell check would report no deployment. The likely cause: Step 8 fast-forwards `dev` to the same SHA, and the production project's ignored build of branch `dev` posts the same status context. Trust `list_deployments` with `sha` + `target: production`.
- **20.4:** `PATCH /api/members/me` has the same pass-through (`gender`, `grade`, `tshirt_size` are in its allow-list). `components/member/AccountProfile.tsx` doesn't send those today. Its `handleSave` also ignores the response, so failures there are silent.
- **20.5:** The route returns a bare `"Update failed"`. The UI can't say which field failed, and this diagnosis needed Postgres logs.
- **20.6:** The main checkout `~/Documents/GitHub/stellr-web` is on `dev` @ `513eb16`, 41 commits behind. Its 15 uncommitted files are byte-identical to `origin/dev` (the member-invite work, already shipped).
