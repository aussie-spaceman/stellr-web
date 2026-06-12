-- Migration 029: Consolidate the members table back to one emergency-contact column set
--
-- Migration 028 added emergency_contact_* columns to `members`, copying the
-- `participants` table's naming — but `members` already had canonical ec_*
-- columns, which is what /account (/api/members/me), the admin member editor,
-- onboarding, group-join prefill, and DocuSign dispatch all read and write.
-- Result: registrations saved emergency-contact updates into columns nothing
-- displayed, so the member's account page showed stale data.
--
-- The register routes and lib/registration-prefill.ts now use ec_* directly.
-- This migration moves any values captured in the duplicate columns into ec_*
-- and drops the duplicates.
--
-- ⚠️ ORDER OF OPERATIONS: deploy the code change BEFORE running this migration.
-- Code still writing emergency_contact_* will fail its member upsert once the
-- columns are gone (non-fatal, but the member profile update would be lost).
--
-- ethnicity / dietary_requirements / health_conditions from 028 are kept — they
-- had no pre-existing members equivalent. (Known follow-up: /account renders
-- ethnicity from the member_ethnicities join table, not members.ethnicity.)

-- Values in emergency_contact_* were written by registrations after 028 went
-- live, so where present they are newer than whatever ec_* holds.
UPDATE public.members SET
  ec_first_name   = COALESCE(emergency_contact_first_name,   ec_first_name),
  ec_last_name    = COALESCE(emergency_contact_last_name,    ec_last_name),
  ec_email        = COALESCE(emergency_contact_email,        ec_email),
  ec_phone        = COALESCE(emergency_contact_phone,        ec_phone),
  ec_relationship = COALESCE(emergency_contact_relationship, ec_relationship)
WHERE emergency_contact_first_name   IS NOT NULL
   OR emergency_contact_last_name    IS NOT NULL
   OR emergency_contact_email        IS NOT NULL
   OR emergency_contact_phone        IS NOT NULL
   OR emergency_contact_relationship IS NOT NULL;

ALTER TABLE public.members
  DROP COLUMN IF EXISTS emergency_contact_first_name,
  DROP COLUMN IF EXISTS emergency_contact_last_name,
  DROP COLUMN IF EXISTS emergency_contact_email,
  DROP COLUMN IF EXISTS emergency_contact_phone,
  DROP COLUMN IF EXISTS emergency_contact_relationship;
