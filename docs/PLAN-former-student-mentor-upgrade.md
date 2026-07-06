# PLAN — Recognize former students who return as Mentors (REG-23) + July-1 Alumni upgrade

**Status:** recommendation (no code changed). PRD story REG-23: registering as a Mentor should detect "I was formerly a student participant" and update status automatically; PRD §2: Alumni tier auto-upgrade on July 1 of the graduating year.

## 1. What already exists (verified in the codebase — more than expected)

- **Email match + role flip already happen.** `app/api/members/onboarding/route.ts` matches the signing-up user to an existing `members` row first by `clerk_user_id`, then by normalized email (lines 100–148, `normalizeEmail` from `lib/member-enums.ts`), and unconditionally overwrites `members.event_role` with the newly chosen role (`profileUpdates`, line 109). "Mentor / Volunteer" is a selectable onboarding role (`components/member/OnboardingForm.tsx` line 34, value `mentor`, bracket `college`).
- **Grant engine is ready.** `lib/membership-grants.ts`: `applyGrantTrigger(memberId, trigger, ctx)` evaluates admin-editable `tier_grant_rules` matching on `age_bracket` / `event_role`; `grantTier()` is idempotent and **only expires FREE memberships — paid tiers are never downgraded** (`replacesFree` block, ~line 174). A `Signup: college → Alumni` rule already exists (migration `094_canonical_tiers.sql` lines 71–72); migration `121_volunteer_program.sql` §4 shows the exact pattern for a role-specific higher-priority rule (`priority 50`, conditions `{"age_bracket":"college","event_role":"volunteer"}`).
- **The July-1 Alumni cron already exists and is scheduled.** `app/api/cron/alumni-upgrades/route.ts` runs daily at 08:00 (`vercel.json`), grants complimentary Alumni to members with `graduation_year <= current year` (only on/after July 1 for the current cohort), dedupes via `sent_reminders (kind='alumni')`, expires free tiers only, and calls `grantTierAllocations()`.
- **Additive roles:** `member_roles` (migration `096_member_roles_foundation.sql`, `lib/member-roles.ts`) — but `addGlobalRole(db, memberId, 'mentor')` is only called when a mentor is assigned to a cohort (`lib/mentoring.ts` line 575), never at signup. Volunteers DO get it at onboarding via `grantVolunteerRole` (`lib/volunteer.ts` line 81).

## 2. The actual gaps

1. **`members.graduation_year` has no write path.** It was added in migration `021_community_automation.sql` (line 91) *specifically* to drive the July-1 upgrade, but a repo-wide grep shows only the cron and grant engine **read** it — no onboarding form, registration form, or admin UI writes it. The cron is effectively dormant.
2. **Signup grant is skipped for returning members.** Onboarding fires `applyGrantTrigger('signup')` only when the member has **no active membership** (lines 223–237). A former student almost always still holds an active free student tier, so a returning mentor keeps e.g. Pathfinder instead of moving to Alumni.
3. **No `member_roles` 'mentor' row at signup**, so mentor-gated surfaces relying on `memberHasRole` don't recognize them until a cohort assignment.
4. **No guardrail against flipping a current student.** An 18+ member still in high school (graduation_year in future) can self-select Mentor and be silently reclassified. (Under-18s are already forced to `participant`, line 62.)
5. **No recognition moment** (activity log entry / notification saying "welcome back — status updated").
6. **Email mismatch** (new email at signup) → duplicate member row; only detectable manually.

## 3. Recommended mechanism (fits existing patterns; no new engine)

At the end of `app/api/members/onboarding/route.ts`, when `resolvedRole === 'mentor'` and the matched pre-existing row's *previous* `event_role` was `participant`/`school_student` (capture it before the update):
- If `graduation_year` is set and **in the future** → do NOT flip: keep the student role, return a friendly error/notice ("you're still enrolled — mentor access opens after graduation"). If `graduation_year` is **null** → allow the flip but write an activity-log flag for admin review (`logActivity`, category `account`).
- On an allowed flip: `addGlobalRole(db, memberId, 'mentor')` (mirror the volunteer call at line 181); log `role_transitioned` + `notifyMember`.
- Relax the membership guard: fire `applyGrantTrigger('signup')` when the member has no active **paid** membership (check `membership_tiers.is_free` like the cron does) instead of no membership at all — `grantTier` already protects paid tiers, so this is safe and fixes gap 2 for volunteers too.
- New migration (next free number, currently `122`): seed rule `Signup: mentor (college) → Alumni` (`trigger_type='signup'`, conditions `{"age_bracket":"college","event_role":"mentor"}`, Alumni tier id, `duration_kind='lifetime'`, `priority 50`) — copy migration 121 §4 verbatim.
- **July-1 upgrade needs data, not code:** add a Graduation year field to the student details step of `components/member/OnboardingForm.tsx` (and optionally derive from `grade` for existing members as a one-off backfill script), persist it in the onboarding route, and expose it in the admin member editor. The existing cron then does the rest.

## 4. Build checklist (Claude Code can execute top-to-bottom)

- [ ] Migration `122` (or next free): seed `Signup: mentor (college) → Alumni` grant rule (pattern: `supabase/migrations/121_volunteer_program.sql` §4).
- [ ] `app/api/members/onboarding/route.ts`: capture previous `event_role` before update; add graduation-year guard (future = block flip to mentor; null = flip + admin-review activity log).
- [ ] Same file: on participant→mentor flip, call `addGlobalRole(db, memberId, 'mentor')` + `logActivity('role_transitioned')` + `notifyMember`.
- [ ] Same file: change the `applyGrantTrigger('signup')` guard from "no active membership" to "no active **paid** membership".
- [ ] `components/member/OnboardingForm.tsx`: add optional "Expected graduation year" input for student brackets; include in the POST body; persist `graduation_year` in the onboarding route.
- [ ] Admin member editor (`components/admin/` member profile surface): expose `graduation_year` for staff correction.
- [ ] One-off backfill script (scripts/): derive `graduation_year` from `grade` for existing student rows where null (report-only first, then apply).
- [ ] QA: former-participant email signs up as Mentor → role flips, `member_roles` has mentor, Alumni granted, paid tier untouched; current HS student blocked; July-1 cron picks up backfilled years.

**Recommended next step:** run the checklist above as one Claude Code session (migration + onboarding route + form field), then the backfill script separately after review. **Effort: M** (one route, one form, one seed migration, one script; cron and grant engine already built).
