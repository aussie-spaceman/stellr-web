# Checkr API Certification — Testing Runbook (PRD §13)

The goal of certification is one thing: **for every mock candidate, the status shown
in Stellr must match the status in the Checkr dashboard.** Everything here serves that.

Build context: we use the **Checkr-Hosted Flow** and are an **SMB customer** (combined
recruiting + adjudication; admins have dashboard access). Companion files:
- `docs/checkr-test-seed.sql` — seeds the test members.
- `docs/BACKGROUND-CHECKS-HANDOFF.md` — what was built and the cert hardening (§8–9).

---

## 0 · Pre-flight (once, before any candidate)

- [ ] Env points at **staging**: `CHECKR_BASE_URL=https://api.checkr-staging.com/v1`,
      `NEXT_PUBLIC_CHECKR_DASHBOARD_URL=https://dashboard.checkr-staging.com`,
      `CHECKR_API_KEY` = staging secret key.
- [ ] `CHECKR_PACKAGE_SLUG` = a staging **criminal + identity** package slug
      (Dashboard → Packages).
- [ ] `CHECKR_WORK_LOCATION_STATE=UT` — fallback work-location state (Checkr applies
      that state's FCRA/screening rules). Only used when the member has no teacher-license
      state on file. Set to where participation happens; UT is the company-base default.
      Does not affect mock results (those are SSN-driven).
- [ ] Migration **092** applied to the test DB (`member_background_checks` has
      `assessment` + `includes_canceled`; status CHECK allows `expired`).
- [ ] Webhook registered: Dashboard → Developer Settings → Webhooks →
      `https://<deployed-domain>/api/webhooks/background`, subscribed to **all
      `report.*` and `invitation.*`** events.
- [ ] Webhook reachable: `GET https://<domain>/api/webhooks/background` → `{"ok":true}`.

**Second package for one test:** Alex Taylor ("Clear with Canceled") needs a
**criminal + MVR** package. Our order route uses a single `CHECKR_PACKAGE_SLUG`, so
when you reach Alex, temporarily point it at the crim+MVR package, order, then revert.
Narrate this in the video.

---

## 0 · Before you start: let the mail through

Checkr's staging mail comes from `checkrhq-dev.net`. On 22 Sept every invitation
("Start your … background check") and the result notification were auto-filed to
**Trash** unread, while one "paused" notice reached the inbox — so the tester
believed no mail had been sent at all. Add a filter (`from:checkrhq-dev.net` ->
never spam, always inbox) before the run, and certainly before recording the
video, which is supposed to show the email step.

Invitation mail can also simply be slow in staging: Bud's arrived in seconds,
Judy's had not arrived several minutes after a 200 from the order route. The
apply page does not depend on it — `invitation_url` on our row is the same link.

## 1 · Seed the test members

Edit the inbox line in `docs/checkr-test-seed.sql`, run it in the test DB's Supabase
SQL editor. It creates one member per mock candidate (role `mentor`, DOB 1983-02-10,
`+alias` emails into your inbox). Each member's **nickname** carries its SSN +
expected result as a reminder.

---

## 2 · The four surfaces you compare

1. **Checkr dashboard** — the report status (source of truth).
2. **Stellr admin** — Member page → *Background Check* panel → **Check → Status** line
   (shows the raw mapped status: `passed`/`referred`/`cancelled`/`expired`/`in_progress`).
   This is the cleanest comparison point.
3. **Stellr DB** — `member_background_checks` row.
4. **Logs** — Vercel → Functions → `/api/webhooks/background`, plus Checkr's webhook
   delivery log.

DB inspection:
```sql
select m.first_name, m.last_name, c.status, c.result, c.assessment,
       c.includes_canceled, c.completed_at, c.expires_at,
       c.provider_report_ref, c.invitation_url, c.updated_at
from member_background_checks c
join members m on m.id = c.member_id
where m.nickname like 'CHECKR TEST%'
order by c.ordered_at desc;
```

---

## 3 · Core test loop (per candidate)

1. Admin → Member page → *Background Check* panel → **Order background check**
   (writes `status='invited'` + stores `invitation_url`).
2. Open the hosted apply page — fastest is to copy `invitation_url` from the DB row
   (no need to wait for the email).
3. On Checkr's page enter the candidate's **SSN / DOB (1983-02-10) / zip-address**
   (and DL# for MVR) from the spreadsheet. **The SSN drives the result.**
4. Submit → report generates → webhooks fire → Stellr updates.
5. Compare the four surfaces.

---

## 4 · Mock-candidate matrix (crim+identity package)

**Enter the PII exactly.** Checkr's docs: staging data that does not match the
mocked-candidate sheet leaves the report *"in pending status indefinitely"*. It
does not error — the row just sits at `in_progress` for ever, which looks
identical to a slow report. On 22 Sept Vito was ordered with the seed's blanket
DOB `1983-02-10`; **his mock DOB is `1954-12-07`** and the report never resolved.
DOB and address below are verbatim from `API_Mock_Candidates__1_.xlsx` in Drive
(`Shared drives/InSimEd/Stellr Web App - Resources/Teck Stack/Checkr/`), and
`docs/checkr-test-seed.sql` now carries them in each member's nickname.

| Candidate | DOB | SSN to enter | City / State / Zip | Checkr dashboard | Stellr `check.status` | Pill |
|---|---|---|---|---|---|---|
| Bud Richman | 1983-02-10 | 544-25-5544 | New York, NY 10080 | Clear | `passed` | BC Passed |
| Judge Judy | 1983-02-10 | 667-68-6677 | Miami, FL 33145 | Consider | `referred` | Invalid (flagged) |
| Lady GaGa | 1983-02-10 | 223-24-2233 | 11055 Delano, Detroit, MI 48242 | Consider | `referred` | Invalid |
| Samuel Adams | 1983-02-10 | 556-58-5566 | 1280 25th St., Denver, CO 80205 | Consider | `referred` | Invalid |
| Little John | 1983-02-10 | 011-02-0011 | 2634 Worldgateway Pl, Detroit, MI 48242 | Consider | `referred` | Invalid |
| Roll Tide | 1983-02-10 | 112-14-1122 | 195 S Murphy Ave, San Jose, CA 94088 | Consider | `referred` | Invalid |
| **Vito Andolini** | **1954-12-07** | 494-24-7562 | Newark, NJ 07103 | Canceled | `cancelled` | Invalid (re-order) |
| Remy Gonz | 1983-02-10 | bad 223-23-2239 → good 223-23-2230 | Romulus, MI 48242 | Pending → Clear | `in_progress` → `passed` | In Process → BC Passed |
| Jen Kasp | 1983-02-10 | bad 110-10-7777 → good 110-10-1110 | San Jose, CA 94088 | Pending → Clear | `in_progress` → `passed` | In Process → BC Passed |
| Alex Taylor (crim+MVR) | 1983-02-10 | 544-21-5544, DL CA/A2315179 | New York, NY 10133 | Clear w/ Canceled | `passed` + `includes_canceled=true` ¹ | BC Passed "(completed with canceled screenings)" |

Optional extras, same shape: Requisition Tester (445-46-4455, Honolulu HI 96795),
Tom Brady (001-02-0011, Omaha NE 68101), Peter Griffin (667-69-6677, 3622 Coral
Way Apt 0702, Miami FL 33145), Camo Time (011-02-0012, 41-168 Poliala St,
Honolulu HI 96795) — all Consider, all DOB 1983-02-10.

The `**` candidates (Judy, GaGa, Adams, John, Tide, Remy, Jen, Richman) are
deterministic. Requisition Tester / Tom Brady / Peter Griffin / Camo Time also return
Consider but "may vary" — optional extras (also seeded).

¹ **Confirm on the first real webhook:** if staging has **Assess enabled**,
`assessment=review` arrives for Alex and our code maps to `referred`; if Assess is
**off**, you get `passed` + the canceled indicator. Note which fires — it's a one-line
change in `mapReport`'s review branch (`lib/background-provider/checkr.ts`) if the
dashboard shows clear but we show referred.

---

## 5 · Triggering the special lifecycle cases (the REQUIRED ones)

- **Pending → resume (Remy / Jen):** enter the **bad SSN first** → SSN-trace exception
  → report suspended → Stellr `in_progress`. Re-complete with the **correct SSN**
  → `report.resumed` then `report.completed` → Stellr `passed`.
- **Canceled (Vito, `report.canceled`):** if it doesn't auto-cancel, force it before
  any screening completes → fully canceled → Stellr `cancelled`. The dashboard's
  **Complete Now** is a wrapper around `POST /v1/reports/{id}/complete`, which is
  easier to drive and works when the button is not on screen:

  ```bash
  read -rs "CHECKR_KEY?Checkr staging key: " && export CHECKR_KEY
  curl -s -u "$CHECKR_KEY:" -X POST \
    https://api.checkr-staging.com/v1/reports/<report_id>/complete | python3 -m json.tool
  ```

  It cancels all pending/suspended screenings: `status` comes back `canceled` **iff
  every** screening was canceled, otherwise `complete` with `includes_canceled: true`
  (which is the Alex Taylor case). The response is the pre-update report — the
  terminal state arrives by webhook a moment later. The report id is
  `provider_report_ref` on our row, or the last path segment of the dashboard URL.
  Note the dashboard may hold candidates of the same name from earlier rounds —
  check the candidate id against `provider_candidate_ref` before acting.

  **The window is ~30 seconds, and the constraint is not what it looks like.**
  Vito's mock SSN raises an SSN-trace verification exception, which SUSPENDS the
  report and emails the candidate ("Background check paused: more information
  needed"). On 22 Sept the report was created at 16:16:52 and that email went at
  16:17:21. Once suspended, `complete` **half-applies and gives no error**: a
  re-read of the report showed `includes_canceled` flipped `false` -> `true`
  while `status` stayed `pending`, and it never reached a terminal state. Our
  row correctly sat at `in_progress` — there is nothing to fix on our side, the
  report genuinely never completes.

  So "before any screening completes" understates it: you must beat the
  exception. Start this BEFORE submitting the form — it watches for the new
  report and completes it the moment it exists:

  ```bash
  CAND=<provider_candidate_ref>
  until R=$(curl -s -u "$CHECKR_KEY:" "https://api.checkr-staging.com/v1/reports?candidate_id=$CAND" \
      | python3 -c "import sys,json;d=json.load(sys.stdin).get('data',[]);print(sorted(d,key=lambda r:r['created_at'])[-1]['id'] if d else '')"); \
    [ -n "$R" ]; do sleep 2; done
  curl -s -u "$CHECKR_KEY:" -X POST "https://api.checkr-staging.com/v1/reports/$R/complete" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['status'], d['includes_canceled'])"
  ```

  A report left stuck this way cannot be rescued — delete our row and re-order.
- **Includes-canceled (Alex, partial cancel):** with the crim+MVR package, once the SSN
  trace + criminal complete (clear) but MVR is still pending, click **Complete Now**
  → `report.completed` with `includes_canceled=true`, `result=clear` → Stellr BC Passed
  with the canceled note.
- **Invitation expired:** cancel/expire a pending invitation in the dashboard (or let a
  throwaway one hit the 7-day expiry) → `invitation.expired` → Stellr `expired`
  ("invitation expired — re-order required"). *(Previously dropped; confirm it updates.)*
- **Missed webhook → sync (added 2026-09-21):** for one candidate, disable the webhook
  in the Checkr dashboard before completing the hosted flow. The row stays `invited`.
  On `/admin/compliance` press **Sync with Checkr** → the row reconciles to the
  dashboard status and a `compliance` activity-log line with `metadata.source = "sync"`
  appears. Re-enable the webhook afterwards. (The daily cron does the same on prod;
  it declines on dev because `APP_ENV=dev`.)

---

## 6 · Required-behavior / negative checks (show in the video)

- [ ] **Data validation:** order for a member with a blank last name or malformed email
      → clean error, no Checkr call.
- [ ] **Double-order guard:** order, then order again while `invited`/`in_progress`
      → **409** "already in progress."
- [ ] **Bad webhook signature:** POST junk to `/api/webhooks/background` → **401**.
- [ ] **Multiple checks per candidate:** after a terminal result, **Re-order** for the
      same member → succeeds (reuses the Checkr candidate, new invitation/report).
- [ ] **License alternative:** add + admin-verify a teacher license on a test member
      → pill goes green **License**, no check needed.
- [ ] **Activity log:** each terminal transition writes a `compliance` entry on the
      member's activity log.

---

## 7 · Certification capture

- [ ] **Name an adjudicator** — Checkr won't authorize prod until ≥1 person is
      identified as responsible for reviewing "Consider / Needs Review" reports.
- [ ] **Record one end-to-end video** covering at least: a Clear, a Consider, a
      Canceled, a Pending→resume, and the includes-canceled case (narrate the Alex
      package swap).
- [ ] **Submit the API Authorization Review Checklist** with the video link:
      https://app.smartsheet.com/b/form/c1284692a0be4d0eb73bacdffc66df32

---

## 8 · Cleanup

Uncomment and run the CLEANUP block at the bottom of `docs/checkr-test-seed.sql` to
remove the test members and their checks/licenses/activity.
