-- S4 "Database-enforced isolation" (multi-tenancy plan), step 2: who owns a
-- Storage object.
--
-- The rule (docs/TENANCY-S4.md, "Storage"):
--   * a NEW object written for a tenant goes under `{tenant_id}/…` in its
--     bucket (lib/tenancy/storage.ts, tenantObjectPath);
--   * every object already in Storage stays exactly where it is, and is
--     Stellr's by policy. Nothing is moved.
--
-- Legacy paths can themselves start with a uuid — `{member_id}/…` (teacher
-- licences, community media), `{event_slug}/{registration_id}/…` — so "the
-- first segment is a uuid" does not make a path a tenant path. A path belongs
-- to tenant X only when its first segment is X's id AND X is a row of
-- public.tenants; anything else is legacy, and so Stellr's. Member, agreement
-- and registration ids are random v4 uuids drawn independently of tenant ids,
-- so a legacy path is never mistaken for another tenant's.
--
-- public.storage_object_tenant_id(name) answers that for one path, in SQL —
-- for server-side audits and listings (which objects belong to whom) and for
-- tenantDb reads. lib/tenancy/storage.ts applies the same rule in code.
--
-- Where the rule is enforced: in server code, not in a storage.objects
-- policy. Uploads, downloads and signed URLs go through the Storage HTTP API,
-- which runs as the role the key or JWT carries: service_role for the secret
-- key the app uses (BYPASSRLS, so no policy applies), anon or authenticated
-- for a browser. Nothing reaches Storage as tenant_app, so a policy TO
-- tenant_app would never bind. S5's tenant upload code builds every path with
-- tenantObjectPath and checks every path it signs or reads with
-- assertTenantObjectPath (docs/TENANCY-S4.md, "Storage"). No storage.objects
-- policy is created here, and none is changed.
--
-- Why SECURITY DEFINER (unavoidable): the answer needs every tenant id. As
-- SECURITY INVOKER, tenant_app sees only its own tenants row (20261104200000),
-- so in Stellr's context a path under another tenant's id would look legacy
-- — and be Stellr's. The function returns one tenant id for a path the caller
-- names; it cannot list tenants. search_path is pinned, EXECUTE is revoked
-- from PUBLIC, anon and authenticated and granted to tenant_app and
-- service_role only (a browser-facing policy would need its own design and
-- grant: browsers do not reach Storage directly today).
--
-- Additive: one function, no table, no data change, no live caller.

CREATE OR REPLACE FUNCTION public.storage_object_tenant_id(p_name text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT t.id
       FROM public.tenants t
      WHERE strpos(COALESCE(p_name, ''), '/') > 1
        AND split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND t.id = split_part(p_name, '/', 1)::uuid),
    -- lib/tenancy/constants.ts STELLR_TENANT_ID: legacy objects are Stellr's.
    '00000000-0000-4000-8000-000000000001'::uuid
  )
$$;

COMMENT ON FUNCTION public.storage_object_tenant_id(text) IS
  'Owner tenant of a Storage object path: the tenant whose id is the first path segment, else Stellr (legacy objects stay Stellr''s). For server-side audits and tenantDb reads; the rule is enforced in server code (Storage API traffic never runs as tenant_app). docs/TENANCY-S4.md.';

REVOKE EXECUTE ON FUNCTION public.storage_object_tenant_id(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storage_object_tenant_id(text) TO tenant_app, service_role;
