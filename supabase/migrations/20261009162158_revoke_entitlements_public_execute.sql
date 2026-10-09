-- =====================================================================
-- Revoke PUBLIC/anon/authenticated access to the `entitlements` schema.
--
-- Deep review C-6 (finding DB-1). Migration 090 exposed the `entitlements`
-- schema to PostgREST and granted USAGE to anon + authenticated so the app's
-- service-role client could reach it. Its header claimed "Security unchanged:
-- RLS on every entitlements table denies anon/authenticated" — but that is the
-- wrong model for functions. Postgres grants EXECUTE on every new function to
-- PUBLIC by default, and the schema's SECURITY DEFINER functions run as their
-- owner, so RLS never applies to them. The net effect: anyone holding the
-- public anon key (shipped in every page bundle) could call 15 definer
-- functions over PostgREST — granting allocations, confirming unpaid bookings,
-- cancelling other people's cohorts, minting credit.
--
-- Confirmed executable by anon on BOTH dev and production (9 Oct 2026).
--
-- The app itself only ever reaches `entitlements` through the service-role key
-- (lib/entitlements.ts via supabaseServer()), which keeps its own grants from
-- 090 and is unaffected. No anon/authenticated code path uses this schema.
-- =====================================================================

-- 1. Remove EXECUTE on every existing entitlements function from the public
--    web roles. This is what closes the hole.
revoke execute on all functions in schema entitlements from public, anon, authenticated;

-- 2. Stop future functions in this schema from being auto-granted to PUBLIC,
--    so a later `create function` here cannot silently reopen it.
alter default privileges in schema entitlements
  revoke execute on functions from public;

-- 3. Defence in depth: without USAGE on the schema, anon/authenticated cannot
--    resolve or reach anything in it through PostgREST even if a future grant
--    slips through. service_role keeps its USAGE from migration 090.
revoke usage on schema entitlements from anon, authenticated;

-- Re-read the config so PostgREST drops the now-inaccessible routes promptly.
notify pgrst, 'reload config';
