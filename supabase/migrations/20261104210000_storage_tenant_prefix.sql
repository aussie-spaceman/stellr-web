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
-- public.storage_object_tenant_id(name) answers that for one path. It is what
-- a future storage.objects policy calls:
--   USING (bucket_id = '…' AND public.storage_object_tenant_id(name) = (SELECT public.app_tenant_id()))
-- No storage.objects policy is created here: every bucket is private and the
-- app reaches Storage only with the secret key (signed URLs), so there is no
-- policy to change on a live flow, and storage.objects belongs to the Storage
-- service's own role (whether the migration role may add policies to it is an
-- owner check, docs/TENANCY-S4.md). S5 adds the policies when a tenant path
-- first writes to Storage.
--
-- Why SECURITY DEFINER (unavoidable): the answer needs every tenant id. As
-- SECURITY INVOKER, tenant_app sees only its own tenants row (20261104200000),
-- so in Stellr's context a path under another tenant's id would look legacy
-- — and be Stellr's. The function returns one tenant id for a path the caller
-- names; it cannot list tenants. search_path is pinned, EXECUTE is revoked
-- from PUBLIC, anon and authenticated and granted to tenant_app and
-- service_role only.
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
  'Owner tenant of a Storage object path: the tenant whose id is the first path segment, else Stellr (legacy objects stay Stellr''s). For storage.objects policies (S5). docs/TENANCY-S4.md.';

REVOKE EXECUTE ON FUNCTION public.storage_object_tenant_id(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storage_object_tenant_id(text) TO tenant_app, service_role;
