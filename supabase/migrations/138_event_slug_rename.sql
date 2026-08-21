-- ─── Safe event slug renames ─────────────────────────────────────────────────
--
-- `event_slug` is the join key from Sanity to every event-scoped table, and
-- Postgres has no foreign key to Sanity — so renaming an event's slug in the
-- Studio silently orphans every row that referenced the old value. On 21 Aug
-- 2026 three slug edits stranded 30 rows across five tables; nothing errored,
-- and the rows simply stopped resolving.
--
-- These two functions make a rename a single atomic operation over EVERY table
-- carrying an `event_slug` column. They discover those tables from the catalog
-- rather than a hard-coded list, so a table added later is covered without
-- anyone remembering to update this file — which is the whole point, since the
-- failure mode is silence.
--
-- Callers: scripts/fix-event-slug.ts (rename) and scripts/audit-event-slugs.ts
-- (detection). Service-role only — EXECUTE is revoked from the API roles below.

-- Row counts per table for one slug. Only tables with matches are returned.
create or replace function public.event_slug_row_counts(p_slug text)
returns table (table_name text, row_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n bigint;
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
    execute format('select count(*) from public.%I where event_slug = $1', r.t)
      into n using p_slug;
    if n > 0 then
      table_name := r.t;
      row_count := n;
      return next;
    end if;
  end loop;
end;
$$;

-- Repoint every row from one slug to another. Returns what it touched.
--
-- Runs inside the caller's transaction: if any table rejects the update (a
-- unique constraint on event_slug where BOTH slugs already have a row, say),
-- the whole rename aborts rather than leaving the data half-migrated. That is
-- deliberate — a partial rename is harder to spot than no rename at all.
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
end;
$$;

-- Neither function is for the app: they rewrite join keys across every event
-- table, so only the service role (scripts) may call them.
revoke execute on function public.event_slug_row_counts(text) from public, anon, authenticated;
revoke execute on function public.rename_event_slug(text, text) from public, anon, authenticated;
