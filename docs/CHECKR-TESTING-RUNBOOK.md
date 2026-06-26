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

| Candidate | SSN to enter | Checkr dashboard | Stellr `check.status` | Pill |
|---|---|---|---|---|
| Bud Richman | 544-25-5544 | Clear | `passed` | BC Passed |
| Judge Judy | 667-68-6677 | Consider | `referred` | Invalid (flagged) |
| Lady GaGa | 223-24-2233 | Consider | `referred` | Invalid |
| Samuel Adams | 556-58-5566 | Consider | `referred` | Invalid |
| Little John | 011-02-0011 | Consider | `referred` | Invalid |
| Roll Tide | 112-14-1122 | Consider | `referred` | Invalid |
| Vito Andolini | 494-24-7562 | Canceled | `cancelled` | Invalid (re-order) |
| Remy Gonz | bad 223-23-2239 → good 223-23-2230 | Pending → Clear | `in_progress` → `passed` | In Process → BC Passed |
| Jen Kasp | bad 110-10-7777 → good 110-10-1110 | Pending → Clear | `in_progress` → `passed` | In Process → BC Passed |
| Alex Taylor (crim+MVR) | 544-21-5544, DL CA/A2315179 | Clear w/ Canceled | `passed` + `includes_canceled=true` ¹ | BC Passed "(completed with canceled screenings)" |

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
- **Canceled (Vito, `report.canceled`):** if it doesn't auto-cancel, open the in-flight
  report and click **Complete Now** before any screening completes → fully canceled
  → Stellr `cancelled`.
- **Includes-canceled (Alex, partial cancel):** with the crim+MVR package, once the SSN
  trace + criminal complete (clear) but MVR is still pending, click **Complete Now**
  → `report.completed` with `includes_canceled=true`, `result=clear` → Stellr BC Passed
  with the canceled note.
- **Invitation expired:** cancel/expire a pending invitation in the dashboard (or let a
  throwaway one hit the 7-day expiry) → `invitation.expired` → Stellr `expired`
  ("invitation expired — re-order required"). *(Previously dropped; confirm it updates.)*

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
