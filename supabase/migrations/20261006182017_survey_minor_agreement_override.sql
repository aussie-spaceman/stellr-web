-- Post-event survey: per-event acceptance of minor agreements signed before V2.3.
--
-- Minors are surveyed only under Participation Agreement – Minors V2.3 or later
-- (lib/survey/consent.ts). Events whose agreements were all signed earlier
-- (Colorado SDC, Oct 2026: DocuSign, 9 Sept–2 Oct) would survey no students.
-- David decided on 6 Oct 2026 that an admin may accept those earlier agreements
-- for one event. It widens who is INVITED only: quoting still needs V2.3, so
-- those answers are never quotable. Set and cleared by an admin on the event's
-- Survey tab; every change is also written to audit_log.

ALTER TABLE public.survey_distributions
  ADD COLUMN IF NOT EXISTS minor_agreement_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS minor_agreement_override_set_by text,
  ADD COLUMN IF NOT EXISTS minor_agreement_override_set_at timestamptz;

COMMENT ON COLUMN public.survey_distributions.minor_agreement_override IS
  'Admin decision: invite minors whose valid agreement predates V2.3. Never makes their answers quotable.';
