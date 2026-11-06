-- S5 C0b (docs/TENANCY-S5.md), step 1 of 3: EXPAND. The S4 via_parent follow-up.
--
-- Gives the 10 child tables a nullable tenant_id, an index on it, and a trigger
-- that copies the tenant from the parent row. lib/tenancy/registry.ts lists them
-- as tenantColumn 'inherited'; registry.test.ts and the tenancy lint fail if the
-- two drift.
--
--   Step 2 (via_parent_tenant_backfill) stamps the rows that already exist.
--   Step 3 (via_parent_tenant_policies) gives tenant_app its grants and policies.
--   Step 4 (via_parent_tenant_carry) carries children when a parent changes tenant.
-- They are separate files because each file is one transaction, and these locks
-- are held until it commits: a backfill in this file would hold them for its
-- whole length.
--
-- ── No composite foreign key here ────────────────────────────────────────────
-- The plan asks for (tenant_id, parent_id) REFERENCES parent (tenant_id, id).
-- Added beside the existing single-column key, it gives PostgREST two
-- relationships between the same two tables, and PostgREST then refuses any embed
-- that does not name one (PGRST201). The app embeds these relations without hints
-- in live paths such as rosters, check-in and join links, so that constraint would
-- break them the moment the schema cache reloaded, NOT VALID or not. It waits for
-- those embeds to carry hints. lib/tenancy/load-scoped.test.ts fails on a second
-- foreign key between a child and its parent. docs/TENANCY-S5.md records this.
--
-- What the foreign key's ON UPDATE CASCADE would have done, step 4 does instead.
-- supabase/tests/tenancy_cutover_checks.sql section I reports any row it misses.
--
-- esign_access_log and esign_audit_events never get a foreign key to agreements:
-- their tables say why (each must outlive, or not vanish with, the agreement).
--
-- ── What it does to live writes ──────────────────────────────────────────────
-- No code asks for the column by name yet, and no write has to supply it. A read
-- that selects every column does return it, so three participant responses now
-- carry Stellr's id, a constant already public in lib/tenancy/constants.ts.
--   * In 'log' mode the trigger never refuses a write. It catches every error,
--     and when it cannot establish a tenant it leaves a value that nothing checks.
--   * A write that omits tenant_id is stamped from its parent. A supplied value
--     that disagrees with the parent is replaced and counted as a mismatch.
--   * BEFORE UPDATE fires only when the parent key or tenant_id is in the SET list,
--     and no live writer names either in an ordinary update.
-- Each insert gains one read of tenancy_settings and one primary-key read of the
-- parent, in a subtransaction, plus one index entry.
--
-- 'enforce' mode does refuse, so flipping derivation_mode now reaches these tables
-- too: for example, an esign log row with no agreement and no tenant_id raises 23503.
--
-- ── A refused write says the same thing whatever the parent is ───────────────
-- BEFORE ROW triggers run ahead of RLS's WITH CHECK, and these read as the owner.
-- So a trigger that raised on a parent the session cannot see would tell a foreign
-- id from one that does not exist, and an age refusal would give away the other
-- tenant's rules. In a tenant session each one steps aside for such a parent, and
-- RLS gives its one refusal. The guard policies require every parent to be visible,
-- so stepping aside can never let the row land. Other sessions are unaffected:
-- tenancy_hidden_from_tenant_session answers false on its first line.
--
-- The trigger shares the name zz_tenancy_derive_tenant_id with the event-key one,
-- so it sorts after each table's other BEFORE triggers and before
-- zzz_participants_assert_eligible. tenancy_backfill_tenant_ids() selects on the
-- function as well as the name, so it does not pick these tables up.
--
-- ── Why SECURITY DEFINER ─────────────────────────────────────────────────────
-- As with tenancy_derive_tenant_id: it fires for whoever writes the row, and it
-- reads the parent, tenancy_settings and the derivation log, which those roles may
-- not reach. It runs as the owner with a pinned search_path, and EXECUTE is revoked
-- from PUBLIC, anon and authenticated. The table it reads comes from TG_ARGV, which
-- only CREATE TRIGGER sets, and is quoted with %I.
--
-- ── Locks ────────────────────────────────────────────────────────────────────
-- ACCESS EXCLUSIVE on each child table until commit, and SHARE ROW EXCLUSIVE on
-- public.tenants for its foreign key. The columns are nullable with no default, so
-- nothing is rewritten; the foreign key and the index only meet NULLs. The tables
-- are taken quietest first, with participants last, so the busiest one is held for
-- the shortest time. If a lock cannot be had within lock_timeout the whole file
-- rolls back, and it can be run again. Apply outside event hours.
SET LOCAL lock_timeout = '5s';

-- True only in a tenant_app session, for a row or event outside its pinned tenant.
-- The role setting survives entering a SECURITY DEFINER function, which is why this
-- reads it and not current_user. SECURITY INVOKER: it is only called from those
-- functions, as their owner.
CREATE OR REPLACE FUNCTION public.tenancy_hidden_from_tenant_session(p_tenant uuid, p_event_slug text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  me uuid;
BEGIN
  IF COALESCE(current_setting('role', true), '') <> 'tenant_app' THEN
    RETURN false;
  END IF;
  me := public.app_tenant_id();
  IF me IS NULL OR p_tenant IS DISTINCT FROM me THEN
    RETURN true;
  END IF;
  RETURN p_event_slug IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.events e WHERE e.slug = p_event_slug AND e.tenant_id = me);
END $$;

REVOKE EXECUTE ON FUNCTION public.tenancy_hidden_from_tenant_session(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- As 20261105041211_participants_eligibility, with the step aside added. Only a
-- registration of another tenant steps aside: on the tenant's own registration the
-- check runs in full, because RLS would let that row land.
CREATE OR REPLACE FUNCTION public.participants_assert_eligible()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  reg      record;
  refusal  text;
BEGIN
  -- UPDATE OF fires on any write naming the column, changed or not. A route that
  -- saves a whole row should not be re-judged for a date it did not change.
  IF TG_OP = 'UPDATE'
     AND NEW.date_of_birth IS NOT DISTINCT FROM OLD.date_of_birth
     AND NEW.registration_id IS NOT DISTINCT FROM OLD.registration_id THEN
    RETURN NEW;
  END IF;

  SELECT r.event_slug, r.tenant_id INTO reg
    FROM public.registrations r
   WHERE r.id = NEW.registration_id;
  -- No such registration: the foreign key refuses the row, as it does today.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF public.tenancy_hidden_from_tenant_session(reg.tenant_id, NULL) THEN
    RETURN NEW;
  END IF;

  refusal := public.participant_eligibility_refusal(NEW.date_of_birth, reg.event_slug, reg.tenant_id);
  IF refusal IS NOT NULL THEN
    RAISE EXCEPTION 'participant eligibility: %', refusal USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.participants_assert_eligible() FROM PUBLIC, anon, authenticated;

-- As 20261105041211_participants_eligibility, with the step aside added. An event
-- key the session cannot see is one the registrations guard refuses.
CREATE OR REPLACE FUNCTION public.registrations_assert_eligible()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  person   record;
  refusal  text;
BEGIN
  IF public.tenancy_hidden_from_tenant_session(NEW.tenant_id, NEW.event_slug) THEN
    RETURN NEW;
  END IF;

  FOR person IN
    SELECT p.date_of_birth FROM public.participants p WHERE p.registration_id = NEW.id
  LOOP
    refusal := public.participant_eligibility_refusal(person.date_of_birth, NEW.event_slug, NEW.tenant_id);
    IF refusal IS NOT NULL THEN
      RAISE EXCEPTION 'participant eligibility: %', refusal USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.registrations_assert_eligible() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tenancy_inherit_tenant_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  -- lib/tenancy/constants.ts STELLR_TENANT_ID. Seeded by 20261104100000.
  stellr      constant uuid := '00000000-0000-4000-8000-000000000001';
  tbl         text := TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
  key_col     text := TG_ARGV[0];
  parent_tbl  text := TG_ARGV[1];
  mode        text := 'log';
  supplied    uuid := NEW.tenant_id;
  key_value   text;
  has_parent  boolean;
  derived     uuid;
  quiet       boolean := COALESCE(current_setting('stellr.tenancy_backfill', true), '') = 'on';
BEGIN
  BEGIN
    SELECT s.derivation_mode INTO mode FROM public.tenancy_settings s WHERE s.id;
    mode := COALESCE(mode, 'log');
  EXCEPTION WHEN OTHERS THEN
    mode := 'log';
  END;

  IF mode = 'enforce' THEN
    key_value := to_jsonb(NEW) ->> key_col;
    EXECUTE format('SELECT true, p.tenant_id FROM public.%I p WHERE p.id = $1', parent_tbl)
      INTO has_parent, derived USING key_value::uuid;
    -- A missing parent and another tenant's parent must look the same to a tenant
    -- session. The guard policy refuses both, with RLS's one error.
    IF public.tenancy_hidden_from_tenant_session(CASE WHEN has_parent THEN derived END, NULL) THEN
      RETURN NEW;
    END IF;
    IF has_parent IS NOT TRUE THEN
      IF supplied IS NULL THEN
        RAISE EXCEPTION 'tenancy: % has no % row and no tenant_id was supplied', tbl, parent_tbl
          USING ERRCODE = '23503';
      END IF;
      RETURN NEW;
    END IF;
    IF derived IS NULL THEN
      RAISE EXCEPTION 'tenancy: % parent row in % has no tenant', tbl, parent_tbl
        USING ERRCODE = '23502';
    END IF;
    IF supplied IS NOT NULL AND supplied <> derived THEN
      RAISE EXCEPTION 'tenancy: % tenant_id does not match its % row', tbl, parent_tbl
        USING ERRCODE = '23514';
    END IF;
    NEW.tenant_id := derived;
    RETURN NEW;
  END IF;

  -- 'log' mode: never raise. The reasons mean what they do for the event-key
  -- trigger: no_event and mismatch are writes enforce would refuse, kept is
  -- informational. sample_key is the parent's id, never personal data.
  BEGIN
    key_value := to_jsonb(NEW) ->> key_col;
    EXECUTE format('SELECT true, p.tenant_id FROM public.%I p WHERE p.id = $1', parent_tbl)
      INTO has_parent, derived USING key_value::uuid;
    IF has_parent IS NOT TRUE THEN
      -- Where the key is a foreign key, it now refuses the row as it does today.
      -- Only the two esign logs reach the end of the statement from here.
      IF supplied IS NOT NULL THEN
        IF NOT quiet THEN PERFORM public.tenancy_log_derivation(tbl, 'kept', key_value); END IF;
        RETURN NEW;
      END IF;
      NEW.tenant_id := stellr;
      IF NOT quiet THEN PERFORM public.tenancy_log_derivation(tbl, 'no_event', key_value); END IF;
      RETURN NEW;
    END IF;
    IF derived IS NULL THEN
      -- A parent the S3 backfill has not reached. Stay NULL with it, so the next
      -- backfill run stamps both.
      NEW.tenant_id := NULL;
      IF NOT quiet THEN PERFORM public.tenancy_log_derivation(tbl, 'no_event', key_value); END IF;
      RETURN NEW;
    END IF;
    IF supplied IS NOT NULL AND supplied <> derived AND NOT quiet THEN
      -- On an update NEW carries the old value: moving to another parent without
      -- naming tenant_id supplies nothing, so it is not a mismatch.
      IF TG_OP = 'INSERT' OR supplied IS DISTINCT FROM OLD.tenant_id THEN
        PERFORM public.tenancy_log_derivation(tbl, 'mismatch', key_value);
      END IF;
    END IF;
    NEW.tenant_id := derived;
    RETURN NEW;
  EXCEPTION WHEN OTHERS THEN
    -- derived is the parent's tenant if the read got that far, otherwise NULL.
    NEW.tenant_id := derived;
    BEGIN
      PERFORM public.tenancy_log_derivation(tbl, 'error', NULL, SQLSTATE);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- the log itself failed; the write still goes through
    END;
    RETURN NEW;
  END;
END $$;

REVOKE EXECUTE ON FUNCTION public.tenancy_inherit_tenant_id() FROM PUBLIC, anon, authenticated;

-- credential_events (credential_id: credentials)
ALTER TABLE public.credential_events
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS credential_events_tenant_id_idx ON public.credential_events (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.credential_events;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF credential_id, tenant_id ON public.credential_events
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_inherit_tenant_id('credential_id', 'credentials');

-- store_returns (order_id: store_orders)
ALTER TABLE public.store_returns
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS store_returns_tenant_id_idx ON public.store_returns (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.store_returns;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF order_id, tenant_id ON public.store_returns
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_inherit_tenant_id('order_id', 'store_orders');

-- member_group_members (group_id: member_groups)
ALTER TABLE public.member_group_members
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS member_group_members_tenant_id_idx ON public.member_group_members (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.member_group_members;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF group_id, tenant_id ON public.member_group_members
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_inherit_tenant_id('group_id', 'member_groups');

-- store_order_items (order_id: store_orders)
ALTER TABLE public.store_order_items
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS store_order_items_tenant_id_idx ON public.store_order_items (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.store_order_items;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF order_id, tenant_id ON public.store_order_items
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_inherit_tenant_id('order_id', 'store_orders');

-- survey_answers (response_id: survey_responses)
ALTER TABLE public.survey_answers
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS survey_answers_tenant_id_idx ON public.survey_answers (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.survey_answers;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF response_id, tenant_id ON public.survey_answers
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_inherit_tenant_id('response_id', 'survey_responses');

-- survey_invitations (distribution_id: survey_distributions)
ALTER TABLE public.survey_invitations
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS survey_invitations_tenant_id_idx ON public.survey_invitations (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.survey_invitations;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF distribution_id, tenant_id ON public.survey_invitations
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_inherit_tenant_id('distribution_id', 'survey_distributions');

-- esign_access_log (envelope_row: agreements, deliberately not a foreign key)
ALTER TABLE public.esign_access_log
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS esign_access_log_tenant_id_idx ON public.esign_access_log (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.esign_access_log;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF envelope_row, tenant_id ON public.esign_access_log
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_inherit_tenant_id('envelope_row', 'agreements');

-- esign_audit_events (envelope_row: agreements, deliberately not a foreign key).
-- esign_append_audit() names its columns and its hash does not cover tenant_id,
-- so existing chains still verify.
ALTER TABLE public.esign_audit_events
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS esign_audit_events_tenant_id_idx ON public.esign_audit_events (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.esign_audit_events;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF envelope_row, tenant_id ON public.esign_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_inherit_tenant_id('envelope_row', 'agreements');

-- agreement_recipients (envelope_row: agreements)
ALTER TABLE public.agreement_recipients
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS agreement_recipients_tenant_id_idx ON public.agreement_recipients (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.agreement_recipients;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF envelope_row, tenant_id ON public.agreement_recipients
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_inherit_tenant_id('envelope_row', 'agreements');

-- participants (registration_id: registrations)
ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS participants_tenant_id_idx ON public.participants (tenant_id);
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.participants;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF registration_id, tenant_id ON public.participants
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_inherit_tenant_id('registration_id', 'registrations');
