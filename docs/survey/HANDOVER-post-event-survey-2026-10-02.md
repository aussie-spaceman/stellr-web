# Handover: Post-Event Survey in the Stellr Web App

**For:** Claude Code
**From:** David Shaw (owner) via Claude chat
**Date:** 02-Oct-2026
**Status:** Ready to build. Section 11 lists decisions with defaults. Build with the defaults unless David overrides them.
**Companion file:** `survey-2027-v1.json` is the seed survey definition, with every question, key, option and branch rule.

---

## 1. Goal

Replace the Google Forms post-event survey with a survey built into the Stellr web app. It must:

- be issued by email to every participant of an event,
- tie every response to a participant record, and to the member account when one exists,
- build a clean multi-year dataset with stable question keys so 2027 can be compared with 2028 onward,
- give participants a reason to use the web app (resume a draft, see their history, see credentials).

Respondent target time is about 5 min (hard ceiling 7 min) on every role path. Do not add questions without removing others.

## 2. What already exists (verify before building)

This comes from a read-only look at Supabase on 02-Oct-2026. Confirm it against the repo.

- **Supabase projects:** `stellr-web-dev` (`xvxlhbxtiwxpopoqjygm`) is dev. `Stellr Registrations` (`hwtzpfrnksksxlwwabqz`) is **production** (confirmed by David 02-Oct-2026). Prod is on an older schema: it still has `docusign_envelopes` and has no `esign_*` or `agreements` tables. **Build and migrate on dev first. Never apply migrations to prod without David's explicit approval.**
- **Stack (per David):** Node/TypeScript on Vercel, Supabase, Clerk auth (`members.clerk_user_id`), Resend for app email, GitHub PRs, Playwright e2e.
- **Deploy gates:** deploy gates report and recommend (go/no-go) rather than hard-blocking. Merge and production deploy are separate approvals.
- **Tables to reuse (do not duplicate):**
  - `members`: holds DOB, gender, grade, `age_bracket`, `event_role`, `graduation_year`, email, emergency contact (`ec_email`), and the marketing-consent fields.
  - `participants`: one row per person per registration. `member_id` is **nullable**, so many participants have no account. Also holds gender, ethnicity[], grade, school_name, `event_role` and `checked_in_at`.
  - `registrations`: links to `event_slug` and `event_title`.
  - `event_participations`: member × event history, with `event_year`, `role` and award. Use this to derive first-time vs returning.
  - `member_schools`, `schools`, `member_ethnicities`, `ethnicity_options`: demographics already captured.
  - `event_emails`, `event_email_sends`, `email_templates`, `email_campaigns`, `sent_reminders`, `cron_runs`: existing email and scheduling infrastructure. **Extend these patterns; do not build a parallel mailer.**
  - `esign_email_budget`: an existing daily send-budget pattern for Resend limits. Apply the same idea to survey sends.
  - `credentials`: event participation credentials. Use these for the post-submit call to action.
  - `audit_log`, `member_activity_log`, `privacy_requests`, `deletion_requests`, `deletion_archive`: compliance plumbing the survey must plug into.
  - `esign_templates`: an existing "immutable once published" versioning pattern. Copy it for survey definitions.

## 3. User stories and acceptance criteria

### Admin

**A1. Issue the survey to all participants by email**
- **Automatic schedule:** every event gets a `scheduled` distribution automatically, using the latest published `post_event` definition and all audiences.
  - It **goes live on the event date** at 00:00 in the event's local time zone. For multi-day events, that is the event's **last day**.
  - At go-live, invitations are created and emailed with no admin action needed.
- **Close date:** `closes_at` is **always 30 days after the actual go-live time** (`opens_at + 30 days`). It is recomputed whenever the go-live time changes.
- **Early go-live:** an admin, or an event manager assigned to that event (`event_manager_assignments`), can either click "Send live now" or set an earlier go-live date/time.
  - Earlier only: the setting cannot push go-live past the event date.
  - The UI shows the resulting close date before confirming.
  - Record who made the change and when (`opens_at_source = manual`, `opened_by`) and write it to `audit_log`.
- **Event date changes:** if the event date changes while the distribution is still `scheduled` and has no manual override, reschedule it automatically. If it has been manually overridden, keep the override and flag it on the admin screen.
- **Preview:** while scheduled, the admin/event manager sees the recipient count by role, plus participants with **no deliverable email**, listed separately for manual follow-up.
- **Sending:** at go-live, the system creates one invitation per participant and sends it via Resend within the daily budget. The rest queue for the next day.
- **Late participants:** participants added to the event after go-live are invited automatically, until the close date.
- **Admin actions:** the admin can change audiences or pause the distribution before go-live, resend to individuals, and close the survey early.
- Audiences are deduplicated by person: one invitation per person per distribution, even if they hold two roles.
- **Recipient sources and role mapping.** Prod data on 02-Oct-2026 shows `participants` contains **only students** (`event_role = participant`, 25 of 25). Teachers, mentors and parents are not in `participants`. Adults are often only a headcount (`registrations.adult_count`). Build the recipient list from:
  - `participants` (students),
  - the registration's teacher/contact (`teacher_member_id` / `teacher_email` / `teacher_poc_email`),
  - members with an `event_participations` row for the event (mentors and volunteers),
  - any named adult records the repo holds for the event. Search the repo; adults who exist only as a headcount can't be surveyed. List the count on the preview screen.
  
  Deduplicate across sources by `member_id`, then by lower-cased email. Map the `event_role_type` enum as follows:

  | Enum value(s) | Survey path |
  |---|---|
  | `participant` | student |
  | `mentor`, `volunteer` | mentor |
  | `teacher`, `school_student_manager` | adult, relationship = teacher (question skipped) |
  | `parent` | adult, relationship = parent (question skipped) |
  | `adult` | adult, relationship asked |
  | `donor`, `subscriber` | not surveyed |

**A2. Associate replies to individual participants**
- Every response row carries `participant_id`, plus `member_id` when the participant is linked to an account at submit time.
- If a participant later creates or links a member account, their past responses are re-associated (backfill `member_id`).
- The admin can see a per-event completion table: invited / opened / started / submitted, with last activity.

**A3. Build a multi-year database easily**
- Question keys are stable across years. If wording changes but meaning doesn't, keep the key and bump the definition version. If meaning changes, mint a new key.
- Provide a long-format analysis view (one row per answer) joined to event, year, role, school and profile demographics. It must be admin-only.
- Provide a one-click CSV export per survey, event or year, in long or wide format.
- Provide a legacy import script for the 2024 and 2026 Google Sheets (Section 9).

**A4. Encourage participants to use the web app**
- The invitation email lands on a web-app-branded page, not a bare form.
- After submit, show a call to action to view or download the event credential/certificate and to sign in or create an account to see history.
- Logged-in members see an "Open survey" card on their dashboard while a survey is open, and a "My surveys" history page.
- Track `opened_from` (email link vs dashboard) so David can measure app adoption.

### Participant (adult and minor)

**P1. Save and return later**
- Answers autosave on every page change and every 10 seconds of inactivity after an edit.
- The participant can return from the same email link, or from the dashboard if logged in, and resume on the last page.
- If a draft has been saved but not submitted, a resume reminder goes out 48 h after the last save. Send a maximum of 2 reminders, and none after the close date.
- Invited participants who have not started get reminders on day 3 and day 7 after go-live, plus a final "closing in 3 days" reminder on day 27. Send a maximum of 3. Stop when they start, submit or opt out.
- Every email has a one-click "stop survey reminders" link. This is separate from the marketing unsubscribe.

**P2. Cannot edit once submitted**
- Submit asks for confirmation first, warning that answers can't be changed afterwards.
- After submit, the UI is read-only. **Enforce this in the database (a trigger plus RLS), not just the UI.**
- Re-opening the email link after submit shows "Thanks, already submitted" plus the call to action from A4.

**P3. View historical responses**
- A logged-in member sees a list of their submitted surveys (event, date) and can open a read-only view of their answers.
- This needs an account. Token links do **not** expose history.
- Members see only their own responses, enforced by RLS on `member_id`, matched to the Clerk user.

## 4. Data model (proposed; adjust names to repo conventions)

```
survey_definitions
  id uuid pk
  key text                -- e.g. 'post_event'
  version int             -- 1, 2, …
  title text
  definition jsonb        -- full question set (see survey-2027-v1.json)
  definition_sha256 text
  status text             -- draft | published | archived
  published_at timestamptz
  unique(key, version)
  -- immutable once published (trigger), same pattern as esign_templates

survey_question_catalog          -- cross-year dictionary for analysis
  question_key text pk
  label text                     -- latest wording
  type text
  options jsonb
  first_version int, last_version int

survey_distributions
  id uuid pk
  definition_id uuid fk
  event_slug text
  audiences text[]               -- student | mentor | adult
  opens_at, closes_at timestamptz  -- closes_at = opens_at + interval '30 days' (enforce via trigger or generated column)
  opens_at_source text           -- auto | manual
  opened_by uuid null fk members -- who set an early go-live
  status text                    -- scheduled | open | paused | closed
  created_by uuid null fk members  -- null when auto-created
  unique(event_slug, definition_id)

survey_invitations
  id uuid pk
  distribution_id uuid fk
  participant_id uuid fk participants
  member_id uuid null fk members
  respondent_role text           -- derived from participants.event_role at send time
  email text                     -- address actually used
  token_hash text                -- store a hash only, never the raw token
  status text                    -- queued | sent | opened | started | submitted | opted_out | bounced | expired
  sent_at, first_opened_at, last_reminder_at timestamptz
  reminder_count int default 0
  opened_from text               -- email | dashboard
  unique(distribution_id, participant_id)

survey_responses
  id uuid pk
  invitation_id uuid unique null fk     -- null for legacy imports
  definition_id uuid fk
  event_slug text, event_year int
  participant_id uuid null, member_id uuid null
  respondent_role text
  draft_answers jsonb                   -- working copy while in progress
  current_page text
  started_at, last_saved_at, submitted_at timestamptz
  is_minor_at_submit boolean            -- per Stellr's minor definition (Section 7)
  quote_consent text, followup_consent boolean
  source text                           -- app | legacy_import
  legacy_ref text                       -- sheet id + row for imports

survey_answers                          -- written once, at submit, from draft_answers
  response_id uuid fk
  question_key text
  value_text text
  value_numeric numeric
  value_options text[]
  primary key (response_id, question_key)
```

**Immutability rules (DB-enforced):**
- `survey_answers`: no UPDATE or DELETE for any role except a `SECURITY DEFINER` redaction function used for privacy/deletion requests. That function writes to `audit_log`.
- `survey_responses`: once `submitted_at` is set, block updates to answer and consent fields.
- `survey_definitions`: block updates once published.

**RLS:**
- Participants act through server routes using the invitation token or the Clerk session. There is no direct client write path.
- Members may SELECT only their own submitted responses and answers.
- Admin/staff access uses the existing `member_roles` / `staff_roles` model.

## 5. Flows

**Schedule:** when an event is created (and via a one-off backfill for existing future events), auto-create a `scheduled` distribution with `opens_at` = event date (last day) 00:00 event-local. **Find where event dates live in the repo before building; they are not in `event_settings`.** Report to David if the event's time zone isn't stored anywhere.

**Go-live:** an hourly cron job finds `scheduled` distributions with `opens_at <= now()` and sets them to `open`. "Send live now" does the same thing immediately. Either way, the job then builds invitations from the event's participants (filtered by audience) → resolves the email (rules in Section 7) → sends via Resend within the budget → logs to `cron_runs` and the email send log. The same job picks up participants added after go-live. It must be idempotent: the unique `(distribution_id, participant_id)` constraint prevents duplicate invitations.

**Close:** the same cron job sets distributions with `closes_at <= now()` to `closed`. Closed links show a "this survey has closed" page with the A4 call to action.

**Respond via link:** `/survey/[token]` → hash the token and look it up → check the distribution is open → render. If the token's participant is linked to a member and the visitor is signed in as a *different* member, block with a clear message. A signed-out visitor can proceed; sign-in is **not** required to respond, because that would hurt response rates.

**Respond via dashboard:** a signed-in member sees open invitations for their participant IDs → same renderer.

**Autosave:** `PATCH draft_answers` (server-validated against the definition), updates `last_saved_at` and sets status `started`.

**Submit:** validate required answers and branch logic server-side → in one transaction, write `survey_answers`, set `submitted_at` and set the invitation to `submitted` → show the thank-you page and call to action.

**Reminders:** a daily cron job applies the cadence in P1. It is idempotent and deduplicated via `sent_reminders` (`kind = 'survey_resume' | 'survey_not_started'`).

**Account link backfill:** when a participant is linked to a member (existing join flow), set `member_id` on their invitations and responses.

## 6. Survey content

The full definition is in `survey-2027-v1.json`. Key design points:

- **Role and event are never asked.** They come from the invitation.
- **Demographics are asked only if missing** from `members` / `participants` (gender, ethnicity, grade, school). Do not write survey answers back to the profile in MVP.
- **First-time vs returning** is derived from `event_participations` and not asked. "How did you hear about us" is shown only to first-timers.
- **Branches:**
  - **Student** (target ~5 min): overall, NPS, before/after STEM intent, first contact with a STEM professional, 8-item skills grid, logistics grid, first-gen, interests, return intent, 2 optional free-text, consents.
  - **Mentor** (target ~3–4 min): overall, NPS, hours (prep and event), employer, logistics, recurring-mentoring interest, employer support, portal ease, 1 free-text, quote consent.
  - **Adult** (target ~3–4 min): sub-branches on relationship. Parent/guardian vs teacher/school staff get different interest options. Parents get a mentoring price-band question.
- **UI:**
  - One question group per page, with a visible progress bar and a "~5 min" promise on the intro screen.
  - Mobile-first; most responses will come from phones at the event via QR code.
  - Keep required questions to the minimum set flagged in the JSON.
- **Event-day QR:** provide a per-event QR code that opens the dashboard survey card for signed-in members. Signed-out users get "enter your email to get your link". **Never** use a shared open link; every response must map to an invitation.

## 7. Compliance (these are David's standing policies; do not change them)

- **Minor definition:** under the age of majority in the person's home state, OR still in high school, OR a ward. Compute `is_minor_at_submit` with the existing helper if the repo has one. Search for it before writing a new one.
- **FERPA:** student survey responses linked to a person are treated as education records. Apply the same access logging used for other student data.
- **Retention:** 7 years after account deactivation. Deletion requests from a school, parent or student are completed within 30 days through the existing `privacy_requests` / `deletion_requests` flow. Add survey tables to that flow, and to the export flow if one exists.
- **Intro-screen notice (required):**
  - responses are linked to the participant and visible to Stellr staff,
  - they are reported publicly only in aggregate,
  - quotes: minors follow the V2.3 opt-out model with quotable questions tagged; adults are asked explicitly.
  - Final wording needs David's sign-off. A draft is in the JSON.
- **Governing document for students:** Participation Agreement – Minors **V2.3** (effective 02-Oct-2026). §1.1 and §1.2 cover survey collection and use. §1.7 and §2 cover quoting. The Privacy Policy and Terms of Use are being aligned to it. **Students are governed by the agreement version they actually signed.** Earlier versions (≤ V2.2) do not cover surveys (see Section 14).
- **Who can be surveyed (minors).** Invite a minor only if all of the following hold:
  - they have an active signed agreement at **V2.3 or later**,
  - their account is not *pending* (§7.2: no messages except about the pending account),
  - consent has not been withdrawn (§9).
  
  Minors on an older agreement version are **not invited**. Show their count on the distribution preview as "awaiting V2.3 consent". Do **not** build a re-consent request flow; David runs the V2.3 re-consent push himself. If a student re-signs before `closes_at`, invite them automatically on the next cron run.
- **Email to minors:**
  - If the parent ticked the §4 "no direct digital communications" box, send the invite to the parent only, with copy saying "please pass this to [first name]".
  - Otherwise use the student's own email if present; if they have none, use the parent/guardian email with the same copy.
  - Never send to both by default.
- **Quoting minors (V2.3 §1.7 and §2). The agreement already grants this, so the survey does NOT ask minors for quote consent.** Instead:
  - **Quotable questions:** only questions flagged `quotable: true` in the definition can be quoted (currently `highlight`). §2 says "surveys will say which answers may be quoted", so show a visible "may be quoted" tag on those questions.
  - **Eligibility** is computed at export time, never stored as a one-off. A minor's quote is eligible only if all of the following hold:
    - the signed agreement is V2.3 or later,
    - the parent did not tick the §2 quote opt-out,
    - the student (13+) has not opted out in their account,
    - the student did not tick "Don't quote this response" on this survey,
    - for students aged 13–17 living in **NY or CO**, the student has turned quoting **on** (default off).
  - **Attribution format is fixed by §2:** first name + last initial, grade, and school *or* state (e.g. "Jordan M., Grade 11, Nebraska"). The export generates this string. Never output full name, contact details or DOB with a quote.
  - **Under 13:** export the quote without name or any identifying detail.
  - **Withdrawal:** an admin action plus a member account action to withdraw a specific quote. Withdrawn quotes are excluded from all future exports. Log every withdrawal and every testimonial export to `audit_log`.
- **Account settings needed (new, §1.7).** Students 13+ need two toggles in their account:
  - **"Allow Stellr to quote my survey responses":** on by default; off by default for ages 13–17 in NY/CO.
  - **"Allow photo/media use":** add it only if it doesn't already exist. Search the repo first, because the photo opt-out may already be implemented.
  
  Either the parent's opt-out (from the agreement) or the student's toggle turns the use off.
- **Adults (mentors, teachers, parents)** are governed by their own agreements, which were not reviewed for quoting. Keep the explicit `quote_consent` question for them.
- **Reminder emails are transactional, not marketing.** They still include the reminder opt-out link.
- **PPRA:** not applicable. Stellr receives no US Dept of Education funding (confirmed by David 02-Oct-2026). Re-check if that changes.

## 8. Analytics outputs (for fundraising)

Build admin views or queries for these headline stats, filterable by event and year:

- % of students whose STEM intent rose (after > before), and the mean shift.
- % for whom this was their first time working with a STEM professional.
- NPS by role and by event.
- % of students who are first-gen, by gender, by ethnicity, and from Title I schools. For Title I, join `schools` to NCES data later; store an NCES ID on `schools` if one isn't there. **Flag the field as a follow-up; do not fetch NCES data in this build.**
- Total mentor volunteer hours per event, for in-kind value reporting.
- Interest counts per revenue option, plus the parent price-band distribution.
- Response rate per event and role, and % of responses submitted via the dashboard (app adoption).

## 9. Legacy import

These are one-off scripts in `scripts/`. Run them on dev first.

- `2024 Competitions - Post Event Survey Responses` (Drive `1d-_03xH-ylnywbZ67muiyZN3wQGhXKMmvYS_JH8ZQ2Q`), tab "ALL EVENTS"
- `2026 Post-Event Survey (Responses)` (Drive `1HRlNIeJY0zNEO_u7b38guJIVq1Ek9J9oLAJ19G15uEU`)

Import rules:
- Import as `source = 'legacy_import'` with `participant_id` and `member_id` null; the sheets don't identify respondents.
- Map columns to new question keys **only where meaning matches**, e.g. overall rating. Put everything else under `legacy_2024.*` / `legacy_2026.*` keys in the catalog, so nothing is lost and nothing is falsely compared.
- Produce a mapping table (column → key) as a markdown file in the PR for David to approve before running.

## 10. Testing and rollout

- **Unit tests:**
  - branch logic,
  - required-answer validation,
  - minor computation,
  - reminder cadence (time-mocked),
  - schedule logic (time-mocked): auto go-live on the event date (last day of multi-day events), early go-live by admin/event manager only, rejection of a later-than-event-date go-live, `closes_at` = go-live + 30 days after every change, auto-reschedule on event date change (but not when manually overridden), and late participants invited after go-live,
  - token hashing and lookup.
- **DB tests:**
  - an UPDATE on a submitted response fails,
  - an UPDATE or DELETE on `survey_answers` fails for non-definer roles,
  - a member cannot read another member's responses.
- **Playwright:**
  - student via token link, save → leave → resume email → submit → read-only;
  - member via dashboard, submit → history page;
  - admin create distribution → preview counts → send (Resend in test mode) → completion table updates.
- **Rollout:**
  - dev → seed a fake event with fake participants → David runs through all three role paths on a phone and confirms each path is ≤5–6 min → prod migration (separate approval) → first live use at the next event.
  - Retire the Google Form after the first successful live run.

## 11. Decisions: defaults to build with (David can override)

| # | Decision | Default |
|---|---|---|
| D1 | Gate certificate/credential download behind survey completion? | **No.** Soft call to action only. Gating lifts response rates, but it biases answers and is coercive for minors. Build it behind a per-event flag, default off. |
| D2 | Who gets the email for a minor without their own email, or with a §4 communications opt-out? | Parent/guardian, with "pass to [name]" copy. |
| D3 | Open and close timing | Goes live automatically at 00:00 event-local on the event date (last day for multi-day events). An admin or the assigned event manager can bring it forward, never later. Closes 30 days after actual go-live. *Set by David 02-Oct-2026.* |
| D4 | Minor testimonial consent | No consent question and no co-sign. Eligibility comes from V2.3 opt-outs, account toggles and the per-response "don't quote" box (Section 7). |
| D5 | Incentive / prize draw | None in MVP. |
| D6 | Write first-gen and missing demographics back to the profile | No (consent scope). Revisit later. |
| D7 | Mentor and adult question sets | The JSON is a proposal. David hasn't confirmed the existing Google Form's mentor/adult questions were reviewed. Treat them as draft until he signs off. |

## 12. Out of scope (MVP)

- A survey builder UI. Definitions are seeded as JSON via migration or script; an admin builder can come later.
- Longitudinal 12-month follow-up survey. Store `followup_consent` only.
- NCES/Title I enrichment.
- HubSpot sync of interest answers. **Worth a fast follow:** mentor employer-support and parent mentoring interest are sales leads.

## 13. Open questions for David (non-blocking)

1. ~~Role mapping~~ Answered in A1 from prod enum values. Confirm `volunteer` → mentor path.
2. Should teachers who registered a group but didn't attend be surveyed?
3. Final wording for the intro privacy notice and the reminder emails.

## 14. Legal coverage review: Minors Agreement V2.3 (02-Oct-2026)

**Reviewed:** Participation Agreement – Minors V2.3 (effective 02-Oct-2026). The Privacy Policy and Terms of Use are being aligned to V2.3 by David. This is not legal advice.

**V2.3 resolves the earlier gaps:**

| Use | Status under V2.3 |
|---|---|
| Collecting survey responses, including optional first-gen and ethnicity answers | **Covered.** §1.1 lists "responses to Stellr surveys and feedback forms". |
| Using responses to improve programs | **Covered** (§1.2). |
| Quoting minors with first name, last initial, grade and school/state | **Covered** (§2), with an opt-out model (§1.7) and NY/CO default-off for ages 13–17. |
| FERPA framing | **Resolved.** §1.4 now treats Stellr data as education records, consistent with policy. |

**Remaining issues: all resolved by David 02-Oct-2026.**
1. **Re-consent for students on ≤ V2.2:** David will run the V2.3 re-consent push himself. No build work is needed beyond the V2.3 gate in Section 7.
2. **Funder reporting of aggregate results:** no change needed.
3. **Deletion requests:** fully delete the person's survey responses and answers within 30 days, with **no retention of de-identified answers**. Already-published aggregates are unaffected.
4. **Ethnicity on member profiles:** no change needed.
5. **Adult and mentor agreements:** these were not reviewed for quoting, so the explicit quote-consent question for adults stays.
