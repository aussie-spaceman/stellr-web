-- Migration 021: Community automation support.
--   * sent_reminders   — dedupe ledger so scheduled jobs don't re-notify
--   * session_credits  — purchased extra coaching/mentoring sessions (Stripe)
--   * members.graduation_year — drives the July-1 Alumni auto-upgrade
--
-- Conventions follow prior migrations: gen_random_uuid() PKs, service-role RLS.

-- ─── sent_reminders ────────────────────────────────────────────────────────
-- One row per (kind, ref, member, bucket) the moment a reminder is delivered, so
-- a daily/hourly cron is idempotent and resumable. bucket distinguishes e.g.
-- '7d' vs '1d' training warnings, or '24h' vs '1h' session reminders.
CREATE TABLE IF NOT EXISTS public.sent_reminders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL,            -- 'training' | 'session' | 'alumni' | 'training_escalation'
  ref_id     text NOT NULL,            -- assignment id, session id, member id, …
  member_id  uuid REFERENCES public.members(id) ON DELETE CASCADE,
  bucket     text NOT NULL DEFAULT '',
  sent_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, ref_id, member_id, bucket)
);

ALTER TABLE public.sent_reminders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access sent_reminders"
    ON public.sent_reminders FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── session_credits ───────────────────────────────────────────────────────
-- A purchased extra coaching/mentoring session (FR-COM-11/12: "sign up for
-- additional sessions … I will need to pay"). One credit = one bookable session.
-- Granted by the Stripe webhook on checkout completion; consumed at booking.
CREATE TABLE IF NOT EXISTS public.session_credits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  session_type  text NOT NULL CHECK (session_type IN ('coaching', 'mentoring')),
  status        text NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available', 'consumed')),
  consumed_session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  stripe_session_id   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  consumed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS session_credits_member_idx
  ON public.session_credits(member_id, session_type, status);

ALTER TABLE public.session_credits ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access session_credits"
    ON public.session_credits FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Atomically claim one available credit for a member+type, returning its id.
CREATE OR REPLACE FUNCTION public.consume_session_credit(
  p_member_id uuid,
  p_session_type text,
  p_session_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM public.session_credits
  WHERE member_id = p_member_id
    AND session_type = p_session_type
    AND status = 'available'
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.session_credits
  SET status = 'consumed', consumed_session_id = p_session_id, consumed_at = now()
  WHERE id = v_id;

  RETURN v_id;
END;
$$;

-- ─── members.graduation_year ───────────────────────────────────────────────
-- The Alumni tier "automatically upgrades on July 1st of the School Student's
-- graduating year". Captured at registration (future) and read by the
-- alumni-upgrades cron. Nullable; the cron only acts on populated rows.
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS graduation_year integer;
