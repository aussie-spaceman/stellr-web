# Checkr — API Authorization Review Checklist answers (PRD §13)

Paste-ready answers for the Smartsheet API Authorization Review Checklist
(<https://app.smartsheet.com/b/form/c1284692a0be4d0eb73bacdffc66df32>), written to
match Stellr's actual implementation. Fill the **[bracketed]** items before submitting.

Companion: `docs/CHECKR-TESTING-RUNBOOK.md` (how to test) ·
`docs/BACKGROUND-CHECKS-HANDOFF.md` (what was built).

---

## Account & integration profile

- **Company / account:** Stellr (InSim Education) — staging account **`9f700773fc2d10d465427d83`** ("Industry Simulation Education")
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
- **Packages:** one **Criminal + SSN-trace/identity** package — `stellr_crimid`
  (global watchlist, national criminal, sex offender, SSN trace). This is the
  production default and the only package on the account; Stellr orders against a
  single configured package slug. No Criminal + MVR package exists, so the
  partial-cancellation (`includes_canceled`) scenario was not run — see the test
  results document.

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
- **Payment configured in the Checkr dashboard:** **Yes** — confirmed 22 Sept 2026
  ("Payment information has been configured in the account").

## Demonstration

- **Test results:** `docs/CHECKR-CERTIFICATION-RESULTS-2026-09-22.md` — full matrix,
  timings and evidence from the 22 Sept 2026 run against staging account
  `9f700773fc2d10d465427d83`.
- **Demonstrated:** Clear (Bud Richman), Consider → human adjudication (Judge Judy),
  and Pending → resume → Clear twice over (Remy Gonz, Jen Kasp), plus duplicate-order
  rejection, out-of-scope rejection and webhook signature rejection. In every case the
  Stellr status matched the Checkr dashboard.
- **Not demonstrated, with reasons:** the **Canceled** scenario (Vito Andolini) could
  not be forced — his mock SSN suspends the report within ~30 seconds and
  `POST /v1/reports/{id}/complete` then half-applies without reaching a terminal state;
  and **Clear-with-Canceled** (Alex Taylor) requires a Criminal + MVR package, which
  does not exist on this account. Both mappings are covered by unit tests. Happy to
  run either if Checkr can advise on forcing a cancellation past a suspended screening,
  or if an MVR package is added to the staging account.
- **End-to-end video link:**
  <https://drive.google.com/file/d/1yK7T-_-aNKXO0YYFq0aYbCLGRLA95k5L/view?usp=sharing>
  (link sharing is open to anyone with the link — no Google account needed).
  Recorded 22 Sept 2026 on Judge Judy: order from the admin compliance panel →
  Checkr emails the candidate → hosted apply page (SSN entered there, never by
  Stellr) → report completes as **Consider** in the Checkr dashboard → Stellr shows
  **Needs review** and the member is not cleared → the adjudicator opens the report
  from Stellr's deep link → records the decision with a rationale → the member
  becomes compliant with a 3-year expiry.

---

## The Smartsheet form, field by field (answered 22 Sept 2026)

The form asks in a different shape from the prose above. These are the literal
selections, so a re-submission does not have to re-derive them.

**Integration Flow** → `Checkr Hosted Flow`. Checkr hosts the disclosure and
consent page (`apply.checkrhq-staging.net`); we neither self-host that form nor
use the embeds.

**Order Background Checks**

| Field | Answer |
|---|---|
| Candidate Fields (`POST /candidates`) | `first_name`, `last_name`, `email`, `work_locations`. Also `no_middle_name: true` and an `Idempotency-Key` header. **No SSN, no DL** — the candidate enters those on the hosted page |
| Invitation Fields (`POST /invitations`) | `candidate_id`, `package`, `work_locations` |
| Account Hierarchy "Node" Support | **Not applicable** — no nodes are defined. We send `work_locations` instead: `country: 'US'` always, `state` from the member's teacher-licence state when present, else `CHECKR_WORK_LOCATION_STATE` |
| Package Selection Logic | **None of the offered options apply** — see the note below |

**Package Selection Logic — the one mismatch.** All three options describe how an
integration *displays a list of packages for a user to choose from*. Stellr has no
package picker: an admin clicks "Order background check" and the order always uses
the single `CHECKR_PACKAGE_SLUG`. Option 1's premise is true (no nodes defined) but
its behaviour is not, so ticking it would assert something false. Submit with none
selected if the form allows; otherwise tick option 1 **and** state the reality in a
comment or reply. If Checkr treats package selection as required rather than
descriptive, that is a code change — per-order package choice does not exist, which
is also why Alex Taylor's crim+MVR case could not be run.

**Monitor Background Checks**

| Field | Answer |
|---|---|
| Webhook and Status Support | **Yes** — all `report.*` and `invitation.*`, `include_object: true`, HMAC-SHA256 signature verified, mapped to our own statuses |
| Report Lifecycle and Assess Support | **Yes** — `completed / canceled / engaged / suspended / resumed / disputed / pre_adverse_action / post_adverse_action` and `invitation.completed / expired / deleted`; the `assessment` field is read (`eligible` → cleared, `review`/`escalated` → human review) |
| Account Contacts Configured | **Cannot be answered from the repo** — it asks about the PRODUCTION dashboard, which we have never had access to. Confirm all five contacts (Support, Billing, Adverse Action, Technical, Compliance) there, or tell Checkr the production account is not provisioned yet |
| Payment Information Configured | **Yes**, confirmed 22 Sept 2026 |
| Adjudication Responsibility | **Yes** — David Shaw, CIO. Since 22 Sept Stellr also records each decision (outcome, who, when, required rationale to clear) |
| Checkr Background Check Information | **Report status** and **Link to background check report** only. **NOT** "Report ETA information" — the adapter never reads `estimated_completion_time` or `due_time`, and nothing in the UI shows an estimate. Do not use "Select All" |

**What the adjudicator UI actually shows**, for that last field: our mapped status
("Referred"), the ordered date, our own 3-year "Valid until", a canceled-screenings
note when `includes_canceled` is set, the deep link to Checkr, and — after a
decision — the outcome, adjudicator, date and notes. **No report content at all**:
no charges or records found, no individual screening results, no candidate PII, no
adverse-action detail. The raw `result` and `assessment` are stored but never
rendered. That is deliberate: FCRA-sensitive detail stays with the CRA, and our UI
carries only the decision and a pointer to it.

---

### Before you submit — outstanding [bracketed] items

1. ~~Checkr staging account name/ID~~ — `9f700773fc2d10d465427d83`.
2. ~~Confirm billing/payment is configured in the dashboard~~ — confirmed 22 Sept.
3. ~~Record and paste the end-to-end video link~~ — recorded 22 Sept, linked above,
   sharing verified as open to anyone with the link.

**Still blocking submission:** the form's **Account Contacts Configured** question
asks about the production dashboard, which we do not have. And **Package Selection
Logic** has no applicable option (see above) — decide whether to submit with none
selected or to ask Checkr first.

Also worth doing before recording: Checkr's staging mail (`checkrhq-dev.net`) was
being auto-filed to Trash, so the invitation email — which the video is meant to
show — never appeared in the inbox. Add a filter first.
