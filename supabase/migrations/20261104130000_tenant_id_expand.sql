-- S3 "Tenant and event data model" (multi-tenancy plan), step 4 of 5: EXPAND.
--
-- Adds a NULLABLE tenant_id (FK to tenants), an index on it, and the
-- log-only derivation trigger (20261104120000) to every table that carries an
-- event key:
--
--   27 tables with event_slug                -> derived by events.slug
--    5 tables with a Sanity event _id        -> derived by events.sanity_id
--      (community_resources.event_ref, community_spaces.sanity_event_id,
--       mentoring_cohorts.sanity_event_id, training_assignments.event_ref,
--       training_modules.event_ref)
--
-- The list is lib/tenancy/registry.ts's `tenantColumn: 'derived'` set;
-- lib/tenancy/registry.test.ts and scripts/check-migration-tenancy.mjs fail if
-- the two drift. Child tables keyed through a parent (participants via
-- registrations, agreement_recipients via agreements, …) are classified
-- `via_parent` and get their column in S4 with composite foreign keys.
--
-- Additive and behaviour-neutral:
--   * the columns are nullable with no default — a metadata-only change, no
--     table rewrite;
--   * nothing in the app reads or writes tenant_id;
--   * the trigger is in 'log' mode and catches every exception, so it cannot
--     fail a registration, check-in, payment, e-sign or upload write;
--   * BEFORE UPDATE fires only when the event key or tenant_id is in the SET
--     list, so ordinary updates do not run it.
-- The trigger is named zz_… so it runs after the tables' other BEFORE
-- triggers (Postgres fires them in name order) and sees the final event key.
--
-- Existing rows are backfilled to Stellr in the next migration
-- (20261104140000_tenant_id_backfill.sql), kept separate so this one stays a
-- fast, lock-light schema change.
--
-- lock_timeout: ALTER TABLE needs a brief ACCESS EXCLUSIVE lock on each table.
-- If a long transaction holds one, fail fast and retry rather than queue every
-- writer behind this migration. Apply outside event hours (docs/TENANCY-S3.md).
SET LOCAL lock_timeout = '5s';

-- agreements (event_slug: event slug)
ALTER TABLE public.agreements
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS agreements_tenant_id_idx ON public.agreements (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.agreements;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.agreements
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- community_resources (event_ref: Sanity event _id)
ALTER TABLE public.community_resources
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS community_resources_tenant_id_idx ON public.community_resources (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.community_resources;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_ref, tenant_id ON public.community_resources
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_ref', 'sanity_id');

-- community_spaces (sanity_event_id: Sanity event _id)
ALTER TABLE public.community_spaces
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS community_spaces_tenant_id_idx ON public.community_spaces (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.community_spaces;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF sanity_event_id, tenant_id ON public.community_spaces
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('sanity_event_id', 'sanity_id');

-- credentials (event_slug: event slug)
ALTER TABLE public.credentials
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS credentials_tenant_id_idx ON public.credentials (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.credentials;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.credentials
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- event_award_assignments (event_slug: event slug)
ALTER TABLE public.event_award_assignments
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS event_award_assignments_tenant_id_idx ON public.event_award_assignments (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.event_award_assignments;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.event_award_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- event_badge_templates (event_slug: event slug)
ALTER TABLE public.event_badge_templates
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS event_badge_templates_tenant_id_idx ON public.event_badge_templates (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.event_badge_templates;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.event_badge_templates
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- event_certificate_templates (event_slug: event slug)
ALTER TABLE public.event_certificate_templates
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS event_certificate_templates_tenant_id_idx ON public.event_certificate_templates (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.event_certificate_templates;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.event_certificate_templates
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- event_companies (event_slug: event slug)
ALTER TABLE public.event_companies
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS event_companies_tenant_id_idx ON public.event_companies (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.event_companies;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.event_companies
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- event_email_sends (event_slug: event slug)
ALTER TABLE public.event_email_sends
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS event_email_sends_tenant_id_idx ON public.event_email_sends (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.event_email_sends;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.event_email_sends
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- event_emails (event_slug: event slug)
ALTER TABLE public.event_emails
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS event_emails_tenant_id_idx ON public.event_emails (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.event_emails;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.event_emails
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- event_manager_assignments (event_slug: event slug)
ALTER TABLE public.event_manager_assignments
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS event_manager_assignments_tenant_id_idx ON public.event_manager_assignments (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.event_manager_assignments;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.event_manager_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- event_participations (event_slug: event slug)
ALTER TABLE public.event_participations
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS event_participations_tenant_id_idx ON public.event_participations (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.event_participations;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.event_participations
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- event_refunds (event_slug: event slug)
ALTER TABLE public.event_refunds
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS event_refunds_tenant_id_idx ON public.event_refunds (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.event_refunds;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.event_refunds
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- event_settings (event_slug: event slug)
ALTER TABLE public.event_settings
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS event_settings_tenant_id_idx ON public.event_settings (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.event_settings;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.event_settings
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- event_store_offerings (event_slug: event slug)
ALTER TABLE public.event_store_offerings
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS event_store_offerings_tenant_id_idx ON public.event_store_offerings (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.event_store_offerings;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.event_store_offerings
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- group_invoices (event_slug: event slug)
ALTER TABLE public.group_invoices
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS group_invoices_tenant_id_idx ON public.group_invoices (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.group_invoices;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.group_invoices
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- group_join_tokens (event_slug: event slug)
ALTER TABLE public.group_join_tokens
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS group_join_tokens_tenant_id_idx ON public.group_join_tokens (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.group_join_tokens;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.group_join_tokens
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- member_groups (event_slug: event slug)
ALTER TABLE public.member_groups
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS member_groups_tenant_id_idx ON public.member_groups (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.member_groups;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.member_groups
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- mentoring_cohorts (sanity_event_id: Sanity event _id)
ALTER TABLE public.mentoring_cohorts
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS mentoring_cohorts_tenant_id_idx ON public.mentoring_cohorts (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.mentoring_cohorts;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF sanity_event_id, tenant_id ON public.mentoring_cohorts
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('sanity_event_id', 'sanity_id');

-- merch_batches (event_slug: event slug)
ALTER TABLE public.merch_batches
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS merch_batches_tenant_id_idx ON public.merch_batches (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.merch_batches;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.merch_batches
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- refund_policies (event_slug: event slug)
ALTER TABLE public.refund_policies
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS refund_policies_tenant_id_idx ON public.refund_policies (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.refund_policies;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.refund_policies
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- registrations (event_slug: event slug)
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS registrations_tenant_id_idx ON public.registrations (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.registrations;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.registrations
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- scholarship_applications (event_slug: event slug)
ALTER TABLE public.scholarship_applications
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS scholarship_applications_tenant_id_idx ON public.scholarship_applications (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.scholarship_applications;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.scholarship_applications
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- store_event_discounts (event_slug: event slug)
ALTER TABLE public.store_event_discounts
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS store_event_discounts_tenant_id_idx ON public.store_event_discounts (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.store_event_discounts;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.store_event_discounts
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- store_orders (event_slug: event slug)
ALTER TABLE public.store_orders
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS store_orders_tenant_id_idx ON public.store_orders (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.store_orders;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.store_orders
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- survey_access_log (event_slug: event slug)
ALTER TABLE public.survey_access_log
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS survey_access_log_tenant_id_idx ON public.survey_access_log (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.survey_access_log;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.survey_access_log
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- survey_distributions (event_slug: event slug)
ALTER TABLE public.survey_distributions
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS survey_distributions_tenant_id_idx ON public.survey_distributions (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.survey_distributions;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.survey_distributions
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- survey_responses (event_slug: event slug)
ALTER TABLE public.survey_responses
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS survey_responses_tenant_id_idx ON public.survey_responses (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.survey_responses;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.survey_responses
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- team_profiles (event_slug: event slug)
ALTER TABLE public.team_profiles
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS team_profiles_tenant_id_idx ON public.team_profiles (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.team_profiles;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.team_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

-- training_assignments (event_ref: Sanity event _id)
ALTER TABLE public.training_assignments
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS training_assignments_tenant_id_idx ON public.training_assignments (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.training_assignments;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_ref, tenant_id ON public.training_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_ref', 'sanity_id');

-- training_modules (event_ref: Sanity event _id)
ALTER TABLE public.training_modules
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS training_modules_tenant_id_idx ON public.training_modules (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.training_modules;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_ref, tenant_id ON public.training_modules
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_ref', 'sanity_id');

-- volunteer_event_interest (event_slug: event slug)
ALTER TABLE public.volunteer_event_interest
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS volunteer_event_interest_tenant_id_idx ON public.volunteer_event_interest (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.volunteer_event_interest;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.volunteer_event_interest
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');

