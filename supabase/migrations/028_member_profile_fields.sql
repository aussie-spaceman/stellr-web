-- Migration 028: Persist registration profile fields on the member record
--
-- Update #2 ("recognize log in for registration"): so a signed-in member never
-- re-enters data we already hold, the rich per-registration fields are now also
-- stored on their `members` profile. Previously these lived ONLY on
-- `participants` rows, so a member with no prior registration had nothing to
-- pre-fill. Registration writes these onto the member upsert; the prefill helper
-- reads them back.
--
-- School is intentionally NOT added here — it remains modelled via the
-- member_schools join (see migration 024); prefill resolves the member's current
-- school from that join.

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS ethnicity                       text[],
  ADD COLUMN IF NOT EXISTS dietary_requirements            text[],
  ADD COLUMN IF NOT EXISTS health_conditions               text,
  ADD COLUMN IF NOT EXISTS emergency_contact_first_name    text,
  ADD COLUMN IF NOT EXISTS emergency_contact_last_name     text,
  ADD COLUMN IF NOT EXISTS emergency_contact_email         text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone         text,
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship  text;

COMMENT ON COLUMN public.members.ethnicity IS 'Persisted registration profile — display-string values matching the registration form options.';
COMMENT ON COLUMN public.members.dietary_requirements IS 'Persisted registration profile — display-string values matching the registration form options.';
COMMENT ON COLUMN public.members.emergency_contact_relationship IS 'Persisted registration profile — most recent emergency-contact relationship.';
