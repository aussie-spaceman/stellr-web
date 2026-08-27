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
