# Handover — Training audience (volunteers & mentors), 4 Nov 2026

Tracker: `tracker/2026-11-04-training-audience.md` (rows `training-audience.1`–`.13`).

**Not promoted.** PR #513 squash-merged to `dev` as `bcc1aa28`. Production has neither the code nor the migration. The owner will promote in a separate session.

## Context

The owner set up mandatory training for the first time: two volunteer mentors at the Nevada event (6 Nov) need a recorded video course. Two blockers:

1. **The Mentors' Room space was missing from the course builder's Object picker.** The picker lists `mentoring_cohorts` containers (`lib/training-admin.ts` `listTrainableObjects`), not `community_spaces`. Spaces created in admin get a container (`ensureSpaceContainer`); the role and tier spaces seeded by migration 125 never did. Even with a container, a space assignment reaches only `cohort_members` of that container (`lib/training-portal.ts` `memberCohorts`), and role-space access comes from `community_space_roles`, so role holders would still not receive the course. **Not changed** — see `.10`.
2. **No "mentor" in the assignment permissions.** The grid is membership tiers only; mentor is a role. Tier is a poor proxy (a mentor and a student can share a tier; a tierless student falls through to the default).

Investigation also found that **Event training tracking and deadline reminders only ever looked at registered students**, so volunteers could never appear or be reminded.

### The four "who is this person" fields

| Field | Who sets it | Used by training? |
|---|---|---|
| `members.age_bracket` | member at sign-up | No (gates allowed roles, consent) |
| `members.event_role` | member at sign-up (self-chosen) | No (legacy `training_assignments` only) |
| Membership tier | membership rules / admin | Yes — the requirement grid |
| Event roster (`cohort_members.relationship` on the event's `event_participation` containers) | admin (Volunteers panel) or registration | Yes — which events, and now the audience |

The audience deliberately reads the roster, never `event_role`: a self-chosen role is not vetting.

## What changed (#513)

- **Migration `20261104181312_course_assignment_audience`:** `course_object_assignments.audience text not null default 'all'`, check `('all','participants','volunteers')`, grant restated. Default keeps existing behaviour.
- **`lib/training-audience.ts`** (new): `audienceIncludes`, `memberEventRelationships`, `eventVolunteers`, `objectUsesAudience` (events and campaigns only).
- **Course builder** (`components/admin/training/ObjectAssignments.tsx`): "Who it's for" control on competition/campaign assignments.
- **Admin API** (`app/api/admin/training/assignments/route.ts`): POST/PATCH take `audience`; forced to `all` for other Object types.
- **Member course list** (`getAssignedCourses`) and **teacher group matrix** honour the audience.
- **Event training tracking** (`getObjectTracking`): adds the Volunteers panel as group "Volunteers"; each person scored only on courses whose audience includes them. Legacy `training_assignments` rows stay student-only.
- **Reminders** (`lib/training-reminders.ts` pass 2): volunteers reminded for their courses; students skipped for volunteer-only courses.

## Verified

- CI on #513: `verify` (unit + build) and `e2e` (172 passed, 1 flaky unrelated privacy test, 45 skipped) passed every step. `osv-scanner` failed on 3 pre-existing Medium advisories (`.12`).
- Dev DB: migration applied via MCP; ledger row realigned to `20261104181312` and re-read.
- Read-only dev script: the Colorado volunteer resolves to volunteers-only yes / students-only no; a Nevada participant the reverse.
- Browser, admin on dev, throwaway course (since deleted): control renders and saves; tracking lists exactly the one volunteer under "Volunteers"; switching to Students removes them.

## Not verified

- A volunteer's own course list signed in (`.7`); a real reminder (`.8`); the dev deployment of `bcc1aa28` (`.9`, BUILDING at close-out).
- Production `object_type_relations` (`.3`). Dev's table is empty (`.5`), which makes every course attach 403 on dev with no error shown (`.6`); the browser check inserted its assignment by SQL for that reason.

## Correction made during the session

An early recommendation said Nevada's Event training tracking would list the mentors once the course was assigned to the event. It would not have (tracking read registrations only); #513 fixes that.

## Next, in order

1. `.3` — check prod `object_type_relations` (owner).
2. `.1`, `.2` — promote: migration on prod first, then merge.
3. `.4` — set up the Nevada course (names in the Doc).
4. `.10`, `.11` — owner decisions on role spaces and campaigns.
