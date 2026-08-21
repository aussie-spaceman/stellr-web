-- ─── Event slug inventory ────────────────────────────────────────────────────
--
-- Every (slug, table, row count) triple across the schema, for detecting slugs
-- that exist in the database but no longer exist in Sanity — i.e. rows orphaned
-- by a slug rename. Companion to 138's rename/count functions; same catalog
-- lookup, so tables added later are covered automatically.
--
-- Caller: scripts/audit-event-slugs.ts. Service-role only.
create or replace function public.event_slug_inventory()
returns table (event_slug text, table_name text, row_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
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
end;
$$;

revoke execute on function public.event_slug_inventory() from public, anon, authenticated;
