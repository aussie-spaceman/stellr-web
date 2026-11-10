-- Saved event email templates (9 Nov 2026): an email written for one event,
-- saved from its Email Reminders tab, becomes a starting point on every event
-- of the same tenant. Admins and event managers can save, update and delete.
--
-- A template is the reusable part of an email: name, groups, subject, body,
-- the DocuSign re-send flag and the schedule offset. Attachments are not kept:
-- they are stored per event, and a template outliving the event it came from
-- must not name another event's files.
--
-- Tenant-owned (tenant_id NOT NULL), not event-scoped: it has no event key, so
-- it is shared across the tenant's events.

CREATE TABLE IF NOT EXISTS public.event_email_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
  name                  text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  audiences             text[] NOT NULL DEFAULT '{}',
  subject               text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 300),
  body_json             jsonb,
  resend_docusign       boolean NOT NULL DEFAULT false,
  schedule_days_before  integer CHECK (schedule_days_before IS NULL OR schedule_days_before BETWEEN 0 AND 365),
  -- Where it was last saved from, for the picker's hint. Not a foreign key:
  -- the template outlives the email and the event.
  source_event_slug     text CHECK (source_event_slug IS NULL OR char_length(source_event_slug) <= 200),
  created_by            text,
  updated_by            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_email_templates_tenant_id_idx ON public.event_email_templates (tenant_id, name);

ALTER TABLE public.event_email_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_email_templates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_email_templates TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access event_email_templates"
    ON public.event_email_templates FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP TRIGGER IF EXISTS event_email_templates_updated_at ON public.event_email_templates;
CREATE TRIGGER event_email_templates_updated_at
  BEFORE UPDATE ON public.event_email_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Tenant isolation (S4).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_email_templates TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.event_email_templates;
CREATE POLICY tenant_isolation ON public.event_email_templates AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.event_email_templates;
CREATE POLICY tenant_isolation_guard ON public.event_email_templates AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));

COMMENT ON TABLE public.event_email_templates IS
  'Event emails saved as templates from the Email Reminders tab, shared across a tenant''s events (lib/event-emails/templates.ts).';
