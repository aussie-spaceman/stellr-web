# Handover — Space access, role rooms, event Spaces (25 Aug 2026)

**Status:** all code merged to `main` and deployed; both migrations applied to prod.
**Commits:** `14f39ec` (access fix), `0482ae1` (migrations 140 + 141)
**Deployment:** Vercel `dpl_GvrMdFtkjbwQtCKZVjJ1uAphoHxd` — READY, aliased to
`stellreducation.org`, `www.` and `app.`
**Close-out doc (tabulated, tick-off):**
https://docs.google.com/document/d/123IHsjY0jadCJ499wPYQdqu8lUWQCcy7mT3v5Fveb5o/edit

---

## 1. What triggered this

Three new members — teachers `scottc3@nv.ccsd.net` and `mmmatlock@wcpss.net`, mentor
`elizabethcobian094@gmail.com` — appeared to have no Space access, and no Space showed any
members at all.

**The grants were never broken.** All three held the correct tier and role in prod the whole
time. Two code defects made it look otherwise.

## 2. Defect A — rosters are sparse by design, but everything counted them

`community_space_members` rows are only written by Object inheritance, an accepted invite, or
joining an open Space. **Tier and role access is resolved at READ time and writes no row.**
The directory counts, the Space Members tab and the admin Spaces list all read that table
alone, so every Space reported zero members.

Fixed by `resolveSpaceAudiences()` in `lib/spaces.ts` — one batched resolve deriving the real
audience the same way `resolveSpaceAccess` does (roster → open = every live member → assigned
tiers + assigned roles). Now used by the directory counts, `getSpaceForMember`, the Members
tab, the admin list and `spaceNotificationAudience`.

> `spaceNotificationAudience` previously resolved roster + open + tier members but **not
> role-granted ones**, so an announcement in a role room notified nobody. That is fixed but
> has not been exercised since — no announcement has been sent.

## 3. Defect B — two access systems that disagreed

`memberCanAccessSpace` went through the legacy `content_entitlements` matrix with
`min_tier_rank` as fallback, while the directory and Space pages used the Space access model.
They disagreed **both ways**:

- Two `content_entitlements` rows pinned the **open** General Space to Subscriber + Scholar,
  so Educator and Alumni were blocked from its feed, posts and chat while the directory
  advertised it as open to all. **This was the real "can't see it" bug.**
- `min_tier_rank = 0` on private tier Spaces let *any* member read their posts in the Home feed.

`memberCanAccessSpace` now delegates to `getSpaceAccessById`. The Home feed resolves in one
batch (`getAccessibleSpaceIds`) instead of a query per Space.

**Consequence:** `content_entitlements` rows with `target_type='space'` are now dead data.
The two General rows are still in prod — inert, but they read as live config. Delete them.
Other target types (training_module / mentoring / coaching / event materials) still use the matrix.

## 4. Migration 140 — role Spaces removed

Deleted `role-staff`, `role-moderator`, `role-teacher`. All three verified empty first (0 posts,
announcements, resources, chat channels, roster rows, invites).

**Why a migration and not a prod-only delete:** migration 125 seeds one role Space per adult
role with `ON CONFLICT DO NOTHING`, so a rebuilt database would recreate them.

Coaches', Mentors' and Volunteers' Rooms are untouched.

## 5. Migration 141 — four event Spaces, plus two fixes

New private Spaces for `nebraska-space-design-challenge`, `colorado-space-design-challenge`,
`colorado-environmental-design-challenge`, `minnesota-environmental-design-challenge`.
Each: `min_tier_rank` 1, one `general` channel, five role grants (participant, staff,
student_manager, teacher, volunteer), and a `community_space_sources` event link.

**Slugs match the published Sanity event slug exactly** — a deliberate change from the two
older Spaces, which carry a `2027-` prefix matching nothing in Sanity.

Also: themes corrected (Space Design → `space`, Environmental → `enviro`; both older Challenge
Spaces were seeded `enviro`), and the Nevada event link repaired — see below.

## 6. ⚠️ The trap worth carrying forward

The Nevada Space pointed at event slug `nevada-space-design-challenge-2027`, **which exists
nowhere in Sanity**. Its event link was dead, so no Nevada registrant could ever inherit it.

Nothing surfaced this, because:

> `public.event_slug_inventory()` — which backs `npm run audit:event-slugs` and therefore
> `check:deploy-ready` — **only scans columns literally named `event_slug`.**
> `community_space_sources.object_ref` is not such a column, so Space→event links are invisible
> to both the audit **and** `rename_event_slug()`. The audit reported all-clear throughout.

Repointed in 141. **The audit gap itself is still open and will bite again on the next slug
rename.** Widening `event_slug_inventory()` and `rename_event_slug()` to cover
`community_space_sources.object_ref where object_type='event'` is the highest-value remaining item.

`lib/container-sync.ts` writes `campaign_ref` = the **bare** event slug, so un-suffixed is the
live convention; the `-2026`/`-2027` cohorts in prod are legacy and all empty.

`reconcileEventSpaceRoster` was run after repointing and added **0 members** — correct, because
all 8 Nevada registrations are `withdrawn` and there are no active cohort members. The repaired
link has therefore never actually rostered a human.

## 7. Open items

Full tick-off table in the Google Doc. The ones that matter most:

1. **`mmmatlock@wcpss.net` and `elizabethcobian094@gmail.com` have blank `first_name` and
   `last_name`** — they render as the literal word "Member" in the Members tab this session
   fixed. Both have a `clerk_user_id`; check Clerk before asking the humans.
2. **Every teacher can enter every state Challenge Space.** All 6 grant the global `teacher`
   role, so all 4 teachers see all 6 regardless of involvement. This was flagged for the
   original 2 Spaces, went unanswered, and was then replicated into the 4 new ones. **Needs a
   decision:** per-event (drop the global role grants, rely on the event link) or teacher-wide.
3. **Nobody has loaded `/community` as one of these three members.** Everything is verified at
   the data layer (resolver replicated in SQL), plus prod 200s and zero runtime errors.
4. Delete the two dead `content_entitlements` space rows.
5. Widen the slug audit (section 6).
6. `min_tier_rank` is now vestigial for Spaces — nothing gates on it.
7. `resolveSpaceAudiences` materialises every live member for an open Space
   (`.range(0, 99_999)`). Fine at 6 members; revisit approaching four figures.
8. **"TEST Project Management 101" disappeared mid-session** — present at session start, gone
   before 140 ran, not deleted by it. Another session or admin removed it.

## 8. How to check a Space's real audience without the app

Union of: open → all live members; `community_space_tiers` → `member_memberships` (active,
unexpired); `community_space_roles` → `member_roles` (`scope='global'`); active roster rows.
Intersect with members that are `is_active` and `deleted_at is null`.
