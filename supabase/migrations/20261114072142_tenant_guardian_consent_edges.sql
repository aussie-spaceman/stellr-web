-- S5 tenant guardian consent: the edges A16 left (review ids AMD-CONSENT-EDGES,
-- fixA-notdone-move, T-25 / fixrev-low-audit-trace; tracker s5-programme.25 and
-- .26). Builds on 20261110164339_tenant_guardian_consent.sql.
--
-- Four changes:
--
--   1. A consent lifted by a date-of-birth correction is kept, as 'settled' with
--      its settled_at, instead of being deleted. Until now the row went, so the
--      database held no trace that a hold had been lifted (T-25). 'settled' joins
--      the status CHECK; tenant_guardian_consents_settled already requires
--      settled_at for every status but 'pending'.
--
--   2. A move onto a Stellr event's registration removes the participant's
--      consent row still 'pending' (fixA-notdone-move). Until now the trigger
--      returned before it for a Stellr event, so the participant stayed held from
--      check-in, and a candidate for the sweep, until the row went. A declined or
--      expired row is left: its removal is under way. A signed row is left too.
--
--   3. escalated_at: the sweep stops retrying a removal that failed
--      MAX_REMOVAL_ATTEMPTS times, marks the row with escalated_at and alerts
--      staff once (lib/registration/tenant-guardian-consent.ts). The removal
--      index now leaves escalated rows out, as the sweep's read does.
--
--   4. The check-in guard and the opener's insert-time refusal treat 'settled' as
--      not held, as 'signed' is: the participant is an adult on the event.
--
-- Also: a participant whose consent was settled and whose date of birth is
-- corrected back under 18 on the same registration is pending again. The opener's
-- upsert re-opened a row only for a new registration; with the row now kept, it
-- re-opens a settled one too (before, the DELETE let a fresh row be inserted).
--
-- Not applied anywhere by the change that adds it. The owner applies it through
-- the Production migration Action (.github/workflows/prod-migrate.yml).
--
-- Locks: ADD COLUMN (nullable, no default) and the CHECK swap take ACCESS
-- EXCLUSIVE on tenant_guardian_consents, which is small (empty on production
-- while TENANT_GUARDIAN_CONSENT_ENABLED is off), and adding the CHECK scans it
-- under that lock until commit. CREATE OR REPLACE FUNCTION takes no lock on
-- participants: the triggers are not dropped or re-created, so they call the new
-- bodies from the next statement. lock_timeout makes a lock already held
-- elsewhere fail fast.

SET LOCAL lock_timeout = '5s';

-- ── 1 and 3. The table ───────────────────────────────────────────────────────

ALTER TABLE public.tenant_guardian_consents
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz;

COMMENT ON COLUMN public.tenant_guardian_consents.escalated_at IS
  'When the sweep stopped retrying this row''s removal and alerted staff (lib/registration/tenant-guardian-consent.ts MAX_REMOVAL_ATTEMPTS). NULL while the sweep still retries.';

-- The column CHECK from 20261110164339, named by Postgres's default rule.
ALTER TABLE public.tenant_guardian_consents
  DROP CONSTRAINT IF EXISTS tenant_guardian_consents_status_check;
ALTER TABLE public.tenant_guardian_consents
  ADD CONSTRAINT tenant_guardian_consents_status_check
  CHECK (status IN ('pending', 'signed', 'declined', 'expired', 'settled'));

COMMENT ON COLUMN public.tenant_guardian_consents.status IS
  'pending until a guardian signs (signed), declines (declined) or the window closes (expired); settled when a date-of-birth correction made the participant 18 or over while still pending, kept as the trace that the hold was lifted.';

DROP INDEX IF EXISTS public.tenant_guardian_consents_removal_idx;
CREATE INDEX IF NOT EXISTS tenant_guardian_consents_removal_idx
  ON public.tenant_guardian_consents (next_attempt_at)
  WHERE status IN ('declined', 'expired') AND escalated_at IS NULL;

-- ── 4. No check-in before consent ─────────────────────────────────────────────
-- As 20261110164339, but a settled row (lifted by a correction to 18 or over) no
-- longer holds the participant. Any status other than these two still does, so a
-- status added later is held until someone says otherwise.

CREATE OR REPLACE FUNCTION public.participants_refuse_unconsented_check_in()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tenant_guardian_consents c
    WHERE c.participant_id = NEW.id AND c.status NOT IN ('signed', 'settled')
  ) THEN
    -- The message is the reason alone: never a name or an event.
    RAISE EXCEPTION 'guardian_consent_pending' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.participants_refuse_unconsented_check_in() FROM PUBLIC, anon, authenticated;

-- ── 1, 2 and 4. The opener ────────────────────────────────────────────────────
-- As 20261110164339, with three changes, each marked below:
--   (a) a move onto a Stellr event's registration (or one with no mirrored event,
--       which A3 admits only for Stellr) removes a consent row still 'pending';
--   (b) an UPDATE that leaves the participant 18 or over on a tenant's event
--       settles a pending row (status 'settled', settled_at now) instead of
--       deleting it;
--   (c) the upsert re-opens a settled row on the same registration, and the
--       insert-time refusal does not count a settled row as held.
--
-- test/registration/tenant-guardian-consent-edges-sql.test.ts holds the literals
-- below equal to their TypeScript constants.

CREATE OR REPLACE FUNCTION public.participants_open_tenant_guardian_consent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  -- lib/tenancy/constants.ts STELLR_TENANT_ID.
  stellr constant uuid := '00000000-0000-4000-8000-000000000001';
  -- lib/registration/eligibility.ts TENANT_MIN_AGE_WITHOUT_GUARDIAN_CONSENT.
  adult_age constant int := 18;
  -- lib/registration/tenant-guardian-consent.ts TENANT_GUARDIAN_CONSENT_WINDOW_DAYS.
  window_days constant int := 14;
  moved boolean := false;
  ev record;
  local_today date;
  event_day date;
BEGIN
  -- Nested, not one AND: OLD is NULL on an INSERT.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.date_of_birth IS NOT DISTINCT FROM OLD.date_of_birth
       AND NEW.registration_id IS NOT DISTINCT FROM OLD.registration_id THEN
      RETURN NULL;
    END IF;
    moved := NEW.registration_id IS DISTINCT FROM OLD.registration_id;
  END IF;
  -- A tenant event refuses a NULL date of birth (A3); Stellr's events keep theirs.
  -- A move still goes on to (a), so a Stellr participant with no date of birth who
  -- moved off a tenant's event is released too.
  IF NEW.date_of_birth IS NULL AND NOT moved THEN
    RETURN NULL;
  END IF;

  SELECT e.tenant_id, e.starts_at, e.time_zone, t.is_platform_owner
    INTO ev
    FROM public.registrations r
    JOIN public.events e ON e.slug = r.event_slug
    JOIN public.tenants t ON t.id = e.tenant_id
   WHERE r.id = NEW.registration_id;
  -- No mirrored event: A3 admits that only for Stellr. Stellr's event: Stellr's forms.
  IF NOT FOUND OR (ev.is_platform_owner AND ev.tenant_id = stellr) THEN
    -- (a) Moved onto Stellr's event: the tenant event's pending consent no longer
    -- applies. A declined or expired row's removal is under way; a signed row is
    -- an answer. Both are left.
    IF moved THEN
      DELETE FROM public.tenant_guardian_consents c
       WHERE c.participant_id = NEW.id AND c.status = 'pending';
    END IF;
    RETURN NULL;
  END IF;

  IF NEW.date_of_birth IS NULL THEN
    RETURN NULL;
  END IF;

  -- A3 refuses a zone Postgres does not know before this runs; if one got through,
  -- judge against today in UTC rather than skip the row.
  BEGIN
    local_today := (now() AT TIME ZONE ev.time_zone)::date;
    event_day := COALESCE((ev.starts_at AT TIME ZONE ev.time_zone)::date, local_today);
  EXCEPTION WHEN invalid_parameter_value THEN
    local_today := (now() AT TIME ZONE 'UTC')::date;
    event_day := local_today;
  END;

  IF LEAST(
       extract(year FROM age(local_today::timestamp, NEW.date_of_birth::timestamp))::int,
       extract(year FROM age(event_day::timestamp, NEW.date_of_birth::timestamp))::int
     ) >= adult_age THEN
    -- (b) Lifted: kept as settled, the trace that the hold was lifted. The sweep
    -- voids the consent envelope left open, and audits it
    -- (registration.guardian_consent.lift).
    IF TG_OP = 'UPDATE' THEN
      UPDATE public.tenant_guardian_consents c
         SET status = 'settled', settled_at = now()
       WHERE c.participant_id = NEW.id AND c.status = 'pending';
    END IF;
    RETURN NULL;
  END IF;

  INSERT INTO public.tenant_guardian_consents AS c
    (tenant_id, registration_id, participant_id, status, expires_at)
  VALUES
    (ev.tenant_id, NEW.registration_id, NEW.id, 'pending',
     LEAST(now() + make_interval(days => window_days), COALESCE(ev.starts_at, 'infinity'::timestamptz)))
  ON CONFLICT (participant_id) DO UPDATE
    SET tenant_id        = EXCLUDED.tenant_id,
        registration_id  = EXCLUDED.registration_id,
        agreement_id     = NULL,
        status           = 'pending',
        expires_at       = EXCLUDED.expires_at,
        requested_at     = now(),
        settled_at       = NULL,
        removal_attempts = 0,
        next_attempt_at  = NULL,
        escalated_at     = NULL
    -- (c) A settled row is a minor again: pending, as a new registration's is.
    WHERE c.registration_id IS DISTINCT FROM EXCLUDED.registration_id
       OR c.status = 'settled';

  IF TG_OP = 'INSERT' AND NEW.checked_in_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenant_guardian_consents c
    WHERE c.participant_id = NEW.id AND c.status NOT IN ('signed', 'settled')
  ) THEN
    RAISE EXCEPTION 'guardian_consent_pending' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.participants_open_tenant_guardian_consent() FROM PUBLIC, anon, authenticated;
