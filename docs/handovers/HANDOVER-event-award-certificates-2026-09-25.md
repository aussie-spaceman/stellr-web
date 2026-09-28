# Handover — event award certificates + credentials (25 Sept 2026)

**Shipped:** PR #201, which landed on `dev` as `9f780d3` and was promoted by a separate session in #203 (`839b53c`).
**Migration:** `supabase/migrations/20260925090000_event_awards.sql`.
- Prod: applied by the promote session, which also realigned the ledger (`.claude/releases/promote-2026-09-25.md`).
- Dev: applied, but the ledger is not realigned (17.1).

**Tracker:** `TRACKER.md` Session 17. Doc snapshot `17G-d5fJyavEGDnKzDmdGwWyZ4FbabRunJ_3Bxh3vhrs`.

## What was asked
From the maintainer, with the flyer artwork and a sample CO SDC print attached:
1. Certificates carry only the student's name, placed in the space the artwork leaves for it, on every event.
2. Four certificates, aligned with participant credentials.
3. Admins and event managers assign award winners, then generate certificates and credentials.
4. They upload a template per award.
5. Participants see their credentials in the portal and download each certificate as a PDF.
6. A student can hold at most three: participation, overall champion, and one specialist award.

**Decisions made in Q&A:**
- The award set is fixed and global.
- Champion is a team award: the admin picks a company and every student in it gets it, with individuals removable.
- Specialist awards: exactly one winner per company per award, and one specialist award per student.
- Winners see nothing until an explicit **Issue awards**.
- Name font is Aileron.
- Name position is adjustable per template.

## How it works (the map)
| Piece | Where |
|---|---|
| Award catalogue + rules (pure) | `lib/event-awards.ts` |
| Name-only renderer (cover-fit, placement as artwork fractions, shrink-to-fit, no visible © stamp) | `lib/event-pdf.ts` `generateCertificatesPdf` |
| Templates, students, companies, assignments, recipients | `lib/event-certificates.ts` |
| Issue / reinstate / revoke reconciliation | `lib/event-award-issue.ts` (`planAwardIssue` is pure) |
| Admin API | `app/api/admin/events/[slug]/{certificate-templates, certificate-templates/preview, certificates?award=, awards, awards/issue}` |
| Admin UI (Settings tab) | `components/admin/EventCertificates.tsx`, `components/admin/EventAwards.tsx` |
| Member download | `app/api/credentials/[number]/pdf` renders on the event's award artwork; the wallet at `app/(member)/community/credentials` has a PDF link per row |
| Ownership | `CredentialView.owner_member_id` = the credential's `member_id`, falling back to the participant's current `member_id` |
| Upload signing | `lib/uploads.ts` `event-artwork` uses `requireEventAccess` (managers can upload). Kinds are `badge` (Avery 5392), `badge8395` (Avery 8395; added 25 Sept, #206) and `certificate-<award>` |
| Font tracing | `next.config.mjs` `outputFileTracingIncludes` → `public/fonts/Aileron-SemiBold.otf` |

**Data model:**
- `event_certificate_templates`: primary key `(event_slug, award_type)`, holding `name_y`, `name_max_width` and `name_size`.
- `event_award_assignments`: three unique indexes (one per award; one specialist per student; one per company per specialist award).
- `credentials.award_type`, with a CHECK that event credentials have one.
- The unique index is `credentials_event_award_once`.
- `event_settings.awards_issued_at`.

## What was verified (dev, 25 Sept)
- **Admin UI upload:** the four Canva PNGs went up to `colorado-space-design-challenge` through the admin UI.
- **Name placement:** previews on Letter and A4, with a long name, put the name on the rule. Nothing else is drawn.
- **Seed event (API):** a second specialist award for the same student got a 409.
- **Printing:** `award=all` produced 7 pages.
- **Issuing:**
  - First issue: 4 issued.
  - Second issue: 0 issued, 4 unchanged.
  - Reassign, then issue: 1 issued, 1 revoked.
  - Give it back, then issue: 1 reinstated, 1 revoked.
- **As the member fixture (Ada):** the wallet listed 3, the award PDF downloaded, and another member's PDF returned 404.
- **Suites:**
  - `e2e/core/credentials.spec.ts`: 11/11.
  - CI `verify` and `e2e`: every step succeeded.

**Not verified:**
- The inline PDF preview in a real browser. Headless Chromium draws it blank.
- A real event-manager session. There is no fixture.
- The issue email itself. Dev suppresses mail.

## Open items
The canonical list with State / Next / Done is TRACKER Session 17. In priority order:
1. **17.9 (HIGH, before 3 Oct):** CO SDC on prod has only the old participation background and no award artwork. Upload all four PNGs in the Settings tab, preview each with the longest roster name, then print.
2. **17.10:** make sure CO SDC students are in companies before judging. Champion is chosen by company.
3. **17.11:** the first real Issue awards on prod. Open one credential page and its PDF, and check that one guardian email arrived.
4. **17.1:** realign the dev ledger (a maintainer action; auto mode blocked it).
5. **17.5:** confirm leaving the © stamp off certificates.
6. **17.6:** students with no linked account can't download. Decide on a signed link, or leave print as the path.
7. **17.4:** check the other dev storage buckets.
8. **17.7:** drop `event_settings.certificate_artwork_path` and `certificate_format`.
9. **17.12–17.17:** smaller gaps from the close-out audit. These are the email award wording, grouping the wallet by event, the paper size no longer being remembered, the "emailed" count including suppressed mail, the missing `awards/issue` route test, and the preview in real browsers.

**Rollback note (from the promote record):** code from before #201 issues event credentials with no `award_type`, which the new CHECK rejects. If you roll back to `bc28af1`, run `ALTER TABLE public.credentials DROP CONSTRAINT credentials_event_award_type;`.

## Gotchas learned
- **In vitest, `import path from 'path'` resolves to the npm `path` polyfill** (`util.isString is not a function`). Use `node:path` and `node:fs/promises`.
- **Headless Chromium can't render a PDF inside an iframe.** Verify PDFs by downloading them and reading the pages.
- **A 4:3 artwork is wider than US Letter (11:8.5).** Cover-fit trims the sides on Letter and the top and bottom on A4.
- **The e2e wallet test selects rows by link name.** Any extra link in a wallet row must not repeat the credential title in its accessible name.
