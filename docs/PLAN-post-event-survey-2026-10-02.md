# Plan: post-event survey in the web app

Spec: `docs/survey/HANDOVER-post-event-survey-2026-10-02.md` (David, 2 Oct 2026).
Seed definition: `lib/survey/definitions/post_event.v1.json` (from `docs/survey/survey-2027-v1.json`).

This file records what the repo actually holds, where the build departs from the
handover because of it, and the decisions taken with the handover's defaults.
Items marked **David** need his answer; none of them block the build.

## 1. What the repo holds (checked 2 Oct 2026, dev `xvxlhbxtiwxpopoqjygm`)

| Handover assumption | Reality | Consequence |
|---|---|---|
| Event dates in the repo | Sanity only: `date`, optional `endDate` (bare `YYYY-MM-DD`), `state`, `country`, `status` | Last day = `endDate ?? date`. Read via `getEventBySlug`. |
| Event time zone stored | **Not stored anywhere.** All scheduling runs on `America/Denver`. | Zone derived from the event's state (`lib/survey/timezone.ts`); non-US or unknown → `America/Denver`. **David:** add a `timeZone` field to the Sanity event if any event's state is ambiguous (multi-zone states use the dominant zone). |
| Event create/date-change hook | Only the Sanity webhook `POST /api/admin/sanity/event-sync` | Distribution ensured there and on every cron sweep, so a missed webhook self-heals. |
| Hourly cron | Vercel Hobby runs each cron path at most once a day | `/api/cron/surveys` scheduled three times a day (07:00 UTC ≈ US midnight, 16:00, 22:00). A survey opens within ~3 h of event-local midnight. Opening a link or the admin tab also opens a due survey (lazy go-live). |
| Teachers/mentors are participants | `participants` holds students (plus adults on some group rosters). Teachers live on `registrations.teacher_*`; mentors on `event_participations.role='volunteer'`. | Invitations keyed by `recipient_key` (`member:<id>` or `email:<lower>`); `participant_id` nullable. Unique `(distribution_id, recipient_key)`. |
| `sent_reminders` for dedupe | Its unique key includes `member_id`, which is null for most survey recipients (NULLs never collide) | Reminders claimed by a conditional update on the invitation (`reminder_count = n → n+1`), which is atomic and idempotent. |
| Minor helper (state, high school, ward) | Only DOB-based `isMinorOn` (<18). No home state, no ward field. | `lib/survey/minor.ts`: age < age of majority (AL/NE 19, MS 21, else 18) by **school state** (runbook Part C's stand-in for home state), OR high-school grade/bracket, OR unknown DOB on a student. Ward cannot be detected. **David:** a ward flag and a home-state field are follow-ups. |
| Agreement version "V2.3" | No version labels. Dev has minor template v1/v2 only; DocuSign-signed rows carry no version. | **Superseded 5 Oct by #280:** every agreement row records `agreement_version` ('2.3' for Stellr signing; DocuSign from `DOCUSIGN_AGREEMENT_VERSION`) and the guardian's `quote_opt_out` / `digital_comms_opt_out` / `media_opt_out`. A minor is invitable only if their newest valid minor agreement is version 2.3 or later and unrestricted; otherwise "awaiting V2.3 consent". (The interim `esign_templates.document_version` label was removed.) |
| §4 digital-comms, §2 quote, media opt-outs | `DigitalCommsOptOut` and `MediaOptOut` exist only as raw guardian `signer_values` on native agreements. No §2 quote field exists in any template. | Read from the guardian's `signer_values` on the original agreement. Quote opt-out reads field **`QuoteOptOut`**. **David:** name the V2.3 template's §2 checkbox `QuoteOptOut`. |
| Pending account (§7.2), consent withdrawn (§9) | Neither exists. Nearest: `agreements.restricted_at` (set on a withdrawal/deletion request). | Restricted agreement = not invitable. Pending is not modelled; **David** to confirm nothing else is needed. |
| Photo/media toggle | Does not exist (runbook Part C lists it as a follow-up) | Added alongside the quote toggle in `member_privacy_prefs`. Stored and shown to admins; nothing consumes media yet. |
| Daily Resend budget | `esign_email_budget` covers signing emails only | New `survey_email_budget` (default 30/day, `SURVEY_DAILY_EMAIL_BUDGET`). With e-sign's 60 that is 90 of Resend Free's 100/day; event emails remain unbudgeted. |
| `audit_log` writer | Only the members trigger; enum `INSERT/UPDATE/DELETE` | `lib/survey/audit.ts` writes rows with `table_name` naming the event (`survey_distributions`, `survey_quote_withdrawal`, `survey_testimonial_export`). |
| FERPA access logging | Only `esign_access_log` (agreements) | New `survey_access_log` for admin views and exports of person-linked student responses. |
| Data export flow | None for subjects | Nothing to extend. Survey data is listed in the runbook's review-request steps. |
| Deletion | Manual runbook; member hard delete relies on FKs and leaves `participants` | Survey FKs cascade; `survey_purge_person()` (definer) is called by `executeDeletion` for members and participants and is listed in the runbook. Full deletion, nothing de-identified kept (§14.3). |

## 2. Decisions taken (handover defaults unless noted)

- D1 certificate gate: per-distribution flag `gate_certificate`, default off, not enforced anywhere yet (soft CTA only).
- D2 minor email: guardian if §4 opt-out, or no student email, or the student email equals the guardian's; else the student. Never both.
- D3 timing: as specified; `closes_at = opens_at + 30 days` set by trigger on every change. Early close sets `closed_at`/`status='closed'`.
- D4–D6 as handover.
- D7 mentor/adult questions: seeded as draft content inside v1.
- **Adult students** (college, not minors) are not covered by the minors agreement, so the student path shows them the explicit `quote_consent` question instead of "Don't quote this response". Added to v1 with `show_if: is_minor == false`.
- Teachers who registered a group are surveyed (handover §13 Q2 open; default include).
- `volunteer` → mentor path (handover §13 Q1).
- School question: free text in MVP (no NCES lookup).
- Token: `HMAC-SHA256(SURVEY_TOKEN_SECRET, invitation_id.version)` base64url. Only its SHA-256 is stored; the link is recomputed for reminders, so every email carries the same working link. Falls back to `ESIGN_TOKEN_SECRET`.
- Definitions publish through `npm run survey:definition -- <file> [--publish]`. Published = immutable (trigger). v1 stays **draft on prod until David signs off the intro and reminder wording**.

## 3. Build map

| Area | Files |
|---|---|
| Schema | `supabase/migrations/*_post_event_survey.sql` |
| Definition model, branching, validation, answer flattening | `lib/survey/definition.ts`, `branching.ts`, `answers.ts` |
| Schedule, time zone | `lib/survey/schedule.ts`, `timezone.ts` |
| Recipients, minor rule, consent gates, email routing | `lib/survey/recipients.ts`, `minor.ts`, `consent.ts` |
| Tokens, access | `lib/survey/tokens.ts`, `access.ts` |
| Distribution lifecycle, invitations, sends, reminders | `lib/survey/distributions.ts`, `invitations.ts`, `send.ts`, `reminders.ts`, `emails.ts` |
| Cron | `app/api/cron/surveys/route.ts` |
| Respondent UI | `app/(public)/survey/[token]`, `components/survey/*` |
| Member | dashboard card, `/community/surveys`, account privacy toggles |
| Admin | event tab "Survey", `/admin/surveys` (stats, exports, quotes) |
| Analysis | view `survey_answers_long`, `lib/survey/analytics.ts`, CSV exports |
| Deletion | `lib/deletion/execute.ts`, runbook Part B, retention schedule |

## 4. Rollout

1. Dev migration, seed a fake event (`scripts/survey-seed-dev.ts`), run all three paths.
2. David on a phone, each path ≤ 5–6 min; signs off intro + reminder copy.
3. Publish v1 on prod (separate approval), apply prod migration (David runs it).
4. First live event; retire the Google Form after it.

## 5. Status — 2 Oct 2026 (branch `feat/post-event-survey`, not pushed)

### Built
| Handover item | Where |
|---|---|
| A1 auto schedule, go-live on last day 00:00 event-local, close +30 d, earlier go-live / send now (admin + assigned event manager), reschedule on date change, flag manual overrides, pause, close early, audiences, resend, late participants, preview incl. no-email list, awaiting-V2.3 count, headcount-only adults | `lib/survey/{schedule,distributions,run,recipients,admin}.ts`, `app/api/cron/surveys`, Sanity webhook, `EventSurveyPanel` (event page → Survey tab) |
| A2 participant + member on every response, backfill on account link, completion table | `survey_invitations/responses`, trigger `survey_follow_participant_member`, `lib/survey/member.ts` |
| A3 stable keys + catalog, long-format view, CSV long/wide by survey/event/year (legacy import dropped, see §5 item 4) | `survey_answers_long`, `lib/survey/export.ts`, `/admin/surveys` |
| A4 branded landing page, post-submit credential/account CTA, dashboard card, My surveys, `opened_from` | `app/(public)/survey/[token]`, `components/survey/*`, `/community/surveys` |
| P1 autosave (page change + 10 s), resume, reminder cadence, stop-reminders link + one-click header | `SurveyApp`, `lib/survey/schedule.ts#dueReminder`, `lib/survey/send.ts` |
| P2 confirm before submit; DB-enforced immutability | `survey_responses_freeze`, `survey_answers_immutable`, `survey_submit_response()` |
| P3 history, own responses only (app check + RLS) | `/community/surveys/[id]`, RLS policies |
| §7 minor rule, V2.3 gate, §4 email routing, quote eligibility at export, §2 attribution, NY/CO defaults, withdrawal (admin + member), account switches | `lib/survey/{minor,consent,quotes,withdraw,privacy-prefs}.ts` |
| §8 analytics | `lib/survey/analytics.ts`, `/admin/surveys` |
| Compliance plumbing | `survey_purge_person()` in hard delete, `survey_access_log`, audit_log writes, runbook Part B/C, retention rows 27–28 |

### Verified
- `supabase/tests/survey_db_checks.sql` on dev: checks 1–10 passed together; 11 (member-link trigger) passed as its own run.
- Unit: 81 survey tests; whole suite 1,334 passed. `tsc`, `lint:tokens`, `lint:migrations` clean.
- Playwright `e2e/core/survey.spec.ts` (7 incl. auth) against this worktree's dev server: link → save → resume → submit → read-only (with axe on intro and a page), stop reminders, dashboard → submit → My surveys, admin preview → send live → completion table.
- Browser walkthrough on a 375 px phone viewport (dev seed `npm run survey:seed-dev -- --open`).
- `next build` was **not** run locally (the dev server shares `.next`); CI decides.

### Open — for David
1. **V2.3 consent (resolved by #280, in production 3 Oct):** minors are invitable once they have a signed agreement with `agreement_version` 2.3+. For DocuSign-signed forms that needs `DOCUSIGN_AGREEMENT_VERSION` set and the V2.3 tab labels (open on the e-sign side). No template-labelling step remains.
2. Sign off: intro wording (`lib/survey/definitions/post_event.v1.json` → `intro`), email copy (`lib/survey/emails.ts`), mentor/adult questions (D7). Then publish: `npm run survey:definition -- lib/survey/definitions/post_event.v1.json --publish` (add `--prod` on prod). Nothing is scheduled on prod until a definition is published.
3. Prod: three migrations (`20261002235036`, `20261003002925`, and from the follow-ups branch `20261003020253` — the `deleted_at` backfill), env `SURVEY_TOKEN_SECRET` (32+ chars; else falls back to `ESIGN_TOKEN_SECRET`), optional `SURVEY_DAILY_EMAIL_BUDGET`.
4. ~~Legacy import~~ **Decided 2 Oct: do not import the legacy Google Forms data.** The importer, its mapping and the mapping doc were removed on 6 Oct (#294). The schema still allows `source = 'legacy_import'` and `legacy_*` catalog keys (already in production); nothing writes them.
5. Handover §13: teachers who registered but didn't attend are surveyed (default); `volunteer` → mentor path.
6. Time zone is derived from state; add a Sanity `timeZone` field if that is ever wrong.

### Not done / follow-ups
- D1 certificate gate: `gate_certificate` column exists (default off); nothing enforces it and there is no UI switch.
- Pending-account (§7.2) and ward status are not modelled anywhere; home state is approximated by school state.
- `allow_media` is stored and shown; nothing consumes it yet (runbook Part C query).
- Title I / NCES, HubSpot sync of interest answers, 12-month follow-up (out of scope per §12).
- Retention: no time-based purge of survey data at 7 years after deactivation (no deactivation date exists).
- Reminder dedupe uses conditional updates on the invitation, not `sent_reminders` (its unique key cannot dedupe rows without a member).

## 6. Follow-ups — status (2 Oct 2026, branch `feat/post-event-survey-followups`, local, not pushed; merges after `feat/post-event-survey`)

### Built
| Item | Where |
|---|---|
| D1 certificate gate, per event, default off. Admin-only switch on the event's Survey tab with a confirm that warns gating skews answers and pressures minors. Holds an **event** certificate only while that event's survey is open and the holder has an invitation not yet submitted; never when paused, closed (by date or early) or not invited. The PDF route refuses: a browser is sent to Credentials with a notice and the survey link, an API caller gets 403 + `surveyUrl`. Credentials list and the owner's credential page link to the survey instead of the PDF. | `lib/survey/certificate-gate.ts` (pure `certificateGate()` + loaders), `app/api/credentials/[number]/pdf/route.ts`, `app/(member)/community/credentials/page.tsx`, `app/(public)/credentials/[number]/page.tsx`, `components/credentials/CredentialActions.tsx`, `EventSurveyPanel` |
| Photo/media: one resolver for "may Stellr use this person's image/media" — withdrawn consent → no; `MediaOptOut` on the signed agreement (guardian's for a minor) → no; student's `allow_media` off → no; minor with no agreement → no; minor whose media box can't be seen → **check**; switch on → yes; NY/CO 13–17 (or minor of unknown age) → no; else yes. Admin → Operations → **Media do-not-use** (`/admin/media`, event filter, CSV). Roster export gains `media_ok` (yes/no/check) + `Media Note`. Runbook Part C now points at the list instead of the SQL. | `lib/survey/media.ts`, `app/(admin)/admin/media/page.tsx`, `app/api/admin/media/do-not-use/route.ts`, `app/api/admin/events/[slug]/export/route.ts`, `AdminSidebar`, runbook Part C |
| 7-year retention purge, report-only by default. Account holders: 7 years after `members.deleted_at`, only while `is_active = false` (every deactivation path sets both; onboarding reactivation clears `deleted_at`). No account: 7 years after 31 Dec of the event year (participant row = one event); email-only recipients wait until every survey sent to that address is due and no member has it. Full deletion through `survey_purge_person()` (audit row `survey_purge`). `npm run survey:retention` (report; `--as-of` for what-if reports; `--apply` deletes; prod needs `--prod`); monthly cron `/api/cron/survey-retention` (02 of the month, 03:00 UTC) reports to `cron_runs` and deletes only when `SURVEY_RETENTION_APPLY=true`. **No schema change**, so no migration. Retention schedule row 27 and the runbook table updated. | `lib/survey/retention.ts`, `scripts/survey-retention.ts`, `app/api/cron/survey-retention/route.ts`, `vercel.json`, `package.json` |

### Verified
- `npx tsc --noEmit -p .`, `npm run lint:tokens`, `npm run lint:migrations`: clean. `npx vitest run`: 148 files, 1,359 tests passed (new: 8 gate, 10 media, 7 retention incl. the planner against an in-memory database).
- Playwright `e2e/core/survey.spec.ts` against this worktree's own dev server (`E2E_BASE_URL=http://localhost:3117`, `RESEND_API_KEY=`): 10/10 incl. auth. New: gate holds the PDF (403 + survey link; browser → Credentials notice), releases after submit (200 `application/pdf`); admin gate switch round-trips; roster `media_ok` = `no` for a 16-year-old at a CO school, `yes` for an adult; `/admin/media` lists her with the NY/CO reason; CSV route returns the list. The new routes exist only on this branch, so the run was against the right server.
- Retention on dev: report today = nothing due (4 participant + 1 email-only clocks, first due 2034-01-01); `--as-of 2040-01-01` lists them; `--apply` with `--as-of` is refused. Apply path proven on dev with a synthetic member deactivated 2018-05-01 plus one invitation: purged (audit row `survey_purge`, actor `retention:<user>`), the 6 seed invitations untouched, fixture member removed afterwards. Never run against prod.
- Screenshots (local only): `/admin/media`, and the Survey-tab gate switch + warning (event data mocked onto a Sanity event, since the e2e/demo events aren't in Sanity; the switch posted `{action:'gate_certificate', on:true}`).
- One leftover `e2e-survey-*` event from this session's first (failed) run was removed with the fixture's `remove`.

### Decisions for David — answered 2 Oct 2026
Answers in **bold** after each item.

1. **No-account retention rule** (proposed above: 7 years after the end of the event year; email-only recipients wait for their latest survey and are skipped if a member has the address). Confirm, or choose another clock. **Agreed.**
2. **Turning deletion on.** The cron only reports until `SURVEY_RETENTION_APPLY=true` is set on prod. Nothing is due before 2033 (account holders) / 2034 (no account), so this can wait; read the monthly `cron_runs` row (`job = 'survey-retention'`) meanwhile. **Agreed: stays off for now.**
3. **Inactive members with no `deleted_at`** have no clock and are never purged; the report counts them. Backfill a date, or accept. **Backfill with today's date** → migration `20261003020253_members_backfill_deleted_at.sql` sets `deleted_at = 2026-10-02` where `is_active = false AND deleted_at IS NULL`. Applied to dev (1 row; ledger row realigned to the filename); prod applies with the survey migrations on promotion.
4. **Legacy Google Forms imports** carry no identity and are never purged by this job, though free text could name someone. Keep indefinitely, or set a date? **Do not import the legacy data at all** (§5 item 4), so nothing to retain.
5. **Gate and minors.** As specified, the gate applies to everyone invited, minors included, and to invitees who opted out of reminders or whose email bounced. Exempt minors (one line in `certificateGate`)? **Do not exempt minors.**
6. **Media defaults are cautious**: a minor with no agreement on file is "no"; a minor whose media box we can't see is "check"; a minor of unknown age at a NY/CO school is "no". On prod, DocuSign-signed minors show "check" until the V2.3 read-back below is live. Confirm, or relax. **Agreed.**
7. **Adults** (mentors, teachers): only their own agreement's media box and their switch apply; no NY/CO default. Confirm. **Agreed.**
8. **Email opt-outs** stay on a manual list. A follow-up could let an admin set `allow_media = false` on a member from a privacy request. **Agreed; no follow-up for now.**
9. **V2.3 agreements branch overlap.** `feat/esign-agreements-v2-3` (applied on dev, not prod) adds `agreements.media_opt_out` / `agreement_version` and the DocuSign read-back. `lib/survey/media.ts` reads those columns when they exist and ignores them otherwise, so either branch can merge first; once both are in, the survey consent loader (`lib/survey/consent.ts`) should move to those columns too, and the version formats (`V2.3` on templates vs `2.3` on agreements) need one convention. **Agreed.** **Done in #283 (5 Oct):** `lib/survey/consent.ts` reads `agreement_version` and the opt-out columns; the template label was removed, so `2.3` on agreements is the one convention.
