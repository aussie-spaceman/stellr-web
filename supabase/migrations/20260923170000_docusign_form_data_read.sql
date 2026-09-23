-- Credential-sharing opt-out read-back (FOLLOW-ON-docusign-minor-credential-optout).
-- form_data_read_at is stamped whenever the completed minor envelope's form data
-- has been read (checkbox present or not), so the docusign-form-data cron only
-- retries envelopes whose read failed or whose completion webhook never arrived.
ALTER TABLE public.docusign_envelopes
  ADD COLUMN IF NOT EXISTS form_data_read_at timestamptz;

COMMENT ON COLUMN public.docusign_envelopes.form_data_read_at IS
  'When the envelope form_data was read for the CredentialSharingOptOut checkbox. NULL on a completed minor envelope = not yet read (cron retries within 7 days).';

CREATE INDEX IF NOT EXISTS docusign_envelopes_form_data_unread_idx
  ON public.docusign_envelopes (completed_at)
  WHERE envelope_type = 'minor' AND status = 'completed' AND form_data_read_at IS NULL AND reused_from IS NULL;
