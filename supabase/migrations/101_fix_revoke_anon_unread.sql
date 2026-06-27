-- 101_fix_revoke_anon_unread.sql
-- Fixes migration 099, which was a no-op: `REVOKE EXECUTE ... FROM anon` does not remove
-- access when EXECUTE is granted to PUBLIC (Postgres functions default to PUBLIC EXECUTE),
-- so anon still inherited it. The correct form revokes from PUBLIC and grants back only to
-- the roles that need it.
--
-- space_unread_counts is server-only (lib/community-feed.ts via service role) and not used
-- in any RLS policy, so anon never needs it. authenticated is granted too (harmless, future-proof).

revoke execute on function public.space_unread_counts(uuid) from public;
grant execute on function public.space_unread_counts(uuid) to authenticated, service_role;
