-- S4 "Database-enforced isolation" (multi-tenancy plan), step 1: the tenant
-- role, its tenant helper and the tenant RLS policies.
--
-- The S4 spike (docs/S4-SPIKE.md) chose Option B: server code that must act
-- as one tenant opens a transaction on a dedicated database role that does
-- NOT bypass RLS, and pins the tenant for that transaction only:
--
--   BEGIN;
--   SET LOCAL ROLE tenant_app;
--   SELECT set_config('stellr.tenant_id', '<tenant uuid>', true);  -- transaction-local
--   … queries …
--   COMMIT;
--
-- lib/tenancy/db.ts (tenantDb) is the only code that does this. Nothing in
-- the app uses it yet (S5 wires it into routes), so this migration changes no
-- live flow:
--   * every live query runs as service_role, which has BYPASSRLS — the new
--     policies are TO tenant_app only and never apply to it;
--   * the authenticated policies (survey responses, chat and community
--     helpers) are untouched: a policy TO tenant_app is not evaluated for
--     authenticated;
--   * no table gets FORCE ROW LEVEL SECURITY. tenant_app is not the owner of
--     any table, so plain (already enabled) RLS binds it. FORCE would only
--     change what the OWNER (postgres) sees, and the SECURITY DEFINER
--     functions owned by postgres — tenancy_derive_tenant_id() reading
--     public.events, can_read_space(), rename_event_slug(), the survey and
--     e-sign functions — must keep reading every row. Whether the hosted
--     postgres role has BYPASSRLS cannot be read from here, so FORCE is a
--     separate, later migration step gated on the owner's check
--     (docs/TENANCY-S4.md, "FORCE RLS: the later step").
--
-- What it adds:
--   1. tenant_app: NOLOGIN, NOINHERIT, NOBYPASSRLS. Nobody is a member of it
--      yet; the owner creates the login that may assume it in S5
--      (docs/TENANCY-S4.md, owner actions). Creating a role needs CREATEROLE,
--      which the hosted postgres role has; it does not need a superuser, and
--      the role it creates has no attribute a non-superuser cannot grant.
--   2. public.app_tenant_id(): the tenant pinned for this transaction, or
--      NULL. NULL matches no row, so a tenant_app session that forgot to pin
--      a tenant (or pinned garbage) sees and writes nothing — fail closed.
--      STABLE and called as (SELECT public.app_tenant_id()), so Postgres
--      evaluates it once per query (an InitPlan) and the tenant_id indexes
--      S3 added stay usable.
--   3. For every table lib/tenancy/registry.ts classifies tenant- or
--      event-scoped with its own tenant_id column ('own' or 'derived', 35
--      tables): SELECT/INSERT/UPDATE/DELETE to tenant_app, a PERMISSIVE
--      policy that lets it reach its tenant's rows, and a RESTRICTIVE policy
--      that caps it there — so a permissive policy someone later writes for
--      PUBLIC can never widen what a tenant sees.
--   4. public.tenants: tenant_app may read its own tenant row only.
--   5. Beyond "rows of its own tenant" (lib/tenancy/tenant-role.ts):
--      * public.events, public.tenant_domains and public.tenant_memberships
--        are READ-ONLY to tenant_app (SELECT only). Platform code writes
--        them. Otherwise a tenant could claim another tenant's event slug
--        (slugs are globally unique, and tenancy_derive_tenant_id() finds a
--        row's tenant by slug, so later registrations under that slug would
--        be stamped with the squatter's tenant), claim any host, or grant
--        itself or anyone the 'owner' role;
--      * the RESTRICTIVE guard's WITH CHECK also requires the row's event key
--        and every foreign key to a tenant table to name a row tenant_app can
--        see — its own tenant's, through RLS on the parent. A tenant cannot
--        attach its row to another tenant's registration or module, nor
--        probe whether another tenant's id exists (RLS refuses before the FK
--        check could answer), nor file rows under an event it does not have.
--        A key to a via_parent table (no grant) must be NULL for now.
--        public.tenant_self_ref_visible() does the lookup for the four tables
--        that reference themselves, since a policy cannot query its own table.
--
-- The 10 via_parent child tables (participants, agreement_recipients, …)
-- have no tenant_id yet, so tenant_app gets NO grant on them: it cannot read
-- them at all until they get their own column and composite foreign key (the
-- next S4 step). Fail closed.
--
-- Checked by supabase/tests/database/tenant_isolation.test.sql, generated
-- from the registry by scripts/gen-tenant-isolation-pgtap.mjs: two tenants,
-- a row of each in every table, and tenant A must see, update and delete 0 of
-- tenant B's rows, be refused inserting one, and be refused pointing its own
-- rows at B's.
--
-- Security: no new table. No SECURITY DEFINER. app_tenant_id() and
-- tenant_self_ref_visible() are SECURITY INVOKER with a pinned search_path;
-- EXECUTE is revoked from PUBLIC, anon and authenticated and granted to
-- tenant_app and service_role. No function-level
-- SET of a custom parameter (the tenant is read with current_setting in the
-- body and set by the caller with set_config).

-- ── 1. The role ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'tenant_app') THEN
    CREATE ROLE tenant_app NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
  -- If a role of this name already exists it must not be able to escape RLS.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'tenant_app' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'tenant_app exists with an attribute that escapes RLS; refusing to grant it tenant data';
  END IF;
END $$;

COMMENT ON ROLE tenant_app IS
  'S4 tenant role (docs/S4-SPIKE.md, Option B). No BYPASSRLS: sees only rows whose tenant_id = public.app_tenant_id(). Used only through lib/tenancy/db.ts.';

GRANT USAGE ON SCHEMA public TO tenant_app;

-- ── 2. The tenant helper ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.app_tenant_id()
RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
    WHEN current_setting('stellr.tenant_id', true)
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN current_setting('stellr.tenant_id', true)::uuid
  END
$$;

COMMENT ON FUNCTION public.app_tenant_id() IS
  'The tenant pinned for this transaction by lib/tenancy/db.ts (set_config(''stellr.tenant_id'', …, true)), or NULL. NULL matches no row: fail closed.';

REVOKE EXECUTE ON FUNCTION public.app_tenant_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_tenant_id() TO tenant_app, service_role;

-- Self-references for the guard (lib/tenancy/tenant-role.ts SELF_REF_TABLES).
-- The guard on a table with a foreign key to itself cannot query that table
-- directly: Postgres refuses a policy that reads its own table (42P17). This
-- SECURITY INVOKER function runs its query in its own planning context, so
-- RLS still applies there and the caller sees only its own tenant's rows. The
-- SET search_path also keeps Postgres from inlining it back into the policy.
-- Any other table name returns NULL, which a WITH CHECK treats as a refusal.
CREATE OR REPLACE FUNCTION public.tenant_self_ref_visible(p_table text, p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_table
    WHEN 'agreements' THEN EXISTS (SELECT 1 FROM public.agreements WHERE id = p_id)
    WHEN 'mentoring_cohorts' THEN EXISTS (SELECT 1 FROM public.mentoring_cohorts WHERE id = p_id)
    WHEN 'store_orders' THEN EXISTS (SELECT 1 FROM public.store_orders WHERE id = p_id)
    WHEN 'team_profiles' THEN EXISTS (SELECT 1 FROM public.team_profiles WHERE id = p_id)
  END
$$;

COMMENT ON FUNCTION public.tenant_self_ref_visible(text, uuid) IS
  'Guard helper: whether the calling role can see row p_id of p_table (a self-referencing tenant table). SECURITY INVOKER, so RLS limits it to the pinned tenant. docs/TENANCY-S4.md.';

REVOKE EXECUTE ON FUNCTION public.tenant_self_ref_visible(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_self_ref_visible(text, uuid) TO tenant_app, service_role;

-- ── 3. Tenant policies on the 35 tenant/event tables ─────────────────────────
-- One block per table, alphabetical. Generated once from lib/tenancy/registry.ts
-- ('own' and 'derived' entries); a table added later writes its own block in
-- its own migration, and the generated pgTAP fails until it does.

-- public.agreements (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreements TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.agreements;
CREATE POLICY tenant_isolation ON public.agreements AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.agreements;
CREATE POLICY tenant_isolation_guard ON public.agreements AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (agreements.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = agreements.event_slug))
    AND agreements.participant_id IS NULL
    AND (agreements.reused_from IS NULL OR public.tenant_self_ref_visible('agreements', agreements.reused_from)));

-- public.community_resources (event_scoped, derived from event_ref)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_resources TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.community_resources;
CREATE POLICY tenant_isolation ON public.community_resources AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.community_resources;
CREATE POLICY tenant_isolation_guard ON public.community_resources AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (community_resources.event_ref IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.sanity_id = community_resources.event_ref))
    AND (community_resources.space_id IS NULL OR EXISTS (SELECT 1 FROM public.community_spaces p WHERE p.id = community_resources.space_id)));

-- public.community_spaces (event_scoped, derived from sanity_event_id)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_spaces TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.community_spaces;
CREATE POLICY tenant_isolation ON public.community_spaces AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.community_spaces;
CREATE POLICY tenant_isolation_guard ON public.community_spaces AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (community_spaces.sanity_event_id IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.sanity_id = community_spaces.sanity_event_id)));

-- public.credentials (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credentials TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.credentials;
CREATE POLICY tenant_isolation ON public.credentials AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.credentials;
CREATE POLICY tenant_isolation_guard ON public.credentials AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (credentials.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = credentials.event_slug))
    AND (credentials.module_id IS NULL OR EXISTS (SELECT 1 FROM public.training_modules p WHERE p.id = credentials.module_id))
    AND credentials.participant_id IS NULL);

-- public.event_award_assignments (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_award_assignments TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.event_award_assignments;
CREATE POLICY tenant_isolation ON public.event_award_assignments AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.event_award_assignments;
CREATE POLICY tenant_isolation_guard ON public.event_award_assignments AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (event_award_assignments.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = event_award_assignments.event_slug))
    AND (event_award_assignments.company_id IS NULL OR EXISTS (SELECT 1 FROM public.event_companies p WHERE p.id = event_award_assignments.company_id))
    AND event_award_assignments.participant_id IS NULL);

-- public.event_badge_templates (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_badge_templates TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.event_badge_templates;
CREATE POLICY tenant_isolation ON public.event_badge_templates AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.event_badge_templates;
CREATE POLICY tenant_isolation_guard ON public.event_badge_templates AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (event_badge_templates.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = event_badge_templates.event_slug))
    AND (event_badge_templates.company_id IS NULL OR EXISTS (SELECT 1 FROM public.event_companies p WHERE p.id = event_badge_templates.company_id)));

-- public.event_certificate_templates (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_certificate_templates TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.event_certificate_templates;
CREATE POLICY tenant_isolation ON public.event_certificate_templates AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.event_certificate_templates;
CREATE POLICY tenant_isolation_guard ON public.event_certificate_templates AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (event_certificate_templates.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = event_certificate_templates.event_slug)));

-- public.event_companies (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_companies TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.event_companies;
CREATE POLICY tenant_isolation ON public.event_companies AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.event_companies;
CREATE POLICY tenant_isolation_guard ON public.event_companies AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (event_companies.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = event_companies.event_slug)));

-- public.event_email_sends (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_email_sends TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.event_email_sends;
CREATE POLICY tenant_isolation ON public.event_email_sends AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.event_email_sends;
CREATE POLICY tenant_isolation_guard ON public.event_email_sends AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (event_email_sends.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = event_email_sends.event_slug))
    AND (event_email_sends.event_email_id IS NULL OR EXISTS (SELECT 1 FROM public.event_emails p WHERE p.id = event_email_sends.event_email_id)));

-- public.event_emails (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_emails TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.event_emails;
CREATE POLICY tenant_isolation ON public.event_emails AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.event_emails;
CREATE POLICY tenant_isolation_guard ON public.event_emails AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (event_emails.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = event_emails.event_slug)));

-- public.event_manager_assignments (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_manager_assignments TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.event_manager_assignments;
CREATE POLICY tenant_isolation ON public.event_manager_assignments AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.event_manager_assignments;
CREATE POLICY tenant_isolation_guard ON public.event_manager_assignments AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (event_manager_assignments.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = event_manager_assignments.event_slug)));

-- public.event_participations (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_participations TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.event_participations;
CREATE POLICY tenant_isolation ON public.event_participations AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.event_participations;
CREATE POLICY tenant_isolation_guard ON public.event_participations AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (event_participations.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = event_participations.event_slug)));

-- public.event_refunds (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_refunds TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.event_refunds;
CREATE POLICY tenant_isolation ON public.event_refunds AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.event_refunds;
CREATE POLICY tenant_isolation_guard ON public.event_refunds AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (event_refunds.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = event_refunds.event_slug))
    AND (event_refunds.registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations p WHERE p.id = event_refunds.registration_id)));

-- public.event_settings (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_settings TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.event_settings;
CREATE POLICY tenant_isolation ON public.event_settings AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.event_settings;
CREATE POLICY tenant_isolation_guard ON public.event_settings AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (event_settings.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = event_settings.event_slug)));

-- public.event_store_offerings (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_store_offerings TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.event_store_offerings;
CREATE POLICY tenant_isolation ON public.event_store_offerings AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.event_store_offerings;
CREATE POLICY tenant_isolation_guard ON public.event_store_offerings AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (event_store_offerings.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = event_store_offerings.event_slug)));

-- public.events (tenant_scoped, own tenant_id)
GRANT SELECT ON public.events TO tenant_app;  -- read-only: platform code writes it
DROP POLICY IF EXISTS tenant_isolation ON public.events;
CREATE POLICY tenant_isolation ON public.events AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.events;
CREATE POLICY tenant_isolation_guard ON public.events AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));

-- public.group_invoices (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_invoices TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.group_invoices;
CREATE POLICY tenant_isolation ON public.group_invoices AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.group_invoices;
CREATE POLICY tenant_isolation_guard ON public.group_invoices AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (group_invoices.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = group_invoices.event_slug))
    AND (group_invoices.registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations p WHERE p.id = group_invoices.registration_id)));

-- public.group_join_tokens (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_join_tokens TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.group_join_tokens;
CREATE POLICY tenant_isolation ON public.group_join_tokens AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.group_join_tokens;
CREATE POLICY tenant_isolation_guard ON public.group_join_tokens AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (group_join_tokens.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = group_join_tokens.event_slug))
    AND (group_join_tokens.registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations p WHERE p.id = group_join_tokens.registration_id)));

-- public.member_groups (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_groups TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.member_groups;
CREATE POLICY tenant_isolation ON public.member_groups AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.member_groups;
CREATE POLICY tenant_isolation_guard ON public.member_groups AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (member_groups.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = member_groups.event_slug)));

-- public.mentoring_cohorts (event_scoped, derived from sanity_event_id)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mentoring_cohorts TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.mentoring_cohorts;
CREATE POLICY tenant_isolation ON public.mentoring_cohorts AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.mentoring_cohorts;
CREATE POLICY tenant_isolation_guard ON public.mentoring_cohorts AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (mentoring_cohorts.sanity_event_id IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.sanity_id = mentoring_cohorts.sanity_event_id))
    AND (mentoring_cohorts.parent_container_id IS NULL OR public.tenant_self_ref_visible('mentoring_cohorts', mentoring_cohorts.parent_container_id))
    AND (mentoring_cohorts.registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations p WHERE p.id = mentoring_cohorts.registration_id)));

-- public.merch_batches (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.merch_batches TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.merch_batches;
CREATE POLICY tenant_isolation ON public.merch_batches AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.merch_batches;
CREATE POLICY tenant_isolation_guard ON public.merch_batches AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (merch_batches.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = merch_batches.event_slug)));

-- public.refund_policies (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.refund_policies TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.refund_policies;
CREATE POLICY tenant_isolation ON public.refund_policies AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.refund_policies;
CREATE POLICY tenant_isolation_guard ON public.refund_policies AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (refund_policies.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = refund_policies.event_slug)));

-- public.registrations (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registrations TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.registrations;
CREATE POLICY tenant_isolation ON public.registrations AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.registrations;
CREATE POLICY tenant_isolation_guard ON public.registrations AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (registrations.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = registrations.event_slug)));

-- public.scholarship_applications (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scholarship_applications TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.scholarship_applications;
CREATE POLICY tenant_isolation ON public.scholarship_applications AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.scholarship_applications;
CREATE POLICY tenant_isolation_guard ON public.scholarship_applications AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (scholarship_applications.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = scholarship_applications.event_slug))
    AND (scholarship_applications.registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations p WHERE p.id = scholarship_applications.registration_id)));

-- public.store_event_discounts (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_event_discounts TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.store_event_discounts;
CREATE POLICY tenant_isolation ON public.store_event_discounts AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.store_event_discounts;
CREATE POLICY tenant_isolation_guard ON public.store_event_discounts AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (store_event_discounts.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = store_event_discounts.event_slug)));

-- public.store_orders (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_orders TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.store_orders;
CREATE POLICY tenant_isolation ON public.store_orders AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.store_orders;
CREATE POLICY tenant_isolation_guard ON public.store_orders AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (store_orders.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = store_orders.event_slug))
    AND (store_orders.registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations p WHERE p.id = store_orders.registration_id))
    AND (store_orders.source_order_id IS NULL OR public.tenant_self_ref_visible('store_orders', store_orders.source_order_id)));

-- public.survey_access_log (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_access_log TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.survey_access_log;
CREATE POLICY tenant_isolation ON public.survey_access_log AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.survey_access_log;
CREATE POLICY tenant_isolation_guard ON public.survey_access_log AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (survey_access_log.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = survey_access_log.event_slug)));

-- public.survey_distributions (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_distributions TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.survey_distributions;
CREATE POLICY tenant_isolation ON public.survey_distributions AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.survey_distributions;
CREATE POLICY tenant_isolation_guard ON public.survey_distributions AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (survey_distributions.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = survey_distributions.event_slug)));

-- public.survey_responses (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_responses TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.survey_responses;
CREATE POLICY tenant_isolation ON public.survey_responses AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.survey_responses;
CREATE POLICY tenant_isolation_guard ON public.survey_responses AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (survey_responses.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = survey_responses.event_slug))
    AND (survey_responses.distribution_id IS NULL OR EXISTS (SELECT 1 FROM public.survey_distributions p WHERE p.id = survey_responses.distribution_id))
    AND survey_responses.invitation_id IS NULL
    AND survey_responses.participant_id IS NULL);

-- public.team_profiles (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_profiles TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.team_profiles;
CREATE POLICY tenant_isolation ON public.team_profiles AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.team_profiles;
CREATE POLICY tenant_isolation_guard ON public.team_profiles AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (team_profiles.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = team_profiles.event_slug))
    AND team_profiles.participant_id IS NULL
    AND (team_profiles.prefilled_from IS NULL OR public.tenant_self_ref_visible('team_profiles', team_profiles.prefilled_from)));

-- public.tenant_domains (tenant_scoped, own tenant_id)
GRANT SELECT ON public.tenant_domains TO tenant_app;  -- read-only: platform code writes it
DROP POLICY IF EXISTS tenant_isolation ON public.tenant_domains;
CREATE POLICY tenant_isolation ON public.tenant_domains AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.tenant_domains;
CREATE POLICY tenant_isolation_guard ON public.tenant_domains AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));

-- public.tenant_memberships (tenant_scoped, own tenant_id)
GRANT SELECT ON public.tenant_memberships TO tenant_app;  -- read-only: platform code writes it
DROP POLICY IF EXISTS tenant_isolation ON public.tenant_memberships;
CREATE POLICY tenant_isolation ON public.tenant_memberships AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.tenant_memberships;
CREATE POLICY tenant_isolation_guard ON public.tenant_memberships AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));

-- public.training_assignments (event_scoped, derived from event_ref)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_assignments TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.training_assignments;
CREATE POLICY tenant_isolation ON public.training_assignments AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.training_assignments;
CREATE POLICY tenant_isolation_guard ON public.training_assignments AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (training_assignments.event_ref IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.sanity_id = training_assignments.event_ref))
    AND (training_assignments.module_id IS NULL OR EXISTS (SELECT 1 FROM public.training_modules p WHERE p.id = training_assignments.module_id)));

-- public.training_modules (event_scoped, derived from event_ref)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_modules TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.training_modules;
CREATE POLICY tenant_isolation ON public.training_modules AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.training_modules;
CREATE POLICY tenant_isolation_guard ON public.training_modules AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (training_modules.event_ref IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.sanity_id = training_modules.event_ref)));

-- public.volunteer_event_interest (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.volunteer_event_interest TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.volunteer_event_interest;
CREATE POLICY tenant_isolation ON public.volunteer_event_interest AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.volunteer_event_interest;
CREATE POLICY tenant_isolation_guard ON public.volunteer_event_interest AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (volunteer_event_interest.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = volunteer_event_interest.event_slug)));

-- ── 4. public.tenants: its own row only, read-only ───────────────────────────

GRANT SELECT ON public.tenants TO tenant_app;
DROP POLICY IF EXISTS tenant_self ON public.tenants;
CREATE POLICY tenant_self ON public.tenants AS PERMISSIVE FOR SELECT TO tenant_app
  USING (id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_self_guard ON public.tenants;
CREATE POLICY tenant_self_guard ON public.tenants AS RESTRICTIVE FOR ALL TO tenant_app
  USING (id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);
