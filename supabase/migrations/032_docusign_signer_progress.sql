-- Migration 032: DocuSign per-signer progress
-- The event-manager roster shows a DocuSign pill with a "partially complete"
-- state (one of two signers done). Envelope-level status can't express that,
-- so track signer counts on the envelope row:
--   signers_total     — how many signers the envelope was issued with
--                       (guardian [+ minor], mentor [+ Stellr rep], adult = 1)
--   signers_completed — kept current by the DocuSign Connect webhook on
--                       recipient-completed events (requires "Recipient
--                       Completed" to be enabled in the Connect configuration).
-- Existing in-flight envelopes default to 1/0; the webhook recount corrects
-- both columns from the DocuSign recipients API as signing events arrive.

ALTER TABLE public.docusign_envelopes
  ADD COLUMN IF NOT EXISTS signers_total     int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS signers_completed int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.docusign_envelopes.signers_total IS
  'Number of signers the envelope was issued with. Coverage rows (reused_from set) are 1.';
COMMENT ON COLUMN public.docusign_envelopes.signers_completed IS
  'Signers who have completed, maintained by the DocuSign Connect webhook (recipient-completed events).';

-- Completed envelopes (including on-file coverage rows) are fully signed.
UPDATE public.docusign_envelopes
SET signers_completed = signers_total
WHERE status = 'completed';
