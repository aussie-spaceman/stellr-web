# Handover: Checkr report export for mentors, 28 Sept 2026

Slug `checkr-report-export`. Tracker: `tracker/2026-09-28-checkr-report-export.md`.
PR #247 squash-merged to `dev` as `0f40aef` (dev deployment `dpl_2yVjvBjU93rzbjg8r3S78jsMNDmn`, READY).
**Not promoted.** Migration: none.

## The ask

"As an admin or event manager, I need to be able to export the Checkr PDF
Report on each mentor that has passed their background check, either in bulk
from the event settings page (single PDF), or individually from the member's
account page."

Four questions were asked; the user took every default:

1. **Event managers do not receive Checkr reports.** A Checkr PDF is an FCRA
   consumer report. Admins get the Checkr PDF; event managers get a
   Stellr-generated clearance summary.
2. **Placement.** Event managers can't reach the Settings tab or
   `/admin/members/*` (see `proxy.ts` and `access.isAdmin` in the competitions
   page), so the bulk button went on the **Roster** tab and the per-mentor
   links on roster rows and assigned-volunteer rows. Admins also get a link on
   the member page.
3. **Eligibility.** `deriveCompliance` must give `valid_bc` as of the event
   date: a passed check, or a flagged one adjudicated cleared, unexpired.
   Mentors cleared by license, not cleared, under 18, or with no account are
   listed with the reason.
4. **On demand.** Reports are fetched from Checkr on every download. Nothing is
   stored, and `report_pdf_url` stays unused.

## What changed

| File | Change |
|---|---|
| `lib/background-provider/types.ts` | `fetchReportPdf(reportRef)` on the provider interface; `ReportPdfUnavailableError` |
| `lib/background-provider/checkr.ts` | `GET /reports/{id}?include=documents` → the `pdf_report` document's `download_uri` (falls back to `document_ids` → `/documents/{id}`). Downloads without our Basic auth, https only, and checks the bytes start with `%PDF` |
| `lib/compliance.ts` | `loadComplianceRecordsForMembers(db, ids, emails)` |
| `lib/background-report-export.ts` | Mentor loader (registered `mentor` participants + active volunteers, same sources as badges), `classifyMentor`, cover-page renderer (pdf-lib Helvetica, WinAnsi-safe), merge (4 fetches at a time; a failed fetch is named on the cover), `logReportExport` |
| `app/api/admin/events/[slug]/background-reports/route.ts` | `requireEventAccess`. Admin → `checkr` mode; event manager → `summary`. `?participant=` / `?member=` narrow it to one mentor (an admin then gets Checkr's PDF bare). `maxDuration = 60` |
| `app/api/admin/members/[id]/background-check/report/route.ts` | Admin only; one member's Checkr PDF |
| `components/admin/EventRoster.tsx` | "Mentor Reports (PDF)" / "Mentor Clearance (PDF)" button; per-row link for mentors with `valid_bc` |
| `components/admin/competitions/EventVolunteersPanel.tsx` | Download icon on assigned volunteers with `valid_bc` |
| `components/admin/MemberCompliancePanel.tsx` | "Download Checkr report (PDF)" when `valid_bc` |

Audit actions (category `compliance`): `background_report_downloaded` (one
entry per attached report) and `background_summary_downloaded` (one per listed
member).

## Verified

- Unit tests: 994/994, 27 of them new (`lib/background-report-export.test.ts`,
  plus a `fetchReportPdf` block in `checkr.test.ts`). CI `verify` + `e2e`
  green on #247.
- Locally on port 3010 against the dev database, signed in as the admin
  fixture:
  - The member route, called for two members with passed checks, passed
    eligibility and stopped at 503 "provider not configured". There's no
    Checkr key in `.env.local`.
  - Signed in as the teacher fixture, both routes return 403.
  - Every one of the 11 events returns "No mentors at this event yet". SQL on
    dev confirms 0 mentor participants and 0 volunteers, and that every
    column the loader selects exists.
  - Cover pages rendered from sample rows (summary mode, and checkr mode with
    a failed fetch) were read back as images; they lay out correctly.
- The roster button renders on dev data (screenshot).

## Not verified

- **No real Checkr PDF has ever been downloaded through this code.** The
  document type `pdf_report` and the `include=documents` expansion come from
  Checkr's docs, not from a live response. If Checkr names it differently,
  every download says "Checkr has no PDF for this report yet".
- The event-manager path end to end: there's no event-manager e2e fixture.
- A multi-report merge from real Checkr PDFs. They are loaded with
  `ignoreEncryption: true`; if Checkr encrypts them, the copied pages may come
  out blank.
- Timing for a large event against the 60 s limit.

## Known rough edges

- The volunteers panel derives compliance as of **today**
  (`lib/volunteer.ts`), but the export derives it as of the **event date**. The
  icon can show for someone the export then lists as expired. The server is
  the authority.
- The roster toolbar wraps the new button onto a second line at 1400px.
- The new links use the admin pages' existing `brand-*` link styling, not
  `@stellr/web-ui` `Button`, to match their neighbours.
- `/code-review` was not run. The ship checklist was shown but not gated, per
  "ship means proceed".

## Open items

See `tracker/2026-09-28-checkr-report-export.md`, rows `checkr-report-export.1`–`.6`.
