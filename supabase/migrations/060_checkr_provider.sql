-- Migration 060: Switch background-check provider Certn → Checkr (PRD §13).
--
-- Stellr moved from Certn to Checkr. Checkr's object graph has three references
-- (candidate → invitation → report) rather than Certn's single application id,
-- so member_background_checks stores generic provider_*_ref columns plus the
-- hosted apply URL. The vendor-neutral `status` enum and the 3-year validity
-- (Stellr-enforced) are unchanged. 059 had no real check rows in prod, so the
-- Certn column is dropped rather than migrated.

ALTER TABLE public.member_background_checks
  DROP COLUMN IF EXISTS certn_application_id;

ALTER TABLE public.member_background_checks
  ADD COLUMN IF NOT EXISTS provider_candidate_ref  text,
  ADD COLUMN IF NOT EXISTS provider_invitation_ref text,
  ADD COLUMN IF NOT EXISTS provider_report_ref     text,
  ADD COLUMN IF NOT EXISTS invitation_url          text;

-- New default provider.
ALTER TABLE public.member_background_checks
  ALTER COLUMN provider SET DEFAULT 'checkr';

-- Webhook reconciliation: we match an inbound event to our row by the candidate
-- ref (always set at order time) or the report ref (set once a report exists).
DROP INDEX IF EXISTS public.member_background_checks_certn_idx;
CREATE INDEX IF NOT EXISTS member_background_checks_candidate_idx
  ON public.member_background_checks (provider_candidate_ref);
CREATE INDEX IF NOT EXISTS member_background_checks_report_idx
  ON public.member_background_checks (provider_report_ref);
