-- Migration 009: Add approval workflow to event_participations
-- Members submit with status='pending'; admin approves to 'approved'.
-- Existing records default to 'approved' so nothing breaks.

ALTER TABLE public.event_participations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending', 'approved'));
