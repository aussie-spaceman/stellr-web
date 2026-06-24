-- 075_backfill_space_owner.sql
--
-- New spaces seed their creating admin as an active member (so the roster shows
-- ≥1). Spaces created before that change have no owner row — backfill the platform
-- admin as an active 'admin' member of every non-archived space that currently has
-- no active member, so existing spaces also reflect at least one member.

insert into public.community_space_members (space_id, member_id, role, status, accepted_at)
select s.id, m.id, 'admin', 'active', now()
from public.community_spaces s
cross join lateral (
  select id from public.members
  where lower(email) = 'david.shaw@insimeducation.com'
  limit 1
) m
where s.is_archived = false
  and not exists (
    select 1 from public.community_space_members csm
    where csm.space_id = s.id and csm.status = 'active'
  )
on conflict (space_id, member_id) do nothing;
