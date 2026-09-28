# Handover — Mentor agreement emails indistinguishable (28 Sept 2026)

Slug: `mentor-agreement-emails`. Tracker: `tracker/2026-09-28-mentor-agreement-emails.md`.
Shipped: #241 → `dev` `ed475c9`; promoted in #242 (`4b197c7`, `dpl_HzM333Uc1YAxacFPGwSpCBYgTRW4`); record #244 (`e86cf53`). Migration: none.

## What was reported
David added himself as a mentor for Colorado SDC (3 Oct) so he could do his own background check. He received "the Stellr part" of the DocuSign but nothing personal, even though both should go to his address. None of the other three mentors (Pauline Davila, Sophie Fleck, Patrick Eaton) had acted either.

## What was actually wrong
It was not a delivery failure.
- **Prod DB:** all four `volunteer` envelopes had the StellrRepresentative (hello@) `completed` and the Mentor stuck at `sent`, never delivered. Consent envelopes from the same account delivered normally, so DocuSign sending in general was fine.
- **David's Gmail:** at 21:24:21Z DocuSign sent **two** emails, one to david.shaw@ (Mentor) and one to hello@ (rep). Both had the same sender ("Stellr | David Shaw"), the same subject ("Mentor Participation Agreement — Stellr Volunteer Program") and the same body. Gmail threaded them with the three earlier hello@ copies, filed under "3. Community/Volunteers/Admin". David opened the hello@ copy and counter-signed; his own signature never started.
- **Code:** `createMentorAgreementEnvelope` and `createVolunteerAgreementEnvelope` set only an envelope-level `emailSubject`. `createConsentEnvelope` had already solved the same problem for Guardian/Minor with per-recipient `emailNotification`, but that fix was never applied to the mentor path.
- **Template:** the Mentor template (12:17 MDT download) has identical delivery settings for both roles (plain email signers, no `clientUserId`, no SMS). It was not the cause.

## What changed (#241)
- **`lib/docusign.ts`:** a new `mentorAgreementRoles()` builder, shared by the mentor and volunteer creators (they were copy-pasted). Each role gets its own `emailNotification`:
  - Mentor: `Your signature: Mentor Participation Agreement — <name>`
  - Rep: `Stellr counter-signature: Mentor Participation Agreement — <name>`. The body says the mentor receives a separate email.
- **`lib/docusign-volunteer.test.ts`:** a body-level test that pins the distinct subjects for both creators.

## Verified
- #241 and #242: `verify` + `e2e` passed, checked by step outcome.
- A production deployment exists for merge SHA `4b197c7` and is READY.
- Site checks: www 200; app 307 → `/sign-in`; cron guard `Unauthorized`.
- David's envelope `cc25fb6c` is `completed`: Mentor signed 21:48:42Z, `completed_at` 21:49:04Z. This proves the webhook completion path for a `volunteer` envelope in prod, which is the DB half of 22.2.

## Not verified
- **The new per-role subjects have not been seen in a real inbox.** No mentor envelope has been issued since the deploy; the first one is the proof.
- **DocuSign's own audit trail** (`/audit_events`) for the three other envelopes was never read. The DocuSign MCP is bound to a different, empty account, and pulling prod credentials was blocked by auto mode. So whether Pauline, Sophie and Patrick received their emails is inferred (the Mentor role demonstrably emails), not observed.

## Open items
- `mentor-agreement-emails.1`: the three mentors are still at 1 of 2, with the old identical subjects. **David is chasing them manually** before 3 Oct.
- `mentor-agreement-emails.2`: confirm the new subjects on the first post-deploy mentor envelope.

## Declined
- Relabelling the Mentor template's MentorEmail / EventTitle tabs. David said to ignore it this session; it stays under 22.7.
