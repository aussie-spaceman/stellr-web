-- Free the word "staff" for the Staff role (13 Nov 2026).
--
-- Until now "staff" meant three things in the schema, none of them the Staff
-- role that is coming (between Event Manager and Admin):
--   staff_roles            the duty scopes that route admin alerts and the
--                          Friday digest                       → admin_duties
--   event_staff_check_ins  desk check-ins of volunteer mentors and event
--                          managers, who are crew              → event_crew_check_ins
--   tenant_role 'staff'    the S3 mirror of a staff_roles row   → 'duty_holder'
-- member_role_type 'staff' keeps its name: it will mirror the Staff role. Its
-- rows were only ever backfilled from staff_roles (migration 096), so they go.
--
-- Deploy order: this runs BEFORE the code that uses the new names. For that gap,
-- and for one release after, the old table names stay readable and writable
-- through compatibility views (security_invoker, service_role only, as the
-- tables are). A follow-up migration drops them. tenant_role has no such shim:
-- an old-code write of 'staff' in the gap fails inside role-sync's guard, which
-- reports it, and the next scripts/map-tenancy-roles.ts run repairs any drift.
--
-- Renames take an ACCESS EXCLUSIVE lock for an instant; run outside event hours.

SET lock_timeout = '5s';

-- 1. staff_roles → admin_duties
ALTER TABLE public.staff_roles RENAME TO admin_duties;
ALTER TABLE public.admin_duties RENAME CONSTRAINT staff_roles_pkey TO admin_duties_pkey;
ALTER TABLE public.admin_duties RENAME CONSTRAINT staff_roles_member_id_fkey TO admin_duties_member_id_fkey;
ALTER TABLE public.admin_duties RENAME CONSTRAINT staff_roles_granted_by_fkey TO admin_duties_granted_by_fkey;
ALTER POLICY "service role full access staff_roles" ON public.admin_duties RENAME TO "service role full access admin_duties";
COMMENT ON TABLE public.admin_duties IS
  'Duties: which admins get which alerts and digests (scopes all, events, memberships, community, academy, graduations). A duty never opens the admin portal. Was staff_roles until 13 Nov 2026.';

-- 2. event_staff_check_ins → event_crew_check_ins, staff_key → crew_key
ALTER TABLE public.event_staff_check_ins RENAME TO event_crew_check_ins;
ALTER TABLE public.event_crew_check_ins RENAME COLUMN staff_key TO crew_key;
ALTER TABLE public.event_crew_check_ins RENAME CONSTRAINT event_staff_check_ins_pkey TO event_crew_check_ins_pkey;
ALTER TABLE public.event_crew_check_ins RENAME CONSTRAINT event_staff_check_ins_event_slug_staff_key_key TO event_crew_check_ins_event_slug_crew_key_key;
ALTER TABLE public.event_crew_check_ins RENAME CONSTRAINT event_staff_check_ins_staff_key_check TO event_crew_check_ins_crew_key_check;
ALTER TABLE public.event_crew_check_ins RENAME CONSTRAINT event_staff_check_ins_check_in_method_check TO event_crew_check_ins_check_in_method_check;
ALTER TABLE public.event_crew_check_ins RENAME CONSTRAINT event_staff_check_ins_role_check TO event_crew_check_ins_role_check;
ALTER TABLE public.event_crew_check_ins RENAME CONSTRAINT event_staff_check_ins_member_id_fkey TO event_crew_check_ins_member_id_fkey;
ALTER TABLE public.event_crew_check_ins RENAME CONSTRAINT event_staff_check_ins_tenant_id_fkey TO event_crew_check_ins_tenant_id_fkey;
ALTER INDEX public.event_staff_check_ins_tenant_id_idx RENAME TO event_crew_check_ins_tenant_id_idx;
ALTER INDEX public.event_staff_check_ins_member_id_idx RENAME TO event_crew_check_ins_member_id_idx;
ALTER POLICY "service role full access event_staff_check_ins" ON public.event_crew_check_ins RENAME TO "service role full access event_crew_check_ins";
-- The trigger, grants and policies moved with the table. They are restated
-- under the new name so the migrations read true (and lint:tenancy can see them).
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.event_crew_check_ins;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.event_crew_check_ins
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_crew_check_ins TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.event_crew_check_ins;
CREATE POLICY tenant_isolation ON public.event_crew_check_ins AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.event_crew_check_ins;
CREATE POLICY tenant_isolation_guard ON public.event_crew_check_ins AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (event_crew_check_ins.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = event_crew_check_ins.event_slug)));
COMMENT ON TABLE public.event_crew_check_ins IS
  'Desk check-ins of volunteer mentors and event managers (crew), who are not on the event roster (lib/check-in-crew.ts). Was event_staff_check_ins until 13 Nov 2026.';

-- 3. tenant_role 'staff' → 'duty_holder'. Existing rows follow the label.
ALTER TYPE public.tenant_role RENAME VALUE 'staff' TO 'duty_holder';

-- 4. member_role 'staff' rows were backfilled from staff_roles; the value now
--    belongs to the Staff role, which nobody holds yet.
DELETE FROM public.member_roles WHERE role = 'staff' AND source = 'backfill';

-- 5. Compatibility views for the old names, for the deploy gap and one release.
CREATE VIEW public.staff_roles WITH (security_invoker = true) AS
  SELECT * FROM public.admin_duties;
CREATE VIEW public.event_staff_check_ins WITH (security_invoker = true) AS
  SELECT id, event_slug, crew_key AS staff_key, role, member_id, checked_in_at, check_in_method, checked_in_by, created_at, tenant_id
  FROM public.event_crew_check_ins;
REVOKE ALL ON public.staff_roles, public.event_staff_check_ins FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_roles, public.event_staff_check_ins TO service_role;
COMMENT ON VIEW public.staff_roles IS 'Compatibility view for code older than 13 Nov 2026. Dropped one release later.';
COMMENT ON VIEW public.event_staff_check_ins IS 'Compatibility view for code older than 13 Nov 2026. Dropped one release later.';

NOTIFY pgrst, 'reload schema';
