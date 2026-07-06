# PLAN — DocuSign 1-week reminder + registrant escalation (finding F-15)

**Status of F-15: mostly stale.** A daily 1-week DocuSign reminder cron **already exists and is live in production**. What is genuinely missing is smaller than the finding suggests: reminders fire **once, ever** (never repeat), and there is **no escalation email to the registrant** (the teacher/POC who submitted a group registration). This plan covers only that delta.

## What already exists (verified in code)

| Piece | Where | Verified detail |
|---|---|---|
| Daily reminder cron | `app/api/cron/docusign-reminders/route.ts` | Runs daily 09:00 UTC; auth = `Bearer CRON_SECRET` header (same pattern as the other 7 cron routes in `app/api/cron/`) |
| Cron schedule | `vercel.json` | `/api/cron/docusign-reminders` at `0 9 * * *` — already daily, so no Vercel-Hobby cron-cap issue |
| Query logic | same route, lines 23–28 | `status IN ('sent','delivered')` AND `sent_at < now()-7d` AND `reminder_sent_at IS NULL` — correctly excludes completed/voided/declined |
| Resend mechanism | `lib/docusign.ts` → `resendEnvelope(envelopeId)` | PUT `/envelopes/{id}/recipients?resend_envelope=true`; also available: `voidEnvelope`, `getEnvelopeSignerProgress` |
| Reminder emails | `lib/email.ts` → `docusignReminderToMinorEmail` (line 385), `docusignReminderToSignerEmail` (line 489), sent via `sendEmail` (line 42, Resend) |
| Tracking column | `supabase/migrations/010_docusign.sql` | `docusign_envelopes.reminder_sent_at timestamptz` already exists (no `last_reminded_at` — we don't need one; reuse this column as "last reminded") |
| Rate-limit / idempotency | cron route lines 39–41 | Resends are already sequential (comment cites DocuSign rate limits) and `reminder_sent_at` is updated per-envelope, so a crashed run resumes cleanly |

## The actual gap

1. **One-shot reminders.** `.is('reminder_sent_at', null)` means an envelope is reminded exactly once at day 7 and never again.
2. **No registrant escalation.** The email goes to the member (minor/participant); the guardian only gets DocuSign's own resend. Nobody tells the **registrant** — for group registrations that is the teacher (`registrations.teacher_email` / `teacher_poc_email`, see `supabase/schema.sql` and `supabase/migrations/008_student_manager.sql`). Linkage exists: `docusign_envelopes.participant_id → participants.registration_id → registrations`.

## Proposed change (small — modifies the existing route, no new cron)

1. **Migration `122_docusign_reminder_count.sql`** (next free number after `121_volunteer_program.sql`):
   `ALTER TABLE docusign_envelopes ADD COLUMN IF NOT EXISTS reminder_count int NOT NULL DEFAULT 0;`
   Backfill: `UPDATE ... SET reminder_count = 1 WHERE reminder_sent_at IS NOT NULL;`
2. **Query change** in `app/api/cron/docusign-reminders/route.ts`: replace `.is('reminder_sent_at', null)` with `.or('reminder_sent_at.is.null,reminder_sent_at.lt.' + sevenDaysAgo)` and add `.lt('reminder_count', 3)` (cap at 3 reminders, then stop — decision point: cap value) and `.limit(100)` as a daily batch cap.
3. **Escalation email**: on the 2nd reminder onward (i.e. `reminder_count >= 1`), also email the registrant — join to `registrations` via `participant_id`, use `teacher_email` for group registrations (for individual registrations the participant is the registrant, so skip). New template `docusignEscalationToRegistrantEmail` in `lib/email.ts`, following the two existing `docusignReminder*` templates.
4. **Update tracking**: set `reminder_sent_at = now()` and `reminder_count = reminder_count + 1` per envelope (keeps the existing resumable/idempotent pattern).
5. **No `vercel.json` change** — the daily entry already exists. Do NOT make it hourly: Vercel Hobby caps crons at daily and an hourly entry blocks all deploys (known gotcha).

## Decision points for the owner
- Reminder cap: 3 total? Then void the envelope, or leave it dangling for admin re-issue (re-issue UI already exists per F-15 context)?
- Escalate to teacher on 2nd reminder or every reminder?

**Recommended next step:** approve the two decision points above, then have Claude Code implement migration 122 + the ~40-line route/email change in one PR. **Effort: S** (half a day incl. testing; the hard parts already exist).
