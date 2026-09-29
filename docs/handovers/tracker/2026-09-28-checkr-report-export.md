# Checkr report export for mentors — 2026-09-28

Slug: `checkr-report-export`. Handover: `HANDOVER-checkr-report-export-2026-09-28.md`. Doc snapshot: `1Py8_oXh-fk5t-HvwYS8xRtt9-Ej6Ty2uEHNgE27giCo`.
PR #247 → `dev` as `0f40aef`; not promoted. Migration: none.

Admins download mentors' Checkr PDFs from the member page, the roster row, or in bulk from the Roster tab. Event managers get a clearance summary PDF instead. Everything is live on dev; no real Checkr PDF has been fetched through it yet.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| checkr-report-export.1 | Real Checkr PDF download (HIGH, blocks promote) | Never exercised. There is no Checkr key locally. The `pdf_report` type and the `include=documents` expansion are taken from Checkr's docs | On dev, as admin, open `/admin/members/5a883585-df20-4e7e-9533-46567554d46d` → **Download Checkr report (PDF)**. A real PDF closes the row; "no PDF for this report yet" means the document type needs changing in `checkr.ts` | ☐ |
| checkr-report-export.2 | Bulk merge of real Checkr PDFs | Unit-tested with pdf-lib-generated PDFs only. Real ones are loaded with `ignoreEncryption: true` | On dev, assign 2 members with passed checks as volunteers on one event (note that assigning sends a DocuSign agreement), export **Mentor Reports (PDF)**, and check the pages aren't blank | ☐ |
| checkr-report-export.3 | Event-manager summary path | Route and summary render unit-tested; never run as a real event manager (there's no fixture) | Sign in as an event manager assigned to an event, export, and confirm it's a summary with no Checkr pages | ☐ |
| checkr-report-export.4 | Promote | On `dev` only | `promote` after .1 passes (no migration) | ☐ |
| checkr-report-export.5 | Volunteers panel "as of today" vs export "as of event date" | Mismatch exists (`lib/volunteer.ts` derives with no event date) | Pass the event date into the panel's derivation, or accept it; the server is authoritative | ☐ |
| checkr-report-export.6 | Large-event timing against `maxDuration = 60` | Unmeasured. Two Checkr calls per report, 4 at a time | After .2, time a 20+ mentor export on prod; if it's near 60 s, raise concurrency or stream | ☐ |
