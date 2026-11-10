-- S5 wave 6 (owner decision, 10 Nov 2026): guardian consent on a tenant's event.
-- A registrant aged 14 to 17 on the event day may register for another
-- organiser's event once a parent or legal guardian signs a platform-locked
-- consent document on the native signing engine. Until then the participant is
-- consent-pending: it cannot be checked in, and it is removed through the
-- deletion registry if the guardian declines or the window closes.
-- lib/registration/tenant-guardian-consent.ts is the flow, behind
-- TENANT_GUARDIAN_CONSENT_ENABLED (off by default).
--
-- Four additive changes:
--
--   1. public.tenant_guardian_consents: one row per consent-pending participant,
--      and what became of it. No contact data: the guardian's name and email
--      stay on the participant's emergency-contact columns (field-encrypted in
--      shadow mode, S4) and on the signing envelope, as for Stellr's own minor
--      consent. Platform-level: written by service_role only, so a tenant session
--      can never mark its own consent given. Stellr's rows are refused by CHECK:
--      Stellr's minors keep Stellr's own consent forms.
--
--   2. agreements.envelope_type also accepts 'tenant_guardian_consent'. The
--      CHECK is dropped and added again, wider, in this one transaction. Adding
--      it scans every agreements row under the ACCESS EXCLUSIVE lock the DROP
--      already took, so reads and writes of agreements wait for the length of
--      that scan (agreements is small today). lock_timeout below bounds only the
--      wait to take the lock, not the scan.
--
--   3. A trigger refuses to set participants.checked_in_at while that
--      participant's consent is not signed. Every check-in writer goes through
--      it: the public check-in route, the desk and the admin routes. For Stellr
--      it is one indexed lookup on an empty set per check-in, and no refusal.
--
--   4. A trigger writes a pending consent row in the same statement as any
--      participant under 18 on another organiser's event, so no writer can leave
--      one without it, and removes a still-pending row when a date-of-birth
--      correction makes the participant 18 or over. For Stellr it writes nothing.
--
-- The app reads and writes the new table only with the flag on (event mail for
-- another tenant reads it either way). With the flag off the register routes
-- refuse every tenant-event minor, so the table stays empty unless another
-- writer saves one, who is then held from check-in and event mail.
--
-- Security: RLS on, no anon/authenticated access, explicit GRANTs to
-- service_role, no grant to tenant_app (lib/tenancy/tenant-role.ts
-- TENANT_APP_NO_ACCESS_TABLES). Both trigger functions are SECURITY DEFINER so
-- they see and write the row whatever role writes the participant, with a pinned
-- search_path and EXECUTE revoked from PUBLIC, anon and authenticated.
--
-- Locks: creating the table locks nothing live. The triggers take short locks on
-- participants; the CHECK holds agreements' ACCESS EXCLUSIVE lock for its scan
-- (2 above). lock_timeout makes a held lock fail fast instead of queueing live
-- writers behind it. Apply outside event hours.

SET LOCAL lock_timeout = '5s';

-- ── 1. The consent state ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenant_guardian_consents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
  registration_id  uuid NOT NULL REFERENCES public.registrations (id) ON DELETE CASCADE,
  participant_id   uuid NOT NULL UNIQUE REFERENCES public.participants (id) ON DELETE CASCADE,
  -- The consent envelope. Informative: the flow finds it by participant too.
  agreement_id     uuid REFERENCES public.agreements (id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'signed', 'declined', 'expired')),
  -- 14 days from the request, or the event's start, whichever is sooner.
  expires_at       timestamptz NOT NULL,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  settled_at       timestamptz,
  -- A declined or expired row waits here only until its registration is removed.
  removal_attempts integer NOT NULL DEFAULT 0 CHECK (removal_attempts >= 0),
  next_attempt_at  timestamptz,
  -- lib/tenancy/constants.ts STELLR_TENANT_ID.
  CONSTRAINT tenant_guardian_consents_not_stellr
    CHECK (tenant_id <> '00000000-0000-4000-8000-000000000001'::uuid),
  CONSTRAINT tenant_guardian_consents_settled
    CHECK ((status = 'pending') = (settled_at IS NULL))
);

CREATE INDEX IF NOT EXISTS tenant_guardian_consents_tenant_id_idx
  ON public.tenant_guardian_consents (tenant_id);
CREATE INDEX IF NOT EXISTS tenant_guardian_consents_registration_idx
  ON public.tenant_guardian_consents (registration_id);
CREATE INDEX IF NOT EXISTS tenant_guardian_consents_agreement_idx
  ON public.tenant_guardian_consents (agreement_id) WHERE agreement_id IS NOT NULL;
-- The daily sweep: pending rows past their window, and settled rows awaiting removal.
CREATE INDEX IF NOT EXISTS tenant_guardian_consents_pending_expiry_idx
  ON public.tenant_guardian_consents (expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS tenant_guardian_consents_removal_idx
  ON public.tenant_guardian_consents (next_attempt_at) WHERE status IN ('declined', 'expired');

ALTER TABLE public.tenant_guardian_consents ENABLE ROW LEVEL SECURITY;
-- service_role too, before its grant: Supabase's default ACL gives it ALL
-- (TRUNCATE included) on a new public table, as tenant_data_keys notes.
REVOKE ALL ON public.tenant_guardian_consents FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_guardian_consents TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access tenant_guardian_consents"
    ON public.tenant_guardian_consents FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.tenant_guardian_consents IS
  'Guardian consent for a 14-17-year-old on another organiser''s event (S5 wave 6, lib/registration/tenant-guardian-consent.ts). Holds no contact data. Written by service_role only.';

-- ── 2. The consent envelope's type ────────────────────────────────────────────

ALTER TABLE public.agreements
  DROP CONSTRAINT IF EXISTS docusign_envelopes_envelope_type_check;
ALTER TABLE public.agreements
  ADD CONSTRAINT docusign_envelopes_envelope_type_check
  CHECK (envelope_type IN ('minor', 'adult', 'mentor', 'volunteer', 'membership', 'tenant_guardian_consent'));

COMMENT ON COLUMN public.agreements.envelope_type IS
  'Agreement type: minor (parental consent), adult, mentor, volunteer, membership agreement, or tenant_guardian_consent (a guardian''s consent for another organiser''s event, S5 wave 6).';

-- ── 3. No check-in before consent ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.participants_refuse_unconsented_check_in()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tenant_guardian_consents c
    WHERE c.participant_id = NEW.id AND c.status <> 'signed'
  ) THEN
    -- The message is the reason alone: never a name or an event.
    RAISE EXCEPTION 'guardian_consent_pending' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.participants_refuse_unconsented_check_in() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zzz_participants_refuse_unconsented_check_in ON public.participants;
CREATE TRIGGER zzz_participants_refuse_unconsented_check_in
  BEFORE UPDATE OF checked_in_at ON public.participants
  FOR EACH ROW
  WHEN (NEW.checked_in_at IS NOT NULL AND OLD.checked_in_at IS NULL)
  EXECUTE FUNCTION public.participants_refuse_unconsented_check_in();

-- ── 4. A tenant event's minor is consent-pending from the moment it exists ────
-- The guards above, the event-mail filter and the sweep all key on a consent row.
-- So the row is written in the same statement as the participant, whichever writer
-- saved it: a participant under 18 (today or on the event day, as
-- lib/registration/eligibility.ts counts it) on another organiser's event always
-- has one. The register route then fills in its window and envelope; if it fails
-- part-way, the participant is still pending: never checked in, never mailed, and
-- removed by the sweep once the window closes. The same holds for any later writer
-- (a tenant session's insert, a date-of-birth correction, a move to another
-- registration, which starts a new consent: a consent is for one event).
--
-- The other way round: an UPDATE that leaves the participant 18 or over on a
-- tenant's event (a date-of-birth correction, or a move) removes a consent row
-- still 'pending', so the adult is no longer held from check-in, event mail or the
-- sweep. A signed row is left as it is. A declined or expired row is left too: the
-- guardian answered, or the window closed, before the correction, and the removal
-- already under way goes on. The sweep voids the consent envelope left open
-- (lib/registration/tenant-guardian-consent.ts voidOrphanedConsentEnvelopes).
--
-- An INSERT that already sets checked_in_at is refused here, as the trigger above
-- refuses the UPDATE.
--
-- For Stellr: one indexed join (registrations by primary key, events by unique
-- slug, tenants by primary key) per participant insert, or update that changes
-- date_of_birth or registration_id, and nothing written. A3's
-- zzz_participants_assert_eligible makes the same lookups on the same writes.
--
-- test/registration/tenant-guardian-consent-sql.test.ts holds the literals below
-- equal to their TypeScript constants.

CREATE OR REPLACE FUNCTION public.participants_open_tenant_guardian_consent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  -- lib/tenancy/constants.ts STELLR_TENANT_ID.
  stellr constant uuid := '00000000-0000-4000-8000-000000000001';
  -- lib/registration/eligibility.ts TENANT_MIN_AGE_WITHOUT_GUARDIAN_CONSENT.
  adult_age constant int := 18;
  -- lib/registration/tenant-guardian-consent.ts TENANT_GUARDIAN_CONSENT_WINDOW_DAYS.
  window_days constant int := 14;
  ev record;
  local_today date;
  event_day date;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.date_of_birth IS NOT DISTINCT FROM OLD.date_of_birth
     AND NEW.registration_id IS NOT DISTINCT FROM OLD.registration_id THEN
    RETURN NULL;
  END IF;
  -- A tenant event refuses a NULL date of birth (A3); Stellr's events keep theirs.
  IF NEW.date_of_birth IS NULL THEN
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
    IF TG_OP = 'UPDATE' THEN
      DELETE FROM public.tenant_guardian_consents c
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
        next_attempt_at  = NULL
    WHERE c.registration_id IS DISTINCT FROM EXCLUDED.registration_id;

  IF TG_OP = 'INSERT' AND NEW.checked_in_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenant_guardian_consents c
    WHERE c.participant_id = NEW.id AND c.status <> 'signed'
  ) THEN
    RAISE EXCEPTION 'guardian_consent_pending' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.participants_open_tenant_guardian_consent() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zzz_participants_open_tenant_guardian_consent ON public.participants;
CREATE TRIGGER zzz_participants_open_tenant_guardian_consent
  AFTER INSERT OR UPDATE OF date_of_birth, registration_id ON public.participants
  FOR EACH ROW EXECUTE FUNCTION public.participants_open_tenant_guardian_consent();
