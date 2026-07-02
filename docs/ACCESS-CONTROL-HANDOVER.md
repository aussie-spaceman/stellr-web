# Access Control — Handover (session 15–16 Jun 2026)

Pick-up notes for a future Claude Code session. The full living model is in Claude Code
memory (`project_access_control_model`); the business-facing summary + next-steps table is
the Google Doc **"Access Control — Session Close-Out & Next Steps"** in the InSimEd/Stellr
Drive folder.

## The model (one paragraph)
Access = **consume** ("can I see/use it?") + **manage** ("can I run/edit it?"), kept separate.
Consume is granted by any of three sources (first match wins): platform RBAC → container
roster → tier entitlement (membership tier ∪ per-campaign content tier). Two gates then
modify the result: **prerequisites** (finish X first) and **persistence** (archived container
content: keep-open vs re-gate, default re-gate). Manage is a separate grant: object roles
(one event/group/container) or platform staff RBAC — never part of a tier.

## Status
- All phases (1–6) + follow-ups #7–#11 built; **type-checks clean; NOT functionally tested**.
- Code deployed. **Migrations `038`–`044` + `047` must be applied** (`supabase db push` from
  repo root). `045` = Jitsi, `046` = activity-log are unrelated.
- 10 product decisions confirmed (see memory; key deviations: D3 buyer = group-rego owners
  incl. Student Manager; D5 manager = member, no tier; D7 realtime everywhere).

## File map (what changed, by area)
- **Consume resolver** — `lib/community.ts`: `memberCanAccess` / `memberHasEntitlement`
  (membership + content-tier subjects, campaign-scoped by `event_slug`), `prerequisitesMet`
  (training-module completion gate), `CONTENT_TIER_RANK`, `member.campaignTiers`.
- **Content tier** — migration `038`; Sanity `event.contentTierOfferings` + `lib/sanity.ts`
  `getEventBySlug`; grant trigger `campaign_enrollment` in `lib/membership-grants.ts`;
  cascade + payment-gating in `lib/event-participation-sync.ts` (`applyCampaignContentTier`,
  `recordEventParticipation` takes `contentTier`, `effectiveContentTier`); registration in
  `app/api/register/group/route.ts` (stores `content_tier`, `price_data` checkout for paid
  tiers) + `components/forms/GroupRegistrationForm.tsx` (tier picker) + `app/api/stripe/
  webhook/route.ts` `confirmRegistration` fires the cascade post-payment (migration `043`
  adds `registrations.content_tier`).
- **Object roles (manage)** — migration `039` (`object_roles` + backfill from
  `event_manager_assignments`); `lib/object-roles.ts` (`currentUserCanManage`,
  `grantObjectRole`); `/api/admin/object-roles`; `components/admin/ObjectRoleAssignments.tsx`;
  `/admin/delegations` (`DelegationsManager`).
- **Staff RBAC seam** — migration `044` (`staff_roles`); `lib/admin-auth.ts`
  (`STAFF_SCOPES`, `currentUserHasScope` — Clerk admins implicitly hold all, non-breaking);
  `/api/admin/staff-roles`; `/admin/staff` (`StaffRolesManager`).
- **Containers + persistence** — migration `040` (cohort `container_type`/`lifecycle`,
  `cohort_members.relationship`, chat `space` kind); migration `041` (`content_prerequisites`,
  `content_persistence`); `lib/containers.ts` (`containerAccessPersists`, `persistenceAllows`,
  `containerIsArchived`); enforced in `lib/sessions.ts` `canAccessChannel` (cohort chat) and
  `app/api/community/sessions/[id]/recording/route.ts` (recordings); archive UI in
  `SessionsManager` + `/api/admin/community/cohorts` (`archive`/`keepOpen`).
- **Gates admin** — `/admin/community/gates` (`GatesManager`) + `/api/admin/community/gates`
  (training-module prerequisites + persistence).
- **Curriculum** — migration `042` (`material_kind` += `curriculum`); member Training page
  shows an "Academy curriculum" section.
- **Chat + realtime** — Spaces chat via `getSpaceChannel` + `ChatPanel` on space pages;
  migration `047` (scoped chat RLS via `can_read_chat_channel` SECURITY DEFINER + Realtime
  publication); `lib/supabase-browser.ts` (Clerk-token client); `ChatPanel` subscribes and
  pokes the gated fetch (8s poll kept as fallback).
- **Admin nav + member picker** — `components/admin/AdminNav.tsx` (5 sections);
  `components/admin/MemberPicker.tsx` + `/api/admin/members/search` used by every admin
  "add a person" field (cohort add/mentor, hosts, delegations, staff roles, object roles).
- **Entitlement matrix** — `components/admin/community/EntitlementMatrix.tsx` (access-level
  picker, tier-family grouping, content-tier subject) + `/api/admin/community/entitlements`
  (PATCH); "Access map" tab at `/admin/community/entitlements`.

## Open items (detail in the Google Doc's next-steps table)
1. **Apply migrations `038`–`044` + `047`** — CRITICAL; deployed code references them.
2. **Enable Supabase Third-Party Auth for Clerk** — makes realtime chat actually push
   (`auth.jwt()->>'sub'` = `members.clerk_user_id`); else 8s poll.
3. **Populate `contentTierOfferings` in Sanity** per campaign — else nothing sells.
4. **Functional test** the whole model (user doing separately).
5. **Refresh the two staff guides** to flip persistence wording to "live" once verified.
6. **Audit persistence coverage** — only cohort chat + recordings enforce it today.
7. **Extend Gates to resources** — resolver supports resource prereqs; no completion signal/UI.
8. **(Optional) Cut group Teams access over to `object_roles`** — still email/registration-
   derived (see memory `project_group_team_access`).

## Gotchas
- Chat tables were `USING(true)` for `public` (anon could read); `047` tightens this — do NOT
  loosen it. Server uses the service-role key (bypasses RLS), so server access is unaffected.
- Space chat is intentionally excluded from realtime (RLS covers cohort/coaching only) → poll.
- Persistence key for a container is `content_persistence(target_type='container',
  target_ref=cohortId)`, written by the archive action.
- Several files gained `logActivity` audit calls via linter/user — keep them.
