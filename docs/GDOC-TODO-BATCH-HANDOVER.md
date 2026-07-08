# G-Doc To-Do Batch — Handover (session 2026-07-08)

Handover for a future Claude Code session. Covers the "Public Pages – To Do" and
"Web App – To Do" tables from the tracking Google Doc
(`1YFqj3FtT6hk5KSH9zn4IkQjAKvjVgk0wf7ihxI7yRDM`). Repo: `~/Documents/GitHub/stellr-web`.

**All code from this session is committed, pushed to `origin/main`, and deployed.
Migrations 128/129/130 are applied to prod.** `npm test` (67 tests) and `tsc` are green.

## What shipped (done)

| Item | Summary | Key files |
|---|---|---|
| P1 | Grade-from-DOB inference now fires on the emailed group-**join** form (SM + accordion were already fixed in commit `14558ac`); school State threaded through | `app/(public)/register/[slug]/join/[token]/{page.tsx,GroupJoinClient.tsx}` |
| W1 | Spaces/Training/Resources links on the member event portal; fixed event→space lookup to key by **slug** not Sanity `_id` | `lib/event-portal.ts`, `app/(member)/community/events/[slug]/page.tsx` |
| W2 | Educator Commons teardown (code + DB) | migration `128`, `campaigns/[slug]`, `DashboardCampaigns`, `CampaignDetail`, docs |
| W3 | "Resource unavailable + flag an administrator" state for lessons with no usable resource; live-room path hardened | `lib/training.ts`, `components/training/{LessonMedia,FlagResourceButton}.tsx`, `app/api/community/training/[itemId]/flag/route.ts`, `lib/notify.ts` |
| W4 | Teacher license image upload/delete (private bucket, signed URLs, resets verification) | migration `129`, `app/api/members/compliance/document/route.ts`, `components/member/ComplianceSection.tsx` |
| W5 | Stellr logo + design-system chrome on ALL transactional emails (16 templates) | `lib/email.ts`, `lib/email-layout.ts` |
| W6.1 | Invited user with an existing account is prompted to sign in (email-exists check) | `app/api/members/exists/route.ts`, `GroupJoinClient.tsx` |
| W6.3 | "You've already registered" no longer says "already" twice | `join/[token]/page.tsx` |
| W6.4/5/8 | Invoice pills read truthfully; **invoice_paid_at** tracking + admin "Mark invoice paid" control; receipt route only serves a PAID invoice | migration `130`, `lib/payment-status.ts`, `lib/event-admin.ts`, `components/admin/EventRoster.tsx`, `components/member/{BillingHistory,TeamsTab}.tsx`, `app/api/admin/events/[slug]/invoice-paid/route.ts`, `app/api/members/billing/receipt/route.ts` |
| W6.6 | Competitions/Spaces sidebar bounce to www — **confirmed fixed on deploy** (hostname canonicalization) | — |
| W6.7 | Admin date shown a day early — date-only timezone bug in `formatDateShort`/`formatDate`/`formatDateRange` | `lib/utils.ts` |
| W7 | Existing account's school replaced with the group's on join; joining members + organiser get event Space access; DocuSign fires for joiners | `lib/school-link.ts`, `lib/space-inheritance.ts`, `app/api/register/{group,group-join}/route.ts` |
| Follow-ups | Unified payment rule (`registrationPaid`); missing-guardian admin alert; deploy guardrail; 21 unit tests; home-page test suite fixed (server-only alias) | `lib/{payment-status,docusign-agreements,utils,grade-logic}.ts` + `.test.ts`, `scripts/check-deploy-ready.mjs`, `vitest.config.ts`, `test/empty-module.ts` |

## Outstanding / not fully completed (pick up here)

### 1. W3(a) — live video "can't join when no recording" (INFRA, unverified)
The doc reported members can't see the JaaS/Jitsi "join live" room when no recording
exists. Code path (`lib/training.ts → liveLessonMedia`) now returns the live room to
guests when there's no recording, and falls back to the "unavailable + flag" state if
token minting throws. **The likely root cause is JaaS/Jitsi provider/env config**
(`lib/video-provider.ts`, `getVideoProvider().getJoinToken`, `getEmbedConfig`), which
was not exercisable from the coding session. **Next:** verify a real member can join a
live lesson with no recording on the deployed app; if not, inspect the JaaS app-id/JWT
key env vars and the embed config.

### 2. W7.2 — DocuSign for existing-account joins (verify + minor edge)
`dispatchAgreement` is called for every group-join (signed-in and new), and issues a
fresh envelope when none is on file — so W7.2 is handled in code. **Not runtime-verified**
against the named test account (`david.michael.shaw+student@gmail.com`). Edge case now
handled defensively: a **minor with no guardian on file** gets no envelope (dispatch
early-returns) but now alerts community admins (follow-up #2). **Next:** confirm the
existing-account join actually triggers DocuSign in prod; decide whether to collect a
guardian at join time so minors always get an envelope.

### 3. W6.4 — receipt for OFFLINE-settled invoices
Fixed: unpaid invoices offer no download; a PAID Stripe invoice returns its PDF. But an
invoice marked paid **offline** (admin toggle → `invoice_paid_at`, no Stripe invoice)
has no receipt document — the route returns an explanatory message. **Next (optional):**
generate a simple branded receipt PDF for offline-settled invoices, or wire Stripe-issued
invoices so a real receipt exists.

### 4. Runtime verification not yet confirmed back
P1 group flow end-to-end (SM record, accordion, join link all inferring grade) and the
W6 payment-pill displays with real data were left with the user "testing now"; results
weren't reported into the session. Logic + typecheck pass; **not user-confirmed**.

## Recommendations surfaced (not requested, worth doing)

- **Access-gate enforcement decision.** `ACCESS_GATES_ENFORCE` is OFF (report-only). The
  invoice_paid_at alignment in `lib/access-gates.ts` only affects reporting until it's
  flipped. Decide: should an unpaid-invoice group be blocked from event materials/Spaces?
- **`status='confirmed'` is overloaded** (payment proxy + access flag + lifecycle). Payment
  reads are now centralised in `lib/payment-status.registrationPaid`, but the underlying
  overload remains a latent smell worth a dedicated cleanup.
- **Auto-mark invoices paid.** invoice_paid_at is admin-manual only. If Stripe-issued
  invoices are used, a webhook (`app/api/stripe/webhook`) could set it automatically.
- **Expand server-component test coverage.** The `server-only` vitest alias (this session)
  unblocks importing ANY server page/component in tests, not just home — good time to add
  coverage for other server pages.

## Gotchas / conventions learned this session
- Event→Space sources (`community_space_sources`) key events by **event_slug**, not Sanity `_id`.
- `registrations.status='confirmed'` is NOT proof of payment (refund code says so too).
- Postgres `date` columns render a day early via `new Date('YYYY-MM-DD')` in Mountain tz;
  use the date-only guard now in `lib/utils.ts`.
- Deploy from a clean, pushed tree — run `npm run check:deploy-ready` first.
- Migrations verified via Supabase MCP `execute_sql` wrapped in `BEGIN; … ROLLBACK;`.
