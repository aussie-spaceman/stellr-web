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
- `060_checkr_provider.sql` — **NOT yet applied.** Drops `certn_application_id`; adds `provider_candidate_ref` / `provider_invitation_ref` / `provider_report_ref` / `invitation_url`; provider default → `checkr`; reconciliation indexes.

---

## 5. Database state (prod project `hwtzpfrnksksxlwwabqz`)

- Migration **059 is live** (no real check rows — feature never exercised).
- Migration **060 pending** → run **`supabase db push`** from the repo root (keeps CLI migration history in sync; do not apply via MCP/dashboard or it drifts).

---

## 6. Ops checklist before go-live (Checkr)

1. `supabase db push` (applies 060); commit + deploy (`npx vercel deploy --prod --yes` per Hobby-plan cron gotcha).
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

## 8. How to resume

Memory: `project_background_checks.md` (full detail) + MEMORY.md index line are current. Fastest next action: apply 060, set the Checkr env/package, run one staging order end-to-end to validate the webhook. Everything is staged in the working tree to commit and push.
