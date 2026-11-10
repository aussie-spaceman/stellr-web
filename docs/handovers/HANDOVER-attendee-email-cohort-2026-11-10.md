# Handover: "All attendees" email group + mentor check-in, 10 Nov 2026

Tracker: [`tracker/2026-11-10-attendee-email-cohort.md`](tracker/2026-11-10-attendee-email-cohort.md).

## Status first

Committed, shipped and promoted. #605 → `dev` as `4f793623`; promoted in #606 (merge `91bb225e`, production deployment `dpl_C84i26n2QcaMQpKS3EhPftc1Fx2U`). Migration `20261110120000_event_staff_check_ins` was applied to dev and to production (owner's yes, before the merge), with both ledgers realigned. The promotion record and the main → dev sync are #607, landed by a parallel session.

Nothing has been used for real yet: no live "All attendees" send, and no mentor checked in at a live event.

## What was asked

The owner wanted another Send-to option on an event's Email Reminders tab: **All attendees**, meaning anyone who checked in. That covers student participants, student managers, mentors, teachers and event managers.

Owner decisions during the session (these outrank the original ask):

1. **Build real check-in for mentors and event managers.** The other option was "include every assigned mentor and event manager". Before this session only roster rows (`participants.checked_in_at`) could be checked in. Volunteer mentors (the event container's `cohort_members`) and event managers (`event_manager_assignments`, Clerk users) had no check-in at all.
2. **A group's organising teacher is included only if they were checked in themselves.** An organiser who is not on the roster has no check-in path, so they are not reached (row `.5`).
3. **No guardians.** Ticking "Parents / legal guardians" as well still reaches every guardian, attendee or not.

## What changed

- **Audience** (`lib/event-emails/types.ts`, `lib/event-emails/audiences.ts`): new key `attendees`, last in the list so the existing boxes keep their places. It covers roster rows with `checked_in_at`, plus mentor contacts whose desk check-in exists. The history shows roster roles as participant / teacher / volunteer. It is resolved at send time like every other group. If staff check-ins cannot be read, the send **fails closed** rather than leaving mentors out. Catch-up (late registrants) is unchanged: it only follows All participants and guardians.
- **Mentor contacts** (`loadMentorContacts`): each contact now carries `key` (`v.<members.id>` for volunteers, `m.<Clerk user id>` for event managers) and `memberId`, the member row matched by `members.clerk_user_id` for event managers.
- **Table** `event_staff_check_ins`: one row per checked-in person per event, `UNIQUE (event_slug, staff_key)`. Event-scoped, with tenant derived from `event_slug` (trigger + both tenant policies). `member_id` → `members` ON DELETE CASCADE. Undo deletes the row; a second tap keeps the first time.
- **Server helper** (`lib/check-in-staff.ts`): `loadDeskStaff` lists the Mentors-tab people. They are exactly the Mentors email group's people, one per address with volunteer first, and anyone whose `member_id` is on the roster is dropped. Also `loadStaffCheckIns`, and `writeStaffCheckIn`, which refuses a key that does not name someone on the event.
- **Desk API** (`app/api/admin/events/[slug]/check-in/route.ts`): the 10 s poll adds `staffCheckIns` (one indexed read, null on a hiccup). The 3-minute `?details=1` load adds `staff` names; it calls Clerk, so it stays off the poll, and member ids never leave the server. There are new POST actions `staff_check_in` / `staff_undo`.
- **Desk UI** (`components/admin/CheckInLive.tsx`, `lib/check-in-desk.ts`): a **Mentors N** tab beside People / Groups, shown when the event has any. It has its own arrived count, so the student count is unchanged. Search is by name or role, and taps go through the existing offline queue.
- **Guards updated for the new table:** `lib/tenancy/registry.ts`, generated pgTAP (`supabase/tests/database/*.test.sql`), `lib/tenancy/{isolation,registry}.test.ts` (post-S4 table lists, counts), `.semgrep/event-scope.yml`.
- **Tests:** cohort cases in `event-emails.test.ts`, `lib/check-in-staff.test.ts`, desk API cases in `route.desk.test.ts`, queue cases in `check-in-desk.test.ts`, and an e2e Mentors-tab test in `e2e/core/check-in-desk.spec.ts`. That test uses a `withMentor` option on the throwaway-event fixture, which assigns the event-manager fixture's members row `00000000-0000-4000-a000-000000000006` as a volunteer. `test/fake-supabase.ts` now honours `upsert(..., { ignoreDuplicates })`.

## How it was verified

- CI on #605 and on #606: verify (typecheck, lints, build), unit, tenant-db, e2e-tests (205 passed, 43 skipped each run), e2e-local.
- Locally against the dev database, on dev's copy of the Nevada event: one student and a temporary volunteer were checked in through the desk. An All attendees draft's recipient preview returned exactly those two. The draft, the check-ins and the temporary volunteer were then removed, and a final read confirmed Nevada was back as it was.
- Production: tables, grants (service_role yes, anon/authenticated no), RLS, the derivation trigger and 3 policies were read back after the migration. `db:status -- --prod` is clean apart from the two historic `20260910…` rows. After the merge: www 200, app 307 to sign-in, the cron guard returned Unauthorized, and the desk API returned 401 signed out.

## Not verified

- No production use of either part (rows `.1`, `.2`).
- CI's Playwright reporter does not print test names, so the CI logs do not show that the new Mentors e2e test was among the 205 passed (row `.3`). It passed 3/3 locally against dev.
- During the dev check, a side read in the throwaway verification script returned no staff rows at a moment the app plainly had one. The desk, the preview and a direct SQL insert/read all behaved, so it is put down to the script, but the cause was not found (row `.6`).

## Gotchas for the next session

- The auto-mode classifier refused `apply_migration` on dev until the owner said "Yes, apply to dev" in chat. Production needed its own yes as usual.
- dev's Nevada event already has an event_participation container (unique per event), so a fixture must reuse it rather than insert a second.
- Parallel promote sessions: #606 was merged and its record branch opened by another session while this one ran promote. This session left Step 8 to that session and messaged it the facts.
