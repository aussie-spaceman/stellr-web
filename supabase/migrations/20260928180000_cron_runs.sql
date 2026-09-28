-- cron_runs: one row per cron invocation that got past guardCron.
--
-- WHY (28 Sept 2026): the DocuSign reminder cron had not chased a single
-- envelope since it was rewritten on 4 Sept, and the form-data cron had never
-- stamped one — yet nothing could say whether Vercel was calling them at all or
-- whether they ran and failed per envelope (each failure is caught and logged).
-- Vercel Hobby keeps runtime logs for one hour, so the answer has to live in
-- the database. A missing row means the job was never invoked; a row with
-- errors means it ran and failed.

CREATE TABLE IF NOT EXISTS public.cron_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job          text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  ok           boolean,
  result       jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors       jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS cron_runs_job_started_idx ON public.cron_runs (job, started_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cron_runs TO service_role;
ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access cron_runs"
    ON public.cron_runs FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
