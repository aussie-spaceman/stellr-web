# Runbook — privacy retention, deletion requests, and media opt-outs

**Since:** 02-Oct-2026 · **Owner:** David (privacy@stellreducation.org, (801) 810-5848)

**Privacy requests log** (the 30-day clock): [Stellr — Privacy requests log](https://docs.google.com/spreadsheets/d/1OEedQV3f6xUVK-3uj5mfWOKxfR3VvhiF8xXiEJaPfro/edit), Google Sheet in David's Drive. One row per request; never put medical details in it.

The Privacy Policy updated on 02-Oct-2026 makes promises about deletion
deadlines and medical retention that no automated job enforces yet. Until the
jobs exist, this runbook is how Stellr keeps them. **Every step here is a
promise in the published policy. Skipping one makes the policy untrue.**

| Policy promise | Section | How it is kept today | Automated? |
|---|---|---|---|
| Medical information deleted within 90 days after the event, unless needed for an incident record | §8, §10 | Part A, monthly | No — ticket |
| Deletion requests (school, parent, student) completed within 30 days, or a school DPA's shorter deadline | §10, §12 | Part B, per request | No — ticket |
| Only a minimal signed-agreement record kept after deletion | §10, §12 | Part B step 4 | No — ticket |
| Students aged 13+ (and parents) can opt out of promotional media use by email; NY/CO students aged 13–17 are opted out until they opt in | §2, Terms §11.3 | Part C | No — ticket |
| Dietary information follows standard retention (no longer cleared after events) | §8, §10 | Nothing clears it | n/a |
| Seven years after deactivation | §10 | The clock is `members.deleted_at` (set by every deactivation path: admin Deactivate, deletion-registry soft delete, Clerk `user.deleted`). First purge falls due in 2033 | Ticket |

---

## Part A — Medical retention (monthly, first run before the 02-Oct-2026 promotion)

Medical information is `participants.health_conditions` (per event) and
`members.health_conditions` (the saved profile copy). Copies also sit in
`audit_log` (the members trigger writes the whole row on every change) and in
`deletion_archive` snapshots. All four are handled by one generated transaction.

1. **Incident check.** Ask each event manager whether any incident from an event
   that ended more than 90 days ago is still open. For each, note the
   participant UUID(s) whose medical record must be kept.
2. **Generate the SQL** from a checkout with `.env.local`:
   ```bash
   npm run retention:medical-sql -- --keep <participant-uuid>,<participant-uuid> > /tmp/medical-retention.sql
   ```
   Omit `--keep` if there are no incidents. The script reads event dates from
   Sanity (production dataset) and never connects to a database.
3. **Run it** in the Supabase SQL editor for **production**
   (`hwtzpfrnksksxlwwabqz`). Read the counts from the first `SELECT` before
   `COMMIT`; if they look wrong, `ROLLBACK`.
4. **Google Sheets.** For each registration of an event past the 90-day line
   that used a spreadsheet (`registrations.spreadsheet_id`), clear the **Health
   Conditions** column. Leave Dietary.
5. **Exports.** Delete any roster or member CSV downloaded for an event more than
   90 days ago (staff laptops, Drive, email attachments).
6. Note the run date in the privacy requests log ("Medical retention run").

Follow-up ticket: a Vercel cron that does steps 1–3 automatically, and a
migration that stops `audit_members()` copying `health_conditions` into
`audit_log` at all.

## Part B — Deletion requests (school, parent, guardian, or student)

**Deadline:** 30 days from receipt, or the school DPA's shorter deadline.

1. **Intake.** Requests arrive three ways: the online form at `/privacy/request`
   (confirmed by an emailed link; appears in **Admin → Privacy requests** once
   `verified`), privacy@stellreducation.org, or phone ((801) 810-5848; write it up
   as an email to that inbox). The 30-day clock starts at receipt (for the form,
   at `verified_at`). Within one business day:
   - Confirm the requester's authority: the school official on the DPA, the
     parent/guardian who signed the Participation Agreement (match the signer
     email in **Admin → Consent forms**), or the student themselves when they are
     an adult.
   - Log it in the privacy requests log: requester, relationship, student,
     **received date**, **due date** (received + 30 days, or the DPA deadline),
     status.
   - Reply to acknowledge and give the due date.
2. **Find everything.** Admin → Members → the student. Note member id, Clerk
   user, participant rows (one per event), credentials, uploads, community
   posts, post-event survey responses (Admin → Surveys; one per event).
3. **Delete, in this order.**
   1. **Admin → Members → Delete → Hard delete** (type DELETE). This removes the
      member row and its cascades, deletes the Clerk login (unless staff),
      cancels any Stripe subscription, voids in-flight DocuSign envelopes, and
      withdraws credentials (name removed; number kept so a copy can be checked,
      shown as withdrawn).
   1a. **Post-event surveys** go with the hard delete of a member, participant
      or registration: `lib/survey/purge.ts` calls `survey_purge_person()`,
      which deletes the responses, answers, invitations and quote/media
      settings outright — nothing de-identified is kept (handover §14.3) —
      and leaves a content-free row in `audit_log` (`table_name =
      'survey_purge'`). For someone with **no account and no hard delete**
      (e.g. a parent asking about a student's participant row only), run it
      by hand:
      ```sql
      SELECT survey_purge_person(NULL, ARRAY['<participant-uuid>']::uuid[],
                                 ARRAY['<their email>'], '<your name>: request <id>');
      ```
      Aggregates already published are unaffected. A single answer (a name
      volunteered in free text) can instead be blanked with
      `SELECT survey_redact_answer('<response-uuid>', '<question_key>', '<you>', '<reason>');`.
   2. **Participant rows** are kept by the hard delete (member link set to
      null). Clear their personal data in the SQL editor:
      ```sql
      UPDATE participants SET
        first_name = 'Deleted', last_name = 'Deleted', nickname = NULL,
        email = 'deleted+' || id || '@invalid', phone = '',
        ethnicity = '{}', dietary_requirements = '{}', health_conditions = NULL,
        emergency_contact_first_name = NULL, emergency_contact_last_name = NULL,
        emergency_contact_email = NULL, emergency_contact_phone = NULL,
        emergency_contact_relationship = NULL, company_name = NULL
      WHERE id IN ('<participant-uuid>', …);
      ```
      (`date_of_birth`, `gender`, `school_name`, `t_shirt_size`, `age_bracket`
      and `event_role` are NOT NULL; leave them, they are not identifying once
      the name and contacts are gone.)
   3. **Copies:**
      ```sql
      DELETE FROM deletion_archive WHERE entity_type = 'member' AND entity_id = '<member-uuid>';
      UPDATE audit_log SET old_data = NULL, new_data = NULL
       WHERE table_name = 'members' AND record_id = '<member-uuid>';
      ```
   4. **Community content:** delete the student's posts, comments and chat
      messages in Admin → Community (the hard delete only anonymises the author).
   5. **Storage:** delete their files in the `community-resources` and
      `teacher-licenses` buckets.
   6. **HubSpot:** search the student's email (and the parent's, if the request
      covers the parent) → Delete contact → GDPR delete.
   7. **Google Sheets:** delete their row from any registration spreadsheet.
   8. **Stripe:** the customer is kept (payment records, 7 years for tax). Nothing
      to do.
4. **Keep only the minimal signed-agreement record.** The `agreements`
   row(s) (formerly `docusign_envelopes`) survive the hard delete (member link set to null): student name,
   signer name and email, dates, agreement, and the signed document in
   DocuSign. That is the record §10 describes; keep it until seven years after
   deactivation. Do not void or delete completed envelopes.
5. **Close out.** Set the completed date in the log (and mark the request
   `completed` in Admin → Privacy requests if it came through the form), and email the requester
   that it is done, listing the minimal record kept and why (Privacy §10).

**Escalate** if day 25 arrives and the request is still open.

Follow-up ticket: a self-serve deletion request with `received_at`, `due_at`,
`completed_at` on `deletion_requests`, and an executor that does steps 3.2–3.7.

## Part C — Media opt-outs (photos, videos, name, work in promotion)

Students aged 13+ now have two switches in their account (Account → Profile →
"Quotes, photos and media", table `member_privacy_prefs`): quoting of survey
answers and photo/media use. Both default on, and off for NY/CO 13–17-year-olds
until they turn them on. Nothing reads `allow_media` automatically yet — add
anyone with `allow_media = false` to the do-not-use list:
```sql
SELECT m.first_name, m.last_name, m.email FROM member_privacy_prefs p
JOIN members m ON m.id = p.member_id WHERE p.allow_media = false;
```
Opt-out **by email** still works as below.

1. **Opt-outs on signed forms.** The Participation Agreement has a "I do NOT
   consent to photo and media use" box (`MediaOptOut`), on both DocuSign and Stellr
   signing. Anyone who ticked it is on the do-not-use list.
2. **Opt-out emails** to privacy@stellreducation.org from a student aged 13+ or
   a parent/guardian: log it, reply to confirm, and add the student to the
   **media do-not-use list** that whoever selects event photos for marketing
   checks first. Either opt-out (student or parent) turns the use off.
3. **New York and Colorado, ages 13–17:** opted **out** until the student opts
   in by email. Until state of residence is collected, use the school's state as
   the proxy, and treat a student as NY/CO if either applies. Before using any
   student's image, name or work in promotion, check:
   ```sql
   SELECT p.first_name, p.last_name, p.date_of_birth, s.state AS school_state, r.event_slug
   FROM participants p
   JOIN registrations r ON r.id = p.registration_id
   LEFT JOIN schools s ON lower(s.name) = lower(coalesce(p.school_name, r.school_name))
   WHERE (upper(s.state) IN ('NY', 'CO', 'NEW YORK', 'COLORADO')
          OR upper(r.school_address_state) IN ('NY', 'CO', 'NEW YORK', 'COLORADO'))
     AND p.date_of_birth > (current_date - interval '18 years')
     AND p.date_of_birth <= (current_date - interval '13 years');
   ```
   Everyone returned is on the do-not-use list unless they have opted in.
4. Opting out never affects participation.

Survey quotes: the "Quotable answers" export (Admin → Surveys) applies the
parent's `QuoteOptOut`, the student's switch, the NY/CO default, "Don't quote
this response" and withdrawals at the moment of export. To withdraw one quote on
request, paste its response id under "Withdraw a quote" on that page.

Follow-up ticket: the account toggle exists (above); still to do: state of residence at
registration, a `MediaOptOut` checkbox read back from DocuSign like
`CredentialSharingOptOut`, and a column in the roster export.

## Part D — School DPA deletion requests (I14)

Same as Part B, with two differences:

- The **due date** is the DPA's deadline if shorter than 30 days (e.g. a district
  that requires 10 business days). Check the signed DPA before logging.
- The request may cover a **whole cohort**. List every student from that school's
  registrations, log one row per student under one request reference, and close
  the request when the last student is done.
