# Handover: late-registrant email catch-ups — 2026-10-02

Tracker: `tracker/2026-10-02-email-catch-up.md` (rows `email-catch-up.1`–`.7`).
Builds on the Email Reminders tab (`HANDOVER-event-email-reminders-2026-09-28.md`).

## The ask

A "2 Days Out" email went to All participants (+ guardians) for STEM School CO on 1 Oct. Students registered afterwards and never got it. User story: *as an admin or event manager, all newly registered participants automatically receive any emails they missed because of late registration; this shows as separate activity in the Email Reminders tab; it applies only to emails sent to All participants, and includes Parents/Legal Guardians if they were on the email.* It had to work retrospectively for CO and for all future events.

### Decisions the maintainer made in session
| Question | Answer |
|---|---|
| Trigger | Cron (the existing 3 daily slots) **plus** a manual button. Not on registration. |
| Cut-off | Through event day (Mountain time), then stop. |
| Dedupe | One copy per **address**, ever. A sibling's parent who already has it is not emailed again. |
| CO send | Ship → promote today; the button or the cron sends it. |

## What shipped

#263 → `dev` (`02586bc`); promoted in #265 (`40ea376`, production `dpl_BKHKZerVyZGooducgDgocovkTjXy`, "Deployment has completed" 17:58Z); record + sync #266.

- `lib/event-emails/catch-up.ts` (new):
  - `catchUpAudiences`: an email qualifies only if its groups include `participants`. The catch-up goes to `participants` and `guardians` only.
  - `catchUpOpen`: true through the event date.
  - `alreadyTriedAddresses`: every address any non-test send of this email has tried, `sent` or `failed`, lowercased. A failed read throws rather than returning empty.
  - `sendCatchUp`: takes a 5-minute lease on `event_emails.catch_up_claimed_at`, resolves the roster, and sends to the owed recipients (max 75 per run). No History row when nobody is owed it.
  - `runCatchUps`: the cron pass.
- `lib/event-emails/send.ts`: the per-recipient loop and History write are now `deliver()`, shared by normal sends and catch-ups. `sendEventEmail` now refuses the `catch_up` trigger at the type level.
- `app/api/cron/event-emails/route.ts`: after scheduled sends, calls `runCatchUps` with the shared event-date cache and the same 15s start budget. Result adds `catchUpEmailed` / `catchUpDeferred`. Errors land in `cron_runs` as `catch-up:<id>`.
- `app/api/admin/events/[slug]/emails/[id]/catch-up/route.ts`: GET returns the status and pending list; POST sends. Uses `requireEventAccess`, so admins and that event's managers.
- UI:
  - `EventEmailCatchUp.tsx` adds a "Late registrants" box on a sent, qualifying email, with the pending list and a **Send to N late registrants** button.
  - History labels `catch_up` rows "Late registrants", and shows "Automatic" when the cron sent them.
- Migration `20261002164507_event_email_catch_up`: trigger check gains `catch_up`, and `event_emails.catch_up_claimed_at` is added. Applied by David on dev and prod, and recorded in both ledgers. The MCP apply was blocked by auto mode, so I added the dev ledger row; the prod ledger row was added by David.

## Verified
- Unit:
  - `catch-up.test.ts`: 12 cases — only missed addresses; case-insensitive; no second send; no empty History row; groups narrowed; refuses non-qualifying or unsent; the cut-off; the lease; the cron pass.
  - Cron route test: the catch-up hand-off.
  - All 39 event-email tests pass. CI verify + e2e on #263, #265 and #266 (docs, e2e skipped).
- Dev:
  - A seeded sent email on CO plus one throwaway late registration. The panel listed exactly the late student and guardian and excluded the address already sent; screenshot taken.
  - The lease was claimed, refused, and a stale lease reclaimed, against real PostgREST.
  - The test data was deleted afterwards.
- Prod:
  - `www` 200, `app` 307, cron guard 401.
  - The catch-up route returns 401 without a session.
  - The LP serves "Grades 7–12".

## The CO catch-up (done)
David pressed **Send to late registrants** on prod at 18:18Z on 2 Oct, about 40 minutes before the 19:00Z cron would have sent it.
- History has a `catch_up` row: 3 recipients, 3 sent, 0 failed.
- Both late registrants and their guardians are now in the sent set.
- It was 3 addresses, not 4: one student's emergency-contact email is their own.

## Not verified
- The **cron** path sending for real. It has unit tests only. Its first prod run should find nobody owed (`email-catch-up.2`).
- No catch-up send was run on dev. The prod send above is the only real one.

## Open items
See the tracker file. Most important: `.1` (confirm the 4 CO emails went out) before the event on 3 Oct.
