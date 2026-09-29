# Checkr report export for mentors — 2026-09-28

Slug: `checkr-report-export`. Handover: `HANDOVER-checkr-report-export-2026-09-28.md`. Doc snapshot: `1RXui5HPjrpr_6XP5-vmz9m0GSN5D6YLbIrMIgv8ckEc` (supersedes `1Py8_oXh…`).
PR #247 → `dev` as `0f40aef`; promoted in #249 (`50d7e61`, `dpl_6sdmkoZ84kZqGwmkW8MhkNSPjfXT`); record + sync #250 (`1cbd370`). Migration: none.

Admins download mentors' Checkr PDFs from the member page, the roster row, or in bulk from the Roster tab. Event managers get a clearance summary PDF instead. Live in production since 29 Sept 02:54Z. A real Checkr PDF was downloaded on dev; none yet on prod.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| checkr-report-export.1 | Real Checkr PDF download | David reported the member-route download worked on dev (28 Sept, after #247 deployed). Reported, not observed by the session. This confirms `pdf_report` + `include=documents` | — | ☑ |
| checkr-report-export.2 | Bulk merge of real Checkr PDFs | Unit-tested with pdf-lib-generated PDFs only. Real ones are loaded with `ignoreEncryption: true` | On dev, assign 2 members with passed checks as volunteers on one event (note that assigning sends a DocuSign agreement), export **Mentor Reports (PDF)**, and check the pages aren't blank | ☐ |
| checkr-report-export.3 | Event-manager summary path | Route and summary render unit-tested; never run as a real event manager (there's no fixture) | Sign in as an event manager assigned to an event, export, and confirm it's a summary with no Checkr pages | ☐ |
| checkr-report-export.4 | Promote | #249 merged `50d7e61` 02:54Z; deployment `dpl_6sdmkoZ84…` READY with commit status success; www 200, app 307, cron 401; new routes answer 401/403 signed out. Shipped with #243/#246 (David approved) | — | ☑ |
| checkr-report-export.5 | Volunteers panel "as of today" vs export "as of event date" | Mismatch exists (`lib/volunteer.ts` derives with no event date) | Pass the event date into the panel's derivation, or accept it; the server is authoritative | ☐ |
| checkr-report-export.6 | Large-event timing against `maxDuration = 60` | Unmeasured. Two Checkr calls per report, 4 at a time | After .2, time a 20+ mentor export on prod; if it's near 60 s, raise concurrency or stream | ☐ |
| checkr-report-export.7 | First admin download on prod | No report has been downloaded in production. Prod Checkr uses the live key, a different account from dev's staging | An admin downloads one real mentor's report from their member page on app.stellreducation.org | ☐ |
