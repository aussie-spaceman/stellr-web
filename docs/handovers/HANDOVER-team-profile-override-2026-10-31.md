# Handover: team profile override for Auto-Assign (30–31 Oct 2026)

Tracker: `docs/handovers/tracker/2026-10-31-team-profile-override.md` (rows `team-profile-override.1–.6`). No member is involved, so there is nothing for the Doc beyond the table.

**Live.** #494 went to `dev` as `6e014a47`. It was promoted 31 Oct in #492 (merge `1acd2721`, deployment `dpl_GeYNKcYMN3Mkgdqi63ZSg4mQnGtp`), together with #491, #490 and #486. The release record is `.claude/releases/promote-2026-10-30c.md` (#496). **Nobody has used it signed in yet, on dev or on production** (`.1`).

## Why

Auto-Assign placed only students who had submitted a team profile, and pooled everyone else as unassigned. At an event where few students had answered, there was nothing to balance, so companies had to be filled by hand. David asked for a way to override the requirement when profiles haven't been submitted, with an "Overridden" pill on those students.

## Owner decisions (30 Oct, David)

I asked four questions, and David chose the recommended option each time:

1. **Both ways.** An Override / Undo override button on each row of Roster → Team profiles, plus an **Override all not submitted** button.
2. **Anyone not submitted is eligible**, including students still on "Waiting on forms" (no permission form yet, so no team profile email).
3. **Submitted wins; emails continue.** Overridden students still get the team profile email and reminders. Once one submits, the pill reads Submitted and the next Auto-Assign uses their answers. The override columns stay set but are ignored.
4. **The pill replaces the status.** "Overridden" stands in for Sent / Not sent / Waiting on forms. The underlying status, then "by <staff name> · <date>", sit beneath it.

## What shipped

### Data

Migration `20261030212236_team_profile_override` adds three nullable columns to `participants`:
- `team_profile_overridden_at` (timestamptz);
- `team_profile_overridden_by` (the staff member's Clerk user id);
- `team_profile_overridden_by_name` (display name, else email).

They are on the participant, not `team_profiles`, because a student waiting on forms has no `team_profiles` row yet. The migration was applied to dev on 30 Oct and to production on 31 Oct with David's yes. Both times the MCP tool recorded its own timestamp, and the ledger row was realigned to the filename. `db:status` on both lists it as applied.

### Logic

- `lib/team-profile/override.ts`:
  - `overrideFields(actor)` and `CLEARED_OVERRIDE` give the column values.
  - `overrideOutstanding(db, slug, actor)` is the bulk override. It skips withdrawn registrations, non-student roles (`STUDENT_ROLES`), students already overridden and students who submitted. It updates in chunks of 150.
- `lib/team-profile/assign.ts`:
  - `PlanningStudent.overridden` is `{ at, by } | null`, and is null whenever the student has submitted.
  - `autoAssignGroups()` splits students three ways: **locked** (hand-placed, kept), **placed** (submitted or overridden) and **pool** (the rest).
  - Overridden students are balanced on age, school, experience, gender and ethnicity, which come from the registration. They have no skills or leadership answers. The group and hand-placement rules are unchanged.
  - `AutoAssignResult` gains `overridden`.
  - With no one to place, the error is "No students to place yet: none have submitted a team profile or been overridden".

### Routes

`POST /api/admin/events/[slug]/companies`:
- `{ action: 'override', participantId, overridden: boolean }`:
  - It is scoped to the event the same way `move` is (AUTH-3: `registrations!inner(event_slug)`), so a participant from another event gets a 404.
  - It returns 409 "They’ve already submitted a team profile." when overriding someone who submitted.
  - `overridden: false` clears all three columns.
- `{ action: 'override_all' }` returns `{ ok, overridden }`, the count changed.

None of this route's actions write to the activity log, so override follows suit. Who overrode a student is kept on the row, and an undo clears it.

### UI

- `components/admin/EventTeamProfiles.tsx`:
  - The "Overridden" pill (`bg-primary-soft text-primary-deep`) with its two sub-lines.
  - An "Overridden" filter option, and the overridden count in the header.
  - Per-row Override / Undo override, shown only when the student hasn't submitted.
  - "Override all not submitted", behind a confirm.
  - After an undo on a student already in a company, the message says they stay in it until Auto-Assign runs again.
- `components/admin/EventCompanies.tsx`: the Auto-Assign confirm now says students "submitted a team profile or been overridden". The result reads "Placed N students (A with team profiles, B overridden)…" and points at Team profiles for overrides.
- `docs/RUNBOOK-event-check-in.md`: "Before the day" step 1 mentions Override / Override all not submitted.

### Tests

- `lib/team-profile/override.test.ts` covers `overrideFields`, `overrideOutstanding` and its skips, and `autoAssignGroups`.
- `components/admin/EventTeamProfiles.test.tsx` has 6 tests: the pill, its sub-lines and the requests the buttons send.
- `app/api/admin/events/[slug]/companies/route.test.ts` adds 6 override tests: AUTH-3 scoping, the actor recorded, 409 once submitted, undo, bad body and 403.
- The Storybook story `Admin/Event team profiles` gains an overridden student, using a fictional fixture.

## What was verified, and how

- **CI:** every step of `verify` and `e2e` succeeded on `ea67e43b` (the PR head) and on `6e014a47` (the promotion head), in both the `push` and `pull_request` runs.
- **Dev database**, with the real lib code against Nevada's three dev test students. The data was restored afterwards (0 companies, 0 rows changed, read back in SQL):
  - With no overrides, Auto-Assign is refused.
  - `override_all` overrides 3; a second run overrides 0.
  - Auto-Assign then returns `{ assigned: 3, overridden: 3, pooled: 0, kept: 0 }`.
  - After one undo, it returns `{ assigned: 2, overridden: 2, pooled: 1 }`.
- **Production, 31 Oct:**
  - The deployment is READY and aliased.
  - www returns 200, app returns 307 to `/sign-in`, and the cron guard returns 401.
  - The build log shows Node 24.x.
  - No runtime errors appeared after the deploy.
  - The three columns and the comment were read back after the apply.

## Not verified

- **No signed-in click-through, anywhere** (`.1`). The local admin session saved in `e2e/.auth` had expired, and I did not sign in to Clerk without permission. The panel was seen only in Storybook and the component test. The HTTP route was exercised only by unit tests; the dev-database run called the lib functions directly.
- **No e2e spec** covers override (`.3`).
- **The Auto-Assign result message** in `EventCompanies` has no component test and has never been seen rendered.

## Production state, 31 Oct

Nevada Space Design Challenge (6 Nov) on production: 10 participants, 9 of them students, none withdrawn. 2 team profiles have been submitted, 0 students are overridden, and 1 company exists. With no overrides, Auto-Assign would place 2 students and pool the rest, which is the case this feature exists for.

## Related

- `team-profiles.4` (a real Auto-Assign run with team profiles) stays open. The dev run here used overrides only, with no submitted profiles.
- `team-profiles.3` (the signed-in Team profiles panel) stays open; `.1` here covers the same ground for the override.
