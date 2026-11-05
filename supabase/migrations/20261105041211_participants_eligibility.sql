-- S5 A3 (multi-tenancy plan, docs/TENANCY-S5.md): the database backstop for who
-- may take part in a tenant's event. lib/registration/eligibility.ts is the
-- check that gives the registrant a message first; this refuses the row
-- whichever writer it came from, so it holds the same tenant rule.
--
-- ── Stellr is untouched ──────────────────────────────────────────────────────
-- A platform-owner event returns before any age rule runs: Stellr admits
-- under-13s with a parent, and its date-of-birth rules stay in the app. Each
-- Stellr participant write gains one lookup (registrations by primary key,
-- events by its unique slug, tenants by primary key) and no refusal. Unlike
-- tenancy_derive_tenant_id, that lookup does not swallow errors: failing closed
-- is right for a tenant, so a failed read fails the write for Stellr too.
--
-- ── Which event rules apply ──────────────────────────────────────────────────
--   With an events row: events.tenant_id joined to tenants.
--   With no events row: allowed only when registrations.tenant_id is NULL or
--     Stellr, because Sanity is the source of truth and events is a background
--     mirror, so refusing outright would break Stellr registrations for an
--     unmirrored event. Any other tenant raises 23514.
--
-- That second rule alone does not stop an unmirrored tenant event. In log mode
-- tenancy_derive_tenant_id stamps an unstamped registration with no events row
-- as Stellr (reason no_event), and this check then sees Stellr.
-- derivation_mode='enforce' before the first non-owner event raises 23503 for
-- that row, but only while the writer supplies no tenant_id. A supplied Stellr id
-- on a slug the mirror does not have is kept in both modes and looks the same as
-- a real unmirrored Stellr event here. Once every write path supplies tenant_id
-- (A7, A8), what protects an unmirrored tenant event is those writers' resolver
-- never answering Stellr for it. pgTAP pins both halves
-- (supabase/tests/database/participant_eligibility.test.sql).
--
-- ── The tenant rule ──────────────────────────────────────────────────────────
-- It matches assertEligible, failing closed in the same order. "Today" and the
-- event's start date are both taken in the event's time zone.
--   time_zone_invalid    the zone is one Postgres does not know
--   start_date_missing   a live event with no start date (a campaign uses today)
--   dob_missing          no date of birth
--   dob_invalid          in the future, over 120, or not a finite date
--   under_minimum_age    below GREATEST(14, tenant minimum, event minimum) on the
--                        event's start date, or under 13 today however far off
--                        the event is
-- Every refusal is SQLSTATE 23514. The message is the reason alone: never a date
-- of birth, a name or an event.
--
-- test/registration/participants-eligibility-sql.test.ts holds the literals below
-- equal to their TypeScript constants.
--
-- ── Three triggers, each after anything that changes what it reads ───────────
--   zzz_participants_assert_eligible    a participant row is written. BEFORE, so
--                                       it runs ahead of the NOT NULL check: a
--                                       NULL date of birth on a tenant event is
--                                       23514. Named to sort after any
--                                       zz_tenancy_derive_tenant_id trigger.
--   zzz_registrations_assert_eligible   a registration moves event or tenant. It
--                                       sorts after the derivation trigger, so
--                                       it sees the tenant that trigger settled.
--   zz_events_assert_participants_eligible
--                                       a tenant event's start date, tenant,
--                                       minimum, time zone or slug changes, so
--                                       existing participants are read against
--                                       the new rules. A change that leaves any
--                                       of them ineligible raises 23514. A tenant
--                                       event handed to Stellr raises 23514
--                                       (tenant_handover) while registrations
--                                       stamped with a tenant are on its slug,
--                                       because a Stellr event switches the rule
--                                       off for them.
--
-- ── What that re-check means for the mirror ──────────────────────────────────
-- lib/events/sync.ts upserts every column on each sync, so the WHEN clause keeps
-- an unchanged row from doing any work. A refused change leaves the mirror on the
-- old values, and the failed sync is recorded in app_errors, so staff have to
-- resolve the participant before the mirror follows Sanity. A live event whose
-- start date is removed while it has participants is refused the same way.
--
-- Until then the event keeps admitting under its old rules: a refused raise of
-- the minimum, or a refused earlier start date, leaves new registrants judged by
-- the old values, here and in eligibilityContextFromMirror. pgTAP pins this.
--
-- That sync keeps an existing row's tenant (upsertEventRows), so it cannot hand a
-- tenant row to Stellr. Any other writer can, and this trigger refuses that while
-- the row has tenant registrations, but not the handover of a row with none. The
-- sync still writes a NULL minimum (toEventRow's default), which clears a tenant
-- row's own minimum, and this trigger does not stop that. The sync has to stop
-- overwriting the minimum on a non-owner row before a tenant event is held in
-- Sanity.
--
-- Withdrawn registrations count: one can be reinstated, and nothing re-checks
-- then. Not re-checked: tenants.min_participant_age changing; a new events row
-- arriving for a slug that already has registrations (the gap above); and
-- activity_type changing, where a campaign going live with no start date refuses
-- only new writes.
--
-- ── Concurrency ──────────────────────────────────────────────────────────────
-- None of the three takes a row lock, so that Stellr writes gain no lock and no
-- new wait on registrations. Under READ COMMITTED, a participant insert running
-- alongside a registration move or an event change can commit a row neither check
-- judged against the final state. Accepted: this is the backstop behind the API
-- gate, and moves and tightenings are rare staff actions.
--
-- A slug rename (rename_event_slug) on a tenant event with participants needs
-- the mirror to hold the new slug first, or it is refused as an unmirrored tenant
-- event. Stellr's events are unaffected.
--
-- ── Why SECURITY DEFINER ─────────────────────────────────────────────────────
-- As with tenancy_derive_tenant_id: these fire for whoever writes the row and
-- read public.events and public.tenants, which those roles cannot touch. They run
-- as the owner with a pinned search_path and EXECUTE revoked from PUBLIC, anon and
-- authenticated. The shared check is SECURITY INVOKER and called only from them.
--
-- lock_timeout: creating these triggers locks three live tables. If a long
-- transaction holds one, fail fast and retry rather than queue registration and
-- check-in behind this migration.
SET LOCAL lock_timeout = '5s';

-- ── The check ────────────────────────────────────────────────────────────────
-- Returns why a date of birth cannot join this event, or NULL when it can.

CREATE OR REPLACE FUNCTION public.participant_eligibility_refusal(
  p_date_of_birth date,
  p_event_slug text,
  p_registration_tenant uuid
)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- lib/tenancy/constants.ts STELLR_TENANT_ID. Seeded by 20261104100000.
  stellr constant uuid := '00000000-0000-4000-8000-000000000001';
  -- lib/tenancy/constants.ts TENANT_MIN_PARTICIPANT_AGE.
  platform_min_age constant int := 14;
  -- lib/registration/eligibility.ts TENANT_MIN_AGE_TODAY.
  min_age_today constant int := 13;
  -- lib/registration-eligibility.ts MAX_AGE.
  max_age constant int := 120;
  ev record;
  local_today date;
  event_day date;
  age_today int;
  age_at_event int;
BEGIN
  SELECT e.tenant_id,
         e.activity_type,
         e.starts_at,
         e.time_zone,
         e.min_participant_age AS event_min,
         t.id AS tenant_row,
         t.is_platform_owner,
         t.min_participant_age AS tenant_min
    INTO ev
    FROM public.events e
    LEFT JOIN public.tenants t ON t.id = e.tenant_id
   WHERE e.slug = p_event_slug;

  IF NOT FOUND THEN
    IF p_registration_tenant IS NULL OR p_registration_tenant = stellr THEN
      RETURN NULL;
    END IF;
    RETURN 'event_missing';
  END IF;

  IF ev.is_platform_owner AND ev.tenant_id = stellr THEN
    RETURN NULL;
  END IF;

  IF ev.tenant_row IS NULL THEN
    RETURN 'tenant_missing';
  END IF;

  -- events.time_zone is only shape-checked, so it can name a zone that does not exist.
  BEGIN
    local_today := (now() AT TIME ZONE ev.time_zone)::date;
    IF ev.starts_at IS NOT NULL THEN
      event_day := (ev.starts_at AT TIME ZONE ev.time_zone)::date;
    END IF;
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN 'time_zone_invalid';
  END;

  IF event_day IS NULL THEN
    IF ev.activity_type IS DISTINCT FROM 'campaign' THEN
      RETURN 'start_date_missing';
    END IF;
    event_day := local_today;
  END IF;

  IF p_date_of_birth IS NULL THEN
    RETURN 'dob_missing';
  END IF;
  IF NOT isfinite(p_date_of_birth) OR p_date_of_birth > local_today THEN
    RETURN 'dob_invalid';
  END IF;

  -- Whole years, as lib/age.ts ageOn counts them. The casts keep age() on the
  -- timestamp overload, so the session's time zone cannot shift a birthday.
  age_today := extract(year FROM age(local_today::timestamp, p_date_of_birth::timestamp))::int;
  age_at_event := extract(year FROM age(event_day::timestamp, p_date_of_birth::timestamp))::int;

  IF age_today > max_age THEN
    RETURN 'dob_invalid';
  END IF;
  IF age_at_event < GREATEST(platform_min_age, ev.tenant_min, ev.event_min) THEN
    RETURN 'under_minimum_age';
  END IF;
  IF age_today < min_age_today THEN
    RETURN 'under_minimum_age';
  END IF;
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.participant_eligibility_refusal(date, text, uuid) FROM PUBLIC, anon, authenticated;

-- ── participants ─────────────────────────────────────────────────────────────

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

  refusal := public.participant_eligibility_refusal(NEW.date_of_birth, reg.event_slug, reg.tenant_id);
  IF refusal IS NOT NULL THEN
    RAISE EXCEPTION 'participant eligibility: %', refusal USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.participants_assert_eligible() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zzz_participants_assert_eligible ON public.participants;
CREATE TRIGGER zzz_participants_assert_eligible
  BEFORE INSERT OR UPDATE OF date_of_birth, registration_id ON public.participants
  FOR EACH ROW EXECUTE FUNCTION public.participants_assert_eligible();

-- ── registrations ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.registrations_assert_eligible()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  person   record;
  refusal  text;
BEGIN
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

-- A BEFORE trigger's WHEN is evaluated when its turn comes, so this sees the
-- tenant_id zz_tenancy_derive_tenant_id has already settled.
DROP TRIGGER IF EXISTS zzz_registrations_assert_eligible ON public.registrations;
CREATE TRIGGER zzz_registrations_assert_eligible
  BEFORE UPDATE OF event_slug, tenant_id ON public.registrations
  FOR EACH ROW
  WHEN (OLD.event_slug IS DISTINCT FROM NEW.event_slug OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id)
  EXECUTE FUNCTION public.registrations_assert_eligible();

-- ── events ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.events_assert_participants_eligible()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  -- lib/tenancy/constants.ts STELLR_TENANT_ID.
  stellr   constant uuid := '00000000-0000-4000-8000-000000000001';
  person   record;
  refusal  text;
BEGIN
  -- Stellr's own changes stop here. That is only an optimisation for the rule
  -- below, since participant_eligibility_refusal answers NULL for a Stellr event,
  -- but it saves one lookup per participant on each Stellr date change.
  IF EXISTS (
    SELECT 1 FROM public.tenants t
     WHERE t.id = NEW.tenant_id AND t.is_platform_owner AND t.id = stellr
  ) THEN
    -- tenant_id changed and is now Stellr, so it was another tenant's event.
    IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id AND EXISTS (
      SELECT 1 FROM public.registrations r
       WHERE r.event_slug = NEW.slug AND r.tenant_id IS NOT NULL AND r.tenant_id <> stellr
    ) THEN
      refusal := 'tenant_handover';
      RAISE EXCEPTION 'participant eligibility: %', refusal USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END IF;

  FOR person IN
    SELECT p.date_of_birth, r.tenant_id
      FROM public.registrations r
      JOIN public.participants p ON p.registration_id = r.id
     WHERE r.event_slug = NEW.slug
  LOOP
    refusal := public.participant_eligibility_refusal(person.date_of_birth, NEW.slug, person.tenant_id);
    IF refusal IS NOT NULL THEN
      RAISE EXCEPTION 'participant eligibility: %', refusal USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.events_assert_participants_eligible() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_events_assert_participants_eligible ON public.events;
CREATE TRIGGER zz_events_assert_participants_eligible
  AFTER UPDATE OF starts_at, tenant_id, min_participant_age, time_zone, slug ON public.events
  FOR EACH ROW
  WHEN (
    OLD.starts_at IS DISTINCT FROM NEW.starts_at
    OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.min_participant_age IS DISTINCT FROM NEW.min_participant_age
    OR OLD.time_zone IS DISTINCT FROM NEW.time_zone
    OR OLD.slug IS DISTINCT FROM NEW.slug
  )
  EXECUTE FUNCTION public.events_assert_participants_eligible();
