-- S5 C0b (docs/TENANCY-S5.md), step 3 of 3: tenant_app reaches the child tables.
--
-- 20261104200000_tenant_isolation_policies.sql gave tenant_app nothing on these 10
-- tables because they had no tenant_id. Now that they do, each gets the same pair
-- of policies as every other tenant table, and the generated matrix
-- (supabase/tests/database/tenant_isolation.test.sql) covers them.
--
-- No live flow changes. Every live query runs as service_role, which bypasses RLS,
-- these policies are TO tenant_app only, and nothing assumes tenant_app until
-- TENANT_DB_ENABLED is set for an area.
--
-- Four further rules (lib/tenancy/tenant-role.ts):
--   * esign_access_log, esign_audit_events and survey_answers are read-only to
--     tenant_app. They are append-only evidence, written by service_role or through
--     a sealed function.
--   * agreement_recipients is read-only too. It holds what a signer attested to, and
--     the state that revokes a signing link. No trigger protects those columns, so
--     it stays read-only until the slice that needs writes (A11) says which.
--   * tenant_app may not write participants.member_id or membership_id. Stellr's
--     global lookups trust both as identity keys across tenants, so these grants are
--     per column. A column added to participants later is not writable by tenant_app
--     until a migration says so.
--   * The five guards that said "a key to a child table must be NULL" now say what
--     every other guard says: the key must name a row tenant_app can see.
--
-- tenant_app also needs the two sequences these tables draw defaults from. The
-- membership_id sequence is one counter, shared by every tenant's participants and
-- by members, so the numbers it hands out suggest how many exist across all tenants.
-- docs/TENANCY-S5.md records this as a known limit.
--
-- ── Locks ────────────────────────────────────────────────────────────────────
-- CREATE POLICY and DROP POLICY take ACCESS EXCLUSIVE on each table until commit,
-- with no scan: catalog writes only. GRANT takes no table lock. The tables are
-- taken quietest first, with agreements last. If a lock cannot be had within
-- lock_timeout the whole file rolls back, and it can be run again. Every lock taken
-- stays held while the next one waits. Apply outside event hours.
SET LOCAL lock_timeout = '5s';

GRANT USAGE ON SEQUENCE public.participants_membership_id_seq, public.credential_events_id_seq TO tenant_app;

-- public.credential_events (event_scoped, inherited from public.credentials)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credential_events TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.credential_events;
CREATE POLICY tenant_isolation ON public.credential_events AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.credential_events;
CREATE POLICY tenant_isolation_guard ON public.credential_events AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (credential_events.credential_id IS NULL OR EXISTS (SELECT 1 FROM public.credentials p WHERE p.id = credential_events.credential_id)));

-- public.store_returns (event_scoped, inherited from public.store_orders)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_returns TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.store_returns;
CREATE POLICY tenant_isolation ON public.store_returns AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.store_returns;
CREATE POLICY tenant_isolation_guard ON public.store_returns AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (store_returns.order_id IS NULL OR EXISTS (SELECT 1 FROM public.store_orders p WHERE p.id = store_returns.order_id)));

-- public.member_group_members (event_scoped, inherited from public.member_groups)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_group_members TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.member_group_members;
CREATE POLICY tenant_isolation ON public.member_group_members AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.member_group_members;
CREATE POLICY tenant_isolation_guard ON public.member_group_members AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (member_group_members.group_id IS NULL OR EXISTS (SELECT 1 FROM public.member_groups p WHERE p.id = member_group_members.group_id)));

-- public.store_order_items (event_scoped, inherited from public.store_orders)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_order_items TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.store_order_items;
CREATE POLICY tenant_isolation ON public.store_order_items AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.store_order_items;
CREATE POLICY tenant_isolation_guard ON public.store_order_items AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (store_order_items.batch_id IS NULL OR EXISTS (SELECT 1 FROM public.merch_batches p WHERE p.id = store_order_items.batch_id))
    AND (store_order_items.order_id IS NULL OR EXISTS (SELECT 1 FROM public.store_orders p WHERE p.id = store_order_items.order_id)));

-- public.survey_answers (event_scoped, inherited from public.survey_responses, read-only)
GRANT SELECT ON public.survey_answers TO tenant_app;  -- read-only: written once, by service_role or a sealed function
DROP POLICY IF EXISTS tenant_isolation ON public.survey_answers;
CREATE POLICY tenant_isolation ON public.survey_answers AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.survey_answers;
CREATE POLICY tenant_isolation_guard ON public.survey_answers AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (survey_answers.response_id IS NULL OR EXISTS (SELECT 1 FROM public.survey_responses p WHERE p.id = survey_answers.response_id)));

-- public.survey_invitations (event_scoped, inherited from public.survey_distributions)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_invitations TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.survey_invitations;
CREATE POLICY tenant_isolation ON public.survey_invitations AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.survey_invitations;
CREATE POLICY tenant_isolation_guard ON public.survey_invitations AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (survey_invitations.distribution_id IS NULL OR EXISTS (SELECT 1 FROM public.survey_distributions p WHERE p.id = survey_invitations.distribution_id))
    AND (survey_invitations.participant_id IS NULL OR EXISTS (SELECT 1 FROM public.participants p WHERE p.id = survey_invitations.participant_id)));

-- public.esign_access_log (event_scoped, inherited from public.agreements, read-only)
GRANT SELECT ON public.esign_access_log TO tenant_app;  -- read-only: written once, by service_role or a sealed function
DROP POLICY IF EXISTS tenant_isolation ON public.esign_access_log;
CREATE POLICY tenant_isolation ON public.esign_access_log AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.esign_access_log;
CREATE POLICY tenant_isolation_guard ON public.esign_access_log AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));

-- public.esign_audit_events (event_scoped, inherited from public.agreements, read-only)
GRANT SELECT ON public.esign_audit_events TO tenant_app;  -- read-only: written once, by service_role or a sealed function
DROP POLICY IF EXISTS tenant_isolation ON public.esign_audit_events;
CREATE POLICY tenant_isolation ON public.esign_audit_events AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.esign_audit_events;
CREATE POLICY tenant_isolation_guard ON public.esign_audit_events AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));

-- public.agreement_recipients (event_scoped, inherited from public.agreements, read-only)
GRANT SELECT ON public.agreement_recipients TO tenant_app;  -- read-only: signature evidence and signing-link state
DROP POLICY IF EXISTS tenant_isolation ON public.agreement_recipients;
CREATE POLICY tenant_isolation ON public.agreement_recipients AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.agreement_recipients;
CREATE POLICY tenant_isolation_guard ON public.agreement_recipients AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (agreement_recipients.envelope_row IS NULL OR EXISTS (SELECT 1 FROM public.agreements p WHERE p.id = agreement_recipients.envelope_row)));

-- public.participants (event_scoped, inherited from public.registrations, member_id and membership_id not writable)
GRANT SELECT, DELETE ON public.participants TO tenant_app;
DO $grant$
DECLARE
  cols text := (
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
    FROM pg_attribute a
    WHERE a.attrelid = 'public.participants'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname NOT IN ('member_id', 'membership_id')
  );
BEGIN
  EXECUTE format('GRANT INSERT (%1$s), UPDATE (%1$s) ON public.participants TO tenant_app', cols);
END $grant$;
DROP POLICY IF EXISTS tenant_isolation ON public.participants;
CREATE POLICY tenant_isolation ON public.participants AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.participants;
CREATE POLICY tenant_isolation_guard ON public.participants AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (participants.company_id IS NULL OR EXISTS (SELECT 1 FROM public.event_companies p WHERE p.id = participants.company_id))
    AND (participants.registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations p WHERE p.id = participants.registration_id)));

-- ── Guards that held a key to one of these tables to NULL ────────────────────
-- Only the guard changes. Each table's grants and tenant_isolation policy stand.

-- public.event_award_assignments
DROP POLICY IF EXISTS tenant_isolation_guard ON public.event_award_assignments;
CREATE POLICY tenant_isolation_guard ON public.event_award_assignments AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (event_award_assignments.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = event_award_assignments.event_slug))
    AND (event_award_assignments.company_id IS NULL OR EXISTS (SELECT 1 FROM public.event_companies p WHERE p.id = event_award_assignments.company_id))
    AND (event_award_assignments.participant_id IS NULL OR EXISTS (SELECT 1 FROM public.participants p WHERE p.id = event_award_assignments.participant_id)));

-- public.credentials
DROP POLICY IF EXISTS tenant_isolation_guard ON public.credentials;
CREATE POLICY tenant_isolation_guard ON public.credentials AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (credentials.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = credentials.event_slug))
    AND (credentials.module_id IS NULL OR EXISTS (SELECT 1 FROM public.training_modules p WHERE p.id = credentials.module_id))
    AND (credentials.participant_id IS NULL OR EXISTS (SELECT 1 FROM public.participants p WHERE p.id = credentials.participant_id)));

-- public.survey_responses
DROP POLICY IF EXISTS tenant_isolation_guard ON public.survey_responses;
CREATE POLICY tenant_isolation_guard ON public.survey_responses AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (survey_responses.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = survey_responses.event_slug))
    AND (survey_responses.distribution_id IS NULL OR EXISTS (SELECT 1 FROM public.survey_distributions p WHERE p.id = survey_responses.distribution_id))
    AND (survey_responses.invitation_id IS NULL OR EXISTS (SELECT 1 FROM public.survey_invitations p WHERE p.id = survey_responses.invitation_id))
    AND (survey_responses.participant_id IS NULL OR EXISTS (SELECT 1 FROM public.participants p WHERE p.id = survey_responses.participant_id)));

-- public.team_profiles
DROP POLICY IF EXISTS tenant_isolation_guard ON public.team_profiles;
CREATE POLICY tenant_isolation_guard ON public.team_profiles AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (team_profiles.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = team_profiles.event_slug))
    AND (team_profiles.participant_id IS NULL OR EXISTS (SELECT 1 FROM public.participants p WHERE p.id = team_profiles.participant_id))
    AND (team_profiles.prefilled_from IS NULL OR public.tenant_self_ref_visible('team_profiles', team_profiles.prefilled_from)));

-- public.agreements
DROP POLICY IF EXISTS tenant_isolation_guard ON public.agreements;
CREATE POLICY tenant_isolation_guard ON public.agreements AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (agreements.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = agreements.event_slug))
    AND (agreements.participant_id IS NULL OR EXISTS (SELECT 1 FROM public.participants p WHERE p.id = agreements.participant_id))
    AND (agreements.reused_from IS NULL OR public.tenant_self_ref_visible('agreements', agreements.reused_from)));
