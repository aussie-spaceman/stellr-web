# Handover — group registration follow-ups (28–29 Oct 2026)

Tracker: `docs/handovers/tracker/2026-10-28-group-registration-followups.md` (rows `group-registration-followups.1–.12`). People are named only in the Doc snapshot, against the row IDs.

## What happened

On 27 Oct a teacher registered a group of 18 students plus themselves for the Minnesota Environmental Design Challenge (registration `0e416e3b-8a3d-4348-b1fb-88e4f3873ff9`). The group route issued one agreement at a time (~5 s each, DocuSign) inside the request and had `maxDuration = 60`. The function was killed after ~10 agreements. Everything after the loop never ran: no Google Sheet, no join link, no Stripe invoice, no confirmation email. Two guardian emails were invalid (a placeholder and a missing dot), DocuSign refused them, and the refused sends were shown as "Voided". The students were rostered into the event Space but had no logins, and Teacher Tools → Group spaces showed every event space as "a membership tier · 0/18" because it counted tier rows only. The teacher was locked out of their own event page by the payment/paperwork gate (`ACCESS_GATES_ENFORCE` is on in production).

## Production repair (28 Oct, each send approved by David)

- One guardian email corrected by SQL (participant + member row); 8 agreements sent from the admin reissue route.
- **7 duplicate envelopes** were created by mistake: a Claude in Chrome `javascript_tool` loop lost its connection and the extension re-ran it, so two copies raced past the in-flight check. All 7 were voided through admin deletion (guardians received a DocuSign void notice). Lesson recorded: never send side-effecting requests in a loop from `javascript_tool`.
- After #472 was live, admin "Finish setup…" ran on the registration: sheet and join link created, $1,843 invoice sent, confirmation sent, 18 student logins created and emailed, organiser clearance notice sent, 0 new envelopes.
- Still open: one student's guardian email is a placeholder (`.1`).

## What shipped

**#471 → promoted #472 (`82b0e192`)**
- `app/api/register/group`: billing, sheet, join link and confirmation run in the request; agreements, logins and clearance notices run after the response (`lib/group-registration-followup.ts`, `runAfterResponse`), stopping at a 250 s budget; `maxDuration` 300. Emails typed on the form are validated client- and server-side (`isValidEmail` in `lib/member-enums.ts`). Invoice code moved to `lib/group-invoice.ts`.
- Daily esign maintenance gains `missing` (participants from the last 3 days with no agreement row, settled 15 min) and `accounts` (`lib/group-account-invites.ts`).
- `sendGroupAccountInvite` (`lib/member-invite.ts`): passwordless Clerk login + "your account is ready" email, once per member; under-13s wait for a completed agreement.
- Roster: refused sends read "Couldn't Send" with the reason (`describeIssueError`); deterministic row choice; adults with no agreement read "Not Issued"; **Fix guardian email** (`/api/admin/events/[slug]/participants/[pid]/guardian`); **Finish setup…** (`/api/admin/registrations/[id]/finish-setup`, `lib/group-registration-setup.ts`) previews and runs only missing steps and finds an existing Stripe invoice by metadata.
- Member portal: organisers are never gated on `/community/events/[slug]` and see "Your group" (`lib/group-status.ts`); a banner across the portal lists outstanding payment/paperwork/clearance (`lib/member-outstanding.ts`); Group spaces counts with `resolveSpaceAudiences`.
- Clearance: notice at registration and 14 days out (`lib/compliance-notify.ts`, background-sync cron); admin can view, enter and upload a teaching license for a member.

**#474 + #476 (on `dev`, promotion #475 handed to another session)**
- New clearance state `awaiting_verification` ("Waiting verification"); staff alert on teacher license submit/upload (`lib/license-review.ts`, one per 30 min); teacher emailed + bell when verified; Background checks page loads adjudication columns.
- #476 fixed a timing race in `ComplianceSection.test.tsx` that failed #475's first verify run.

## How to use what was built

- **A group registration was cut off:** event roster → the group's header → **Finish setup…**. The dialog previews what is missing; nothing is sent until **Run selected**. Steps already done are skipped.
- **A student's consent form couldn't be sent:** roster pill "Couldn't Send" names the reason → **Fix guardian email** saves the address on the participant and member rows and sends (one envelope). If a form is already out, use **Correct email** instead.
- **A teacher uploads a license** (after #475 is live): staff get a bell + email "License to verify" → member page → View document → Mark verified → the teacher is emailed. Until then, look under Background checks → Needs attention.

## Not verified

See tracker `.6`, `.8`, `.9`, `.10`. The new cron steps' first production runs are verified (`.7`).

## Open items, most important first

1. `.1` placeholder guardian email for one MN student — needs the organiser.
2. `.3` #475 promotion (another session).
3. `.2` reconcile retries per marker, not per participant — small code fix; removes the triple daily alert.
4. `.4` organiser clearance; `.5` invoice payment.
