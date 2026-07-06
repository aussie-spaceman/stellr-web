# QA / Remediation — Handover

**Continue-here doc for a future Claude Code session.** Covers the app.stellreducation.org QA activity: static audit → live verification → owner triage → Phase A–F remediation (built + deployed 2026-07-06). Read this first, then the workbook.

---

## 1. Where everything lives
| Artifact | Location | What it is |
|---|---|---|
| **Tracker** | `InSimEd/Stellr/Stellr QA - Phase 0-1 Audit.xlsx` (Google Drive root) | 8 tabs: README, Story Matrix (202 stories→route→status), Route Inventory (325 routes), Dead Links, Dead Code, **Implementation Plan** (38 WPs — the live plan), Findings Log (33, incl. owner's col I "Tester Feedback"), Phase 2 Test Script (68 cases + results). It's an .xlsx on the Drive mount — edit via `openpyxl`, do NOT re-run the original `build_qa_sheet.py` (it would wipe the owner's col-I + live results). Append/patch only. |
| **Plans & recs** | `docs/PLAN-*.md`, `docs/REC-*.md` (7 files) | Decision-ready docs for the not-yet-built findings (see §5). |
| **Sandbox guide** | `docs/QA-SANDBOX-SETUP.md` | Stripe test-mode, Resend sandbox, DocuSign demo, staging checklist. |
| **Seed script** | `scripts/seed-test-accounts.ts` | Creates 10 role test accounts. Refuses `sk_live` unless `--i-understand-this-is-prod`. |
| **Memory** | `project_qa_phase01_audit` | One-paragraph state; this doc is the long form. |

Repo: `/Users/david.shaw/Documents/GitHub/stellr-web`. **Git: never push — the owner commits/pushes manually** ([[feedback_git_workflow]]). Deploys are on Vercel via GitHub push; **verify the new commit actually builds** (there was an incident where a pushed commit wasn't built).

---

## 2. Status at handover (2026-07-06)
Everything below is **DEPLOYED** to prod. Build green, `tsc --noEmit` + `lint:tokens` clean.

| Phase | What | Status |
|---|---|---|
| **A** quick wins | F-08 announcements deleted · F-13 resources Space control removed · F-14 dead links→/competitions · F-33 /campaigns redirect host-scoped (app serves member route) · F-30 junk file rm · F-32 campaign table cap lifted · F-06 tiers verified | Deployed; A3/A4/A5/D verified live |
| **B** admin IA restructure | Sidebar → Members/Competitions/Community/Academy/Operations · /admin dashboard placeholder · members list→/admin/members · /admin/events→/admin/competitions · Membership `?tab=` (4 old pages deleted) · Gates→Training console · Volunteers→/admin/members/volunteers (F-29) · admin footer · 12 redirects + proxy.ts fix | Deployed; **admin-verify PENDING** |
| **D** public pages | /events unified filter+card grid (events+campaigns) · reworded intro · event-detail Individual/Group CTAs + closed-state notify modal · Get Notified fix · /api/subscribe→HubSpot | Deployed + verified live |
| **C3** mentoring buy-more (F-25) | Was selling "credits" but ledger is per-session — now sells/draws sessions; **migr 122** (FIFO draw across lots) | Deployed; **live-Stripe test PENDING** |

---

## 3. Live verification — what's confirmed vs pending
**Verified 2026-07-06** (browser via claude-in-chrome, as public + as teacher `+rudi`):
- `/events` unified grid + intro + "Async Campaigns" filter (D1) ✓
- Event detail: Individual/Group CTAs, closed-state → "Notify me" subscriber modal (D2) ✓
- `why-design-competitions` links → /competitions ×2 + /curriculum (F-14) ✓
- `/campaigns` on app resolves to member route, no longer →/curriculum (F-33) ✓
- `/volunteer` live (F-31 deploy) ✓

**Phase B admin restructure — VERIFIED 2026-07-06** (admin session): all 10 redirects resolve (events/campaigns→competitions, membership sub-pages→`?tab=`, entitlements→`?tab=entitlements`, community→spaces, academy→training, operations→activity-log, volunteers→members/volunteers, gates→training?tab=reminders); `/admin` dashboard placeholder + "Return to web app"; `/admin/members` list; `/admin/members/volunteers` (F-29) linked under Members; sidebar = the 5 new groups (no Announcements/Gates/Access-Map/Store-header/Discounts); admin footer present; Gates folded into Training→Reminders (Prerequisites/archive/re-gate). **One cosmetic NIT:** `/admin/competitions` page `<title>` still reads "Admin — Events" (metadata string) — update `generateMetadata`.

**PENDING — live Stripe:** C3 mentoring buy-more (buy 4 sessions on `/community/mentoring/discover` → checkout → webhook grants lot → register for a 4-session cohort → balance decrements). Also test one fragmented-lot case. **Run migr 122 first** (it's next-free at 122; confirm no newer migration collides).

To resume verification: get an admin session from the owner, then use the **Phase 2 Test Script** tab (T-01…T-68) and record Pass/Fail in the Result column. `openpyxl` patch pattern is in the tracker's prior edits.

---

## 4. Test accounts (in PROD)
10 personas seeded via `scripts/seed-test-accounts.ts`: `david.michael.shaw+<role>@gmail.com` for role ∈ {subscriber, student, student_manager, teacher, parent, donor, mentor, coach, event_manager, admin}. Password = the `SEED_PASSWORD` the owner set (not stored here). All email → one Gmail inbox (plus-addressing). ⚠️ **Delete all 10 (Supabase members + Clerk users) before the August go-live.**

---

## 5. Open work threads (not yet built — plans written)
Each has a decision-ready doc; several of the original findings turned out **smaller than the audit thought** (agent corrections):
| Finding | Doc | Reality after code-check | Effort |
|---|---|---|---|
| **F-04** campaign tier gating | `docs/PLAN-campaign-tier-gating.md` | Enforced gate largely EXISTS (`container_contents.min_membership`, migr 062); gap = space download route + admin UI | S–M |
| **F-15** DocuSign 1-wk reminder | `docs/PLAN-docusign-1wk-reminder.md` | 7-day reminder cron ALREADY LIVE (`app/api/cron/docusign-reminders`); gap = fires once + no escalation | S |
| **F-02** former-student→mentor | `docs/PLAN-former-student-mentor-upgrade.md` | ~70% built. 🔴 **members.graduation_year has NO write path → the live July-1 Alumni auto-upgrade cron is DORMANT** — fix this | M |
| **F-17** form hardening | `docs/REC-public-form-hardening.md` | `lib/rate-limit.ts` exists (1 route); Phase 1 = 3-line guard × 9 routes. Also: attacker-supplied emails, unescaped contact HTML | S+ |
| **F-23** a11y | `docs/REC-a11y-wcag.md` | 3 P1 keyboard blockers (Navbar dropdowns, white-paper modal focus) + 4 contrast fails | S (P1s) |
| **F-24** SEO/AEO | `docs/REC-seo-aeo.md` | Healthy; gaps = sitemap omits ~15 pages, no default OG image, no canonicals; FAQPage JSON-LD = top AEO win | S |
| **F-18/F-19** delete dead code | `docs/PLAN-verify-before-delete.md` | 18 uncalled API routes + ~24 orphaned files; per-item verify protocol. NEW orphan: `components/campaigns/CampaignsBoard.tsx` (Phase D superseded it) | M |

**Owner is personally handling next week:** **F-01** (mentor free event registration — REG-22) and **F-21** (Student-Manager group management UI). **Deferred:** F-12 (staff overhaul), F-20 (educator bulk merch), F-28 (store Sanity discount dropdown). **Closed/no-action:** F-03, F-05, F-07, F-10 (keep moderation), F-11, F-16, F-22, F-26, F-27, F-31.

Recommended build order when resuming: F-02 graduation_year fix (dormant cron, real bug) → F-17 Phase 1 + F-23 P1s + F-24 P1 (all S, safe) → F-04 → F-15 → F-18/19 cleanup.

---

## 6. Gotchas / landmines
- **Don't push.** Owner commits/pushes. Leave changes in the working tree.
- **Migration numbering:** highest is `122_entitlements_draw_across_lots.sql` (from C3). The F-04/F-15 plans say "migration 122" — they'd actually be 123+. Check for collisions before adding.
- **`server-only` in scripts:** `lib/membership-grants` + `lib/school-link` import `server-only` and can't load in a plain Node/tsx script — seed script does tier/school writes with direct Supabase calls.
- **`members` base table is NOT in tracked migrations** — `gender` + `date_of_birth` are NOT-NULL with no default; introspect the live DB before writing rows.
- **Vercel stale-build-cache** ([[project_vercel_build_cache_stale_chunk]]): if a deploy ships old chunks, redeploy with build cache UNCHECKED.
- **`/campaigns` 308 cache:** the old permanent redirect may be cached in browsers that hit it pre-fix.
- **DocuSign stays on demo** for QA; Stripe live = real charges (refund or use test keys).
- **Admin gating:** admin = Clerk `public_metadata.role='admin'` claim only; a non-admin (e.g. teacher) hitting `/admin/*` bounces to `/account`, which masks whether a redirect fired — always verify admin routes from an admin session.
