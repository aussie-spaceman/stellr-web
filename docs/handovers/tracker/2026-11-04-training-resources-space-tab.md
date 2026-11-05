# Training Resource lessons + Space tab — 2026-11-04

Slug: `training-resources-space-tab`. Handover: `HANDOVER-training-resources-space-tab-2026-11-04.md`. Doc snapshot: `1D9fnlLvV9WBcZOkfNPDRxYnXbIgXczdBxBfmwzitUEo`.
PR #530 → `dev` as `d6f0ee69`; promoted in #522 (`c2817859`). Record #532. Migration: none of its own; #522 carried `20261104500000_recording_offloads.sql`, applied before this session.

A Resource lesson can be saved with only attached resources, a course assigned to an event shows on that event's Space, and deleting a section warns that its lessons stay visible. All in production, and the mentor course's lessons are fixed. Nobody has confirmed the signed-in member view on production.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| training-resources-space-tab.1 | Save a Resource lesson with only an attached resource | Live. Read back on production: lesson `a50f743d` is published, `document`, no file, 1 attached resource, which only the new save path allows. | None. | ☑ |
| training-resources-space-tab.2 | Mentor course lesson data, module `ba4f45bf` | The owner cleaned it up in the builder. Read back: 6 published lessons in the section, orders 0–5, no unsectioned lessons. | None. | ☑ |
| training-resources-space-tab.3 | **HIGH** What a mentor sees on production | Not seen signed in. Evidence is the data read-back and CI only. | View as a mentor: 6 lessons, no "More lessons", `a50f743d` lists its resource, and the Nevada Space's Training tab shows the course. Who to view as is in the Doc. | ☐ |
| training-resources-space-tab.4 | **HIGH** Nevada assignment, before 6 Nov | Unchanged on production: default `na`, Alumni tier (`da489c48`) optional, audience volunteers. 1 of 2 Nevada volunteers holds Alumni, so the other cannot see the course. Optional, not Mandatory. | Owner decides: set the default to optional or mandatory, or leave it. | ☐ |
| training-resources-space-tab.5 | Admin cannot revoke a membership | `app/api/admin/members/[id]/memberships/[membershipId]/route.ts` writes `revoked`, and `membership_renewal_status` has no such value (`active, pending_renewal, expired, cancelled, complimentary`). Failed on production at 03:57 UTC 5 Nov. The status lists there and in `MemberMembershipManager.tsx` also say `canceled`, where the enum says `cancelled`. The route is unchanged since 16 Sept, so not caused by this release. | Fix the route and both lists. Decide: use `cancelled`, or add `revoked` by migration. | ☐ |
| training-resources-space-tab.6 | Edit an existing lesson's URL or file | Cannot be done without switching the type away and back. | Allow it directly in the lesson editor. | ☐ |
| training-resources-space-tab.7 | Admins not on a roster see an empty Space Training tab | The event-assigned part of the tab is narrowed to the viewer's own assignments. | Decide whether admins should see every course for the Space. | ☐ |
| training-resources-space-tab.8 | `osv-scanner` red on every PR since 4 Nov | deepmerge, glob, minimatch: 3 Medium advisories. Not a required check. | Bump or override the three packages. | ☐ |

## Closes

- `training-recording-builder.1`: #522 merged with the owner's yes as `c2817859`; production deployment `dpl_3h276Wpetw1DC1p87kYugu2yp7Nu` READY; `db:status --prod` showed `recording_offloads` not pending, and its ledger row and table were read back on production.
