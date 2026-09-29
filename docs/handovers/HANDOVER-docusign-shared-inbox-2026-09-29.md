# Handover: DocuSign consent when student and guardian share an inbox (2026-09-28/29)

Tracker: `tracker/2026-09-29-docusign-shared-inbox.md`. Slug: `docusign-shared-inbox`.

## Context

Robert Blake (parent of Alexander Blake, Colorado Space Design Challenge) replied
to the 28 Sept "Outstanding Docusign" email. He had entered `rob@savagenet.com`
for both the participant and the guardian, and said DocuSign would not let him
sign on both behalves. He asked for the student to be moved to `alex@savagenet.com`.

Before this session nothing compared the two addresses, and the consent envelope
sent the Guardian and Minor roles concurrently (`routingOrder: '1'` for both).
`lib/docusign.ts` already documented an earlier prod case of the same shape.

## What changed

| PR | Merged to `dev` | What |
|---|---|---|
| #243 | `e8314d8` | `createConsentEnvelope`: when `minorEmail` equals `guardianEmail` (case- and whitespace-insensitive), the Minor recipient gets `routingOrder: '2'`, so DocuSign emails the student's copy only after the guardian signs. Both role emails get an explanatory sentence. Covers the template path and the no-template fallback. |
| #246 | `04b9015` | `describeEnvelope` gains a `queued` list (recipient status `created`). Queued signers are excluded from `neverOpened`. Detail line: `Awaiting X (parent/guardian); Y (student) queued — sent once the parent/guardian signs`. The reminder cron and `docusignReminderToMinorEmail` label a queued signer "DocuSign sends this once the other signature is done". |

Both are on `main` via the fourth 28 Sept promotion (#249, `50d7e61`, record #250,
run by another session). This session did not check the Vercel deployment itself.

Decisions made by David in this session:
- **Not doing** form-level validation that the student email differs from the
  guardian email (option #1), or an in-place "change signer email" admin action (#3).
- Robert's envelope: void and reissue (the DocuSign web UI offers no Correct/Edit on it).

## One-off data actions (production)

- `participants` `0f20348d-7626-4466-9605-1e2e105cddcb` (Alexander Blake):
  `email` changed from `rob@savagenet.com` to `alex@savagenet.com`. David ran
  the SQL himself; auto mode blocked the write from this session. His **member**
  record (`08c5aa7e…`, which has a login) still uses `rob@savagenet.com`
  deliberately, because changing it would change who can sign in.
- Envelope `24bee625-0664-8f52-812a-999f133c0dd9` voided by David (Robert had
  already signed as Guardian). Reissued from the roster as
  `2b2f3d6c-42d6-889d-839f-6c080c345837`: Guardian `rob@savagenet.com` and Minor
  `alex@savagenet.com`, both `sent` (prod read, 29 Sept 03:01Z). It used one
  envelope from the monthly allowance, and Robert must sign again. David has replied to Robert.

## Shared-inbox audit (production, 28 Sept)

Guardian email exists only on `participants` (not `members`). Nine participants
had `lower(trim(email)) = lower(trim(emergency_contact_email))`, all at the
Colorado Space Design Challenge:

- Complete (nothing to do): Jack Campbell, Riley Guggino, Aditya Malgareddy,
  Andres Murphy, Lincoln Treece, Olive Treece, Charles Zhang.
- Alexander Blake: handled above; no longer a shared inbox.
- **Jacksen Davidson** (`55c4a7ed-7d91-8dca-823f-7bf2ebc5b4dd`): Minor signed
  22 Sept 23:28Z, Guardian `sent` and never opened. This matches the known failure
  where a parent signs the student copy and thinks the form is done. David chose
  to leave it to the reminder cron.

The routing fix only applies to envelopes created after it deployed. Neither live
envelope above was re-routed.

## Not verified

- **No shared-inbox envelope has been issued since the deploy.** So neither the
  `routingOrder: '2'` behaviour nor DocuSign's use of recipient status `created`
  for the queued student has been seen in production. Both rest on unit tests
  that assert on our request body and on DocuSign's documented statuses.
- **The fix may not have prevented Robert's actual failure.** He signed as Guardian
  at 21:31Z and opened the student copy at 21:34Z. That is already the order the fix
  enforces, and he still could not sign it. Seven other shared-inbox families
  completed both roles. What DocuSign showed him on the student copy is unknown.
- The "queued" wording has not been viewed in the browser (unit tests only).

## Learned

- **The DocuSign MCP connector cannot act on the app's envelopes.** It authenticates
  as `david.shaw@insimeducation.com`. The app sends as
  `david.shaw@stellreducation.org`. Reads, recipient updates and reminders all
  fail with `USER_LACKS_PERMISSIONS` / `USER_NOT_ENVELOPE_SENDER`.
- **The DocuSign web UI shows no Correct/Edit for these envelopes,** even to
  David. Void and Resend are present. Changing a signer's address means void and
  reissue, which uses envelope quota and loses existing signatures.
- `participants` has no `updated_at` column.
