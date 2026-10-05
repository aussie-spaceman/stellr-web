-- Post-event survey (docs/PLAN-post-event-survey-2026-10-02.md).
--
-- Replaces the Google Forms survey. Every event gets a distribution that opens
-- at 00:00 event-local on the event's last day and closes 30 days later; each
-- invited person gets one invitation, one response, and once submitted, one
-- immutable row per answer. Question keys are stable across years so 2027 can
-- be compared with 2028 onward.
--
-- Immutability is enforced here, not only in the app:
--   * a published definition never changes (it is superseded by a new version);
--   * a submitted response's answers and consents never change;
--   * survey_answers rows are never updated or deleted except by the redaction
--     and purge functions, which write to audit_log.
--
-- Access: all reads and writes go through server routes with the service role.
-- Members may additionally SELECT their own submitted responses and answers
-- under RLS keyed on the Clerk JWT subject (defence in depth, migration 047's
-- pattern).

-- Which minors may be surveyed (V2.3 or later) is read from
-- agreements.agreement_version and the opt-out columns added by
-- 20261002235609_esign_agreements_v2_3.sql (lib/survey/consent.ts).

-- ── 1. Definitions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.survey_definitions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                text NOT NULL CHECK (key ~ '^[a-z0-9_]+$'),
  version            int NOT NULL CHECK (version > 0),
  title              text NOT NULL,
  definition         jsonb NOT NULL,
  definition_sha256  text NOT NULL,
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at       timestamptz,
  published_by       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, version),
  CHECK (status = 'draft' OR published_at IS NOT NULL)
);

COMMENT ON TABLE public.survey_definitions IS
  'Survey question sets, versioned. Immutable once published; wording changes publish a new version (lib/survey/definition.ts).';

CREATE OR REPLACE FUNCTION public.survey_definitions_freeze()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'survey_definitions: % v% is published and cannot be deleted', OLD.key, OLD.version;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (
       NEW.key               IS DISTINCT FROM OLD.key
    OR NEW.version           IS DISTINCT FROM OLD.version
    OR NEW.title             IS DISTINCT FROM OLD.title
    OR NEW.definition        IS DISTINCT FROM OLD.definition
    OR NEW.definition_sha256 IS DISTINCT FROM OLD.definition_sha256
    OR NEW.published_at      IS DISTINCT FROM OLD.published_at
    OR NEW.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'survey_definitions: % v% is published and cannot be changed', OLD.key, OLD.version;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS survey_definitions_freeze ON public.survey_definitions;
CREATE TRIGGER survey_definitions_freeze
  BEFORE UPDATE OR DELETE ON public.survey_definitions
  FOR EACH ROW EXECUTE FUNCTION public.survey_definitions_freeze();
REVOKE EXECUTE ON FUNCTION public.survey_definitions_freeze() FROM PUBLIC;

-- Cross-year dictionary: one row per answer key ever asked, for analysis.
CREATE TABLE IF NOT EXISTS public.survey_question_catalog (
  question_key   text PRIMARY KEY,
  label          text NOT NULL,
  type           text NOT NULL,
  options        jsonb,
  survey_key     text,
  first_version  int,
  last_version   int,
  source         text NOT NULL DEFAULT 'definition' CHECK (source IN ('definition', 'legacy_2024', 'legacy_2026')),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.survey_question_catalog IS
  'Every survey answer key with its latest wording, so answers can be compared across years. legacy_* keys come from the Google Forms imports and are never compared with app keys.';

-- ── 2. Distributions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.survey_distributions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id     uuid NOT NULL REFERENCES public.survey_definitions(id),
  event_slug        text NOT NULL,
  event_title       text,
  -- The event's last day as last read from Sanity, and the zone it is read in.
  event_date        date NOT NULL,
  event_time_zone   text NOT NULL,
  audiences         text[] NOT NULL DEFAULT ARRAY['student', 'mentor', 'adult']
                    CHECK (audiences <@ ARRAY['student', 'mentor', 'adult'] AND cardinality(audiences) > 0),
  opens_at          timestamptz NOT NULL,
  -- Always opens_at + 30 days (trigger below).
  closes_at         timestamptz NOT NULL,
  opens_at_source   text NOT NULL DEFAULT 'auto' CHECK (opens_at_source IN ('auto', 'manual')),
  opened_by         uuid REFERENCES public.members(id) ON DELETE SET NULL,
  opened_by_label   text,
  opens_at_set_at   timestamptz,
  status            text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'open', 'paused', 'closed')),
  -- Set when the event date changes under a manual go-live, or the event is cancelled.
  schedule_flag     text CHECK (schedule_flag IS NULL OR schedule_flag IN ('event_date_changed', 'event_cancelled')),
  opened_at         timestamptz,
  paused_at         timestamptz,
  closed_at         timestamptz,
  closed_by         text,
  -- D1: gate certificate download behind completion. Default off; not enforced in MVP.
  gate_certificate  boolean NOT NULL DEFAULT false,
  created_by        uuid REFERENCES public.members(id) ON DELETE SET NULL,
  last_run_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_slug, definition_id)
);

COMMENT ON TABLE public.survey_distributions IS
  'One survey per event: goes live 00:00 event-local on the last day (or earlier by an admin/event manager), closes 30 days after go-live.';

CREATE INDEX IF NOT EXISTS survey_distributions_status_idx ON public.survey_distributions (status, opens_at);
CREATE INDEX IF NOT EXISTS survey_distributions_slug_idx ON public.survey_distributions (event_slug);

CREATE OR REPLACE FUNCTION public.survey_distributions_close_date()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.closes_at := NEW.opens_at + interval '30 days';
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS survey_distributions_close_date ON public.survey_distributions;
CREATE TRIGGER survey_distributions_close_date
  BEFORE INSERT OR UPDATE ON public.survey_distributions
  FOR EACH ROW EXECUTE FUNCTION public.survey_distributions_close_date();
REVOKE EXECUTE ON FUNCTION public.survey_distributions_close_date() FROM PUBLIC;

-- ── 3. Invitations ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.survey_invitations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id         uuid NOT NULL REFERENCES public.survey_distributions(id) ON DELETE CASCADE,
  -- member:<uuid> or email:<lower-cased address>; one invitation per person.
  recipient_key           text NOT NULL,
  participant_id          uuid REFERENCES public.participants(id) ON DELETE CASCADE,
  member_id               uuid REFERENCES public.members(id) ON DELETE CASCADE,
  respondent_role         text NOT NULL CHECK (respondent_role IN ('student', 'mentor', 'adult')),
  adult_relationship      text CHECK (adult_relationship IS NULL OR adult_relationship IN ('parent', 'teacher')),
  first_name              text,
  is_minor                boolean NOT NULL DEFAULT false,
  -- The address actually used, and whether it is the person's own or a guardian's.
  email                   text NOT NULL,
  send_via                text NOT NULL DEFAULT 'self' CHECK (send_via IN ('self', 'guardian')),
  token_hash              text NOT NULL UNIQUE,
  token_version           int NOT NULL DEFAULT 1,
  status                  text NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'sent', 'opened', 'started', 'submitted', 'opted_out', 'bounced', 'expired')),
  sent_at                 timestamptz,
  send_attempts           int NOT NULL DEFAULT 0,
  last_send_error         text,
  first_opened_at         timestamptz,
  last_activity_at        timestamptz,
  opened_from             text CHECK (opened_from IS NULL OR opened_from IN ('email', 'dashboard', 'qr')),
  reminder_count          int NOT NULL DEFAULT 0 CHECK (reminder_count BETWEEN 0 AND 3),
  resume_reminder_count   int NOT NULL DEFAULT 0 CHECK (resume_reminder_count BETWEEN 0 AND 2),
  last_reminder_at        timestamptz,
  reminders_opted_out_at  timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (distribution_id, recipient_key)
);

COMMENT ON TABLE public.survey_invitations IS
  'One per person per distribution. The link token is never stored, only its SHA-256 (lib/survey/tokens.ts).';

CREATE INDEX IF NOT EXISTS survey_invitations_status_idx ON public.survey_invitations (distribution_id, status);
CREATE INDEX IF NOT EXISTS survey_invitations_member_idx ON public.survey_invitations (member_id) WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS survey_invitations_participant_idx ON public.survey_invitations (participant_id) WHERE participant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS survey_invitations_email_idx ON public.survey_invitations (lower(email));

DO $$ BEGIN
  CREATE TRIGGER survey_invitations_updated_at BEFORE UPDATE ON public.survey_invitations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4. Responses ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.survey_responses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id        uuid UNIQUE REFERENCES public.survey_invitations(id) ON DELETE CASCADE,
  definition_id        uuid NOT NULL REFERENCES public.survey_definitions(id),
  distribution_id      uuid REFERENCES public.survey_distributions(id) ON DELETE CASCADE,
  event_slug           text,
  event_year           int,
  participant_id       uuid REFERENCES public.participants(id) ON DELETE CASCADE,
  member_id            uuid REFERENCES public.members(id) ON DELETE CASCADE,
  respondent_role      text CHECK (respondent_role IS NULL OR respondent_role IN ('student', 'mentor', 'adult')),
  -- Facts the branching used (first_time, which profile fields were missing,
  -- quote eligibility by agreement), captured when the response began.
  context              jsonb NOT NULL DEFAULT '{}'::jsonb,
  draft_answers        jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_page         text,
  started_at           timestamptz,
  last_saved_at        timestamptz,
  submitted_at         timestamptz,
  submitted_from       text CHECK (submitted_from IS NULL OR submitted_from IN ('email', 'dashboard', 'qr')),
  is_minor_at_submit   boolean,
  quote_consent        text CHECK (quote_consent IS NULL OR quote_consent IN ('named', 'anonymous', 'no')),
  no_quote             boolean,
  followup_consent     boolean,
  quote_withdrawn_at   timestamptz,
  quote_withdrawn_by   text,
  source               text NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'legacy_import')),
  legacy_ref           text UNIQUE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (source = 'legacy_import' OR invitation_id IS NOT NULL)
);

COMMENT ON TABLE public.survey_responses IS
  'One per invitation (or per legacy sheet row). Answers and consents are frozen once submitted_at is set.';

CREATE INDEX IF NOT EXISTS survey_responses_member_idx ON public.survey_responses (member_id) WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS survey_responses_participant_idx ON public.survey_responses (participant_id) WHERE participant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS survey_responses_event_idx ON public.survey_responses (event_slug, event_year);

CREATE OR REPLACE FUNCTION public.survey_responses_freeze()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.submitted_at IS NOT NULL AND (
       NEW.submitted_at        IS DISTINCT FROM OLD.submitted_at
    OR NEW.draft_answers       IS DISTINCT FROM OLD.draft_answers
    OR NEW.context             IS DISTINCT FROM OLD.context
    OR NEW.definition_id       IS DISTINCT FROM OLD.definition_id
    OR NEW.invitation_id       IS DISTINCT FROM OLD.invitation_id
    OR NEW.respondent_role     IS DISTINCT FROM OLD.respondent_role
    OR NEW.is_minor_at_submit  IS DISTINCT FROM OLD.is_minor_at_submit
    OR NEW.quote_consent       IS DISTINCT FROM OLD.quote_consent
    OR NEW.no_quote            IS DISTINCT FROM OLD.no_quote
    OR NEW.followup_consent    IS DISTINCT FROM OLD.followup_consent
    OR NEW.event_slug          IS DISTINCT FROM OLD.event_slug
    OR NEW.event_year          IS DISTINCT FROM OLD.event_year
  ) THEN
    RAISE EXCEPTION 'survey_responses: response % is submitted and cannot be changed', OLD.id;
  END IF;
  -- Once withdrawn, a quote stays withdrawn.
  IF OLD.quote_withdrawn_at IS NOT NULL AND NEW.quote_withdrawn_at IS DISTINCT FROM OLD.quote_withdrawn_at THEN
    RAISE EXCEPTION 'survey_responses: a withdrawn quote cannot be reinstated';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS survey_responses_freeze ON public.survey_responses;
CREATE TRIGGER survey_responses_freeze
  BEFORE UPDATE ON public.survey_responses
  FOR EACH ROW EXECUTE FUNCTION public.survey_responses_freeze();
REVOKE EXECUTE ON FUNCTION public.survey_responses_freeze() FROM PUBLIC;

-- A deleted submitted response leaves a content-free trace in audit_log.
-- Nothing of the answers is kept (deletion requests: §14.3, no de-identified copy).
CREATE OR REPLACE FUNCTION public.survey_responses_audit_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.submitted_at IS NOT NULL THEN
    INSERT INTO public.audit_log (table_name, record_id, action, changed_by, old_data, new_data)
    VALUES ('survey_responses', OLD.id, 'DELETE',
            coalesce(nullif(current_setting('stellr.survey_actor', true), ''), current_user),
            jsonb_build_object('event_slug', OLD.event_slug, 'event_year', OLD.event_year,
                               'respondent_role', OLD.respondent_role, 'source', OLD.source),
            NULL);
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS survey_responses_audit_delete ON public.survey_responses;
CREATE TRIGGER survey_responses_audit_delete
  AFTER DELETE ON public.survey_responses
  FOR EACH ROW EXECUTE FUNCTION public.survey_responses_audit_delete();
REVOKE EXECUTE ON FUNCTION public.survey_responses_audit_delete() FROM PUBLIC;

-- ── 5. Answers ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.survey_answers (
  response_id    uuid NOT NULL REFERENCES public.survey_responses(id) ON DELETE CASCADE,
  question_key   text NOT NULL,
  value_text     text,
  value_numeric  numeric,
  value_options  text[],
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (response_id, question_key)
);

COMMENT ON TABLE public.survey_answers IS
  'Written once at submit from draft_answers. No UPDATE or DELETE except survey_redact_answer() and survey_purge_person(), or as the cascade of deleting the response.';

CREATE INDEX IF NOT EXISTS survey_answers_key_idx ON public.survey_answers (question_key);

CREATE OR REPLACE FUNCTION public.survey_answers_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('stellr.survey_redaction', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- Deleting the response cascades here; by then the parent row is gone.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.survey_responses r WHERE r.id = OLD.response_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'survey_answers are immutable (use survey_redact_answer for privacy requests)';
END $$;

DROP TRIGGER IF EXISTS survey_answers_immutable ON public.survey_answers;
CREATE TRIGGER survey_answers_immutable
  BEFORE UPDATE OR DELETE ON public.survey_answers
  FOR EACH ROW EXECUTE FUNCTION public.survey_answers_immutable();
REVOKE EXECUTE ON FUNCTION public.survey_answers_immutable() FROM PUBLIC;

-- Answers may only be inserted for a response that is being, or has just been,
-- submitted — never into an unsubmitted draft, never after the fact.
CREATE OR REPLACE FUNCTION public.survey_answers_insert_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  SELECT submitted_at, source INTO r FROM public.survey_responses WHERE id = NEW.response_id;
  IF r.source = 'legacy_import' THEN RETURN NEW; END IF;
  IF r.submitted_at IS NULL OR r.submitted_at < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'survey_answers: response % is not being submitted', NEW.response_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS survey_answers_insert_guard ON public.survey_answers;
CREATE TRIGGER survey_answers_insert_guard
  BEFORE INSERT ON public.survey_answers
  FOR EACH ROW EXECUTE FUNCTION public.survey_answers_insert_guard();
REVOKE EXECUTE ON FUNCTION public.survey_answers_insert_guard() FROM PUBLIC;

-- Submit in one transaction: freeze the response, write answers, mark the invitation.
CREATE OR REPLACE FUNCTION public.survey_submit_response(
  p_response_id uuid,
  p_answers jsonb,          -- [{question_key, value_text, value_numeric, value_options}]
  p_is_minor boolean,
  p_quote_consent text,
  p_no_quote boolean,
  p_followup_consent boolean,
  p_submitted_from text
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv uuid;
  v_at timestamptz := now();
BEGIN
  UPDATE public.survey_responses
     SET submitted_at = v_at, last_saved_at = v_at, is_minor_at_submit = p_is_minor,
         quote_consent = p_quote_consent, no_quote = p_no_quote,
         followup_consent = p_followup_consent, submitted_from = p_submitted_from
   WHERE id = p_response_id AND submitted_at IS NULL
  RETURNING invitation_id INTO v_inv;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'survey_submit_response: % is already submitted or missing', p_response_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.survey_answers (response_id, question_key, value_text, value_numeric, value_options)
  SELECT p_response_id, a->>'question_key', a->>'value_text', (a->>'value_numeric')::numeric,
         CASE WHEN jsonb_typeof(a->'value_options') = 'array'
              THEN ARRAY(SELECT jsonb_array_elements_text(a->'value_options')) END
    FROM jsonb_array_elements(p_answers) a;

  UPDATE public.survey_invitations
     SET status = 'submitted', last_activity_at = v_at
   WHERE id = v_inv;
  RETURN v_at;
END $$;
REVOKE EXECUTE ON FUNCTION public.survey_submit_response(uuid, jsonb, boolean, text, boolean, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.survey_submit_response(uuid, jsonb, boolean, text, boolean, boolean, text) TO service_role;

-- Privacy: blank one answer (e.g. a name volunteered in free text).
CREATE OR REPLACE FUNCTION public.survey_redact_answer(
  p_response_id uuid, p_question_key text, p_actor text, p_reason text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('stellr.survey_redaction', 'on', true);
  UPDATE public.survey_answers
     SET value_text = CASE WHEN value_text IS NULL THEN NULL ELSE '[redacted]' END,
         value_numeric = NULL, value_options = NULL
   WHERE response_id = p_response_id AND question_key = p_question_key;
  IF NOT FOUND THEN
    PERFORM set_config('stellr.survey_redaction', 'off', true);
    RETURN false;
  END IF;
  INSERT INTO public.audit_log (table_name, record_id, action, changed_by, old_data, new_data)
  VALUES ('survey_answers', p_response_id, 'UPDATE', p_actor, NULL,
          jsonb_build_object('redacted', p_question_key, 'reason', p_reason));
  PERFORM set_config('stellr.survey_redaction', 'off', true);
  RETURN true;
END $$;
REVOKE EXECUTE ON FUNCTION public.survey_redact_answer(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.survey_redact_answer(uuid, text, text, text) TO service_role;

-- Privacy: delete everything survey-related for a person (deletion requests,
-- hard delete). Matches on member, participant rows and email addresses.
CREATE OR REPLACE FUNCTION public.survey_purge_person(
  p_member_id uuid, p_participant_ids uuid[], p_emails text[], p_actor text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emails text[] := ARRAY(SELECT lower(e) FROM unnest(coalesce(p_emails, '{}')) e WHERE e IS NOT NULL AND e <> '');
  v_responses int;
  v_invitations int;
BEGIN
  PERFORM set_config('stellr.survey_redaction', 'on', true);
  PERFORM set_config('stellr.survey_actor', coalesce(p_actor, ''), true);

  WITH inv AS (
    SELECT id FROM public.survey_invitations
     WHERE (p_member_id IS NOT NULL AND member_id = p_member_id)
        OR participant_id = ANY (coalesce(p_participant_ids, '{}'))
        OR (send_via = 'self' AND lower(email) = ANY (v_emails))
  ), del AS (
    DELETE FROM public.survey_responses r
     WHERE r.invitation_id IN (SELECT id FROM inv)
        OR (p_member_id IS NOT NULL AND r.member_id = p_member_id)
        OR r.participant_id = ANY (coalesce(p_participant_ids, '{}'))
    RETURNING 1
  )
  SELECT count(*) INTO v_responses FROM del;

  WITH del AS (
    DELETE FROM public.survey_invitations
     WHERE (p_member_id IS NOT NULL AND member_id = p_member_id)
        OR participant_id = ANY (coalesce(p_participant_ids, '{}'))
        OR (send_via = 'self' AND lower(email) = ANY (v_emails))
    RETURNING 1
  )
  SELECT count(*) INTO v_invitations FROM del;

  IF p_member_id IS NOT NULL THEN
    DELETE FROM public.member_privacy_prefs WHERE member_id = p_member_id;
  END IF;

  INSERT INTO public.audit_log (table_name, record_id, action, changed_by, old_data, new_data)
  VALUES ('survey_purge', coalesce(p_member_id, gen_random_uuid()), 'DELETE', p_actor, NULL,
          jsonb_build_object('responses', v_responses, 'invitations', v_invitations,
                             'participants', coalesce(array_length(p_participant_ids, 1), 0)));

  PERFORM set_config('stellr.survey_redaction', 'off', true);
  RETURN jsonb_build_object('responses', v_responses, 'invitations', v_invitations);
END $$;

-- ── 6. Member privacy preferences (V2.3 §1.7) ────────────────────────────────
-- NULL means "the default for this person": quoting on, except off for 13–17
-- year-olds in NY or CO until they turn it on (lib/survey/consent.ts).
CREATE TABLE IF NOT EXISTS public.member_privacy_prefs (
  member_id    uuid PRIMARY KEY REFERENCES public.members(id) ON DELETE CASCADE,
  allow_quotes boolean,
  allow_media  boolean,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.member_privacy_prefs IS
  'Student-controlled quote and photo/media permissions (Minors Agreement V2.3 §1.7). NULL = default for the member''s age and state. A parent''s opt-out on the agreement overrides either.';

DO $$ BEGIN
  CREATE TRIGGER member_privacy_prefs_updated_at BEFORE UPDATE ON public.member_privacy_prefs
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

REVOKE EXECUTE ON FUNCTION public.survey_purge_person(uuid, uuid[], text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.survey_purge_person(uuid, uuid[], text[], text) TO service_role;

-- ── 7. Send budget and access log ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.survey_email_budget (
  day  date PRIMARY KEY,
  sent int NOT NULL DEFAULT 0 CHECK (sent >= 0)
);

COMMENT ON TABLE public.survey_email_budget IS
  'Survey emails sent per UTC day, capped (SURVEY_DAILY_EMAIL_BUDGET) under Resend Free''s 100/day beside esign_email_budget.';

CREATE OR REPLACE FUNCTION public.survey_claim_email(p_day date, p_limit int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  claimed boolean;
BEGIN
  INSERT INTO public.survey_email_budget (day, sent) VALUES (p_day, 0) ON CONFLICT (day) DO NOTHING;
  UPDATE public.survey_email_budget SET sent = sent + 1
   WHERE day = p_day AND sent < p_limit
  RETURNING true INTO claimed;
  RETURN coalesce(claimed, false);
END $$;
REVOKE EXECUTE ON FUNCTION public.survey_claim_email(date, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.survey_claim_email(date, int) TO service_role;

-- FERPA: who looked at or exported person-linked survey responses.
CREATE TABLE IF NOT EXISTS public.survey_access_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at               timestamptz NOT NULL DEFAULT now(),
  actor            text NOT NULL,
  action           text NOT NULL CHECK (action IN ('view', 'export', 'testimonial_export')),
  event_slug       text,
  distribution_id  uuid,
  response_id      uuid,
  row_count        int,
  detail           jsonb
);

COMMENT ON TABLE public.survey_access_log IS
  'Append-only record of staff viewing or exporting person-linked survey responses (FERPA access logging).';

CREATE INDEX IF NOT EXISTS survey_access_log_at_idx ON public.survey_access_log (at DESC);

CREATE OR REPLACE FUNCTION public.survey_access_log_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'survey_access_log is append-only';
END $$;
DROP TRIGGER IF EXISTS survey_access_log_append_only ON public.survey_access_log;
CREATE TRIGGER survey_access_log_append_only
  BEFORE UPDATE OR DELETE ON public.survey_access_log
  FOR EACH ROW EXECUTE FUNCTION public.survey_access_log_append_only();
REVOKE EXECUTE ON FUNCTION public.survey_access_log_append_only() FROM PUBLIC;

-- ── 8. Analysis view (admin only) ────────────────────────────────────────────
-- One row per answer, joined to event, year, role, school and demographics.
CREATE OR REPLACE VIEW public.survey_answers_long
WITH (security_invoker = true) AS
SELECT
  a.response_id,
  a.question_key,
  a.value_text,
  a.value_numeric,
  a.value_options,
  r.event_slug,
  r.event_year,
  r.respondent_role,
  r.source,
  r.submitted_at,
  r.submitted_from,
  r.is_minor_at_submit,
  r.context->>'adult_relationship' AS adult_relationship,
  (r.context->>'first_time')::boolean AS first_time,
  d.key AS survey_key,
  d.version AS survey_version,
  r.participant_id,
  r.member_id,
  coalesce(m.gender::text, p.gender) AS profile_gender,
  coalesce(m.grade::text, p.grade) AS profile_grade,
  coalesce(s.name, p.school_name) AS school_name,
  s.state AS school_state,
  s.id AS school_id,
  p.ethnicity AS participant_ethnicity
FROM public.survey_answers a
JOIN public.survey_responses r ON r.id = a.response_id
JOIN public.survey_definitions d ON d.id = r.definition_id
LEFT JOIN public.members m ON m.id = r.member_id
LEFT JOIN public.participants p ON p.id = r.participant_id
LEFT JOIN LATERAL (
  SELECT sc.id, sc.name, sc.state
    FROM public.member_schools ms JOIN public.schools sc ON sc.id = ms.school_id
   WHERE ms.member_id = r.member_id
   ORDER BY ms.is_current DESC NULLS LAST, ms.created_at DESC
   LIMIT 1
) s ON true
WHERE r.submitted_at IS NOT NULL;

COMMENT ON VIEW public.survey_answers_long IS
  'Long-format survey answers for analysis. Admin only (service role).';

-- ── 9. Activity-log category ─────────────────────────────────────────────────
ALTER TABLE public.member_activity_log
  DROP CONSTRAINT IF EXISTS member_activity_log_category_check;
ALTER TABLE public.member_activity_log
  ADD CONSTRAINT member_activity_log_category_check
  CHECK (category IN ('membership', 'profile', 'account', 'event',
                      'billing', 'docusign', 'community', 'school', 'compliance', 'survey'));

-- ── 10. Access control ───────────────────────────────────────────────────────
-- Resolve the signed-in member from the Clerk JWT for RLS (definer, so the
-- policy does not need SELECT on members).
CREATE OR REPLACE FUNCTION public.survey_current_member_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.members WHERE clerk_user_id = (auth.jwt() ->> 'sub') LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.survey_current_member_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.survey_current_member_id() TO authenticated, service_role;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['survey_definitions', 'survey_question_catalog', 'survey_distributions',
                           'survey_invitations', 'survey_responses', 'survey_answers',
                           'member_privacy_prefs', 'survey_email_budget', 'survey_access_log']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
    BEGIN
      EXECUTE format('CREATE POLICY "service role full access %s" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t, t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

-- The access log is append-only for the service role too (trigger above).
REVOKE UPDATE, DELETE ON public.survey_access_log FROM service_role;

-- Members read their own submitted responses and answers (P3).
GRANT SELECT ON public.survey_responses, public.survey_answers TO authenticated;
DO $$ BEGIN
  CREATE POLICY "members read own submitted survey responses" ON public.survey_responses
    FOR SELECT TO authenticated
    USING (submitted_at IS NOT NULL AND member_id IS NOT NULL AND member_id = public.survey_current_member_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "members read own survey answers" ON public.survey_answers
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.survey_responses r WHERE r.id = response_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

REVOKE ALL ON public.survey_answers_long FROM anon, authenticated;
GRANT SELECT ON public.survey_answers_long TO service_role;
