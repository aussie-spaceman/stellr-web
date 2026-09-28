# HANDOVER — Event Email Reminders + DocuSign re-issue (28 Sept 2026)

**Status:** Phase 1 merged to `dev` (#224, `fd35306`). Phase 2 on the PR carrying this file. **Nothing is in production yet.**
Colorado SDC is **3 Oct**; the DocuSign catch-up (§4) only helps if Phase 1 is promoted before then.

## 1. Why

Reminders for the Colorado SDC went out by hand from Outlook on 26–28 Sept. There were four emails: one week to go, outstanding DocuSign, outstanding payment, and the volunteer briefing. Each had the event name, venue and BCC list typed in. The "Outstanding Payment" email went out with the DocuSign subject line and a DocuSign sentence. The event page already knew who was outstanding, but it could not re-send one participant's DocuSign, and its only bulk tool was a fixed-copy button.

## 2. What shipped

### Phase 1 (#224, on `dev`)
- **Roster → Reissue DocuSign** on every row with paperwork outstanding. Admins and assigned event managers can use it.
  - A live envelope is resent to the people who haven't signed. This uses no quota and keeps any partial signature.
  - A voided, declined, missing or bounced envelope answers `409 needsConfirm` first. The button then asks before using one of the **40 envelopes a month**.
  - For a bounced envelope, the old one is voided and a new one issued to the addresses on the participant **now**, so fix the address first.
  - The logic lives in `lib/docusign-reissue.ts`.
- **`resendEnvelope` sends only to outstanding signers.** It used to PUT back every signer, including ones who had already signed.
- **`cron_runs` table** (migration `20260928180000`), written by `docusign-reminders`, `docusign-form-data`, and now `event-emails`.
- `scripts/docusign-resend-outstanding.ts` does a dry run by default and resends live envelopes only.

### Phase 2 (this PR)
- **Email Reminders tab** (`?tab=emails`), between Roster and Training. It is hidden for campaigns.
- **Groups** (`lib/event-emails/audiences.ts`):
  - All participants
  - Parents / legal guardians: the emergency contact of each **minor**
  - Mentors: **assigned volunteers plus this event's event managers**
  - Outstanding DocuSigns: the participant plus their parent
  - Outstanding payments: see the payment decision below
- **Delivery:** one email per address. A parent with two children gets one email naming both.
- **Sender:** "David Shaw, Stellr Education" `<hello@mail.stellreducation.org>`, with replies to `david.shaw@stellreducation.org`. The HTML signature uses the hosted `signature-logo.png`. The "rebranded from @insimeducation" line is left out.
- **Editor:** a TipTap `email` variant of `RichTextEditor`, with no @mentions (typing "@docusign.net" used to open the member picker), no images, a formatting toolbar and an "Insert field" menu. Merge fields are listed in `EVENT_MERGE_FIELDS` (`lib/event-emails/types.ts`).
- **Starter emails** (`lib/event-emails/defaults.ts`): the four drafts approved in the plan. Lines marked `[edit per event: …]` must be rewritten before sending.
- **Attachments:** upload purpose `event-email-attachment` in the existing `community-resources` bucket under `event-email/<slug>/`. The limit is 10 MB per file and 25 MB per email. No new bucket.
- **Actions:**
  - Save
  - Preview recipients: who it reaches right now, rendered as each recipient would see it. The preview never mints pay tokens.
  - Send test to me
  - Send now: confirms the count, and re-sends DocuSign first if ticked
  - Schedule: N days before the event
  - Duplicate: for sent emails, which are read-only
  - Delete: unsent emails only
- **History:** every send, whether manual, scheduled or test, with counts and each recipient's outcome. There is no open or read tracking, by design.
- **Scheduler:** `app/api/cron/event-emails`, run in three daily slots at 15:00, 17:00 and 19:00 UTC (about 9am, 11am and 1pm Mountain).
  - An email is due from N days before the event through the event day. It is skipped once the event has passed.
  - Groups are resolved **at send time**, so anyone who completes before then drops out.
  - The email row is claimed atomically (draft/scheduled → sending), so a click and a cron run can never both send it.
- **Roster:** the old "Email Reminders" button is now a link to the tab. The `/remind` route still exists, and `PLAN-single-email-domain.md` lists it as a sender.

### Decisions made during the build (not in the plan)
- **Payment reminders for a group paid in one go** (by invoice or the organiser's card) go to the **teacher only**, with the group pay link. Parents are chased only where each family pays for its own place. Emailing every parent about a school invoice would alarm them for nothing.
- **Duplicate does not copy attachments.** Removing a file from the copy would delete the stored object that the original's history still names.
- **At most 75 recipients per send**, with sends spaced ~550 ms apart. That fits Resend's ~2 requests a second inside a 60 s function. To go past it, split the groups across two emails.
- **The bulk DocuSign re-send never creates envelopes.** A family with *no* envelope still gets the reminder ("we've just re-sent it"), but nothing was re-sent to them. Use the roster button for those. Production had 0 such participants on 28 Sept.

## 3. Verified

- **Unit tests:** 40 new, and the full suite passes (957/957). They cover:
  - audience rules
  - rendering and escaping
  - the starter emails' merge fields
  - claim-once
  - test sends
  - failure handling
  - PATCH validation and cross-event 404
  - the cron's send/skip/defer logic and the `cron_runs` failure recording
- **Browser (worktree dev server, admin session, sends suppressed with `DEV_EMAIL_SAFELIST=` blank):**
  - Roster link → tab.
  - Added "Outstanding DocuSign". The preview showed 2 recipients: the student reads "because you are registered", the parent reads "because Lily is registered".
  - Attached a PDF.
  - Test send went to the admin.
  - Send now: confirm dialog → "Sent to 2 of 2" → History row.
  - The payment email renders the pay-link line.
  - "One week to go" scheduled at 7 days, flagged "already past, will go at the next run".
- **Scheduled path:** ran the real cron handler (`APP_ENV=prod`, **`RESEND_API_KEY` blank** so nothing could leave the machine) against dev.
  - It sent both due emails and marked them sent.
  - A second run found nothing due.
- **Phase 1:** the Reissue button was exercised against the DocuSign **sandbox**: 409, then a new envelope, then a **resend accepted by DocuSign with the new PUT body**.
- **Test data:** the dev rows, the sandbox envelope and the storage object were removed afterwards.

**Not verified:**
- A real email in a real inbox from this tab.
- Outlook's rendering of the signature table.
- The Vercel crons firing in production (see §5).

## 4. To do at promote (David)

1. **Production migrations**, before the code merges: `20260928180000_cron_runs.sql`, then `20260928200000_event_emails.sql`.
2. **DocuSign catch-up** once Phase 1 is live. Dry run first, then again with `--apply`:
   `npx tsx scripts/docusign-resend-outstanding.ts --event colorado-space-design-challenge --sent-before 2026-09-26`
   This covers 6 envelopes and uses no quota. Confirm the resends in DocuSign itself, not the script's output.
3. **Check the Resend plan.** On Free (100/day, 3,000/month), one "all participants + parents" send for Colorado is about 40 emails.
4. **After the next 09:00 UTC run**, read `select * from cron_runs order by started_at desc`. No `docusign-reminders` row means Vercel isn't invoking crons at all. Check Vercel → Settings → Cron Jobs; the scheduled event emails depend on the same mechanism.

## 5. Open

See TRACKER Session 21.
