# "All attendees" email group + mentor check-in — 2026-11-10

Slug: `attendee-email-cohort`. Handover: `HANDOVER-attendee-email-cohort-2026-11-10.md`. Doc snapshot: `1RBYnCFlUx5IuboUMdwIjMWZGo7I5wcsB19fj2PDklwA`.
PR #605 → `dev` as `4f793623`; promoted in #606 (`91bb225e`, record #607). Migration: `20261110120000_event_staff_check_ins`, applied to dev and production 10 Nov, both ledgers realigned.

The event Email Reminders tab has an "All attendees" group: everyone checked in at the event. The check-in desk has a Mentors tab that checks in volunteer mentors and event managers.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| attendee-email-cohort.1 | First real "All attendees" send | Never sent in production. On dev, a preview of an All attendees draft returned exactly the checked-in student and mentor. | After the next event, preview an All attendees email and compare the count with the desk's arrivals (People + Mentors), then send. | ☐ |
| attendee-email-cohort.2 | First mentor / event-manager check-in at a live event | No row in production `event_staff_check_ins` yet. Worked on dev through the desk. | At the next in-person event, check a mentor in on the Mentors tab and confirm the row has the event's `tenant_id` and `member_id`. | ☐ |
| attendee-email-cohort.3 | CI evidence for the Mentors e2e test | CI's Playwright step passed (205 passed, 43 skipped) on #605 and #606, but the reporter prints no test names. The test passed 3/3 locally against dev. | Open the e2e-tests artifact/report of a later run and confirm `mentors: checks in a volunteer mentor…` passed (not skipped). | ☐ |
| attendee-email-cohort.4 | Event-manager check-ins with no members row outlive account removal | Owner decision 13 Nov 2026: the check-ins leave with the account. Branch `fix/staff-checkins-purge`: every account-removal path calls `purgeStaffCheckIns` (`lib/deletion/staff-check-ins.ts`). Clerk `user.deleted` removes the login's `m.*` rows and its member's rows; the login removal (`deleteUnsharedClerkLogin`) removes the login's `m.*` rows once the login is gone (hard delete, pending-consent purge, privacy request, member merge). No migration. | Promote with the next release. | ☑ |
| attendee-email-cohort.5 | Organising teachers not on the roster can't be checked in, so All attendees never reaches them | By owner decision, the organiser is included only if checked in; the desk has no check-in for a registration's organiser who has no participant row. | Owner call: leave it, or add the organiser to the desk (e.g. on the Mentors tab or the group sheet). | ☐ |
| attendee-email-cohort.6 | Unexplained empty read in the dev verification script | A side read of `event_staff_check_ins` in the throwaway script returned `[]` while the desk and preview saw the row; a direct SQL insert/read behaved. | Only if `.2` shows a problem: retest a desk check-in and read the row straight back with the service key. | ☐ |
