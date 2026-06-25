-- =====================================================================
-- 090_entitlements_expose.sql
-- Make the `entitlements` schema reachable from the app's supabase-js
-- (service-role) client: grant the service role usage + table/function
-- privileges, and add the schema to PostgREST's exposed schemas so
-- db.schema('entitlements').from(...) / .rpc(...) route correctly.
--
-- Security unchanged: RLS on every entitlements table denies anon/authenticated
-- (no member policies); only the server-only service-role key can read/write.
-- If the role setting is ever reset by a dashboard change, re-add `entitlements`
-- under Settings → API → Exposed schemas (it does the same thing).
-- =====================================================================

grant usage on schema entitlements to service_role, anon, authenticated;

grant select, insert, update, delete on all tables in schema entitlements to service_role;
grant execute on all functions in schema entitlements to service_role;

alter default privileges in schema entitlements
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema entitlements
  grant execute on functions to service_role;

-- Expose to PostgREST (Supabase reads this off the authenticator role).
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, entitlements';
notify pgrst, 'reload config';
