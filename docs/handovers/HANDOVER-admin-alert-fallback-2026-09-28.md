# Handover — admin alerts reached nobody (28 Sept 2026)

Tracker: TRACKER.md Session 23. Doc snapshot `1bq2KZpqGsDKFBbvBQkonDxSGPJMgMbkN6LCNoQjNEh0`.
Code #228 (`c2b38ba`) was promoted by another session in #231 (`b068c86`). Production
deployment `dpl_7vcJqx5yUzK5g57X6sNaWah9mx11` is READY (checked by SHA).

## What was wrong
`notifyCommunityAdmins` (`lib/notify.ts`) sends only to members whose `staff_roles.scopes`
include `all` or `community`. Prod and dev both had **zero** rows.
- `staff_roles` is filled only from `/admin/staff` (`POST /api/admin/staff-roles`) or by
  `scripts/seed-test-accounts.ts`, which grants the `events` scope only. No migration seeds it.
- Full admins are recognised by the Clerk `role=admin` claim (`lib/admin-auth.ts`). They never
  get a row here, so having an admin never produced an alert recipient.

Affected callers: DocuSign dispatch failure and missing-guardian consent
(`lib/docusign-agreements.ts`), DocuSign bounces (`lib/docusign-recipients.ts`), Checkr
`referred` (`lib/background-sync.ts`), `lib/individual-payment.ts`, and training-resource flags
(`app/api/community/training/[itemId]/flag`).

## What changed
- **Prod data (David approved it in chat).** `staff_roles` now has a row for member
  `3bfe6a67-8f23-4601-90f2-56b4c5139dfe` (david.shaw@stellreducation.org) with scopes
  `{all}`. It was read back with the code's own `scopes && ['all','community']` filter. There is
  no `member_notification_prefs` row, so the defaults apply: in-app and email.
- **Fallback.** When there are no holders, or the lookup errors, the alert is emailed to
  `staffAlertEmail()` (`REGISTRATION_ALERT_EMAIL` → `CONTACT_EMAIL` → `hello@stellreducation.org`)
  with a note saying why. It also logs `console.error`. The send is best-effort.
- `staffAlertEmail()` moved to `lib/email.ts`. Tests are in `lib/notify.test.ts` (5 cases).

## Not verified
- No real alert has yet been seen arriving for David. Delivery is inferred from the code
  defaults.
- The prod fallback address. The Vercel connector gets a 403 when listing project env vars.

## Open (see TRACKER 23.x)
1. **23.1 (HIGH, before 3 Oct).** Alerts raised before 28 Sept were never seen. Run a read-only
   prod audit:
   - `docusign_envelopes` in failed or voided states
   - `docusign_envelope_recipients` that bounced
   - `member_background_checks` flagged or referred
   - envelopes blocked on a missing guardian

   Act on anything still unhandled.
2. **23.2.** David confirms which of `REGISTRATION_ALERT_EMAIL` / `CONTACT_EMAIL` is set on the
   prod project, and that the inbox is monitored.
3. **23.3.** Document that Clerk admins are not alert recipients, on `/admin/staff` and in
   `ACCESS-CONTROL-HANDOVER.md`. Alternatively, have `notifyCommunityAdmins` include Clerk
   admins as well.
4. **23.4.** If every holder has turned off both in-app and email, alerts vanish again. Extend
   the fallback to cover that case.
5. **23.5.** `input.body` goes into `<p>` unescaped, in both `notifyMember` and the fallback.
   Use `escapeHtml`.
6. **23.6.** Dev has no `staff_roles` rows, so every dev alert takes the fallback.
