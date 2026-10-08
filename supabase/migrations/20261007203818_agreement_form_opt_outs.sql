-- What the signer actually answered on each opt-out box (7 Oct 2026).
--
-- media_opt_out and its siblings are only ever set to true by a ticked box,
-- so false cannot tell "left unticked" from "never read". The admin Media
-- do-not-use list therefore showed every DocuSign-signed student as "check
-- the signed form". This column records the read itself: one key per box
-- found on the form, true = ticked ("I do NOT consent"), false = left
-- unticked. NULL = the form has not been read; {} = read, and no opt-out box
-- could be identified on it.
--
-- Keys: MediaOptOut, QuoteOptOut, DigitalCommsOptOut, CredentialSharingOptOut.

ALTER TABLE public.agreements
  ADD COLUMN IF NOT EXISTS form_opt_outs jsonb;

COMMENT ON COLUMN public.agreements.form_opt_outs IS
  'Opt-out boxes read off the signed form: {"MediaOptOut": true|false, ...}. true = ticked. NULL = not read; {} = read, no box identified.';
