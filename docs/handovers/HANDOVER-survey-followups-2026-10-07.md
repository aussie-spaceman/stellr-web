# Handover: post-event survey follow-ups — 2026-10-07

Tracker: `tracker/2026-10-07-survey-followups.md` (rows `survey-followups.1–6`).
Spec and decisions: `docs/PLAN-post-event-survey-2026-10-02.md` §5–§6.
Shipped: PR #294 → `dev` (`0c4ce5f`, 6 Oct), promoted in #296 (`7291e88`).

## Context

The post-event survey (`post-event-survey` close-out, #298) left three items in
its plan's "Not done / follow-ups". This session built all three on 2 Oct, on a
branch stacked on the then-unpushed survey branch. It did not push or ship them
itself: #294 was opened and merged on 6 Oct after the survey branch landed, and
this close-out confirmed afterwards what reached production.

## What changed

1. **Certificate gate (handover D1), per event, off by default.**
   `lib/survey/certificate-gate.ts`: a pure `certificateGate()` plus loaders.
   An event certificate is held only while that event's survey is open and the
   holder has an invitation they haven't submitted. It never applies once the
   survey is paused or closed, or to anyone not invited. Minors are not exempt
   (David, 2 Oct).
   - The PDF route (`app/api/credentials/[number]/pdf`) sends a browser to
     Credentials, with a notice and the survey link, and gives an API caller a
     403 with `surveyUrl`.
   - The credentials list and the owner's credential page link to the survey
     instead of the PDF.
   - The admin-only switch is on the event's Survey tab, behind a warning
     about bias and pressure on minors. It is off for every event on prod
     (checked 7 Oct).
2. **Media permission resolver.** `lib/survey/media.ts`, one rule, in this order:
   - withdrawn consent: no;
   - `MediaOptOut` on the signed agreement: no;
   - the student's `allow_media` switch turned off: no;
   - a minor with no agreement on file: no;
   - a minor whose media box can't be seen: **check**;
   - the switch turned on: yes;
   - NY/CO, ages 13–17 (or a minor of unknown age): no;
   - otherwise: yes.

   It surfaces in **Admin → Operations → Media do-not-use** (`/admin/media`,
   with an event filter and a CSV download) and in the roster export's
   `media_ok` + `Media Note` columns. Runbook Part C now points at the list.
3. **7-year survey retention.** `lib/survey/retention.ts`.
   - Account holders: 7 years after `members.deleted_at`, while the account
     stays inactive.
   - No account: 7 years after 31 December of the event's year.
   - Email-only recipients wait until every survey sent to their address is
     due, and are skipped if a member has the address.
   - Deletion is full, through `survey_purge_person()`.
   - Run it with `npm run survey:retention` (`--as-of` for what-if reports,
     `--apply` to delete; production also needs `--prod`).
   - The monthly cron `/api/cron/survey-retention` (`0 3 2 * *`) reports to
     `cron_runs` and deletes only when `SURVEY_RETENTION_APPLY=true`, which is
     unset.
   - Migration `20261003020253` backfilled `deleted_at = 2026-10-02` for
     inactive members with no date. It matched no rows on prod.

## Verified

- On the branch (2 Oct):
  - `tsc`, `lint:tokens`, `lint:migrations`: clean.
  - vitest: 1,359 tests passed, 25 of them new.
  - Playwright `e2e/core/survey.spec.ts`: 10/10 against the branch's own dev
    server. The routes it exercised existed only on that branch, which
    confirms the target.
- Retention on dev: report only, nothing due. Deletion was proven with a
  synthetic member deactivated in 2018: only that member's survey data went,
  with a `survey_purge` audit row.
- CI on #294 (6 Oct): `verify` and `e2e` passed.
- Production (7 Oct):
  - All three survey migrations are in the ledger.
  - No members are inactive without a `deleted_at`.
  - The gate is off everywhere.
  - No `survey-retention` run yet; the first is 2 Nov.

## Not verified

- **Signed in on prod:** `/admin/media` and the gate switch. Tracked as
  `post-event-survey.6`.
- **The gate switch in a real browser:** checked only on dev, with the Survey
  tab's data mocked onto a Sanity event, because the demo events are not in
  Sanity. The e2e covers the API side.
- **The first retention report:** due 2 Nov. Tracked as `post-event-survey.7`.
- **No `/code-review` was run** on the follow-up diff.

## Open items

- **`survey-followups.1` (most important):** on prod the media list says
  "check" for every DocuSign-signed minor, which today is all 23 minor
  agreements, until DocuSign V2.3 read-back is live. Check signed PDFs by hand
  before using a minor's image.
- **`survey-followups.2`:** the first Stellr-signed minor form should resolve
  to yes or no. Check `/admin/media` after the e-sign canary completes.
- **`survey-followups.3`:** turning retention deletion on. Nothing is due
  until 2033.

## Decisions (David, 2 Oct)

1. No-account rule agreed.
2. Deletion stays off.
3. Backfill undated inactive members to 2 Oct 2026.
4. Do not import the legacy Google Forms data; the tooling was removed in #294.
5. Do not exempt minors from the gate.
6. Media defaults agreed: no agreement means "no"; an unreadable box means
   "check"; NY/CO with unknown age means "no".
7. Adults get only their own agreement's box and their switch.
8. Email opt-outs stay manual, with no follow-up.
9. Consent loader moved to the agreement columns from #280.
