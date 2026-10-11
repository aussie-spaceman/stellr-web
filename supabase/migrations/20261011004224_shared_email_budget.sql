-- Shared daily Resend send budget (deep review INT-2 / PUB-4, 10 Oct 2026).
--
-- Resend's Free plan allows 100 emails per DAY, shared by every sender Stellr
-- has. lib/rate-limit.ts is per-warm-serverless-instance, so it cannot enforce
-- a cap shared across instances; the per-feature budgets (esign 60/day,
-- survey 30/day) each guard only their own channel. This table is the ONE
-- global, durable, cross-instance counter: lib/email.ts increments it on every
-- successful Resend send, keyed by UTC day, and marketing/bulk mail is refused
-- once the day's non-reserved budget is spent (lib/email-budget.ts). That keeps
-- a burst of campaign or event mail from starving a minor's consent /
-- credential / registration / safeguarding email of the day's last sends.
--
-- Plain table, service-role only: every read and write goes through the app's
-- server code (supabaseServer()). No anon/authenticated access, so nothing is
-- reachable from the browser bundle.

CREATE TABLE IF NOT EXISTS public.email_send_quota (
  day  date PRIMARY KEY,
  sent int NOT NULL DEFAULT 0 CHECK (sent >= 0)
);

COMMENT ON TABLE public.email_send_quota IS
  'Every Resend email Stellr sends, counted per UTC day, so marketing/bulk mail is held back once the day''s non-reserved budget is spent (deep review INT-2/PUB-4).';

ALTER TABLE public.email_send_quota ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_send_quota FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.email_send_quota TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access email_send_quota"
    ON public.email_send_quota FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Atomically count one actually-sent email against today's shared budget and
-- return the new running total. INSERT … ON CONFLICT DO UPDATE is a single
-- statement, so concurrent serverless instances cannot lose an increment.
CREATE OR REPLACE FUNCTION public.bump_email_quota(p_day date)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v int;
BEGIN
  INSERT INTO public.email_send_quota (day, sent) VALUES (p_day, 1)
    ON CONFLICT (day) DO UPDATE SET sent = email_send_quota.sent + 1
  RETURNING sent INTO v;
  RETURN v;
END $$;

-- SECURITY DEFINER bypasses RLS and Supabase grants EXECUTE to anon +
-- authenticated by default, so lock it to the server (deep review DB-N3 /
-- lint:migrations). A FROM PUBLIC revoke is deliberately NOT enough here.
REVOKE EXECUTE ON FUNCTION public.bump_email_quota(date) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_email_quota(date) TO service_role;
