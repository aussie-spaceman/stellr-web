# Handover — Mentor Volunteer Agreement on event assignment (28 Sept 2026)

## What shipped
- **Automatic issue on assignment.** `POST /api/admin/events/[slug]/volunteers` now calls
  `dispatchVolunteerAgreement` after an assignment. The agreement is program-level:
  `envelope_type='volunteer'`, `event_slug='volunteer-program'`, the mentor template, and
  the StellrRepresentative counter-signer. It is valid for 3 years.
  - The call is idempotent: an agreement already signed or already out is not sent again.
  - It is non-fatal: a DocuSign failure alerts admins, and the assignment still stands.
  - The response carries `agreement: issued | on_file | in_flight | failed | not_required | no_email`,
    and the Volunteers panel shows it.
- **`dispatchAgreement` returns a `DispatchOutcome`.** Existing callers ignore it.
- **Mentor ≡ volunteer coverage** (`coveringTypes()` in `lib/docusign-agreements.ts`). The two
  types sign the same document (the Stellr decision of 9 Sept), so each now counts as coverage
  for the other in `findValidAgreement`, `hasOpenEnvelopeForEvent`, the in-flight guard in
  `dispatchVolunteerAgreement`, and `getVolunteerStatuses`. Before this, a mentor who had signed
  at registration would have been sent a second copy on assignment, and would have shown
  "No agreement" in the event panel.
- **Admin member page:** a Volunteer Agreement card (`components/admin/MemberAgreementPanel.tsx`)
  sits under Background Check. It appears for members with the mentor/volunteer role or
  event_role.
  - It shows the status, dates, and each signer (from the recipients synced by Connect).
  - **Resend** appears while the agreement is out. **Issue / Re-issue** appears when there is
    none, or it was declined, voided or expired, and uses the existing
    `/api/admin/members/[id]/volunteer-agreement`.
  - Selection logic lives in `pickVolunteerAgreement` in `lib/volunteer.ts`.
- **Member portal:** `DocusignsSection` now labels `volunteer` envelopes
  "Mentor Participation Agreement". Before, they fell back to a bare "Agreement".

Decisions (David, 28 Sept):
- The agreement is program-level, not per-event.
- The Stellr-side email is DocuSign's counter-signer email only. There is no new admin
  notification.
- The name "Mentor Participation Agreement" stays.
- Issue to all three Colorado SDC mentors now, even though two have not onboarded.

## Verified
- The unit suite passes. New tests are in `lib/volunteer.test.ts` and
  `lib/docusign-agreements.test.ts`.
- The design-token lint and the production build pass.
- On dev (DocuSign sandbox), signed in as admin, with test mentor Alex Taylor:
  - The card started at Not Issued.
  - The first assignment returned `issued`: one `volunteer`/`sent` row with `signers_total=2`.
  - The second assignment returned `in_flight`, with no duplicate.
  - The card then read Issued with Resend, and the event panel read "Agreement sent".
  - Alex was unassigned afterwards. His sandbox envelope is still out.

## Not verified
- Webhook completion flipping the card and pills to signed. Connect cannot reach localhost.
- The per-signer lines on the card, for the same reason.
- The mentor's own `/account` view.

## Retro issue for Colorado SDC: what happened
1. The first attempt failed. At 17:51 and 17:52Z, David issued to Patrick and Pauline, and DocuSign rejected both with
   `ACCOUNT_LACKS_EXTENSIONS_PERMISSIONS`.
   - **Cause:** the prod Mentor template's signer carried DocuSign's **Verify Postal Address**
     extension. It had five address fields bound to `postal-address-verify`, in `extensionData`.
   - The sandbox allows Extensions; the prod Basic API plan does not.
   - The Adult and Minor templates have no extension fields, which is why registrations work.
2. The failure was invisible, for two reasons:
   - The admin Issue route returned 200 and logged `volunteer_agreement_issued` anyway. #227
     fixed that: a rejection now returns 502 with a message on the card, and activity is logged
     only for issued or on-file.
   - The admin alert reached nobody, because `staff_roles` was empty (see below).
   - Patrick and Pauline each still carry **one false "issued" activity row** from 17:51/17:52.
3. David fixed the template. He removed the Address extension and replaced it with one plain
   required text field on page 1.
   - `node scripts/check-docusign-template.mjs mentor <download>` passed.
   - The file has 0 `extensionData` fields.
   - The roles are unchanged: `Mentor` and `StellrRepresentative`, both routingOrder 1.
4. The re-issue succeeded at about 18:20Z. Each mentor has a `volunteer`/`sent` envelope with
   `signers_total=2`:
   - Pauline `1be0cc47`
   - Sophie `2dc9a87f`
   - Patrick `71e45978`
5. By close-out, the StellrRepresentative had signed all three, and Connect recorded it
   (`signers_completed=1`). No mentor had opened theirs yet.

All code from this work is in production:
- #220 via #223 (`0db07ee`)
- #227 via #231 (`b068c86`, `dpl_7vcJqx5yUzK5g57X6sNaWah9mx11`)

## Follow-up: admin alerts reached nobody (28 Sept 2026)
- **Cause.** `notifyCommunityAdmins` (`lib/notify.ts`) sends only to `staff_roles` holders of
  `all` or `community`. Prod and dev both had zero rows. Full admins are recognised by the
  Clerk `role=admin` claim, which never adds a `staff_roles` row. So every admin alert went
  nowhere: DocuSign dispatch failures (two fired unseen on 28 Sept, both
  `ACCOUNT_LACKS_EXTENSIONS_PERMISSIONS`), missing-guardian consent, Checkr `referred`, and
  DocuSign bounces.
- **Prod data (David approved, 28 Sept).** David's member row
  (`3bfe6a67-8f23-4601-90f2-56b4c5139dfe`) now holds `{all}`. It was read back with the code's own
  `scopes && ['all','community']` filter. There is no prefs row for that member, so the defaults apply: in-app
  and email. Dev still has no rows.
- **Fallback.** When there are no holders, or the lookup errors, the alert is emailed to
  `staffAlertEmail()` (`REGISTRATION_ALERT_EMAIL`, else `CONTACT_EMAIL`, else `hello@`) and
  logged with `console.error`. `staffAlertEmail()` moved to `lib/email.ts`. Tests are in
  `lib/notify.test.ts`.
- **Open.**
  - The two alerts from 28 Sept were not resent.
  - Which fallback address prod actually uses is unconfirmed. Check whether
    `REGISTRATION_ALERT_EMAIL` or `CONTACT_EMAIL` is set on the prod Vercel project.
  - A holder who has turned off both in-app and email still gets nothing. The fallback
    covers only the zero-holder case.
  - To add someone, grant a scope on `/admin/staff`.

## Close-out (28 Sept 2026): open items
This list mirrors TRACKER Session 22.

- **22.1 Mentor signatures.**
  - All three are at 1 of 2: Stellr signed, the mentor has not.
  - The event is 3 Oct. Chase the three directly.
  - Don't rely on the reminder cron: its first run since 4 Sept is unproven (TRACKER 21.1).
- **22.2 The webhook has never flipped a `volunteer` envelope to `completed` in prod.**
  - The recipient sync is proven; completion is not.
  - When the first mentor signs, check:
    - the row reads `completed`, with `completed_at` set,
    - the admin card reads Complete, with a valid-until date 3 years out,
    - the event panel reads "Agreement signed".
- **22.3 The mentor's own `/account` view is unverified.**
  - Use admin view-as on Pauline.
  - `DocusignsSection` should list "Mentor Participation Agreement".
  - The `VolunteeringSection` agreement pill should read "Awaiting your signature".
- **22.4 The app's heads-up email (`docusignSentToSignerEmail`) is unconfirmed** for the three
  18:20Z sends. Check the Resend log.
- **22.5 Two false activity rows.** Patrick and Pauline each have a `volunteer_agreement_issued`
  row at 17:51/17:52Z for a send DocuSign rejected. David to decide: leave them as history, or
  delete them. Either way, don't read those rows as sends.
- **22.6 The admin failure-alert copy is wrong for this path.** `dispatchAgreement`'s catch says
  "registered for … Registration succeeded". On the admin Issue and event-assignment paths
  there was no registration. Make the copy depend on where the call came from.
- **22.7 Mentor template tidy-ups:**
  - The address field is 84pt wide.
  - The required text on page 4 (x179 y463) is unlabelled. If it is the mentor's email, label
    it `MentorEmail` and the app will prefill it.
  - There is no `EventTitle` tab, so the app's value is dropped.
  - After any edit, re-run the checker.
- **22.8 Guard against extension drift.** Make `scripts/check-docusign-template.mjs` fail on any
  `extensionData`. A field like that passes every sandbox test and fails every prod send.
- **22.9 Patrick Eaton is not cleared.** His Checkr check has been `invited` since before
  28 Sept, and he has not onboarded (DOB null). Sophie has not onboarded either. Both need a nudge
  before 3 Oct.
- **22.10 #221 (CSV formula escaping) is in production, but this session never read its diff.**
  The classifier blocked the read. It rests on its CI and its PR. Low risk; it is admin-only.
