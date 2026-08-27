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
