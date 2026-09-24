# Checkr API certification — test results, 22 September 2026

Evidence for the API Authorization Review Checklist. Every row below was run
against the **Checkr staging account `9f700773fc2d10d465427d83`** and the
deployed Stellr dev app (`https://stellr-web-dev.vercel.app`), package
`stellr_crimid`, webhook `73453daec8e3fea222337f26` → `/api/webhooks/background`
with `include_object: true`.

Pass criterion (Checkr's): **the status shown in Stellr matches the status in
the Checkr dashboard** for each candidate.

## 1. Mock-candidate matrix

| Candidate | SSN | Checkr result | Stellr `status` | `result` / `assessment` | Expiry | Verdict |
|---|---|---|---|---|---|---|
| Bud Richman | 544-25-5544 | Clear | `passed` | clear / eligible | 2029-09-22 | **PASS** |
| Judge Judy | 667-68-6677 | Consider | `referred` | consider / review | none | **PASS** |
| Remy Gonz | 223-23-2239 → 223-23-2230 | Pending → Clear | `invited` → `in_progress` → `passed` | clear / eligible | 2029-09-22 | **PASS** |
| Jen Kasp | 110-10-7777 → 110-10-1110 | Pending → Clear | `invited` → `in_progress` → `passed` | clear / eligible | 2029-09-22 | **PASS** |
| Vito Andolini | 494-24-7562 | Canceled | `in_progress` | — | — | **not reached** (see §4) |
| Alex Taylor | 544-21-5544 + MVR | Clear w/ Canceled | — | — | — | **not run** (see §4) |

Timings, from the audit log and row timestamps:

- **Bud** — ordered 15:36:13Z; `invitation.completed` 15:47:11Z (report id captured);
  `report.completed` 15:47:47Z. 36 seconds from submission to cleared.
- **Judge Judy** — ordered 16:32:02Z; completed 16:43:13Z. A Consider did **not**
  auto-clear: it landed on `referred` for human adjudication, and no expiry was stamped.
- **Remy** — ordered 16:56:26Z; bad SSN suspended the report at 16:59:25Z
  (`in_progress`, orange "In Process"); correct SSN supplied in the Checkr candidate
  portal; cleared 17:02:44Z with a fresh 3-year expiry.
- **Jen** — ordered 16:56:27Z; suspended 17:00:28Z; cleared 17:08:51Z. Independent
  repeat of the suspend/resume cycle.

Validity is Stellr-enforced at **3 years from completion**; only a `passed`
report is given an `expires_at` (Judy's is null, correctly).

## 2. Required behaviours

| Behaviour | Evidence |
|---|---|
| Duplicate order blocked | `POST …/background-check` while one is in flight → **409** "A background check is already in progress for this member" |
| Data validation / scope | Order for a student-role member → **400** "This member does not require a background check". Malformed name/email is rejected before any Checkr call |
| Webhook signature — forged | `X-Checkr-Signature: deadbeef` → **401** "Invalid signature" |
| Webhook signature — absent | no signature header → **401** "Invalid signature" |
| Fail-closed when unconfigured | With no `CHECKR_WEBHOOK_SECRET`/API key the verifier rejects rather than accepts — production currently holds no Checkr credentials and answers unsigned POSTs with 401 |
| Assess handled | Judy returned `assessment: review` alongside `result: consider`; Bud and Remy/Jen returned `eligible`. Mapping is result-primary so an Assess tag never silently overrides a clear result |
| Adjudication is human | A `consider`/`review` report maps to `referred` and the member is **not** cleared. Stellr never auto-decides; the adjudicator works the report in the Checkr dashboard |
| Reconciliation if a webhook is missed | `GET /v1/invitations/{id}` and `GET /v1/reports/{id}` polling, exercised live on both branches: a pending invitation correctly yielded "nothing to apply", and a pending report correctly mapped to `in_progress` with no spurious update |
| Audit trail | `background_check_ordered` (actor: admin, named) and `background_check_passed` / `_referred` (actor: system, `source: webhook`) written to the member activity log with result and assessment |

## 3. Surfaces

The derived compliance state is shown identically on the admin member panel, the
admin audit dashboard (`/admin/compliance`), the volunteers console and the
member's own account page — all from one derivation (`lib/compliance.ts`), so
they cannot disagree. Confirmed for Bud (green "BC Passed — valid until
Sep 22, 2029"), Judy ("Invalid", flagged) and the in-flight candidates
("In Process").

The event-roster column derives from a participant's role for a specific event;
the mock candidates hold no event participation, so that surface was not part of
this run.

## 3a. Adjudication of a flagged report — exercised end to end (22 Sept)

Added after the original write-up, which predated it.

A Consider does not clear anyone. The named adjudicator reviews the report in
the Checkr dashboard and records the decision in Stellr, and only then does the
member become compliant:

| | |
|---|---|
| Candidate | Judge Judy — Consider / `review` → `referred` |
| Stellr state | **Needs review**, member NOT cleared |
| Decision | `cleared`, by **David Shaw**, 22 Sept 19:10:34Z, rationale "No issues found" |
| Result | compliant, expiry stamped to 2029-09-22 |

The check's own `status` continues to mirror Checkr's report status; the
decision is recorded alongside it. Shortly after the decision Checkr's own
`report.engaged` event arrived and set `status = passed`, which is why the row
reads `status: passed` with `result: consider` — that is the engage event
mapping correctly, not a discrepancy.

This is the path shown in the submitted video.

## 3b. Missed-webhook reconciliation — proven, and it found a defect (22–23 Sept)

The polling path was exercised against live Checkr on both branches
(`GET /v1/invitations/{id}` and `GET /v1/reports/{id}`), and then tested for
real by deleting a pending invitation:

- `DELETE /v1/invitations/8129e2d1…` returned **200**.
- **No `invitation.deleted` webhook arrived**, and the follow-up GET returned
  **404**, which the adapter then treated as an error — leaving the row at
  `invited` permanently, recoverable by neither path.
- Fixed: a 404 on an invitation now maps exactly as `invitation.deleted` does.
  A 404 on a *report* still raises, deliberately.
- Re-run after the fix deployed: **`{"scanned":2,"updated":1,"unchanged":1,
  "errors":[]}`** — the row moved `invited → cancelled` (result `deleted`) with
  an audit entry tagged `source: "sync"`, proving the outcome came through
  reconciliation rather than a webhook.

So a delivery that never arrives is recovered, which is the property this
mechanism exists to provide.

**Invitation expiry proper** (`invitation.expired` → `expired`) cannot be forced
through the API — a pending invitation must reach Checkr's 7-day expiry. One was
left outstanding on purpose (Tom Brady, invitation `f9cbddb0ed2b777b1998e96c`,
issued 22 Sept) and should fire around 29 Sept.

## 4. Two cases not demonstrated, and why

Both are Checkr-side constraints in this staging account, not integration
defects. Both mappings are covered by unit tests
(`lib/background-provider/checkr.test.ts`).

**Vito Andolini — `cancelled`.** Reaching "Canceled" requires force-completing
the report while every screening is still pending. Vito's mock SSN raises an
SSN-trace verification exception that **suspends** the report and emails the
candidate; on 22 Sept the report was created at 16:16:52Z and that email went at
16:17:21Z — a 29-second window. After suspension, `POST /v1/reports/{id}/complete`
**half-applies and returns no error**: a re-read showed `includes_canceled` flip
`false → true` while `status` stayed `pending`, and the report never reached a
terminal state. Three attempts behaved identically. Stellr correctly held the row
at `in_progress` throughout — the report genuinely never completed.

**Alex Taylor — `includes_canceled`.** The sheet requires a package containing
criminal **and MVR** screenings. This staging account has exactly one package,
`stellr_crimid` (global watchlist, national criminal, sex offender, SSN trace);
no MVR package exists, and Stellr orders against a single configured package
slug. The scenario could not be constructed without creating a new package.

## 5. Environment separation

Production (`app.stellreducation.org`) holds **no Checkr credentials** and is
reported as `unconfigured` by the admin integration-health endpoint. A guard
refuses to order from a production deployment pointed at staging credentials, so
a staging key cannot be used to "clear" a real adult. The certification run was
performed entirely on the dev deployment against Checkr staging.
