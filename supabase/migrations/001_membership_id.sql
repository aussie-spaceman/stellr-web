-- Migration: add unique membership_id to participants
-- Run this in the Supabase SQL editor

-- Sequential counter for membership IDs
CREATE SEQUENCE IF NOT EXISTS participants_membership_id_seq START 1;

-- Add column; existing rows will each get a unique value from the sequence
ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS membership_id text
    NOT NULL
    DEFAULT lpad(nextval('participants_membership_id_seq')::text, 7, '0')
    UNIQUE;

-- Index for fast lookups by membership_id
CREATE UNIQUE INDEX IF NOT EXISTS participants_membership_id_idx
  ON public.participants (membership_id);
