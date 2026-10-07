# HANDOVER — Educator PD credentials (7 Oct 2026)

**Not yet on `dev`, not in production.** PR #320 (`feat/educator-pd-credentials`) is open with squash auto-merge. The first CI run failed on the new e2e spec (fixed in `9314ed5`, CI re-running at close-out). Promotion #318 (`ee441ad`, 7 Oct) did **not** include it. Maria Gordon has **not** been created or issued anything.

Tracker: `tracker/2026-10-07-educator-pd.md` (rows `educator-pd.1–.11`). Design and decisions Q1–Q8: `docs/PLAN-educator-pd-2026-10-07.md`, on the #320 branch until it merges.

## Context

The ask: recognise teachers who support events.
- Give them a **PD certificate** showing their hours, mapped to standards, for their own certification.
- Give them a **LinkedIn credential**.
- Build it from Maria Gordon's case: 8 hours at the STEM School event, no Stellr account. She must be created through the same flow as mentors, including the "complete your info" email.
- A separate Cowork session is making the certificate artwork. This session built the system around it.

### Decisions (David, 7 Oct)

| # | Decision |
|---|---|
| Q1 | Recognition is manual only. |
| Q2 | The admin enters hours per person. |
| Q3 | Standards are NGSS and Common Core. |
| Q4 | No survey gate. |
| Q5 | Two emails, exactly as today. |
| Q6 | One global Cowork background, with the fields drawn by the app. |
| Q7 | One LinkedIn entry per event, with the hours in the title. |
| Q8 | One fixed Stellr-wide standards set: NGSS SEP 1, SEP 6, ETS1, and CCSS MP1, MP4, CCRA.SL.1. **Confirmed by David on 7 Oct.** |

## What changed (#320)

- **Database:** `credentials` gains `source='pd'`, `pd_hours`, `standards`, `activity_title`, `activity_date` and `activity_location`.
  - Index `credentials_pd_once`: one live PD credential per member per event.
  - Check `credentials_pd_shape` deliberately does not require `member_id`. Erasure nulls it through the FK.
  - Migration `20261007120000_pd_credentials.sql` is **applied to dev, with the ledger realigned. Not applied to prod.**
- **Issue route:** `POST /api/admin/events/[slug]/pd-credentials` is **admins only**. Event managers get a read-only `GET`.
  - Title, date and venue come from Sanity.
  - If Sanity has no document for the event, the route falls back to the registrations' `event_title`. That certificate then has no date or place.
- **Admin UI:** an **Educator PD** panel on the competition Settings tab (`components/admin/EventEducatorPd.tsx`).
  - Search a member, enter hours, Issue.
  - A link to "Add them first", which goes to `/admin/members/new?return=…` and comes back to the event afterwards.
  - Revoke and Re-send.
  - Global artwork upload and preview.
- **Certificate:** `lib/pd-certificate.ts`.
  - Draws on the artwork stored at `community-resources/pd-certificate/current`, or on a plain fallback page if none is uploaded.
  - All field positions sit in `PD_LAYOUT`.
  - A long standards list wraps to two lines rather than shrinking below 8pt.
- **Credential page:** shows a PD-hours pill, a "Professional development" block, and an "Aligned to" standards list.
- **PDF route:** gains a `'pd'` branch with no survey gate.
- **Email:** `credentialIssuedEmail` gains `pdHours`. That adds the licence-renewal line and an "unfinished account" sharing line.
- **Participation list:** the participation credentials list now filters `source='event'`.

## Verified (and how)

- **Locally against the dev DB:**
  1. Add member (teacher, invite on), then back to the panel.
  2. Issued 8 hours. A second issue returned the existing credential.
  3. Revoke, then issue again, gave a new number.
  4. The owner page shows hours and standards.
  5. The owner PDF returned 200.
  6. The wallet lists the credential.
  7. Both emails were read in the hello@ inbox. Dev routes mail there with a `[dev → addr]` prefix.
- **Checks:** `tsc`, `lint:tokens`, `lint:migrations` and `next build` pass. The vitest suite is green.
- **Playwright:** `e2e/core/pd-credentials.spec.ts` passes locally, including with `NEXT_PUBLIC_SANITY_PROJECT_ID` unset.

## Not verified

- **CI on `9314ed5`.** The first run (`942db12`) failed on this spec with "Event not found". The local run had used Sanity, and CI has none.
- **Production.** Nothing is there.
- **An admin-created teacher going end to end:** sign-in, onboarding, then Add to LinkedIn. Nobody has signed in as one. Tracker 15.1 has the same gap.
- **The certificate on the real Cowork artwork.** `PD_LAYOUT` positions are guesses tuned only on the plain page.

## Gaps found at close-out

1. **"Promoted" was not true for this work.** #320 had not merged when #318 was promoted. Re-check `gh pr view 320` before the next `promote`, following the memory note on verifying merges.
2. **I reported the change as verified before CI had run.** The local e2e passed only because the local server had Sanity.
3. **The core deliverable is not done.** Maria has not been issued anything.
4. **Single-day only.** `activity_date` uses Sanity `date`; a multi-day event's `endDate` is ignored.
5. **Inbox, out of scope.** Two guardian replies dated 6 Oct are unanswered: Davidson, and the parent of Lily Nylund. Both say they cannot open a credential. They are most likely the family-link issue fixed in #312 and covered by the `credential-family-link` rows.
