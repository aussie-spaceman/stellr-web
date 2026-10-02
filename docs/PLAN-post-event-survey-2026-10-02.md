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
| Agreement version "V2.3" | No version labels. Dev has minor template v1/v2 only; DocuSign-signed rows carry no version. | New `esign_templates.document_version` (e.g. `V2.3`), frozen once set. A minor is invitable only if their newest valid minor agreement was signed on a template labelled ≥ V2.3. **Until a V2.3 template is published, no minor is invited** (shown as "awaiting V2.3 consent"). DocuSign-signed V2.3 agreements cannot be recognised. **David:** if V2.3 also goes out on DocuSign, say so. |
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
| Legacy import | `scripts/survey-import-legacy.ts`, `docs/survey/legacy-mapping.md` |
| Deletion | `lib/deletion/execute.ts`, runbook Part B, retention schedule |

## 4. Rollout

1. Dev migration, seed a fake event (`scripts/survey-seed-dev.ts`), run all three paths.
2. David on a phone, each path ≤ 5–6 min; signs off intro + reminder copy.
3. Publish v1 on prod (separate approval), apply prod migration (David runs it).
4. First live event; retire the Google Form after it.
