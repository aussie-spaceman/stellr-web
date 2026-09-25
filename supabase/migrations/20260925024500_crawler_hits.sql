-- AEO measurement: one row per page request from a known search or AI crawler on
-- the public site (AEO phase 1, 24 Sept 2026). Vercel Hobby keeps runtime logs
-- for about an hour, far too short for the monthly baseline the August AEO
-- close-out (item B3) called for, so proxy.ts records hits here instead.
--
-- No personal data: the bot's product name (from the user agent) and the path
-- only. No IP, no full user agent.
CREATE TABLE IF NOT EXISTS public.crawler_hits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seen_at timestamptz NOT NULL DEFAULT now(),
  bot text NOT NULL,
  path text NOT NULL
);

COMMENT ON TABLE public.crawler_hits IS
  'Page requests from named search/AI crawlers on www (lib/crawlers.ts). Read by scripts/aeo-crawler-report.ts.';

CREATE INDEX IF NOT EXISTS crawler_hits_seen_at_idx ON public.crawler_hits (seen_at);

-- Server-only: written by the proxy with the service role, never read by clients.
ALTER TABLE public.crawler_hits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crawler_hits FROM anon, authenticated;
GRANT SELECT, INSERT ON public.crawler_hits TO service_role;
