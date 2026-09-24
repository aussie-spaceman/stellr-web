# Background Checks — Handoff (PRD §13)

**Session:** 2026-06-25 · **Repo:** `stellr-web` · **Status:** Built; `tsc` + `next build` clean; **not committed/pushed** (manual git workflow). Provider is **Checkr** (switched from Certn mid-session).

---

## 1. What this feature does

Any **non-student adult (18+)** taking part with Stellr must be cleared to participate by **either**:

- a **teacher license** they enter themselves (number / state / expiry — free text, manually admin-verified), **or**
- a **background check** Stellr orders on their behalf (Checkr, hosted-invite flow).

The "requires a check" rule keys off **`event_role`, not age** — a school student who turns 18 stays exempt (the PRD edge case), because student roles are excluded regardless of age. Background-check validity is **3 years from completion**, enforced by Stellr (`expires_at = completed_at + 3yr`), not by the provider.

---

## 2. Decisions locked this session

| Decision | Choice |
|---|---|
| Who pays | **Stellr absorbs** the per-check cost; member never charged (no Stripe step) |
| Consent capture | **Hosted invite flow** — provider emails the candidate to complete PII + consent on its own pages (FCRA-clean) |
| Product label | Generic **"Background Check"** (not "Vulnerable Sector Check" — can't be done online) |
| Geography | **US only** (drove the Checkr choice; Checkr is US-centric) |
| Provider coupling | **Provider-agnostic seam** (`lib/background-provider`) — already switched once |
| Roster pill set | 4 states: **Invalid** (red) · **BC Passed** (emerald) · **License** (green) · **In Process** (orange); `not_required` → n/a |

---

## 3. Provider switch: Certn → Checkr

Mid-session the provider moved off Certn onto Checkr. The compliance layer (state machine, pills, license flow, audit, roster, 3-yr validity) was provider-neutral and **did not change**. Only the adapter swapped, now behind a seam so a future swap is one file.

- **`lib/certn.ts` and `app/api/webhooks/certn/route.ts` were deleted.**
- New seam: **`lib/background-provider/`** = `types.ts` (the `BackgroundProvider` interface) + `checkr.ts` (impl) + `index.ts` (`getBackgroundProvider()`, selected by `BACKGROUND_PROVIDER` env, default `checkr`). Mirrors `lib/video-provider.ts`.
- Checkr specifics: HTTP Basic (API key as username); **2-call order** (`POST /v1/candidates` → `POST /v1/invitations`, returns `invitation_url`, Checkr emails the candidate); package is a **dashboard-defined slug** (`CHECKR_PACKAGE_SLUG`, not booleans); webhook `{type, data:{object}}` signed `X-Checkr-Signature` = HMAC-SHA256(rawBody, apiKey); result `clear`→passed / `consider`→referred.
- Webhook route is now **generic**: `/api/webhooks/background`.

---

## 4. Files (current state)

**Shared logic**
- `lib/compliance.ts` — `requiresBackgroundCheck()`, `deriveCompliance()` (5 states), `loadComplianceForMember` / `loadComplianceRecordsByEmails`, `BC_VALIDITY_YEARS`. `BackgroundCheck.provider_report_ref` (was `certn_application_id`).
- `lib/compliance-admin.ts` — audit assembly (`getComplianceAudit`).
- `lib/background-provider/{types,checkr,index}.ts` — the seam.
- `lib/activity-log.ts` — added `'compliance'` category.

**API routes**
- `app/api/members/compliance/route.ts` — GET state; POST license (self-service, resets verification).
- `app/api/admin/members/[id]/background-check/route.ts` — POST order via seam.
- `app/api/admin/members/[id]/license/route.ts` — POST verify/unverify.
- `app/api/webhooks/background/route.ts` — generic provider webhook.

**UI**
- `components/member/ComplianceSection.tsx` — account profile tab (license form + read-only BC status).
- `components/admin/MemberCompliancePanel.tsx` — admin member sidebar (verify license, order check).
- `components/admin/ComplianceAuditTable.tsx` + `app/(admin)/admin/compliance/page.tsx` — audit dashboard.
- `components/admin/EventRoster.tsx` + `lib/event-admin.ts` — "Background" roster column, 4-state pill, filter.
- `components/admin/AdminSidebar.tsx` — "Background checks" link under Operations (was `AdminNav.tsx`, removed Sept 2026).
- `app/(member)/account/page.tsx`, `app/(admin)/admin/members/[id]/page.tsx` — wiring.
- `.env.local.example` — `CERTN_*` block replaced with `BACKGROUND_PROVIDER` + `CHECKR_*`.

> Note: the three compliance UI files were restyled to Design System V2 brand tokens (`brand-*`) this session by the design pipeline — intentional, keep.

**Migrations**
- `059_background_checks.sql` — **applied to prod** (verified: 2 tables, 16 BC columns, 6 indexes, activity-log CHECK includes `compliance`).
- `060_checkr_provider.sql` — **applied to prod** (verified 2026-06-25 via migration history). Drops `certn_application_id`; adds `provider_candidate_ref` / `provider_invitation_ref` / `provider_report_ref` / `invitation_url`; provider default → `checkr`; reconciliation indexes.
- `092_checkr_certification.sql` — **applied to prod 2026-06-25** (confirmed again 2026-09-21 against `supabase/baseline.sql`). Adds `assessment` + `includes_canceled`; widens status CHECK to add `expired`.

---

## 5. Database state (prod project `hwtzpfrnksksxlwwabqz`)

- Migrations **059 + 060 + 092 are live** on both prod (`hwtzpfrnksksxlwwabqz`) and dev (`xvxlhbxtiwxpopoqjygm`). As of 2026-09-21 both `member_background_checks` tables hold **zero rows** — the June test data was cleaned up and the feature has never been used for a real member.
- Apply with **`supabase db push`** from the repo root (keeps CLI migration history in sync; do not apply via MCP/dashboard or it drifts).

---

## 6. Ops checklist before go-live (Checkr)

**Done 24 Sept 2026** — production is live on `stellr-web` (TRACKER 9.8): package `checkrdirect_basic_plus_criminal`, `CHECKR_WORK_LOCATION_STATE` deliberately unset, webhook on `app.stellreducation.org`. Step 5 turned out unnecessary: Checkr's production approval (23 Sept) enables live reports. The list below is kept as the record of what was required.


1. ~~Apply 092~~ — done. Deploys now go through the `promote` skill (`dev` → `main`), not `vercel deploy`.
2. In the Checkr dashboard: create a **criminal + identity package** → put its **slug** in `CHECKR_PACKAGE_SLUG`.
3. Set `CHECKR_API_KEY` + `CHECKR_BASE_URL` (prod `https://api.checkr.com/v1`) in Vercel.
4. Register webhook URL **`/api/webhooks/background`** in Checkr Developer Settings.
5. **Email clients@checkr.com to enable live Reports** — prod keys can't order until Checkr flips this. Do early.
6. Verify one **staging** invitation's webhook envelope + signature before trusting the mapping.

Until keys are set: ordering returns a clean **503** (`provider not configured`); the **teacher-license path works regardless**.

---

## 7. Open items / watch-outs

- **Package slug has no sensible default** — order route 503s until step 2 is done (intentional; no guessing a slug).
- **Webhook contract unverified against live Checkr** — `parseWebhook` / `mapReport` read defensively but should be confirmed on staging (Checkr's full status matrix isn't fully public).
- ~~**Role scope is broad**~~ — **narrowed 2026-09-21.** `requiresBackgroundCheck` is now opt-in by role via `BC_REQUIRED_ROLES = teacher / mentor / volunteer / adult` (`lib/compliance.ts`). `subscriber`, `parent`, and any unrecognised role are exempt. The audit-page prefilter (`lib/compliance-admin.ts`) uses the same constant.
- ~~**Webhook-only, no reconciliation**~~ — **closed 2026-09-21.** `lib/background-sync.ts` is the single writer for vendor outcomes (the webhook route calls it too). `GET /api/cron/background-sync` (daily, skips rows touched < 1 h ago) and the admin **Sync with Checkr** button on `/admin/compliance` (`POST /api/admin/compliance/sync`, no threshold) re-poll every `invited`/`in_progress` row via `provider.fetchStatus()` (`GET /invitations/{id}` → `GET /reports/{id}`). A missed webhook is now recovered within a day, or on demand. Note the cron declines on the dev deployment (`guardCron` → `APP_ENV=dev`), so on dev use the button.
- **Production sandbox guard added 2026-09-21** — `lib/env-guards.ts` now knows `checkr` (`unconfigured` / `sandbox` / `production`, keyed on `CHECKR_BASE_URL`, defaulting to sandbox exactly as DocuSign does). The order route calls `assertLiveCredentials('checkr')` and returns 503 on a production deployment holding staging keys; `/api/admin/health/integrations` reports it. Checkr authorised production on 23 Sept 2026 and the prod project now holds the production key (24 Sept), so `production` is the correct state there; `sandbox` or `unconfigured` on prod is now a defect.
- **Tests added 2026-09-21** — `lib/background-provider/checkr.test.ts` (the runbook's mock matrix as fixtures, lifecycle events, signature fail-closed, polling), `lib/compliance.test.ts`, `lib/background-sync.test.ts`, Checkr cases in `lib/env-guards.test.ts`.
- **`report_pdf_url` not populated** — no PDF retrieval wired (Checkr's human-readable report lives in their dashboard); add later if needed.
- **`tsc` stale-validator gotcha** — after deleting a route, clear `.next/types` before `tsc`; a fresh `build` regenerates them.

---

## 8. API certification hardening (2026-06-25)

Reviewed Checkr's **Customer API Integration Guidance v3.0** + the two mock-candidate
spreadsheets. We are the **Checkr-Hosted Flow** and an **SMB customer** (combined
recruiting + adjudication; admins have dashboard access). The happy-path build only
handled clear/consider — Checkr's REQUIRED items for production authorization were
missing or wrong. Implemented (all behind the existing seam; `tsc` + `next build` clean):

1. **Assess support (REQUIRED)** — `mapReport` reads `assessment` first
   (`eligible`→passed, `review`/`escalated`→referred), falls back to `result` only
   when assessment is absent.
2. **Complete Now / report lifecycle (REQUIRED)** — `parseWebhook` now handles
   `report.canceled`→cancelled, `report.engaged`→passed, pre/post-adverse-action +
   disputed→referred, suspended/resumed→in_progress, and reads `includes_canceled`
   on `report.completed`.
3. **Invitation lifecycle** — `invitation.expired`→expired (previously dropped, since
   the route skips null-status events) and `invitation.deleted`→cancelled.
4. **Account Hierarchy (REQUIRED)** — `work_locations` now sent on `POST /candidates`
   too (was invitation-only).
5. **Data validation (REQUIRED)** — name/email validated before any POST.
6. **Idempotency key (recommended)** — `cand-${memberId}` on candidate create.

**Migration 092** (`092_checkr_certification.sql`, pending) adds `assessment` +
`includes_canceled` columns and widens the status CHECK to add `expired`. New status
vocabulary: `MappedStatus` += cancelled, expired. UI: admin panel shows a canceled-
screenings note + "View report in Checkr ↗" link (`NEXT_PUBLIC_CHECKR_DASHBOARD_URL`,
admin-gated); member section handles expired/cancelled copy.

**Watch-out:** behaviour for `assessment=review` + `result=clear` (Alex Taylor's
"Clear with Canceled") depends on whether the staging account has **Assess enabled**.
Assess-on → we map to `referred`; assess-off → `passed` + canceled indicator
("Clear w Canceled"). Confirm against the first real staging webhook and adjust the
`mapReport` review-branch if the dashboard shows it as clear.

## 9. Remaining certification path

1. ~~Apply 092~~ — done. The certification run happens on the **dev deployment**
   (`stellr-web-dev`, tracks `dev`) against the hardened code (see §7, 2026-09-21).
2. Set staging `CHECKR_*` on the **dev** Vercel project (`stellr_crimid` package slug,
   `CHECKR_WORK_LOCATION_STATE=UT`, leave `CHECKR_WEBHOOK_SECRET` unset); re-point the
   staging webhook (id `8b0393fb769341844c1f62be`) at
   `https://stellr-web-dev.vercel.app/api/webhooks/background` with `include_object=true`.
   Confirm `/api/admin/health/integrations` on dev says `checkr: sandbox` and on prod
   `checkr: unconfigured`.
3. **Run the full mock-candidate matrix** (Bud Richman=Clear, Vito=Canceled, Alex
   Taylor=Clear-with-Canceled [needs a crim+MVR package], the Consider candidates,
   Remy Gonz / Jen Kasp=Pending via bad-then-good SSN). The pass criterion is that
   the status shown in our app **matches the Checkr dashboard** for each candidate.
   Also prove the sync path: for one candidate, break the webhook (or complete the
   report while the dev deployment is unreachable), then press **Sync with Checkr**
   and confirm the row reconciles.
4. **Name an adjudicator (REQUIRED-process)** — Checkr won't authorize prod until at
   least one team member is identified as responsible for reviewing "consider /
   needs review" reports.
5. Record an **end-to-end video** and submit the **API Authorization Review Checklist**
   (Smartsheet `c1284692a0be4d0eb73bacdffc66df32`).
6. ~~On approval: switch to prod keys/base URL/dashboard URL, email clients@checkr.com to
   enable live Reports, deploy.~~ **Done 24 Sept 2026** — no email was needed; approval
   enabled live reports. See TRACKER 9.8 and `docs/handovers/HANDOVER-checkr-production-2026-09-24.md`.

## 10. How to resume

- **2026-09-24 state:** production cut-over done (TRACKER 9.7 ☑, 9.8 config done); one real order on a live mentor account remains.
- **2026-09-21 state:** code hardening landed (see §7); nothing on the Checkr side has moved since June. Next is §9 step 2 (env wiring on dev), then the matrix. Tracked in `docs/handovers/TRACKER.md` session 9.
- Runbook: `docs/CHECKR-TESTING-RUNBOOK.md`. Checklist answers: `docs/CHECKR-CHECKLIST-ANSWERS.md` (three bracketed items still to fill). Seed: `docs/checkr-test-seed.sql` — run it against **dev**, not prod.
