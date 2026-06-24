-- 076_community_resource_tiers.sql
--
-- Per-resource permission override ("green circle" rebuilt to per-tier intent).
-- A resource with NO rows here keeps its existing behaviour (open to whoever can
-- reach its space, or all members when it has no space). A resource WITH rows is
-- visible/downloadable only to members holding one of the listed membership tiers
-- (platform admins always bypass). Scoped to specific tiers, not a free/paid flag.

create table if not exists public.community_resource_tiers (
  resource_id uuid not null references public.community_resources(id) on delete cascade,
  tier_id     uuid not null references public.membership_tiers(id) on delete cascade,
  primary key (resource_id, tier_id)
);

create index if not exists community_resource_tiers_resource_idx
  on public.community_resource_tiers (resource_id);

alter table public.community_resource_tiers enable row level security;

-- All access is via the service-role server client; scope the policy to
-- service_role (not {public}) so the anon key cannot read/write it.
drop policy if exists "service role full access" on public.community_resource_tiers;
create policy "service role full access" on public.community_resource_tiers
  for all to service_role using (true) with check (true);
