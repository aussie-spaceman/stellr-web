-- 143 — Teach event_slug_inventory() about the Space→event link.
--
-- The function (migration 139) discovers its sources by scanning
-- information_schema for columns literally named `event_slug`.
-- community_space_sources.object_ref holds an event slug when object_type =
-- 'event', under a different name, so it was invisible to both
-- `npm run audit:event-slugs` and `rename_event_slug()`.
--
-- That is exactly how the Nevada Space came to point at
-- `nevada-space-design-challenge-2027` — a slug in no Sanity document — with its
-- event link dead while check:deploy-ready reported all-clear.
--
-- Filtered on object_type, because the same column holds a training uuid or a
-- cohort uuid for other rows, which must not be reported as missing events.
--
-- All 6 event links in prod resolve cleanly today, so this does not change the
-- audit's verdict now; it means a future rename cannot break one silently.
--
-- DELIBERATELY NOT INCLUDED: mentoring_cohorts.campaign_ref, which holds a bare
-- event slug when container_type = 'event_participation' and is the same kind of
-- blind spot. Adding it would immediately flag 16 rows across 5 slugs
-- (environmental-design-campaign, minnesota-environmental-design-challenge-2026,
-- nevada-space-design-challenge-2026, nevada-space-design-challenge-2027,
-- space-design-campaign-fall-2027). Two of those read as CAMPAIGN slugs stored
-- under an event container type, and the audit only compares against Sanity
-- documents of _type == "event", so they would be permanent false positives.
-- Sorting legacy rows from miscategorised ones is a data decision, not a schema
-- one — see the 26 Aug handover before widening this further.

create or replace function public.event_slug_inventory()
returns table (event_slug text, table_name text, row_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  -- 1. Every column actually named event_slug (unchanged behaviour).
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

  -- 2. Space→event links.
  return query
    select object_ref::text,
           'community_space_sources.object_ref'::text,
           count(*)::bigint
    from public.community_space_sources
    where object_type = 'event' and object_ref is not null
    group by 1;
end;
$$;

revoke execute on function public.event_slug_inventory() from public, anon, authenticated;
