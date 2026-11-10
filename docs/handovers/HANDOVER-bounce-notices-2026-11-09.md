# Handover: bounced signing emails — 2026-11-09

Tracker: `tracker/2026-11-09-bounce-notices.md` (rows `bounce-notices.1`–`.12`). Doc snapshot: `1l77-EtqsSuGMO9o_aq6JY3-Kni8_NXz6v7-Tekd1tfg`.

## Status

**Committed, on `dev` and in production.** PR #585 squash-merged to `dev` (`68e10fc2`), promoted in #587 (`6026dd22`). The migration reached production before the code.

## Why

A guardian's address bounced on a Minnesota EDC group's consent form. The alert reached only the one staff member holding the `all` scope. The group's teacher, the student on the form and any event manager were never told, and nobody but staff could fix it. Separately, three code paths each raised their own bounce alert, with different wording, masking and escaping, none naming the tenant. A bounce first seen by the reminder cron or the roster refresh was never announced at all.

## What changed

- **`lib/esign/bounce-notices.ts`** is the only place a bounce is announced, for both engines:
  - DocuSign: from `syncEnvelopeRecipients` (Connect webhook, reminder cron, roster Correct email refresh);
  - Stellr signing: the Resend bounce webhook (`lib/esign/bounces.ts`) and a send held by the suppression list (`lib/esign/outbox.ts`).
- **Once per address:** a compare-and-set on `agreement_recipients.bounce_notified_email`. A corrected address that bounces again is announced again. The migration backfilled existing bounces as announced.
- **Audience:**
  - admins (the tenant's alert audience) and the event's active managers see the full address, the reason and a roster link;
  - a group's registrant (teacher or student manager) and nominated teacher see the full address and a Your group link;
  - the other signer on a guardian + student form (any age) sees a masked address and a one-time link;
  - never the dead address; a family sharing one inbox is skipped; a form no longer live goes to staff only.
- **`lib/esign/email-changes.ts`, table `agreement_email_changes`:**
  - organisers: **Fix email** in Your group, bounced signers only. It refuses the organiser's own address and any student's in the group, allows 3 changes per form per day, and a roster edit of a bounced address fixes the live form too;
  - parent: corrects the student's address through the one-time link, applied at once, never to the parent's own address;
  - student: suggests the parent's address; the group's organiser approves it, or an admin or event manager for an individual registration;
  - one-time link: 32 random bytes, only the SHA-256 stored, in the URL fragment, single use, 7 days, dead once the form changes;
  - every change is announced to staff and the event manager, and to the other signer when an organiser made it.
- **Staff Correct email** lists waiting suggestions with approve and reject, warns when the new address has bounced before, and supersedes open links.
- **Owner decisions:** a student manager has the same rights as a teacher (risk accepted); under-13s get the notice; a student's suggestion needs an adult.

## Not verified

- No real Fix email, link use or approval has run (`.3`). The event-manager path has never fired, because no live event with a bounce has an assigned manager (`.4`).
- The teacher's and the student's emails for the Minnesota form were sent without errors, but delivery is unconfirmed (`.2`).

## Open items

- `.1`: the Minnesota form still holds the bounced address; Stellr has no correct one. Notices were re-sent 9 Nov; the student's suggestion link expires 16 Nov.
- `.5`: one other bounced signer on production, on a 28 Oct form no longer linked to a participant. The owner decides whether to re-run, void or leave it.
- `.6`/`.7`: `verify:prod` has a stale GTM check and reads whatever env the checkout holds.
- `.8`: guard-file edits in #585 (tenancy tests, tenant-surface baseline) want the owner's read.
- `.9`: `/sign/email` stays pending on tenant hosts until links are built there.

## For the next session

- Re-sending a notice for one form: set `bounce_notified_email` to NULL on that `agreement_recipients` row, then open Correct email for the form (or `GET /api/admin/agreements/<id>/correct-recipient`). That sync announces it. Production SQL needs the owner's yes.
- A new tenant child table after S5 C0b: add it to `LATER_CHILD_MIGRATIONS` in `lib/tenancy/isolation.test.ts` and `POST_C0B` in `lib/tenancy/registry.test.ts`, re-create the parent's carry trigger with the table added, and regenerate both pgTAP files.
