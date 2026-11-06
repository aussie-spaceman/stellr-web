-- S5 C0b (docs/TENANCY-S5.md), step 4 of 4: a parent that changes tenant takes its
-- children with it.
--
-- This is the part of the composite foreign key's ON UPDATE CASCADE that the slice
-- still needs while that key is held back (see step 1). Without it, a registration
-- moved to another tenant would leave its participants readable by the old tenant
-- and hidden from the new one.
--
-- Two children refuse to be carried, so a parent holding them cannot change tenant:
-- esign_audit_events and survey_answers are immutable, and their own triggers raise.
-- Evidence stays with the tenant it was written under.
--
-- ── No effect on Stellr ──────────────────────────────────────────────────────
-- The WHEN clause needs tenant_id to go from one tenant to a different one, and
-- Stellr's rows only ever hold Stellr's id. A slug rename or a move between Stellr
-- events keeps the tenant, and a NULL parent being stamped by a backfill is not a
-- move. Every update of these seven tables gains that one comparison, with no read.
-- A tenant session cannot get here: its guard refuses the move first, because AFTER
-- triggers run behind RLS.
--
-- It is plain AFTER UPDATE, not UPDATE OF tenant_id: a registration changes tenant
-- when zz_tenancy_derive_tenant_id rewrites it from a new event_slug, and a
-- column-specific trigger does not count a change a BEFORE trigger made.
--
-- ── Why SECURITY DEFINER ─────────────────────────────────────────────────────
-- It fires for whoever moved the parent and writes tables that session may not be
-- able to. It runs as the owner with a pinned search_path, and EXECUTE is revoked.
-- The tables it writes come from TG_ARGV, which only CREATE TRIGGER sets, and are
-- quoted with %I. lib/tenancy/isolation.test.ts holds these arguments equal to the
-- registry.
--
-- ── Locks ────────────────────────────────────────────────────────────────────
-- CREATE TRIGGER takes SHARE ROW EXCLUSIVE on each parent until commit: writers wait,
-- readers do not. The tables are taken quietest first, with registrations last. If
-- a lock cannot be had within lock_timeout the whole file rolls back, and it can be
-- run again. Apply outside event hours.
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.tenancy_carry_children()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  i int := 0;
BEGIN
  -- TG_ARGV holds pairs: child table, its key to this parent.
  WHILE i < TG_NARGS LOOP
    EXECUTE format('UPDATE public.%I SET tenant_id = $1 WHERE %I = $2 AND tenant_id IS DISTINCT FROM $1', TG_ARGV[i], TG_ARGV[i + 1])
      USING NEW.tenant_id, NEW.id;
    i := i + 2;
  END LOOP;
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.tenancy_carry_children() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS zzz_tenancy_carry_children ON public.member_groups;
CREATE TRIGGER zzz_tenancy_carry_children
  AFTER UPDATE ON public.member_groups
  FOR EACH ROW
  WHEN (OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT NULL AND OLD.tenant_id <> NEW.tenant_id)
  EXECUTE FUNCTION public.tenancy_carry_children('member_group_members', 'group_id');

DROP TRIGGER IF EXISTS zzz_tenancy_carry_children ON public.survey_distributions;
CREATE TRIGGER zzz_tenancy_carry_children
  AFTER UPDATE ON public.survey_distributions
  FOR EACH ROW
  WHEN (OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT NULL AND OLD.tenant_id <> NEW.tenant_id)
  EXECUTE FUNCTION public.tenancy_carry_children('survey_invitations', 'distribution_id');

DROP TRIGGER IF EXISTS zzz_tenancy_carry_children ON public.survey_responses;
CREATE TRIGGER zzz_tenancy_carry_children
  AFTER UPDATE ON public.survey_responses
  FOR EACH ROW
  WHEN (OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT NULL AND OLD.tenant_id <> NEW.tenant_id)
  EXECUTE FUNCTION public.tenancy_carry_children('survey_answers', 'response_id');

DROP TRIGGER IF EXISTS zzz_tenancy_carry_children ON public.credentials;
CREATE TRIGGER zzz_tenancy_carry_children
  AFTER UPDATE ON public.credentials
  FOR EACH ROW
  WHEN (OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT NULL AND OLD.tenant_id <> NEW.tenant_id)
  EXECUTE FUNCTION public.tenancy_carry_children('credential_events', 'credential_id');

DROP TRIGGER IF EXISTS zzz_tenancy_carry_children ON public.store_orders;
CREATE TRIGGER zzz_tenancy_carry_children
  AFTER UPDATE ON public.store_orders
  FOR EACH ROW
  WHEN (OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT NULL AND OLD.tenant_id <> NEW.tenant_id)
  EXECUTE FUNCTION public.tenancy_carry_children('store_order_items', 'order_id', 'store_returns', 'order_id');

DROP TRIGGER IF EXISTS zzz_tenancy_carry_children ON public.agreements;
CREATE TRIGGER zzz_tenancy_carry_children
  AFTER UPDATE ON public.agreements
  FOR EACH ROW
  WHEN (OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT NULL AND OLD.tenant_id <> NEW.tenant_id)
  EXECUTE FUNCTION public.tenancy_carry_children('agreement_recipients', 'envelope_row', 'esign_access_log', 'envelope_row', 'esign_audit_events', 'envelope_row');

DROP TRIGGER IF EXISTS zzz_tenancy_carry_children ON public.registrations;
CREATE TRIGGER zzz_tenancy_carry_children
  AFTER UPDATE ON public.registrations
  FOR EACH ROW
  WHEN (OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT NULL AND OLD.tenant_id <> NEW.tenant_id)
  EXECUTE FUNCTION public.tenancy_carry_children('participants', 'registration_id');
