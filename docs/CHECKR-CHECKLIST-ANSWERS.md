# Checkr — API Authorization Review Checklist answers (PRD §13)

Paste-ready answers for the Smartsheet API Authorization Review Checklist
(<https://app.smartsheet.com/b/form/c1284692a0be4d0eb73bacdffc66df32>), written to
match Stellr's actual implementation. Fill the **[bracketed]** items before submitting.

Companion: `docs/CHECKR-TESTING-RUNBOOK.md` (how to test) ·
`docs/BACKGROUND-CHECKS-HANDOFF.md` (what was built).

---

## Account & integration profile

- **Company / account:** Stellr (InSim Education) — staging account **[Checkr account name/ID]**
- **Integration type:** **Checkr-Hosted Flow** (API-initiated). We create a Candidate
  then an Invitation; Checkr emails the candidate a hosted apply page where they enter
  PII and give FCRA disclosure & authorization. Checkr (the CRA) owns consent capture;
  Stellr never collects or stores SSNs.
- **Customer type:** **SMB** — the same small ops team performs both recruiting and
  adjudication and has Checkr Dashboard access.
- **Use case:** Clearing adults (18+, non-students — mentors, teachers, parent
  volunteers) to take part in youth STEM programs. The background check is one of two
  acceptable clearances; the other is a verified teaching license.
- **Geography:** **US only.**
- **Who pays:** Stellr is billed per report; the candidate is never charged.
- **Packages:** one **Criminal + SSN-trace/identity** package (production default).
  A **Criminal + MVR** package is used only to demonstrate the partial-cancellation
  (`includes_canceled`) scenario during testing.

## Report initiation

- `POST /v1/candidates` with `first_name`, `last_name`, `email`, `work_locations`,
  `no_middle_name`; SSN and driver-license are **not** sent (Checkr collects them on the
  hosted page). An **`Idempotency-Key`** header (per-member) prevents duplicate candidate
  records on retry.
- `POST /v1/invitations` with `candidate_id`, `package`, `work_locations`
  (Account-Hierarchy compliant). We persist the returned `invitation_url`.
- **Multiple checks per candidate:** supported — an admin can re-order for an existing
  member, reusing the candidate and creating a fresh invitation/report.

## Data validation & error handling

We validate first name, last name, and a well-formed email before any POST; malformed
input is rejected with a clear message and no API call. Checkr API errors are caught,
surfaced to the admin, and the failed attempt is recorded for audit. Duplicate in-flight
orders are blocked (409).

## Webhooks & status mappings

- Endpoint `/api/webhooks/background`, signature verified via
  **`X-Checkr-Signature` = HMAC-SHA256(rawBody, key)**; invalid signatures rejected (401).
  Subscribed to all `report.*` and `invitation.*` events.
- **Assess support:** on `report.completed` we read the **`assessment` field first**
  (`eligible` → cleared; `review`/`escalated` → needs review) and fall back to `result`
  only when no assessment is present.
- **Complete Now / report lifecycle:** we handle `report.canceled` (→ canceled status)
  and read **`includes_canceled`** on `report.completed`, displaying a "completed with
  canceled screenings" indicator. `report.suspended`/`resumed` show as in-progress;
  `invitation.expired`/`deleted` are handled distinctly.

## Access to report details

Admins see a "View report in Checkr ↗" deep link on the member's compliance panel,
restricted to staff with dashboard/adjudication access.

## Adjudication plan

When a report returns **Consider / Needs Review**, Stellr does **not** auto-decide.
The designated adjudicator reviews the report in the Checkr Dashboard, applies Stellr's
eligibility criteria for working with minors, and — where a decision is adverse —
initiates Checkr's built-in **pre-adverse / adverse-action** workflow from the dashboard
so the FCRA notice-and-dispute period is observed. Until a Consider report is adjudicated
as eligible, the member is not cleared to participate.

- **Designated adjudicator:** **David Shaw, CIO — david.shaw@stellreducation.org**

## Account contacts & billing

- **Primary / billing contact:** David Shaw, CIO — david.shaw@stellreducation.org
- **Payment configured in the Checkr dashboard:** **[confirm Yes, or note the agreed
  billing arrangement]**

## Demonstration

- **End-to-end video link:** **[paste after recording]** — covers Clear, Consider,
  Canceled, Pending→resume, and includes-canceled, showing the Stellr status matching
  the Checkr dashboard for each candidate.

---

### Before you submit — outstanding [bracketed] items

1. Checkr staging account name/ID.
2. Confirm billing/payment is configured in the dashboard.
3. Record and paste the end-to-end video link.
