-- Participation Agreements V2.3 (2 Oct 2026).
--
-- 1. Which version of the agreement a row was signed on. A minor's agreement
--    now lasts until the student is no longer a Minor, with families asked to
--    sign again only when the agreement changes, so reuse turns on the version
--    rather than a 3-year date. Rows from before this column are an older
--    version (NULL).
-- 2. The media, quote and digital-communications opt-outs, read back from the
--    signed form like credential_sharing_opt_out. A ticked box sets one; an
--    unticked box never clears one.
-- 3. Retention: signed records are kept for the life of the membership and 7
--    years after the account is deactivated (previously 7 years from signing).
--    retain_until is NULL while the linked account is open; the app sets it on
--    deactivation, on a deletion request, and at signing for records with no
--    account.

ALTER TABLE public.agreements
  ADD COLUMN IF NOT EXISTS agreement_version text,
  ADD COLUMN IF NOT EXISTS media_opt_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quote_opt_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS digital_comms_opt_out boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.agreements.agreement_version IS
  'Version of the agreement document signed (e.g. 2.3). NULL = signed before versions were recorded.';
COMMENT ON COLUMN public.agreements.media_opt_out IS
  'Signer ticked "I DO NOT consent" to photo and media use on the form.';
COMMENT ON COLUMN public.agreements.quote_opt_out IS
  'Guardian ticked "I DO NOT consent" to survey responses being quoted (Student / Minor agreement).';
COMMENT ON COLUMN public.agreements.digital_comms_opt_out IS
  'Guardian ticked "I DO NOT consent" to direct digital communications with the student.';

-- Retention, recomputed under the new rule. Signed originals only: coverage
-- rows hold no document and go with the row they point at.

-- Linked to an open account, not restricted: no end date yet.
UPDATE public.agreements a
   SET retain_until = NULL
  FROM public.members m
 WHERE a.member_id = m.id
   AND m.is_active
   AND a.status = 'completed'
   AND a.restricted_at IS NULL
   AND a.reused_from IS NULL;

-- Linked to a deactivated account: 7 years from deactivation, never earlier
-- than the date already recorded.
UPDATE public.agreements a
   SET retain_until = GREATEST(
         COALESCE(a.retain_until, '-infinity'::timestamptz),
         COALESCE(m.deleted_at, a.completed_at) + interval '7 years')
  FROM public.members m
 WHERE a.member_id = m.id
   AND NOT m.is_active
   AND a.status = 'completed'
   AND a.reused_from IS NULL;

-- Restricted after a deletion: 7 years from the restriction.
UPDATE public.agreements
   SET retain_until = GREATEST(
         COALESCE(retain_until, '-infinity'::timestamptz),
         restricted_at + interval '7 years')
 WHERE restricted_at IS NOT NULL
   AND status = 'completed'
   AND reused_from IS NULL;

-- No account: 7 years from signing.
UPDATE public.agreements
   SET retain_until = completed_at + interval '7 years'
 WHERE member_id IS NULL
   AND restricted_at IS NULL
   AND retain_until IS NULL
   AND status = 'completed'
   AND reused_from IS NULL
   AND completed_at IS NOT NULL;
