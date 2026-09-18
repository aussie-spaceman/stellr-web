# 03 · Data Contracts — what feeds each screen

All data is fetched **server-side** through existing `lib/` helpers. Reuse them; do not re-query tables inline. The signed-in Clerk user → `members` row via `getCurrentMember()` (`lib/community.ts`).

---

## Home / "Today"  → `app/(member)/home/page.tsx` (RSC)

| Block | Helper(s) | Returns / fields used |
|---|---|---|
| Current member | `getCurrentMember()` | `id, first_name, last_name, email, event_role` |
| **Next event** hero | `getMemberEvents(member)` → take soonest by `date` | `PortalEvent { eventId, slug, title, activityType, date }`. Venue (city/state) via `getMemberEventCatalog(member)` (`CatalogEvent.city/state`). |
| Prep checklist on hero | `getMemberEvents` + per-event mandatory training via `getAssignedModules(member, { eventRefs, eventRoles })` | count done vs total (`completedCount`/`itemCount`, `isMandatory`, `dueAt`). |
| **Finish your training** | `getAssignedModules(...)` then `listModules(member)` | `TrainingModuleSummary { id, title, material_kind, itemCount, completedCount, isMandatory, dueAt, canAccess }`. % = `round(completedCount/itemCount*100)`. |
| **Upcoming sessions** | `lib/sessions.ts` — member's scheduled `sessions` (`session_participants.member_id = member.id`, `status='scheduled'`, `scheduled_start >= now()` order asc) | `sessions { id, title, session_type, scheduled_start, host_member_id }` + host name. Color: mentoring/coaching = gold/blue. |
| **What's new in your spaces** | `getHomeFeed(member)` (`lib/community-feed.ts`) | `{ id, title, spaceSlug, spaceName, authorName, createdAt, commentCount, unread }`. Add author avatar (resolve member). Mentor tag if author `event_role='mentor'`. |
| Unread counts | `getSpaceUnreadCounts(member.id)` | `{ [spaceId]: number }`. |

> `getMemberEvents` resolves event metadata from Sanity by slug (`getEventsBySlugs`). The "12 days" countdown = `date - now`. If no Sanity match, `eventId` is null and only the title/slug show.

## Community → Spaces  → `app/(member)/community/page.tsx`
- `community_spaces` (active, by `display_order`): `{ id, slug, name, description, min_tier_rank }`.
- `getSpaceUnreadCounts(member.id)` → "N new" pill.
- `getHomeFeed(member)` → "Latest activity".
- `memberMeetsTier(member, space.min_tier_rank)` → locked vs unlocked.
- Member avatar stack per space: query `community_posts` distinct recent `author_member_id` (or a members-in-space count) — small addition; otherwise show member count.

## Space feed  → `app/(member)/community/[spaceSlug]/page.tsx`
- `getSpaceBySlug(slug)`, `memberMeetsTier(...)`, `getSpaceChannel(space.id)` (chat), `community_posts` (published, pinned-first) with `members:author_member_id(first_name,last_name)`.
- Components: `ChatPanel`, `NewPostForm`. Author avatars on each post row.

## Academy → Training  → `app/(member)/community/training/page.tsx`
- `getMemberEvents(member)` → `eventRefs`; member `event_role` → `eventRoles` (student_manager also gets school_student).
- `getAssignedModules(member, { eventRefs, eventRoles })` → "For your events" (mandatory first).
- `listModules(member)` → split by `material_kind`: `curriculum` → "Academy curriculum", `cte` → "CTE", `general` → "Library".
- `TrainingModuleSummary` fields drive covers/progress; cover gradient keyed by `material_kind`.

## Member Directory  → `app/(member)/community/members/page.tsx`
- `member_directory_prefs` where `is_visible=true`, joined to `members(first_name,last_name,age_bracket,event_role,school_address_state, member_schools(is_current, schools(name)))`.
- `show_school`/`show_region` gate which chips render. Filters: school (text), state (select).

## Account  → `app/(member)/account/page.tsx`
- `members` (+ `member_schools`, `member_memberships(membership_tiers)`, `event_participations`), `member_directory_prefs`, `member_activity_log`, `participants`+`registrations`. Tabs: profile / teams / billing / activity (logic already present).

---

## Member identity & roles (for avatars, tags, gating)
- `members.event_role` ∈ `school_student`, `school_student_manager`, `teacher`, `mentor`, `parent` (see `lib/member-enums.ts` for the canonical set + labels).
- `members.clerk_user_id` links to Clerk. **Local dev:** set the seed's "Avanee" row `clerk_user_id` to your own Clerk dev user id so the personalized Home/data render for you (see `seed/README`).
- Mentors/coaches: rows in `session_hosts` (`can_mentor`/`can_coach`) — drives the "Hosting" nav entry and the "(Mentor)" tag.
- Tiers: `membership_tiers` + `member_memberships`; access via `memberMeetsTier()` / `memberCanAccess()` (entitlement-aware, with `min_tier_rank` fallback).

## Key tables touched (all exist; no schema changes needed for the redesign)
`members`, `schools`, `member_schools`, `member_directory_prefs`, `membership_tiers`, `member_memberships`, `community_spaces`, `community_posts`, `community_comments`, `community_resources`, `training_modules`, `training_sections`, `training_items`, `training_progress`, `training_enrollments`, `training_assignments`, `sessions`, `session_participants`, `mentoring_cohorts`, `cohort_members`, `chat_channels`, `chat_messages`, `registrations`, `participants`. Events/campaigns are **Sanity** documents (`event`), joined by slug / `_id`.
