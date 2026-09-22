# Handover — Checkr certification run + adjudication, 22 September 2026

**For:** whoever submits the Checkr API Authorization Review, or touches
background-check compliance next.
**Follows:** `HANDOVER-checkr-2026-09-21.md` (the code hardening).

Yesterday closed the code gaps. Today ran the certification against live Checkr
staging, found two integration defects and one process gap, and built the
adjudication workflow that the process gap exposed.

## 1. Certification: four passes, two constrained

Full evidence: `docs/CHECKR-CERTIFICATION-RESULTS-2026-09-22.md`.

| Candidate | Checkr | Stellr | |
|---|---|---|---|
| Bud Richman | Clear | `passed`, +3 yr | ✓ |
| Judge Judy | Consider | `referred`, no expiry | ✓ |
| Remy Gonz | Pending → Clear | `invited`→`in_progress`→`passed` | ✓ |
| Jen Kasp | Pending → Clear | same cycle, independently | ✓ |
| Vito Andolini | Canceled | never reached — TRACKER 9.11 | ✗ |
| Alex Taylor | Clear w/ Canceled | no MVR package — TRACKER 9.12 | ✗ |

Plus all four negative behaviours (409 / 400 / 401 forged / 401 absent) and
live polling on both `fetchStatus` branches. The video was recorded on Judge
Judy, covering order → Consider → **Needs review** → adjudicate → cleared.

**Remaining:** fill "billing configured" and the video link in
`docs/CHECKR-CHECKLIST-ANSWERS.md`, then submit Smartsheet form
`c1284692a0be4d0eb73bacdffc66df32`.

## 2. What went wrong, and what it cost

Worth reading before the next run — none of these were the integration.

- **The seed's DOB was wrong for exactly one candidate.** All 14 carried
  `1983-02-10`; **Vito's is `1954-12-07`**. Checkr leaves a mismatched candidate
  "pending indefinitely" with no error, so it is indistinguishable from a slow
  report. It cost three attempts. Seed and runbook now carry each candidate's
  real DOB, address and DL from `API_Mock_Candidates__1_.xlsx` (Drive →
  `Shared drives/InSimEd/Stellr Web App - Resources/Teck Stack/Checkr/`).
- **Two "Consider" candidates returned Clear.** Roll Tide and Samuel Adams, both
  marked deterministic in the sheet. Judy is the only confirmed Consider. Do not
  plan a narration around an unverified expected result (TRACKER 9.16).
- **The SSO-protected alias returns an identical 401.**
  `stellr-web-dev-stellreducation.vercel.app` answers an unsigned webhook POST
  with `401 {"error":{"code":"401","message":"Protected deployment"}}` — same
  status as our own fail-closed check. Only the body distinguishes them.
  Registering it would have reproduced June's orphaned reports with a new cause.
  The bare `stellr-web-dev.vercel.app` is the one that reaches the app.
- **Checkr's staging mail was auto-filed to Trash**, so it appeared that no
  invitations were being sent at all. Filter `checkrhq-dev.net` before a run.

## 3. Adjudication (#146)

`referred` was never treated as passed — it already mapped to `invalid`. But
nothing announced it, the "review queue" covered licences only, the pill was
indistinguishable from "never ordered", and no decision was recorded anywhere.

Now: a `flagged` state with its own pill and filter, admins notified on the
transition, flagged checks in the review queue, and an adjudication record
(outcome / who / when / rationale, rationale required to clear) via
`POST /api/admin/members/[id]/background-check/adjudicate`.

**The check's `status` is deliberately untouched by adjudication** — it mirrors
the vendor's report status, which is the certification pass criterion.
`deriveCompliance` reads the decision alongside it, so a cleared adjudication
makes the member compliant with the usual 3-year validity measured from report
completion. Expect Stellr to read green while Checkr still shows Consider; that
is correct and is worth a sentence to any reviewer.

## 4. State of the environments

- **Production** holds **no** Checkr credentials (`checkr: unconfigured`) and the
  guard refuses to order from a production deployment on staging keys.
- **Dev** has all six vars, the staging webhook `73453daec8e3fea222337f26` →
  `https://stellr-web-dev.vercel.app/api/webhooks/background`, and the corrected
  dashboard host `dashboard.checkrhq-staging.net`.
- Migration `20260922181924_bc_adjudication` is applied to **dev only**.
  Production gets it in the next `promote`, before the code.
- The staging API key exists **only in the Checkr dashboard** — removing the
  stale vars from the prod project deleted the last stored copy.

## 5. Open

TRACKER 9.7 (submit), 9.8 (production cut-over, blocked on Checkr), 9.11 / 9.12
(the two constrained cases), 9.16 (unreliable mock results). Test members remain
seeded on dev under nickname `CHECKR TEST%`; the cleanup block is at the bottom
of `docs/checkr-test-seed.sql`.
