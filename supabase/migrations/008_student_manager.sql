-- Migration 006: School Student Manager role + group registration enhancements

-- ── registrations: new columns ─────────────────────────────────────────────

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS registrant_role      text NOT NULL DEFAULT 'teacher',
  ADD COLUMN IF NOT EXISTS teacher_poc_first_name text,
  ADD COLUMN IF NOT EXISTS teacher_poc_last_name  text,
  ADD COLUMN IF NOT EXISTS teacher_poc_email      text,
  ADD COLUMN IF NOT EXISTS member_pays_individually boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS details_method        text NOT NULL DEFAULT 'add_now';

ALTER TABLE public.registrations
  DROP CONSTRAINT IF EXISTS registrations_registrant_role_check,
  ADD CONSTRAINT registrations_registrant_role_check
    CHECK (registrant_role IN ('teacher', 'student_manager'));

ALTER TABLE public.registrations
  DROP CONSTRAINT IF EXISTS registrations_details_method_check,
  ADD CONSTRAINT registrations_details_method_check
    CHECK (details_method IN ('add_now', 'spreadsheet', 'email_link'));

-- ── participants: individual payment status + join tracking ─────────────────

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS individual_payment_status text,
  ADD COLUMN IF NOT EXISTS join_completed_at         timestamptz;

ALTER TABLE public.participants
  DROP CONSTRAINT IF EXISTS participants_individual_payment_status_check,
  ADD CONSTRAINT participants_individual_payment_status_check
    CHECK (individual_payment_status IN ('pending', 'paid') OR individual_payment_status IS NULL);

-- ── group_join_tokens ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_join_tokens (
  id              uuid    PRIMARY KEY DEFAULT uuid_generate_v4(),
  token           text    NOT NULL UNIQUE,
  registration_id uuid    NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  event_slug      text    NOT NULL,
  event_title     text    NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS group_join_tokens_token_idx
  ON public.group_join_tokens(token);
CREATE INDEX IF NOT EXISTS group_join_tokens_registration_idx
  ON public.group_join_tokens(registration_id);

ALTER TABLE public.group_join_tokens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access group_join_tokens"
    ON public.group_join_tokens FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
