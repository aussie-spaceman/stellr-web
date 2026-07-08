# PLAN — Real tier gating for campaign material (finding F-04)

> **OBSOLETE (migration 128):** this plan was scoped around the Educator Commons
> page, which has since been removed as a Claude Design hallucination. Retained for
> historical context only — do not implement as written.

**Status:** proposal (no code changed). **Scope:** make the "Judging rubric & exemplar proposals — Catalyst tier" lock on the Educator Commons page a real, server-enforced gate instead of a cosmetic one.

## 1. What exists today (verified in the codebase)

- **The lock is fake.** `app/(member)/community/educator-commons/page.tsx` renders the rubric row as static JSX (`showRubricUpsell = !member.hasPaidTier`, lines 48 & 93–108). There is no rubric file in the database — migration `supabase/migrations/120_campaign_registrations.sql` seeds only the 3 free resources and explicitly says the rubric is "rendered as a static upsell … a seeded rubric would be downloadable by all".
- **Per-resource tier columns were removed on purpose.** `supabase/migrations/084_drop_resource_acl.sql` dropped `community_resources.min_tier_rank` and `community_resource_tiers` (decision 6b: access is inherited from the container).
- **But a per-attachment tier floor already exists.** `container_contents.min_membership` (smallint, migration `062_container_convergence.sql`) is the sanctioned replacement. It is already enforced by `passesMinMembership()` → `memberMeetsTier()` (`lib/resources-catalogue.ts` line 295; `lib/community.ts` line 286: `0` = everyone, `≥1` = any **paid** tier) and at download time in `app/api/community/resources/attachment/[id]/download/route.ts` via `resolveDownloadableAttachment()`.
- **The gap:** the Educator Commons page downloads through the *other* route — `app/api/community/resources/[id]/download/route.ts` (via `components/community/ResourceDownloadButton.tsx`) — which checks only space access (`getSpaceAccessById`). Educator Commons is an `open` space (migration 120), so every space file is downloadable by every member. `min_membership` is never consulted on this path. Same for the listing page `app/(member)/community/[spaceSlug]/resources/page.tsx` ("every space file is shown").
- **Admin plumbing already exists.** `POST /api/community/resources/contribute` action `setAccess` (`app/api/community/resources/contribute/route.ts` lines 122–137) writes `container_contents.min_membership` (`null` = all, `1` = paid), with an "All members / Paid" dropdown in `components/community/resources/AttachedResourceList.tsx` (`ResourceAccessSelect`, reused by `components/community/mentoring/CohortResourceAttacher.tsx`). Admin space uploads (`app/api/admin/community/spaces/[id]/resources/route.ts`) already create the `container_contents` row via `lib/container-sync.ts` `attachSpaceResource()`.
- **"Catalyst tier" ≡ "paid".** Catalyst ($149) is the lowest paid educator tier (migration `094_canonical_tiers.sql`), so for the educator audience the existing binary floor (`min_membership = 1` → `member.hasPaidTier`) *is* "Catalyst or above". No per-tier-rank machinery is needed.

## 2. Proposed design (smallest change consistent with the model)

**(a) Schema — migration `122_educator_commons_gated_resources.sql` (next free number; 121 is latest). Seed-only, no new columns:**
1. Ensure the space container exists: `mentoring_cohorts` row with `container_type='space', campaign_ref='educator-commons'` (copy the pattern from `086_backfill_space_resource_contents.sql`).
2. Insert `container_contents` rows (`content_type='resource'`) for the 3 free seeded resources, `min_membership = NULL`.
3. Insert the rubric as a real `community_resources` row (space_id = educator-commons, placeholder `storage_path` like migration 120) + its `container_contents` row with `min_membership = 1`.
- *Rejected alternative:* re-adding `community_resources.min_tier_rank` — reverses decision 6b / migration 084 and creates two competing gate models.

**(b) Server-side enforcement — one route edit:**
- `app/api/community/resources/[id]/download/route.ts`: after the existing space-access check, look up the resource's `container_contents` row (join `mentoring_cohorts` on `container_type='space'` + space slug, `content_ref = resource id`) and return 403 unless `memberMeetsTier(member, min_membership)` passes (import from `lib/community.ts`; admins bypass, mirroring `passesMinMembership`).
- `app/api/community/resources/attachment/[id]/download/route.ts` already enforces the floor — no change.

**(c) UI states — `app/(member)/community/educator-commons/page.tsx`:**
- Query resources joined with their `min_membership`; delete the static upsell block (lines 92–108) and render it data-driven: locked row (member fails floor) reuses the exact existing `Lock` icon + "Catalyst tier" caption + `Upgrade → /membership` link JSX; unlocked row renders `ResourceDownloadButton`. Optionally add the same lock badge to `components/community/spaces/ResourcesList.tsx` for other spaces (cosmetic, can defer).

**(d) Admin assignment:**
- Nothing new to build server-side: admins set the floor with the existing `setAccess` action. Surface it by rendering the existing `ResourceAccessSelect` (from `components/community/resources/AttachedResourceList.tsx`) next to each file in the admin space resources list (Admin → Community → Spaces, `app/(admin)/admin/community/spaces/[id]/page.tsx`), exactly as `CohortResourceAttacher` already does for cohorts.
- Ops after deploy: upload the real rubric PDF via Admin → Community → Resources and repoint the placeholder `storage_path` (same step migration 120 already requires for the 3 free files).

**Recommended next step:** have Claude Code write migration 122 + the download-route floor check + the data-driven locked row on the Commons page (parts a–c), then wire the admin select (d). **Effort: S–M** (~1 migration, 1 route edit, 1 page edit, 1 admin UI drop-in; no new access model).
