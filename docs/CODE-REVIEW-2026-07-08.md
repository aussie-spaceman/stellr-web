# Comprehensive Code Review + Implementation Plan — stellr-web (8 Jul 2026)

Covers **www.stellreducation.org** (public marketing/registration) and **app.stellreducation.org**
(member + admin app), both served from this repo. Five parallel review passes
(payments/registration, admin access console, public site, security, dead code) plus
direct DB/advisor checks against prod project `hwtzpfrnksksxlwwabqz`.

**Baseline health:** `tsc` clean · 67/67 tests pass · `lint:tokens` clean · all 130
migrations applied in prod (no drift). **But `main` has uncommitted changes** (the
Invoice-Payments hardening) — verified correct; commit before any deploy.

Severity legend: 🔴 critical/high · 🟠 medium · 🟡 low.

---

## Part 1 — Findings by severity

### 🔴 P0 — money, compliance, or auth correctness

| # | Finding | Location | Impact |
|---|---|---|---|
| 1 | **Stripe `invoice.paid` never sets `invoice_paid_at`** — the event-registration branch only calls `confirmRegistration()` (`status='confirmed'`), but `registrationPaid()` requires `invoice_paid_at` for invoiced regs | `app/api/stripe/webhook/route.ts:522-529` + `:153-156` | A group that pays its Stripe invoice online shows **Unpaid** on roster/Teams/billing until an admin manually toggles it — the automated-path twin of the 8-Jul "stuck account" bug |
| 2 | **Client-supplied `total_participants` drives billing** with no server cross-check against `adult_count + student_count` | `app/api/register/group/route.ts:238,730,762,786` | Organiser (or tampered request) declares 12 seats but sends `total_participants=2` → pays for 2, join-link admits 12. Underpayment vector |
| 3 | **Age computed by year-subtraction** (`getFullYear() - dobYear`), ignoring month/day — server *and* join form | `register/group/route.ts:350,526`, `group-join/route.ts:139`, `join/[token]/GroupJoinClient.tsx:93` | A 17-yr-old born late in the year is stored `age_bracket='adult'`, skipping the minor→participant role override and (Adult-type) the guardian/emergency-contact requirement. **Safeguarding/parental-consent gap** |
| 4 | **DocuSign Connect HMAC fails open + non-constant-time** — returns `true` when `DOCUSIGN_CONNECT_HMAC_KEY` unset (defaults to `''`) | `lib/docusign.ts:404-409` | If the key is ever unset in prod, any anonymous POST to the DocuSign webhook is trusted → can mark minors' consent envelopes "completed", flip compliance pills |
| 5 | **Recording webhook legacy path unauthenticated when its secret unset** → server-side `fetch(recordingUrl)` | `app/api/webhooks/recording/route.ts:151-166` | SSRF against internal/metadata endpoints + overwrite any session's `recording_path` in the private bucket |
| 6 | **Registration closes ~30h early** — `registrationStatus()` compares bare `YYYY-MM-DD` at UTC midnight | `lib/utils.ts:76-84` (+ Sanity `date` fields) | "Closes July 10" flips to `closed` at 6 PM Mountain on **July 9**. Directly costs sign-ups across the whole `/register` funnel. (Rendering half fixed 8 Jul; comparison half was missed) |

### 🟠 P1 — data integrity, silent failures, security hardening

| # | Finding | Location | Impact |
|---|---|---|---|
| 7 | **No Stripe webhook idempotency** — `event.id` never recorded; any sub-error returns 500 → Stripe redelivers and re-runs all branches | `app/api/stripe/webhook/route.ts:315-543` | Redelivered `checkout.session.completed` re-runs `activateMembership()` → duplicate `member_memberships` + duplicate grants + repeated emails |
| 8 | **Singleton-role race leaves two coaches on a workshop** — check-then-act, and the `member_roles` mirror write error is discarded; DB partial-unique index conflict-target doesn't match the upsert | `app/api/admin/access/objects/[id]/roster/route.ts:97-129` | Two admins add different coaches concurrently → both land, second mirror fails silently, 200 returned. Roster shows two coaches |
| 9 | **`getMemberAccessSummary()` ignores every query error** (8 queries, `data ?? []`) | `lib/member-access.ts:64-92,150,167,214-221` | Person-360 "Effective Access" audit list **fails open to empty** on any transient DB error — admin concludes member has no grants |
| 10 | **`members/billing` derives paid from raw `status`, bypassing `registrationPaid()`** | `app/api/members/billing/route.ts:89-96` | An invoiced reg an admin marked paid (`invoice_paid_at` set, `status` still `pending`) shows "payment due from organiser" — inverse of #1 |
| 11 | **Checkr background-check webhook fails open when secret unset** | `lib/background-provider/checkr.ts:162-165` | Pass/fail on people working with minors accepted from unauthenticated POST if env misconfigured |
| 12 | **`/api/members/exists` is an unauthenticated, unthrottled enumeration oracle** | `app/api/members/exists/route.ts` | Confirms whether any email belongs to a member (minors' families) → phishing target list |
| 13 | **Join tokens still valid after withdrawal / event close** — only existence+expiry checked, no `withdrawn_at` or registration-window gate | `app/api/register/group-join/route.ts:63-79` | A forwarded 30-day link admits new participants (with DocuSign + Space grants + payment emails) into a withdrawn/closed registration |
| 14 | **Public forms unthrottled + unescaped** (F-17 doc still open) — `contact,subscribe,scholarship,host-event,join-network,white-paper,asset-request,check-in` | those routes | Email-bomb via `white-paper`/`asset-request` (emails attacker-supplied address); `contact` interpolates name/email/message into notification HTML unescaped |
| 15 | **`members.stripe_customer_id` overwritten unconditionally** on invoice reg (no null-guard, unlike the webhook) | `app/api/register/group/route.ts:754-756` | A registrant with an existing Stripe customer loses their prior invoices/receipts from the billing tab |

### 🟡 P2 — correctness edges, UX, a11y, config

| # | Finding | Location |
|---|---|---|
| 16 | Grade inference clamps to 9–12 and overwrites college grades on any DOB edit; manual grade can never survive a DOB change | `lib/grade-logic.ts:155-168`, `GroupJoinClient.tsx:108-128` |
| 17 | International/unknown-state schools silently get a US Sep-1 grade pre-fill | `lib/grade-logic.ts:116-118` |
| 18 | Roster DELETE revokes *all* object-scoped `member_roles` incl. manager roles granted elsewhere; delete errors unchecked | `access/objects/[id]/roster/route.ts:161-163` |
| 19 | Space-roster "mentor/coach" role writes `member` to `community_space_members` but a MANAGE role to the mirror — silent privilege mismatch | same route, 108-129 |
| 20 | Sanity webhook secret non-constant-time + accepted via `?secret=` query param (lands in logs) | `admin/sanity/event-sync/route.ts:25-29` |
| 21 | Printful webhook secret non-constant-time + query-param | `lib/store/printful.ts:157` |
| 22 | Duplicate-registration & capacity checks discard Supabase errors / read-then-insert races (no unique constraint) | `register/group/route.ts:174-217`, `group-join/route.ts:230-245` |
| 23 | License upload: blank `Content-Type` bypasses the allowlist (no magic-byte sniff) | `members/compliance/document/route.ts:30` |
| 24 | `card` payment with no `stripePriceId` returns 201 + `checkoutUrl:null` — reg stuck `pending` forever, no error | `register/group/route.ts:710,776` |
| 25 | One-way hostname canonicalization — member surfaces (`/home`,`/community`,`/account`) served on `www`; `GroupJoinClient` sign-in link relative (www) vs `register/[slug]` absolute (app) | `proxy.ts:37-55`, `GroupJoinClient.tsx:73` |
| 26 | Sanity outage renders as 404 (`getEventBySlug().catch(()=>null)` → `notFound()`) instead of a retryable error | `register/[slug]/page.tsx:18`, `events/[slug]/page.tsx:84` |
| 27 | Form error containers lack `role="alert"`/focus move; emergency fields lack `required`/`aria-required` | `GroupJoinClient.tsx:167-176,413-458` |

### Database advisors (Supabase, prod)

- 🔴 **`access_redundancy_audit` view is SECURITY DEFINER** (migration 125) — enforces creator's RLS, not caller's.
- 🟠 3 SECURITY DEFINER functions callable by any signed-in user via PostgREST RPC: `can_read_chat_channel`, `can_read_space`, `space_unread_counts`. Revoke `EXECUTE` from `authenticated` or switch to INVOKER.
- 🟡 Perf: 6 RLS policies re-evaluate `auth.*()` per-row (`members`, `community_posts`, `community_comments`, `chat_messages`); 12 multiple-permissive-policy warnings on `members`; 2 duplicate indexes (`entitlements.tiers`, `public.event_participations`); 74 unindexed FKs; 43 unused indexes.
- 18 tables have RLS enabled but **no policies** (deny-all) — mostly the `entitlements` schema; harmless (server uses service role) but confirms that schema is dead weight.

---

## Part 2 — Dead code & retirement

### Delete now (zero references; use the `PLAN-verify-before-delete.md` protocol)

- **Components:** `AnnouncementForm.tsx`, `CampaignsBoard.tsx` (Educator-Commons leftover), `ObjectRoleAssignments.tsx`, `AdminNav.tsx` (owner sign-off — superseded by `AdminSidebar`), `TestimonialCarousel`, `AppFooter`, `Footer`, `AppHeader`, `community/{SessionCalendar,RegistrationSubmittedModal,CohortInviteCard,CompleteLessonBar,TrainingItemRow,MentorCohortControls}`. **Keep** `mention-suggestion.tsx` (relative-imported by `RichTextEditor`).
- **Routes:** `admin/community/announcements`, `admin/object-roles`, `admin/membership/grant`, `admin/community/{chat,cohorts,hosts}`, `admin/community/training/assignments`, `admin/training/objects`, `admin/event-participations/pending`. **Base only** (keep subtrees): `admin/coaching`, `admin/deletion-requests`.
- **Lib:** `email-blocks.ts`, `pricing.ts` (not `store/pricing.ts`), `ui/sections.ts`, `credits.ts` (inline the one `type CreditType` import first). **Keep** `tokens.ts` (used by `tailwind.config.ts`).
- **Uncalled member routes** (medium care): `community/{reminders,search,sessions/book,sessions/[id]/join,training/items/[id]/download}`, `entitlements/{book,checkout,quote}`. **Hold** `community/sessions/purchase` (owner confirm — in-flight fix).
- **Misc:** `design_handoff_app_redesign/reference_components/` (4 tsx, still type-checked each build).

### Retire later (LIVE — would break prod)

Phase-4 per-type admin routes (callers not yet repointed to `/api/admin/access/**`): `membership/rules`, `entitlements/{discounts,allocations}`, `staff-roles`, `docusigns/**`, `containers/[id]/contents`, `event-managers`, `event-participations/[id]`, `schools/[id]`, `refund-policies`. Plus `VolunteersConsole`, `AdminCoachingNav/MentoringNav/TrainingTabs`, `MemberMembershipManager`/`MemberAccessPanel` on `AdminMemberDetail` — all pending the retirement phases in `ADMIN-ACCESS-IMPLEMENTATION-HANDOVER.md`.

### DB artifacts & stale docs

- `session_credits` / `session_entitlements` drops **executed in prod** (PHASE5/5b) — add a marker migration so history reflects reality, then archive the two SQL files.
- `content_entitlements.access_level` column still in prod, zero code readers — one-column drop (Phase CT).
- Archive: `PLAN-campaign-tier-gating.md` (obsolete), `ENTITLEMENTS-CUTOVER-PLAN.md` (shipped). Verify-then-archive: `PLAN-docusign-1wk-reminder.md`, `PLAN-former-student-mentor-upgrade.md`.

### Open handover gaps (unchanged, as documented)

Object-anchored rule matcher never fires at registration (`auto-membership-grant.ts` grants only the base tier); wizard bypasses `createWorkshop()` invariants; `PeopleTab` hardcodes `ALL_TIERS`/`ALL_ROLES`. Migration 126 `volunteer_registration` trigger **is** fully wired.

---

## Part 3 — Implementation plan

Sequenced by risk-to-ship-ratio. Each phase is independently shippable; run
`npm run check:deploy-ready` + the `/verify` smoke path before each deploy.

### Phase 0 — commit what's on `main` (blocker)
The Invoice-Payments hardening is uncommitted and verified correct. Commit + push so
`check:deploy-ready` passes and no work builds on an un-snapshotted tree.

### Phase 1 — payment truth + safeguarding (P0 #1,2,3,6) — one PR
1. **#1** — in the `invoice.paid` event-registration branch, stamp `invoice_paid_at` alongside `confirmRegistration()`. Add a unit test on `registrationPaid()` for the paid-invoice path.
2. **#2** — reject `register/group` when `total_participants !== adult_count + student_count` (400 before any records); use the derived sum for billing, not the client field.
3. **#3** — replace year-subtraction with a real age helper (`lib/date-utils` — has DOB→age math already, or add one) in the server route + join form; recompute `age_bracket`/minor role from it. Verify `dispatchAgreement` selects consent class from the corrected age.
4. **#6** — `registrationStatus()` and any date-only comparator: interpret close as `T23:59:59` and open as `T00:00:00` in `APP_TIME_ZONE`. Reuse the date-only guard already in `lib/utils`.

### Phase 2 — webhook hardening (P0 #4,5 + P1 #7,11) — one PR
5. **#4,#5,#11** — flip the three fail-open verifiers to fail **closed** when the secret env var is unset; switch to `crypto.timingSafeEqual` (helper already used in `recording/route.ts` + `checkr.ts`). Allowlist `recordingUrl` host on the legacy recording path (or delete that path).
6. **#7** — record processed Stripe `event.id` (a `processed_events`-style table already exists in the `entitlements` schema — or add `stripe_events(id pk, seen_at)`); early-return on replay. Make membership activation + confirmation emails idempotent.

### Phase 3 — silent-failure & access-console integrity (P1 #8,9,10,15) — one PR
7. **#9** — check `error` on the 8 `getMemberAccessSummary()` queries (+ the objects list route); throw/surface instead of `data ?? []`. This is the highest-leverage error-discipline fix.
8. **#8** — make the singleton-coach add atomic: align the upsert conflict target with the partial-unique index, and check the mirror-write error (return 409 on violation).
9. **#10,#15** — route `members/billing` `pay_kind` through `registrationPaid()`; null-guard the `stripe_customer_id` write.

### Phase 4 — public-form & enumeration hardening (P1 #12,13,14) — one PR
10. **#12** — rate-limit `members/exists` (copy the `members/lookup` pattern).
11. **#14** — ship F-17 Phase 1: `checkRateLimit` on the 8 public forms; HTML-escape user input in `contact` notification email.
12. **#13** — add `withdrawn_at` + registration-window checks to `group-join`.

### Phase 5 — DB advisors + P2 polish
13. Recast `access_redundancy_audit` as SECURITY INVOKER (or restrict); revoke `EXECUTE` on the 3 definer RPCs from `authenticated`. Drop the 2 duplicate indexes. (RLS `initplan` / unindexed-FK items are a separate perf pass.)
14. P2 batch: grade-inference edge cases (#16,17), roster-delete scoping (#18,19), remaining query-param/timing secret compares (#20,21), license magic-byte sniff (#23), `checkoutUrl:null` guard (#24), hostname/sign-in-link consistency (#25), Sanity error boundaries (#26), form a11y (#27).

### Phase 6 — dead-code sweep (separate branch `chore/dead-code-sweep`)
15. Execute the "delete now" list per `PLAN-verify-before-delete.md` (cluster commits, tsc+build+smoke per cluster; owner sign-off on `AdminNav`, `sessions/purchase`, `register-campaign`). Add the PHASE5 marker migration; archive the stale docs.

### Backlog (own workstreams, not fixes)
SEO doc (sitemap ~15 pages, register-page `noindex`+metadata, default OG image); a11y doc (keyboard nav dropdowns, dialog semantics, skip link); the 3 open access-console handover gaps; access-gate enforcement decision (`ACCESS_GATES_ENFORCE`).

---

## Suggested first move
Phases 0→1→2 close every P0. That's two deployable PRs after the commit, all in code
paths with existing tests. I can start on Phase 0+1 immediately on a branch off `main`.
