# Access Convergence Plan — one object (container) model for all spaces

Status: PROPOSED (not started). Authored 2026-06-22. Revised 2026-06-22 to fold in the
"Admin Update" requirements doc (1xZnIelMhvGXnXBEns7eubFQr7qzKz_6nid6AjiMWKvM).

## Context — why this exists

Stellr's access *resolution* layer is complete and correct (`lib/community.ts`,
`lib/sessions.ts`, `lib/containers.ts`, `lib/object-roles.ts`). The pain is on the
**admin side**: the space types a member can access are each granted a different way,
through a different screen, and two of them have no admin grant path at all.

Two findings from the 2026-06-22 deep dive drove the original plan:

1. **The container generalisation (migration `040`) is schema-only.** `container_type`
   values `event_participation` / `campaign_participation` exist in the CHECK constraint
   but **no code creates them**. Competitions resolve through a separate path
   (`registrations` → `participants` → `event_participations.content_tier` → a
   `campaignTiers` map rebuilt on every member load), NOT the container model.
2. **Payment & DocuSign are NOT access gates today.** `memberCanAccess` only checks
   entitlements + prerequisites. Payment/DocuSign are tracked and shown as roster pills
   (`lib/event-admin.ts` `getEventRoster`) but nothing blocks an unpaid/unsigned member.
   No `accessUnlocked()` exists.

The Admin Update requirements doc then sharpened the model (see "Requirements deltas").

## The object set — FIVE containers (corrected)

The requirements doc lists the canonical Objects. All five are the SAME kind of thing —
a container with a roster + contents + gates + managers:

| Object (Stellr area) | Container type |
|---|---|
| Space (Community) | `space` |
| Mentoring Cohort | `mentoring` |
| Coaching Workshop | `coaching` |
| Training Course (Training) | `training` |
| Competition (Event / Campaign) | `campaign_participation` (+ `event_participation`) |

**Spaces are first-class containers** (earlier draft wrongly left them off the top line).
Today they resolve by tier only (`community_spaces.min_tier_rank`) with an implicit roster;
in the converged model a tier assigned to a Space *auto-enrolls* a roster, identical to
every other object.

**Resources, Courses, Products, Announcements, Chat, Calendar/Deadlines are NOT objects —
they are CONTENTS assigned to an object.** Every container has both a **roster** (who) and
**contents** (what's inside).

## Decisions locked (2026-06-22)

- **D-A. Admin grants respect the gates** — an admin-added member still must clear
  payment / DocuSign before access unlocks (no override path for now).
- **D-B. Full convergence** — all five object types use the container + roster model.
- **D-C. Training is an enrollable container too** — a qualifying tier auto-creates a
  roster row; the roster is the single source of truth.
- **D-D. Enforce gates for everyone** — no grandfathering → clean rosters/gate state are a
  hard prerequisite, so enforcement flips LAST.
- **D-E. Two-level containers** — an **event container** carries shared campaign content;
  **group sub-containers** (one per registered group/school, `parent_container_id`) carry
  roster + management; content tier lives on the roster row; Teacher POC manages the group
  sub-container via `object_roles`.
- **D-F. Prerequisites deferred** (requirements doc) — the enforced gate layer is
  **payment + DocuSign** only now, plus persistence on archive. `prerequisitesMet` stays in
  the codebase but is dropped from the gate profile and the Gates admin page until a future build.
- **D-G. Content tiers RETIRED** (confirmed 2026-06-22, already live on the public membership
  page). Core/Baseline/Advanced/Premium no longer exist as a product — their content is folded
  into membership tiers, and a new top teacher tier **Trailblazer ($1,000/yr)** was added. The
  CODE still has the content-tier machinery wired (`content_tier` columns, `CONTENT_TIER_RANK`,
  `campaignTiers` in `lib/community.ts`, `applyCampaignContentTier`, the `GroupRegistrationForm`
  tier picker, `content_entitlements.content_tier` subject, `lib/material-tiers.ts`, Sanity
  `contentTierOfferings`). Retiring it is a cleanup workstream (see Phase CT). With content tiers
  gone, **competition access = being on the participant roster + the member's own membership
  tier** — no per-roster content tier. This simplifies P0/P1 (no `content_tier` on roster rows).

## Target model

Every space is a **container** (reusing `mentoring_cohorts` generalised by `040`).
Access resolves through ONE path:

```
member on the container roster?  →  accessUnlocked(member, container)?  →  access
                                     (payment ∧ docusign, per the container's
                                      gate profile; persistence re-gates on archive)
```

- **Roster = the grant** (`cohort_members`): `(member_id, relationship, status, content_tier)`.
  "Registered for a competition" and "invited to a cohort" become the same row shape.
- **Auto-enroll**: a qualifying `content_entitlements` tier creates a roster row
  (this is what "Assign Membership Tier To Space/Workshop for free access" means in the doc).
- **Contents** (`container_contents`, generalising `cohort_training_links`): training
  courses, resources, recordings, products, announcements — each assignable to ANY object,
  optional/mandatory, membership-dependent, with deadlines.
- **Gate layer** (`lib/access-gates.ts`) is the only genuinely new code.

### Two-level container shape (D-E)

```
Event container          container_type='campaign_participation', campaign_ref=<event_slug>,
                         parent_container_id = NULL   ← shared content lives here
  └─ Group sub-container  parent_container_id = <event container>, registration_id = <reg>
                          roster = that group's participants (content_tier per row)
                          manager = Teacher POC / Student Manager via object_roles
```

Member "is a participant of event X" = on the roster of any sub-container whose
`campaign_ref = X` (or the event container itself, for individually-registered members).

### Gate profiles (resolves the nuance behind D-D + D-F)

`accessUnlocked()` reads a per-container-type profile; non-applicable gates auto-pass so
"enforce for everyone" never locks people out of free spaces. Prerequisites deferred (D-F).

| Container type | payment | docusign | (prerequisite — deferred) |
|---|---|---|---|
| campaign_participation (competition) | ✓ | ✓ | future |
| coaching | ✓ (paid or membership session credit) | per role | future |
| mentoring | – | – | future |
| training | – | – | future |
| space (community) | – | – | future |

## Requirements deltas (Admin Update doc)

These restructure the admin surface and fold into the phases below:

- **Resources** assigned at the OBJECT level, not centrally → drop the "Space" column and the
  "Download Access" filter on `/admin/community/resources`; keep a central read-only index of
  all resources + what they're assigned to.
- **Announcements** move INTO each object (per Space / Competition / etc.) → remove the central
  `/admin/community/announcements` page.
- **Moderation** moves to `/admin/operations`.
- **Spaces** get a dedicated `/admin/community/spaces` list (CRUD + assign resources/training,
  moderate chat, assign membership tier).
- **Training** page: remove the "Shows In" dropdown and the "ASSIGN TO COMPETITION
  PARTICIPANTS" section → course-to-object assignment happens on the OBJECT's admin page.
- **Entitlements** page: explain the `View / Download / Enrol / Host` dropdown; clarify or
  remove the bare "Programs (Mentoring-Access / Coaching-Access)" rows — these are the
  `target_type='mentoring'/'coaching', target_ref='*'` program-wide auto-enroll targets.
- **Gates** page: remove prerequisites (D-F); keep persistence (keep-open / re-gate).
- **Staff** overhaul to align with current membership scope.
- **Schools** move under `/members` (not a standalone top-level page).
- **Store discounts**: event-slug dropdown sourced from Sanity CMS.

## Phases

Build & backfill first; flip enforcement last. **Phase CT (content-tier retirement) can run
first and independently** — it's already a shipped product decision and de-risks P0/P1.

### Phase CT — Retire content tiers (independent, do first) ✅ DONE 2026-06-22 (code-only, build-clean)
Implemented: removed the content-tier picker (`GroupRegistrationForm` + group page prop), the
`registrations.content_tier` write + the Advanced/Premium Stripe checkout block (campaigns are
now genuinely free-to-join), the Access-map content-tier subject (`EntitlementMatrix` simplified
to membership-tier-only) + the entitlements API/page, `campaignTiers`/`CONTENT_TIER_RANK`/
`EntitlementOpts` + the content-tier branch in `lib/community.ts`, `applyCampaignContentTier` +
`effectiveContentTier` + all content-tier params in `lib/event-participation-sync.ts` and its
webhook call, the Sanity `contentTierOfferings` field + query, and the dead
`lib/material-tiers.ts` + `MaterialTiersGrid`. `content_tier` columns left in place (deprecated,
no longer read/written). `npx tsc --noEmit` and `npm run build` both clean.
NOTE: the premium-enrollment → Pathfinder grant (`campaign_enrollment` trigger) is no longer
fired — Pathfinder now comes only via the `event_attendance` grant rule (admin records a
member's event participation). If registration alone should grant Pathfinder, that's a separate
product decision. The seeded `campaign_enrollment` grant rule is now dormant (harmless).
TRAILBLAZER: found to be a hardcoded marketing tier whose CTA points to /contact (sales-led),
NOT a `membership_tiers` row → not admin-assignable today. Making it assignable = a small tier
migration + product decision (auto-grant? student-cohort upgrade? self-serve price?) — NOT done.

Original plan items (for reference):
- Remove the `GroupRegistrationForm` content-tier picker + the `registrations.content_tier`
  write path; drop the Advanced/Premium Stripe line item (campaigns become tier-priced, not
  content-tier-priced).
- Remove the content-tier subject from `EntitlementMatrix.tsx` (Access map) + the
  `content_entitlements.content_tier` rows; keep membership-tier entitlements only.
- Drop `campaignTiers` / `CONTENT_TIER_RANK` / `campaign_material` content-tier branch from
  `lib/community.ts`; competition content resolves by membership tier + participant roster.
- Neutralise `applyCampaignContentTier` (keep the participation write, drop the content-tier
  cascade + the Premium→Pathfinder content-tier trigger; Pathfinder still comes from the
  `event_attendance` grant rule). Retire `lib/material-tiers.ts` content mappings + Sanity
  `contentTierOfferings`.
- Deprecate (don't necessarily drop) the `content_tier` columns on `content_entitlements` /
  `event_participations` / `registrations` — leave nullable, stop writing, remove reads.
- Loose end: **Trailblazer** has no Stripe price in `004_stripe_membership.sql` and no
  `tier_grant_rules` entry — add its price + decide whether it auto-grants or stays manual.

### Phase MS — Membership Studio grant-rule extension ✅ DONE 2026-06-22 (code-clean; migration 062 to apply)
Makes BOTH new mechanics first-class, admin-editable grant rules in Membership Studio:
- **Student registers for a competition → Pathfinder (12mo).** New `competition_registration`
  trigger fired for every member in `recordEventParticipation` (covers all registration paths);
  the seeded rule's `event_role=school_student` condition decides who qualifies. (This also
  restores the registration-time Pathfinder grant that Phase CT had dropped.)
- **Educator buys Innovator/Trailblazer → the students they registered get Pathfinder, expiring
  with the educator's membership.** New `tier_purchased` trigger (fired from the Stripe
  `activateMembership` + both admin grant routes via `fireTierPurchased`), a `source_tier_ids`
  condition, a `grant_target='registered_students'` fan-out (resolved via
  `registrations.teacher_member_id` → participants → student roles), and a `match_source`
  duration (copies the educator's membership expiry).
Engine: `lib/membership-grants.ts` (+ `registeredStudentIds`, `sourceMembershipExpiry`,
`fireTierPurchased`). Admin UI: `RulesClient` gains the two triggers, a source-tier picker, a
"grant to" selector, and the match-source duration; rules API allowlists them. Migration `062`
adds the trigger/duration CHECKs + `grant_target` column, inserts the **Trailblazer** tier
(sales-led, no Stripe price), and seeds both rules. Both are fully editable/pausable in
Membership Studio afterward. `tsc` + `npm run build` clean. APPLY migration 062 via `supabase db push`.

### P0 — Backfill & reconcile (no behavior change) ✅ DONE 2026-06-22 (migration `062_container_convergence.sql`; apply via `supabase db push`)
Implemented additively, nothing reads it yet: `mentoring_cohorts` gained
`parent_container_id` / `campaign_ref` / `registration_id`; new `container_contents` table
(generalises `cohort_training_links`); backfill creates one event-level container per distinct
`event_slug`, one group sub-container per registration (parented + `registration_id`), roster
rows from participants, and migrates `cohort_training_links` → `container_contents`. Idempotent.
Partial unique indexes scope to `event_participation` containers only. Spaces/Training/Coaching
container-rows + `community_resources` → `container_contents` deferred to a later slice (they
resolve fine today). Verify post-apply: sub-container count == registrations(event_slug) count;
roster == distinct (registration, member) participants; contents-training == link count.
(NB: migrations renumbered — Phase MS = 061, P0 = 062.)

Original P0 plan (for reference):
- **Migration** (`062_container_convergence.sql`):
  - `mentoring_cohorts`: add `parent_container_id`, `campaign_ref`, `registration_id`.
    Spaces/Training/Coaching also become rows here (or a unified `containers` view over
    `community_spaces` + `mentoring_cohorts` — decide in P0). No `content_tier` (retired, D-G).
  - `cohort_members`: confirm `status` (052) + `relationship` (040). No `content_tier`.
  - `container_contents` (generalise `cohort_training_links`): `(container_id, content_type
    ∈ training/resource/recording/product/announcement, content_ref, is_mandatory, due_at,
    min_membership)`.
  - backfill: create event + group sub-containers and `cohort_members` rows from
    `registrations`/`participants`/`event_participations`; migrate `community_resources.space_id`
    and `cohort_training_links` into `container_contents`. Idempotent.
- Output: containers + rosters + contents exist alongside legacy tables. Nothing reads them yet.

### P1 — Unify resolution (read from roster + contents)
- `lib/event-portal.ts` `getMemberEvents` / `memberIsParticipant`: roster lookup (mirror
  `lib/sessions.ts` `getCohortSpace`) instead of the `participants` table. (Phase CT already
  removed `campaignTiers`, so competition content access is now membership tier + participant.)
- Spaces/Training/Coaching enrollment become roster rows (D-B/-C). Entitlement engine
  (`memberHasEntitlement`, `memberCanAccess`) UNCHANGED — it now resolves membership-tier rows only.
- Content reads (resources, training, recordings) resolve via `container_contents` so the
  member loads them in-context (doc: "don't redirect back to /resources").

### P2 — `accessUnlocked()` in report-only mode
- New `lib/access-gates.ts`: `accessUnlocked(member, container) → { payment, docusign,
  unlocked, profile }` (prerequisites omitted per D-F). Extract per-participant aggregation
  from `lib/event-admin.ts` `getEventRoster` (lines ~81-164).
- Wire into member portal, chat (`canAccessChannel`), materials in **report-only**: log what
  *would* block via `logActivity`, do not deny yet.

### P3 — Per-object admin pages + nav restructure
- Generic **object admin page** pattern with tabs: **Roster · Contents · Announcements ·
  Moderation · Calendar/Deadlines**. Extract `ContainerRoster.tsx` from `SessionsManager.tsx`.
- **Direct admin grant** for competitions & coaching (the two missing add-paths) via the roster
  tab + `MemberPicker` (`components/admin/MemberPicker.tsx`).
- **"All access in one place"** panel on `components/admin/AdminMemberDetail.tsx`: every
  container the member is on + tier + per-row gate status, inline add/remove.
- **New `/admin/community/spaces`** list; move announcements/resources/training-assignment INTO
  object pages; move moderation → `/operations`; schools → `/members`; staff overhaul; clarify
  the entitlements dropdown + program rows; store-discounts event-slug dropdown from Sanity.
- Update `components/admin/AdminNav.tsx` to the new section layout.

### P4 — Flip enforcement (D-D)
- Once P2 report-only is quiet, turn `accessUnlocked()` from report-only to enforcing in
  portal/chat/materials, behind a single feature flag (toggle per environment).

## Risks
- **Lockout on flip (D-D).** Mitigated by P2 report-only + P0 backfill first. Don't enforce
  until reports are empty.
- **Dual-read window.** P1 reads roster while legacy `event_participations` still exists; keep
  both until P4, then deprecate the legacy content_tier path.
- **Two-level complexity (D-E).** Keep the "any sub-container under this campaign_ref" query in
  one helper to avoid drift.
- **Admin restructure scope (P3).** The requirements-doc nav changes are broad; sequence them
  as small independent PRs after the object-page pattern lands.
- **Git**: never push remotely (user commits/pushes manually). Apply migration via
  `supabase db push` from repo root (not `~`).

## Verification
- `npx tsc --noEmit` clean after each phase.
- P0: new container/roster/contents counts match `event_participations` / `cohort_training_links` /
  `community_resources` counts.
- P1: a known competition participant still reaches `/community/events/[slug]`; non-participant
  still 404s; mentoring/coaching/spaces unaffected; resources open in-context.
- P2: an unpaid/unsigned test member produces a report-only log entry but is NOT denied.
- P3: from `AdminMemberDetail`, add a member to a competition and a coaching workshop; manage a
  Space's resources from `/admin/community/spaces`; confirm rows land in `cohort_members` /
  `container_contents`.
- P4: the unpaid member is now denied; after clearing payment + DocuSign, access unlocks.
- Exercise the member portal end-to-end via the `run` skill / preview tools.
