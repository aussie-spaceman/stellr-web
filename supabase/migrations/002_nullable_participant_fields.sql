-- Migration: make grade and emergency contact fields nullable
-- These are optional for non-High School participants (Adults, Teachers, College)
-- Validation is enforced at the API level: HS students must provide these fields

ALTER TABLE public.participants
  ALTER COLUMN grade DROP NOT NULL,
  ALTER COLUMN emergency_contact_first_name DROP NOT NULL,
  ALTER COLUMN emergency_contact_last_name DROP NOT NULL,
  ALTER COLUMN emergency_contact_email DROP NOT NULL,
  ALTER COLUMN emergency_contact_phone DROP NOT NULL;
