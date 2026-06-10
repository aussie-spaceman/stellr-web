-- Migration 015: Adult & Mentor participation agreements
-- Extends docusign_envelopes (previously minor-consent-only) to also track the
-- self-signed Adult and Mentor participation agreements. The signer is the
-- participant themselves, so minor_name holds their own name for those types.

ALTER TABLE public.docusign_envelopes
  ADD COLUMN IF NOT EXISTS envelope_type text NOT NULL DEFAULT 'minor'
    CHECK (envelope_type IN ('minor', 'adult', 'mentor'));

COMMENT ON COLUMN public.docusign_envelopes.envelope_type IS
  'Agreement type: minor (parental consent), adult, or mentor participation agreement.';
COMMENT ON COLUMN public.docusign_envelopes.minor_name IS
  'Subject name. For minor consent this is the minor; for adult/mentor it is the signer themselves.';

CREATE INDEX IF NOT EXISTS docusign_envelopes_type_idx ON public.docusign_envelopes (envelope_type);
