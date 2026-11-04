-- S1 "Monitoring and email" (multi-tenancy plan, Nov 2026).
--
-- Two service-role-only tables:
--
--   app_errors          server errors captured by instrumentation.ts
--                       (onRequestError), one row per distinct error (digest),
--                       counted. Read by the daily "Errors in the last day"
--                       email (lib/app-errors.ts). Vercel Hobby keeps runtime
--                       logs for an hour, so without this an error nobody was
--                       watching for leaves no trace.
--
--   email_suppressions  addresses sendEmail() must not mail (lib/email.ts):
--                       hard bounces and spam complaints recorded by the Resend
--                       webhook (app/api/webhooks/resend), plus unsubscribes and
--                       manual entries. One row per lower-cased address.
--
-- Both are written and read only by server code through supabaseServer(); no
-- anon/authenticated access, so nothing here is reachable from the browser.
-- Explicit GRANTs to service_role because a migration applied through the MCP
-- leaves new tables unreadable even to service_role otherwise.

-- ── app_errors ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_errors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- sha256 of the route + normalised message (lib/app-errors.ts), truncated.
  digest      text NOT NULL UNIQUE CHECK (char_length(digest) BETWEEN 8 AND 64),
  -- "<METHOD> <route pattern>", e.g. "POST /api/register/[slug]". The pattern,
  -- never the concrete path, so ids and query strings are not stored.
  route       text NOT NULL CHECK (char_length(route) <= 300),
  -- Truncated and scrubbed of emails, phone numbers and tokens before insert.
  message     text NOT NULL CHECK (char_length(message) <= 1000),
  count       bigint NOT NULL DEFAULT 1 CHECK (count >= 1),
  -- First time this digest was seen.
  occurred_at timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_errors_last_seen_idx ON public.app_errors (last_seen DESC);

COMMENT ON TABLE public.app_errors IS
  'Server errors captured by instrumentation.ts onRequestError, one row per digest, PII-scrubbed; emailed daily to staff (lib/app-errors.ts). S1 monitoring.';

ALTER TABLE public.app_errors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_errors FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_errors TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access app_errors"
    ON public.app_errors FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Record p_count occurrences of one error atomically: a single
-- INSERT … ON CONFLICT DO UPDATE, so concurrent serverless instances cannot
-- lose an increment. SECURITY INVOKER: only service_role calls it, and
-- service_role already holds the table grants above.
CREATE OR REPLACE FUNCTION public.record_app_error(
  p_digest text,
  p_route text,
  p_message text,
  p_count int DEFAULT 1
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  INSERT INTO public.app_errors (digest, route, message, count)
    VALUES (p_digest, left(p_route, 300), left(p_message, 1000), greatest(p_count, 1))
    ON CONFLICT (digest) DO UPDATE
      SET count = app_errors.count + greatest(p_count, 1),
          last_seen = now();
END $$;

REVOKE EXECUTE ON FUNCTION public.record_app_error(text, text, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_app_error(text, text, text, int) TO service_role;

-- ── email_suppressions ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_suppressions (
  email      text PRIMARY KEY CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 320),
  reason     text NOT NULL CHECK (reason IN ('bounce', 'complaint', 'unsubscribe', 'manual')),
  -- Where it came from, e.g. "resend:email.bounced" or "admin".
  source     text NOT NULL CHECK (char_length(source) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_suppressions IS
  'Addresses sendEmail() skips for non-critical mail: hard bounces and complaints from the Resend webhook, unsubscribes, manual entries. S1 email resilience.';

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_suppressions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_suppressions TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access email_suppressions"
    ON public.email_suppressions FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
