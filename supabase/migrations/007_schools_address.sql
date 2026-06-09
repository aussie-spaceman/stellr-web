-- Migration 007: Add address fields to schools table

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS postcode      text;
