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

## T3 — landed 17 Sept (eight PRs, #100–#107)

Each on its own branch from `dev`, squash-merged after CI; every e2e run was
confirmed to have actually executed (45 passed) rather than soft-skipped.

| PR | What | Scoped down? |
|---|---|---|
| #100 | 37 local `isAdmin`/`requireAdmin` copies → `lib/admin-auth` (`isAdminClaims`, new `currentUserIsAdmin`). `lib/admin-auth.test.ts`. | Skipped 6 routes on the July "retire later" list, `proxy.ts` (would drag `lib/supabase` into middleware), `community/posts` (a space role, not the claim). |
| #101 | `lib/refunds/stripe.ts` → `lib/stripe.ts`; 26 `new Stripe()` sites → `stripeClient()` / `requireStripe()`. `lib/stripe.test.ts`. | No. |
| #102 | `hubspotFetch` exported from `lib/hubspot`; `-deals`/`-companies` import it. `lib/hubspot-fetch.test.ts`. | Scripts kept their own `BASE`: they `dotenv.config()` after imports, so importing `lib/hubspot` reads the token too early. |
| #103 | `timeAgo`, `slugify`, `sleep` into `lib/utils`; two aliases inlined. | **Yes.** Of 17 same-name helpers, only 5 were true duplicates; four money and four date formats produce different output and were left. |
| #104 | `isEmailLike` in `lib/utils` for the five lead gates. | **Yes.** No `emailSchema`: the 15 `z.string().email()` sites already share zod's one implementation; the two anchored regexes guard external data. |
| #105 | `ensureMemberGrants` and `cancelWorkshop` log their per-row failures instead of `.catch(() => {})`. `lib/entitlements.test.ts`. | No. |
| #106 | Seven scripts → `supabaseServer()`. | `upload-event-flyers` (Sanity's `createClient`) and the `.mjs` script stay. |
| #107 | 14 more dead exports deleted; 60 internal-only functions/consts un-exported. | **Yes.** ~190 internal-only interfaces/types keep `export`; `resetCompanyCache` kept (named as the seam in the Apollo/HubSpot handover). |

Net across T1–T3: **−2,995** (#99: +183 / −3,178) and **−228** (#100–#107: +538 / −766) lines; test suite 65/593 → 70/611. (An earlier revision of this line said −830 for T3 — that figure was never measured; corrected 18 Sept.)

## Still open / for the next session

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

## Close-out — 18 Sept 2026

Promoted to production 17 Sept 04:32Z as `e8d3904` (#110); record
`.claude/releases/promote-2026-09-17.md`. TRACKER 7.1–7.5 closed on `dev`
(#108, #115, #116). Session 8 (registration resume) promoted in parallel.

**What the close-out review found that the session had inferred or skipped:**

1. `npm run verify:prod` was not run at promotion for a change that touched 26
   Stripe call sites. Run at close-out: the live key works through
   `lib/stripe.ts`; but this checkout's `.env.local` points Supabase and DocuSign
   at dev/sandbox, so the price-ID and DocuSign sections did not exercise
   production (TRACKER 7.7). Vercel reports no production runtime errors in the
   48 h across the deploy.
2. The same `.env.local` holds a **live** Stripe secret key next to dev
   Supabase/Clerk; `production-guard.mjs` does not check Stripe (TRACKER 7.6).
3. CLAUDE.md's icon rule was rewritten on an assumption the owner never
   explicitly confirmed (TRACKER 7.8).
4. The T3 line count in this document was a guess (−830); the measured figure is
   −228 (TRACKER 7.9). The plan's "stop if a commit adds more than it removes"
   rule was set aside for #103–#106 with a note rather than a stop.
5. The plan's browser smoke named `/community/coaching`; the run checked the
   `coaching/topup` route by request, not the page render. Low risk — the page
   is covered by the e2e `member-account` spec — but it is not what was written.
6. ESLint was never run: the repo has no lint script and CI does not run it, so
   the 16 suppression reasons (#99) were written without confirming each
   suppression is still needed.

**Next steps (not code pushes):** 7.6 (swap the local Stripe key, extend the
guard), 7.7 (a `verify:prod` run from a production-pointed env), 7.8 (icon rule:
confirm or enforce). The T4 list in "Still open" stands.

Google Doc snapshot of TRACKER §7 at close-out (copy, never the source): https://docs.google.com/document/d/1jteiOjw7mjcDLqcNZC2zuWFZ6Oej217Knbf_cp2d3BQ/edit
