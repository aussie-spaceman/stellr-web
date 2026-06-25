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
- `components/admin/AdminNav.tsx` — "Background checks" link under Operations.
- `app/(member)/account/page.tsx`, `app/(admin)/admin/members/[id]/page.tsx` — wiring.
- `.env.local.example` — `CERTN_*` block replaced with `BACKGROUND_PROVIDER` + `CHECKR_*`.

> Note: the three compliance UI files were restyled to Design System V2 brand tokens (`brand-*`) this session by the design pipeline — intentional, keep.

**Migrations**
- `059_background_checks.sql` — **applied to prod** (verified: 2 tables, 16 BC columns, 6 indexes, activity-log CHECK includes `compliance`).
- `060_checkr_provider.sql` — **applied to prod** (verified 2026-06-25 via migration history). Drops `certn_application_id`; adds `provider_candidate_ref` / `provider_invitation_ref` / `provider_report_ref` / `invitation_url`; provider default → `checkr`; reconciliation indexes.
- `092_checkr_certification.sql` — **NOT yet applied.** Adds `assessment` + `includes_canceled`; widens status CHECK to add `expired`.

---

## 5. Database state (prod project `hwtzpfrnksksxlwwabqz`)

- Migrations **059 + 060 are live**. Prod migration history is at **090** (verified 2026-06-25); 091 (entitlements_lifecycle, unrelated) and **092** (this work) are unapplied in the repo.
- Apply with **`supabase db push`** from the repo root (keeps CLI migration history in sync; do not apply via MCP/dashboard or it drifts).

---

## 6. Ops checklist before go-live (Checkr)

1. `supabase db push` (applies 092 — 060 is already live); commit + deploy (`npx vercel deploy --prod --yes` per Hobby-plan cron gotcha).
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
- **Role scope is broad** — requirement currently covers *all* non-student 18+ roles incl. `subscriber`. To exempt subscribers, change `STUDENT_ROLES` / the role set in `lib/compliance.ts` (one line).
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

1. `supabase db push` to apply **092** (060 is already live in prod — verified via
   migration history; prod is at 090, so push also carries 091 from the entitlements
   work). Deploy to a staging/preview env.
2. Set staging `CHECKR_*` env + create the criminal+identity package slug; register
   the webhook URL `/api/webhooks/background` in Checkr Developer Settings.
3. **Run the full mock-candidate matrix** (Bud Richman=Clear, Vito=Canceled, Alex
   Taylor=Clear-with-Canceled [needs a crim+MVR package], the Consider candidates,
   Remy Gonz / Jen Kasp=Pending via bad-then-good SSN). The pass criterion is that
   the status shown in our app **matches the Checkr dashboard** for each candidate.
4. **Name an adjudicator (REQUIRED-process)** — Checkr won't authorize prod until at
   least one team member is identified as responsible for reviewing "consider /
   needs review" reports.
5. Record an **end-to-end video** and submit the **API Authorization Review Checklist**
   (Smartsheet `c1284692a0be4d0eb73bacdffc66df32`).
6. On approval: switch to prod keys/base URL/dashboard URL, email clients@checkr.com to
   enable live Reports, deploy.

## 10. How to resume

Memory: `project_background_checks.md` (full detail) + MEMORY.md index line are current.
Everything above is staged in the working tree to commit and push (manual git workflow).
