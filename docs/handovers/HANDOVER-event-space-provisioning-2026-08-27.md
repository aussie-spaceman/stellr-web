# Event → Space provisioning, and per-event access

**Branch** `feat/event-space-provisioning-2026-08-27` (worktree at `../stellr-web-spaces`)
**Date** 27 Aug 2026
**Status** ✅ **DEPLOYED 28 Aug 2026.** Migrations 144/145/146 applied, code live on
`main` (`d906dfa`, Vercel `dpl_3aJY297z…` READY), backfill run. Verified in the
database; **not yet exercised in a browser.**

Built in a separate git worktree because two other sessions were committing to the
shared checkout at the time — `main` moved three commits mid-investigation and the
checkout switched branches underneath. Branched from `origin/main` @ `a60ac43`.

---

## The three rules this implements

1. A Sanity event automatically has a Space, named after the event, and the pairing
   survives the event's slug changing.
2. Registering for an event grants that event's Space only — never every event's.
3. Joining as a member grants the Space for your tier.

---

## What was actually wrong

Four separate faults, which together made access look like it worked while it did not.

**1. Event Spaces granted access by org-wide role.** Migration 141 gave each event
Space the five event roles. `community_space_roles` matches a member's **global**
role (`resolveSpaceAccess` reads `getGlobalRoleNames`, which excludes object-scoped
roles), so `teacher` meant *every teacher in the organisation*. Seven members could
open all six event Spaces without registering for anything. The admin UI reads those
checkboxes as "who is at this event", which is how it was built by hand and why it
stayed invisible.

**2. The event link never granted anything.** `resolveMemberSpaces` filters sources
to Spaces where the member *already* has a roster row — the link only attributes an
existing grant, it never creates one. Access was supposed to come from a roster row
written at registration.

**3. Those roster rows were never written for solo registrants.** Only
`register/group` and `register/group-join` called `syncObjectSpaceRoster`;
`register/individual` did not.

**4. The rename broke the middle of the chain.** The chain is
`space → source(slug) → container(campaign_ref) → cohort_members`. When the year
suffixes were pulled from the Sanity slugs, `rename_event_slug()` repaired every
column literally *named* `event_slug` and could not see
`mentoring_cohorts.campaign_ref`. Registrations moved; the containers did not.
16 rows across 5 slugs. This is why **every** event Space had an empty roster, and
it is the blind spot migration 143 documented and deferred.

Not a bug: the "Space Design Campaign - Fall 2027" on Bill Allen's admin page is his
event **registration**, rendered under "Competitions". The panel is headed
"Access (spaces & rosters)" and was the one admin screen that never showed a Space —
it discarded the `rows` field the API already returned.

---

## Changes

| Area | File |
|---|---|
| Sanity `_id` identity, widened slug tools | `supabase/migrations/144_event_space_identity.sql` |
| Container repair + drop role grants | `supabase/migrations/145_repair_event_containers_and_grants.sql` |
| Tier Space for every tier + trigger | `supabase/migrations/146_tier_spaces_for_every_tier.sql` |
| Event↔Space sync (shared) | `lib/event-space-sync.ts` |
| Webhook rewired, `_id` required | `app/api/admin/sanity/event-sync/route.ts` |
| Read-time grant suppression (8 sites) | `lib/spaces.ts` |
| Roster sync moved to the shared seam | `lib/event-participation-sync.ts` |
| Write-time refusal + link clears grants | `app/api/admin/community/spaces/[id]/route.ts` |
| Controls disabled + explained | `components/admin/community/spaces/SpaceConfig.tsx` |
| Renders effective access | `components/admin/MemberAccessPanel.tsx` |
| Backfill / reconcile | `scripts/sync-event-spaces.ts` (`npm run sync:event-spaces`) |
| 5 new tests (26 in file, 305 total) | `lib/spaces-audience.test.ts` |

Rule 2 is enforced in **four** places on purpose: the admin UI disables the controls,
the API refuses the write, linking an event clears grants already present, and
`lib/spaces` drops them at read time. The read-time rule sits where grants are
*loaded* rather than inside `resolveSpaceAccess`, because five resolvers apply
tier/role matching and only a rule all of them share cannot drift.

---

## Run order — do not reorder

Migrations 144 → 145 → 146 must land **before** the code deploy, and the code deploy
**before** the backfill.

1. **Apply 144.** Additive: two nullable columns, two partial indexes, two
   `create or replace` service-role functions. Supersedes 143 (never applied) —
   apply 144 whether or not 143 went in.
2. **Apply 145.** Repairs the 16 container rows and deletes the role grants.
   Merges the two Nevada roots before repointing — `mentoring_cohorts_event_container_uniq`
   allows one root per event, so a straight `UPDATE` aborts partway.
3. **Apply 146.** Backfills Tier Spaces (adds Parent/Guardian and Subscriber) and
   installs the trigger.
4. **Verify:** `npm run audit:event-slugs` should be clean. It now sees
   `campaign_ref`, `object_ref` and `course_object_assignments.object_ref`, so it
   will report problems it previously could not.

   ⚠️ **144 and 145 must go in together.** `npm run check:deploy-ready` runs this
   audit, and once 144 widens it the 5 stale `campaign_ref` slugs become visible —
   so applying 144 alone leaves the deploy gate failing until 145 repairs them.
5. **Deploy the branch.**
6. **`npm run sync:event-spaces`** (dry run), read it, then `-- --apply`.
   Expect: 6 Spaces created, 6 adopted + renamed, rosters backfilled.
7. **Confirm the Sanity webhook exists.** It has evidently never fired — no
   `event-*` Space exists in prod and all six were hand-built. Rule 1 is inert
   without it. It now **requires `_id`** in the payload and returns 400 without it.

All three migrations were dry-run against prod inside a rolled-back transaction.
Verified after 144+145: zero stale refs, exactly one root per event slug, zero role
grants on event Spaces, and Bill's container resolving to `space-design-campaign-fall`.

⚠️ MCP `apply_migration` has been classifier-blocked here before, and
`supabase db push` cannot substitute (timestamp-vs-numeric migration history).
Apply via the SQL editor if that recurs.

---

## Decisions for you

1. **`2027 Space Design Campaigns` gets renamed to `Space Design Campaign - Fall`**
   and linked to that event. That is Rule 1 applied mechanically, and it matches
   your intent — it is the event Bill registered for — but it renames a Space you
   had just created. Say so if you want it left alone.
2. **Subscriber gets a Tier Space** because 146 applies the rule uniformly. If
   Subscriber is a mailing-list tier rather than a community one, delete that Space;
   the trigger will not recreate it for an existing tier.
3. **Tier and event grants are now mutually exclusive.** An Educator no longer
   reaches an event Space without registering. That follows from Rules 2 and 3
   together, but it is a real behaviour change.
4. **Space slugs.** A Space adopted under a stale slug (`2027-nevada-…`) is repointed
   to the event slug where that is free, and left alone where it would collide. The
   Space is found by `_id`, so a stale slug is cosmetic — but URLs change.

## Deployed state, verified 28 Aug 2026

12 event-linked Spaces, every one carrying its Sanity `_id` and **zero tier/role
grants**. 6 created, 6 adopted, 2 renamed (`2027 Nevada …` → `Nevada Space Design
Challenge`, same for South Dakota — their slugs moved too, so those URLs changed).
All 12 tiers hold their Tier Space, including the new Parent/Guardian and Subscriber.
Bill Allen holds **exactly one** roster row: `space-design-campaign-fall`, the event
he registered for. 29 Spaces total.

### ⚠️ One thing left open: `2027-space-design-campaigns`

The Space created by hand before this work is still there, **unlinked to any event
and still carrying 1 tier grant (Educator) and 2 role grants (participant, teacher)**.
It was not adopted because it matches the Fall campaign on none of the three keys the
sync uses — not the `_id`, not an event link (it has none), and not the slug. So a
fresh `Space Design Campaign - Fall` was created alongside it.

That leaves it as the one place the original defect survives: every Educator, every
teacher and every participant in the organisation can still open it, and it now
duplicates a properly provisioned Space. It needs to be archived or deleted — the
work is not finished while it stands. Left in place because removing it is a data
decision, not a mechanical one.

## Not done

- **Not browser-verified.** No part of this has been exercised in a running app.
  The end-to-end proof is: register someone for one event, confirm they get that
  Space and no other.
- The webhook's `_id` requirement is unverified against a real Sanity payload.
- Browser verification: register someone for one event and confirm they get that
  Space and no other. That is the proof this whole change exists to deliver.
