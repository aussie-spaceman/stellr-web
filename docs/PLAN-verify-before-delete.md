# PLAN — Verify-before-delete protocol for dead code (findings F-18 / F-19)

A runnable recipe for safely deleting the audited dead code. Spot-checks below were re-run against the codebase on 2026-07-03; corrections to the audit lists are flagged inline.

## Two coordination holds — check BEFORE deleting

1. **`/api/community/sessions/purchase`** — an in-flight mentoring fix may START calling this route. Confirm that work is merged/abandoned before deleting; re-run the grep in step 1 on the day of deletion.
2. **`components/admin/AdminNav.tsx`** — deletion is pending a sidebar restructure (`components/admin/AdminSidebar.tsx` line 11 explicitly says it replaces "the AdminNav hover-dropdown bar"). Hold until that restructure is confirmed final.

## List A — 18 uncalled API routes (spot-check results)

Confirmed zero callers (grep of `app/`, `components/`, `lib/`): `/api/admin/community/chat`, `/api/admin/community/cohorts`, `/api/admin/community/hosts`, `/api/admin/community/training/assignments`, `/api/admin/event-participations/pending`, `/api/admin/membership/grant`, `/api/admin/training/objects`, `/api/community/reminders`, `/api/community/search`, `/api/community/sessions/book`, `/api/community/sessions/purchase` (see hold #1), `/api/community/sessions/[id]/join`, `/api/community/training/items/[id]/download`, `/api/entitlements/book`, `/api/entitlements/checkout`, `/api/entitlements/quote`.

**Corrections — partial deletes only:**
- `/api/admin/coaching` — the base `app/api/admin/coaching/route.ts` (GET+POST) is uncalled, **but** `app/api/admin/coaching/requests/[id]/match` and `/decline` are LIVE (called from `components/admin/coaching/CoachingRequestQueue.tsx:62,85`). Delete only `route.ts`; keep the `requests/` subtree.
- `/api/admin/deletion-requests` — base `route.ts` exports only GET and is uncalled, **but** `app/api/admin/deletion-requests/[id]` is LIVE (`components/admin/DeletionRequestsReview.tsx:54`). Delete only the base `route.ts`; keep `[id]/`.

## List B — orphaned files (spot-check results)

Confirmed orphans (only remaining refs are code comments): `components/admin/AdminNav.tsx` (hold #2), `components/layout/Footer.tsx`, `components/layout/AppFooter.tsx`, `components/layout/AppHeader.tsx` (comment ref in `app/(member)/community/layout.tsx:10` only), `components/admin/ObjectRoleAssignments.tsx`, `components/sections/TestimonialCarousel.tsx`, `lib/email-blocks.ts`, `lib/pricing.ts`, `lib/ui/sections.ts`.

The 6 `components/community/*` orphans (verified by import grep): `CohortInviteCard.tsx`, `CompleteLessonBar.tsx`, `MentorCohortControls.tsx`, `RegistrationSubmittedModal.tsx`, `SessionCalendar.tsx`, `TrainingItemRow.tsx`.
**Correction:** `components/community/mention-suggestion.tsx` is NOT an orphan — imported relatively by `components/community/RichTextEditor.tsx:10`. Do not delete.

5 unreferenced scripts (not in `package.json` scripts, prebuild, or crons): `scripts/check-golive-config.mjs`, `scripts/verify-deletion-registry.mjs`, `scripts/ds-gray-sweep.mjs`, `scripts/test-refund-policy.ts`, `scripts/verify-store.ts`. These are manual-run utilities — zero build risk, but `check-golive-config` and `verify-deletion-registry` may still have operational value; confirm before deleting.

Design-handoff reference components: `design_handoff_app_redesign/reference_components/` (4 .tsx files: ProgressRing, Avatar, AppSidebar, HomeDashboard). Nothing imports them, but `tsconfig.json` includes `**/*.tsx` with only `node_modules` excluded, so they ARE type-checked on every build — deleting them (or the whole 3.2 MB `design_handoff_app_redesign/` dir if the docs are archived elsewhere) is pure win.

## Protocol — run per cluster (routes / components / lib / scripts / handoff)

1. **Grep verification** (from repo root; must return nothing except the file itself and comments):
   - Route: `grep -rn "api/community/sessions/purchase" app components lib --include="*.ts" --include="*.tsx" | grep -v "^app/api/community/sessions/purchase"`
   - Component/lib: `grep -rn "AppFooter" app components lib --include="*.ts" --include="*.tsx" | grep -v "components/layout/AppFooter.tsx"` — also grep the bare basename to catch relative imports (the mention-suggestion lesson).
   - Watch for dynamic fetches: also grep a shorter prefix, e.g. `grep -rn "sessions/\${" app components lib`.
2. **Runtime traffic check (routes only):** Vercel dashboard → project → Observability → Routes, filter by the route path and check request count. Caveat: on the Hobby plan runtime-log retention is short (hours–1 day, not 7 days), so absence of traffic is weak evidence — treat grep as primary and rely on easy rollback. `npx vercel logs <deployment-url>` only streams live logs; it cannot look back 7 days on Hobby.
3. **Delete on a dedicated branch**, one commit per cluster (e.g. `chore/dead-code-sweep` with commits "remove uncalled entitlements routes", "remove orphaned community components", …). One-commit-per-cluster makes selective revert trivial. Do NOT push — owner pushes manually (git auth workflow).
4. **Verification checklist after each commit:** `npx tsc --noEmit` → `npm run build` (this also runs the prebuild watermark/ds-lint guards) → smoke-test key pages locally (`/`, `/membership`, `/account`, `/admin`, `/community`, one event page, store).
5. **Rollback:** `git revert <cluster-commit-sha>` restores exactly one cluster; nothing else is touched. If already deployed, redeploy with `npx vercel deploy --prod --yes` (build cache UNCHECKED if a stale-chunk issue appears).

**Recommended next step:** have Claude Code run the sweep as 5 cluster-commits on a `chore/dead-code-sweep` branch — excluding `AdminNav.tsx` and `sessions/purchase` until the two holds clear — then owner reviews the diff and pushes. **Effort: M** (one focused session; the verification loop, not the deleting, is the work).
