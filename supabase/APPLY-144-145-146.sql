-- Migrations 144 + 145 + 146, in order, as ONE transaction.
-- Generated 28 Aug 2026 for feat/event-space-provisioning-2026-08-27.
-- Paste into the Supabase SQL editor and run. Rolls back entirely if any part fails.
-- 144 and 145 MUST go together: 144 widens the slug audit that check:deploy-ready gates on,
-- and 145 is what clears the 5 stale slugs it will then see.

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- 144_event_space_identity.sql
-- ══════════════════════════════════════════════════════════════════
-- 144 — Give the event→Space link a durable identity, and teach the slug tools
--       about every column that actually holds an event slug.
--
-- WHY
--
-- An event's Space is reached through a chain of slug-keyed hops:
--
--   community_spaces
--     → community_space_sources.object_ref   (event slug)
--       → mentoring_cohorts.campaign_ref     (event slug)
--         → cohort_members                   (the roster)
--
-- Every hop is a bare text slug, and Postgres has no foreign key to Sanity. So
-- renaming a slug in the Studio silently cuts the chain: the rows survive, they
-- just stop resolving. That is what happened when the year suffixes were pulled
-- (`-2027` etc.) — the `event_slug` columns were repaired by
-- rename_event_slug(), but campaign_ref and object_ref were not, because
-- migration 138 discovers its targets by scanning information_schema for
-- columns literally NAMED `event_slug`. Both of these hold an event slug under
-- a different name, so both were invisible to the rename AND to
-- `npm run audit:event-slugs`, which reported all-clear the whole time.
--
-- Migration 143 closed half of this (object_ref in the inventory only) and
-- deliberately left campaign_ref alone, calling it a data decision. That
-- decision has now been made: an event's Space is provisioned from its Sanity
-- document and must survive a rename, so every hop has to be repairable.
--
-- WHAT THIS DOES
--
-- 1. sanity_event_id — the Sanity document _id, which never changes, recorded
--    on the Space and on the event container. The slug stays the join key
--    (nothing rewires here); the _id is the stable handle the sync uses to
--    find an existing row when the slug has moved underneath it. Backfilled by
--    `npm run sync:event-spaces`, which is the only thing that can read Sanity.
--
-- 2. rename_event_slug() — extended to the three other slug-bearing columns.
--    Each is filtered by its type discriminator, because the same column also
--    holds training/cohort uuids for other rows, and those must not be rewritten.
--
-- 3. event_slug_inventory() — the audit's source list, widened to match. This
--    supersedes migration 143: it is written as the complete final definition so
--    it lands correctly whether or not 143 was ever applied (it was not, in
--    prod, as of 27 Aug 2026).
--
-- Applying 3 will make `npm run audit:event-slugs` report the 5 stale
-- campaign_ref slugs that were previously invisible. Migration 145 repairs them.

-- ─── 1. Durable Sanity identity ──────────────────────────────────────────────

alter table public.community_spaces
  add column if not exists sanity_event_id text;

alter table public.mentoring_cohorts
  add column if not exists sanity_event_id text;

comment on column public.community_spaces.sanity_event_id is
  'Sanity event document _id. Survives slug renames; the handle the event-sync '
  'webhook uses to find this Space. NULL for tier/role Spaces, which have no event.';

comment on column public.mentoring_cohorts.sanity_event_id is
  'Sanity event document _id for event_participation containers. NULL otherwise.';

-- One Space per Sanity event. Partial, so the many NULL rows (tier/role Spaces)
-- are unconstrained.
create unique index if not exists community_spaces_sanity_event_id_key
  on public.community_spaces (sanity_event_id)
  where sanity_event_id is not null;

-- Not unique: an event has one root container plus a group sub-container per
-- registration, and they all share the event.
create index if not exists mentoring_cohorts_sanity_event_id_idx
  on public.mentoring_cohorts (sanity_event_id)
  where sanity_event_id is not null;

-- ─── 2. rename_event_slug: cover the columns that don't say "event_slug" ─────

create or replace function public.rename_event_slug(p_old text, p_new text)
returns table (table_name text, rows_updated bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n bigint;
begin
  if coalesce(p_old, '') = '' or coalesce(p_new, '') = '' then
    raise exception 'rename_event_slug: both the old and new slug are required';
  end if;
  if p_old = p_new then
    raise exception 'rename_event_slug: old and new slug are identical (%)', p_old;
  end if;

  -- 2a. Every column actually named event_slug (migration 138 behaviour).
  for r in
    select c.table_name as t
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'event_slug'
      and tb.table_type = 'BASE TABLE'
    order by c.table_name
  loop
    execute format('update public.%I set event_slug = $2 where event_slug = $1', r.t)
      using p_old, p_new;
    get diagnostics n = row_count;
    if n > 0 then
      table_name := r.t;
      rows_updated := n;
      return next;
    end if;
  end loop;

  -- 2b. The event container's slug. Filtered on container_type: campaign_ref is
  -- only an event slug for event_participation rows.
  update public.mentoring_cohorts
     set campaign_ref = p_new
   where campaign_ref = p_old
     and container_type = 'event_participation';
  get diagnostics n = row_count;
  if n > 0 then
    table_name := 'mentoring_cohorts.campaign_ref';
    rows_updated := n;
    return next;
  end if;

  -- 2c. The Space→event link. Filtered on object_type: object_ref holds a
  -- training module id or a cohort uuid for other rows.
  update public.community_space_sources
     set object_ref = p_new
   where object_ref = p_old
     and object_type = 'event';
  get diagnostics n = row_count;
  if n > 0 then
    table_name := 'community_space_sources.object_ref';
    rows_updated := n;
    return next;
  end if;

  -- 2d. Course→object attachments. Empty in prod today, same shape of trap.
  update public.course_object_assignments
     set object_ref = p_new
   where object_ref = p_old
     and object_type = 'event';
  get diagnostics n = row_count;
  if n > 0 then
    table_name := 'course_object_assignments.object_ref';
    rows_updated := n;
    return next;
  end if;
end;
$$;

-- ─── 3. event_slug_inventory: the audit sees the same columns ────────────────
--
-- Complete definition (supersedes 143), so this is correct whether or not 143
-- was applied.

create or replace function public.event_slug_inventory()
returns table (event_slug text, table_name text, row_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  -- 3a. Every column actually named event_slug.
  for r in
    select c.table_name as t
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'event_slug'
      and tb.table_type = 'BASE TABLE'
    order by c.table_name
  loop
    return query execute format(
      'select event_slug::text, %L::text, count(*)::bigint from public.%I where event_slug is not null group by 1',
      r.t, r.t
    );
  end loop;

  -- 3b. Event containers.
  return query
    select campaign_ref::text,
           'mentoring_cohorts.campaign_ref'::text,
           count(*)::bigint
    from public.mentoring_cohorts
    where container_type = 'event_participation' and campaign_ref is not null
    group by 1;

  -- 3c. Space→event links.
  return query
    select object_ref::text,
           'community_space_sources.object_ref'::text,
           count(*)::bigint
    from public.community_space_sources
    where object_type = 'event' and object_ref is not null
    group by 1;

  -- 3d. Course→event attachments.
  return query
    select object_ref::text,
           'course_object_assignments.object_ref'::text,
           count(*)::bigint
    from public.course_object_assignments
    where object_type = 'event' and object_ref is not null
    group by 1;
end;
$$;

-- Both rewrite join keys across every event table, so they stay service-role only.
revoke execute on function public.rename_event_slug(text, text) from public, anon, authenticated;
revoke execute on function public.event_slug_inventory() from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 145_repair_event_containers_and_grants.sql
-- ══════════════════════════════════════════════════════════════════
-- 145 — One-off repair: repoint the stale event containers, and stop event
--       Spaces granting access by org-wide role.
--
-- Depends on 144 (which is what makes part 1's damage visible to the audit).
--
-- ─── PART 1: the containers the slug rename missed ───────────────────────────
--
-- When the year suffixes were pulled from the Sanity event slugs, migration
-- 138's rename_event_slug() repaired every column named `event_slug` but could
-- not see mentoring_cohorts.campaign_ref. So `registrations` and
-- `event_participations` moved to the new slug while the event CONTAINERS —
-- which hold the actual rosters — stayed on the old one.
--
-- That break sits in the middle of the Space inheritance chain
-- (space → source(slug) → container(campaign_ref) → cohort_members), so
-- objectActiveMemberIds() resolved to nothing and no registrant could inherit
-- their event's Space. Every event Space in prod has an empty roster because of
-- this.
--
-- 16 rows across 5 slugs, verified in prod 27 Aug 2026:
--
--   space-design-campaign-fall-2027               → space-design-campaign-fall
--   nevada-space-design-challenge-2026            → nevada-space-design-challenge
--   nevada-space-design-challenge-2027            → nevada-space-design-challenge
--   minnesota-environmental-design-challenge-2026 → minnesota-environmental-design-challenge
--   environmental-design-campaign                 → environmental-design-campaign-fall
--
-- THE COLLISION. The two Nevada refs collapse onto one slug, and
-- `mentoring_cohorts_event_container_uniq` (unique on campaign_ref where
-- container_type = 'event_participation' and parent_container_id is null)
-- permits only ONE root per event. A straight UPDATE therefore aborts with a
-- duplicate-key error partway through the repair. The roots have to be MERGED
-- first, and only then repointed — which is the order below.
--
-- The merge keeps the oldest root, re-parents the losing roots' group children
-- onto it, moves any roster rows off the losers, and deletes them. The delete is
-- guarded on the loser having no members and no remaining children, so a re-run
-- or an unexpected row can never take live data with it. (Nothing is at stake
-- in prod today: all 10 Nevada containers hold 0 members and every group belongs
-- to a withdrawn registration. The guard is for the re-run case.)
--
-- ─── PART 2: event Spaces must not grant by org-wide role ────────────────────
--
-- Migration 141 gave each event Space the five event roles (participant, staff,
-- student_manager, teacher, volunteer) as auto-grants, mirroring the two Spaces
-- that predated it. But community_space_roles matches a member's GLOBAL role —
-- resolveSpaceAccess() reads getGlobalRoleNames(), which excludes object-scoped
-- roles — so "teacher" means every teacher in the organisation, not the teachers
-- at that event. Any member holding a global 'teacher' row could enter EVERY
-- event's Space without registering for any of them; 7 members could, as of
-- 27 Aug 2026.
--
-- Event access comes from the event: the source link plus the container roster.
-- These grants are removed here, and lib/spaces.ts now refuses to apply tier or
-- role grants to an event-linked Space, so a stray checkbox cannot restore them.

-- ─── Part 1: merge colliding roots, then repoint ─────────────────────────────

DO $$
DECLARE
  m record;
  keeper uuid;
  moved bigint;
  removed bigint;
BEGIN
  FOR m IN
    SELECT new_slug, array_agg(old_slug) AS old_slugs
      FROM (VALUES
        ('space-design-campaign-fall-2027',               'space-design-campaign-fall'),
        ('nevada-space-design-challenge-2026',            'nevada-space-design-challenge'),
        ('nevada-space-design-challenge-2027',            'nevada-space-design-challenge'),
        ('minnesota-environmental-design-challenge-2026', 'minnesota-environmental-design-challenge'),
        ('environmental-design-campaign',                 'environmental-design-campaign-fall')
      ) AS t(old_slug, new_slug)
     GROUP BY new_slug
  LOOP
    -- The surviving root: the oldest among the roots on any of the old slugs
    -- AND any root already sitting on the destination slug.
    SELECT id INTO keeper
      FROM public.mentoring_cohorts
     WHERE container_type = 'event_participation'
       AND parent_container_id IS NULL
       AND (campaign_ref = ANY(m.old_slugs) OR campaign_ref = m.new_slug)
     ORDER BY created_at NULLS LAST, id
     LIMIT 1;

    IF keeper IS NULL THEN
      RAISE NOTICE 'no container to repair for %', m.new_slug;
      CONTINUE;
    END IF;

    -- Re-parent the losing roots' group children onto the keeper.
    UPDATE public.mentoring_cohorts child
       SET parent_container_id = keeper
     WHERE child.parent_container_id IN (
             SELECT id FROM public.mentoring_cohorts
              WHERE container_type = 'event_participation'
                AND parent_container_id IS NULL
                AND (campaign_ref = ANY(m.old_slugs) OR campaign_ref = m.new_slug)
                AND id <> keeper
           );
    GET DIAGNOSTICS moved = ROW_COUNT;

    -- Move roster rows off the losing roots, so the delete cannot strand anyone.
    -- Skipped where the member is already on the keeper (cohort_members is
    -- unique on (cohort_id, member_id)).
    UPDATE public.cohort_members cm
       SET cohort_id = keeper
     WHERE cm.cohort_id IN (
             SELECT id FROM public.mentoring_cohorts
              WHERE container_type = 'event_participation'
                AND parent_container_id IS NULL
                AND (campaign_ref = ANY(m.old_slugs) OR campaign_ref = m.new_slug)
                AND id <> keeper
           )
       AND NOT EXISTS (
             SELECT 1 FROM public.cohort_members k
              WHERE k.cohort_id = keeper AND k.member_id = cm.member_id
           );

    -- Anything left on a loser is a duplicate of a keeper row; drop it so the
    -- root can be deleted.
    DELETE FROM public.cohort_members cm
     WHERE cm.cohort_id IN (
             SELECT id FROM public.mentoring_cohorts
              WHERE container_type = 'event_participation'
                AND parent_container_id IS NULL
                AND (campaign_ref = ANY(m.old_slugs) OR campaign_ref = m.new_slug)
                AND id <> keeper
           );

    -- Delete the emptied losing roots. Guarded: no members, no children.
    DELETE FROM public.mentoring_cohorts losing
     WHERE losing.container_type = 'event_participation'
       AND losing.parent_container_id IS NULL
       AND (losing.campaign_ref = ANY(m.old_slugs) OR losing.campaign_ref = m.new_slug)
       AND losing.id <> keeper
       AND NOT EXISTS (SELECT 1 FROM public.cohort_members cm WHERE cm.cohort_id = losing.id)
       AND NOT EXISTS (SELECT 1 FROM public.mentoring_cohorts c WHERE c.parent_container_id = losing.id);
    GET DIAGNOSTICS removed = ROW_COUNT;

    -- Only now is the unique index free for the repoint.
    UPDATE public.mentoring_cohorts
       SET campaign_ref = m.new_slug
     WHERE container_type = 'event_participation'
       AND campaign_ref = ANY(m.old_slugs);

    RAISE NOTICE 'repaired %: keeper %, % child container(s) re-parented, % duplicate root(s) removed',
      m.new_slug, keeper, moved, removed;
  END LOOP;
END $$;

-- ─── Part 2: drop the role auto-grants from every event-linked Space ─────────

DELETE FROM public.community_space_roles r
 WHERE EXISTS (
   SELECT 1 FROM public.community_space_sources s
    WHERE s.space_id = r.space_id
      AND s.object_type = 'event'
 );

-- ══════════════════════════════════════════════════════════════════
-- 146_tier_spaces_for_every_tier.sql
-- ══════════════════════════════════════════════════════════════════
-- 146 — Every membership tier gets its Tier Space, automatically.
--
-- Rule 3: someone who joins as a member reaches the Spaces their tier gives them
-- — Educator → the Educator Tier Space, and so on.
--
-- That already worked for the ten tiers migration 125 seeded, but 125 named them
-- in a hard-coded list, so any tier created afterwards silently has no Space.
-- Two are in that position today:
--
--   Parent/Guardian — 1 active holder, who currently gets nothing
--   Subscriber      — 0 active holders
--
-- Membership tiers are created in SQL (there is no admin route that inserts
-- one), so the reliable place to automate this is the table itself rather than
-- an application path that tier creation does not go through.
--
-- The slug is derived rather than interpolated: lower(name) alone produces
-- 'tier-parent/guardian' for Parent/Guardian, which is not a usable URL.
--
-- Note for review: including Subscriber follows the rule uniformly. If
-- Subscriber is a mailing-list tier rather than a community one, delete its
-- Space — the trigger will not recreate it for an existing tier.

-- ─── Slug helper ─────────────────────────────────────────────────────────────

create or replace function public.tier_space_slug(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select 'tier-' || trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'));
$$;

-- ─── Provisioner, shared by the backfill and the trigger ─────────────────────

create or replace function public.ensure_tier_space(p_tier_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t_name text;
  s_slug text;
  s_id   uuid;
begin
  select name into t_name from public.membership_tiers where id = p_tier_id;
  if t_name is null then
    return null;
  end if;

  s_slug := public.tier_space_slug(t_name);

  -- Deliberately keyed on the canonical tier slug, NOT on "does this tier grant
  -- any Space at all". A tier can be granted to Spaces that are nothing to do
  -- with it — Educator currently grants both its own Tier Space and an event
  -- Space — so the looser check would see one of those, decide the tier was
  -- already provisioned, and leave it without the Space this rule is about.
  select id into s_id from public.community_spaces where slug = s_slug;
  if s_id is not null then
    -- Present but perhaps not linked (or the link was removed); make it so.
    insert into public.community_space_tiers (space_id, tier_id)
    values (s_id, p_tier_id)
    on conflict do nothing;
    return s_id;
  end if;

  insert into public.community_spaces
    (slug, name, description, access_type, min_tier_rank, display_order)
  values
    (s_slug, t_name || ' Tier Space',
     'Members-only space for everyone on the ' || t_name || ' tier.',
     'private', 0, 100)
  on conflict (slug) do nothing;

  select id into s_id from public.community_spaces where slug = s_slug;
  if s_id is null then
    return null;
  end if;

  insert into public.community_space_tiers (space_id, tier_id)
  values (s_id, p_tier_id)
  on conflict do nothing;

  insert into public.community_channels (space_id, slug, name, display_order)
  select s_id, 'general', 'General', 0
   where not exists (
     select 1 from public.community_channels
      where space_id = s_id and slug = 'general'
   );

  return s_id;
end;
$$;

-- ─── Backfill the tiers 125's list left out ──────────────────────────────────

DO $$
DECLARE
  t record;
  s_id uuid;
BEGIN
  FOR t IN SELECT id, name FROM public.membership_tiers ORDER BY name LOOP
    s_id := public.ensure_tier_space(t.id);
    IF s_id IS NULL THEN
      RAISE WARNING 'could not provision a Tier Space for %', t.name;
    END IF;
  END LOOP;
END $$;

-- ─── And for every tier created from here on ─────────────────────────────────

create or replace function public.tg_ensure_tier_space()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_tier_space(new.id);
  return new;
end;
$$;

drop trigger if exists membership_tiers_ensure_space on public.membership_tiers;
create trigger membership_tiers_ensure_space
  after insert on public.membership_tiers
  for each row
  execute function public.tg_ensure_tier_space();

revoke execute on function public.ensure_tier_space(uuid) from public, anon, authenticated;

-- Record them in the migration history so db push stays consistent.
insert into supabase_migrations.schema_migrations (version, name) values
  ('20260828000144','144_event_space_identity'),
  ('20260828000145','145_repair_event_containers_and_grants'),
  ('20260828000146','146_tier_spaces_for_every_tier')
on conflict (version) do nothing;

COMMIT;
