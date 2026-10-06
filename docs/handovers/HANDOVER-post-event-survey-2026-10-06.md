# Handover: post-event survey in the web app (2–6 Oct 2026)

Tracker: `tracker/2026-10-06-post-event-survey.md` (rows `post-event-survey.1–12`).
Spec: `docs/survey/HANDOVER-post-event-survey-2026-10-02.md` (David, 2 Oct).
Plan, decisions and status: `docs/PLAN-post-event-survey-2026-10-02.md` (§5 survey, §6 follow-ups).

## Context

The Google Forms post-event survey is replaced by one built into the app. Every dated live event gets a survey automatically:

- It goes live at 00:00 event-local on the event's last day and closes 30 days later.
- Invitations go to students, teachers and mentors.
- Minors are invited only under a signed agreement with `agreement_version` 2.3 or later (#280).
- Answers are immutable once submitted, enforced in the database.
- Quote eligibility is computed at export time.

## What shipped

| PR | What | Production |
|---|---|---|
| #283 → dev | Survey: schema (2 migrations), respondent flow, cron, admin Survey tab, `/admin/surveys`, member card / history / privacy switches, deletion purge, QR page | Promoted in #287 (`17b6080`) 6 Oct |
| #294 → dev | Follow-ups: certificate gate (default off), `/admin/media` + roster `media_ok`, 7-year retention job (report only), `members.deleted_at` backfill migration, legacy importer removed | Promoted in #296 (`7291e88`, `dpl_2tYwWpJj7hpfmzssBSEirdSiN8n2`) 6 Oct |
| #297 → dev | Promotion record + main→dev sync | — |

**Production state (read 6 Oct ~17:25Z):**
- Migrations `20261002235036`, `20261003002925` and `20261003020253` are in the ledger. David applied the last one in the SQL editor (0 rows changed), and its ledger row was inserted via MCP.
- `SURVEY_TOKEN_SECRET` is set on both Vercel projects (checked by name).
- Definition `post_event` v1 is **published** (15:58Z, by David), with 46 catalog keys.
- The first `surveys` cron run was at 16:09Z: ok, and it created 6 distributions.
- **7 surveys are scheduled.** Nevada SDC opens 7 Nov 08:00Z (00:00 PST); Minnesota EDC opens 24 Nov; the rest open in 2027.
- No invitations or responses exist yet.

**Departures from the handover, all recorded in the plan:**
- **Cron schedule:** three runs a day (07:00, 16:00, 22:00 UTC), not hourly; Vercel Hobby allows one run per cron path per day.
- **Event time zone:** derived from the event's state; non-US events fall back to America/Denver.
- **Reminder dedupe:** done by conditional updates on the invitation, not `sent_reminders`.
- **Invitations:** keyed per person (`recipient_key`), because teachers and mentors aren't `participants` rows.
- **Emails:** sent under their own daily budget (`SURVEY_DAILY_EMAIL_BUDGET`, default 30).
- **Legacy data:** David decided not to import the Google Forms data, and the importer was removed.

## Not verified

- **No survey email has reached a real inbox.** Every dev and e2e run dropped the Resend key, so the invitation and reminder emails have only been rendered in tests. Their layout in Gmail and Outlook has not been seen.
- **The send path has never run in production** (Resend, budget roll-over, reminders, late participants). The first real run is Nevada on 7 Nov.
- **David's phone walk-through** of the three role paths (handover §10, at most 5–6 min each) was not reported before v1 was published.
- **Signed in on production:** `/admin/media`, and the certificate-gate switch, which is off everywhere.
- **The first `survey-retention` report** (2 Nov, 03:00 UTC).
- **DocuSign-signed minors:** not invitable until `DOCUSIGN_AGREEMENT_VERSION` is set on production (it isn't) and the V2.3 tab labels are done. That work belongs to the e-sign side.

## How to check things

- Survey tab: admin event page → **Survey**. It shows schedule, recipients, awaiting-V2.3 and no-email lists, and the completion table.
- Overview and exports: **Admin → Surveys**. Media list: **Admin → Operations → Media do-not-use**.
- Cron health: `select * from cron_runs where job in ('surveys','survey-retention') order by started_at desc;`
- Dev walk-through:
  - `npm run survey:seed-dev -- --open` prints one link per role path.
  - `--reset` removes the demo event.
  - `--send` really emails, routed to the dev safelist.
- DB checks: `supabase/tests/survey_db_checks.sql` (dev only; it rolls itself back).
- e2e: `e2e/core/survey.spec.ts`. Every signed-in test loads a page before calling an API, because Clerk's session cookie lasts about 60 s and only refreshes on navigation. CI failed twice on this.

## Open items

See the tracker. In priority order:

1. Send one real email to an inbox before 7 Nov (`.2`).
2. The Nevada and Minnesota first runs (`.1`, `.4`).
3. Check event sizes against the 30/day email budget (`.4`).
4. DocuSign minors (`.5`).
5. Retire the Google Form after the first good run (`.10`).
