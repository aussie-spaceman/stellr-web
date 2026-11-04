-- S3 "Tenant and event data model" (multi-tenancy plan), step 3 of 5.
--
-- The machinery that derives tenant_id on event-scoped rows. The columns and
-- the triggers that call it are added in step 4
-- (20261104130000_tenant_id_expand.sql).
--
--   tenancy_settings         one row. derivation_mode = 'log' (default) or
--                            'enforce'. Flipping it is the S3 cut-over, an
--                            owner action gated by docs/TENANCY-S3.md.
--   tenancy_derivation_log   counts, by table, reason and UTC day, of rows the
--                            trigger could NOT derive from an events row.
--                            Bounded: one row per (table, reason, day), never
--                            one per write. sample_key is the last event key
--                            seen (an event slug or Sanity id — never personal
--                            data).
--   tenancy_derive_tenant_id()  the BEFORE INSERT/UPDATE trigger function.
--
-- ── What the trigger does ────────────────────────────────────────────────────
-- TG_ARGV[0] names the row's event key column, TG_ARGV[1] its kind:
-- 'slug' (event_slug columns) or 'sanity_id' (event_ref / sanity_event_id).
-- It looks the key up in public.events and sets NEW.tenant_id to that event's
-- tenant.
--
-- In 'log' mode it NEVER blocks a write. When it cannot derive — the key is
-- null ('no_key'), no events row has it ('no_event'), a supplied tenant_id
-- disagrees with the event's ('mismatch'), or anything at all raises
-- ('error') — it sets Stellr's tenant id (unless one was supplied) and counts
-- the case in tenancy_derivation_log. Every exception is caught. Nothing reads
-- tenant_id in S3, so the value it writes changes no behaviour.
--
-- In 'enforce' mode a row whose tenant cannot be established raises instead:
-- no events row and no tenant_id supplied, or a supplied tenant_id that
-- disagrees with the event's. A supplied tenant_id with a null key is kept
-- (rows with an optional event, e.g. a store order with no event).
--
-- During the one-off backfill (step 5), `SET LOCAL stellr.tenancy_backfill =
-- 'on'` suppresses the log in 'log' mode so the backfill does not swamp the
-- 7-day orphan count with historic rows.
--
-- ── Why SECURITY DEFINER ─────────────────────────────────────────────────────
-- Unavoidable: the trigger fires for whoever writes the row (service_role
-- today, authenticated on a few community tables), and it must read
-- public.events / tenancy_settings and write tenancy_derivation_log, none of
-- which those roles can touch. It runs as the owner with a pinned
-- search_path, and EXECUTE is revoked from PUBLIC, anon and authenticated
-- (trigger functions are not called through the API; CREATE TRIGGER needs
-- EXECUTE only when the trigger is created, by the migration owner).

-- ── tenancy_settings ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenancy_settings (
  id               boolean PRIMARY KEY DEFAULT true CHECK (id),
  derivation_mode  text NOT NULL DEFAULT 'log' CHECK (derivation_mode IN ('log', 'enforce')),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- Free text: who flipped it and why (a role, never a name or email).
  note             text CHECK (note IS NULL OR char_length(note) <= 500)
);

INSERT INTO public.tenancy_settings (id, derivation_mode, note)
  VALUES (true, 'log', 'S3 initial: log-only')
  ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.tenancy_settings IS
  'Singleton. derivation_mode log|enforce for tenancy_derive_tenant_id(). Owner flips to enforce per docs/TENANCY-S3.md.';

ALTER TABLE public.tenancy_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenancy_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.tenancy_settings TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access tenancy_settings"
    ON public.tenancy_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── tenancy_derivation_log ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenancy_derivation_log (
  table_name  text NOT NULL CHECK (char_length(table_name) <= 130),
  reason      text NOT NULL CHECK (reason IN ('no_key', 'no_event', 'mismatch', 'error')),
  day         date NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::date),
  count       bigint NOT NULL DEFAULT 1 CHECK (count >= 1),
  sample_key  text CHECK (sample_key IS NULL OR char_length(sample_key) <= 200),
  -- For 'error': the SQLSTATE only, never the message (which can carry values).
  sqlstate    text CHECK (sqlstate IS NULL OR char_length(sqlstate) <= 5),
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_name, reason, day)
);

CREATE INDEX IF NOT EXISTS tenancy_derivation_log_day_idx ON public.tenancy_derivation_log (day DESC);

COMMENT ON TABLE public.tenancy_derivation_log IS
  'Daily counts of rows whose tenant_id could not be derived from public.events (S3 log mode). 0 no_event/mismatch/error for 7 days gates the enforce cut-over.';

ALTER TABLE public.tenancy_derivation_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenancy_derivation_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenancy_derivation_log TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access tenancy_derivation_log"
    ON public.tenancy_derivation_log FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── The log writer ───────────────────────────────────────────────────────────
-- Internal: called only by tenancy_derive_tenant_id() (which runs as the
-- owner). SECURITY INVOKER, EXECUTE revoked from every API role.

CREATE OR REPLACE FUNCTION public.tenancy_log_derivation(
  p_table text,
  p_reason text,
  p_key text,
  p_sqlstate text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.tenancy_derivation_log (table_name, reason, sample_key, sqlstate)
    VALUES (left(p_table, 130), p_reason, left(p_key, 200), left(p_sqlstate, 5))
    ON CONFLICT (table_name, reason, day) DO UPDATE
      SET count = tenancy_derivation_log.count + 1,
          sample_key = COALESCE(EXCLUDED.sample_key, tenancy_derivation_log.sample_key),
          sqlstate = COALESCE(EXCLUDED.sqlstate, tenancy_derivation_log.sqlstate),
          last_seen = now();
END $$;

REVOKE EXECUTE ON FUNCTION public.tenancy_log_derivation(text, text, text, text) FROM PUBLIC, anon, authenticated;

-- ── The trigger function ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tenancy_derive_tenant_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  -- lib/tenancy/constants.ts STELLR_TENANT_ID. Seeded by 20261104100000.
  stellr      constant uuid := '00000000-0000-4000-8000-000000000001';
  tbl         text := TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
  key_col     text := TG_ARGV[0];
  key_kind    text := COALESCE(TG_ARGV[1], 'slug');
  mode        text := 'log';
  supplied    uuid := NEW.tenant_id;
  key_value   text;
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
    IF key_value IS NULL THEN
      IF supplied IS NULL THEN
        RAISE EXCEPTION 'tenancy: % has no event key (%) and no tenant_id', tbl, key_col
          USING ERRCODE = '23502';
      END IF;
      RETURN NEW;
    END IF;
    IF key_kind = 'sanity_id' THEN
      SELECT e.tenant_id INTO derived FROM public.events e WHERE e.sanity_id = key_value;
    ELSE
      SELECT e.tenant_id INTO derived FROM public.events e WHERE e.slug = key_value;
    END IF;
    IF derived IS NULL THEN
      IF supplied IS NULL THEN
        RAISE EXCEPTION 'tenancy: % event % is not in public.events and no tenant_id was supplied', tbl, key_value
          USING ERRCODE = '23503';
      END IF;
      RETURN NEW;
    END IF;
    IF supplied IS NOT NULL AND supplied <> derived THEN
      RAISE EXCEPTION 'tenancy: % tenant_id does not match event %', tbl, key_value
        USING ERRCODE = '23514';
    END IF;
    NEW.tenant_id := derived;
    RETURN NEW;
  END IF;

  -- 'log' mode: never raise.
  BEGIN
    key_value := to_jsonb(NEW) ->> key_col;
    IF key_value IS NULL THEN
      NEW.tenant_id := COALESCE(supplied, stellr);
      IF NOT quiet THEN PERFORM public.tenancy_log_derivation(tbl, 'no_key', NULL); END IF;
      RETURN NEW;
    END IF;
    IF key_kind = 'sanity_id' THEN
      SELECT e.tenant_id INTO derived FROM public.events e WHERE e.sanity_id = key_value;
    ELSE
      SELECT e.tenant_id INTO derived FROM public.events e WHERE e.slug = key_value;
    END IF;
    IF derived IS NULL THEN
      NEW.tenant_id := COALESCE(supplied, stellr);
      IF NOT quiet THEN PERFORM public.tenancy_log_derivation(tbl, 'no_event', key_value); END IF;
      RETURN NEW;
    END IF;
    IF supplied IS NOT NULL AND supplied <> derived AND NOT quiet THEN
      PERFORM public.tenancy_log_derivation(tbl, 'mismatch', key_value);
    END IF;
    NEW.tenant_id := derived;
    RETURN NEW;
  EXCEPTION WHEN OTHERS THEN
    NEW.tenant_id := COALESCE(supplied, stellr);
    BEGIN
      PERFORM public.tenancy_log_derivation(tbl, 'error', NULL, SQLSTATE);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- the log itself failed; the write still goes through
    END;
    RETURN NEW;
  END;
END $$;

REVOKE EXECUTE ON FUNCTION public.tenancy_derive_tenant_id() FROM PUBLIC, anon, authenticated;
