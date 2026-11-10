-- Mentor and event-manager check-in (10 Nov 2026).
--
-- The registration desk checks in everyone on an event's roster through
-- participants.checked_in_at. Volunteer mentors (event container cohort
-- members) and the event's event managers are not on the roster, so they had
-- no way to be checked in. The desk's Mentors tab writes one row here per
-- person who arrives; undo deletes it. The "All attendees" email group reads
-- both (lib/event-emails/audiences.ts).
--
-- staff_key names the person as the desk lists them (lib/check-in-staff.ts):
--   v.<members.id>        an assigned volunteer mentor
--   m.<Clerk user id>     an event manager of this event
-- member_id is the person's members row when there is one, so purging a member
-- removes their check-ins with them (ON DELETE CASCADE, as on cohort_members).
--
-- Event-scoped: tenant_id is derived from event_slug (S3/S4).

CREATE TABLE IF NOT EXISTS public.event_staff_check_ins (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_slug       text NOT NULL,
  staff_key        text NOT NULL CHECK (staff_key ~ '^[vm]\.[A-Za-z0-9_-]{1,64}$'),
  role             text NOT NULL CHECK (role IN ('volunteer', 'event_manager')),
  member_id        uuid REFERENCES public.members (id) ON DELETE CASCADE,
  checked_in_at    timestamptz NOT NULL DEFAULT now(),
  check_in_method  text NOT NULL DEFAULT 'manual' CHECK (check_in_method IN ('manual')),
  -- Clerk id of the desk user who tapped, for the audit trail.
  checked_in_by    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  tenant_id        uuid REFERENCES public.tenants (id) ON DELETE RESTRICT,
  UNIQUE (event_slug, staff_key)
);

CREATE INDEX IF NOT EXISTS event_staff_check_ins_tenant_id_idx ON public.event_staff_check_ins (tenant_id);
CREATE INDEX IF NOT EXISTS event_staff_check_ins_member_id_idx ON public.event_staff_check_ins (member_id);

ALTER TABLE public.event_staff_check_ins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_staff_check_ins FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_staff_check_ins TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access event_staff_check_ins"
    ON public.event_staff_check_ins FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tenant derivation (S3).
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.event_staff_check_ins;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.event_staff_check_ins
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- Tenant isolation (S4).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_staff_check_ins TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.event_staff_check_ins;
CREATE POLICY tenant_isolation ON public.event_staff_check_ins AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.event_staff_check_ins;
CREATE POLICY tenant_isolation_guard ON public.event_staff_check_ins AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (event_staff_check_ins.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = event_staff_check_ins.event_slug)));

COMMENT ON TABLE public.event_staff_check_ins IS
  'Desk check-ins of volunteer mentors and event managers, who are not on the event roster (lib/check-in-staff.ts).';
