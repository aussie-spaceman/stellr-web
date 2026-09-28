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

## Open items: prod retro issue for Colorado SDC (after promotion)
1. Confirm that `DOCUSIGN_STELLR_REP_EMAIL` is set on the prod Vercel project. It is set on dev.
   Without it, `signers_total` is 1 and Stellr gets no email.
2. No mentor or volunteer envelope has ever been sent in prod.
   - Run `scripts/verify-prod-services.ts` to confirm the mentor template resolves.
   - It won't show whether the template has the MentorEmail and EventTitle tabs. The 9 Sept
     handover says they may be missing, and missing tabs arrive blank.
3. On prod `/admin/members/<id>`, click **Issue agreement** for each mentor:
   - Patrick Eaton `8c1df004-f862-465b-afa6-23c70589898f`. He has no phone on file, so
     MentorPhone will be blank. His Checkr check is at invited.
   - Sophie Fleck `297c9fb0-d5a3-4099-90ee-694d0ef2bcda`. Not onboarded yet (DOB is null).
   - Pauline Davila `aaf02268-5735-4e13-af90-24af81b5e927`.

   This was deliberately done through the UI rather than a script, so prod keys stay off local
   disk and each issue is logged against the admin who sent it.
4. After step 3, confirm the three rows are `sent` with `signers_total=2`, and that the
   Colorado SDC Volunteers panel shows "Agreement sent" for all three.
5. Envelope budget: 23 of 40 used in September as of 28 Sept.
