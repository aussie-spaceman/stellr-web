# Training audience (volunteers & mentors) — 2026-11-04

Slug: `training-audience`. Handover: `HANDOVER-training-audience-2026-11-04.md`. Doc snapshot: `11SlfbKtYuBKM40jin-NWme83C0er_37J-YZ_GjzuYuQ` (names for `.4` are there).
PR #513 → `dev` as `bcc1aa28`; not promoted (a separate session will promote). Migration: `20261104181312_course_assignment_audience` — applied to dev, not to prod.

Event course assignments gained a "Who it's for" audience (Everyone / Students / Volunteers & mentors), read from the event roster's `cohort_members.relationship`; Event training tracking and reminders now include the event's Volunteers panel.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| training-audience.1 | Prod migration `20261104181312` | Not applied to prod. New code selects `course_object_assignments.audience`, so code without the column errors. | Promote applies it to prod **before** merging to `main`, then re-reads the ledger by name. | ☐ |
| training-audience.2 | Promote #513 | On `dev` only. | Promote session (owner said it runs separately). | ☐ |
| training-audience.3 | **HIGH — prod `object_type_relations` event → course** | Unchecked. On dev the table is empty, so every course → Object attach returns 403. If prod is the same, no course can be attached to Nevada at all. | Owner runs `select allowed from object_type_relations where from_type='event' and to_type='course';` on prod; expect one row `true`. If missing, restore migration 125's seed row (owner's yes). | ☐ |
| training-audience.4 | **HIGH — Nevada mentor training** | Not set up. Two volunteer mentors (names in the Doc) need a mandatory course before Nevada (6 Nov). Owner records the video. | Both on Nevada's Volunteers panel; course with a Video lesson; assign to Nevada with Volunteers & mentors + Mandatory + deadline (after promote), or the tier workaround (default N/A, Subscriber + Alumni Mandatory) before it; check with view-as. | ☐ |
| training-audience.5 | Dev `object_type_relations` empty | Verified 4 Nov: zero rows on dev. Migration 125 seeds 49. Cause unknown. | Find what emptied it, then restore 125's seed on dev. | ☐ |
| training-audience.6 | Builder hides a refused attach | Picking an Object whose attach returns 403 does nothing and shows no error (seen on dev). | Show the API's error in `ObjectAssignments.addObject`. | ☐ |
| training-audience.7 | Volunteer's own course list unproven | Logic proven by unit tests and a read-only dev script (volunteer → volunteers course yes, students course no; participant the reverse). Not seen signed in as a volunteer. | View-as a volunteer on an event with a volunteers-only course. | ☐ |
| training-audience.8 | Reminder to a volunteer unproven | Code + typecheck only. | Read the first reminder run after a volunteers-only course's due window (`cron_runs`, notifications). | ☐ |
| training-audience.9 | Dev deployment of `bcc1aa28` | Vercel `dpl_D2LeoiVp4DMNKQMfjSu9f9uApSS8` was BUILDING at close-out. | `list_deployments` by sha → READY. | ☐ |
| training-audience.10 | Role spaces vs the course picker | Seeded spaces (Mentors' Room, tier spaces) have no `mentoring_cohorts` container, so they never appear in the picker; even with one, a space assignment reaches only container members, not role holders. Not changed. | Decide: backfill containers and count role/tier holders as members, or hide those spaces from the picker. | ☐ |
| training-audience.11 | Campaign → course disallowed | Migration 125 seed sets `campaign → course = false`, so the audience control only matters for competitions. | Owner decides whether campaigns should take courses. | ☐ |
| training-audience.12 | osv-scanner red on every PR | 3 Medium advisories in `deepmerge`, `glob`, `minimatch` (not required; also failing on #512). Advisories newer than dev's last green scan. | Bump the three packages in a deps PR. | ☐ |
| training-audience.13 | Event tracking ignores the tier grid | Pre-existing: tracking counts a course for everyone in its audience if it is mandatory for any tier, so a tier set to N/A still shows "not started". | Apply `effectiveRequirement` per person in `computeTracking`. | ☐ |
