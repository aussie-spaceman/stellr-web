# Admin/Access Console — Implementation Handover (6 Jul 2026)

Pick-up notes for the next Claude Code session. This session implemented the converged
**admin/access** console from the Claude Design handover (`~/Documents/Claude/Projects/
Claude Design/handover 2/` — README, HANDOFF-CODE-REVIEW.md, RETIREMENT-DIFF.md,
`Admin Access.dc.html` + `access-data.js` as the data contract). Read those first;
this file records what was built, what was adapted, and exactly what remains.

State at close: all changes sit on branch `webapp-todo-updates` (uncommitted at the
time this was written). `npm run build` green, `npx tsc --noEmit` clean, `lint:tokens`
clean. Nothing applied to the production database.

---

## ⚠️ Deploy-order hazard (read before deploying anything)

`lib/access-objects.ts` `attachAllowed()` **fails closed**: it reads
`object_type_relations`, and that table only exists after migration
`supabase/migrations/125_admin_access_convergence.sql` is applied. Four legacy attach
endpoints now call it (`containers/[id]/contents`, `training/assignments`,
`community/spaces/[id]/resources` upload, `community/cohorts` training-link). If this
code deploys **before** 125 is applied, every attach in the existing admin returns
403. **Apply 125 with or before the deploy** (`supabase db push`). 125 was dry-run
verified against production inside `BEGIN…ROLLBACK` on 2026-07-06 (49 matrix rows,
10 tier Spaces, 6 role Spaces, view queryable). Also note: 125 seeds 16 member-visible
private Spaces (10 tier + 6 role) that become reachable the moment it lands, via the
resolution paths from migration 123.

Also: migrations `123_space_sources_and_roles.sql` and `124_space_role_moderator_
rename.sql` exist on this branch and are applied to prod, but were **not on
origin/main** (main was at 122) — make sure they merge before/with 125.

---

## What was built (by handover step)

**1. Schema — `125_admin_access_convergence.sql`** (renumbered from the handover's
planned 114; 114–124 were taken). Contents: `tier_grant_rules` extension
(`object_created` trigger; `object_type` / `object_anchor_ref` (text — events are
slug-keyed) / `tier_min` columns; grant kinds `attach_object` / `roster_add` with
`grant_object_type` / `grant_object_ref` / `grant_role` / `is_dynamic`; duration
`until_date` + `duration_until`), `object_type_relations` (7×7, seeded verbatim from
`SEED_MATRIX`), `object_type_singleton_roles` + partial unique indexes on
`member_roles` (workshop→coach, cohort→mentor; deviates from the diff's
`object_roles.singleton bool` because `object_roles` is manager-only), `member_groups`
+ `member_group_members`, tier/role Space seeds through the existing
`community_space_tiers` / `community_space_roles`, and the `access_redundancy_audit`
view.

**2. Resolver.** `lib/member-access.ts` `getMemberAccessSummary()` (NB: the design
docs call it `resolveMemberAccess` — that function never existed) now returns
`rows: EffectiveAccessRow[]`: container + space rosters, tier-rule / role-rule Space
grants, and manager memberships from `object_roles`, object-scoped MANAGE
`member_roles`, and the structural `mentoring_cohorts.mentor_member_id` — with source
labels and a `redundant` flag. Legacy summary fields kept for `MemberAccessPanel`.
Fabricated levels deleted: `AccessLevel` and rank logic removed from
`lib/community.ts` (`memberCanAccess`/`memberHasEntitlement` now binary; six call
sites updated). Bracket canon: `TIERS_BY_BRACKET` in `lib/tiers.ts` (pure/client-safe)
+ `checkTierAllowedForMember` in `lib/tiers-server.ts`, enforced in
`app/api/admin/members/[id]/memberships` POST and `app/api/admin/membership/grant`;
`ROLES_BY_BRACKET` + `roleAllowedForBracket` in `lib/member-roles.ts`, enforced in
`addGlobalRole` and `syncMemberClassificationRole`. Singleton guard:
`checkSingletonRoleAvailable` in `lib/object-roles.ts` (checks `member_roles` +
structural column; returns holder id for the 409 message).

**3. Unified API — `/api/admin/access/**`.** `lib/access-objects.ts` resolves any ref
(container/space/module/resource uuid, or event slug) to `{objectType, ref, label,
containerId?, slug?}` and hosts `attachAllowed()`. Routes: `objects` (GET list across
all 7 types incl. Sanity events; POST = wizard create + fires rules),
`objects/[id]` (+ `/roster`, `/managers`, `/contents`, `/gates`), `relations`
(GET/PATCH matrix), `conflicts` (reads the audit view), `people/[id]` (GET person
360 payload; POST/DELETE global role chips). Old per-type routes were intentionally
left as working direct implementations rather than literal HTTP proxies — same
tables, same behavior; delete them in Phase 4 (see below).
`app/api/admin/members/[id]/memberships` POST now also accepts `tierName` (chips
send canonical names).

**4–6. Console UI.** `app/(admin)/admin/access/page.tsx` → `components/admin/access/`
(`AccessConsole`, `PeopleTab`, `ObjectsTab`, `NewObjectWizard`, `RelationshipMatrix`,
`ConflictsPanel`). People: bracket-gated tier/role chip strips (greyed = server would
400), effective-access list with source badges + jump-to-object. Objects: typed list,
one detail shell (Roster · Managers · Contents + gate pills), "Type-specific tools"
link to the legacy page per type, 3-step wizard (space/cohort/workshop) with
rule-suggested auto-attach. Rules: `RulesClient.tsx` extended (object_created trigger,
anchor picker, tier_min, attach/roster grant kinds, is_dynamic, until_date, priority
input removed), matrix editor, conflicts sidebar. Rules API
(`app/api/admin/membership/rules`) validates the new fields incl. a matrix check at
rule-save. Runtime: `lib/object-created-rules.ts` `fireObjectCreatedRules()` performs
the attach_object effects; called by the wizard POST and the webhook.

**7. Sanity sync.** `app/api/admin/sanity/event-sync/route.ts`: secret-gated
(`SANITY_WEBHOOK_SECRET`, via `?secret=` or `x-webhook-secret` header) — upserts the
event container (`ensureEventContainer`), provisions `event-<slug>` Space linked via
`community_space_sources`, fires object_created rules. **Not yet configured in
Sanity** — needs the webhook created in the Sanity dashboard + the env var set.

**Retirement executed (parity-complete only).** Deleted: `EntitlementMatrix.tsx`,
`app/api/admin/community/entitlements/route.ts`, the Membership Studio "Access" tab
(page + `MembershipNav`), `DelegationsManager.tsx` + `/admin/delegations`,
`EventAccessGrant.tsx` (+ its use in the competitions page). Nav: added **Access**,
removed **Access map** and **Delegations**.

---

## Remaining work (in priority order)

1. **Apply 125 with the deploy** (see hazard above), then regenerate
   `lib/database.types.ts` (`supabase gen types` / MCP `generate_typescript_types`).
2. **Configure the Sanity webhook** (event create/update → `/api/admin/sanity/
   event-sync?secret=…`) and set `SANITY_WEBHOOK_SECRET` in Vercel.
3. **Wire member-side object-anchored rules** (seed stories r14–r18): the schema,
   editor and storage exist, but the registration-time matcher does NOT read
   `roster_add`/tier object-anchored rules yet. Extend `lib/auto-membership-grant.ts`
   + `app/api/admin/events/[slug]/roster/route.ts` (and the volunteer nomination path)
   to query `tier_grant_rules` where `trigger_type='object_created'` +
   `object_anchor_ref`/`object_type` matches, then apply roster adds via
   `community_space_members`/`cohort_members` and tier grants via `grantTier`.
   (Tier-Space/role-Space membership — r17/r18 — already resolves live through
   `community_space_tiers`/`community_space_roles` once 125 seeds.)
4. **Verify the event-roster read shape in `ObjectsTab.tsx`** (`RosterPane` flattens
   `j.roster.groups[].participants[]`) against `EventRosterData` in
   `lib/event-admin.ts` — this was written from the interface names without a runtime
   check. Medium criticality; pure-read path.
5. **Retirement Phase 1 completion**: strip `AdminMemberDetail.tsx` to a shell around
   the Person 360 (currently the member page still hosts `MemberMembershipManager` /
   `StaffRolesManager` / `MemberAccessPanel` — duplicate surfaces with the new
   console); find a console home for the staff **scopes** editor (STAFF_SCOPES —
   scopes ≠ roles, so `/admin/staff` was kept); fold `VolunteersConsole`'s
   interest→assignment flow into the Event roster tab, then delete it +
   `/admin/members/volunteers`.
6. **Retirement Phase 2**: port the deep tools (chat, scheduling, invites, course
   builder entry, event ops widgets) into the Objects shell, then delete the five
   per-type detail pages/components + `AdminCoachingNav`/`AdminMentoringNav`/
   `AdminTrainingTabs` per RETIREMENT-DIFF.
7. **Retirement Phase 4** (one release after ship): delete the ten legacy routes
   listed in RETIREMENT-DIFF; update remaining callers to `/api/admin/access/**`.
8. **Retirement Phase 5**: remove remaining nav entries (Staff, Gates, Docusigns,
   Community·Spaces, Academy·Training/Mentoring/Coaching) once 5–6 land.
9. **Wizard gaps**: workshop creation inserts `mentoring_cohorts` directly — reuse
   `createWorkshop()` from `lib/coaching.ts` for its invariants (initial participant,
   pricing/credits fields). Add a target chooser for `is_dynamic` rules (seed r13
   "attach chosen Space at creation"). Event roster add/remove from the console
   currently 501s to the registration flow — decide whether that stays.
10. **Group tracking**: `member_groups` tables exist (125); build the "My group"
    panel on the Person 360 + fill groups from bulk event registration (design §7).
11. **Per-object audit log** (design known-TODO): extend `ActivityLogReview` with
    per-object filters.
12. **Content-tier cleanup (Phase CT)**: `content_entitlements.access_level` column
    and content-tier machinery remain in the DB/code (`CONTENT_TIER_RANK`,
    `campaignTiers`) — separate retirement workstream per ACCESS-CONVERGENCE-PLAN
    D-G; untouched this session.
13. Minor: `PeopleTab.tsx` hardcodes `ALL_TIERS`/`ALL_ROLES`/labels — import from
    `lib/tiers.ts` + a pure role module instead; bracket-vs-grant-tier consistency is
    not checked at rule save (only tier_min name + matrix).

## Gotchas for the next session

- The repo is at `~/Documents/GitHub/stellr-web` (sessions may open with cwd in
  Google Drive). Supabase project: `hwtzpfrnksksxlwwabqz` ("Stellr Registrations");
  the Supabase MCP is connected — `execute_sql` with BEGIN…ROLLBACK is the proven way
  to dry-run migrations (no Docker on this machine, so no `supabase db start`).
- DB rules table is `tier_grant_rules` (not `grant_rules`); triggers are snake_case
  (`object_created`) — the design contract's `object-created` maps at the API layer.
- `object_roles` vocabulary is legacy (`event`|`group`|`container` + new 7 types,
  widened in 125); events are keyed by slug everywhere (`object_id`,
  `object_anchor_ref`, `community_space_sources.object_ref`).
- Design-contract semantics: matrix rows = "row type may attach column type";
  ROLES_BY_BRACKET adult list has no `participant`/`student_manager`; college tier
  list has no Explorer.
- `ACCESS_GATES_ENFORCE` env flips gates from report-only to enforcing (P4) —
  unchanged this session.
