# Handover: post-event survey iteration (6–7 Oct 2026)

Tracker: `tracker/2026-10-07-survey-iteration.md` (rows `survey-iteration.1–12`).
This follows the first survey session: `HANDOVER-post-event-survey-2026-10-06.md`, tracker `2026-10-06-post-event-survey.md`.

## Context

The post-event survey went live on 6 Oct. David then asked for:

1. The survey for the Colorado SDC that had just run, so it could go to students.
2. A way to see the questions: read-only now, editable later (like a Google Forms builder).
3. Survey responses recorded in each member's account history.

After reviewing the questions in the new viewer, he asked for wording changes, to be called **post_event v1.1**.

**Decisions David made in session:**
- **CO minors: option B.** Accept agreements signed before V2.3, for that event only. CO's 22 minor agreements were signed in DocuSign between 9 Sept and 2 Oct, with no version recorded, so none passed the V2.3 check.
  - This widens invitations only. Quoting still needs V2.3, so these students' answers are never quotable.
  - Rejected: (A) re-consent through V2.3 envelopes; (C) survey mentors only.
- **"Open survey now" is admin-only.** I recommended this; David didn't object.
- **The v1.1 changes:**
  - The Finals option reads "Attending the Finals event next summer" for students, parents and teachers.
  - Adult registration ease gets "Not applicable".
  - Mentors and adults are asked explicitly for a quote.
- **"v1.1" is a label.** Versions are integers, so v1.1 is stored as version 2 with `version_label: "1.1"`.

## What shipped

| PR | What | Production |
|---|---|---|
| #300 | Admin **Open survey now** for an event that ended without a survey, until its automatic 30-day window would have closed (`lateOpenDeadline`). Per-event `survey_distributions.minor_agreement_override` (migration `20261006182017`). | Promoted in #305 (`8a8777f`, 6 Oct 19:24Z) |
| #301 | `/admin/surveys/questions`: read-only viewer (versions, per-role pages, `show_if` rules in plain English via `lib/survey/describe.ts`). `/preview`: `SurveyApp` in `preview` mode, nothing saved. | #305 |
| #303 | Member survey history. **Built by a subagent and reviewed by the main session.** Admin member Surveys card. Admin answers page, logged to `survey_access_log`. Activity entries link to the answers. `survey_invited`, `survey_quote_withdrawn` and late-linked `survey_submitted` activity. Event-history chips on `/account`. | Promoted in #310 (`564cfc7`, 6 Oct 22:54Z) |
| #308 | `post_event.v1.1.json` (version 2) and `versionName()` labels. **Surveys that haven't started (scheduled or paused, nobody invited) adopt the latest published definition** (`adoptLatestDefinition`, audited `definition_upgraded`). | #310 |

Release records: `.claude/releases/promote-2026-10-06c.md` (#306) and `promote-2026-10-06d.md` (#311).

**Both promotions also carried other sessions' work.** #305 included #302 (DocuSign allowance cap) and #304 (DOMMatrix). #310 included #307 (dev build skip) and #309 (pdf.js worker). Both records name them.

**Production state, read 7 Oct after 16:17Z:**
- **Migration `20261006182017`:** David applied it in the SQL editor, with its ledger row. The three columns were checked and `db:status --prod` is clean.
- **post_event v1.1:** published on prod by David, 6 Oct 22:21Z (`5aa8a001…`, sha256 `fa14a4cdb76a…`, the same hash as the dev draft). Also published on dev.
- **All 7 scheduled surveys moved from v1 to v1.1** at the 07:41Z cron run on 7 Oct. Each has a `definition_upgraded` audit row from `system:definition-sync`.
- **Colorado SDC opened by David at 16:17Z on 7 Oct** (`open_after_event` audit row). It's on v1.1 with the override on, and closes 6 Nov 16:17Z.
  - 27 invitations, all sent, 0 queued, 0 send errors. The budget row for 7 Oct shows 27.
  - By role:
    - 23 students, all minors: 12 to their own address, 11 to a guardian.
    - 4 mentors.
    - 0 adults (no teacher emails on CO registrations).
  - 27 `survey_invited` activity rows were written.
  - 0 submitted at the time of writing.

## Correction to what was said in session

I told David that CO had **"29 volunteers"**, and the #300 PR body says the same. **That was wrong.** I misread a `string_agg(distinct role)`, which skips nulls.

CO's 29 `event_participations` rows are:
- 24 of the students themselves (role null)
- 3 volunteers
- 1 mentor with no role set (member event_role mentor)
- 1 other participant member

So **4 mentor invitations is correct for the data.** Any mentor who helped at CO but has no `event_participations` row was not invited. The cron invites them automatically once a row is added (row `.3`).

## Not verified

- **No survey email has been seen in a real inbox.** Resend accepted all 27 CO sends, but nobody has looked at one in Gmail or Outlook (row `.1`).
- **No submitted response exists on prod yet.** The admin answers page, the linked activity entry and the "Survey submitted · View answers" chip have not been seen with real data. The e2e member path covers them on dev (row `.2`).
- **Signed in on prod:** the question viewer, the v1.1 labels and the admin member Surveys card were checked on dev only (row `.5`).
- **#303's late-linked `survey_submitted` entry can be written twice** if two page loads overlap. Only a unique index would prevent that (row `.7`).

## How to check things

- **CO progress:**
  ```sql
  select status, count(*) from survey_invitations i
  join survey_distributions d on d.id = i.distribution_id
  where d.event_slug = 'colorado-space-design-challenge'
  group by 1;
  ```
- **Version moves:**
  ```sql
  select * from audit_log where new_data->>'event' = 'definition_upgraded';
  ```
- **Publishing a new definition (David):**
  - Write `lib/survey/definitions/post_event.vX.json`. Bump the integer `version`; add `version_label` if the name differs.
  - Load it on dev with `npm run survey:definition -- <file>`, and review it at `/admin/surveys/questions`.
  - Publish on prod from the checkout with: `NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run survey:definition -- <file> --publish --prod`. Values on the command line override `.env.local` (tested, Node 24).
  - Scheduled surveys adopt it at the next sweep. Open ones keep their version.
- **Opening a survey after the event:** event → Survey tab, then "Open survey now". The pre-V2.3 box shows only when such minors exist.

## Open items

See the tracker. In priority order:

1. A real-inbox look at a CO invitation (`.1`).
2. The first CO submission, end to end (`.2`).
3. Mentors missing from CO's `event_participations` (`.3`).
4. Before Nevada on 7 Nov: compare its invitable count with the 30/day budget (`post-event-survey.4`, still open).
