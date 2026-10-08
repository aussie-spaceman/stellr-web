# Mentor credentials — 8 Oct 2026

Volunteer mentors get a certificate and a verifiable credential for an event,
the same way students do. Before this, credentials went only to student
participants (participation + judged awards) and teachers (Educator PD).

## Decisions (David, 8 Oct 2026)

| # | Question | Decision |
|---|----------|----------|
| Q1 | Who counts as a mentor? | Volunteers assigned on the event's **Volunteers panel**: an active `cohort_members` row with relationship `volunteer` on the event container. In production this is the only place mentors live. No registration has a participant with role `mentor`. |
| Q2 | Certificate name | **Certificate of Appreciation**. The default LinkedIn title is `<Event> — Volunteer Mentor`. |
| Q3 | Wording | **Separate per filter.** Mentors have their own title, description, criteria and skills (`event_settings.mentor_credential_*`). |
| Q4 | Who is issued | **Every assigned mentor**, from one button. Volunteers are not checked in at the door. Revoke covers anyone who didn't turn up. |

Everything else matches the students' credential: the public page, the wallet, minor consent and the age gates (`canShare`), the issued email, the LinkedIn share, the survey gate on the PDF, revoke/re-send, and erasure tombstoning.

## Shape

- **Data.** A fifth award type, `mentor`, on the existing `source='event'`. There is no new source. Mentors have no `participants` row, so the participant-keyed unique index cannot dedupe them. A new partial index `credentials_event_mentor_once (member_id, event_slug) WHERE source='event' AND award_type='mentor'` does it instead. Migration `20261008120000_mentor_credentials.sql` also:
  - widens both `award_type` CHECKs;
  - adds the four `mentor_credential_*` columns.
- **Catalogue.** `lib/event-awards.ts` gains `mentor` (kind `mentors`). `AssignedAwardType` and `isAssignedAwardType` exclude it, so judging never sees it.
- **Admin.**
  - **Certificates panel:** a new Certificate of Appreciation row, with artwork upload, name placement and print. The recipients are `listEventMentors()`. "Download all" skips the mentor certificate while it has no artwork, so it never blocks the students' stack.
  - **Participation credentials panel:** a Students / Mentors filter switches the wording form, the issue control and the issued list. The API is `?audience=` on GET and `audience` in the body for PATCH and POST.
- **Member.**
  - The wallet lists the credential without an "Award" chip.
  - The PDF prints on the event's mentor artwork. Until that artwork is uploaded, it falls back to the default design headed "Certificate of Appreciation".

## Verification

- Unit tests: `lib/event-awards.test.ts` and `lib/credentials.test.ts` (dedupe on member + event + award).
- E2E: `e2e/core/mentor-credentials.spec.ts`. It covers:
  - wording kept separate from the students';
  - issuing to the assigned mentors, and that a second issue creates nothing;
  - the Students list excluding mentor rows;
  - the holder's page, wallet and PDF.
