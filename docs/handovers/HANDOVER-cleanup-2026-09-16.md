# Handover — codebase cleanup, 16 Sept 2026

Session 7. Ran the `cleaning-up-codebases` skill against `dev` @ `be2281d`: audit
first (three read-only scans + a baseline), then owner sign-off on scope, then
deletion in tiers with `tsc` + vitest after every commit. The audit and the
tier classification are in the session's plan file; this records what landed and
what did not.

## What landed on `dev` (this PR)

12 commits, **199 files, +183 / −3,178 lines.** Every deletion was grep-verified
to have zero references (tests, scripts, e2e and docs included) and then
re-checked against `TRACKER.md`, the 8 July code review, and the feature
handovers before it was cut. That second pass reversed nine of the first-draft
decisions — see "Kept on purpose" below.

**Deleted (T1)**
- Components/modules nothing imported: `AdminNav.tsx` (the July hold — "until the
  sidebar restructure is final" — cleared on 22 June), `training/Certificates.tsx` +
  `ShareCertButton.tsx`, `lib/reminders.ts`, `training-portal.getCertificates()`.
- 17 lib functions with no callers (three email templates, four `sessions`
  helpers, three Sanity queries, and one each in mentoring, coaching-requests,
  google-sheets, training, docusign, entitlements ×2) plus the two interfaces
  that existed only for them.
- Routes: `api/community/sessions/purchase` **together with** the Stripe webhook's
  `extra_session` branch and `getTierExtraPriceId()` — the "buy an extra session"
  feature (FR-COM-11/12) ships through `coaching/topup` / `mentoring/topup`, which
  are wired. `api/register/group-join/[token]` GET (client uses POST).
  `api/admin/events/[slug]/roster` (caller replaced by the access console's
  `objects/[id]/roster`; the access handover's open item 3 now names that route).
  `app/(auth)/register-campaign` + `SignupCampaignStep` — documented as "entry
  point A" but never redirected to; `campaign-registrations.md` updated.
- Scripts: `backfill-members`, `backfill-member-roles`, `docusign-remediate-sandbox`,
  `seed-events`, `ds-gray-sweep`, `sql/dedupe-schools.sql`, and (after porting)
  `test-refund-policy`. npm entries `seed`, `backfill:members`,
  `backfill:member-roles`, `docusign:remediate` removed; `notify:event-waitlist`
  added for an operator CLI that was never wired.
- `supabase/APPLY-144-145-146.sql`; direct deps `@sanity/ui`, `@sanity/icons`,
  `react-is` (transitive via `sanity`; `styled-components` is a peer and stays).
- `public/`: 20 orphans (three headshots identical to `public/team/`, `Bill.jpeg`,
  three untight logo SVGs, two poster JPGs, eleven Aileron weights no
  `@font-face` declares). 9 `media-manifest` photo ids that were byte-identical to
  another id, with their 72 derivatives; the 8 unrendered ids with unique bytes
  stay.
- `design_handoff_app_redesign/`: specs + seed moved to
  `docs/archive/design-handoff-app-redesign/`, 3.1 MB of assets dropped.
- `app/(admin)/admin/access/page.tsx` → a `next.config.mjs` redirect.

**Fixed (T2)**
- README rewritten (was Next 14 / "Public Website" / Sanity-only); CLAUDE.md's
  phantom handoff path removed and the icon rule now matches practice
  (`lucide-react` for UI icons, `@stellr/icons` for the brand set).
- `.nvmrc` and `engines.node` → 24, matching CI and Vercel.
- `'Unauthorized'` → `'Unauthorised'` in ten routes; recipient email no longer
  logged by the three "not configured" fallbacks; reasons on all 16 previously
  bare `eslint-disable`s; two stale comment paths.
- `lib/refunds/policy.test.ts` replaces the pre-vitest runner (66 files / 598 tests).
- Archived: `PHASE5*.sql`, `PLAN-teacher-onboarding`, `PLAN-verify-before-delete`.

## Kept on purpose (reversed after the handover review)

| Candidate | Why it stays |
|---|---|
| `scripts/check-golive-config.mjs` | TRACKER 6.7 is open: "run it once before the next go-live check" |
| `backfill-lp-locations`, `derive-photos` | README/handovers document them as *the* way to add a location / a photo |
| `seed-test-accounts`, `verify-deletion-registry`, `probe-motion-calendar`, `test-motion-webhook`, `verify-store`, `probe-apollo-engagement`, `build-us-outline` | QA personas and read-only diagnostics; `build-us-outline` generates tracked `lib/us-outline.ts` |
| `PLAN-docusign-1wk-reminder`, `PLAN-former-student-mentor-upgrade` | QA-HANDOVER records both as partially built; `graduation_year` still has no write path |
| `PLAN-landing-pages`, `PLAN-single-email-domain`, `checkr-test-seed.sql` | cited from code comments / a live runbook |
| `app/(admin)/admin/campaigns/[slug]` | documented admin surface, reachable by URL; needs a sidebar link (not a deletion) |
| 8 unrendered photo ids | only copies of those originals in the repo |

## Verified

- Worktree baseline before any change: `tsc` 0 errors, vitest 65/593, lint clean.
  (The main checkout's 7 `@googleapis/*` tsc errors were a stale `node_modules`
  after #92, not a repo defect.)
- After every commit: `tsc`, `lint:tokens`, vitest. Final: 66 files / 598 tests.
- `npm run build` with all prebuild gates; tree clean afterwards (tokens regen
  is idempotent).
- Playwright smoke on the worktree (`PORT=3101 … --project=smoke`): 24 passed,
  1 skipped (apex redirect, needs a deployment). A throwaway spec confirmed the
  `/admin/access?tab=` redirect forwards its query, the six removed paths 404,
  kept media/fonts/logo serve, `coaching/topup` survives, `/studio` renders.

## Still open / for the next session

- **T3 dedupe refactors** (owner-approved, not started): admin claim check →
  `lib/admin-auth.ts` (46 files, skip the 5 on the July "retire later" list);
  26 inline `new Stripe()` → one client; 3 HubSpot fetch wrappers → one; 17
  duplicate date/money/slug helpers; one `emailSchema`; log the swallowed
  failures at `lib/entitlements.ts` grantTierAllocations and `lib/coaching.ts`
  releaseCoachingBooking; scripts → `lib/supabase.ts`; drop `export` from 42
  internal-only symbols. One PR each.
- `docs/campaign-registrations.md` still describes routes and components more
  broadly than exist; only the lines this PR touched were corrected.
- `next-env.d.ts` is tracked and `next dev` rewrites it (`.next/types` ↔
  `.next/dev/types`); every dev-server run dirties the tree. Probably belongs in
  `.gitignore`. Not changed here.
- T4, recorded only: 941-line `register/group` POST; no shared route error
  wrapper (152/211 routes rely on the default 500); 480 MB of video/PDF in git;
  `@stellr/web-ui` on 29 files vs ~350 on legacy `brand-*` aliases; three
  overlapping schema sources under `supabase/`; 5/211 API routes unit-tested.
- Anything in `public/` could in principle be referenced from a HubSpot
  template or Sanity document, which the repo cannot see. If a logo or headshot
  goes missing on a marketing surface, the bytes are in git history before
  `68ac4ef`.
